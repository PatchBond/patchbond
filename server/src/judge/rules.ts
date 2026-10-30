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
/** Below this the model's refund isn't trusted to be automatic. */
export const REFUND_CONFIDENCE = 0.8;

export function hardFacts(facts: Facts, rules: RepoRules = DEFAULT_RULES): string[] {
  const out: string[] = [];
  if (facts.ci === "failure") out.push("failing CI");
  if (facts.phantom_symbols.length) out.push("phantom code");
  if (facts.duplicate_of) out.push("duplicate");
  if (facts.injection_markers.length) out.push("prompt injection");
  if (facts.unbacked_claims.length) out.push("claims not in the diff");
  if (facts.malicious?.some((f) => f.severity === "high")) out.push("malicious code");
  // A PR that changes nothing can't deliver what it claims (first seen live: an empty PR "fixing" an issue).
  if (facts.files_changed === 0 || facts.additions + facts.deletions === 0) out.push("empty change");
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
  let confidence = model.confidence;
  let category = model.category;
  let reasons = model.reasons;
  let evidence = model.evidence;

  if (verdict === "forfeit") {
    if (model.confidence < threshold) {
      verdict = "needs_human";
      applied.push(`Confidence ${model.confidence} is below the repo's forfeit threshold ${threshold} → needs_human`);
    } else if (model.evidence.length === 0) {
      verdict = "needs_human";
      applied.push("A forfeit needs at least one concrete piece of evidence → needs_human");
    } else if (hardFacts(facts, rules).length === 0) {
      verdict = "needs_human";
      applied.push("No hard fact (failing CI, phantom code, duplicate, injection, malicious code, claims missing from the diff, an empty change, or an issue assigned to someone else) → the model can't forfeit on its own → needs_human");
    } else if (facts.author_reputation === "proven") {
      verdict = "needs_human";
      applied.push("Proven contributor (prior refunds, no forfeits) → a forfeit goes to a human");
    }
  }
  // A refund is automatic only when it's clear-cut. Failing CI, or a hesitant model, sends it to a
  // maintainer instead (still refunded after the needs-human timeout if nobody decides). On the
  // labelled set this routes most "AI slop" to a human and almost no good PR (docs/JUDGE.md).
  if (verdict === "refund" && facts.ci === "failure") {
    verdict = "needs_human";
    applied.push(`CI is failing (${facts.ci_failed_checks.slice(0, 3).join(", ")}) → a refund isn't automatic; a maintainer decides`);
  } else if (verdict === "refund" && confidence < REFUND_CONFIDENCE) {
    verdict = "needs_human";
    applied.push(`Refund confidence ${confidence} is below ${REFUND_CONFIDENCE} → a maintainer decides`);
  }

  // Malicious code is decided by the deterministic scan, not by whether the model noticed. The
  // forfeit is still only proposed: the contributor can challenge it in the window.
  const high = (facts.malicious ?? []).filter((f) => f.severity === "high");
  const medium = (facts.malicious ?? []).filter((f) => f.severity === "medium");
  if (high.length && verdict !== "forfeit") {
    if (facts.author_reputation === "proven") {
      verdict = "needs_human";
      applied.push(`Malicious pattern (${high[0]!.rule}) from a proven contributor → a human decides`);
    } else {
      verdict = "forfeit";
      confidence = Math.max(confidence, 0.9);
      category = "malicious";
      reasons = [`Malicious code: ${high.map((f) => `${f.rule} in ${f.file}`).join("; ")}.`, ...reasons].slice(0, 5);
      evidence = [...high.map((f) => ({ file: f.file, line: null, note: `${f.rule}: ${f.excerpt}` })), ...evidence].slice(0, 10);
      applied.push(`Malicious pattern found by the server's scan (${high.map((f) => f.rule).join(", ")}) → forfeit proposed; the contributor can challenge it`);
    }
  } else if (medium.length && verdict === "refund") {
    verdict = "needs_human";
    applied.push(`Risky change (${medium.map((f) => f.rule).join(", ")}) → a human looks before the bond is refunded`);
  }
  return {
    verdict,
    confidence,
    category,
    reasons,
    evidence,
    rules_applied: applied,
  };
}
