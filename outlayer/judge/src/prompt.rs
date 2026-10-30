//! Port of `server/src/judge/prompt.ts`. The request body is hashed and signed by NEAR AI, so it
//! must be byte-identical to the server's for the same PR.

use std::sync::LazyLock;

use fancy_regex::Regex;
use serde_json::json;

use crate::facts::{Contribution, Facts};
use crate::js::{self, re};

pub const SYSTEM_PROMPT: &str = include_str!("system_prompt.txt");

/// Diff budget in UTF-16 units (~12k tokens); the file list is always complete.
pub const DIFF_BUDGET: usize = 48_000;

static OUR_TAGS: LazyLock<Regex> = LazyLock::new(|| re(r"<(\/?)(contribution|facts|repo|system|challenge)\b", "i"));

fn neutralise(s: &str) -> String {
    js::replace_all(&OUR_TAGS, s, |c| format!("&lt;{}{}", &c[1], &c[2]))
}

pub struct RepoContext {
    pub full_name: String,
    pub policy_note: Option<String>,
    pub contributing: Option<String>,
}

pub fn user_message(repo: &RepoContext, facts: &Facts, c: &Contribution) -> String {
    let diff_len = js::len16(&c.diff);
    let diff = if diff_len > DIFF_BUDGET {
        format!("{}\n… [diff truncated: {} more characters]", js::slice16(&c.diff, DIFF_BUDGET), diff_len - DIFF_BUDGET)
    } else {
        c.diff.clone()
    };
    let contributing = repo.contributing.as_deref().unwrap_or("(no CONTRIBUTING.md)");
    let body = if c.body.is_empty() { "(empty)" } else { &c.body };
    [
        format!(r#"<repo name="{}" policy="{}">"#, repo.full_name, neutralise(repo.policy_note.as_deref().unwrap_or("default"))),
        neutralise(js::slice16(contributing, 4_000)),
        "</repo>".into(),
        format!("<facts>{}</facts>", serde_json::to_string(facts).expect("facts serialize")),
        format!(r#"<contribution kind="pr" number="{}" author_reputation="{}">"#, c.number, facts.author_reputation),
        format!("Title: {}", neutralise(&c.title)),
        format!("Body:\n{}", neutralise(body)),
        format!("Files ({}): {}", c.files.len(), c.files.join(", ")),
        format!("Diff:\n{}", neutralise(&diff)),
        "</contribution>".into(),
    ]
    .into_iter()
    .filter(|l| !l.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

/// The exact request body sent to NEAR AI Cloud (same keys, same order as the server).
pub fn request_body(model: &str, repo: &RepoContext, facts: &Facts, c: &Contribution) -> String {
    // serde_json's `preserve_order` keeps keys in insertion order, like JSON.stringify.
    json!({
        "model": model,
        "temperature": 0,
        "reasoning_effort": "low",
        "max_tokens": 4_000,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_message(repo, facts, c) },
        ],
    })
    .to_string()
}
