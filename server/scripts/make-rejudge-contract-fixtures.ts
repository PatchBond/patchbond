// Fixtures for contract/vault/tests/rejudge.rs: what the enclave prints for a re-judge, signed the way
// NEAR AI's gateway signs Kimi K3 (`<sha256(request)>:<sha256(response)>`), by a throwaway key the
// test registers for that model only.
//   cd server && bun scripts/make-rejudge-contract-fixtures.ts
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "@patchbond/shared";

const MODEL = "moonshotai/kimi-k3";
const key = privateKeyToAccount(generatePrivateKey());

async function output(tag: string, fields: { verdict: string; model_verdict: string; confidence_bps: number; evidence: number }, model = MODEL) {
  const request_sha256 = sha256Hex(`rejudge request ${tag}`);
  const response_sha256 = sha256Hex(`rejudge response ${tag}`);
  const signature = await key.signMessage({ message: `${request_sha256}:${response_sha256}` });
  return { status: "judged", ...fields, model, request_sha256, response_sha256, signature };
}

const fixtures = {
  note: "Synthetic re-judge outputs, gateway-signed by test_signer (register it as `<test_signer>@moonshotai/kimi-k3`).",
  model: MODEL,
  test_signer: key.address.toLowerCase(),
  // The stronger model signed a forfeit, but the rules found no hard fact: final verdict needs_human.
  model_forfeit_no_hard_fact: await output("a", { verdict: "needs_human", model_verdict: "forfeit", confidence_bps: 9700, evidence: 1 }),
  refund: await output("b", { verdict: "refund", model_verdict: "refund", confidence_bps: 9000, evidence: 0 }),
  full_forfeit: await output("c", { verdict: "forfeit", model_verdict: "forfeit", confidence_bps: 9500, evidence: 2 }),
  // The same key, but the enclave says it asked another model: the key isn't registered for it.
  other_model: await output("d", { verdict: "forfeit", model_verdict: "forfeit", confidence_bps: 9500, evidence: 2 }, "z-ai/glm-5.3-flash"),
};
const path = join(resolve(import.meta.dir, "../.."), "contract/vault/tests/fixtures/rejudge.json");
writeFileSync(path, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`→ ${path}`);
