//! Disputes judged without PatchBond's server. When a verdict is challenged (a staked challenge of
//! an AI verdict, or a contributor's free dispute of a maintainer's forfeit), anyone can ask the
//! contract to re-judge it in the OutLayer enclave with the stronger verifiable model. Both sides
//! post their statements here, on-chain — the contract hands them to the enclave, so nothing our
//! server says reaches the prompt. With `exclusive` on, this is the only way a dispute ends in a
//! forfeit.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseError};

use crate::outlayer::{is_hex64, outlayer_call, outlayer_config, verdict_hash, TeeOutput, GAS_FOR_CALLBACK, REQUESTED};
use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

/// The stronger model a dispute is re-judged with, unless the owner set another.
pub const DEFAULT_REJUDGE_MODEL: &str = "moonshotai/kimi-k3";
const MODEL_KEY: &[u8] = b"ol:rjm";
const MAX_NOTE: usize = 1_500;
const MAX_PER_SIDE: usize = 2;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Statement {
    /// "contributor" (the payer) or "maintainer" (the repo's payout account).
    pub from: String,
    pub note: String,
}

fn statements_key(repo_id: RepoId, number: Number) -> Vec<u8> {
    format!("st:{repo_id}:{number}").into_bytes()
}
fn job_key(repo_id: RepoId, number: Number) -> Vec<u8> {
    format!("ol:rj:{repo_id}:{number}").into_bytes()
}
fn statements(repo_id: RepoId, number: Number) -> Vec<Statement> {
    env::storage_read(&statements_key(repo_id, number)).and_then(|v| serde_json::from_slice(&v).ok()).unwrap_or_default()
}
pub(crate) fn rejudge_model() -> String {
    env::storage_read(MODEL_KEY).map_or(DEFAULT_REJUDGE_MODEL.into(), |v| String::from_utf8_lossy(&v).into_owned())
}

#[near]
impl PatchBond {
    /// Either side of a dispute says its piece (untrusted text the stronger model weighs against the
    /// facts and the diff). At most two each, 1,500 characters each, while the dispute is open.
    pub fn add_statement(&mut self, repo_id: RepoId, number: Number, note: String) {
        let caller = env::predecessor_account_id();
        let d = self.deposits.get(&(repo_id, number)).cloned().unwrap_or_else(|| env::panic_str("No such deposit"));
        require!(matches!(d.status, DepositStatus::Challenged { .. }), "Statements are for an open dispute or challenge");
        require!(env::storage_read(&job_key(repo_id, number)).is_none(), "The re-judge has already started; statements are closed");
        let from = if caller == d.payer {
            "contributor"
        } else if self.repo(repo_id).payout.as_ref() == Some(&caller) {
            "maintainer"
        } else {
            env::panic_str("Only the person who paid the bond or the repo's linked payout account can add a statement")
        };
        let note = note.trim().to_string();
        require!(!note.is_empty() && note.chars().count() <= MAX_NOTE, format!("A statement is 1–{MAX_NOTE} characters"));
        let mut all = statements(repo_id, number);
        require!(all.iter().filter(|s| s.from == from).count() < MAX_PER_SIDE, format!("Each side can add {MAX_PER_SIDE} statements"));
        all.push(Statement { from: from.into(), note });
        env::storage_write(&statements_key(repo_id, number), &serde_json::to_vec(&all).unwrap());
    }

    pub fn get_statements(&self, repo_id: RepoId, number: Number) -> Vec<Statement> {
        statements(repo_id, number)
    }

    /// Owner: the verifiable model disputes are re-judged with (its NEAR AI key must be registered).
    pub fn set_rejudge_model(&mut self, model: String) {
        self.assert_owner();
        require!(!model.is_empty() && model.len() <= 100, "model must be 1–100 characters");
        env::storage_write(MODEL_KEY, model.as_bytes());
    }

    pub fn get_rejudge_model(&self) -> String {
        rejudge_model()
    }

    /// "requested", or "judged" with the verdict hash the contract computed for the re-judge.
    pub fn get_rejudge_job(&self, repo_id: RepoId, number: Number) -> Option<crate::outlayer::TeeJob> {
        env::storage_read(&job_key(repo_id, number)).map(|v| match v.strip_prefix(b"j:") {
            Some(hash) => crate::outlayer::TeeJob { state: "judged".into(), verdict_hash: Some(String::from_utf8_lossy(hash).into_owned()) },
            None => crate::outlayer::TeeJob { state: "requested".into(), verdict_hash: None },
        })
    }

    /// Anyone: re-judge a challenged deposit in the OutLayer enclave with the stronger model and
    /// both sides' on-chain statements. Attach NEAR for the run (~0.01; the unused part comes back).
    #[payable]
    pub fn rejudge_in_tee(&mut self, repo_id: RepoId, number: Number) -> Promise {
        let cfg = outlayer_config().unwrap_or_else(|| env::panic_str("Judging in OutLayer isn't set up on this contract"));
        let d = self.deposits.get(&(repo_id, number)).cloned().unwrap_or_else(|| env::panic_str(&format!("#{number} on repo {repo_id} has no deposit")));
        let DepositStatus::Challenged { verdict, challenger, stake } = d.status.clone() else {
            env::panic_str("Only a challenged or disputed verdict is re-judged")
        };
        require!(d.kind == Kind::Pr, "Only pull requests are re-judged in OutLayer");
        require!(env::storage_read(&job_key(repo_id, number)).is_none(), "This dispute already has an enclave re-judge, or one is running");
        require!(env::attached_deposit() > NearToken::from_yoctonear(0), "Attach NEAR to pay for the OutLayer run (~0.01 NEAR; the unused part is refunded)");
        env::storage_write(&job_key(repo_id, number), REQUESTED);

        let role = if self.repo(repo_id).payout.as_ref() == Some(&challenger) { "maintainer" } else { "contributor" };
        let input = json!({
            "mode": "rejudge",
            "repo_id": repo_id,
            "number": number,
            "github_user": d.github_user,
            "reputation": "new",
            "threshold_bps": self.repo(repo_id).policy.forfeit_threshold_bps,
            "model": rejudge_model(),
            "record_url": cfg.record_url,
            "proposed": format!("{verdict:?}").to_lowercase(),
            "challenger": role,
            "statements": statements(repo_id, number),
        });
        events::tee_requested(repo_id, number, &env::predecessor_account_id());
        outlayer_call(&cfg, input).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_tee_rejudgment(repo_id, number, stake.0 == 0, env::predecessor_account_id(), U128(env::attached_deposit().as_yoctonear())),
        )
    }

    #[private]
    pub fn on_tee_rejudgment(&mut self, repo_id: RepoId, number: Number, free: bool, caller: AccountId, attached: U128) -> String {
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
        match self.apply_rejudgment(repo_id, number, free, out) {
            Ok(what) => what,
            Err(why) => {
                env::storage_remove(&job_key(repo_id, number));
                events::tee_result(repo_id, number, "not_rejudged", &why);
                why
            }
        }
    }
}

impl PatchBond {
    fn apply_rejudgment(&mut self, repo_id: RepoId, number: Number, free: bool, out: Option<TeeOutput>) -> Result<String, String> {
        let out = out.ok_or("The OutLayer run failed or returned nothing")?;
        if (out.repo_id, out.number) != (repo_id, number) {
            return Err(format!("The enclave answered for {}#{}", out.repo_id, out.number));
        }
        if out.status != "judged" {
            return Err(format!("{}: {}", out.status, out.reason.unwrap_or_default()));
        }
        let model = out.model.ok_or("no model")?;
        let expected = rejudge_model();
        if model != expected {
            return Err(format!("The enclave asked {model}, not {expected}"));
        }
        let (req, resp, sig) = (out.request_sha256.ok_or("no request hash")?, out.response_sha256.ok_or("no response hash")?, out.signature.ok_or("no signature")?);
        if !is_hex64(&req) || !is_hex64(&resp) {
            return Err("hashes must be 64 hex characters".into());
        }
        // A model-enclave key signs `<model>:<req>:<resp>`; a gateway key signs `<req>:<resp>` and
        // counts only if registered for this model (`0x…@model`). The pinned enclave program built
        // the request itself, so it asked exactly `model`.
        let provider_text = format!("{model}:{req}:{resp}");
        let gateway_text = format!("{req}:{resp}");
        let (signed_text, signer) = match crate::tee::recover_eip191(&provider_text, &sig) {
            Ok(a) if self.tee_signers.contains(&a) => (provider_text, a),
            _ => {
                let a = crate::tee::recover_eip191(&gateway_text, &sig)?;
                let g = format!("{a}@{model}");
                if !self.tee_signers.contains(&g) {
                    return Err(format!("0x{a} isn't a registered NEAR AI key for {model}"));
                }
                (gateway_text, g)
            }
        };
        let final_verdict = out.verdict.ok_or("no verdict")?;
        let hash = verdict_hash(repo_id, number, &signed_text, &final_verdict);
        env::storage_write(&job_key(repo_id, number), format!("j:{hash}").as_bytes());
        events::tee_verified(repo_id, number, &signer, &model);

        let d = self.deposits.get(&(repo_id, number)).cloned().ok_or("No such deposit")?;
        if !matches!(d.status, DepositStatus::Challenged { .. }) {
            events::tee_result(repo_id, number, "already_decided", &hash);
            return Ok("already_decided".into());
        }
        // Same rule as the server's re-judge: a forfeit needs the stronger model's own signed forfeit
        // above the repo's threshold, with evidence. A disputed *maintainer* forfeit (free) stands on
        // that alone — a human already decided; an AI verdict also needs the rules (a hard fact) to
        // agree. Anything less resolves as a refund: when in doubt, refund.
        let threshold = self.repo(repo_id).policy.forfeit_threshold_bps as u32;
        let signed_forfeit = out.model_verdict.as_deref() == Some("forfeit") && out.confidence_bps.unwrap_or(0) >= threshold && out.evidence.unwrap_or(0) > 0;
        let forfeit = signed_forfeit && (free || final_verdict == "forfeit");
        let verdict = if forfeit { Verdict::Forfeit } else { Verdict::Refund };
        self.finish(repo_id, number, verdict, hash.clone(), d.status);
        let what = format!("{verdict:?}").to_lowercase();
        events::tee_result(repo_id, number, &what, &hash);
        Ok(what)
    }
}
