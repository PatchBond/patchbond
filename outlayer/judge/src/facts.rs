//! Port of `server/src/judge/facts.ts`: deterministic facts the model must not guess. Same order,
//! same names, same regexes — the parity test (`tests/parity.rs`) checks the output byte for byte.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use fancy_regex::Regex;
use serde::{Deserialize, Serialize, Serializer};

use crate::js::{self, re};
use crate::malice::Finding;

#[derive(Clone, Debug, Deserialize)]
pub struct CheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OpenItem {
    pub number: u64,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Contribution {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub diff: String,
    pub files: Vec<String>,
    pub additions: u64,
    pub deletions: u64,
}

/// `JSON.stringify` prints integral numbers without a fraction (`1`, not `1.0`).
pub fn js_number<S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        s.serialize_i64(*v as i64)
    } else {
        s.serialize_f64(*v)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Duplicate {
    pub number: u64,
    pub title: String,
    #[serde(serialize_with = "js_number")]
    pub similarity: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Issue {
    pub number: u64,
    pub exists: bool,
    pub open: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignees: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Claim {
    pub claim: String,
    pub missing: Vec<String>,
}

/// `Facts` from `shared/src/types.ts`, fields in the order the server builds them.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Facts {
    pub ci: String,
    pub ci_failed_checks: Vec<String>,
    pub phantom_symbols: Vec<String>,
    pub unresolved_symbols: Vec<String>,
    pub duplicate_of: Option<Duplicate>,
    pub issue: Option<Issue>,
    pub assignment: String,
    pub unbacked_claims: Vec<Claim>,
    pub files_changed: u64,
    pub additions: u64,
    pub deletions: u64,
    pub injection_markers: Vec<String>,
    pub malicious: Vec<Finding>,
    pub author_reputation: String,
}

/// The repo's own CI on the head commit. We never run contributor code.
pub fn ci_fact(runs: &[CheckRun]) -> (String, Vec<String>) {
    let relevant: Vec<_> = runs.iter().filter(|r| !js::lower(&r.name).starts_with("patchbond")).collect();
    if relevant.is_empty() {
        return ("none".into(), vec![]);
    }
    let failed: Vec<String> = relevant
        .iter()
        .filter(|r| r.status == "completed" && matches!(r.conclusion.as_deref(), Some("failure" | "timed_out" | "cancelled")))
        .map(|r| r.name.clone())
        .collect();
    if !failed.is_empty() {
        return ("failure".into(), failed);
    }
    if relevant.iter().any(|r| r.status != "completed") {
        return ("pending".into(), vec![]);
    }
    ("success".into(), vec![])
}

static LINKED: LazyLock<Regex> = LazyLock::new(|| re(r"\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s*#(\d+)\b", "i"));

/// "Fixes #12", "closes #12", "resolves #12" — the issue a PR claims to fix.
pub fn linked_issue(text: &str) -> Option<u64> {
    js::first(&LINKED, text, 1).and_then(|n| n.parse().ok())
}

static INJECTION: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts?)",
        r"disregard (?:the |your )?(?:previous |system )?(?:instructions|prompt)",
        r"you are (?:now )?(?:an? )?(?:ai|assistant|language model|judge|reviewer)\b",
        r"\bsystem prompt\b",
        r#"(?:return|output|respond with)[^.\n]{0,40}"?verdict"?\s*[:=]?\s*"?refund"#,
        r"<\/?(?:contribution|facts|repo|system)>",
    ]
    .iter()
    .map(|s| re(s, "i"))
    .collect()
});

/// Text that tries to instruct the judge — itself evidence of bad faith.
pub fn injection_markers(c: &Contribution) -> Vec<String> {
    let added = added_lines(&c.diff).join("\n");
    let hay = format!("{}\n{}\n{}", c.title, c.body, added);
    INJECTION.iter().filter_map(|r| js::first(r, &hay, 0)).map(|m| js::slice16(&m, 80).to_string()).collect()
}

pub fn added_lines(diff: &str) -> Vec<&str> {
    diff.split('\n').filter(|l| l.starts_with('+') && !l.starts_with("+++")).map(|l| &l[1..]).collect()
}

/// Common names that are never worth a lookup (keywords, builtins, test helpers).
static IGNORE: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    "if for while switch catch return function typeof sizeof new await async yield print println printf
  require import export from assert expect describe test it len str int float bool list dict set map
  filter reduce push pop append extend format parse console log error warn info debug string number
  object array promise resolve reject then json stringify keys values entries main init self super
  this match some none ok err unwrap clone into from_str to_string vec box option result defer make
  malloc free memcpy memset strlen strcmp strcpy fprintf sprintf snprintf close open read write"
        .split_whitespace()
        .collect()
});

static STRINGS: LazyLock<Regex> = LazyLock::new(|| re(r#""(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`"#, ""));
static TRAILING_COMMENT: LazyLock<Regex> = LazyLock::new(|| re(r"\/\/.*$|#.*$|\/\*.*?(\*\/|$)", ""));

/// Removes string literals and trailing comments so prose can't look like a call.
fn code_only(line: &str) -> String {
    let no_strings = js::replace_all(&STRINGS, line, |_| "\"\"".into());
    js::replace_first(&TRAILING_COMMENT, &no_strings, "")
}

static COMMENT_LINE: LazyLock<Regex> = LazyLock::new(|| re(r"^\s*(\/\/|#|\*|\/\*|--)", ""));
const QUAL: &str = "function|def|fn|func|class|struct|enum|interface|type|const|let|var|static|inline|extern|unsigned|signed|void|int|char|bool|long|short|float|double|size_t|u_char|u_int";
static DEFINED: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"\b(?:(?:{QUAL})\s+\**)+([A-Za-z_][A-Za-z0-9_]*)"), ""));
static COLUMN0_DEF: LazyLock<Regex> = LazyLock::new(|| re(r"^([A-Za-z_][A-Za-z0-9_]*)\s*\(", ""));
static CALL: LazyLock<Regex> = LazyLock::new(|| re(r"(?<![.\w>:])([A-Za-z_][A-Za-z0-9_]{3,})\s*\(", ""));
static ALL_CAPS: LazyLock<Regex> = LazyLock::new(|| re(r"^[A-Z0-9_]+$", ""));

/// Called identifiers in added lines that the diff itself doesn't define (ALL_CAPS skipped).
pub fn called_symbols(diff: &str, max: usize) -> Vec<String> {
    let added: Vec<String> = added_lines(diff).into_iter().filter(|l| !js::is_match(&COMMENT_LINE, l)).map(code_only).collect();
    let text = added.join("\n");
    let mut defined: HashSet<String> = js::all(&DEFINED, &text, 1).into_iter().collect();
    for line in &added {
        if let Some(m) = js::first(&COLUMN0_DEF, line, 1) {
            defined.insert(m);
        }
    }
    let mut calls: Vec<String> = Vec::new();
    for name in js::all(&CALL, &text, 1) {
        if defined.contains(&name) || IGNORE.contains(js::lower(&name).as_str()) || js::is_match(&ALL_CAPS, &name) || calls.contains(&name) {
            continue;
        }
        calls.push(name);
    }
    calls.truncate(max);
    calls
}

/// `pcap_open_live` → "pcap"; `parseFooBar` → "parse"; single-part names → None.
/// (JS: `name.split(/_+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean)`.)
pub fn namespace_of(name: &str) -> Option<String> {
    let mut parts: Vec<String> = vec![String::new()];
    let mut prev: Option<char> = None;
    for c in name.chars() {
        if c == '_' {
            if prev != Some('_') {
                parts.push(String::new());
            }
        } else {
            if c.is_ascii_uppercase() && prev.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit()) {
                parts.push(String::new());
            }
            parts.last_mut().unwrap().push(c);
        }
        prev = Some(c);
    }
    let parts: Vec<_> = parts.into_iter().filter(|p| !p.is_empty()).collect();
    (parts.len() >= 2).then(|| js::lower(&parts[0]))
}

pub trait SymbolIndex {
    fn has(&self, id: &str) -> bool;
    fn namespace_size(&self, ns: &str) -> usize;
}

const OWN_NAMESPACE: usize = 5;
static GENERIC_NS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    "on get set is has can should handle make create to from new do use init update add remove delete
  report mark read write load save run check build render fetch process show print find with as test"
        .split_whitespace()
        .collect()
});

/// Phantom (own namespace, missing — the classic hallucination) vs unresolved (maybe a library).
/// No index → both empty: when in doubt, don't accuse.
pub fn symbol_facts(diff: &str, index: impl FnOnce() -> Option<Box<dyn SymbolIndex>>) -> (Vec<String>, Vec<String>) {
    let called = called_symbols(diff, 15);
    if called.is_empty() {
        return (vec![], vec![]);
    }
    let Some(idx) = index() else { return (vec![], vec![]) };
    let (mut phantom, mut unresolved) = (vec![], vec![]);
    for s in called {
        if idx.has(&s) {
            continue;
        }
        match namespace_of(&s) {
            Some(ns) if !GENERIC_NS.contains(ns.as_str()) && idx.namespace_size(&ns) >= OWN_NAMESPACE => phantom.push(s),
            _ => unresolved.push(s),
        }
    }
    (phantom, unresolved)
}

static NON_ALNUM: LazyLock<Regex> = LazyLock::new(|| re(r"[^a-z0-9]+", ""));

fn tokens(s: &str) -> HashSet<String> {
    js::split(&NON_ALNUM, &js::lower(s))
        .into_iter()
        .filter(|t| js::len16(t) > 2 && !["the", "and", "for", "fix", "add", "update", "with"].contains(t))
        .map(String::from)
        .collect()
}

fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.iter().filter(|x| b.contains(*x)).count() as f64;
    inter / (a.len() as f64 + b.len() as f64 - inter)
}

/// Most similar open PR by title words (open PRs come without files, so files weigh the same).
pub fn duplicate_of(c: &Contribution, open: &[OpenItem], threshold: f64) -> Option<Duplicate> {
    let t = tokens(&c.title);
    let mut best: Option<Duplicate> = None;
    for o in open {
        if o.number == c.number {
            continue;
        }
        let title_sim = jaccard(&t, &tokens(&o.title));
        let file_sim = title_sim;
        let sim = js::round((0.6 * title_sim + 0.4 * file_sim) * 100.0) / 100.0;
        if sim >= threshold && best.as_ref().is_none_or(|b| sim > b.similarity) {
            best = Some(Duplicate { number: o.number, title: o.title.clone(), similarity: sim });
        }
    }
    best
}

// ---------- Repo rules (.github/patchbond.yml) ----------

#[derive(Clone, Debug, PartialEq)]
pub struct RepoRules {
    pub assignment_required: bool,
    /// "evidence" or "flag".
    pub unassigned_effect: &'static str,
}

pub const DEFAULT_RULES: RepoRules = RepoRules { assignment_required: false, unassigned_effect: "flag" };

static YAML_COMMENT: LazyLock<Regex> = LazyLock::new(|| re(r"#.*$", ""));
static QUOTES: LazyLock<Regex> = LazyLock::new(|| re(r#"^["']|["']$"#, ""));
static YES: LazyLock<Regex> = LazyLock::new(|| re(r"^(true|yes|on)$", "i"));

pub fn parse_repo_rules(text: Option<&str>) -> RepoRules {
    let Some(text) = text.filter(|t| !t.is_empty()) else { return DEFAULT_RULES };
    let mut kv: HashMap<String, String> = HashMap::new();
    for l in text.split('\n') {
        let stripped = js::replace_first(&YAML_COMMENT, l, "");
        let l = js::trim(&stripped);
        let Some(i) = l.find(':') else { continue };
        let value = js::replace_all(&QUOTES, js::trim(&l[i + 1..]), |_| String::new());
        kv.insert(js::trim(&l[..i]).to_string(), value);
    }
    RepoRules {
        assignment_required: js::is_match(&YES, kv.get("assignment_required").map_or("", |s| s)),
        unassigned_effect: if kv.get("unassigned_pr").map(String::as_str) == Some("evidence") { "evidence" } else { "flag" },
    }
}

pub fn assignment_fact(author: &str, issue: Option<&Issue>, rules: &RepoRules) -> String {
    let Some(issue) = issue.filter(|i| i.exists) else { return "no_issue".into() };
    let assignees: Vec<String> = issue.assignees.iter().flatten().map(|a| js::lower(a)).collect();
    if assignees.contains(&js::lower(author)) {
        return "ok".into();
    }
    if !rules.assignment_required {
        return "not_required".into();
    }
    if assignees.is_empty() { "unassigned" } else { "assigned_to_other" }.into()
}

// ---------- Claims vs diff ----------

static FILE: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r#"(?:^|[\s(`'"])((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|c|h|cc|cpp|hpp|java|kt|rb|php|cs|swift|md|mdx|json|ya?ml|toml|sh|sql|css|scss|html|vue|svelte|txt|lock))(?=$|[\s),.:;`'"])"#,
        "",
    )
});
static TICKED: LazyLock<Regex> = LazyLock::new(|| re(r"`([A-Za-z_][\w.:-]{2,60})(?:\(\))?`", ""));
static TESTS_CLAIM: LazyLock<Regex> =
    LazyLock::new(|| re(r"\b(add(?:ed|s|ing)?|wr(?:ote|ite|iting)|includ(?:e|ed|es|ing)|new|cover(?:ed|s)?)\b[^.\n]{0,40}\b(unit |integration |e2e )?tests?\b", "i"));
static IS_TEST_FILE: LazyLock<Regex> = LazyLock::new(|| re(r"(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.\w+$", "i"));
static CHANGE_VERB: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"^\W*(?:(?:i|we|this(?: pr| commit| patch)?|it|also|and|then)\s+)?(?:also\s+)?(?:add(?:ed|s|ing)?|updat(?:e|ed|es|ing)|fix(?:ed|es)?|implement(?:ed|s)?|refactor(?:ed|s)?|rewr(?:ote|ite|ites)|remov(?:e|ed|es)|renam(?:e|ed|es)|document(?:ed|s)?|creat(?:e|ed|es)|wrote|introduc(?:e|ed|es)|mov(?:e|ed|es)|chang(?:e|ed|es)|replac(?:e|ed|es)|extend(?:ed|s)?|delet(?:e|ed|es)|migrat(?:e|ed|es)|convert(?:ed|s)?)\b",
        "i",
    )
});
static FENCED: LazyLock<Regex> = LazyLock::new(|| re(r"```[\s\S]*?```", ""));
static HTML_COMMENT: LazyLock<Regex> = LazyLock::new(|| re(r"<!--[\s\S]*?-->", ""));
static BULLET: LazyLock<Regex> = LazyLock::new(|| re(r"^[-*+]\s+|^\d+[.)]\s+", ""));
static CHECKBOX: LazyLock<Regex> = LazyLock::new(|| re(r"^\[[ xX]\]", ""));
static HEADING: LazyLock<Regex> = LazyLock::new(|| re(r"^#", ""));
static BARE_LINK: LazyLock<Regex> = LazyLock::new(|| re(r"^(https?:\/\/\S+)$", ""));
static SENTENCE: LazyLock<Regex> = LazyLock::new(|| re(r"(?<=[.!?])\s+(?=[A-Z])", ""));
static BOLD_LEAD: LazyLock<Regex> = LazyLock::new(|| re(r"^\*\*[^*]+\*\*:?\s*", ""));
static EXAMPLE: LazyLock<Regex> = LazyLock::new(|| re(r"^(for example|e\.g\.|eg\b|such as)", "i"));
static HAS_EXT: LazyLock<Regex> = LazyLock::new(|| re(r"\.\w{1,5}$", ""));
static ID_PARTS: LazyLock<Regex> = LazyLock::new(|| re(r"[-_.:/]+", ""));

/// Change-claim sentences: not template checkboxes, headings, links, code, or examples.
fn claim_lines(body: &str) -> Vec<String> {
    let body = js::replace_all(&FENCED, body, |_| String::new());
    let body = js::replace_all(&HTML_COMMENT, &body, |_| String::new());
    body.split('\n')
        .map(|l| js::replace_first(&BULLET, js::trim(l), ""))
        .filter(|l| js::len16(l) >= 8 && !js::is_match(&CHECKBOX, l) && !js::is_match(&HEADING, l) && !js::is_match(&BARE_LINK, l))
        .flat_map(|l| js::split(&SENTENCE, &l).into_iter().map(String::from).collect::<Vec<_>>())
        .map(|s| js::trim(&js::replace_first(&BOLD_LEAD, &s, "")).to_string())
        .filter(|s| js::is_match(&CHANGE_VERB, s) && !js::is_match(&EXAMPLE, s))
        .collect()
}

fn last_segment(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

/// A claim is unbacked only if it names concrete things and NONE of them appear in the diff.
pub fn unbacked_claims(c: &Contribution, max: usize) -> Vec<Claim> {
    let files: Vec<String> = c.files.iter().map(|f| js::lower(f)).collect();
    let changed = js::lower(&c.diff);
    let touches = |path: &str| {
        let p = js::lower(path);
        files.iter().any(|f| *f == p || f.ends_with(&format!("/{p}")) || last_segment(f) == last_segment(&p))
    };
    let mut out = Vec::new();
    for line in claim_lines(&format!("{}\n{}", c.title, c.body)) {
        let mut named: Vec<(String, bool)> = Vec::new();
        for f in js::all(&FILE, &line, 1) {
            let present = touches(&f) || changed.contains(last_segment(&js::lower(&f)));
            named.push((f, present));
        }
        for id in js::all(&TICKED, &line, 1) {
            if js::is_match(&HAS_EXT, &id) && named.iter().any(|(w, _)| *w == id) {
                continue;
            }
            let lid = js::lower(&id);
            let parts: Vec<&str> = js::split(&ID_PARTS, &lid).into_iter().filter(|p| js::len16(p) >= 4).collect();
            let present = changed.contains(&lid) || parts.iter().any(|p| changed.contains(p)) || touches(&id);
            named.push((format!("`{id}`"), present));
        }
        if js::is_match(&TESTS_CLAIM, &line) {
            named.push(("tests".into(), c.files.iter().any(|f| js::is_match(&IS_TEST_FILE, f))));
        }
        if !named.is_empty() && named.iter().all(|(_, present)| !present) {
            let mut missing: Vec<String> = Vec::new();
            for (w, _) in named {
                if !missing.contains(&w) {
                    missing.push(w);
                }
            }
            out.push(Claim { claim: js::slice16(&line, 200).to_string(), missing });
            if out.len() >= max {
                break;
            }
        }
    }
    out
}
