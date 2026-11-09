// A verdict record is what one model said; the outcome is what the contract did with the deposit.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outcomeOf } from "../src/outcomes";
import { Store } from "../src/store";

test("a settled deposit's outcome names the re-judge record that decided it, and is cached", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "pb-o-")));
  const base = { repo_id: 7, number: 56, full_name: "a/b", installation_id: 1, author: "x", head_sha: "h", check_run_id: null, comment_id: null, verdict_id: null, deposit_seen_at: null };
  const rejudgeHash = "cd7b4a9aedc92cc9" + "0".repeat(48);
  store.saveVerdict({ id: rejudgeHash.slice(0, 16), verdict_hash: rejudgeHash, repo: { id: 7, full_name: "a/b" }, number: 56, final: { verdict: "needs_human" }, created_at: 1 } as never);
  let calls = 0;
  const chain = {
    getDeposit: async () => {
      calls++;
      return { status: { settled: { verdict: "forfeit", at: 1000 } }, verdict_hash: rejudgeHash };
    },
  };
  store.upsertSubmission({ ...base, state: "judged" });
  expect(await outcomeOf(store, chain, 7, 56)).toBeNull(); // not settled yet: no chain call
  expect(calls).toBe(0);
  store.setState(7, 56, "settled");
  const out = await outcomeOf(store, chain, 7, 56);
  expect(out).toEqual({ verdict: "forfeit", at: 1000, verdict_hash: rejudgeHash, decided_by: "cd7b4a9aedc92cc9" });
  await outcomeOf(store, chain, 7, 56);
  expect(calls).toBe(1); // cached
});
