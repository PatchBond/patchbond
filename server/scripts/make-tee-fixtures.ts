// Builds contract/vault/tests/fixtures/tee.json for the TEE-proof sandbox tests: one genuine NEAR AI Cloud signature from a live
// model-enclave verdict and one genuine gateway-signed verdict (server/data), and synthetic ones from a
// throwaway key for every accept/reject path.
//   cd server && bun scripts/make-tee-fixtures.ts <live GLM verdict id> <live Kimi verdict id>
//   cd server && bun scripts/make-tee-fixtures.ts            # keep the two live ones, re-sign the rest
// Synthetic requests name the sandbox tests' repo ("acme/widget") and PR #1, as the contract requires.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const db = new Database(join(import.meta.dir, "../data/patchbond.sqlite"), { readonly: true });
function record(id: string) {
  const row = db.query<{ record: string }, [string]>("SELECT record FROM verdicts WHERE id = ?").get(id);
  if (!row) throw new Error(`no verdict ${id}`);
  const r = JSON.parse(row.record);
  if (r.mock) throw new Error("pick a live (TEE-signed) verdict");
  return r;
}
const out = join(import.meta.dir, "../../contract/vault/tests/fixtures/tee.json");
const previous = process.argv[2] ? null : JSON.parse(readFileSync(out, "utf8"));
const live = previous ? null : record(process.argv[2]!);
const kimi = previous ? null : record(process.argv[3]!);

const key = privateKeyToAccount(generatePrivateKey());
const model = "z-ai/glm-5.3-flash";
/** A judge request about acme/widget PR #1, shaped like the real prompt (server/src/judge/prompt.ts). */
const ask = (m: string) =>
  JSON.stringify({ model: m, temperature: 0, messages: [{ role: "system", content: "judge" }, { role: "user", content: '<repo name="acme/widget" policy="default">\n(no CONTRIBUTING.md)\n</repo>\n<facts>{}</facts>\n<contribution kind="pr" number="1" author_reputation="new">\nTitle: x\n</contribution>' }] });
const request = ask(model);
async function synthetic(answer: object) {
  const response = JSON.stringify({ id: "chat-test", choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }] });
  const text = `${model}:${sha(request)}:${sha(response)}`;
  return { model, request_sha256: sha(request), response, request, signature: await key.signMessage({ message: text }) };
}
/** Gateway-style: `<sha256(request)>:<sha256(response)>`, with the request bytes attached. */
async function gateway(answer: object, asked: string, claimed = asked) {
  const req = ask(asked);
  const response = JSON.stringify({ id: "chat-gw", choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }] });
  return { model: claimed, request_sha256: sha(req), response, request: req, signature: await key.signMessage({ message: `${sha(req)}:${sha(response)}` }) };
}
const forfeit = { verdict: "forfeit", confidence: 0.93, category: "phantom_code", reasons: ["Calls a function that doesn't exist."], evidence: [{ file: "src/a.c", line: 3, note: "pcap_magic() is not defined" }] };

writeFileSync(
  out,
  JSON.stringify(
    {
      note: "live: a genuine NEAR AI Cloud TEE signature (a refund). Others: synthetic, signed by test_signer.",
      live: previous?.live ?? { signer: live.signature.signing_address.toLowerCase(), proof: { model: live.model, request_sha256: sha(live.request_body), response: live.response_body, request: null, signature: live.signature.signature } },
      live_gateway: previous?.live_gateway ?? { signer: kimi.signature.signing_address.toLowerCase(), proof: { model: kimi.model, request_sha256: sha(kimi.request_body), response: kimi.response_body, request: kimi.request_body, signature: kimi.signature.signature } },
      test_signer: key.address.toLowerCase(),
      forfeit: await synthetic(forfeit),
      low_confidence: await synthetic({ ...forfeit, confidence: 0.6 }),
      no_evidence: await synthetic({ ...forfeit, evidence: [] }),
      gateway_forfeit: await gateway(forfeit, "moonshotai/kimi-k3"),
      gateway_other_model: await gateway(forfeit, "anthropic/claude-fable-5"),
      gateway_model_mismatch: await gateway(forfeit, "anthropic/claude-fable-5", "moonshotai/kimi-k3"),
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote tee.json");
