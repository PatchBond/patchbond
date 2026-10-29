import { recoverMessageAddress, sha256, stringToBytes, type Hex } from "viem";
import type { VerdictRecord } from "./types";

/** sha256 of a UTF-8 string, as lowercase hex without 0x (the format NEAR AI signs). */
export function sha256Hex(text: string): string {
  return sha256(stringToBytes(text)).slice(2);
}

/**
 * The hash posted on-chain with `settle`. Binds the signed inference (whose text already commits
 * to the exact request and response) to this repo, this PR and the final verdict.
 */
export function verdictHash(r: Pick<VerdictRecord, "repo" | "number" | "signature" | "final">): string {
  return sha256Hex(
    JSON.stringify({
      repo_id: r.repo.id,
      number: r.number,
      signed_text: r.signature.text,
      verdict: r.final.verdict,
    }),
  );
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Re-checks a published verdict from its own bytes — runs in the browser on the verdict page.
 * 1. sha256(request) and sha256(response) match the signed text.
 * 2. The signed text names the model that was used.
 * 3. The EIP-191 signer recovered from the signature is the advertised signing address.
 * 4. The verdict in the response is the one published (before server rules).
 * 5. The on-chain verdict_hash matches this record.
 * Proving that signing address lives in a TEE is the attestation report's job (linked on the page).
 */
export async function verifyRecord(r: VerdictRecord): Promise<Check[]> {
  const checks: Check[] = [];
  const parts = r.signature.text.split(":");
  const [respHash, reqHash] = [parts.pop() ?? "", parts.pop() ?? ""];
  const model = parts.join(":");

  const reqActual = sha256Hex(r.request_body);
  checks.push({
    name: "Request bytes match the signature",
    ok: reqActual === reqHash,
    detail: `sha256(request) = ${reqActual}`,
  });
  const respActual = sha256Hex(r.response_body);
  checks.push({
    name: "Response bytes match the signature",
    ok: respActual === respHash,
    detail: `sha256(response) = ${respActual}`,
  });
  // A model-enclave key names the model in the signed text; NEAR AI's gateway key signs only the two
  // hashes, so the model is the one the (signed) request asked for.
  let asked: string | null = null;
  try {
    asked = JSON.parse(r.request_body)?.model ?? null;
  } catch {
    asked = null;
  }
  checks.push({
    name: "Signed by the stated model",
    ok: model ? model === r.model : asked === r.model,
    detail: model ? `signed text names ${model}` : `gateway-signed; the signed request asks for ${asked ?? "(nothing)"}`,
  });

  let recovered = "";
  try {
    recovered = await recoverMessageAddress({
      message: r.signature.text,
      signature: normaliseSig(r.signature.signature),
    });
  } catch (e) {
    recovered = `error: ${(e as Error).message}`;
  }
  checks.push({
    name: "Signature recovers to the signing address",
    ok: recovered.toLowerCase() === r.signature.signing_address.toLowerCase(),
    detail: `recovered ${recovered}`,
  });

  let inResponse: string | null = null;
  try {
    const body = JSON.parse(r.response_body);
    const content = body?.choices?.[0]?.message?.content;
    inResponse = JSON.parse(stripFences(String(content)))?.verdict ?? null;
  } catch {
    inResponse = null;
  }
  checks.push({
    name: "Model verdict is inside the signed response",
    ok: r.model_verdict === null ? inResponse === null : inResponse === r.model_verdict.verdict,
    detail: `response says ${inResponse ?? "(no valid verdict)"}`,
  });

  const vh = verdictHash(r);
  checks.push({
    name: "On-chain hash matches this record",
    ok: vh === r.verdict_hash,
    detail: `verdict_hash = ${vh}`,
  });
  return checks;
}

function normaliseSig(sig: string): Hex {
  return (sig.startsWith("0x") ? sig : `0x${sig}`) as Hex;
}

/** Models sometimes wrap JSON in ```json fences. */
export function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : s.trim();
}
