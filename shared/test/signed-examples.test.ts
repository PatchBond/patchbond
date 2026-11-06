// The verifier the web app's "Verify signature" button runs, on real records NEAR AI signed (not the
// test key the other tests make up): each passes every check, and a one-character change fails.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyRecord, type VerdictRecord } from "../src";

const DIR = join(import.meta.dir, "../../docs/eval/examples");
/** NEAR AI's GLM-5.3-flash enclave key, as registered on the live contract (`get_tee_signers`). */
const GLM_KEY = "0x3b753b4406613c5e70ae640508632b600424fa0c";
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
/** Some examples wrap the record with a note (`{ note, record, proof }`), as scripts/verify-record.ts reads them. */
const load = (f: string) => {
  const json = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  return (json.record ?? json) as VerdictRecord;
};

describe("real signed records", () => {
  test("there are examples to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of files) {
    test(`${f} passes every check and is signed by NEAR AI's key`, async () => {
      const r = load(f);
      const checks = await verifyRecord(r);
      expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
      expect(r.signature.signing_address.toLowerCase()).toBe(GLM_KEY);
    });
  }

  test("changing one character of the response breaks the signature check", async () => {
    const r = load(files[0]!);
    const tampered = { ...r, response_body: r.response_body.replace(/"/, "'") };
    const failed = (await verifyRecord(tampered)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("Response bytes match the signature");
  });

  test("a verdict changed after signing doesn't match its on-chain hash", async () => {
    const r = load(files.find((f) => f.includes("forfeit"))!);
    const flipped = { ...r, final: { ...r.final, verdict: "refund" as const } };
    const failed = (await verifyRecord(flipped)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("On-chain hash matches this record");
  });
});
