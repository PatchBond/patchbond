//! NEP-297 events. The server, web app and indexer read these from receipts' logs:
//! `EVENT_JSON:{"standard":"patchbond","version":"1.0.0","event":"<name>","data":[{...}]}`

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::types::{Kind, Number, RepoId, Verdict};

fn emit(event: &str, data: Value) {
    let log = json!({
        "standard": "patchbond",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

pub fn repo_registered(repo_id: RepoId) {
    emit("repo_registered", json!({ "repo_id": repo_id }));
}

pub fn link(repo_id: RepoId, payout: &AccountId) {
    emit("link", json!({ "repo_id": repo_id, "payout": payout }));
}

pub fn policy(repo_id: RepoId) {
    emit("policy", json!({ "repo_id": repo_id }));
}

#[allow(clippy::too_many_arguments)]
pub fn deposit(
    repo_id: RepoId,
    number: Number,
    kind: Kind,
    payer: &AccountId,
    github_user: &str,
    bond: u128,
    tip: u128,
    open: u32,
) {
    emit(
        "deposit",
        json!({
            "repo_id": repo_id, "number": number, "kind": kind, "payer": payer,
            "github_user": github_user, "bond": U128(bond), "tip": U128(tip), "open": open,
        }),
    );
}

pub fn reviewed(repo_id: RepoId, number: Number, in_window: bool) {
    emit(
        "reviewed",
        json!({ "repo_id": repo_id, "number": number, "in_window": in_window }),
    );
}

#[allow(clippy::too_many_arguments)]
pub fn settle(
    repo_id: RepoId,
    number: Number,
    verdict: Verdict,
    verdict_hash: &str,
    to_payer: u128,
    to_vault: u128,
    to_bounty: u128,
    to_treasury: u128,
) {
    emit(
        "settle",
        json!({
            "repo_id": repo_id, "number": number, "verdict": verdict, "verdict_hash": verdict_hash,
            "to_payer": U128(to_payer), "to_vault": U128(to_vault),
            "to_bounty": U128(to_bounty), "to_treasury": U128(to_treasury),
        }),
    );
}

pub fn bounty_paid(repo_id: RepoId, issue: Number, recipient: &AccountId, amount: u128) {
    emit(
        "bounty_paid",
        json!({ "repo_id": repo_id, "issue": issue, "recipient": recipient, "amount": U128(amount) }),
    );
}

pub fn withdraw(repo_id: RepoId, to: &AccountId, amount: u128) {
    emit(
        "withdraw",
        json!({ "repo_id": repo_id, "to": to, "amount": U128(amount) }),
    );
}

pub fn payout_failed(to: &AccountId, amount: u128) {
    emit(
        "payout_failed",
        json!({ "to": to, "amount": U128(amount) }),
    );
}
