// The PatchBond GitHub App: PR opened → deposit asked → deposit seen on-chain → judged after CI →
// verdict settled on-chain and shown on the PR.

import { App, Octokit } from "octokit";
import type { Config } from "../config";
import { teeProof, type Chain } from "../near";
import type { VerdictRecord } from "@patchbond/shared";
import type { Store, Submission } from "../store";
import type { TeeRecords } from "../teeRecords";
import { judge } from "../judge/judge";
import type { Inference } from "../judge/nearai";
import { parseRepoRules, type RepoRules } from "../judge/facts";
import { gatherPr } from "./gather";
import { CHECK_NAME, MARKER, checkSummary, depositComment, depositPaidComment, money, payLink, unpaidClosedComment, utc, verdictComment } from "./text";

const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
/** Labels maintainers can filter on: review the paid queue, ignore the rest. */
export const LABEL = { awaiting: "patchbond: awaiting deposit", paid: "patchbond: deposit paid" } as const;
const RULES_TTL_MS = 10 * 60_000;

/** The slice of the chain the bot uses (tests pass a fake). */
export type ChainPort = Pick<
  Chain,
  "getRepo" | "getDeposit" | "quote" | "isExempt" | "getReputation" | "getBounty" | "registerRepo" | "settle" | "markReviewed" | "payBounty" | "finalize" | "resolveChallenge"
> &
  Partial<Pick<Chain, "getTeeJob" | "judgeInTee">>;

/** What the contract acts on at once: refunds, and forfeits the model itself signed. */
function actsOnChain(r: VerdictRecord): boolean {
  return r.final.verdict === "refund" || (r.final.verdict === "forfeit" && r.model_verdict?.verdict === "forfeit");
}

export class Bot {
  readonly app: App;
  /** Challenges being re-judged right now (a slow tx must not start a second re-judge). */
  private rejudging = new Set<string>();
  /** Re-judge results not yet accepted on-chain, so a retry never pays for a second model call. */
  private rejudged = new Map<string, VerdictRecord>();
  /** `.github/patchbond.yml` per repo, briefly cached (the tick reads it for auto-close). */
  private rulesCache = new Map<number, { rules: RepoRules; at: number }>();
  /** JUDGE_RUNNER=outlayer: the contract judges in an OutLayer enclave; we only ask and announce. */
  private tee?: TeeRecords;
  /** When we last asked the contract to judge each PR in OutLayer. */
  private teeAsked = new Map<string, number>();

  constructor(
    private cfg: Config,
    private chain: ChainPort,
    private store: Store,
    private inference: Inference,
    /** Re-judges challenged verdicts; defaults to the same model. */
    private strong: Inference = inference,
    private log = (msg: string, extra?: unknown) => console.log(`[bot] ${msg}`, extra ?? ""),
  ) {
    this.app = new App({
      appId: cfg.github.appId(),
      privateKey: cfg.github.privateKey(),
      webhooks: { secret: cfg.github.webhookSecret() },
      Octokit: Octokit.defaults({ baseUrl: cfg.github.apiUrl, ...(cfg.github.throttle ? {} : { throttle: { enabled: false } }) }),
    });
    this.routes();
  }

  private routes() {
    const w = this.app.webhooks;
    w.on(["installation.created", "installation_repositories.added"], async ({ payload }) => {
      const repos = "repositories_added" in payload ? payload.repositories_added : (payload.repositories ?? []);
      for (const r of repos) await this.ensureRepo(r.id);
    });
    w.on(["pull_request.opened", "pull_request.reopened"], ({ octokit, payload }) =>
      this.onOpened(octokit, payload.installation!.id, payload.repository, payload.pull_request),
    );
    w.on("pull_request.synchronize", ({ payload }) => {
      const s = this.store.submission(payload.repository.id, payload.pull_request.number);
      if (s) this.store.upsertSubmission({ ...s, head_sha: payload.pull_request.head.sha });
    });
    w.on("pull_request_review.submitted", async ({ payload }) => {
      if (!MAINTAINER.has(payload.review.author_association)) return;
      const d = await this.chain.getDeposit(payload.repository.id, payload.pull_request.number);
      // Reviews usually come after the AI verdict; the contract accepts one until the deposit settles.
      const settled = !!d && typeof d.status === "object" && "settled" in d.status;
      if (d && d.reviewed_at === null && !settled) {
        await this.chain.markReviewed(payload.repository.id, payload.pull_request.number).catch((e) => this.log("mark_reviewed failed", String(e)));
      }
    });
    w.on("pull_request.closed", ({ payload }) => this.onClosed(payload.repository.id, payload.pull_request));
    w.onError((e) => this.log("webhook error", e.message));
  }

  private async ensureRepo(repoId: number) {
    if (await this.chain.getRepo(repoId)) return;
    await this.chain.registerRepo(repoId);
    this.log(`registered repo ${repoId}`);
  }

  async onOpened(
    gh: Octokit,
    installationId: number,
    repo: { id: number; full_name: string; owner: { login: string }; name: string },
    pr: { number: number; user: { login: string } | null; author_association: string; head: { sha: string } },
  ) {
    const author = pr.user?.login ?? "ghost";
    const base = {
      repo_id: repo.id, number: pr.number, full_name: repo.full_name, installation_id: installationId,
      author, head_sha: pr.head.sha, check_run_id: null, comment_id: null, verdict_id: null, deposit_seen_at: null,
    };
    await this.ensureRepo(repo.id);
    const onChain = await this.chain.getRepo(repo.id);
    if (!onChain?.policy.enabled) return;

    const known = this.store.nearAccountOf(author);
    const rules = await this.rulesOf(repo.id, installationId, repo.full_name);
    // Only the team is waved through. Having merged PRs before doesn't exempt anyone.
    const exemptReason = MAINTAINER.has(pr.author_association)
      ? "Maintainers and collaborators don't pay deposits."
      : rules.exempt.includes(author.toLowerCase())
        ? `@${author} is on this repo's team list (.github/patchbond.yml).`
        : (await this.isOrgMember(gh, repo.owner.login, author))
          ? `@${author} is a member of @${repo.owner.login}.`
          : known && (await this.chain.isExempt(known))
            ? `@${author} is a proven contributor (${known}: 3+ refunds on 2+ repos, no recent forfeits).`
            : null;
    if (exemptReason) {
      const check = await this.check(gh, repo, pr.head.sha, "completed", "success", checkSummary("exempt", exemptReason));
      this.store.upsertSubmission({ ...base, check_run_id: check, state: "exempt" });
      return;
    }

    const bond = (await this.chain.quote(repo.id, known ?? undefined)) ?? onChain.policy.base_bond;
    const link = payLink(this.cfg.webUrl, repo.id, pr.number, repo.full_name, author);
    // The deadline is announced here, up front; a PR is never closed on a deadline it wasn't told.
    const hours = rules.closeUnpaidAfterHours;
    const closeAt = hours ? Date.now() + hours * 3_600_000 : null;
    const check = await this.check(gh, repo, pr.head.sha, "in_progress", null, checkSummary("awaiting", `Pay the refundable deposit: ${link}${closeAt ? `\n\nUnpaid PRs close at ${utc(closeAt)}; paying later reopens it.` : ""}`));
    const { data: comment } = await gh.rest.issues.createComment({
      owner: repo.owner.login, repo: repo.name, issue_number: pr.number,
      body: depositComment({ author, bond, currency: onChain.currency ?? "usdc", open: onChain.open, target: onChain.policy.target_open, link, webUrl: this.cfg.webUrl, closeAt, hours }),
    });
    this.store.upsertSubmission({ ...base, check_run_id: check, comment_id: comment.id, state: "awaiting_deposit", close_at: closeAt });
    await gh.rest.issues.addLabels({ owner: repo.owner.login, repo: repo.name, issue_number: pr.number, labels: [LABEL.awaiting] }).catch(() => {});
    this.log(`asked ${author} for a deposit on ${repo.full_name}#${pr.number}`);
  }

  /** Called on a timer: watches the chain for deposits and CI for completion. */
  async tick() {
    for (const s of this.store.submissionsIn("awaiting_deposit", "closed_unpaid")) {
      await this.checkDeposit(s).catch((e) => this.log(`deposit check ${s.full_name}#${s.number}`, String(e)));
    }
    for (const s of this.store.submissionsIn("awaiting_deposit")) {
      await this.maybeCloseUnpaid(s).catch((e) => this.log(`auto-close ${s.full_name}#${s.number}`, String(e)));
    }
    for (const s of this.store.submissionsIn("deposit_received")) {
      await this.maybeJudge(s).catch((e) => this.log(`judge ${s.full_name}#${s.number}`, String(e)));
    }
    for (const s of this.store.submissionsIn("judged")) {
      await this.settleDue(s).catch((e) => this.log(`finalize ${s.full_name}#${s.number}`, String(e)));
    }
  }

  /**
   * After judging: a proposed verdict is finalized once its challenge window passes (anyone may; we
   * do it so nobody has to), and a needs_human case nobody decided is refunded after the timeout.
   */
  private async settleDue(s: Submission) {
    const d = await this.chain.getDeposit(s.repo_id, s.number);
    if (!d) return;
    if (typeof d.status === "object" && "settled" in d.status) {
      this.store.setState(s.repo_id, s.number, "settled");
      return;
    }
    if (typeof d.status === "object" && "challenged" in d.status) {
      const key = `${s.repo_id}/${s.number}`;
      if (this.rejudging.has(key)) return;
      this.rejudging.add(key);
      try {
        await this.rejudge(s, d.status.challenged.verdict as "refund" | "forfeit", d.status.challenged.challenger, d.status.challenged.stake === "0");
      } finally {
        this.rejudging.delete(key);
      }
      return;
    }
    if (typeof d.status === "object" && "proposed" in d.status && Date.now() > d.status.proposed.deadline) {
      const verdict = d.status.proposed.verdict;
      await this.chain.finalize(s.repo_id, s.number);
      this.store.setState(s.repo_id, s.number, "settled");
      this.log(`finalized ${s.full_name}#${s.number}: ${verdict}`);
      return;
    }
    if (d.status === "held" && Date.now() - s.updated_at > this.cfg.needsHumanTimeoutMs) {
      await this.chain.settle(s.repo_id, s.number, "refund", d.verdict_hash ?? "0".repeat(64));
      this.store.setState(s.repo_id, s.number, "settled");
      const gh = await this.app.getInstallationOctokit(s.installation_id);
      const [owner, repo] = s.full_name.split("/") as [string, string];
      await gh.rest.issues.createComment({
        owner, repo, issue_number: s.number,
        body: `${MARKER}\n### ✅ Deposit refunded\n\nNo maintainer decided within ${Math.round(this.cfg.needsHumanTimeoutMs / 86_400_000)} days, so the deposit went back to the contributor. When in doubt, PatchBond refunds.`,
      });
      this.log(`refunded undecided ${s.full_name}#${s.number}`);
    }
  }

  private async checkDeposit(s: Submission) {
    const d = await this.chain.getDeposit(s.repo_id, s.number);
    if (!d) return;
    const gh = await this.app.getInstallationOctokit(s.installation_id);
    if (d.github_user.toLowerCase() !== s.author.toLowerCase()) {
      // Someone paid for a PR that isn't theirs: give it back, keep waiting for the author.
      await this.chain.settle(s.repo_id, s.number, "void", "0".repeat(64));
      this.log(`voided deposit by ${d.payer} for ${d.github_user} on PR by ${s.author}`);
      return;
    }
    this.store.linkGithub(s.author, d.payer);
    const wasClosed = s.state === "closed_unpaid";
    this.store.setState(s.repo_id, s.number, "deposit_received", { deposit_seen_at: Date.now() });
    const repoOnChain = await this.chain.getRepo(s.repo_id);
    const currency = repoOnChain?.currency ?? "usdc";
    await this.updateCheck(gh, s, "in_progress", null, checkSummary("received", `Deposit of ${money(d.bond, currency)} from ${d.payer}. The AI judge runs once CI finishes.`));
    const [owner, repo] = s.full_name.split("/") as [string, string];
    if (wasClosed) await gh.rest.pulls.update({ owner, repo, pull_number: s.number, state: "open" }).catch(() => {});
    await gh.rest.issues.removeLabel({ owner, repo, issue_number: s.number, name: LABEL.awaiting }).catch(() => {});
    await gh.rest.issues.addLabels({ owner, repo, issue_number: s.number, labels: [LABEL.paid] }).catch(() => {});
    // An @mention makes GitHub email the maintainer — notifications at no cost to anyone.
    await gh.rest.issues.createComment({
      owner, repo, issue_number: s.number,
      body: depositPaidComment({
        maintainer: this.store.repoMaintainer(s.repo_id),
        author: s.author,
        amount: money(d.bond, currency),
        tip: BigInt(d.tip) > 0n ? money(d.tip, currency) : null,
        reviewHours: (repoOnChain?.policy.review_window_sec ?? 0) / 3600,
        reopened: wasClosed,
      }),
    });
    this.log(`deposit received for ${s.full_name}#${s.number} from ${d.payer}`);
  }

  /** Closes a PR still unpaid at the deadline its deposit comment announced (24 h by default). */
  private async maybeCloseUnpaid(s: Submission) {
    if (!s.close_at || Date.now() < s.close_at) return;
    // The repo may have turned auto-close off since.
    if (!(await this.rulesOf(s.repo_id, s.installation_id, s.full_name)).closeUnpaidAfterHours) return;
    const gh = await this.app.getInstallationOctokit(s.installation_id);
    const [owner, repo] = s.full_name.split("/") as [string, string];
    await gh.rest.issues.createComment({
      owner, repo, issue_number: s.number,
      body: unpaidClosedComment({ link: payLink(this.cfg.webUrl, s.repo_id, s.number, s.full_name, s.author) }),
    });
    await gh.rest.pulls.update({ owner, repo, pull_number: s.number, state: "closed" });
    this.store.setState(s.repo_id, s.number, "closed_unpaid");
    this.log(`closed unpaid ${s.full_name}#${s.number}`);
  }

  /**
   * Org members whose membership is private show up as CONTRIBUTOR, not MEMBER. Seeing private
   * members needs the App's "Members: read" permission; without it only public members count.
   */
  private async isOrgMember(gh: Octokit, org: string, login: string): Promise<boolean> {
    try {
      const r = await gh.request("GET /orgs/{org}/members/{username}", { org, username: login, request: { redirect: "manual" } });
      return Number(r.status) === 204;
    } catch {
      return false; // 404 (not a member), 302 (we can't see private members), or a user-owned repo
    }
  }

  private async rulesOf(repoId: number, installationId: number, fullName: string): Promise<RepoRules> {
    const hit = this.rulesCache.get(repoId);
    if (hit && Date.now() - hit.at < RULES_TTL_MS) return hit.rules;
    const gh = await this.app.getInstallationOctokit(installationId);
    const [owner, repo] = fullName.split("/") as [string, string];
    const text = await gh.rest.repos
      .getContent({ owner, repo, path: ".github/patchbond.yml", mediaType: { format: "raw" } })
      .then((r) => String(r.data))
      .catch(() => undefined);
    const rules = parseRepoRules(text);
    this.rulesCache.set(repoId, { rules, at: Date.now() });
    return rules;
  }

  private async maybeJudge(s: Submission) {
    const gh = await this.app.getInstallationOctokit(s.installation_id);
    const [owner, repo] = s.full_name.split("/") as [string, string];
    const repoOnChain = await this.chain.getRepo(s.repo_id);
    const threshold = (repoOnChain?.policy.forfeit_threshold_bps ?? 8500) / 10_000;
    const payer = this.store.nearAccountOf(s.author);
    const rep = payer ? await this.chain.getReputation(payer) : undefined;
    const input = await gatherPr(gh, { owner, repo, number: s.number }, {
      threshold,
      authorReputation: rep && rep.forfeits > 0 ? "has_forfeits" : rep && rep.refunds > 0 ? "proven" : "new",
    });
    const ciDone = !input.checkRuns.some((c) => c.status !== "completed" && !c.name.startsWith(CHECK_NAME));
    const timedOut = Date.now() - (s.deposit_seen_at ?? 0) > this.cfg.ciTimeoutMs;
    if (!ciDone && !timedOut) return;

    if (this.tee && this.chain.judgeInTee) return this.judgeInEnclave(s, gh, repoOnChain);

    this.store.setState(s.repo_id, s.number, "judging");
    const record = await judge(input, this.inference);
    this.store.saveVerdict(record);

    let onChain = false;
    // The contract only forfeits what the TEE itself signed as a forfeit. When the server's scan
    // escalated past the model (malicious code the model let through), a maintainer confirms it.
    if (actsOnChain(record)) {
      await this.chain.settle(s.repo_id, s.number, record.final.verdict as "refund" | "forfeit", record.verdict_hash, record.final.verdict === "forfeit" ? teeProof(record) : undefined);
      onChain = true;
    }
    await this.announce(s, gh, record, repoOnChain, onChain);
  }

  /** Use the OutLayer enclave judge (the contract must have one: `get_outlayer`). */
  useEnclave(tee: TeeRecords) {
    this.tee = tee;
  }

  /**
   * The enclave fetches the PR itself, so nothing we say reaches the model: we ask the contract to
   * judge, then announce the record the contract accepted (its callback already settled it).
   */
  private async judgeInEnclave(s: Submission, gh: Octokit, repoOnChain: Awaited<ReturnType<ChainPort["getRepo"]>>) {
    const key = `${s.repo_id}/${s.number}`;
    const job = await this.chain.getTeeJob!(s.repo_id, s.number);
    if (!job) {
      // Not asked yet — or the last run answered "CI still running"/failed and was cleared.
      if (Date.now() - (this.teeAsked.get(key) ?? 0) < 3 * 60_000) return;
      this.teeAsked.set(key, Date.now());
      await this.chain.judgeInTee!(s.repo_id, s.number);
      this.store.setState(s.repo_id, s.number, "deposit_received");
      this.log(`asked the contract to judge ${s.full_name}#${s.number} in OutLayer`);
      return;
    }
    if (job.state !== "judged") return;
    const record = await this.tee!.confirmed(s.repo_id, s.number);
    if (!record) return; // the enclave's published record hasn't arrived yet
    this.teeAsked.delete(key);
    await this.announce(s, gh, record, repoOnChain, actsOnChain(record));
  }

  private async announce(s: Submission, gh: Octokit, record: VerdictRecord, repoOnChain: Awaited<ReturnType<ChainPort["getRepo"]>>, onChain: boolean) {
    const [owner, repo] = s.full_name.split("/") as [string, string];
    const v = record.final.verdict;
    const conclusion = v === "refund" ? "success" : v === "forfeit" ? "failure" : "neutral";
    await this.updateCheck(gh, s, "completed", conclusion, checkSummary(v, `${record.final.reasons.join(" ")}\n\nVerdict: ${this.cfg.webUrl}/v/${record.id}`));
    await gh.rest.issues.createComment({
      owner, repo, issue_number: s.number,
      body: verdictComment(record, { webUrl: this.cfg.webUrl, challengeHours: (repoOnChain?.policy.challenge_window_sec ?? 0) / 3600, onChain }),
    });
    if (v === "forfeit") {
      await gh.rest.issues.addLabels({ owner, repo, issue_number: s.number, labels: ["patchbond:forfeit"] }).catch(() => {});
    }
    this.store.setState(s.repo_id, s.number, "judged", { verdict_id: record.id });
    this.log(`judged ${s.full_name}#${s.number}: ${v}`);
  }

  /**
   * Someone staked against the proposed verdict: a stronger model judges the PR afresh, seeing both
   * sides' statements as untrusted claims. needs_human resolves as refund (when in doubt, refund).
   */
  private async rejudge(s: Submission, proposed: "refund" | "forfeit", challengerAccount: string, freeDispute = false) {
    // A re-judge costs real credits: reuse it if resolving on-chain failed and we're retrying.
    const key = `${s.repo_id}/${s.number}`;
    const gh = await this.app.getInstallationOctokit(s.installation_id);
    const [owner, repo] = s.full_name.split("/") as [string, string];
    const repoOnChain = await this.chain.getRepo(s.repo_id);
    const challenger = repoOnChain?.payout === challengerAccount ? "maintainer" : "contributor";
    const input = await gatherPr(gh, { owner, repo, number: s.number }, {
      threshold: (repoOnChain?.policy.forfeit_threshold_bps ?? 8500) / 10_000,
      authorReputation: "new",
    });
    const statements = s.verdict_id ? this.store.appeals(s.verdict_id).map((a) => ({ from: a.author, note: a.note })) : [];
    const record = this.rejudged.get(key) ?? (await judge(input, this.strong, new Date(), { proposed, challenger, statements }));
    if (!this.rejudged.has(key)) {
      this.rejudged.set(key, record);
      this.store.saveVerdict(record);
    }
    // A forfeit needs the stronger model's own TEE-signed forfeit; anything less resolves as a refund.
    // For a disputed *maintainer* forfeit, a human already decided: it stands when the stronger model
    // also signs a forfeit, without the server's hard-fact rule (that rule stops the AI acting alone).
    // The contract still requires the model's signed forfeit above the repo's threshold, with evidence.
    const modelForfeit = record.model_verdict?.verdict === "forfeit";
    let verdict: "refund" | "forfeit" = (freeDispute ? modelForfeit : record.final.verdict === "forfeit" && modelForfeit) ? "forfeit" : "refund";
    try {
      await this.chain.resolveChallenge(s.repo_id, s.number, verdict, record.verdict_hash, verdict === "forfeit" ? teeProof(record) : undefined);
    } catch (e) {
      if (verdict !== "forfeit" || !/TEE proof rejected|needs the NEAR AI TEE proof|only from the OutLayer enclave/.test(String(e))) throw e;
      // e.g. the re-judge model's enclave key isn't registered on the contract: when in doubt, refund.
      this.log(`re-judge forfeit for ${key} not accepted on-chain (${String(e).slice(0, 120)}); refunding`);
      verdict = "refund";
      await this.chain.resolveChallenge(s.repo_id, s.number, verdict, record.verdict_hash);
    }
    this.rejudged.delete(key);
    this.store.setState(s.repo_id, s.number, "settled", { verdict_id: record.id });
    const overturned = verdict !== proposed;
    const what = freeDispute
      ? `The contributor disputed the maintainer's forfeit (free). A stronger model (\`${record.model}\`) re-judged the PR with both sides' statements and decided **${verdict}**.${overturned ? " The deposit is returned, plus a penalty from the maintainers' vault." : " The forfeit stands."}`
      : `The ${challenger} staked to challenge the "${proposed}" verdict. A stronger model (\`${record.model}\`) re-judged the PR with both sides' statements and decided **${verdict}**.${overturned ? " The challenger's stake is returned." : ` The stake goes to the ${challenger === "contributor" ? "repository" : "contributor"}.`}`;
    await gh.rest.issues.createComment({
      owner, repo, issue_number: s.number,
      body: `${MARKER}\n### ${overturned ? "🔄 Challenge upheld — verdict overturned" : "⚖️ Challenge rejected — verdict stands"}\n\n${what}\n\n${record.final.reasons.map((r) => `- ${r}`).join("\n")}\n\n<sub>[Signed record — verify it yourself](${this.cfg.webUrl}/v/${record.id})</sub>`,
    });
    this.log(`re-judged ${s.full_name}#${s.number}: ${proposed} → ${verdict}`);
  }

  /** A merged PR that fixes an issue with a bounty pays its author (slop funds the fix). */
  private async onClosed(repoId: number, pr: { number: number; merged: boolean; body: string | null; title: string; user: { login: string } | null }) {
    const s = this.store.submission(repoId, pr.number);
    // "closed_unpaid" (closed by us) keeps watching for a deposit, to reopen the PR.
    if (s && s.state === "awaiting_deposit") this.store.setState(repoId, pr.number, "closed");
    if (!pr.merged) return;
    const m = `${pr.title}\n${pr.body ?? ""}`.match(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s*#(\d+)\b/i);
    if (!m) return;
    const issue = Number(m[1]);
    const bounty = await this.chain.getBounty(repoId, issue);
    const recipient = pr.user && this.store.nearAccountOf(pr.user.login);
    if (bounty && bounty !== "0" && recipient) {
      await this.chain.payBounty(repoId, issue, recipient);
      this.log(`paid bounty on #${issue} to ${recipient}`);
    }
  }

  private async check(
    gh: Octokit,
    repo: { owner: { login: string }; name: string },
    sha: string,
    status: "in_progress" | "completed",
    conclusion: "success" | "failure" | "neutral" | null,
    output: { title: string; summary: string },
  ): Promise<number> {
    const { data } = await gh.rest.checks.create({
      owner: repo.owner.login, repo: repo.name, name: CHECK_NAME, head_sha: sha, status,
      ...(conclusion ? { conclusion } : {}), output,
    });
    return data.id;
  }

  private async updateCheck(
    gh: Octokit,
    s: Submission,
    status: "in_progress" | "completed",
    conclusion: "success" | "failure" | "neutral" | null,
    output: { title: string; summary: string },
  ) {
    const [owner, repo] = s.full_name.split("/") as [string, string];
    if (!s.check_run_id) return;
    await gh.rest.checks.update({
      owner, repo, check_run_id: s.check_run_id, status, ...(conclusion ? { conclusion } : {}), output,
    });
  }
}
