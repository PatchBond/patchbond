//! Who moves the price. The bond curve reads the repo's queue of open deposits, so one payer could
//! fill the queue with plausible PRs — refunded later, costing them only locked capital — and push
//! the bond up for every honest newcomer. Here each payer counts at most `PER_PAYER` toward the
//! queue everyone else is priced on; their own extra deposits raise only their own next bond.
//!
//! Kept incrementally under raw storage keys (no migration): `eo:<repo>` is the shared count,
//! Σ min(open_by_payer, PER_PAYER); `po:<repo>:<payer>` is each payer's open deposits. A repo whose
//! deposits predate this starts from `repo.open`, and those deposits leave it one at a time.

use near_sdk::{env, AccountId};

use crate::types::RepoId;

/// How many of one payer's open deposits count toward everyone else's price.
pub const PER_PAYER: u32 = 2;

fn shared_key(repo_id: RepoId) -> Vec<u8> {
    format!("eo:{repo_id}").into_bytes()
}
fn payer_key(repo_id: RepoId, payer: &AccountId) -> Vec<u8> {
    format!("po:{repo_id}:{payer}").into_bytes()
}
fn read(key: &[u8]) -> Option<u32> {
    env::storage_read(key).and_then(|v| v.try_into().ok()).map(u32::from_le_bytes)
}
fn write(key: &[u8], n: u32) {
    if n == 0 {
        env::storage_remove(key);
    } else {
        env::storage_write(key, &n.to_le_bytes());
    }
}

/// The shared queue, falling back to the repo's raw count for deposits made before this existed.
fn shared(repo_id: RepoId, legacy_open: u32) -> u32 {
    read(&shared_key(repo_id)).unwrap_or(legacy_open)
}

pub fn own(repo_id: RepoId, payer: &AccountId) -> u32 {
    read(&payer_key(repo_id, payer)).unwrap_or(0)
}

/// The queue length `payer` is priced on: everyone's capped share, with their own deposits in full.
pub fn priced_open(repo_id: RepoId, legacy_open: u32, payer: Option<&AccountId>) -> u32 {
    let shared = shared(repo_id, legacy_open);
    match payer {
        Some(p) => {
            let mine = own(repo_id, p);
            shared.saturating_sub(mine.min(PER_PAYER)) + mine
        }
        None => shared,
    }
}

/// A deposit by `payer` joined the queue. `legacy_open` is `repo.open` before this deposit.
pub fn join(repo_id: RepoId, legacy_open: u32, payer: &AccountId) {
    let mine = own(repo_id, payer);
    let shared = shared(repo_id, legacy_open);
    write(&payer_key(repo_id, payer), mine + 1);
    // The shared key stays even at 0, so the legacy fallback is used only once.
    env::storage_write(&shared_key(repo_id), &(shared + u32::from(mine < PER_PAYER)).to_le_bytes());
}

/// A deposit by `payer` left the queue. `legacy_open` is `repo.open` before it left.
pub fn leave(repo_id: RepoId, legacy_open: u32, payer: &AccountId) {
    let mine = own(repo_id, payer);
    let shared = shared(repo_id, legacy_open);
    // A deposit from before this existed has no per-payer count: it was counted in full.
    let counted = mine == 0 || mine <= PER_PAYER;
    write(&payer_key(repo_id, payer), mine.saturating_sub(1));
    env::storage_write(&shared_key(repo_id), &shared.saturating_sub(u32::from(counted)).to_le_bytes());
}
