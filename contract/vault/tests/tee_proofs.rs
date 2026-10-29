//! Forfeits that rest on NEAR AI's signature, not our server's word: once the owner registers the
//! attested enclave keys, the oracle can only forfeit what a registered TEE signed as a forfeit.
//! `fixtures/tee.json` holds a genuine NEAR AI Cloud signature (server/scripts/make-tee-fixtures.ts).
//! Run: `cargo test -p patchbond-vault --test tee_proofs`

mod common;
use common::*;

fn fixtures() -> Value {
    serde_json::from_str(include_str!("fixtures/tee.json")).unwrap()
}

async fn set_signers(e: &Env, by: &Account, signers: &[&str]) -> anyhow::Result<ExecutionFinalResult> {
    Ok(by.call(e.pb.id(), "set_tee_signers").args_json(json!({ "signers": signers })).transact().await?)
}

async fn forfeit_with(e: &Env, number: u64, proof: Option<&Value>) -> anyhow::Result<ExecutionFinalResult> {
    Ok(e.oracle
        .call(e.pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": number, "verdict": "forfeit", "verdict_hash": ZERO_HASH, "proof": proof }))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?)
}

/// Pays a bond on `number` and returns it.
async fn bond(e: &Env, number: u64) -> anyhow::Result<u128> {
    let b = e.quote(REPO, Some(&e.alice)).await?; // alice's own price (a forfeit doubles it)
    e.pay(&e.alice, REPO, number, b, json!({})).await?.into_result()?;
    Ok(b)
}

#[tokio::test]
async fn a_genuine_near_ai_signature_recovers_on_chain_and_only_a_signed_forfeit_can_forfeit() -> anyhow::Result<()> {
    let e = setup().await?;
    let fx = fixtures();
    let live_signer = fx["live"]["signer"].as_str().unwrap();
    let test_signer = fx["test_signer"].as_str().unwrap();

    // Only the owner registers keys.
    assert!(set_signers(&e, &e.oracle, &[live_signer]).await?.is_failure());
    set_signers(&e, &e.owner, &[test_signer]).await?.into_result()?;

    // The real NEAR AI signature recovers to exactly NEAR AI's attested key — which isn't registered yet.
    bond(&e, 1).await?;
    let r = forfeit_with(&e, 1, Some(&fx["live"]["proof"])).await?;
    assert!(failure_text(&r).contains(&format!("0x{} isn't a registered NEAR AI enclave key", &live_signer[2..])), "{}", failure_text(&r));

    // Registered, the same genuine signature is accepted as a signature — but the model said refund.
    set_signers(&e, &e.owner, &[live_signer, test_signer]).await?.into_result()?;
    assert_eq!(e.view("get_tee_signers", json!({})).await?, json!([live_signer, test_signer]));
    let r = forfeit_with(&e, 1, Some(&fx["live"]["proof"])).await?;
    assert!(failure_text(&r).contains("the model said \\\"refund\\\""), "{}", failure_text(&r));

    // No proof, no forfeit. A refund never needs one.
    let r = forfeit_with(&e, 1, None).await?;
    assert!(failure_text(&r).contains("needs the NEAR AI TEE proof"), "{}", failure_text(&r));

    // A signed forfeit with evidence and enough confidence goes through.
    forfeit_with(&e, 1, Some(&fx["forfeit"])).await?.into_result()?;
    assert_eq!(e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?["status"]["settled"]["verdict"], "forfeit");

    bond(&e, 2).await?;
    e.settle(REPO, 2, "refund").await?.into_result()?;
    assert_eq!(e.view("get_deposit", json!({ "repo_id": REPO, "number": 2 })).await?["status"]["settled"]["verdict"], "refund");
    Ok(())
}

#[tokio::test]
async fn tampered_weak_or_unsupported_forfeits_are_rejected() -> anyhow::Result<()> {
    let e = setup().await?;
    let fx = fixtures();
    set_signers(&e, &e.owner, &[fx["test_signer"].as_str().unwrap()]).await?.into_result()?;
    bond(&e, 1).await?;

    // One byte of the response changed: the hash no longer matches what was signed.
    let mut tampered = fx["forfeit"].clone();
    tampered["response"] = json!(tampered["response"].as_str().unwrap().replace("0.93", "0.99"));
    let r = forfeit_with(&e, 1, Some(&tampered)).await?;
    assert!(failure_text(&r).contains("TEE proof rejected"), "{}", failure_text(&r));

    let r = forfeit_with(&e, 1, Some(&fx["low_confidence"])).await?;
    assert!(failure_text(&r).contains("confidence 6000 bps is below the repo's 8500 bps"), "{}", failure_text(&r));

    let r = forfeit_with(&e, 1, Some(&fx["no_evidence"])).await?;
    assert!(failure_text(&r).contains("at least one piece of evidence"), "{}", failure_text(&r));

    assert_eq!(e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?["status"], "held", "nothing moved");
    Ok(())
}

#[tokio::test]
async fn without_registered_signers_nothing_changes() -> anyhow::Result<()> {
    let e = setup().await?;
    bond(&e, 1).await?;
    e.settle(REPO, 1, "forfeit").await?.into_result()?;
    assert_eq!(e.view("get_tee_signers", json!({})).await?, json!([]));
    Ok(())
}
