//! A maintainer can't take a contributor's bond on their own say-so: their forfeit is a 48 h
//! proposal the contributor disputes for free, a re-judge decides, and an overturned maintainer
//! forfeit pays the contributor a penalty escrowed from the vault. Every override is public.
//! Run: `cargo test -p patchbond-vault --test maintainer_safeguards`

mod common;
use common::*;

/// REPO linked to amaka. With `seed`, two earlier forfeits put more than one bond in the vault, so
/// a maintainer forfeit can escrow a full bond.
async fn linked(seed: bool) -> anyhow::Result<(Env, u128)> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    if seed {
        let bob = e.bob_funded().await?;
        for n in [98, 99] {
            e.pay(&bob, REPO, n, 5 * USDC, json!({})).await?.into_result()?;
            e.settle(REPO, n, "forfeit").await?.into_result()?;
        }
        assert!(e.vault().await? > bond, "the seed covers a full escrow");
    }
    e.link(REPO, &e.amaka).await?;
    Ok((e, bond))
}

impl Env {
    async fn bob_funded(&self) -> anyhow::Result<Account> {
        self.ft
            .call("mint")
            .args_json(json!({ "account_id": self.bob.id(), "amount": (10 * USDC).to_string() }))
            .transact()
            .await?
            .into_result()?;
        Ok(self.bob.clone())
    }

    async fn maintainer_settles(&self, number: u64, verdict: &str) -> anyhow::Result<ExecutionFinalResult> {
        Ok(self
            .amaka
            .call(self.pb.id(), "settle")
            .args_json(json!({ "repo_id": REPO, "number": number, "verdict": verdict, "verdict_hash": ZERO_HASH }))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?)
    }

    async fn dispute(&self, who: &Account, number: u64) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.pb.id(), "dispute")
            .args_json(json!({ "repo_id": REPO, "number": number }))
            .transact()
            .await?)
    }

    async fn rejudge(&self, number: u64, verdict: &str) -> anyhow::Result<()> {
        self.oracle
            .call(self.pb.id(), "resolve_challenge")
            .args_json(json!({ "repo_id": REPO, "number": number, "verdict": verdict, "verdict_hash": ZERO_HASH }))
            .gas(Gas::from_tgas(200))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    async fn vault(&self) -> anyhow::Result<u128> {
        Ok(u(&self.view("get_repo", json!({ "repo_id": REPO })).await?["vault"]))
    }

    async fn record(&self) -> anyhow::Result<Value> {
        self.view("get_maintainer_record", json!({ "repo_id": REPO })).await
    }
}

#[tokio::test]
async fn a_maintainer_forfeit_only_proposes_and_a_free_dispute_with_a_fair_rejudge_gets_the_bond_back() -> anyhow::Result<()> {
    let (e, bond) = linked(true).await?;
    let vault_before = e.vault().await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;

    e.maintainer_settles(1, "forfeit").await?.into_result()?;
    let d = e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?;
    assert_eq!(d["status"]["proposed"]["verdict"], "forfeit", "a proposal, not a settlement");
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond, "nothing moved yet");
    assert!(e.view("is_maintainer_forfeit", json!({ "repo_id": REPO, "number": 1 })).await?.as_bool().unwrap());
    assert_eq!(e.vault().await?, vault_before - bond, "one bond escrowed from the vault");

    // Someone else can't dispute; a stake isn't needed (and is refused); the payer disputes for free.
    assert!(e.dispute(&e.bob, 1).await?.is_failure());
    let staked = e.pay_with(&e.ft, &e.alice, REPO, 1, bond, json!({ "action": "challenge" })).await?;
    assert!(failure_text(&staked).contains("call dispute instead"), "{}", failure_text(&staked));
    e.dispute(&e.alice, 1).await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond, "disputing cost nothing");

    // The maintainer can't decide it any more…
    let overrule = e.maintainer_settles(1, "forfeit").await?;
    assert!(failure_text(&overrule).contains("re-judge decides"), "{}", failure_text(&overrule));
    // …the re-judge does: the bond comes back, plus the escrowed penalty.
    e.rejudge(1, "refund").await?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC + bond, "bond back + one bond of compensation");
    assert_eq!(e.vault().await?, vault_before - bond, "the penalty came out of the maintainer's vault");
    assert_eq!(e.record().await?, json!({ "forfeits": 1, "disputed": 1, "overturned": 1 }));
    Ok(())
}

#[tokio::test]
async fn a_fair_maintainer_forfeit_stands_after_a_dispute_and_the_escrow_returns() -> anyhow::Result<()> {
    let (e, bond) = linked(true).await?;
    let vault_before = e.vault().await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    e.maintainer_settles(1, "forfeit").await?.into_result()?;
    e.dispute(&e.alice, 1).await?.into_result()?;
    e.rejudge(1, "forfeit").await?;
    let fee = bond / 10;
    assert_eq!(e.vault().await?, vault_before + bond - fee, "escrow back + the 90% share");
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond);
    assert_eq!(e.record().await?, json!({ "forfeits": 1, "disputed": 1, "overturned": 0 }));
    Ok(())
}

#[tokio::test]
async fn retracting_before_a_dispute_costs_the_maintainer_nothing() -> anyhow::Result<()> {
    let (e, bond) = linked(true).await?;
    let vault_before = e.vault().await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    e.maintainer_settles(1, "forfeit").await?.into_result()?;
    e.maintainer_settles(1, "refund").await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    assert_eq!(e.vault().await?, vault_before, "escrow returned");
    assert_eq!(e.record().await?["overturned"], 0);
    Ok(())
}

#[tokio::test]
async fn a_maintainer_forfeit_gets_a_fixed_48_hour_window_whatever_the_policy_says() -> anyhow::Result<()> {
    let (e, bond) = linked(false).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    e.maintainer_settles(1, "forfeit").await?.into_result()?;
    let finalize = || e.bob.call(e.pb.id(), "finalize").args_json(json!({ "repo_id": REPO, "number": 1 })).gas(Gas::from_tgas(100)).transact();
    let early = finalize().await?;
    assert!(failure_text(&early).contains("still open"), "{}", failure_text(&early));
    // The repo's policy says 0 s, but a maintainer forfeit always gets the contract's 48 h.
    let d = e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?;
    let window = d["status"]["proposed"]["deadline"].as_u64().unwrap() - d["created_at"].as_u64().unwrap();
    assert!((48 * 3600 * 1000..48 * 3600 * 1000 + 60_000).contains(&window), "window {window} ms");
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond, "nothing moved");
    assert_eq!(e.record().await?, json!({ "forfeits": 1, "disputed": 0, "overturned": 0 }));
    Ok(())
}
