// The PatchBond server API and direct NEAR RPC views (no wallet needed to read).

import { formatAmount, type Currency, type VerdictRecord } from "@patchbond/shared";

export type { Currency };

export interface AppConfig {
  network: "testnet" | "mainnet";
  rpc: string;
  contract: string;
  token: string;
  /** wNEAR, when the contract takes NEAR bonds. */
  wnear: string | null;
  oracle: string;
  judge: { model: string; mock: boolean; mock_signing_address?: string };
  github?: { app_url: string | null; sign_in: boolean };
}

export interface MaintainerRepo {
  repo_id: number;
  full_name: string;
  private: boolean;
  onchain: Repo | null;
}

export type Me = { signed_in: false; github_ready: boolean } | { signed_in: true; github_login: string; repos: MaintainerRepo[] };

/** 502–504 come from the dev proxy or a load balancer while the API restarts — say so. */
const failure = (status: number, fallback: string) =>
  status >= 502 && status <= 504 ? "Couldn't reach the PatchBond server (it may be restarting). Wait a few seconds and try again." : fallback;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? failure(res.status, `The server answered ${res.status} for ${path}`));
  return body as T;
}

async function post<T>(path: string, body: object = {}): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error ?? failure(res.status, `The server answered ${res.status}`));
  return out as T;
}

export const api = {
  me: () => get<Me>("/api/me"),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  linkChallenge: (repo_id: number, account_id: string) => post<{ message: string; recipient: string; nonce: string }>("/api/link/challenge", { repo_id, account_id }),
  linkConfirm: (b: { nonce: string; account_id: string; public_key: string; signature: string }) => post<{ ok: true }>("/api/link/confirm", b),
  config: () => get<AppConfig>("/api/config"),
  verdict: (id: string) => get<VerdictRecord>(`/api/verdicts/${encodeURIComponent(id)}`),
  verdicts: (limit = 20, repo?: number) =>
    get<Omit<VerdictRecord, "request_body" | "response_body">[]>(`/api/verdicts?limit=${limit}${repo ? `&repo=${repo}` : ""}`),
  submission: (repo: number, number: number) => get<{ submission: unknown; deposit: Deposit | null; repo: Repo | null }>(`/api/submissions/${repo}/${number}`),
  appeals: (verdictId: string) => get<{ author: string; note: string; created_at: number }[]>(`/api/appeals/${encodeURIComponent(verdictId)}`),
  appeal: async (verdict_id: string, note: string, from: string) => {
    const res = await fetch("/api/appeals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdict_id, note, from }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Appeal failed (${res.status})`);
  },
  intentsQuote: (b: { amount: string; currency?: Currency; chain: string; recipient: string; refund_to: string }) =>
    post<{ dry: true; chain: string; amount_in: string; amount_out: string; min_amount_out: string; seconds: number; fees: { withdraw: string; refund: string } }>("/api/intents/quote", b),
  judge: async (url: string) => {
    const res = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Judging failed (${res.status})`);
    return body as { id: string; verdict: string };
  },
};

// ---- Contract views over plain JSON-RPC ----

export type Verdict = "refund" | "forfeit" | "void";

export interface Policy {
  enabled: boolean;
  base_bond: string;
  min_bond: string;
  max_bond: string;
  target_open: number;
  review_window_sec: number;
  challenge_window_sec: number;
  forfeit_threshold_bps: number;
}

export interface Repo {
  payout: string | null;
  policy: Policy;
  vault: string;
  open: number;
  linked_at: number | null;
  stats: { deposits: number; refunds: number; forfeits: number; forfeited_total: string; tips_earned: string };
  currency: Currency;
}

export type DepositStatus =
  | "held"
  | { proposed: { verdict: Verdict; deadline: number } }
  | { challenged: { verdict: Verdict; challenger: string; stake: string } }
  | { settled: { verdict: Verdict; at: number } };

export interface Deposit {
  payer: string;
  github_user: string;
  kind: "pr" | "issue";
  bond: string;
  tip: string;
  fixes_issue: number | null;
  created_at: number;
  reviewed_at: number | null;
  verdict_hash: string | null;
  status: DepositStatus;
  from_budget: boolean;
  harness: string | null;
  /** What the bond was paid in (and what refunds and stakes use). */
  currency: Currency;
}

export async function view<T>(cfg: AppConfig, method: string, args: object, contract = cfg.contract): Promise<T> {
  const res = await fetch(cfg.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "pb",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) {
    throw new Error(`NEAR RPC: ${body.error?.cause?.name ?? body.result?.error ?? "request failed"} (${method})`);
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}

export const chain = {
  repo: (cfg: AppConfig, repo_id: number) => view<Repo | null>(cfg, "get_repo", { repo_id }),
  deposit: (cfg: AppConfig, repo_id: number, number: number) => view<Deposit | null>(cfg, "get_deposit", { repo_id, number }),
  quote: (cfg: AppConfig, repo_id: number, account_id?: string | null) => view<string>(cfg, "quote_bond", { repo_id, account_id: account_id ?? null }),
  totals: (cfg: AppConfig) => view<{ held: string; refunded: string; forfeited: string; deposits: number }>(cfg, "get_totals", {}),
  reputation: (cfg: AppConfig, account_id: string) =>
    view<{ refunds: number; forfeits: number; last_forfeit_at: number | null; refund_repos: number[] }>(cfg, "get_reputation", { account_id }),
  harness: (cfg: AppConfig, harness: string) => view<{ deposits: number; refunds: number; forfeits: number }>(cfg, "get_harness_stats", { harness }),
  usdcBalance: (cfg: AppConfig, account_id: string) => view<string>(cfg, "ft_balance_of", { account_id }, cfg.token),
  /** Spendable balance in `currency`: USDC on the token, or native NEAR minus what storage locks. */
  balance: async (cfg: AppConfig, account_id: string, currency: Currency): Promise<string> => {
    if (currency === "usdc") return chain.usdcBalance(cfg, account_id);
    const res = await fetch(cfg.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "pb", method: "query", params: { request_type: "view_account", finality: "optimistic", account_id } }),
    });
    const body = (await res.json()) as { result?: { amount: string; storage_usage: number }; error?: unknown };
    if (!body.result) return "0";
    const free = BigInt(body.result.amount) - BigInt(body.result.storage_usage) * 10n ** 19n;
    return (free > 0n ? free : 0n).toString();
  },
  /** Whether `account_id` is registered with a NEP-145 token (wNEAR must know you to pay you). */
  registered: async (cfg: AppConfig, token: string, account_id: string) =>
    (await view<unknown>(cfg, "storage_balance_of", { account_id }, token)) !== null,
};

/** "$2.00" for USDC, "0.78 NEAR" for NEAR. */
export function money(units: string | bigint, currency: Currency = "usdc"): string {
  return currency === "usdc" ? `$${formatAmount(units, "usdc")}` : `${formatAmount(units, "near")} NEAR`;
}

export function explorerTx(cfg: AppConfig, hash: string) {
  return `https://${cfg.network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${hash}`;
}

export function explorerAccount(cfg: AppConfig, account: string) {
  return `https://${cfg.network === "testnet" ? "testnet." : ""}nearblocks.io/address/${account}`;
}
