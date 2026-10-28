// NEAR AI Cloud verifiable inference. We keep the exact request and response bytes and fetch the
// TEE signature over `<model>:<sha256(request)>:<sha256(response)>` (RESEARCH.md, JUDGE.md).
//
// MockInference stands in while the NEAR AI account has no credits (HTTP 402). It produces the same
// record shape, signed EIP-191 by a local dev key, and every record it makes is marked `mock: true`
// and names the model "patchbond-mock-judge" — it can never pass for a TEE verdict.

import { sha256Hex, stripFences, type Facts, type NearAiSignature } from "@patchbond/shared";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

export interface Inference {
  /** Model id that the signed text names. */
  readonly model: string;
  readonly mock: boolean;
  run(requestBody: string): Promise<{ chat_id: string; response_body: string; signature: NearAiSignature }>;
}

export class NearAiInference implements Inference {
  readonly mock = false;
  constructor(
    readonly model: string,
    private apiKey: string,
    private base = "https://cloud-api.near.ai/v1",
  ) {}

  async run(requestBody: string) {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        // Pin the exact model: no silent aliasing to another one.
        "x-no-aliasing": "true",
      },
      body: requestBody,
    });
    const response_body = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 402
          ? " — the NEAR AI account has no spending limit/credits; add credits at https://cloud.near.ai or run with JUDGE_MODE=mock"
          : res.status === 401
            ? " — NEARAI_API_KEY is missing or wrong"
            : "";
      throw new Error(`NEAR AI chat failed: HTTP ${res.status}${hint}: ${response_body.slice(0, 300)}`);
    }
    const chat_id = JSON.parse(response_body).id as string;
    const signature = await this.signature(chat_id);
    return { chat_id, response_body, signature };
  }

  /** The signature can lag the response slightly; retry briefly. */
  private async signature(chatId: string): Promise<NearAiSignature> {
    const url = `${this.base}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(this.model)}&signing_algo=ecdsa`;
    let last = "";
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}` } });
      if (res.ok) return (await res.json()) as NearAiSignature;
      last = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      await Bun.sleep(500 * (i + 1));
    }
    throw new Error(`NEAR AI signature for ${chatId} unavailable (${last})`);
  }
}

export const MOCK_MODEL = "patchbond-mock-judge";

/**
 * Deterministic stand-in judge: decides from the facts block alone, then signs like NEAR AI does.
 * Good enough to exercise the whole pipeline (contract, GitHub, verdict page); not a quality judge.
 */
export class MockInference implements Inference {
  readonly mock = true;
  readonly model = MOCK_MODEL;
  private signer;

  /** `answer` overrides the reply content (tests use it to simulate a misbehaving model). */
  constructor(
    privateKey?: string,
    private answer?: (facts: Partial<Facts>) => string,
  ) {
    this.signer = privateKeyToAccount((privateKey ?? generatePrivateKey()) as Hex);
  }

  get signingAddress() {
    return this.signer.address;
  }

  async run(requestBody: string) {
    const req = JSON.parse(requestBody);
    const user: string = req.messages?.find((m: { role: string }) => m.role === "user")?.content ?? "";
    const facts = JSON.parse(user.match(/<facts>([\s\S]*?)<\/facts>/)?.[1] ?? "{}") as Partial<Facts>;
    const chat_id = `mock-${sha256Hex(requestBody).slice(0, 16)}`;
    const content = this.answer ? this.answer(facts) : JSON.stringify(mockDecide(facts));
    const response_body = JSON.stringify({
      id: chat_id,
      object: "chat.completion",
      model: this.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    });
    const text = `${this.model}:${sha256Hex(requestBody)}:${sha256Hex(response_body)}`;
    const signature: NearAiSignature = {
      text,
      signature: await this.signer.signMessage({ message: text }),
      signing_address: this.signer.address,
      signing_algo: "ecdsa",
      signature_kind: "mock-dev-key",
    };
    return { chat_id, response_body, signature };
  }
}

function mockDecide(f: Partial<Facts>) {
  if (f.injection_markers?.length) {
    return {
      verdict: "forfeit", confidence: 0.95, category: "injection",
      reasons: [`The contribution tries to instruct the judge ("${f.injection_markers[0]}").`],
      evidence: [{ file: "(description)", line: null, note: f.injection_markers[0] }],
    };
  }
  if (f.phantom_symbols?.length) {
    return {
      verdict: "forfeit", confidence: 0.9, category: "phantom_code",
      reasons: [`Calls ${f.phantom_symbols.join(", ")}, which the repository doesn't define.`],
      evidence: f.phantom_symbols.map((s) => ({ file: "(diff)", line: null, note: `${s}() does not exist at the base commit` })),
    };
  }
  if (f.duplicate_of) {
    return {
      verdict: "needs_human", confidence: 0.6, category: "duplicate",
      reasons: [`Looks like a duplicate of #${f.duplicate_of.number} (similarity ${f.duplicate_of.similarity}).`],
      evidence: [],
    };
  }
  if (f.ci === "failure") {
    return {
      verdict: "needs_human", confidence: 0.6, category: "does_not_work",
      reasons: [`CI failed: ${f.ci_failed_checks?.join(", ")}. A human should check whether this change caused it.`],
      evidence: [],
    };
  }
  return { verdict: "refund", confidence: 0.8, category: "ok", reasons: ["No problems found in the facts."], evidence: [] };
}

/** Parses the model's message content; null if it isn't a JSON object. */
export function modelContent(responseBody: string): unknown {
  try {
    const content = JSON.parse(responseBody)?.choices?.[0]?.message?.content;
    return JSON.parse(stripFences(String(content)));
  } catch {
    return null;
  }
}
