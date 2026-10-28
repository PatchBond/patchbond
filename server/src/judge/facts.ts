// Deterministic facts the model must not guess (JUDGE.md, "two layers").
// Pure functions over data the GitHub layer fetched, so they're testable offline.

import type { Facts } from "@patchbond/shared";

export interface CheckRun {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | skipped | timed_out | action_required
}

export interface OpenItem {
  number: number;
  title: string;
  files?: string[];
}

export interface Contribution {
  kind: "pr" | "issue";
  number: number;
  title: string;
  body: string;
  /** Unified diff (PRs only). */
  diff: string;
  files: string[];
  additions: number;
  deletions: number;
}

/** The repo's own CI on the head commit. We never run contributor code. */
export function ciFact(runs: CheckRun[]): Pick<Facts, "ci" | "ci_failed_checks"> {
  // Our own check isn't evidence about the contribution.
  const relevant = runs.filter((r) => !r.name.toLowerCase().startsWith("patchbond"));
  if (relevant.length === 0) return { ci: "none", ci_failed_checks: [] };
  const failed = relevant
    .filter((r) => r.status === "completed" && ["failure", "timed_out", "cancelled"].includes(r.conclusion ?? ""))
    .map((r) => r.name);
  if (failed.length) return { ci: "failure", ci_failed_checks: failed };
  if (relevant.some((r) => r.status !== "completed")) return { ci: "pending", ci_failed_checks: [] };
  return { ci: "success", ci_failed_checks: [] };
}

/** "Fixes #12", "closes #12", "resolves #12" — the issue a PR claims to fix. */
export function linkedIssue(text: string): number | null {
  const m = text.match(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s*#(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

const INJECTION = [
  /ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts?)/i,
  /disregard (?:the |your )?(?:previous |system )?(?:instructions|prompt)/i,
  /you are (?:now )?(?:an? )?(?:ai|assistant|language model|judge|reviewer)\b/i,
  /\bsystem prompt\b/i,
  /(?:return|output|respond with)[^.\n]{0,40}"?verdict"?\s*[:=]?\s*"?refund/i,
  /<\/?(?:contribution|facts|repo|system)>/i,
];

/** Text that tries to instruct the judge — itself evidence of bad faith. */
export function injectionMarkers(c: Contribution): string[] {
  const added = addedLines(c.diff).join("\n");
  const hay = `${c.title}\n${c.body}\n${added}`;
  const found: string[] = [];
  for (const re of INJECTION) {
    const m = hay.match(re);
    if (m) found.push(m[0].slice(0, 80));
  }
  return found;
}

export function addedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/** Common names that are never worth a lookup (keywords, builtins, test helpers). */
const IGNORE = new Set(
  `if for while switch catch return function typeof sizeof new await async yield print println printf
  require import export from assert expect describe test it len str int float bool list dict set map
  filter reduce push pop append extend format parse console log error warn info debug string number
  object array promise resolve reject then json stringify keys values entries main init self super
  this match some none ok err unwrap clone into from_str to_string vec box option result defer make
  malloc free memcpy memset strlen strcmp strcpy fprintf sprintf snprintf close open read write`.split(/\s+/),
);

/**
 * Called identifiers in added lines that the diff itself doesn't define. These are candidates;
 * `phantomSymbols` keeps the ones the repo doesn't define at the base commit either.
 */
export function calledSymbols(diff: string, max = 15): string[] {
  const added = addedLines(diff).filter((l) => !/^\s*(\/\/|#|\*|\/\*|--)/.test(l));
  const text = added.join("\n");
  const defined = new Set<string>();
  for (const m of text.matchAll(
    /\b(?:function|def|fn|func|class|struct|enum|interface|type|const|let|var|static|void|int|char|bool)\s+\*?([A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    defined.add(m[1]!);
  }
  const calls = new Set<string>();
  for (const m of text.matchAll(/(?<![.\w])([A-Za-z_][A-Za-z0-9_]{3,})\s*\(/g)) {
    const name = m[1]!;
    if (!defined.has(name) && !IGNORE.has(name.toLowerCase())) calls.add(name);
  }
  return [...calls].slice(0, max);
}

/** Keeps the symbols the repo doesn't define anywhere (lookup = code search on the base branch). */
export async function phantomSymbols(
  diff: string,
  existsInRepo: (symbol: string) => Promise<boolean>,
): Promise<string[]> {
  const out: string[] = [];
  for (const s of calledSymbols(diff)) {
    // A lookup error means "unknown", never "phantom": when in doubt, don't accuse.
    const exists = await existsInRepo(s).catch(() => true);
    if (!exists) out.push(s);
  }
  return out;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !["the", "and", "for", "fix", "add", "update", "with"].includes(t)),
  );
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Most similar open PR/issue by title words and touched files; reported only above `threshold`. */
export function duplicateOf(c: Contribution, open: OpenItem[], threshold = 0.6): Facts["duplicate_of"] {
  const t = tokens(c.title);
  const f = new Set(c.files);
  let best: Facts["duplicate_of"] = null;
  for (const o of open) {
    if (o.number === c.number) continue;
    const titleSim = jaccard(t, tokens(o.title));
    const fileSim = o.files && f.size ? jaccard(f, new Set(o.files)) : titleSim;
    const sim = Math.round((0.6 * titleSim + 0.4 * fileSim) * 100) / 100;
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { number: o.number, title: o.title, similarity: sim };
    }
  }
  return best;
}
