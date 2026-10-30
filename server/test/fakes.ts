// A fake GitHub REST API (enough for the bot) and a fake vault contract, for offline bot tests.

import { generateKeyPairSync } from "node:crypto";
import type { ChainPort } from "../src/github/bot";
import type { Deposit, Repo, TeeProof } from "../src/near";

export interface PrFixture {
  number: number;
  author: string;
  title: string;
  body: string;
  diff: string;
  files: string[];
  checks: { name: string; status: string; conclusion: string | null }[];
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export function rsaKey(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

export function fakeGithub(repo: { id: number; owner: string; name: string }, prs: PrFixture[]) {
  const calls: Call[] = [];
  /** The repo's `.github/patchbond.yml`, if any. */
  let rulesFile: string | null = null;
  /** Members of the repo owner's org (private ones included). */
  let orgMembers: string[] = [];
  /** Simulates GitHub expiring/revoking maintainers' sign-in tokens. */
  let userTokensRevoked = false;
  let nextId = 1000;
  const full = `${repo.owner}/${repo.name}`;
  const server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const p = url.pathname;
      const body = req.method === "GET" ? null : await req.json().catch(() => null);
      calls.push({ method: req.method, path: p, body });
      const json = (v: unknown, status = 200) => Response.json(v, { status });

      // OAuth (user-to-server) — sign-in for maintainers
      if (p === "/login/oauth/access_token") return json((body as { code?: string })?.code === "good" ? { access_token: "ghu_user" } : { error_description: "bad code" });
      if (p === "/user") return json({ login: "amaka", id: 77 });
      if (userTokensRevoked && p.startsWith("/user/")) return json({ message: "Bad credentials" }, 401);
      if (p === "/user/installations") return json({ total_count: 1, installations: [{ id: 7 }] });
      if (p === "/user/installations/7/repositories") {
        return json({
          total_count: 2,
          repositories: [
            { id: repo.id, full_name: full, private: false, permissions: { admin: true } },
            { id: 99, full_name: `${repo.owner}/not-mine`, private: false, permissions: { admin: false } },
          ],
        });
      }
      if (p.match(/^\/app\/installations\/\d+\/access_tokens$/)) return json({ token: "ghs_fake", expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
      if (p === `/repos/${full}`) return json({ id: repo.id, full_name: full });
      if (p === `/repos/${full}/pulls` && req.method === "GET") return json([]);
      const pr = p.match(new RegExp(`^/repos/${full}/pulls/(\\d+)(/files)?$`));
      if (pr) {
        const f = prs.find((x) => x.number === Number(pr[1]));
        if (!f) return json({ message: "Not Found" }, 404);
        if (pr[2]) return json(f.files.map((filename) => ({ filename })));
        if ((req.headers.get("accept") ?? "").includes("diff")) return new Response(f.diff, { headers: { "content-type": "text/plain" } });
        return json({
          number: f.number, title: f.title, body: f.body, user: { login: f.author }, state: "open",
          additions: 3, deletions: 0, head: { sha: `head${f.number}` }, base: { sha: "base1" },
        });
      }
      const checks = p.match(new RegExp(`^/repos/${full}/commits/head(\\d+)/check-runs$`));
      if (checks) return json({ total_count: 1, check_runs: prs.find((x) => x.number === Number(checks[1]))?.checks ?? [] });
      if (p === `/repos/${full}/check-runs` && req.method === "POST") return json({ id: nextId++ }, 201);
      if (p.startsWith(`/repos/${full}/check-runs/`) && req.method === "PATCH") return json({ id: Number(p.split("/").pop()) });
      if (p.match(new RegExp(`^/repos/${full}/issues/\\d+/comments$`)) && req.method === "POST") return json({ id: nextId++ }, 201);
      if (p.match(new RegExp(`^/repos/${full}/issues/\\d+/labels(/.+)?$`))) return json([{ name: "patchbond:forfeit" }]);
      const member = p.match(new RegExp(`^/orgs/${repo.owner}/members/([^/]+)$`));
      if (member) return orgMembers.includes(member[1]!) ? new Response(null, { status: 204 }) : json({ message: "Not Found" }, 404);
      if (decodeURIComponent(p) === `/repos/${full}/contents/.github/patchbond.yml`) {
        return rulesFile === null ? json({ message: "Not Found" }, 404) : new Response(rulesFile, { headers: { "content-type": "text/plain" } });
      }
      return json({ message: "Not Found" }, 404);
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    calls,
    stop: () => server.stop(true),
    setRules: (text: string | null) => (rulesFile = text),
    setOrgMembers: (logins: string[]) => (orgMembers = logins),
    revokeUserTokens: (revoked = true) => (userTokensRevoked = revoked),
    posted: (re: RegExp) => calls.filter((c) => c.method !== "GET" && re.test(c.path)),
  };
}

/** In-memory vault with the same state machine the bot relies on. */
export function fakeChain(repoId: number) {
  const repos = new Map<number, Repo>();
  const deposits = new Map<string, Deposit>();
  const log: string[] = [];
  const key = (r: number, n: number) => `${r}/${n}`;
  const policy = { enabled: true, base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8, review_window_sec: 259200, challenge_window_sec: 259200, forfeit_threshold_bps: 8500 };
  const chain: ChainPort & { linkRepo: (r: number, payout: string) => Promise<unknown>; pay: (n: number, payer: string, githubUser: string) => void; repos: typeof repos; deposits: typeof deposits; log: string[]; proofs: Map<string, TeeProof> } = {
    repos,
    deposits,
    log,
    pay(n, payer, githubUser) {
      deposits.set(key(repoId, n), {
        payer, github_user: githubUser, kind: "pr", bond: "2000000", tip: "0", fixes_issue: null, created_at: Date.now(),
        reviewed_at: null, verdict_hash: null, status: "held", from_budget: false, harness: null,
      });
    },
    getRepo: async (id) => repos.get(id) ?? null,
    getDeposit: async (r, n) => deposits.get(key(r, n)) ?? null,
    quote: async () => "2000000",
    isExempt: async () => false,
    getReputation: async () => ({ refunds: 0, forfeits: 0, last_forfeit_at: null, refund_repos: [] }),
    getBounty: async () => "0",
    registerRepo: async (id) => {
      log.push(`register ${id}`);
      repos.set(id, { payout: null, policy, vault: "0", open: 0, linked_at: null, stats: { deposits: 0, refunds: 0, forfeits: 0, forfeited_total: "0", tips_earned: "0" }, currency: "usdc" });
      return undefined as never;
    },
    proofs: new Map(),
    settle: async (r, n, verdict, hash, proof) => {
      log.push(`settle ${r}#${n} ${verdict}`);
      if (proof) chain.proofs.set(key(r, n), proof);
      const d = deposits.get(key(r, n))!;
      d.verdict_hash = hash;
      d.status = verdict === "void" ? { settled: { verdict, at: Date.now() } } : { proposed: { verdict, deadline: Date.now() + 400 } };
      return undefined as never;
    },
    markReviewed: async (r, n) => {
      log.push(`reviewed ${r}#${n}`);
      return undefined as never;
    },
    payBounty: async (r, issue, to) => {
      log.push(`bounty ${r}#${issue} → ${to}`);
      return undefined as never;
    },
    linkRepo: async (r: number, payout: string) => {
      log.push(`link ${r} → ${payout}`);
      const repo = repos.get(r);
      if (repo) repo.payout = payout;
      return undefined;
    },
    resolveChallenge: async (r, n, verdict, hash) => {
      log.push(`resolve ${r}#${n} ${verdict}`);
      const d = deposits.get(key(r, n))!;
      d.verdict_hash = hash;
      d.status = { settled: { verdict, at: Date.now() } };
      return undefined as never;
    },
    finalize: async (r, n) => {
      log.push(`finalize ${r}#${n}`);
      const d = deposits.get(key(r, n))!;
      if (typeof d.status === "object" && "proposed" in d.status) d.status = { settled: { verdict: d.status.proposed.verdict, at: Date.now() } };
      return undefined as never;
    },
  };
  return chain;
}
