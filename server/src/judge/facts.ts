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

/** Removes string literals and trailing comments so prose can't look like a call. */
function codeOnly(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$|#.*$|\/\*.*?(\*\/|$)/, "");
}

/**
 * Called identifiers in added lines that the diff itself doesn't define. ALL_CAPS names are
 * skipped (macros and constants usually come from system headers).
 */
export function calledSymbols(diff: string, max = 15): string[] {
  const added = addedLines(diff)
    .filter((l) => !/^\s*(\/\/|#|\*|\/\*|--)/.test(l))
    .map(codeOnly);
  const text = added.join("\n");
  const defined = new Set<string>();
  for (const m of text.matchAll(
    /\b(?:function|def|fn|func|class|struct|enum|interface|type|const|let|var|static|void|int|char|bool)\s+\*?([A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    defined.add(m[1]!);
  }
  const calls = new Set<string>();
  for (const m of text.matchAll(/(?<![.\w>:])([A-Za-z_][A-Za-z0-9_]{3,})\s*\(/g)) {
    const name = m[1]!;
    if (defined.has(name) || IGNORE.has(name.toLowerCase()) || /^[A-Z0-9_]+$/.test(name)) continue;
    calls.add(name);
  }
  return [...calls].slice(0, max);
}

/** `pcap_open_live` → "pcap"; `parseFooBar` → "parse"; single-part names → null. */
export function namespaceOf(name: string): string | null {
  const parts = name.split(/_+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
  return parts.length >= 2 ? parts[0]!.toLowerCase() : null;
}

export interface SymbolIndex {
  has(id: string): boolean;
  /** How many distinct repo identifiers start with this namespace. */
  namespaceSize(ns: string): number;
}

/** A namespace is the project's own when many repo identifiers share it… */
const OWN_NAMESPACE = 5;
/** …and it isn't a generic verb every codebase uses (`onReset`, `get_value`, `handleClick`). */
const GENERIC_NS = new Set(
  `on get set is has can should handle make create to from new do use init update add remove delete
  report mark read write load save run check build render fetch process show print find with as test`.split(/\s+/),
);

/**
 * Splits called names the repo doesn't define into phantom (in the project's own namespace — the
 * classic hallucination) and unresolved (could be a library). If the index can't be built,
 * both are empty: when in doubt, don't accuse.
 */
export async function symbolFacts(
  diff: string,
  index: () => Promise<SymbolIndex>,
): Promise<{ phantom_symbols: string[]; unresolved_symbols: string[] }> {
  const called = calledSymbols(diff);
  if (called.length === 0) return { phantom_symbols: [], unresolved_symbols: [] };
  let idx: SymbolIndex;
  try {
    idx = await index();
  } catch {
    return { phantom_symbols: [], unresolved_symbols: [] };
  }
  const phantom: string[] = [];
  const unresolved: string[] = [];
  for (const s of called) {
    if (idx.has(s)) continue;
    const ns = namespaceOf(s);
    if (ns && !GENERIC_NS.has(ns) && idx.namespaceSize(ns) >= OWN_NAMESPACE) phantom.push(s);
    else unresolved.push(s);
  }
  return { phantom_symbols: phantom, unresolved_symbols: unresolved };
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
