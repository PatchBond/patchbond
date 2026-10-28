// Server rules applied after the model (JUDGE.md). The model can't override them.
// Each rule only ever moves a verdict toward "needs_human" — never toward forfeit.

import type { Facts, ModelVerdict, VerdictRecord } from "@patchbond/shared";

export interface RuleInput {
  model: ModelVerdict | null;
  facts: Facts;
  /** Repo's forfeit threshold, 0..1 (policy forfeit_threshold_bps / 10_000). */
  threshold: number;
}

export function applyRules({ model, facts, threshold }: RuleInput): VerdictRecord["final"] {
  if (!model) {
    return {
      verdict: "needs_human", confidence: 0, category: "ok",
      reasons: ["The judge's answer wasn't valid; a maintainer decides."],
      evidence: [], rules_applied: ["Invalid model output → needs_human"],
    };
  }
  const rules: string[] = [];
  let verdict = model.verdict;

  if (verdict === "forfeit") {
    if (model.confidence < threshold) {
      verdict = "needs_human";
      rules.push(`Confidence ${model.confidence} is below the repo's forfeit threshold ${threshold} → needs_human`);
    } else if (model.evidence.length === 0) {
      verdict = "needs_human";
      rules.push("A forfeit needs at least one concrete piece of evidence → needs_human");
    } else if (
      facts.ci === "success" &&
      facts.phantom_symbols.length === 0 &&
      !facts.duplicate_of &&
      facts.injection_markers.length === 0
    ) {
      verdict = "needs_human";
      rules.push("CI passed, no phantom symbols, no duplicate → the model can't forfeit on its own → needs_human");
    } else if (facts.author_reputation === "proven") {
      verdict = "needs_human";
      rules.push("Proven contributor (prior refunds, no forfeits) → a forfeit goes to a human");
    }
  }
  return {
    verdict,
    confidence: model.confidence,
    category: model.category,
    reasons: model.reasons,
    evidence: model.evidence,
    rules_applied: rules,
  };
}
