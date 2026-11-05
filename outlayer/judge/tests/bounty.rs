//! Bounty mode: is a PR a merged fix for the issue, bound to the account the bounty would go to?
//! Starts from the real GitHub JSON of PatchBond/demo-widget#2 (unmerged) and varies it.

use patchbond_judge::{check_fix, names_payout, Input};
use serde_json::{json, Value};

const REPO: u64 = 1442281556;

fn pr() -> Value {
    serde_json::from_str(include_str!("fixtures/demo-widget-2.json")).unwrap()
}

fn input(github_user: &str, recipient: &str) -> Input {
    Input { mode: "bounty".into(), repo_id: REPO, number: 1, fix: 2, github_user: github_user.into(), recipient: recipient.into(), ..Default::default() }
}

fn merged(body: &str) -> Value {
    let mut p = pr();
    p["merged"] = json!(true);
    p["body"] = json!(body);
    p
}

fn reason(i: &Input, p: &Value) -> String {
    let out = check_fix(i, p);
    assert_eq!(out.status, "skip", "{out:?}");
    out.reason.unwrap()
}

#[test]
fn the_real_unmerged_pr_is_refused() {
    assert_eq!(reason(&input("Gbangbolaoluwagbemiga", "alice.testnet"), &pr()), "#2 isn't merged");
}

#[test]
fn a_bonded_merged_fix_that_names_the_account_passes() {
    let out = check_fix(&input("gbangbolaoluwagbemiga", "alice.testnet"), &merged("Fixes #1 with a real lock and a test.\n\nPatchBond: alice.testnet"));
    assert_eq!(out.status, "fix_ok");
    assert_eq!(out.recipient.as_deref(), Some("alice.testnet"));
    assert_eq!(out.author.as_deref(), Some("Gbangbolaoluwagbemiga"));
    assert_eq!(serde_json::to_value(&out).unwrap()["fix"], 2);
}

#[test]
fn another_repo_or_issue_is_refused() {
    let mut other = merged("Fixes #1");
    other["base"]["repo"]["id"] = json!(42);
    assert!(reason(&input("", "a.testnet"), &other).contains("isn't a pull request into this repo"));
    let mut p = merged("Fixes #3");
    p["title"] = json!("Queue lock");
    assert!(reason(&input("", "a.testnet"), &p).contains("doesn't say it fixes #1"));
}

#[test]
fn the_pr_must_name_the_account() {
    let unnamed = merged("Fixes #1 with a lock.");
    assert!(reason(&input("", "alice.testnet"), &unnamed).contains("add a line \"PatchBond: alice.testnet\""));
    let named = merged("Fixes #1 with a lock.\n\nPatchBond: alice.testnet\n");
    assert_eq!(check_fix(&input("", "alice.testnet"), &named).status, "fix_ok");
    assert_eq!(reason(&input("", "bob.testnet"), &named), "#2 doesn't name bob.testnet (add a line \"PatchBond: bob.testnet\" to its description)");
}

#[test]
fn the_payout_line_is_a_line_of_its_own() {
    assert!(names_payout("PatchBond: alice.near", "alice.near"));
    assert!(names_payout("  patchbond payout: `alice.near`  ", "alice.near"));
    assert!(names_payout("x\r\nPATCHBOND: alice.near\r\n", "alice.near"));
    assert!(!names_payout("Pay PatchBond: alice.near please", "alice.near"));
    assert!(!names_payout("PatchBond: alice.near.evil", "alice.near"));
    assert!(!names_payout("PatchBond:", ""));
}

/// A bond names a GitHub user but proves nothing: anyone can pay one on a merged PR, naming its real
/// author, then claim the bounty for themselves. Only the PR's own text can say who gets paid.
#[test]
fn a_bond_on_someone_elses_merged_fix_cant_take_its_bounty() {
    let squatter = input("Gbangbolaoluwagbemiga", "squatter.testnet");
    assert_eq!(check_fix(&squatter, &merged("Fixes #1 with a real loop")).status, "skip");
}
