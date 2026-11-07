//! Findings from outside screening, each written as a test that failed first: a squatted bond on
//! someone else's PR, reputation earned on a stranger's work, a relabelled enclave verdict, a repo
//! changing its terms after a bond was paid, and a bond nobody decides.
//! Run: `cargo test -p patchbond-vault --test screening`

mod common;
use common::*;

static MOCK_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

fn fx() -> Value {
    serde_json::from_str(include_str!("fixtures/proofs.json")).unwrap()
}

struct T {
    e: Env,
    ol: Contract,
}

/// REPO linked to amaka, OutLayer on with `exclusive`, the fixture keys registered.
async fn setup_screening() -> anyhow::Result<T> {
    configure(setup().await?).await
}

async fn configure(e: Env) -> anyhow::Result<T> {
    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| wasm_of("../mock-outlayer", "mock_outlayer.wasm")).await?).await?;
    let f = fx();
    e.owner.call(e.pb.id(), "set_tee_signers").args_json(json!({ "signers": [f["enclave_signer"], f["gateway_signer"]] })).transact().await?.into_result()?;
    e.owner
        .call(e.pb.id(), "set_outlayer")
        .args_json(json!({ "config": {
            "account": ol.id(), "project_id": "patchbond.testnet/judge", "version_key": "ab".repeat(32),
            "model": "z-ai/glm-5.3-flash", "record_url": null, "secrets_owner": null, "secrets_profile": null, "exclusive": true,
        } }))
        .transact()
        .await?
        .into_result()?;
    e.owner.call(e.pb.id(), "set_rejudge_model").args_json(json!({ "model": "moonshotai/kimi-k3" })).transact().await?.into_result()?;
    e.link(REPO, &e.amaka).await?;
    Ok(T { e, ol })
}

impl T {
    async fn bond(&self, who: &Account, number: u64) -> anyhow::Result<u128> {
        let b = self.e.quote(REPO, Some(who)).await?;
        self.e.pay(who, REPO, number, b, json!({})).await?.into_result()?;
        Ok(b)
    }

    async fn enclave(&self, method: &str, number: u64, mut answer: Value) -> anyhow::Result<ExecutionFinalResult> {
        answer["repo_id"] = json!(REPO);
        answer["number"] = json!(number);
        self.ol.call("set_answer").args_json(json!({ "answer": answer.to_string() })).transact().await?.into_result()?;
        Ok(self.e.bob.call(self.e.pb.id(), method).args_json(json!({ "repo_id": REPO, "number": number })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?)
    }

    async fn confirm(&self, number: u64, proof: &Value) -> anyhow::Result<ExecutionFinalResult> {
        Ok(self.e.bob.call(self.e.pb.id(), "confirm_tee_forfeit").args_json(json!({ "repo_id": REPO, "number": number, "proof": proof })).gas(Gas::from_tgas(150)).transact().await?)
    }

    /// Fifteen sandbox days take too long to wait out, so the deposit's stored timestamp moves back.
    async fn age_deposit(&self, number: u64, by_ms: u64) -> anyhow::Result<()> {
        let at = self.e.view("get_deposit", json!({ "repo_id": REPO, "number": number })).await?["created_at"].as_u64().unwrap();
        let (now, then) = (at.to_le_bytes(), (at - by_ms).to_le_bytes());
        for (key, mut value) in self.e.pb.view_state().await? {
            if let Some(i) = value.windows(8).position(|w| w == now) {
                value[i..i + 8].copy_from_slice(&then);
                self.e.worker.patch_state(self.e.pb.id(), &key, &value).await?;
            }
        }
        Ok(())
    }

    async fn status(&self, number: u64) -> anyhow::Result<Value> {
        Ok(self.e.view("get_deposit", json!({ "repo_id": REPO, "number": number })).await?["status"].clone())
    }

    async fn refunds(&self, who: &Account) -> anyhow::Result<u64> {
        Ok(self.e.view("get_reputation", json!({ "account_id": who.id() })).await?["refunds"].as_u64().unwrap_or(0))
    }
}

fn refund_answer() -> Value {
    json!({ "status": "judged", "verdict": "refund", "model_verdict": "refund", "confidence_bps": 9000, "evidence": 1, "model": "z-ai/glm-5.3-flash",
            "request_sha256": fx()["forfeit"]["1"]["output"]["request_sha256"], "response_sha256": fx()["forfeit"]["1"]["output"]["response_sha256"], "signature": fx()["forfeit"]["1"]["output"]["signature"] })
}

/// Finding: a stranger's bond on someone's merged PR made the contract insist the bounty go to the
/// stranger, so the real author couldn't claim it.
#[tokio::test]
async fn a_bond_squatted_on_a_merged_fix_cannot_block_its_real_author() -> anyhow::Result<()> {
    // A forfeit from before OutLayer was switched on gives issue 7 a bounty.
    let e = setup().await?;
    let b = e.quote(REPO, Some(&e.alice)).await?;
    e.pay(&e.alice, REPO, 10, b, json!({ "fixes_issue": 7 })).await?.into_result()?;
    e.settle(REPO, 10, "forfeit").await?.into_result()?;
    let t = configure(e).await?;
    let e = &t.e;

    // alice squats on PR 11, which isn't hers; amaka wrote it and names herself in it.
    t.bond(&e.alice, 11).await?;
    let answer = json!({ "repo_id": REPO, "number": 7, "status": "fix_ok", "fix": 11, "recipient": e.amaka.id(), "author": "amaka-gh" });
    t.ol.call("set_answer").args_json(json!({ "answer": answer.to_string() })).transact().await?.into_result()?;
    let r = e.bob.call(e.pb.id(), "claim_bounty_in_tee").args_json(json!({ "repo_id": REPO, "issue": 7, "fix": 11, "recipient": e.amaka.id() })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "{}", failure_text(&r));
    assert_eq!(u(&e.view("get_bounty", json!({ "repo_id": REPO, "issue": 7 })).await?), 0, "paid to the name in the PR");
    Ok(())
}

/// Finding: paying a bond on a stranger's good PR earned the payer the refund on their record.
#[tokio::test]
async fn a_refund_earns_reputation_only_if_the_author_named_the_payer() -> anyhow::Result<()> {
    let t = setup_screening().await?;
    let e = &t.e;
    t.bond(&e.alice, 1).await?;
    t.enclave("judge_in_tee", 1, refund_answer()).await?.into_result()?;
    assert_eq!(t.status(1).await?["settled"]["verdict"], "refund", "the bond itself still comes back");
    assert_eq!(t.refunds(&e.alice).await?, 0, "the PR didn't name alice");

    t.bond(&e.alice, 2).await?;
    let mut a = refund_answer();
    a["author_linked"] = json!(true);
    t.enclave("judge_in_tee", 2, a).await?.into_result()?;
    assert_eq!(t.refunds(&e.alice).await?, 1, "this PR names alice");
    Ok(())
}

/// Finding (known limit until now): a compromised worker could relabel NEAR AI's signed refund as a
/// forfeit. The signed bytes now decide, and they say refund.
#[tokio::test]
async fn a_relabelled_refund_never_forfeits_because_the_signed_bytes_decide() -> anyhow::Result<()> {
    let t = setup_screening().await?;
    let e = &t.e;
    let f = fx();
    let before = e.balance(&e.alice).await?;
    let b = t.bond(&e.alice, 1).await?;
    t.enclave("judge_in_tee", 1, f["relabelled"]["output"].clone()).await?.into_result()?;
    assert_eq!(t.status(1).await?, "held", "an enclave's word alone moves nothing");

    let r = t.confirm(1, &f["relabelled"]["proof"]).await?;
    assert!(failure_text(&r).contains("TEE proof rejected: the model said"), "{}", failure_text(&r));
    assert_eq!(t.status(1).await?, "held");
    assert_eq!(e.balance(&e.alice).await?, before - b);
    assert_eq!(u(&e.view("get_totals", json!({})).await?["forfeited"]), 0, "nothing was forfeited");
    Ok(())
}

#[tokio::test]
async fn a_signed_forfeit_needs_its_bytes_and_they_must_be_the_ones_the_enclave_reported() -> anyhow::Result<()> {
    let t = setup_screening().await?;
    let e = &t.e;
    let f = fx();
    t.bond(&e.alice, 1).await?;
    t.bond(&e.alice, 2).await?;
    t.enclave("judge_in_tee", 1, f["forfeit"]["1"]["output"].clone()).await?.into_result()?;

    assert!(failure_text(&t.confirm(2, &f["forfeit"]["2"]["proof"]).await?).contains("no enclave forfeit"), "PR 2 was never judged");
    assert!(failure_text(&t.confirm(1, &f["forfeit"]["2"]["proof"]).await?).contains("aren't the ones the enclave reported"), "another PR's genuine proof");

    t.confirm(1, &f["forfeit"]["1"]["proof"]).await?.into_result()?;
    assert_eq!(t.status(1).await?["settled"]["verdict"], "forfeit");
    assert!(failure_text(&t.confirm(1, &f["forfeit"]["1"]["proof"]).await?).contains("settled"), "once");
    Ok(())
}

#[tokio::test]
async fn a_disputed_forfeit_also_stands_only_on_its_signed_bytes() -> anyhow::Result<()> {
    let t = setup_screening().await?;
    let e = &t.e;
    let f = fx();
    t.bond(&e.alice, 4).await?;
    e.amaka.call(e.pb.id(), "settle").args_json(json!({ "repo_id": REPO, "number": 4, "verdict": "forfeit", "verdict_hash": ZERO_HASH })).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    e.alice.call(e.pb.id(), "dispute").args_json(json!({ "repo_id": REPO, "number": 4 })).transact().await?.into_result()?;
    t.enclave("rejudge_in_tee", 4, f["rejudge"]["output"].clone()).await?.into_result()?;
    assert!(t.status(4).await?.get("challenged").is_some(), "{}", t.status(4).await?);

    t.confirm(4, &f["rejudge"]["proof"]).await?.into_result()?;
    assert_eq!(t.status(4).await?["settled"]["verdict"], "forfeit");
    Ok(())
}

/// Finding: the window and threshold were read when the verdict landed, so a repo could cut them
/// after a contributor paid. They're now the ones in force at the deposit.
#[tokio::test]
async fn a_repo_cannot_change_the_terms_of_a_bond_already_paid() -> anyhow::Result<()> {
    let e = setup().await?;
    e.link(REPO, &e.amaka).await?;
    let policy = |window: u64, bps: u64| json!({ "enabled": true, "base_bond": (2 * USDC).to_string(), "min_bond": (USDC / 4).to_string(), "max_bond": (50 * USDC).to_string(),
        "target_open": 8, "review_window_sec": 604_800, "challenge_window_sec": window, "forfeit_threshold_bps": bps });
    let set = |p: Value| e.amaka.call(e.pb.id(), "set_policy").args_json(json!({ "repo_id": REPO, "policy": p })).transact();

    set(policy(259_200, 8_500)).await?.into_result()?;
    let b = e.quote(REPO, Some(&e.alice)).await?;
    e.pay(&e.alice, REPO, 1, b, json!({})).await?.into_result()?;
    set(policy(0, 5_000)).await?.into_result()?;

    e.settle(REPO, 1, "refund").await?.into_result()?;
    let status = e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?["status"].clone();
    assert!(status.get("proposed").is_some(), "the 72 h window alice paid under still applies: {status}");
    Ok(())
}

/// Finding: an undecided bond had no on-chain exit; if the server and the maintainer both went
/// quiet it stayed locked. After 14 days anyone can return it, and it earns no reputation.
#[tokio::test]
async fn an_undecided_bond_comes_back_on_chain_after_the_timeout() -> anyhow::Result<()> {
    let t = setup_screening().await?;
    let e = &t.e;
    let before = e.balance(&e.alice).await?;
    t.bond(&e.alice, 1).await?;
    let refund = || e.bob.call(e.pb.id(), "refund_expired").args_json(json!({ "repo_id": REPO, "number": 1 })).gas(Gas::from_tgas(100)).transact();

    let early = refund().await?;
    assert!(failure_text(&early).contains("until"), "{}", failure_text(&early));

    t.age_deposit(1, 15 * 24 * 3_600_000).await?;
    refund().await?.into_result()?;
    assert_eq!(t.status(1).await?["settled"]["verdict"], "refund");
    assert_eq!(e.balance(&e.alice).await?, before, "every cent back");
    assert_eq!(t.refunds(&e.alice).await?, 0, "waiting out the clock earns no reputation");
    Ok(())
}
