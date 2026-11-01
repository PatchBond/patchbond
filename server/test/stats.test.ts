// The public /api/stats numbers: outcomes, measured cost and time to verdict come from the stored
// signed records, not estimates.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerdictRecord } from "@patchbond/shared";
import { Store, verdictCost } from "../src/store";

const example = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "../../docs/eval/examples", name), "utf8")).record as VerdictRecord;

describe("stats", () => {
  test("cost per verdict is measured from the signed response's token usage", () => {
    const r = example("refund-commander-2636.json");
    expect(verdictCost(r.model, r.response_body)).toBeCloseTo(0.00025272, 8);
    expect(verdictCost("some/unpriced-model", r.response_body)).toBeNull();
    expect(verdictCost(r.model, "not json")).toBeNull();
  });

  test("outcomes, cost and time to verdict count only live (signed) records", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "pb-stats-")));
    const refund = example("refund-commander-2636.json");
    const human = example("to-a-human-gmscore-3922-bounty.json");
    store.saveVerdict(refund);
    store.saveVerdict(human);
    store.saveVerdict({ ...refund, id: "mock1", mock: true });
    const seen = Date.parse(refund.created_at) - 4 * 60_000;
    store.upsertSubmission({ repo_id: refund.repo.id, number: refund.number, full_name: refund.repo.full_name, installation_id: 1, author: refund.author, head_sha: "h", check_run_id: null, comment_id: null, state: "judged", verdict_id: refund.id, deposit_seen_at: seen });

    const s = store.stats();
    expect(s.verdicts_live).toBe(2);
    expect(s.verdicts).toEqual({ refund: 1, forfeit: 0, needs_human: 1, in_enclave: 0 });
    expect(s.cost_per_verdict_usd).toBeCloseTo((0.00025272 + 0.00014962) / 2, 8);
    expect(s.median_minutes_to_verdict).toBeCloseTo(4, 5);
    expect(s).toMatchObject({ disputes: 0, sealed_reports: 0, linked_repos: 0, prs: 1 });
  });
});
