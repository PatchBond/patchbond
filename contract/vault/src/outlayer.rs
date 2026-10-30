//! Judging without PatchBond's server: anyone asks the contract to judge a bonded PR in an
//! OutLayer enclave (Intel TDX). The enclave program (`outlayer/judge`, its wasm hash pinned here)
//! fetches the PR and CI from GitHub itself, builds the facts and the prompt, asks NEAR AI, and
//! OutLayer's registered worker resumes this contract with the answer.
//!
//! The callback trusts two enclaves, and checks the second itself: the NEAR AI signature over
//! `<model>:<sha256(request)>:<sha256(response)>` must recover to a registered enclave key. The
//! full record (exact request and response bytes) is published off-chain; its hashes are here.
//!
//! With `exclusive` on, the oracle can no longer forfeit at all — only this path can.

use near_sdk::serde_json::{self, json, Value};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError};

use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

const CONFIG_KEY: &[u8] = b"ol:cfg";
const GAS_FOR_OUTLAYER: Gas = Gas::from_tgas(150);
pub(crate) const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(60);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OutlayerConfig {
    /// `outlayer.testnet` / `outlayer.near`.
    pub account: AccountId,
    /// e.g. "patchbond-dev.testnet/judge".
    pub project_id: String,
    /// The exact wasm (sha256) that may judge; None = the project's active version.
    pub version_key: Option<String>,
    /// The verifiable model the enclave asks, e.g. "z-ai/glm-5.3-flash".
    pub model: String,
    /// Where the enclave publishes the full record for the public verdict page.
    pub record_url: Option<String>,
    /// Owner of the encrypted secrets (NEARAI_API_KEY, GITHUB_TOKEN) and their profile.
    pub secrets_owner: Option<AccountId>,
    pub secrets_profile: Option<String>,
    /// True: only OutLayer verdicts can forfeit; the oracle may still refund.
    pub exclusive: bool,
}

/// What the enclave prints (≤900 bytes; `outlayer/judge/src/lib.rs` `Output`).
#[near(serializers = [json])]
#[derive(Debug)]
pub struct TeeOutput {
    pub repo_id: RepoId,
    pub number: Number,
    pub status: String,
    pub reason: Option<String>,
    pub verdict: Option<String>,
    pub model_verdict: Option<String>,
    pub confidence_bps: Option<u32>,
    pub evidence: Option<u32>,
    pub model: Option<String>,
    pub request_sha256: Option<String>,
    pub response_sha256: Option<String>,
    pub signature: Option<String>,
}

/// Per-deposit job state: requested, or judged (one enclave verdict per deposit — no re-rolls).
pub(crate) fn job_key(repo_id: RepoId, number: Number) -> Vec<u8> {
    format!("ol:job:{repo_id}:{number}").into_bytes()
}
pub(crate) const REQUESTED: &[u8] = b"r";

/// An enclave judgment: "requested", or "judged" with the verdict hash the contract computed — the
/// only record PatchBond's server will publish for it.
#[near(serializers = [json])]
pub struct TeeJob {
    pub state: String,
    pub verdict_hash: Option<String>,
}

#[near]
impl PatchBond {
    /// Owner: point the contract at the OutLayer project (or None to turn this path off).
    pub fn set_outlayer(&mut self, config: Option<OutlayerConfig>) {
        self.assert_owner();
        match &config {
            Some(c) => {
                require!(c.version_key.as_deref().is_none_or(is_hex64), "version_key must be the wasm's sha256 hex");
                env::storage_write(CONFIG_KEY, &near_sdk::borsh::to_vec(c).unwrap());
            }
            None => {
                env::storage_remove(CONFIG_KEY);
            }
        }
        events::outlayer(config.as_ref());
    }

    pub fn get_outlayer(&self) -> Option<OutlayerConfig> {
        outlayer_config()
    }

    pub fn get_tee_job(&self, repo_id: RepoId, number: Number) -> Option<TeeJob> {
        env::storage_read(&job_key(repo_id, number)).map(|v| match v.strip_prefix(b"j:") {
            Some(hash) => TeeJob { state: "judged".into(), verdict_hash: Some(String::from_utf8_lossy(hash).into_owned()) },
            None => TeeJob { state: "requested".into(), verdict_hash: None },
        })
    }

    /// Anyone: judge a held PR bond in the OutLayer enclave. Attach NEAR for the run (see OutLayer's
    /// `estimate_execution_cost`; ~0.01 NEAR) — what isn't used goes back to you.
    #[payable]
    pub fn judge_in_tee(&mut self, repo_id: RepoId, number: Number) -> Promise {
        let cfg = outlayer_config().unwrap_or_else(|| env::panic_str("Judging in OutLayer isn't set up on this contract"));
        let d = self.deposits.get(&(repo_id, number)).cloned().unwrap_or_else(|| env::panic_str(&format!("#{number} on repo {repo_id} has no deposit")));
        require!(d.status == DepositStatus::Held, "Only a held deposit (no verdict yet) can be judged");
        require!(d.kind == Kind::Pr, "Only pull requests are judged in OutLayer; bug reports go through the server");
        require!(env::storage_read(&job_key(repo_id, number)).is_none(), "This deposit already has an enclave judgment, or one is running");
        require!(env::attached_deposit() > NearToken::from_yoctonear(0), "Attach NEAR to pay for the OutLayer run (~0.01 NEAR; the unused part is refunded)");
        env::storage_write(&job_key(repo_id, number), REQUESTED);

        let rep = self.reputation.get(&d.payer).cloned().unwrap_or_default();
        let reputation = if rep.forfeits > 0 { "has_forfeits" } else if rep.refunds > 0 { "proven" } else { "new" };
        let input = json!({
            "repo_id": repo_id,
            "number": number,
            "github_user": d.github_user,
            "reputation": reputation,
            "threshold_bps": self.repo(repo_id).policy.forfeit_threshold_bps,
            "model": cfg.model,
            "record_url": cfg.record_url,
        });
        events::tee_requested(repo_id, number, &env::predecessor_account_id());
        outlayer_call(&cfg, input).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_tee_judgment(repo_id, number, env::predecessor_account_id(), U128(env::attached_deposit().as_yoctonear())),
        )
    }

    /// OutLayer's answer: our program's JSON, or `null` if the run failed (OutLayer refunds the
    /// payer itself then). If `request_execution` refused the call outright, the NEAR came back
    /// here, and goes back to whoever attached it.
    #[private]
    pub fn on_tee_judgment(&mut self, repo_id: RepoId, number: Number, caller: AccountId, attached: U128) -> String {
        let out: Option<TeeOutput> = match env::promise_result_checked(0, 4096) {
            Ok(bytes) => serde_json::from_slice(&bytes).ok(),
            Err(PromiseError::TooLong(_)) => None,
            Err(_) => {
                if attached.0 > 0 {
                    Promise::new(caller).transfer(NearToken::from_yoctonear(attached.0)).detach();
                }
                None
            }
        };
        match self.apply_tee_output(repo_id, number, out) {
            Ok(what) => what,
            Err(why) => {
                // Nothing settled: the job is cleared so anyone can ask again.
                env::storage_remove(&job_key(repo_id, number));
                events::tee_result(repo_id, number, "not_judged", &why);
                why
            }
        }
    }
}

impl PatchBond {
    fn apply_tee_output(&mut self, repo_id: RepoId, number: Number, out: Option<TeeOutput>) -> Result<String, String> {
        let cfg = outlayer_config().ok_or("OutLayer was turned off while this ran")?;
        let out = out.ok_or("The OutLayer run failed or returned nothing")?;
        if (out.repo_id, out.number) != (repo_id, number) {
            return Err(format!("The enclave answered for {}#{}", out.repo_id, out.number));
        }
        if out.status != "judged" {
            return Err(format!("{}: {}", out.status, out.reason.unwrap_or_default()));
        }
        let model = out.model.ok_or("no model")?;
        if model != cfg.model {
            return Err(format!("The enclave asked {model}, not {}", cfg.model));
        }
        let (req, resp, sig) = (out.request_sha256.ok_or("no request hash")?, out.response_sha256.ok_or("no response hash")?, out.signature.ok_or("no signature")?);
        if !is_hex64(&req) || !is_hex64(&resp) {
            return Err("hashes must be 64 hex characters".into());
        }
        let signed_text = format!("{model}:{req}:{resp}");
        let signer = crate::tee::recover_eip191(&signed_text, &sig)?;
        if !self.tee_signers.contains(&signer) {
            return Err(format!("0x{signer} isn't a registered NEAR AI enclave key"));
        }
        let verdict = out.verdict.ok_or("no verdict")?;
        let verdict_hash = verdict_hash(repo_id, number, &signed_text, &verdict);
        env::storage_write(&job_key(repo_id, number), format!("j:{verdict_hash}").as_bytes());
        events::tee_verified(repo_id, number, &signer, &model);

        let held = self.deposits.get(&(repo_id, number)).is_some_and(|d| d.status == DepositStatus::Held);
        let threshold = self.repo(repo_id).policy.forfeit_threshold_bps as u32;
        // Same bar as an oracle forfeit: the model itself signed a forfeit, above the repo's
        // threshold, with evidence. A forfeit only the rules reached goes to a maintainer.
        let signed_forfeit = out.model_verdict.as_deref() == Some("forfeit") && out.confidence_bps.unwrap_or(0) >= threshold && out.evidence.unwrap_or(0) > 0;
        let decided = match verdict.as_str() {
            "refund" => Some(Verdict::Refund),
            "forfeit" if signed_forfeit => Some(Verdict::Forfeit),
            _ => None,
        };
        let what = match (held, decided) {
            (true, Some(v)) => {
                self.propose_ai_verdict(repo_id, number, v, verdict_hash.clone());
                format!("{v:?}").to_lowercase()
            }
            (true, None) => "needs_human".into(),
            (false, _) => "already_decided".into(),
        };
        events::tee_result(repo_id, number, &what, &verdict_hash);
        Ok(what)
    }

    /// With OutLayer `exclusive`, the oracle can't forfeit (it may still refund).
    pub(crate) fn assert_oracle_may_forfeit(&self) {
        if env::predecessor_account_id() == self.oracle && outlayer_config().is_some_and(|c| c.exclusive) {
            env::panic_str("Forfeits on this contract come only from the OutLayer enclave (judge_in_tee); the oracle can only refund");
        }
    }
}

/// Asks OutLayer to run the pinned program on `input`, paid by the attached NEAR (unused is refunded
/// to the caller).
pub(crate) fn outlayer_call(cfg: &OutlayerConfig, input: Value) -> Promise {
    let mut args = json!({
        "source": { "Project": { "project_id": cfg.project_id, "version_key": cfg.version_key } },
        "resource_limits": { "max_instructions": 50_000_000_000u64, "max_memory_mb": 512, "max_execution_seconds": 120 },
        "input_data": input.to_string(),
        "response_format": "Json",
        "payer_account_id": env::predecessor_account_id(),
    });
    if let (Some(owner), Some(profile)) = (&cfg.secrets_owner, &cfg.secrets_profile) {
        args["secrets_ref"] = json!({ "profile": profile, "account_id": owner });
    }
    Promise::new(cfg.account.clone()).function_call("request_execution".to_string(), args.to_string().into_bytes(), env::attached_deposit(), GAS_FOR_OUTLAYER)
}

pub(crate) fn outlayer_config() -> Option<OutlayerConfig> {
    env::storage_read(CONFIG_KEY).and_then(|b| near_sdk::borsh::from_slice(&b).ok())
}

pub(crate) fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// `verdictHash` from `shared/src/verify.ts`: sha256 of
/// `JSON.stringify({repo_id, number, signed_text, verdict})`, keys in that order.
pub fn verdict_hash(repo_id: RepoId, number: Number, signed_text: &str, verdict: &str) -> String {
    let text = format!(
        r#"{{"repo_id":{repo_id},"number":{number},"signed_text":{},"verdict":{}}}"#,
        Value::String(signed_text.into()),
        Value::String(verdict.into())
    );
    env::sha256_array(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}
