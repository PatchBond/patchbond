// The vault contract, from the oracle's side: views for anyone, calls signed with the oracle key.

import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import type { Config } from "./config";

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
}

const TGAS = 1_000_000_000_000n;

export class Chain {
  readonly provider: JsonRpcProvider;
  private oracle?: Account;

  constructor(private cfg: Config) {
    this.provider = new JsonRpcProvider({ url: cfg.deployment.rpc });
  }

  private view<T>(method: string, args: Record<string, unknown>): Promise<T | undefined> {
    return this.provider.callFunction<T & {}>({ contractId: this.cfg.deployment.contract, method, args }) as Promise<T | undefined>;
  }

  private async call(methodName: string, args: Record<string, unknown>, tgas = 100n) {
    this.oracle ??= new Account(this.cfg.deployment.oracle, this.provider, this.cfg.oracleKey() as KeyPairString);
    return this.oracle.callFunction({
      contractId: this.cfg.deployment.contract,
      methodName,
      args,
      gas: tgas * TGAS,
      deposit: 0n,
    });
  }

  getRepo = (repo_id: number) => this.view<Repo | null>("get_repo", { repo_id });
  getDeposit = (repo_id: number, number: number) => this.view<Deposit | null>("get_deposit", { repo_id, number });
  quote = (repo_id: number, account_id?: string) => this.view<string>("quote_bond", { repo_id, account_id: account_id ?? null });
  getReputation = (account_id: string) =>
    this.view<{ refunds: number; forfeits: number; last_forfeit_at: number | null; refund_repos: number[] }>("get_reputation", { account_id });
  isExempt = (account_id: string) => this.view<boolean>("is_exempt", { account_id });
  getTotals = () => this.view<{ held: string; refunded: string; forfeited: string; deposits: number }>("get_totals", {});
  getBounty = (repo_id: number, issue: number) => this.view<string>("get_bounty", { repo_id, issue });

  registerRepo = (repo_id: number) => this.call("register_repo", { repo_id, policy: null }, 30n);
  linkRepo = (repo_id: number, payout: string) => this.call("link_repo", { repo_id, payout }, 30n);
  settle = (repo_id: number, number: number, verdict: Verdict, verdict_hash: string) =>
    this.call("settle", { repo_id, number, verdict, verdict_hash }, 150n);
  markReviewed = (repo_id: number, number: number) => this.call("mark_reviewed", { repo_id, number }, 30n);
  payBounty = (repo_id: number, issue: number, recipient: string) => this.call("pay_bounty", { repo_id, issue, recipient }, 100n);
  finalize = (repo_id: number, number: number) => this.call("finalize", { repo_id, number }, 150n);
  resolveChallenge = (repo_id: number, number: number, verdict: Verdict, verdict_hash: string) =>
    this.call("resolve_challenge", { repo_id, number, verdict, verdict_hash }, 200n);
}

/** 2_500_000 → "2.50" (USDC, 6 decimals) */
export function usd(units: string | bigint | number): string {
  const n = BigInt(units);
  const cents = (n + 5_000n) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
