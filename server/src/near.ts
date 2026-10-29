// The vault contract, from the oracle's side: views for anyone, calls signed with the oracle key.

import { sha256Hex, type Currency, type VerdictRecord } from "@patchbond/shared";
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
  /** What bonds, tips and the vault are in. */
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
}

const TGAS = 1_000_000_000_000n;

/** Mirrors `Policy::default()` in contract/vault/src/types.rs. */
const DEFAULT_POLICY: Repo["policy"] = {
  enabled: true, base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8,
  review_window_sec: 259_200, challenge_window_sec: 259_200, forfeit_threshold_bps: 8_500,
};

/** What the contract needs to verify a NEAR AI TEE signature on its own (contract/vault/src/tee.rs). */
export interface TeeProof {
  model: string;
  request_sha256: string;
  response: string;
  /** Only for gateway-signed answers: the contract reads the model from the request. */
  request: string | null;
  signature: string;
}

export function teeProof(r: VerdictRecord): TeeProof {
  const gateway = r.signature.signature_kind === "gateway";
  return { model: r.model, request_sha256: sha256Hex(r.request_body), response: r.response_body, request: gateway ? r.request_body : null, signature: r.signature.signature };
}

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

  // Installing the App never starts charging anyone: a new repo starts off, and the maintainer turns
  // bonds on from the dashboard once they've linked a payout account.
  registerRepo = (repo_id: number) => this.call("register_repo", { repo_id, policy: { ...DEFAULT_POLICY, enabled: false } }, 30n);
  setPolicy = (repo_id: number, policy: Repo["policy"]) => this.call("set_policy", { repo_id, policy }, 30n);
  linkRepo = (repo_id: number, payout: string) => this.call("link_repo", { repo_id, payout }, 30n);
  /** `proof` lets the contract check NEAR AI's TEE signature on a forfeit itself (see teeProof). */
  settle = (repo_id: number, number: number, verdict: Verdict, verdict_hash: string, proof?: TeeProof) =>
    this.call("settle", { repo_id, number, verdict, verdict_hash, proof: proof ?? null }, 150n);
  markReviewed = (repo_id: number, number: number) => this.call("mark_reviewed", { repo_id, number }, 30n);
  payBounty = (repo_id: number, issue: number, recipient: string) => this.call("pay_bounty", { repo_id, issue, recipient }, 100n);
  finalize = (repo_id: number, number: number) => this.call("finalize", { repo_id, number }, 150n);
  resolveChallenge = (repo_id: number, number: number, verdict: Verdict, verdict_hash: string, proof?: TeeProof) =>
    this.call("resolve_challenge", { repo_id, number, verdict, verdict_hash, proof: proof ?? null }, 200n);
}

