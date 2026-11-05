//! What a contributor agreed to. The challenge window, forfeit threshold and review window are copied
//! when the bond is paid, so a repo can't change them for a bond already paid. Kept beside the deposit
//! rather than in it, so existing deposits need no migration; those fall back to the current policy.

use near_sdk::{env, near};

use crate::types::*;
use crate::{PatchBond, PatchBondExt};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DepositTerms {
    pub challenge_window_sec: u64,
    pub review_window_sec: u64,
    pub forfeit_threshold_bps: u16,
}

fn key(repo_id: RepoId, number: Number) -> Vec<u8> {
    format!("dt:{repo_id}:{number}").into_bytes()
}

#[near]
impl PatchBond {
    pub fn get_deposit_terms(&self, repo_id: RepoId, number: Number) -> DepositTerms {
        self.terms_of(repo_id, number)
    }
}

impl PatchBond {
    pub(crate) fn fix_terms(&self, repo_id: RepoId, number: Number) {
        let p = &self.repo(repo_id).policy;
        let terms = DepositTerms { challenge_window_sec: p.challenge_window_sec, review_window_sec: p.review_window_sec, forfeit_threshold_bps: p.forfeit_threshold_bps };
        env::storage_write(&key(repo_id, number), &near_sdk::borsh::to_vec(&terms).unwrap());
    }

    pub(crate) fn terms_of(&self, repo_id: RepoId, number: Number) -> DepositTerms {
        env::storage_read(&key(repo_id, number)).and_then(|b| near_sdk::borsh::from_slice(&b).ok()).unwrap_or_else(|| {
            let p = &self.repo(repo_id).policy;
            DepositTerms { challenge_window_sec: p.challenge_window_sec, review_window_sec: p.review_window_sec, forfeit_threshold_bps: p.forfeit_threshold_bps }
        })
    }
}
