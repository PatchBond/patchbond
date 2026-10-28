// Malicious-code patterns in a PR's added lines: deterministic, so the model can't invent or miss
// them. "high" findings are hard evidence (the judge may forfeit on them, and the server proposes a
// forfeit even if the model didn't); "medium" ones only send the PR to a human. Tests, fixtures and
// docs are skipped — security tools (e.g. scanners) legitimately carry these patterns there.

import type { Facts } from "@patchbond/shared";

type Finding = NonNullable<Facts["malicious"]>[number];

interface Rule {
  id: string;
  severity: Finding["severity"];
  /** Which files the rule looks at (all code files when omitted). */
  files?: RegExp;
  test: RegExp;
}

const RULES: Rule[] = [
  // Trojan Source (CVE-2021-42574): bidi overrides reorder what reviewers see.
  { id: "hidden bidi control characters", severity: "high", test: /[‪-‮⁦-⁩]/ },
  { id: "zero-width characters in code", severity: "high", test: /[A-Za-z0-9_][​-‍⁠﻿]|[​-‍⁠﻿][A-Za-z0-9_]/ },
  {
    id: "executes a decoded payload",
    severity: "high",
    test: /\b(?:eval|exec|execSync|Function|spawn|system|popen|subprocess\.\w+)\s*\(.{0,80}\b(?:atob|b64decode|base64|fromCharCode|unhexlify|Buffer\.from\([^)]*['"](?:base64|hex)['"])/i,
  },
  { id: "pipes a download into a shell", severity: "high", test: /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\biex\b.{0,40}DownloadString|Invoke-Expression.{0,80}(?:WebClient|Invoke-WebRequest|iwr)/i },
  { id: "reverse shell", severity: "high", test: /\/dev\/tcp\/\d|\bnc(?:at)?\s+(?:-\w+\s+)*-e\s|\bbash\s+-i\s+>&|socket\.socket\(.{0,120}subprocess/i },
  { id: "crypto miner", severity: "high", test: /stratum\+tcp:\/\/|\bxmrig\b|\bcoinhive\b|\bcryptonight\b/i },
  { id: "destructive delete outside the repo", severity: "high", test: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(?:--no-preserve-root\s+)?(?:\/(?:\s|$|\*)|~\/?(?:\s|$)|\$HOME\b)/ },
  {
    id: "sends secrets over the network",
    severity: "high",
    test: /(?:process\.env|os\.environ|env::var|getenv|\$\{\{\s*secrets\.)[^\n]{0,160}\b(?:fetch|axios|requests\.(?:post|get)|http\.request|https?\.request|XMLHttpRequest|WebSocket|curl|wget|urlopen)\b|\b(?:fetch|axios|requests\.(?:post|get)|curl|wget|urlopen)\b[^\n]{0,160}(?:process\.env|os\.environ|env::var|getenv|\$\{\{\s*secrets\.)/i,
  },
  {
    id: "install hook that runs downloaded code",
    severity: "high",
    files: /(^|\/)package\.json$/,
    test: /"(?:pre|post)?install"\s*:\s*"[^"]*(?:curl|wget|https?:\/\/|node\s+-e|eval)/i,
  },
  { id: "new install hook", severity: "medium", files: /(^|\/)package\.json$/, test: /"(?:pre|post)?install"\s*:/ },
  { id: "pull_request_target workflow (runs untrusted code with secrets)", severity: "high", files: /^\.github\/workflows\//, test: /\bpull_request_target\b/ },
  { id: "workflow touches secrets", severity: "medium", files: /^\.github\/workflows\//, test: /\$\{\{\s*secrets\./ },
  {
    id: "lockfile resolves outside the registry",
    severity: "high",
    files: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
    test: /(?:resolved|tarball)["':\s]+["']?https?:\/\/(?!registry\.npmjs\.org|registry\.yarnpkg\.com|npm\.pkg\.github\.com)/,
  },
  { id: "dependency from a git URL or raw link", severity: "medium", files: /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt)$/, test: /\bgit\s*=\s*"|"(?:git\+|github:|https?:\/\/)[^"]+"|^\s*(?:git\+)?https?:\/\/\S+\.(?:tar\.gz|zip|whl)/ },
  { id: "hard-coded IP address URL", severity: "medium", test: /\bhttps?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/ },
  { id: "large encoded blob", severity: "medium", test: /["'`][A-Za-z0-9+/]{400,}={0,2}["'`]/ },
];

/** Paths where these patterns are expected (tests, fixtures, docs, detection rules). */
const SKIP = /(^|\/)(tests?|__tests__|spec|fixtures?|testdata|examples?|docs?|benchmarks?)\/|\.(md|mdx|txt|rst|adoc)$|[._-](test|spec)\.[a-z]+$|_test\.(go|rs|py)$/i;
const BINARY = /\.(exe|dll|so|dylib|jar|class|pyc|bin|o|a|wasm)$/i;

/** Splits a unified diff into (file, added line) pairs. */
function addedByFile(diff: string): { file: string; line: string }[] {
  const out: { file: string; line: string }[] = [];
  let file = "";
  for (const raw of diff.split("\n")) {
    const head = raw.match(/^\+\+\+ b\/(.+)$/);
    if (head) {
      file = head[1]!;
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) out.push({ file, line: raw.slice(1) });
  }
  return out;
}

export function maliciousFindings(diff: string, files: string[], max = 8): Finding[] {
  const found: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.rule}|${f.file}`;
    if (seen.has(key) || found.length >= max) return;
    seen.add(key);
    found.push(f);
  };
  for (const { file, line } of addedByFile(diff)) {
    if (SKIP.test(file)) continue;
    for (const r of RULES) {
      if (r.files && !r.files.test(file)) continue;
      if (r.test.test(line)) add({ rule: r.id, severity: r.severity, file, excerpt: line.trim().slice(0, 120) });
    }
  }
  for (const file of files) {
    if (BINARY.test(file) && !SKIP.test(file)) add({ rule: "adds a compiled binary", severity: "medium", file, excerpt: "" });
  }
  // A plain install hook that also matched the "downloads code" rule is reported once, as high.
  return found.filter((f) => !(f.rule === "new install hook" && found.some((g) => g.file === f.file && g.rule === "install hook that runs downloaded code")));
}
