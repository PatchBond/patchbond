//! Slop funds the fix, without PatchBond's server. A forfeit on a PR that claimed to fix issue #N
//! becomes a bounty on #N; anyone can ask the contract to pay it to a merged fix. The OutLayer
//! enclave reads GitHub itself — the fix PR is merged into this repo, its title or body says it
//! fixes #N, and it's bound to the recipient — and the contract pays only on that answer.
//!
//! Who gets paid: the NEAR account the PR names on a line of its own, `PatchBond: alice.near`, bonded
//! or not. A bond proves nothing here: anyone can pay one on someone else's PR. Only the author and
//! people with write access to the repo can edit a PR's text.
//!
//! There's no model here, so no NEAR AI signature: what's trusted is OutLayer's attested worker
//! running the pinned wasm, and GitHub. With `exclusive` on, the oracle can't pay bounties at all.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseError};

use crate::outlayer::{outlayer_call, outlayer_config, GAS_FOR_CALLBACK, REQUESTED};
use crate::payout::Fallback;
use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

/// What the enclave prints in "bounty" mode (`outlayer/judge/src/lib.rs` `BountyOutput`).
#[near(serializers = [json])]
#[derive(Debug)]
pub struct BountyOutput {
    pub repo_id: RepoId,
    /// The issue.
    pub number: Number,
    /// "fix_ok" | "skip".
    pub status: String,
    pub reason: Option<String>,
    pub fix: Option<Number>,
    pub recipient: Option<String>,
    pub author: Option<String>,
}

/// Set while a claim on (repo, issue) runs in the enclave; one claim at a time.
fn job_key(repo_id: RepoId, issue: Number) -> Vec<u8> {
    format!("ol:bj:{repo_id}:{issue}").into_bytes()
}

#[near]
impl PatchBond {
    /// Anyone: pay issue #`issue`'s bounty to the merged fix `fix`, checked in the OutLayer enclave.
    /// Attach NEAR for the run (~0.01; the unused part comes back).
    #[payable]
    pub fn claim_bounty_in_tee(&mut self, repo_id: RepoId, issue: Number, fix: Number, recipient: AccountId) -> Promise {
        let cfg = outlayer_config().unwrap_or_else(|| env::panic_str("Checking fixes in OutLayer isn't set up on this contract"));
        require!(self.bounties.get(&(repo_id, issue)).is_some_and(|b| b.0 > 0), format!("Issue #{issue} on repo {repo_id} has no bounty"));
        require!(fix != issue, "The fix is a pull request, not the issue itself");
        require!(env::storage_read(&job_key(repo_id, issue)).is_none(), "A claim on this bounty is already being checked");
        require!(env::attached_deposit() > NearToken::from_yoctonear(0), "Attach NEAR to pay for the OutLayer run (~0.01 NEAR; the unused part is refunded)");
        env::storage_write(&job_key(repo_id, issue), REQUESTED);
        let input = json!({
            "mode": "bounty",
            "repo_id": repo_id,
            "number": issue,
            "fix": fix,
            "recipient": recipient,
        });
        events::bounty_claim(repo_id, issue, fix, &recipient, "requested", "");
        outlayer_call(&cfg, input).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_tee_bounty(repo_id, issue, fix, recipient, env::predecessor_account_id(), U128(env::attached_deposit().as_yoctonear())),
        )
    }

    #[private]
    pub fn on_tee_bounty(&mut self, repo_id: RepoId, issue: Number, fix: Number, recipient: AccountId, caller: AccountId, attached: U128) -> String {
        env::storage_remove(&job_key(repo_id, issue));
        let out: Option<BountyOutput> = match env::promise_result_checked(0, 4096) {
            Ok(bytes) => serde_json::from_slice(&bytes).ok(),
            Err(PromiseError::TooLong(_)) => None,
            Err(_) => {
                if attached.0 > 0 {
                    Promise::new(caller).transfer(NearToken::from_yoctonear(attached.0)).detach();
                }
                None
            }
        };
        match check(repo_id, issue, fix, &recipient, out) {
            Ok(author) => match self.take_bounty(repo_id, issue, &recipient) {
                Some(p) => {
                    p.detach();
                    events::bounty_claim(repo_id, issue, fix, &recipient, "paid", &author);
                    "paid".into()
                }
                // Paid by another route while the enclave ran.
                None => {
                    events::bounty_claim(repo_id, issue, fix, &recipient, "not_paid", "no bounty left");
                    "no bounty left".into()
                }
            },
            Err(why) => {
                events::bounty_claim(repo_id, issue, fix, &recipient, "not_paid", &why);
                why
            }
        }
    }
}

/// The enclave's answer must be about exactly this claim. Returns the fix's GitHub author.
fn check(repo_id: RepoId, issue: Number, fix: Number, recipient: &AccountId, out: Option<BountyOutput>) -> Result<String, String> {
    let out = out.ok_or("The OutLayer run failed or returned nothing")?;
    if (out.repo_id, out.number, out.fix) != (repo_id, issue, Some(fix)) {
        return Err(format!("The enclave answered for {}#{} (fix {:?})", out.repo_id, out.number, out.fix));
    }
    if out.status != "fix_ok" {
        return Err(format!("{}: {}", out.status, out.reason.unwrap_or_default()));
    }
    if out.recipient.as_deref() != Some(recipient.as_str()) {
        return Err("The enclave confirmed a different recipient".into());
    }
    Ok(out.author.unwrap_or_default())
}

impl PatchBond {
    /// Removes issue #`issue`'s bounty and sends it to `recipient` (claimable if the transfer fails).
    pub(crate) fn take_bounty(&mut self, repo_id: RepoId, issue: Number, recipient: &AccountId) -> Option<Promise> {
        let amount = self.bounties.remove(&(repo_id, issue)).map_or(0, |b| b.0);
        if amount == 0 {
            return None;
        }
        let held = self.bounty_held.get(&repo_id).map_or(0, |b| b.0);
        self.bounty_held.insert(repo_id, U128(held.saturating_sub(amount)));
        events::bounty_paid(repo_id, issue, recipient, amount);
        // Bounties are in the repo's currency: it can't switch while one is unpaid.
        let currency = self.currency_of(repo_id);
        Some(self.send(recipient.clone(), amount, currency, Fallback::Claimable))
    }
}
