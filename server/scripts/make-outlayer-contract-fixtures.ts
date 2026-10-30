// Fixtures for contract/vault/tests/outlayer.rs: what the OutLayer enclave program prints, as the
// contract's callback receives it. `genuine` is a real run of outlayer/judge (wasmtime, real NEAR
// AI call, signed by NEAR AI's GLM enclave key); the rest are synthetic, signed by a throwaway key.
//   bun server/scripts/make-outlayer-contract-fixtures.ts <output.json of a real enclave run>
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256Hex, verdictHash } from "@patchbond/shared";

const ROOT = resolve(import.meta.dir, "../..");
const MODEL = "z-ai/glm-5.3-flash";
const genuine = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const key = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

async function output(fields: { verdict: string; model_verdict: string; confidence_bps: number; evidence: number }, signer = key, tag = fields.verdict) {
  const request_sha256 = sha256Hex(`request ${tag} ${fields.model_verdict}`);
  const response_sha256 = sha256Hex(`response ${tag} ${fields.confidence_bps}`);
  const signature = await signer.signMessage({ message: `${MODEL}:${request_sha256}:${response_sha256}` });
  return { status: "judged", ...fields, model: MODEL, request_sha256, response_sha256, signature };
}

const fixtures = {
  note: "genuine: a real outlayer/judge run (tcpdump#1471), signed by NEAR AI's GLM enclave key. Others: synthetic, signed by test_signer (or by a stranger key).",
  model: MODEL,
  genuine_signer: "0x3b753b4406613c5e70ae640508632b600424fa0c",
  genuine,
  /** What the contract must compute for `genuine` once rebound to repo 101 #1. */
  genuine_verdict_hash: verdictHash({
    repo: { id: 101, full_name: "" },
    number: 1,
    signature: { text: `${MODEL}:${genuine.request_sha256}:${genuine.response_sha256}` } as never,
    final: { verdict: genuine.verdict } as never,
  }),
  test_signer: key.address.toLowerCase(),
  forfeit: await output({ verdict: "forfeit", model_verdict: "forfeit", confidence_bps: 9500, evidence: 2 }),
  rules_only_forfeit: await output({ verdict: "forfeit", model_verdict: "refund", confidence_bps: 9000, evidence: 1 }, key, "rules"),
  weak_forfeit: await output({ verdict: "forfeit", model_verdict: "forfeit", confidence_bps: 7000, evidence: 1 }, key, "weak"),
  stranger_forfeit: await output({ verdict: "forfeit", model_verdict: "forfeit", confidence_bps: 9500, evidence: 2 }, other, "stranger"),
};
const path = join(ROOT, "contract/vault/tests/fixtures/outlayer.json");
writeFileSync(path, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`→ ${path}`);
