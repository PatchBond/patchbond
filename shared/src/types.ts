import { z } from "zod";

/** What the AI judge must return (JUDGE.md). Validated strictly; anything else → needs_human. */
export const ModelVerdict = z
  .object({
    verdict: z.enum(["refund", "forfeit", "needs_human"]),
    confidence: z.number().min(0).max(1),
    category: z.enum([
      "ok",
      "does_not_work",
      "phantom_code",
      "duplicate",
      "off_topic",
      "boilerplate",
      "policy",
      "injection",
    ]),
    reasons: z.array(z.string().max(400)).max(5),
    evidence: z
      .array(
        z.object({
          file: z.string().max(300),
          line: z.number().int().nonnegative().nullable().optional(),
          note: z.string().max(400),
        }),
      )
      .max(10),
  })
  .strict();
export type ModelVerdict = z.infer<typeof ModelVerdict>;

/** Facts the server computes so the model doesn't have to guess (JUDGE.md, "two layers"). */
export interface Facts {
  ci: "success" | "failure" | "pending" | "none";
  ci_failed_checks: string[];
  /** Called names in the project's own namespace (e.g. `pcap_*`) that don't exist: strong evidence. */
  phantom_symbols: string[];
  /** Called names not found in the repo but possibly from a library: a hint, never grounds alone. */
  unresolved_symbols: string[];
  duplicate_of: { number: number; title: string; similarity: number } | null;
  issue: { number: number; exists: boolean; open: boolean; title?: string } | null;
  files_changed: number;
  additions: number;
  deletions: number;
  injection_markers: string[];
  author_reputation: "new" | "proven" | "has_forfeits";
}

/** NEAR AI Cloud's signature object: GET /v1/signature/<chat_id>?signing_algo=ecdsa */
export interface NearAiSignature {
  /** `<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>` */
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
}

export type FinalVerdict = "refund" | "forfeit" | "needs_human";

/** Everything published for one verdict; enough for anyone to re-check it. */
export interface VerdictRecord {
  id: string;
  repo: { id: number; full_name: string };
  number: number;
  kind: "pr" | "issue";
  author: string;
  created_at: string;
  model: string;
  chat_id: string;
  /** Exact bytes sent to / received from NEAR AI Cloud, as UTF-8 strings. */
  request_body: string;
  response_body: string;
  signature: NearAiSignature;
  facts: Facts;
  /** Parsed model output, or null if it wasn't valid JSON for the schema. */
  model_verdict: ModelVerdict | null;
  final: {
    verdict: FinalVerdict;
    confidence: number;
    category: ModelVerdict["category"];
    reasons: string[];
    evidence: ModelVerdict["evidence"];
    /** Server rules that changed the model's verdict, in plain words. */
    rules_applied: string[];
  };
  /** sha256 hex posted on-chain with `settle`; see `verdictHash`. */
  verdict_hash: string;
  /**
   * True when the response came from a recorded/mock signer instead of NEAR AI's TEE
   * (used until the NEAR AI account has credits). The verdict page says so loudly.
   */
  mock: boolean;
}
