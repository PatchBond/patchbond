// What actually happened to a deposit, next to the verdicts about it. A verdict record is what one
// model said; the outcome is what the contract did (a maintainer's forfeit upheld by a re-judge, a
// maintainer's refund, a challenge…). Settled deposits never change, so outcomes are cached.

import type { Store } from "./store";

export interface Outcome {
  verdict: string;
  at: number;
  /** The verdict hash the contract settled with. */
  verdict_hash: string | null;
  /** The stored verdict record with that hash (e.g. the re-judge), when we have it. */
  decided_by: string | null;
}

type DepositView = { status: unknown; verdict_hash?: string | null } | null | undefined;

export async function outcomeOf(
  store: Store,
  chain: { getDeposit: (repoId: number, number: number) => Promise<DepositView> },
  repoId: number,
  number: number,
): Promise<Outcome | null> {
  const cached = store.outcome(repoId, number);
  if (cached) return cached;
  // Only PRs the bot has seen settle are looked up, so lists don't hit the chain for every row.
  if (store.submission(repoId, number)?.state !== "settled") return null;
  const d = await chain.getDeposit(repoId, number).catch(() => null);
  const s = d?.status as { settled?: { verdict: string; at: number } } | undefined;
  if (!d || typeof s !== "object" || !s?.settled) return null;
  const hash = d.verdict_hash ?? null;
  const decided = hash ? store.verdict(hash.slice(0, 16)) : null;
  const out: Outcome = { verdict: s.settled.verdict, at: s.settled.at, verdict_hash: hash, decided_by: decided?.verdict_hash === hash ? decided.id : null };
  store.saveOutcome(repoId, number, out);
  return out;
}
