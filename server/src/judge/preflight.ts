// Pre-flight: the judge's deterministic facts, read back as advice *before* anyone pays a bond.
// Free (no model call). Agents use it through the MCP server to fix their PR first.

import type { Facts } from "@patchbond/shared";

export type Risk = "low" | "medium" | "high";

export interface Preflight {
  risk: Risk;
  /** What would likely happen if judged now. */
  likely: "refund" | "needs_human" | "forfeit";
  warnings: string[];
  facts: Facts;
}

export function preflight(facts: Facts): Preflight {
  const high: string[] = [];
  const medium: string[] = [];
  if (facts.injection_markers.length) {
    high.push(`The PR text tries to instruct the judge ("${facts.injection_markers[0]}"). Remove it — it counts as bad faith.`);
  }
  if (facts.phantom_symbols.length) {
    high.push(`Calls ${facts.phantom_symbols.join(", ")}, which the repository doesn't define. Check the names against the base branch.`);
  }
  for (const c of facts.unbacked_claims) {
    high.push(`Your description says "${c.claim.slice(0, 90)}", but the diff has no ${c.missing.join(", ")}. Make the change or fix the description.`);
  }
  if (facts.assignment === "assigned_to_other") {
    high.push(`Issue #${facts.issue?.number} is assigned to ${facts.issue?.assignees?.join(", ")}. This repo requires assignment — ask a maintainer before opening a PR.`);
  }
  if (facts.assignment === "unassigned") {
    medium.push(`Issue #${facts.issue?.number} isn't assigned to you, and this repo requires assignment. Ask to be assigned first.`);
  }
  if (facts.issue && !facts.issue.exists) {
    medium.push(`References issue #${facts.issue.number}, which doesn't exist.`);
  }
  if (facts.issue && facts.issue.exists && !facts.issue.open) {
    medium.push(`Issue #${facts.issue.number} is already closed.`);
  }
  if (facts.duplicate_of) {
    medium.push(`Looks like a duplicate of #${facts.duplicate_of.number} "${facts.duplicate_of.title}" (${Math.round(facts.duplicate_of.similarity * 100)}% similar).`);
  }
  if (facts.ci === "failure") {
    medium.push(`CI is failing: ${facts.ci_failed_checks.join(", ")}. Fix it before paying — the judge reads CI.`);
  }
  if (facts.ci === "pending") {
    medium.push("CI is still running; check again when it finishes.");
  }
  if (facts.unresolved_symbols.length) {
    medium.push(`Couldn't find ${facts.unresolved_symbols.slice(0, 5).join(", ")} in the repo — fine if they come from a library.`);
  }
  const risk: Risk = high.length ? "high" : medium.length ? "medium" : "low";
  return {
    risk,
    likely: high.length ? "forfeit" : medium.length ? "needs_human" : "refund",
    warnings: [...high, ...medium],
    facts,
  };
}
