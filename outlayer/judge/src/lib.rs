//! PatchBond's judge as an OutLayer program: runs in Intel TDX, fetches the PR from GitHub itself,
//! computes the same facts as the server, asks a verifiable NEAR AI model, applies the same rules,
//! and hands the contract a ≤900-byte result. Nothing PatchBond's server says reaches the prompt.
//!
//! Pure logic lives here (testable natively); `main.rs` does the I/O inside the enclave.

pub mod facts;
pub mod js;
pub mod malice;
pub mod prompt;
pub mod rules;
pub mod symbols;

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use facts::{CheckRun, Contribution, Facts, Issue, OpenItem, SymbolIndex};
use rules::{Final, ModelVerdict};

/// What the contract passes in `input_data` — all of it from on-chain state.
#[derive(Clone, Debug, Deserialize)]
pub struct Input {
    pub repo_id: u64,
    pub number: u64,
    /// GitHub login the bond was paid for; the PR's author must match.
    pub github_user: String,
    /// "new" | "proven" | "has_forfeits", from the payer's on-chain reputation.
    pub reputation: String,
    pub threshold_bps: u32,
    pub model: String,
    /// Where to publish the full record (exact bytes) for the public verdict page.
    #[serde(default)]
    pub record_url: Option<String>,
}

/// Everything fetched from GitHub for one PR (also the parity-test fixture format).
#[derive(Clone, Debug, Deserialize)]
pub struct Gathered {
    pub full_name: String,
    pub author: String,
    pub contribution: Contribution,
    pub check_runs: Vec<CheckRun>,
    pub open_items: Vec<OpenItem>,
    pub contributing: Option<String>,
    pub rules_text: Option<String>,
    /// The linked issue as looked up (None when the PR names none).
    pub issue: Option<Issue>,
}

pub fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// `computeFacts` from `server/src/judge/judge.ts`.
pub fn compute_facts(g: &Gathered, reputation: &str, index: impl FnOnce() -> Option<Box<dyn SymbolIndex>>) -> Facts {
    let c = &g.contribution;
    let rules = facts::parse_repo_rules(g.rules_text.as_deref());
    let (ci, ci_failed_checks) = facts::ci_fact(&g.check_runs);
    let (phantom_symbols, unresolved_symbols) = facts::symbol_facts(&c.diff, index);
    Facts {
        ci,
        ci_failed_checks,
        phantom_symbols,
        unresolved_symbols,
        duplicate_of: facts::duplicate_of(c, &g.open_items, 0.6),
        assignment: facts::assignment_fact(&g.author, g.issue.as_ref(), &rules),
        issue: g.issue.clone(),
        unbacked_claims: facts::unbacked_claims(c, 5),
        files_changed: c.files.len() as u64,
        additions: c.additions,
        deletions: c.deletions,
        injection_markers: facts::injection_markers(c),
        malicious: malice::malicious_findings(&c.diff, &c.files, 8),
        author_reputation: reputation.into(),
    }
}

pub fn request_for(model: &str, g: &Gathered, facts: &Facts) -> String {
    let repo = prompt::RepoContext { full_name: g.full_name.clone(), policy_note: None, contributing: g.contributing.clone() };
    prompt::request_body(model, &repo, facts, &g.contribution)
}

/// NEAR AI's signature object (`GET /v1/signature/<chat_id>`).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NearAiSignature {
    pub text: String,
    pub signature: String,
    pub signing_address: String,
    pub signing_algo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_kind: Option<String>,
}

/// `verdictHash` from `shared/src/verify.ts` — the contract recomputes it too.
pub fn verdict_hash(repo_id: u64, number: u64, signed_text: &str, verdict: &str) -> String {
    sha256_hex(&json!({ "repo_id": repo_id, "number": number, "signed_text": signed_text, "verdict": verdict }).to_string())
}

pub struct Judged {
    pub facts: Facts,
    pub model_verdict: Option<ModelVerdict>,
    pub final_: Final,
    pub verdict_hash: String,
}

pub fn decide(input: &Input, g: &Gathered, facts: Facts, response_body: &str, signed_text: &str) -> Judged {
    let model_verdict = rules::model_verdict(response_body);
    let rules = facts::parse_repo_rules(g.rules_text.as_deref());
    let final_ = rules::apply_rules(model_verdict.as_ref(), &facts, input.threshold_bps as f64 / 10_000.0, &rules);
    let verdict_hash = verdict_hash(input.repo_id, input.number, signed_text, &final_.verdict);
    Judged { facts, model_verdict, final_, verdict_hash }
}

/// The ≤900-byte answer the contract reads in its callback.
#[derive(Debug, Serialize)]
pub struct Output {
    pub repo_id: u64,
    pub number: u64,
    /// "judged" | "wait" (CI still running) | "skip" (nothing to judge; see `reason`).
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_verdict: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence_bps: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict_hash: Option<String>,
}

impl Output {
    pub fn not_judged(input: &Input, status: &'static str, reason: impl Into<String>) -> Self {
        let reason: String = reason.into();
        Output {
            repo_id: input.repo_id,
            number: input.number,
            status,
            reason: Some(js::slice16(&reason, 300).to_string()),
            verdict: None,
            model_verdict: None,
            confidence_bps: None,
            evidence: None,
            model: None,
            request_sha256: None,
            response_sha256: None,
            signature: None,
            verdict_hash: None,
        }
    }

    pub fn judged(input: &Input, j: &Judged, request_body: &str, response_body: &str, sig: &NearAiSignature) -> Self {
        let mv = j.model_verdict.as_ref();
        Output {
            repo_id: input.repo_id,
            number: input.number,
            status: "judged",
            reason: None,
            verdict: Some(j.final_.verdict.clone()),
            model_verdict: Some(mv.map_or("invalid".into(), |m| m.verdict.clone())),
            confidence_bps: Some(mv.map_or(0, |m| (m.confidence * 10_000.0).round() as u32)),
            evidence: Some(mv.map_or(0, |m| m.evidence.len() as u32)),
            model: Some(input.model.clone()),
            request_sha256: Some(sha256_hex(request_body)),
            response_sha256: Some(sha256_hex(response_body)),
            signature: Some(sig.signature.clone()),
            verdict_hash: Some(j.verdict_hash.clone()),
        }
    }
}

/// The full public record, in `VerdictRecord` shape (`shared/src/types.ts`) plus where it ran.
#[allow(clippy::too_many_arguments)]
pub fn record(input: &Input, g: &Gathered, j: &Judged, chat_id: &str, request_body: &str, response_body: &str, sig: &NearAiSignature, created_at: &str) -> serde_json::Value {
    json!({
        "id": &j.verdict_hash[..16],
        "repo": { "id": input.repo_id, "full_name": g.full_name },
        "number": input.number,
        "signature": sig,
        "final": j.final_,
        "kind": "pr",
        "author": g.author,
        "created_at": created_at,
        "model": input.model,
        "chat_id": chat_id,
        "request_body": request_body,
        "response_body": response_body,
        "facts": j.facts,
        "model_verdict": j.model_verdict,
        "verdict_hash": j.verdict_hash,
        "mock": false,
        "runner": "outlayer-tdx",
    })
}
