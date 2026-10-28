import { describe, expect, test } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sha256Hex, verdictHash, verifyRecord, type VerdictRecord } from "../src";

const signer = privateKeyToAccount(generatePrivateKey());
const MODEL = "z-ai/glm-5.3-flash";

async function record(): Promise<VerdictRecord> {
  const request_body = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "diff…" }] });
  const verdict = { verdict: "forfeit", confidence: 0.93, category: "phantom_code", reasons: ["calls parseFoo(), which does not exist"], evidence: [{ file: "src/x.ts", line: 4, note: "parseFoo" }] } as const;
  const response_body = JSON.stringify({ id: "chat-1", choices: [{ message: { role: "assistant", content: JSON.stringify(verdict) } }] });
  const text = `${MODEL}:${sha256Hex(request_body)}:${sha256Hex(response_body)}`;
  const r: VerdictRecord = {
    id: "v1",
    repo: { id: 101, full_name: "PatchBond/demo" },
    number: 7,
    kind: "pr",
    author: "slopbot",
    created_at: new Date(0).toISOString(),
    model: MODEL,
    chat_id: "chat-1",
    request_body,
    response_body,
    signature: { text, signature: await signer.signMessage({ message: text }), signing_address: signer.address, signing_algo: "ecdsa" },
    facts: { ci: "failure", ci_failed_checks: ["build"], phantom_symbols: ["parseFoo"], duplicate_of: null, issue: null, files_changed: 1, additions: 3, deletions: 0, injection_markers: [], author_reputation: "new" },
    model_verdict: { ...verdict, reasons: [...verdict.reasons], evidence: [...verdict.evidence] },
    final: { verdict: "forfeit", confidence: 0.93, category: "phantom_code", reasons: [...verdict.reasons], evidence: [...verdict.evidence], rules_applied: [] },
    verdict_hash: "",
    mock: true,
  };
  r.verdict_hash = verdictHash(r);
  return r;
}

describe("verifyRecord", () => {
  test("an untouched record passes every check", async () => {
    const checks = await verifyRecord(await record());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBe(6);
  });

  test("an edited response is caught", async () => {
    const r = await record();
    r.response_body = r.response_body.replace("forfeit", "refund");
    const failed = (await verifyRecord(r)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("Response bytes match the signature");
  });

  test("a different signer is caught", async () => {
    const r = await record();
    r.signature.signing_address = privateKeyToAccount(generatePrivateKey()).address;
    const failed = (await verifyRecord(r)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(["Signature recovers to the signing address"]);
  });

  test("a changed final verdict no longer matches the on-chain hash", async () => {
    const r = await record();
    r.final.verdict = "refund";
    const failed = (await verifyRecord(r)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(["On-chain hash matches this record"]);
  });
});
