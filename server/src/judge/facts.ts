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
  // Chained qualifiers ("static void", "static inline const char *") name the identifier after the
  // last one; matching them one at a time would take "void" for the name and skip the real one.
  const QUAL = "function|def|fn|func|class|struct|enum|interface|type|const|let|var|static|inline|extern|unsigned|signed|void|int|char|bool|long|short|float|double|size_t|u_char|u_int";
  for (const m of text.matchAll(new RegExp(`\\b(?:(?:${QUAL})\\s+\\**)+([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
    defined.add(m[1]!);
  }
  // K&R / BSD style puts the return type on its own line and the name at column 0:
  //   static void
  //   pcap_callback(u_char *user, …)
  // Calls are indented; an unindented `name(` is a definition.
  for (const line of added) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (m) defined.add(m[1]!);
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

// ---------- Assignment: did the author take an issue that was theirs to take? ----------

export interface RepoRules {
  /** The repo asks contributors to be assigned before opening a PR for an issue. */
  assignmentRequired: boolean;
  /** "evidence": an unassigned PR counts as forfeit evidence; "flag": a human decides. */
  unassignedEffect: "evidence" | "flag";
  /** Close PRs still unpaid after this many hours (they reopen when paid). Off when null. */
  closeUnpaidAfterHours: number | null;
  /** Team members GitHub can't tell us about (e.g. outside staff), lower-cased: `exempt: alice, bob`. */
  exempt: string[];
}

/** Unpaid PRs close after a day unless the repo says otherwise (`close_unpaid_after_hours: off`). */
export const DEFAULT_CLOSE_UNPAID_HOURS = 24;

export const DEFAULT_RULES: RepoRules = {
  assignmentRequired: false,
  unassignedEffect: "flag",
  closeUnpaidAfterHours: DEFAULT_CLOSE_UNPAID_HOURS,
  exempt: [],
};

/** Parses `.github/patchbond.yml` (flat `key: value` lines; unknown keys ignored). */
export function parseRepoRules(text: string | undefined): RepoRules {
  if (!text) return DEFAULT_RULES;
  const kv = Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter((l) => l.includes(":"))
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
  return {
    assignmentRequired: /^(true|yes|on)$/i.test(kv.assignment_required ?? ""),
    unassignedEffect: kv.unassigned_pr === "evidence" ? "evidence" : "flag",
    closeUnpaidAfterHours: closeAfter(kv.close_unpaid_after_hours),
    exempt: (kv.exempt ?? "").replace(/^\[|\]$/g, "").split(/[\s,]+/).map((u) => u.replace(/^@/, "").toLowerCase()).filter(Boolean),
  };
}

/** "off" / "false" / "0" turn auto-close off; otherwise at least an hour, so there's always time to pay. */
function closeAfter(v: string | undefined): number | null {
  if (v === undefined || v === "") return DEFAULT_CLOSE_UNPAID_HOURS;
  if (/^(off|false|no|never|0)$/i.test(v)) return null;
  const h = Number(v);
  return Number.isFinite(h) ? Math.max(1, h) : DEFAULT_CLOSE_UNPAID_HOURS;
}

export function assignmentFact(author: string, issue: { exists: boolean; assignees?: string[] } | null, rules: RepoRules): Facts["assignment"] {
  if (!issue || !issue.exists) return "no_issue";
  const assignees = (issue.assignees ?? []).map((a) => a.toLowerCase());
  if (assignees.includes(author.toLowerCase())) return "ok";
  if (!rules.assignmentRequired) return "not_required";
  return assignees.length ? "assigned_to_other" : "unassigned";
}

// ---------- Claims vs diff: does the PR do what its description says? ----------

const FILE = /(?:^|[\s(`'"])((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|c|h|cc|cpp|hpp|java|kt|rb|php|cs|swift|md|mdx|json|ya?ml|toml|sh|sql|css|scss|html|vue|svelte|txt|lock))(?=$|[\s),.:;`'"])/g;
const TICKED = /`([A-Za-z_][\w.:-]{2,60})(?:\(\))?`/g;
const TESTS_CLAIM = /\b(add(?:ed|s|ing)?|wr(?:ote|ite|iting)|includ(?:e|ed|es|ing)|new|cover(?:ed|s)?)\b[^.\n]{0,40}\b(unit |integration |e2e )?tests?\b/i;
const IS_TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.\w+$/i;

/** A claim of work done: the sentence opens with a change verb ("Added …", "I rewrote …", "This PR fixes …"). */
const CHANGE_VERB =
  /^\W*(?:(?:i|we|this(?: pr| commit| patch)?|it|also|and|then)\s+)?(?:also\s+)?(?:add(?:ed|s|ing)?|updat(?:e|ed|es|ing)|fix(?:ed|es)?|implement(?:ed|s)?|refactor(?:ed|s)?|rewr(?:ote|ite|ites)|remov(?:e|ed|es)|renam(?:e|ed|es)|document(?:ed|s)?|creat(?:e|ed|es)|wrote|introduc(?:e|ed|es)|mov(?:e|ed|es)|chang(?:e|ed|es)|replac(?:e|ed|es)|extend(?:ed|s)?|delet(?:e|ed|es)|migrat(?:e|ed|es)|convert(?:ed|s)?)\b/i;

/** Change-claim sentences: not template checkboxes, headings, links, code, or examples. */
function claimLines(body: string): string[] {
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.trim().replace(/^[-*+]\s+|^\d+[.)]\s+/, ""))
    .filter((l) => l.length >= 8 && !/^\[[ xX]\]/.test(l) && !/^#/.test(l) && !/^(https?:\/\/\S+)$/.test(l))
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((sentence) => sentence.replace(/^\*\*[^*]+\*\*:?\s*/, "").trim())
    .filter((sentence) => CHANGE_VERB.test(sentence) && !/^(for example|e\.g\.|eg\b|such as)/i.test(sentence));
}

/**
 * A claim is unbacked only if it names concrete things (files, `code`, "added tests") and NONE of
 * them appear in the diff. Lenient on purpose: a description that mentions one real change and one
 * slip is not slop.
 */
export function unbackedClaims(c: Contribution, max = 5): Facts["unbacked_claims"] {
  if (c.kind !== "pr") return [];
  const files = c.files.map((f) => f.toLowerCase());
  const changed = c.diff.toLowerCase();
  const touches = (path: string) => {
    const p = path.toLowerCase();
    return files.some((f) => f === p || f.endsWith(`/${p}`) || f.split("/").pop() === p.split("/").pop());
  };
  const out: Facts["unbacked_claims"] = [];
  for (const line of claimLines(`${c.title}\n${c.body}`)) {
    const named: { what: string; present: boolean }[] = [];
    // A file counts if the diff touches it or the changed text mentions it (docs that reference it).
    for (const m of line.matchAll(FILE)) named.push({ what: m[1]!, present: touches(m[1]!) || changed.includes(m[1]!.toLowerCase().split("/").pop()!) });
    for (const m of line.matchAll(TICKED)) {
      const id = m[1]!;
      if (/\.\w{1,5}$/.test(id) && named.some((n) => n.what === id)) continue; // already a file
      // Present if the name, or a meaningful part of it (`ktor-client-core` → "ktor"), is in the diff.
      const parts = id.toLowerCase().split(/[-_.:/]+/).filter((p) => p.length >= 4);
      named.push({ what: `\`${id}\``, present: changed.includes(id.toLowerCase()) || parts.some((p) => changed.includes(p)) || touches(id) });
    }
    if (TESTS_CLAIM.test(line)) named.push({ what: "tests", present: c.files.some((f) => IS_TEST_FILE.test(f)) });
    if (named.length && named.every((n) => !n.present)) {
      out.push({ claim: line.slice(0, 200), missing: [...new Set(named.map((n) => n.what))] });
      if (out.length >= max) break;
    }
  }
  return out;
}
