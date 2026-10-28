//! Repos that take NEAR: bonds, refunds, forfeits, challenges and payouts in wNEAR, and the
//! guards that keep USDC and NEAR from ever mixing.
//! Run: `cargo test -p patchbond-vault --test near_bonds`

mod common;
use common::*;

async fn switch(e: &Env, by: &Account, repo: u64, currency: &str, policy: Value) -> anyhow::Result<ExecutionFinalResult> {
    Ok(by
        .call(e.pb.id(), "set_currency")
        .args_json(json!({ "repo_id": repo, "currency": currency, "policy": policy }))
        .transact()
        .await?)
}

async fn withdraw(e: &Env, by: &Account, repo: u64, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
    Ok(by
        .call(e.pb.id(), "withdraw")
        .args_json(json!({ "repo_id": repo, "amount": amount.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?)
}

#[tokio::test]
async fn a_near_repo_takes_near_refunds_near_and_forfeits_near() -> anyhow::Result<()> {
    let e = setup().await?;
    switch(&e, &e.oracle, REPO, "near", near_policy()).await?.into_result()?;
    let repo = e.view("get_repo", json!({ "repo_id": REPO })).await?;
    assert_eq!(repo["currency"], "near");
    assert_eq!(repo["policy"]["base_bond"], NEAR.to_string());

    // The quote is in NEAR units; USDC is turned away with a reason and refunded.
    let bond = e.quote(REPO, None).await?;
    assert!((NEAR / 10..NEAR).contains(&bond), "quiet-repo bond {bond}");
    let usdc = e.pay(&e.alice, REPO, 1, 10 * USDC, json!({})).await?;
    assert!(failure_text(&usdc).contains("takes NEAR bonds"), "{}", failure_text(&usdc));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);

    // Refund: the whole bond comes back in wNEAR.
    e.pay_with(&e.wnear, &e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    assert_eq!(e.near_balance(&e.alice).await?, 100 * NEAR - bond);
    e.settle(REPO, 1, "refund").await?.into_result()?;
    assert_eq!(e.near_balance(&e.alice).await?, 100 * NEAR);

    // Forfeit: 90% to the vault, 10% to the NEAR treasury; USDC books untouched.
    e.pay_with(&e.wnear, &e.alice, REPO, 2, bond, json!({})).await?.into_result()?;
    e.settle(REPO, 2, "forfeit").await?.into_result()?;
    let fee = bond / 10;
    assert_eq!(u(&e.view("get_repo", json!({ "repo_id": REPO })).await?["vault"]), bond - fee);
    let cfg = e.view("get_config", json!({})).await?;
    assert_eq!(u(&cfg["treasury_near"]), fee);
    assert_eq!(u(&cfg["treasury_balance"]), 0);
    let near_totals = e.view("get_totals", json!({ "currency": "near" })).await?;
    assert_eq!(u(&near_totals["forfeited"]), bond);
    assert_eq!(u(&near_totals["refunded"]), bond);
    assert_eq!(near_totals["deposits"], 2);
    assert_eq!(e.view("get_totals", json!({})).await?["deposits"], 0, "USDC totals untouched");

    // The maintainer withdraws wNEAR; the owner sweeps the NEAR fee.
    e.link(REPO, &e.amaka).await?;
    withdraw(&e, &e.amaka, REPO, bond - fee).await?.into_result()?;
    assert_eq!(e.near_balance(&e.amaka).await?, bond - fee);
    e.owner
        .call(e.pb.id(), "withdraw_treasury")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.near_balance(&e.treasury).await?, fee);
    Ok(())
}

#[tokio::test]
async fn currency_only_switches_when_nothing_is_held() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;

    // An open USDC deposit blocks the switch.
    let r = switch(&e, &e.oracle, REPO, "near", near_policy()).await?;
    assert!(failure_text(&r).contains("before switching currency"), "{}", failure_text(&r));

    // A forfeit leaves USDC in the vault: still blocked until it's withdrawn.
    e.settle(REPO, 1, "forfeit").await?.into_result()?;
    e.link(REPO, &e.amaka).await?;
    assert!(switch(&e, &e.amaka, REPO, "near", near_policy()).await?.is_failure());
    let vault = u(&e.view("get_repo", json!({ "repo_id": REPO })).await?["vault"]);
    withdraw(&e, &e.amaka, REPO, vault).await?.into_result()?;

    // Only the linked payout account may switch now — not the oracle, not a stranger.
    for who in [&e.oracle, &e.bob] {
        assert!(switch(&e, who, REPO, "near", near_policy()).await?.is_failure(), "{}", who.id());
    }
    switch(&e, &e.amaka, REPO, "near", near_policy()).await?.into_result()?;
    assert_eq!(e.view("get_repo", json!({ "repo_id": REPO })).await?["currency"], "near");

    // And back to USDC (with a USDC-priced policy).
    switch(&e, &e.amaka, REPO, "usdc", instant_policy()).await?.into_result()?;
    assert_eq!(e.view("get_repo", json!({ "repo_id": REPO })).await?["currency"], "usdc");
    Ok(())
}

#[tokio::test]
async fn an_unpaid_bounty_pins_the_currency() -> anyhow::Result<()> {
    let e = setup().await?;
    switch(&e, &e.oracle, REPO, "near", near_policy()).await?.into_result()?;
    let bond = e.quote(REPO, None).await?;
    e.pay_with(&e.wnear, &e.alice, REPO, 7, bond, json!({ "fixes_issue": 3 })).await?.into_result()?;
    e.settle(REPO, 7, "forfeit").await?.into_result()?;
    let bounty = u(&e.view("get_bounty", json!({ "repo_id": REPO, "issue": 3 })).await?);
    assert_eq!(bounty, bond - bond / 10);

    let r = switch(&e, &e.oracle, REPO, "usdc", instant_policy()).await?;
    assert!(failure_text(&r).contains("before switching currency"));

    // The bounty pays out in NEAR, after which the repo may switch.
    e.oracle
        .call(e.pb.id(), "pay_bounty")
        .args_json(json!({ "repo_id": REPO, "issue": 3, "recipient": e.bob.id() }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.near_balance(&e.bob).await?, bounty);
    switch(&e, &e.oracle, REPO, "usdc", instant_policy()).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_challenge_stake_is_paid_in_the_bonds_currency() -> anyhow::Result<()> {
    let e = setup().await?;
    let mut policy = near_policy();
    policy["challenge_window_sec"] = json!(3600);
    switch(&e, &e.oracle, REPO, "near", policy).await?.into_result()?;
    let bond = e.quote(REPO, None).await?;
    e.pay_with(&e.wnear, &e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    e.settle(REPO, 1, "forfeit").await?.into_result()?;

    let challenge = |token: &Contract, amount: u128| {
        e.alice
            .call(token.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": e.pb.id(), "amount": amount.to_string(),
                "msg": json!({ "action": "challenge", "repo_id": REPO, "number": 1 }).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
    };
    let wrong = challenge(&e.ft, 10 * USDC).await?;
    assert!(failure_text(&wrong).contains("same currency as the bond"), "{}", failure_text(&wrong));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);

    challenge(&e.wnear, bond).await?.into_result()?;
    let d = e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?;
    assert_eq!(d["status"]["challenged"]["stake"], bond.to_string());

    // The re-judge overturns the forfeit: bond and stake both come back in wNEAR.
    e.oracle
        .call(e.pb.id(), "resolve_challenge")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "refund", "verdict_hash": ZERO_HASH }))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.near_balance(&e.alice).await?, 100 * NEAR);
    assert_eq!(u(&e.view("get_totals", json!({ "currency": "near" })).await?["held"]), 0);
    Ok(())
}

#[tokio::test]
async fn agent_budgets_stay_usdc() -> anyhow::Result<()> {
    let e = setup().await?;
    let fund = |token: &Contract, amount: u128| {
        e.alice
            .call(token.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": e.pb.id(), "amount": amount.to_string(),
                "msg": json!({ "action": "fund_budget", "agent": e.bob.id(), "daily_cap": (5 * USDC).to_string() }).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
    };
    let r = fund(&e.wnear, 5 * NEAR).await?;
    assert!(failure_text(&r).contains("Agent budgets hold USDC"), "{}", failure_text(&r));
    assert_eq!(e.near_balance(&e.alice).await?, 100 * NEAR);

    fund(&e.ft, 10 * USDC).await?.into_result()?;
    switch(&e, &e.oracle, REPO, "near", near_policy()).await?.into_result()?;
    let r = e
        .bob
        .call(e.pb.id(), "deposit_from_budget")
        .args_json(json!({
            "repo_id": REPO, "number": 1, "kind": "pr", "github_user": "bob",
            "passport": { "operator": e.alice.id(), "harness": "claude-code", "model": "x" },
        }))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("pay this bond directly"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn a_failed_near_refund_becomes_claimable_in_near() -> anyhow::Result<()> {
    let e = setup().await?;
    switch(&e, &e.oracle, REPO, "near", near_policy()).await?.into_result()?;
    let carol = account(&e.worker, "carol").await?;
    let bond = e.quote(REPO, None).await?;
    e.wnear
        .call("mint")
        .args_json(json!({ "account_id": carol.id(), "amount": bond.to_string() }))
        .transact()
        .await?
        .into_result()?;
    e.pay_with(&e.wnear, &carol, REPO, 1, bond, json!({})).await?.into_result()?;
    // Carol leaves the wNEAR contract, so the refund transfer will fail.
    carol
        .call(e.wnear.id(), "storage_unregister")
        .args_json(json!({ "force": false }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    e.settle(REPO, 1, "refund").await?.into_result()?;
    let claim = |c: &str| e.view("get_claimable", json!({ "account_id": carol.id(), "currency": c }));
    assert_eq!(u(&claim("near").await?), bond);
    assert_eq!(u(&claim("usdc").await?), 0);

    carol
        .call(e.wnear.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    carol
        .call(e.pb.id(), "claim")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.near_balance(&carol).await?, bond);
    assert_eq!(u(&claim("near").await?), 0);
    Ok(())
}
