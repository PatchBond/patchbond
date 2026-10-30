//! Sealed security reports: a vulnerability report is encrypted in the reporter's browser to the
//! repo maintainer's key and to the OutLayer enclave judge's key, so neither PatchBond nor the
//! public can read it. The bond is bound to the exact ciphertext (its sha256); the enclave opens
//! it, checks it against the repo's real code, asks NEAR AI, and answers through the same callback
//! as PR judging — the contract checks NEAR AI's signature before anything settles.
//!
//! Keys live here, on-chain:
//! - the maintainer's X25519 key, registered by the repo's linked payout account;
//! - the enclave's X25519 key, which only the pinned enclave program can report (it derives it
//!   from a secret OutLayer generated inside the TEE — no person ever sees the private half).

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseError};

use crate::outlayer::{is_hex64, job_key, outlayer_call, outlayer_config, GAS_FOR_CALLBACK, REQUESTED};
use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

/// Report numbers live above this, so they never collide with PR or issue numbers.
pub const REPORT_BASE: Number = 1_000_000_000_000;
/// A sealed report fits comfortably in OutLayer's free input (32 KB).
pub const MAX_SEALED: usize = 24_000;
const ENCLAVE_KEY: &[u8] = b"ol:ek";

fn report_key_key(repo_id: RepoId) -> Vec<u8> {
    format!("rk:{repo_id}").into_bytes()
}
fn report_hash_key(repo_id: RepoId, number: Number) -> Vec<u8> {
    format!("rh:{repo_id}:{number}").into_bytes()
}
fn read(key: &[u8]) -> Option<String> {
    env::storage_read(key).map(|v| String::from_utf8_lossy(&v).into_owned())
}
fn sha256_hex(s: &str) -> String {
    env::sha256_array(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[near]
impl PatchBond {
    /// The repo's linked payout account: the X25519 public key (hex) reports are sealed to.
    pub fn set_report_key(&mut self, repo_id: RepoId, key: String) {
        let key = key.to_lowercase();
        require!(is_hex64(&key), "The report key must be a 32-byte X25519 public key in hex");
        require!(
            self.repo(repo_id).payout.as_ref() == Some(&env::predecessor_account_id()),
            "Only the repo's linked payout account can set where its security reports are sealed to"
        );
        env::storage_write(&report_key_key(repo_id), key.as_bytes());
        events::report_key(repo_id, &key);
    }

    pub fn get_report_key(&self, repo_id: RepoId) -> Option<String> {
        read(&report_key_key(repo_id))
    }

    /// The enclave judge's X25519 public key — set only by the pinned enclave program itself.
    pub fn get_enclave_key(&self) -> Option<String> {
        read(ENCLAVE_KEY)
    }

    /// Anyone: ask the enclave program for its report key (~0.01 NEAR; the unused part is refunded).
    #[payable]
    pub fn refresh_enclave_key(&mut self) -> Promise {
        let cfg = outlayer_config().unwrap_or_else(|| env::panic_str("Judging in OutLayer isn't set up on this contract"));
        require!(env::attached_deposit() > NearToken::from_yoctonear(0), "Attach NEAR to pay for the OutLayer run (~0.01 NEAR; the unused part is refunded)");
        outlayer_call(&cfg, json!({ "mode": "pubkey" })).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_enclave_key(env::predecessor_account_id(), U128(env::attached_deposit().as_yoctonear())),
        )
    }

    #[private]
    pub fn on_enclave_key(&mut self, caller: AccountId, attached: U128) -> Option<String> {
        let out = match env::promise_result_checked(0, 2048) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(&bytes).ok(),
            Err(PromiseError::TooLong(_)) => None,
            Err(_) => {
                if attached.0 > 0 {
                    Promise::new(caller).transfer(NearToken::from_yoctonear(attached.0)).detach();
                }
                None
            }
        };
        let key = out.as_ref().filter(|o| o["status"] == "pubkey").and_then(|o| o["pubkey"].as_str()).map(str::to_lowercase).filter(|k| is_hex64(k))?;
        env::storage_write(ENCLAVE_KEY, key.as_bytes());
        events::enclave_key(&key);
        Some(key)
    }

    /// Anyone: judge a held report bond in the enclave. `sealed` is the exact envelope the bond was
    /// paid for (its sha256 is checked); the enclave also seals its reasons to the maintainer.
    #[payable]
    pub fn judge_report_in_tee(&mut self, repo_id: RepoId, number: Number, sealed: String) -> Promise {
        let cfg = outlayer_config().unwrap_or_else(|| env::panic_str("Judging in OutLayer isn't set up on this contract"));
        let d = self.deposits.get(&(repo_id, number)).cloned().unwrap_or_else(|| env::panic_str(&format!("Report {number} on repo {repo_id} has no bond")));
        require!(number >= REPORT_BASE && d.kind == Kind::Issue, "That isn't a sealed report");
        require!(sealed.len() <= MAX_SEALED, format!("A sealed report is at most {MAX_SEALED} bytes"));
        require!(d.status == DepositStatus::Held, "Only a held bond (no verdict yet) can be judged");
        require!(env::storage_read(&job_key(repo_id, number)).is_none(), "This report already has an enclave judgment, or one is running");
        require!(read(&report_hash_key(repo_id, number)).as_deref() == Some(sha256_hex(&sealed).as_str()), "That isn't the report this bond was paid for (sha256 differs)");
        let maintainer_key = self.get_report_key(repo_id).unwrap_or_else(|| env::panic_str("This repo hasn't enabled sealed reports"));
        require!(env::attached_deposit() > NearToken::from_yoctonear(0), "Attach NEAR to pay for the OutLayer run (~0.01 NEAR; the unused part is refunded)");
        env::storage_write(&job_key(repo_id, number), REQUESTED);

        let rep = self.reputation.get(&d.payer).cloned().unwrap_or_default();
        let reputation = if rep.forfeits > 0 { "has_forfeits" } else if rep.refunds > 0 { "proven" } else { "new" };
        let input = json!({
            "mode": "report",
            "repo_id": repo_id,
            "number": number,
            "github_user": d.github_user,
            "reputation": reputation,
            "threshold_bps": self.repo(repo_id).policy.forfeit_threshold_bps,
            "model": cfg.model,
            "record_url": cfg.record_url,
            "sealed": sealed,
            "maintainer_key": maintainer_key,
        });
        events::tee_requested(repo_id, number, &env::predecessor_account_id());
        outlayer_call(&cfg, input).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_tee_judgment(repo_id, number, env::predecessor_account_id(), U128(env::attached_deposit().as_yoctonear())),
        )
    }
}

impl PatchBond {
    /// A report bond: only for repos that enabled sealed reports, bound to the ciphertext's hash.
    pub(crate) fn check_report(&self, repo_id: RepoId, number: Number, sealed_sha256: &str) {
        require!(number >= REPORT_BASE, format!("Report numbers start at {REPORT_BASE}"));
        require!(is_hex64(sealed_sha256), "sealed_sha256 must be 64 hex characters");
        require!(self.get_report_key(repo_id).is_some(), "This repo hasn't enabled sealed reports; your transfer was refunded");
        require!(self.get_enclave_key().is_some(), "The enclave judge has no report key yet; your transfer was refunded");
    }

    pub(crate) fn bind_report(&mut self, repo_id: RepoId, number: Number, sealed_sha256: &str) {
        env::storage_write(&report_hash_key(repo_id, number), sealed_sha256.as_bytes());
    }
}
