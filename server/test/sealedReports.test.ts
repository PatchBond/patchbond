// Sealed reports: the server keeps ciphertext and the enclave's public record only, and publishes
// that record only once it verifies and the chain confirms its verdict hash.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { verdictHash } from "@patchbond/shared";
import { Store, type SealedRecord } from "../src/store";
import { TeeRecords } from "../src/teeRecords";

describe("sealed reports", () => {
  test("numbered above the PR range; a genuine record is saved once the chain confirms it, a forged one never", async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "pb-rep-")));
    const n1 = store.addReport({ repo_id: 7, sealed: '{"v":1}', sha256: "aa", reporter: "alice" }, 1e12);
    const n2 = store.addReport({ repo_id: 7, sealed: '{"v":1,"x":2}', sha256: "bb", reporter: "bob" }, 1e12);
    expect([n1, n2]).toEqual([1e12, 1e12 + 1]);

    const key = privateKeyToAccount(generatePrivateKey());
    const text = `z-ai/glm-5.3-flash:${"a".repeat(64)}:${"b".repeat(64)}`;
    const signature = { text, signature: await key.signMessage({ message: text }), signing_address: key.address, signing_algo: "ecdsa" };
    const final = { verdict: "forfeit" as const, category: "phantom_code", confidence: 0.9 };
    const vh = verdictHash({ repo: { id: 7, full_name: "a/b" }, number: n1, signature, final } as never);
    const record: SealedRecord = { kind: "report", runner: "outlayer-tdx", id: vh.slice(0, 16), repo: { id: 7, full_name: "a/b" }, number: n1, model: "z-ai/glm-5.3-flash", signature, verdict_hash: vh, final, sealed_for_maintainer: { v: 1 }, created_at: "now" };

    let job: { state: "requested" | "judged"; verdict_hash: string | null } | null = { state: "requested", verdict_hash: null };
    const tee = new TeeRecords({ getTeeSigners: async () => [key.address.toLowerCase()], getTeeJob: async () => job }, store, () => {}, 20);
    expect(await tee.accept({ ...record, final: { ...final, verdict: "refund" } })).toContain("verdict hash");
    expect(await tee.accept({ ...record, number: 999 })).toContain("No such sealed report");
    expect(await tee.accept(record)).toBeNull();
    expect(store.report(7, n1)!.record).toBeNull(); // held until the chain says so
    job = { state: "judged", verdict_hash: vh };
    await Bun.sleep(80);
    expect(store.report(7, n1)!.record?.final.verdict).toBe("forfeit");
  });
});
