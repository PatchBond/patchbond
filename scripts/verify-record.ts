// Re-checks a published verdict record offline — the same checks the verdict page runs in the
// browser: the request/response bytes match the signed hashes, the signed text names the model,
// the signature recovers to the signing address, the verdict is inside the signed response, and
// the on-chain verdict hash matches. Compare the signer with NEAR AI's attestation report
// (GET https://cloud-api.near.ai/v1/attestation/report?model=<model>&signing_algo=ecdsa).
//   bun scripts/verify-record.ts docs/eval/examples/constructed-slop-forfeit.json
import { readFileSync } from "node:fs";
import { verifyRecord, type VerdictRecord } from "../shared/src/index";

for (const file of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const r: VerdictRecord = json.record ?? json;
  const checks = await verifyRecord(r);
  console.log(`\n${file}\n  ${r.repo.full_name}#${r.number}: ${r.final.verdict} (model said ${r.model_verdict?.verdict ?? "nothing valid"}) — signed by ${r.signature.signing_address}`);
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}
