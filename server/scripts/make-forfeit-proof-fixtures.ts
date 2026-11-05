// Fixtures for contract/vault/tests/screening.rs: enclave answers with the exact request and response
// bytes behind them, so the contract's second step (confirm_tee_forfeit) can read what was signed.
// All synthetic, signed by throwaway keys.
//   bun server/scripts/make-forfeit-proof-fixtures.ts
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "@patchbond/shared";

const ROOT = resolve(import.meta.dir, "../..");
const MODEL = "z-ai/glm-5.3-flash";
const REJUDGE_MODEL = "moonshotai/kimi-k3";
const REPO = "acme/widget";
const enclaveKey = privateKeyToAccount(generatePrivateKey());
const gatewayKey = privateKeyToAccount(generatePrivateKey());

function bytes(model: string, number: number, answer: { verdict: string; confidence: number; evidence: string[] }) {
  const user = `<repo name="${REPO}" policy="default">\n(no CONTRIBUTING.md)\n</repo>\n<facts>{"ci":"failure"}</facts>\n<contribution kind="pr" number="${number}" author_reputation="new">\nbody\n</contribution>`;
  const request = JSON.stringify({ model, messages: [{ role: "system", content: "judge" }, { role: "user", content: user }] });
  const response = JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }] });
  return { request, response, request_sha256: sha256Hex(request), response_sha256: sha256Hex(response) };
}

/** What the enclave prints, and the proof anyone can post afterwards. `label` is what the worker claims. */
async function run(number: number, signedVerdict: string, label = signedVerdict, gateway = false) {
  const model = gateway ? REJUDGE_MODEL : MODEL;
  const b = bytes(model, number, { verdict: signedVerdict, confidence: 0.95, evidence: ["CI fails on every target"] });
  const signature = gateway
    ? await gatewayKey.signMessage({ message: `${b.request_sha256}:${b.response_sha256}` })
    : await enclaveKey.signMessage({ message: `${model}:${b.request_sha256}:${b.response_sha256}` });
  return {
    output: { status: "judged", verdict: label, model_verdict: label, confidence_bps: 9500, evidence: 1, model, request_sha256: b.request_sha256, response_sha256: b.response_sha256, signature },
    proof: { model, request_sha256: b.request_sha256, response: b.response, request: b.request, signature },
  };
}

const fixtures = {
  note: "Synthetic, about acme/widget. forfeit: signed forfeits for PRs 1-3. relabelled: NEAR AI signed a refund, the worker reports a forfeit. rejudge: gateway-signed forfeit for PR 4.",
  repo: REPO,
  enclave_signer: enclaveKey.address.toLowerCase(),
  gateway_signer: `${gatewayKey.address.toLowerCase()}@${REJUDGE_MODEL}`,
  forfeit: { 1: await run(1, "forfeit"), 2: await run(2, "forfeit"), 3: await run(3, "forfeit") },
  relabelled: await run(1, "refund", "forfeit"),
  rejudge: await run(4, "forfeit", "forfeit", true),
};
const path = join(ROOT, "contract/vault/tests/fixtures/proofs.json");
writeFileSync(path, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`→ ${path}`);
