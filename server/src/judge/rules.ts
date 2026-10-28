// Server rules applied after the model (JUDGE.md). The model can't override them.
// Each rule only ever moves a verdict toward "needs_human" — never toward forfeit.

import type { Facts, ModelVerdict, VerdictRecord } from "@patchbond/shared";
import { DEFAULT_RULES, type RepoRules } from "./facts";

export interface RuleInput {
  model: ModelVerdict | null;
  facts: Facts;
  /** Repo's forfeit threshold, 0..1 (policy forfeit_threshold_bps / 10_000). */
  threshold: number;
  rules?: RepoRules;
}

/** Hard facts the server established itself. Without one, the model can't forfeit on its own. */
export function hardFacts(facts: Facts, rules: RepoRules = DEFAULT_RULES): string[] {
  const out: string[] = [];
  if (facts.ci === "failure") out.push("failing CI");
  if (facts.phantom_symbols.length) out.push("phantom code");
  if (facts.duplicate_of) out.push("duplicate");
  if (facts.injection_markers.length) out.push("prompt injection");
  if (facts.unbacked_claims.length) out.push("claims not in the diff");
  if (rules.unassignedEffect === "evidence" && (facts.assignment === "assigned_to_other" || facts.assignment === "unassigned")) out.push("issue not assigned to the author");
  return out;
}

export function applyRules({ model, facts, threshold, rules }: RuleInput): VerdictRecord["final"] {
  if (!model) {
    return {
      verdict: "needs_human", confidence: 0, category: "ok",
      reasons: ["The judge's answer wasn't valid; a maintainer decides."],
      evidence: [], rules_applied: ["Invalid model output → needs_human"],
    };
  }
  const applied: string[] = [];
  let verdict = model.verdict;

  if (verdict === "forfeit") {
    if (model.confidence < threshold) {
      verdict = "needs_human";
      applied.push(`Confidence ${model.confidence} is below the repo's forfeit threshold ${threshold} → needs_human`);
    } else if (model.evidence.length === 0) {
      verdict = "needs_human";
      applied.push("A forfeit needs at least one concrete piece of evidence → needs_human");
    } else if (hardFacts(facts, rules).length === 0) {
      verdict = "needs_human";
      applied.push("No hard fact (failing CI, phantom code, duplicate, injection, claims missing from the diff, or an issue assigned to someone else) → the model can't forfeit on its own → needs_human");
    } else if (facts.author_reputation === "proven") {
      verdict = "needs_human";
      applied.push("Proven contributor (prior refunds, no forfeits) → a forfeit goes to a human");
    }
  }
  return {
    verdict,
    confidence: model.confidence,
    category: model.category,
    reasons: model.reasons,
    evidence: model.evidence,
    rules_applied: applied,
  };
}
