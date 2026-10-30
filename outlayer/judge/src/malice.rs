//! Port of `server/src/judge/malice.ts`: malicious-code patterns in a PR's added lines.

use std::sync::LazyLock;

use fancy_regex::Regex;
use serde::{Deserialize, Serialize};

use crate::js::{self, re};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Finding {
    pub rule: String,
    pub severity: String,
    pub file: String,
    pub excerpt: String,
}

struct Rule {
    id: &'static str,
    severity: &'static str,
    files: Option<Regex>,
    test: Regex,
}

fn rule(id: &'static str, severity: &'static str, files: Option<&str>, test: &str, flags: &str) -> Rule {
    Rule { id, severity, files: files.map(|f| re(f, "")), test: re(test, flags) }
}

static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    vec![
        rule("hidden bidi control characters", "high", None, "[\u{202a}-\u{202e}\u{2066}-\u{2069}]", ""),
        rule("zero-width characters in code", "high", None, "[A-Za-z0-9_][\u{200b}-\u{200d}\u{2060}\u{feff}]|[\u{200b}-\u{200d}\u{2060}\u{feff}][A-Za-z0-9_]", ""),
        rule(
            "executes a decoded payload",
            "high",
            None,
            r#"\b(?:eval|exec|execSync|Function|spawn|system|popen|subprocess\.\w+)\s*\(.{0,80}\b(?:atob|b64decode|base64|fromCharCode|unhexlify|Buffer\.from\([^)]*['"](?:base64|hex)['"])"#,
            "i",
        ),
        rule("pipes a download into a shell", "high", None, r"\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\biex\b.{0,40}DownloadString|Invoke-Expression.{0,80}(?:WebClient|Invoke-WebRequest|iwr)", "i"),
        rule("reverse shell", "high", None, r"\/dev\/tcp\/\d|\bnc(?:at)?\s+(?:-\w+\s+)*-e\s|\bbash\s+-i\s+>&|socket\.socket\(.{0,120}subprocess", "i"),
        rule("crypto miner", "high", None, r"stratum\+tcp:\/\/|\bxmrig\b|\bcoinhive\b|\bcryptonight\b", "i"),
        rule("destructive delete outside the repo", "high", None, r"\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(?:--no-preserve-root\s+)?(?:\/(?:\s|$|\*)|~\/?(?:\s|$)|\$HOME\b)", ""),
        rule(
            "sends secrets over the network",
            "high",
            None,
            r"(?:process\.env|os\.environ|env::var|getenv|\$\{\{\s*secrets\.)[^\n]{0,160}\b(?:fetch|axios|requests\.(?:post|get)|http\.request|https?\.request|XMLHttpRequest|WebSocket|curl|wget|urlopen)\b|\b(?:fetch|axios|requests\.(?:post|get)|curl|wget|urlopen)\b[^\n]{0,160}(?:process\.env|os\.environ|env::var|getenv|\$\{\{\s*secrets\.)",
            "i",
        ),
        rule("install hook that runs downloaded code", "high", Some(r"(^|\/)package\.json$"), r#""(?:pre|post)?install"\s*:\s*"[^"]*(?:curl|wget|https?:\/\/|node\s+-e|eval)"#, "i"),
        rule("new install hook", "medium", Some(r"(^|\/)package\.json$"), r#""(?:pre|post)?install"\s*:"#, ""),
        rule("pull_request_target workflow (runs untrusted code with secrets)", "high", Some(r"^\.github\/workflows\/"), r"\bpull_request_target\b", ""),
        rule("workflow touches secrets", "medium", Some(r"^\.github\/workflows\/"), r"\$\{\{\s*secrets\.", ""),
        rule(
            "lockfile resolves outside the registry",
            "high",
            Some(r"(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$"),
            r#"(?:resolved|tarball)["':\s]+["']?https?:\/\/(?!registry\.npmjs\.org|registry\.yarnpkg\.com|npm\.pkg\.github\.com)"#,
            "",
        ),
        rule(
            "dependency from a git URL or raw link",
            "medium",
            Some(r"(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt)$"),
            r#"\bgit\s*=\s*"|"(?:git\+|github:|https?:\/\/)[^"]+"|^\s*(?:git\+)?https?:\/\/\S+\.(?:tar\.gz|zip|whl)"#,
            "",
        ),
        rule("hard-coded IP address URL", "medium", None, r"\bhttps?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?", ""),
        rule("large encoded blob", "medium", None, r#"["'`][A-Za-z0-9+/]{400,}={0,2}["'`]"#, ""),
    ]
});

/// Paths where these patterns are expected (tests, fixtures, docs, detection rules).
static SKIP: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(^|\/)(tests?|__tests__|spec|fixtures?|testdata|examples?|docs?|benchmarks?)\/|\.(md|mdx|txt|rst|adoc)$|[._-](test|spec)\.[a-z]+$|_test\.(go|rs|py)$", "i")
});
static BINARY: LazyLock<Regex> = LazyLock::new(|| re(r"\.(exe|dll|so|dylib|jar|class|pyc|bin|o|a|wasm)$", "i"));
static FILE_HEAD: LazyLock<Regex> = LazyLock::new(|| re(r"^\+\+\+ b\/(.+)$", ""));

/// Splits a unified diff into (file, added line) pairs.
fn added_by_file(diff: &str) -> Vec<(String, &str)> {
    let mut out = Vec::new();
    let mut file = String::new();
    for raw in diff.split('\n') {
        if let Some(f) = js::first(&FILE_HEAD, raw, 1) {
            file = f;
            continue;
        }
        if raw.starts_with('+') && !raw.starts_with("+++") {
            out.push((file.clone(), &raw[1..]));
        }
    }
    out
}

pub fn malicious_findings(diff: &str, files: &[String], max: usize) -> Vec<Finding> {
    let mut found: Vec<Finding> = Vec::new();
    let mut add = |f: Finding| {
        if found.len() >= max || found.iter().any(|g| g.rule == f.rule && g.file == f.file) {
            return;
        }
        found.push(f);
    };
    for (file, line) in added_by_file(diff) {
        if js::is_match(&SKIP, &file) {
            continue;
        }
        for r in RULES.iter() {
            if r.files.as_ref().is_some_and(|f| !js::is_match(f, &file)) {
                continue;
            }
            if js::is_match(&r.test, line) {
                add(Finding { rule: r.id.into(), severity: r.severity.into(), file: file.clone(), excerpt: js::slice16(js::trim(line), 120).to_string() });
            }
        }
    }
    for file in files {
        if js::is_match(&BINARY, file) && !js::is_match(&SKIP, file) {
            add(Finding { rule: "adds a compiled binary".into(), severity: "medium".into(), file: file.clone(), excerpt: String::new() });
        }
    }
    // A plain install hook that also matched the "downloads code" rule is reported once, as high.
    let snapshot = found.clone();
    found.retain(|f| !(f.rule == "new install hook" && snapshot.iter().any(|g| g.file == f.file && g.rule == "install hook that runs downloaded code")));
    found
}
