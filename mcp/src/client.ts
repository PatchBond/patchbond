// PatchBond for agents: everything the MCP tools do, without the MCP plumbing (so it's testable).
//
// Safety model: the agent holds only a NEAR *function-call* key limited to `deposit_from_budget` on
// the PatchBond contract. It can't attach tokens, can't move its owner's funds, and the contract
// enforces the daily cap. `assertSafeKey` refuses to run with anything more powerful.

import { curveBond, formatUsdc } from "@patchbond/shared";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";

export interface Settings {
  /** PatchBond server (verdicts, pre-flight, config). */
  api: string;
  agent?: { accountId: string; key: string };
  passport: { operator: string; harness: string; model: string };
  githubToken?: string;
  /** Override for tests / GitHub Enterprise. */
  githubApi?: string;
}

export interface NetConfig {
  network: "testnet" | "mainnet";
  rpc: string;
  contract: string;
  token: string;
}

export interface RepoRef {
  owner: string;
  name: string;
  id: number;
}

export class PatchBondError extends Error {}

const TGAS = 1_000_000_000_000n;

export class PatchBond {
  private cfg?: NetConfig;
  private provider?: JsonRpcProvider;
  private keyChecked = false;

  constructor(
    readonly s: Settings,
    private http: typeof fetch = fetch,
  ) {}

  // ---------- plumbing ----------

  async config(): Promise<NetConfig> {
    if (!this.cfg) {
      const res = await this.http(`${this.s.api}/api/config`).catch(() => null);
      if (!res?.ok) throw new PatchBondError(`Can't reach the PatchBond server at ${this.s.api}. Set PATCHBOND_API to a running server.`);
      this.cfg = (await res.json()) as NetConfig;
      this.provider = new JsonRpcProvider({ url: this.cfg.rpc });
    }
    return this.cfg;
  }

  private async view<T>(method: string, args: Record<string, unknown>, contractId?: string): Promise<T> {
    const cfg = await this.config();
    return (await this.provider!.callFunction({ contractId: contractId ?? cfg.contract, method, args })) as T;
  }

  private async gh<T>(path: string): Promise<T> {
    const res = await this.http(`${this.s.githubApi ?? "https://api.github.com"}${path}`, {
      headers: { accept: "application/vnd.github+json", ...(this.s.githubToken ? { authorization: `Bearer ${this.s.githubToken}` } : {}) },
    });
    if (res.status === 404) throw new PatchBondError(`GitHub has no ${path.replace("/repos/", "")} (or it's private).`);
    if (!res.ok) throw new PatchBondError(`GitHub answered ${res.status} for ${path}${res.status === 403 ? " — rate limited; set GITHUB_TOKEN" : ""}.`);
    return (await res.json()) as T;
  }

  /** "owner/name", a repo URL, or a PR URL → GitHub's numeric repo id (what the contract keys on). */
  async repo(ref: string): Promise<RepoRef & { pr?: number }> {
    const m = ref.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:pull|issues)\/(\d+))?\/?$/);
    if (!m) throw new PatchBondError(`"${ref}" isn't a repo ("owner/name") or a GitHub PR URL.`);
    const data = await this.gh<{ id: number; full_name: string }>(`/repos/${m[1]}/${m[2]}`);
    const [owner, name] = data.full_name.split("/") as [string, string];
    return { owner, name, id: data.id, ...(m[3] ? { pr: Number(m[3]) } : {}) };
  }

  private async pr(url: string) {
    const r = await this.repo(url);
    if (!r.pr) throw new PatchBondError(`"${url}" isn't a pull request URL (…/pull/123).`);
    const pr = await this.gh<{ user: { login: string }; state: string; title: string; body: string | null }>(`/repos/${r.owner}/${r.name}/pulls/${r.pr}`);
    return { ...r, number: r.pr, author: pr.user.login, state: pr.state, title: pr.title, body: pr.body ?? "" };
  }

  /** Refuses full-access keys and keys that can do more than pay bonds. */
  async assertSafeKey(): Promise<void> {
    if (this.keyChecked) return;
    const agent = this.requireAgent();
    const cfg = await this.config();
    const pub = KeyPair.fromString(agent.key as KeyPairString).getPublicKey().toString();
    // A key added moments ago may not be visible yet: look at the latest block and retry briefly.
    let perm: unknown;
    for (let attempt = 0; attempt < 4 && !perm; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
      const res = await this.http(cfg.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key", finality: "optimistic", account_id: agent.accountId, public_key: pub } }),
      });
      perm = ((await res.json()) as { result?: { permission: unknown } }).result?.permission;
    }
    if (!perm) throw new PatchBondError(`The key in PATCHBOND_AGENT_KEY isn't on ${agent.accountId}. Add it as a function-call key first.`);
    if (perm === "FullAccess") {
      throw new PatchBondError(
        `Refusing to run: PATCHBOND_AGENT_KEY is a FULL-ACCESS key for ${agent.accountId}. An agent should hold a function-call key that can only call deposit_from_budget on ${cfg.contract}.`,
      );
    }
    const fc = (perm as { FunctionCall?: { receiver_id: string; method_names: string[] } }).FunctionCall;
    if (!fc || fc.receiver_id !== cfg.contract || fc.method_names.length === 0 || fc.method_names.some((m) => m !== "deposit_from_budget")) {
      throw new PatchBondError(`Refusing to run: the agent key must be limited to deposit_from_budget on ${cfg.contract} (it allows ${fc ? `${fc.method_names.join(", ") || "every method"} on ${fc.receiver_id}` : "something else"}).`);
    }
    this.keyChecked = true;
  }

  private requireAgent() {
    if (!this.s.agent) {
      throw new PatchBondError("No agent wallet configured. Set PATCHBOND_AGENT_ACCOUNT and PATCHBOND_AGENT_KEY (a function-call key) to pay bonds.");
    }
    return this.s.agent;
  }

  // ---------- tools ----------

  async policy(ref: string) {
    const r = await this.repo(ref);
    const repo = await this.view<OnChainRepo | null>("get_repo", { repo_id: r.id });
    if (!repo) {
      return { repo: `${r.owner}/${r.name}`, repo_id: r.id, uses_patchbond: false, advice: "This repo doesn't use PatchBond: no deposit needed. Open your PR as usual." };
    }
    const me = this.s.agent?.accountId ?? null;
    const [quote, exempt] = await Promise.all([
      this.view<string>("quote_bond", { repo_id: r.id, account_id: me }),
      me ? this.view<boolean>("is_exempt", { account_id: me }) : Promise.resolve(false),
    ]);
    const next = curveBond(repo.policy, repo.open + 1);
    return {
      repo: `${r.owner}/${r.name}`,
      repo_id: r.id,
      uses_patchbond: true,
      enabled: repo.policy.enabled,
      bond_usdc: formatUsdc(quote),
      you_are_exempt: exempt,
      queue: { open: repo.open, capacity: repo.policy.target_open, next_bond_if_one_more_usdc: formatUsdc(next) },
      review_window_hours: repo.policy.review_window_sec / 3600,
      challenge_window_hours: repo.policy.challenge_window_sec / 3600,
      advice: !repo.policy.enabled
        ? "PatchBond is turned off here: no deposit needed."
        : exempt || quote === "0"
          ? "You're a proven contributor here: no deposit needed."
          : `Opening a PR costs a refundable $${formatUsdc(quote)} bond. Run patchbond_preflight on your PR before paying — a forfeit costs the whole bond.`,
    };
  }

  async preflight(prUrl: string) {
    const res = await this.http(`${this.s.api}/api/preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: prUrl }) });
    const body = (await res.json()) as Record<string, unknown> & { error?: string };
    if (!res.ok) throw new PatchBondError(body.error ?? `Pre-flight failed (${res.status}).`);
    return body;
  }

  async deposit(prUrl: string, fixesIssue?: number) {
    const agent = this.requireAgent();
    await this.assertSafeKey();
    const cfg = await this.config();
    const pr = await this.pr(prUrl);
    if (pr.state !== "open") throw new PatchBondError(`${pr.owner}/${pr.name}#${pr.number} is ${pr.state}; bonds are only for open PRs.`);
    const existing = await this.view<OnChainDeposit | null>("get_deposit", { repo_id: pr.id, number: pr.number });
    if (existing && !(typeof existing.status === "object" && "settled" in existing.status && existing.status.settled.verdict === "void")) {
      return { already_paid: true, payer: existing.payer, bond_usdc: formatUsdc(existing.bond), status: describeStatus(existing.status) };
    }
    const account = new Account(agent.accountId, this.provider!, agent.key as KeyPairString);
    const raw = (await account
      .callFunctionRaw({
        contractId: cfg.contract,
        methodName: "deposit_from_budget",
        args: { repo_id: pr.id, number: pr.number, kind: "pr", github_user: pr.author, fixes_issue: fixesIssue ?? null, passport: this.s.passport },
        gas: 50n * TGAS,
        deposit: 0n,
        waitUntil: "FINAL",
      })
      .catch((e: Error) => {
        throw new PatchBondError(panicOf(e.message) ?? e.message);
      })) as unknown as { transaction: { hash: string }; status: unknown };
    const panic = panicOf(JSON.stringify(raw.status));
    if (panic) throw new PatchBondError(panic);
    const bond = await this.view<OnChainDeposit>("get_deposit", { repo_id: pr.id, number: pr.number });
    const budget = await this.budget();
    return {
      paid: true,
      pr: `${pr.owner}/${pr.name}#${pr.number}`,
      bond_usdc: formatUsdc(bond.bond),
      tx: explorer(cfg, raw.transaction.hash),
      budget_left_today_usdc: budget.left_today_usdc,
      next: "The judge runs after the repo's CI. Check with patchbond_status. A real contribution gets the bond back into your budget.",
    };
  }

  async status(prUrl: string) {
    const cfg = await this.config();
    const r = await this.repo(prUrl);
    if (!r.pr) throw new PatchBondError(`"${prUrl}" isn't a pull request URL.`);
    const [deposit, sub] = await Promise.all([
      this.view<OnChainDeposit | null>("get_deposit", { repo_id: r.id, number: r.pr }),
      this.http(`${this.s.api}/api/submissions/${r.id}/${r.pr}`).then((x) => (x.ok ? x.json() : null)).catch(() => null) as Promise<{ verdicts?: VerdictSummary[] } | null>,
    ]);
    const v = sub?.verdicts?.[0];
    return {
      pr: `${r.owner}/${r.name}#${r.pr}`,
      deposit: deposit ? { payer: deposit.payer, bond_usdc: formatUsdc(deposit.bond), status: describeStatus(deposit.status) } : null,
      verdict: v
        ? { verdict: v.final.verdict, confidence: v.final.confidence, reasons: v.final.reasons, page: `${this.webUrl()}/v/${v.id}`, mock_judge: v.mock }
        : null,
      network: cfg.network,
      next: !deposit
        ? "No bond paid yet. Use patchbond_policy, then patchbond_preflight, then patchbond_deposit."
        : !v
          ? "Waiting for CI and the judge."
          : v.final.verdict === "forfeit"
            ? "Forfeited. If the judge is wrong, file patchbond_appeal with specifics; your operator can stake to challenge on the verdict page."
            : v.final.verdict === "needs_human"
              ? "A maintainer will decide. Nothing to do."
              : "Refunded — the bond went back to your budget.",
    };
  }

  async budget() {
    const agent = this.requireAgent();
    const b = await this.view<{ owner: string; balance: string; daily_cap: string; spent_today: string; day: number } | null>("get_budget", { agent: agent.accountId });
    if (!b) throw new PatchBondError(`${agent.accountId} has no PatchBond budget. Its owner funds one with ft_transfer_call (msg {"action":"fund_budget",…}).`);
    const today = Math.floor(Date.now() / 86_400_000);
    const spent = b.day === today ? BigInt(b.spent_today) : 0n;
    const left = BigInt(b.daily_cap) - spent;
    const leftToday = left < BigInt(b.balance) ? left : BigInt(b.balance);
    return {
      agent: agent.accountId,
      owner: b.owner,
      balance_usdc: formatUsdc(b.balance),
      daily_cap_usdc: formatUsdc(b.daily_cap),
      spent_today_usdc: formatUsdc(spent),
      left_today_usdc: formatUsdc(leftToday > 0n ? leftToday : 0n),
      resets_at: new Date((today + 1) * 86_400_000).toISOString(),
    };
  }

  async reputation(who?: string) {
    const account = who ?? this.s.agent?.accountId;
    if (!account) throw new PatchBondError("Say which NEAR account (or configure the agent account).");
    const [rep, exempt, stats, harness] = await Promise.all([
      this.view<{ refunds: number; forfeits: number; last_forfeit_at: number | null; refund_repos: number[] }>("get_reputation", { account_id: account }),
      this.view<boolean>("is_exempt", { account_id: account }),
      this.view<{ deposits: number; refunds: number; forfeits: number }>("get_agent_stats", { agent: account }),
      this.view<{ deposits: number; refunds: number; forfeits: number }>("get_harness_stats", { harness: this.s.passport.harness }),
    ]);
    return {
      account,
      refunds: rep.refunds,
      forfeits: rep.forfeits,
      repos_with_refunds: rep.refund_repos.length,
      exempt,
      to_become_exempt: exempt ? null : "3 refunds across 2 different repos with no forfeit in the last 90 days.",
      as_agent: stats,
      harness: { name: this.s.passport.harness, ...harness },
    };
  }

  async appeal(verdictId: string, note: string) {
    const res = await this.http(`${this.s.api}/api/appeals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict_id: verdictId, note, from: this.s.agent?.accountId ?? "agent" }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) throw new PatchBondError(body.error ?? `Appeal failed (${res.status}).`);
    return {
      filed: true,
      verdict_page: `${this.webUrl()}/v/${verdictId}`,
      note: "Your note is attached to the verdict for the maintainer. To force a re-judge by a stronger model, your operator stakes the bond from the verdict page (a function-call key can't stake).",
    };
  }

  private webUrl() {
    return process.env.PATCHBOND_WEB ?? this.s.api.replace(/:8787$/, ":5317");
  }
}

interface OnChainRepo {
  open: number;
  policy: { enabled: boolean; base_bond: string; min_bond: string; max_bond: string; target_open: number; review_window_sec: number; challenge_window_sec: number };
}

type Status = "held" | { proposed: { verdict: string; deadline: number } } | { challenged: { verdict: string } } | { settled: { verdict: string; at: number } };

interface OnChainDeposit {
  payer: string;
  bond: string;
  status: Status;
}

interface VerdictSummary {
  id: string;
  mock: boolean;
  final: { verdict: string; confidence: number; reasons: string[] };
}

export function describeStatus(s: Status): string {
  if (s === "held") return "held — waiting for the judge";
  if ("proposed" in s) return `proposed ${s.proposed.verdict}; stands at ${new Date(s.proposed.deadline).toISOString()} unless challenged`;
  if ("challenged" in s) return `challenged; a stronger model is re-judging (proposed: ${s.challenged.verdict})`;
  return `settled: ${s.settled.verdict}`;
}

export function panicOf(text: string): string | null {
  return text.match(/Smart contract panicked: ([^"\\\n]+)/)?.[1] ?? null;
}

function explorer(cfg: NetConfig, hash: string) {
  return `https://${cfg.network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${hash}`;
}
