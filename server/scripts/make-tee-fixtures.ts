// Builds contract/vault/tests/fixtures/tee.json for the TEE-proof sandbox tests: one genuine NEAR AI Cloud signature from a live
// verdict (server/data), and synthetic ones from a throwaway key for every accept/reject path.
//   cd server && bun scripts/make-tee-fixtures.ts <live verdict id>
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const db = new Database(join(import.meta.dir, "../data/patchbond.sqlite"), { readonly: true });
const row = db.query<{ record: string }, [string]>("SELECT record FROM verdicts WHERE id = ?").get(process.argv[2]!);
if (!row) throw new Error("no such verdict");
const live = JSON.parse(row.record);
if (live.mock) throw new Error("pick a live (TEE-signed) verdict");

const key = privateKeyToAccount(generatePrivateKey());
const model = "z-ai/glm-5.3-flash";
const request = '{"model":"z-ai/glm-5.3-flash","messages":[]}';
async function synthetic(answer: object) {
  const response = JSON.stringify({ id: "chat-test", choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }] });
  const text = `${model}:${sha(request)}:${sha(response)}`;
  return { model, request_sha256: sha(request), response, signature: await key.signMessage({ message: text }) };
}
const forfeit = { verdict: "forfeit", confidence: 0.93, category: "phantom_code", reasons: ["Calls a function that doesn't exist."], evidence: [{ file: "src/a.c", line: 3, note: "pcap_magic() is not defined" }] };

writeFileSync(
  join(import.meta.dir, "../../contract/vault/tests/fixtures/tee.json"),
  JSON.stringify(
    {
      note: "live: a genuine NEAR AI Cloud TEE signature (a refund). Others: synthetic, signed by test_signer.",
      live: { signer: live.signature.signing_address.toLowerCase(), proof: { model: live.model, request_sha256: sha(live.request_body), response: live.response_body, signature: live.signature.signature } },
      test_signer: key.address.toLowerCase(),
      forfeit: await synthetic(forfeit),
      low_confidence: await synthetic({ ...forfeit, confidence: 0.6 }),
      no_evidence: await synthetic({ ...forfeit, evidence: [] }),
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote tee.json; live signer", live.signature.signing_address);
