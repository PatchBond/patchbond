//! Slop funds the fix, without PatchBond's server (`src/bounty.rs`): a forfeit on a PR that claimed
//! to fix #7 becomes a bounty on #7, and anyone can claim it for a merged fix. The OutLayer enclave
//! checks GitHub; a mock stands in for `outlayer.near` and returns the enclave program's answer.
//! Run: `cargo test -p patchbond-vault --test bounty`

mod common;
use common::*;

static MOCK_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

struct T {
    e: Env,
    ol: Contract,
    share: u128,
}

/// alice's slop PR #10 claimed to fix #7 and was forfeited: 90% of its bond is a bounty on #7.
/// Then OutLayer is configured with `exclusive` on.
async fn setup_bounty() -> anyhow::Result<T> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 10, bond, json!({ "fixes_issue": 7 })).await?.into_result()?;
    e.settle(REPO, 10, "forfeit").await?.into_result()?;
    let share = bond - bond / 10;
    assert_eq!(u(&e.view("get_bounty", json!({ "repo_id": REPO, "issue": 7 })).await?), share);

    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| near_workspaces::compile_project("../mock-outlayer")).await?).await?;
    e.owner
        .call(e.pb.id(), "set_outlayer")
        .args_json(json!({ "config": {
            "account": ol.id(), "project_id": "patchbond.testnet/judge", "version_key": "ab".repeat(32),
            "model": "z-ai/glm-5.3-flash", "record_url": null,
            "secrets_owner": e.owner.id(), "secrets_profile": "judge", "exclusive": true,
        } }))
        .transact()
        .await?
        .into_result()?;
    Ok(T { e, ol, share })
}

impl T {
    /// bob claims #7's bounty for fix `fix`, paid to `recipient`, with the enclave answering `answer`.
    async fn claim(&self, fix: u64, recipient: &Account, answer: Value) -> anyhow::Result<ExecutionFinalResult> {
        self.ol.call("set_answer").args_json(json!({ "answer": answer.to_string() })).transact().await?.into_result()?;
        Ok(self
            .e
            .bob
            .call(self.e.pb.id(), "claim_bounty_in_tee")
            .args_json(json!({ "repo_id": REPO, "issue": 7, "fix": fix, "recipient": recipient.id() }))
            .deposit(NearToken::from_millinear(10))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    async fn bounty(&self) -> anyhow::Result<u128> {
        Ok(u(&self.e.view("get_bounty", json!({ "repo_id": REPO, "issue": 7 })).await?))
    }
}

fn ok(fix: u64, recipient: &Account) -> Value {
    json!({ "repo_id": REPO, "number": 7, "status": "fix_ok", "fix": fix, "recipient": recipient.id(), "author": "bob-gh" })
}

/// The `bounty_claim` event's final outcome ("paid" / "not_paid") and detail.
fn outcome(r: &ExecutionFinalResult) -> (String, String) {
    r.logs()
        .iter()
        .filter_map(|l| serde_json::from_str::<Value>(l.strip_prefix("EVENT_JSON:")?).ok())
        .filter(|v| v["event"] == "bounty_claim" && v["data"][0]["outcome"] != "requested")
        .map(|v| (v["data"][0]["outcome"].as_str().unwrap().to_string(), v["data"][0]["detail"].as_str().unwrap().to_string()))
        .next_back()
        .unwrap_or_default()
}

#[tokio::test]
async fn a_merged_fix_confirmed_in_the_enclave_gets_the_bounty_and_the_oracle_cannot_pay_it() -> anyhow::Result<()> {
    let t = setup_bounty().await?;
    let e = &t.e;

    let r = e.oracle.call(e.pb.id(), "pay_bounty").args_json(json!({ "repo_id": REPO, "issue": 7, "recipient": e.amaka.id() })).gas(Gas::from_tgas(100)).transact().await?;
    assert!(failure_text(&r).contains("only on the OutLayer enclave"), "exclusive: the oracle can't pay a bounty: {}", failure_text(&r));

    let r = t.claim(11, &e.bob, ok(11, &e.bob)).await?;
    assert_eq!(outcome(&r), ("paid".into(), "bob-gh".into()), "{:?}", r.logs());
    assert_eq!(e.balance(&e.bob).await?, t.share, "the real fixer got the slop's bond");
    assert_eq!(t.bounty().await?, 0);

    let again = t.claim(11, &e.bob, ok(11, &e.bob)).await?;
    assert!(failure_text(&again).contains("has no bounty"), "paid once");
    Ok(())
}

#[tokio::test]
async fn a_refused_or_mismatched_check_pays_nothing_and_the_bounty_stays_claimable() -> anyhow::Result<()> {
    let t = setup_bounty().await?;
    let e = &t.e;

    let skip = json!({ "repo_id": REPO, "number": 7, "status": "skip", "fix": 11, "reason": "#11 isn't merged" });
    let r = t.claim(11, &e.bob, skip).await?;
    assert_eq!(outcome(&r), ("not_paid".into(), "skip: #11 isn't merged".into()));

    // The enclave confirmed a different recipient, PR or issue: nothing moves.
    for bad in [ok(11, &e.amaka), ok(12, &e.bob), json!({ "repo_id": REPO, "number": 8, "status": "fix_ok", "fix": 11, "recipient": e.bob.id() })] {
        let r = t.claim(11, &e.bob, bad).await?;
        assert_eq!(outcome(&r).0, "not_paid", "{:?}", r.logs());
    }
    // A failed run (OutLayer returns null).
    let r = t.claim(11, &e.bob, Value::Null).await?;
    assert_eq!(outcome(&r), ("not_paid".into(), "The OutLayer run failed or returned nothing".into()));

    assert_eq!(t.bounty().await?, t.share, "still there");
    assert_eq!(e.balance(&e.bob).await?, 0);

    // …and the next genuine claim goes through.
    let r = t.claim(11, &e.bob, ok(11, &e.bob)).await?;
    assert_eq!(outcome(&r).0, "paid");
    assert_eq!(e.balance(&e.bob).await?, t.share);
    Ok(())
}

#[tokio::test]
async fn a_bonded_fix_pays_only_the_account_that_paid_its_bond() -> anyhow::Result<()> {
    let t = setup_bounty().await?;
    let e = &t.e;
    // alice (whose slop made the bounty) comes back with a real fix #12 and bonds it.
    let bond = e.quote(REPO, Some(&e.alice)).await?;
    e.pay(&e.alice, REPO, 12, bond, json!({})).await?.into_result()?;

    let r = t.claim(12, &e.bob, ok(12, &e.bob)).await?;
    assert!(failure_text(&r).contains("goes to the account that paid it"), "{}", failure_text(&r));

    let before = e.balance(&e.alice).await?;
    t.claim(12, &e.alice, ok(12, &e.alice)).await?.into_result()?;
    let (args, _): (String, NearToken) = t.ol.view("last_request").await?.json()?;
    let input: Value = serde_json::from_str(serde_json::from_str::<Value>(&args)?["input_data"].as_str().unwrap())?;
    assert_eq!(input["mode"], "bounty");
    assert_eq!(input["github_user"], "alice", "the enclave is told whose PR it must be");
    assert_eq!(e.balance(&e.alice).await? - before, t.share);
    Ok(())
}
