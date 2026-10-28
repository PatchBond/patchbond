//! Every money path, on a real NEAR sandbox with real NEP-141 transfers.
//! Run: `cargo test -p patchbond-vault --test money_paths` (downloads the sandbox once).

mod common;
use common::*;

#[tokio::test]
async fn refund_returns_the_whole_bond_and_builds_reputation() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, Some(&e.alice)).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond);

    let d = e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?;
    assert_eq!(d["status"], json!("held"));
    assert_eq!(e.view("get_repo", json!({ "repo_id": REPO })).await?["open"], 1);

    e.settle(REPO, 1, "refund").await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    assert_eq!(e.view("get_repo", json!({ "repo_id": REPO })).await?["open"], 0);
    let rep = e.view("get_reputation", json!({ "account_id": e.alice.id() })).await?;
    assert_eq!(rep["refunds"], 1);
    let totals = e.view("get_totals", json!({})).await?;
    assert_eq!(u(&totals["held"]), 0);
    assert_eq!(u(&totals["refunded"]), bond);
    Ok(())
}

#[tokio::test]
async fn overpaying_gets_change_and_underpaying_is_refunded_with_a_reason() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;

    e.pay(&e.alice, REPO, 1, bond + 3 * USDC, json!({})).await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond, "change returned");

    let r = e.pay(&e.alice, REPO, 2, bond / 2, json!({})).await?;
    assert!(failure_text(&r).contains("the transfer was refunded"), "{}", failure_text(&r));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond, "underpayment refunded");
    assert!(e.view("get_deposit", json!({ "repo_id": REPO, "number": 2 })).await?.is_null());
    Ok(())
}

#[tokio::test]
async fn bad_deposits_are_refunded_in_full() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;

    let dup = e.pay(&e.alice, REPO, 1, 10 * USDC, json!({})).await?;
    assert!(failure_text(&dup).contains("already has a deposit"));
    let unknown = e.pay(&e.alice, 999, 1, 10 * USDC, json!({})).await?;
    assert!(failure_text(&unknown).contains("install the GitHub App"));
    let garbage = e
        .alice
        .call(e.ft.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.pb.id(), "amount": "1000000", "msg": "hello" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(failure_text(&garbage).contains("Couldn't read the transfer msg"));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond);

    // Only the token contract may call ft_on_transfer (no fake deposits).
    let fake = e
        .alice
        .call(e.pb.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": e.alice.id(), "amount": "50000000",
            "msg": json!({"action":"bond","repo_id":REPO,"number":5,"kind":"pr","github_user":"x"}).to_string() }))
        .transact()
        .await?;
    assert!(failure_text(&fake).contains("only accepts"));
    Ok(())
}

#[tokio::test]
async fn forfeit_splits_90_10_and_only_the_linked_maintainer_can_withdraw() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    e.settle(REPO, 1, "forfeit").await?.into_result()?;

    let fee = bond / 10;
    let repo = e.view("get_repo", json!({ "repo_id": REPO })).await?;
    assert_eq!(u(&repo["vault"]), bond - fee);
    assert_eq!(u(&e.view("get_config", json!({})).await?["treasury_balance"]), fee);
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - bond);
    let rep = e.view("get_reputation", json!({ "account_id": e.alice.id() })).await?;
    assert_eq!(rep["forfeits"], 1);

    // Unlinked: money waits, nobody can take it.
    let early = e
        .amaka
        .call(e.pb.id(), "withdraw")
        .args_json(json!({ "repo_id": REPO, "amount": "1" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(failure_text(&early).contains("Only the repo's linked payout account"));

    e.link(REPO, &e.amaka).await?;
    for thief in [&e.bob, &e.owner, &e.oracle] {
        let r = thief
            .call(e.pb.id(), "withdraw")
            .args_json(json!({ "repo_id": REPO, "amount": "1" }))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?;
        assert!(r.is_failure(), "{} must not withdraw", thief.id());
    }
    let too_much = e
        .amaka
        .call(e.pb.id(), "withdraw")
        .args_json(json!({ "repo_id": REPO, "amount": (bond).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(failure_text(&too_much).contains("The vault holds"));

    e.amaka
        .call(e.pb.id(), "withdraw")
        .args_json(json!({ "repo_id": REPO, "amount": (bond - fee).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.balance(&e.amaka).await?, bond - fee);
    assert_eq!(u(&e.view("get_repo", json!({ "repo_id": REPO })).await?["vault"]), 0);

    e.owner
        .call(e.pb.id(), "withdraw_treasury")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.balance(&e.treasury).await?, fee);
    assert_eq!(u(&e.view("get_config", json!({})).await?["treasury_balance"]), 0);
    Ok(())
}

#[tokio::test]
async fn only_the_oracle_or_the_maintainer_can_settle() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    let r = e
        .alice
        .call(e.pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "refund", "verdict_hash": ZERO_HASH }))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("Only the PatchBond oracle"));

    e.link(REPO, &e.amaka).await?;
    e.amaka
        .call(e.pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "refund", "verdict_hash": ZERO_HASH }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let again = e.settle(REPO, 1, "forfeit").await?;
    assert!(failure_text(&again).contains("already settled"));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    Ok(())
}

#[tokio::test]
async fn priority_tip_pays_the_vault_only_when_reviewed_in_time() -> anyhow::Result<()> {
    let e = setup().await?;
    // Repo 202 promises review "instantly" (0 s window) so any later review is late.
    let mut late_policy = e.view("get_repo", json!({ "repo_id": REPO })).await?["policy"].clone();
    late_policy["review_window_sec"] = json!(0);
    e.register(202, Some(late_policy)).await?;

    let tip = 5 * USDC;
    for repo in [REPO, 202] {
        let bond = e.quote(repo, None).await?;
        e.pay(&e.alice, repo, 1, bond + tip, json!({ "tip": tip.to_string() })).await?.into_result()?;
        e.oracle
            .call(e.pb.id(), "mark_reviewed")
            .args_json(json!({ "repo_id": repo, "number": 1 }))
            .transact()
            .await?
            .into_result()?;
        e.settle(repo, 1, "refund").await?.into_result()?;
    }
    let on_time = e.view("get_repo", json!({ "repo_id": REPO })).await?;
    assert_eq!(u(&on_time["vault"]), tip, "reviewed within 72 h → tip earned");
    assert_eq!(u(&on_time["stats"]["tips_earned"]), tip);
    let late = e.view("get_repo", json!({ "repo_id": 202 })).await?;
    assert_eq!(u(&late["vault"]), 0, "late review → tip refunded");
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - tip, "paid one tip, got the other back");
    Ok(())
}

#[tokio::test]
async fn slop_funds_the_fix() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 10, bond, json!({ "fixes_issue": 7 })).await?.into_result()?;
    e.settle(REPO, 10, "forfeit").await?.into_result()?;

    let share = bond - bond / 10;
    assert_eq!(u(&e.view("get_bounty", json!({ "repo_id": REPO, "issue": 7 })).await?), share);
    assert_eq!(u(&e.view("get_repo", json!({ "repo_id": REPO })).await?["vault"]), 0);

    let r = e
        .alice
        .call(e.pb.id(), "pay_bounty")
        .args_json(json!({ "repo_id": REPO, "issue": 7, "recipient": e.alice.id() }))
        .transact()
        .await?;
    assert!(r.is_failure(), "only the oracle confirms a merged fix");

    e.oracle
        .call(e.pb.id(), "pay_bounty")
        .args_json(json!({ "repo_id": REPO, "issue": 7, "recipient": e.bob.id() }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.balance(&e.bob).await?, share, "the real fixer got the slop's bond");
    assert_eq!(u(&e.view("get_bounty", json!({ "repo_id": REPO, "issue": 7 })).await?), 0);
    Ok(())
}

#[tokio::test]
async fn the_bond_rises_in_a_flood_and_falls_as_the_queue_empties() -> anyhow::Result<()> {
    let e = setup().await?;
    let mut p = e.view("get_repo", json!({ "repo_id": REPO })).await?["policy"].clone();
    p["target_open"] = json!(2);
    e.register(303, Some(p)).await?;

    let mut quotes = vec![e.quote(303, None).await?];
    for n in 1..=6 {
        let bond = *quotes.last().unwrap();
        e.pay(&e.alice, 303, n, bond, json!({})).await?.into_result()?;
        quotes.push(e.quote(303, None).await?);
    }
    // 0,1 open: below target; 2: base; each extra: +12.5%
    assert_eq!(quotes[2], 2 * USDC);
    assert_eq!(quotes[3], 2_250_000);
    assert_eq!(quotes[6], 3_203_613); // 2 × 1.125^4, rounded down per step
    assert!(quotes.windows(2).all(|w| w[1] > w[0]), "strictly rising: {quotes:?}");

    for n in 1..=6 {
        e.settle(303, n, "refund").await?.into_result()?;
    }
    assert_eq!(e.quote(303, None).await?, quotes[0], "back to the quiet price");
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    Ok(())
}

#[tokio::test]
async fn reputation_exempts_proven_people_and_taxes_recent_slop() -> anyhow::Result<()> {
    let e = setup().await?;
    e.register(404, Some(instant_policy())).await?;
    for (repo, n) in [(REPO, 1), (REPO, 2), (404, 1)] {
        let bond = e.quote(repo, Some(&e.alice)).await?;
        e.pay(&e.alice, repo, n, bond, json!({})).await?.into_result()?;
        e.settle(repo, n, "refund").await?.into_result()?;
    }
    assert_eq!(e.quote(REPO, Some(&e.alice)).await?, 0);
    assert!(e.view("is_exempt", json!({ "account_id": e.alice.id() })).await?.as_bool().unwrap());
    let r = e.pay(&e.alice, REPO, 3, 5 * USDC, json!({})).await?;
    assert!(failure_text(&r).contains("no deposit is needed"));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);

    // One forfeit: not exempt any more, and pays double.
    let base = e.quote(REPO, None).await?;
    e.ft
        .call("mint")
        .args_json(json!({ "account_id": e.bob.id(), "amount": (10 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    e.pay(&e.bob, REPO, 4, base, json!({})).await?.into_result()?;
    e.settle(REPO, 4, "forfeit").await?.into_result()?;
    assert_eq!(e.quote(REPO, Some(&e.bob)).await?, 2 * e.quote(REPO, None).await?);
    Ok(())
}

#[tokio::test]
async fn a_failed_refund_becomes_claimable_instead_of_lost() -> anyhow::Result<()> {
    let e = setup().await?;
    let carol = account(&e.worker, "carol").await?;
    let bond = e.quote(REPO, None).await?;
    e.ft.call("mint")
        .args_json(json!({ "account_id": carol.id(), "amount": bond.to_string() }))
        .transact()
        .await?
        .into_result()?;
    e.pay(&carol, REPO, 1, bond, json!({})).await?.into_result()?;
    // Carol leaves the token contract, so the refund transfer will fail.
    carol
        .call(e.ft.id(), "storage_unregister")
        .args_json(json!({ "force": false }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    e.settle(REPO, 1, "refund").await?.into_result()?;
    assert_eq!(u(&e.view("get_claimable", json!({ "account_id": carol.id() })).await?), bond);

    carol
        .call(e.ft.id(), "storage_deposit")
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
    assert_eq!(e.balance(&carol).await?, bond);
    assert_eq!(u(&e.view("get_claimable", json!({ "account_id": carol.id() })).await?), 0);
    Ok(())
}

#[tokio::test]
async fn policy_belongs_to_the_maintainer_once_linked() -> anyhow::Result<()> {
    let e = setup().await?;
    let mut p = e.view("get_repo", json!({ "repo_id": REPO })).await?["policy"].clone();
    p["base_bond"] = json!("5000000");
    e.oracle
        .call(e.pb.id(), "set_policy")
        .args_json(json!({ "repo_id": REPO, "policy": p }))
        .transact()
        .await?
        .into_result()?;
    e.link(REPO, &e.amaka).await?;
    let r = e
        .oracle
        .call(e.pb.id(), "set_policy")
        .args_json(json!({ "repo_id": REPO, "policy": p }))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("Only the repo's linked payout account"));

    let mut bad = p.clone();
    bad["min_bond"] = json!("9000000");
    let r = e
        .amaka
        .call(e.pb.id(), "set_policy")
        .args_json(json!({ "repo_id": REPO, "policy": bad }))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("min_bond <= base_bond <= max_bond"));

    p["enabled"] = json!(false);
    e.amaka
        .call(e.pb.id(), "set_policy")
        .args_json(json!({ "repo_id": REPO, "policy": p }))
        .transact()
        .await?
        .into_result()?;
    let r = e.pay(&e.alice, REPO, 1, 10 * USDC, json!({})).await?;
    assert!(failure_text(&r).contains("turned off"));
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    Ok(())
}

#[tokio::test]
async fn a_voided_deposit_frees_the_slot_for_the_real_author() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    // Alice pays for a PR that isn't hers; the oracle voids it and she gets everything back.
    e.pay(&e.alice, REPO, 1, bond, json!({ "github_user": "someone-else" })).await?.into_result()?;
    e.settle(REPO, 1, "void").await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    assert_eq!(e.view("get_reputation", json!({ "account_id": e.alice.id() })).await?["refunds"], 0);

    e.ft.call("mint")
        .args_json(json!({ "account_id": e.bob.id(), "amount": (10 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    e.pay(&e.bob, REPO, 1, bond, json!({})).await?.into_result()?;
    let d = e.view("get_deposit", json!({ "repo_id": REPO, "number": 1 })).await?;
    assert_eq!(d["github_user"], "bob");
    assert_eq!(d["status"], json!("held"));
    Ok(())
}

#[tokio::test]
async fn a_stolen_oracle_key_cannot_redirect_a_linked_vault() -> anyhow::Result<()> {
    let e = setup().await?;
    e.link(REPO, &e.amaka).await?;
    // The oracle (or whoever stole its key) tries to point the vault elsewhere.
    let relink = e
        .oracle
        .call(e.pb.id(), "link_repo")
        .args_json(json!({ "repo_id": REPO, "payout": e.bob.id() }))
        .transact()
        .await?;
    assert!(failure_text(&relink).contains("already linked"), "{}", failure_text(&relink));
    // Only the current payout account can hand it over.
    let not_hers = e
        .bob
        .call(e.pb.id(), "set_payout")
        .args_json(json!({ "repo_id": REPO, "payout": e.bob.id() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(failure_text(&not_hers).contains("Only the repo's current payout account"));
    e.amaka
        .call(e.pb.id(), "set_payout")
        .args_json(json!({ "repo_id": REPO, "payout": e.bob.id() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.view("get_repo", json!({ "repo_id": REPO })).await?["payout"], json!(e.bob.id()));
    Ok(())
}

#[tokio::test]
async fn pause_stops_new_money_but_never_refunds() -> anyhow::Result<()> {
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;

    let stranger = e.alice.call(e.pb.id(), "set_paused").args_json(json!({ "paused": true })).transact().await?;
    assert!(failure_text(&stranger).contains("Only the contract owner"));
    e.owner.call(e.pb.id(), "set_paused").args_json(json!({ "paused": true })).transact().await?.into_result()?;

    let blocked = e.pay(&e.alice, REPO, 2, bond, json!({})).await?;
    assert!(failure_text(&blocked).contains("paused"), "{}", failure_text(&blocked));
    // The existing bond still settles and refunds while paused.
    e.settle(REPO, 1, "refund").await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);

    e.owner.call(e.pb.id(), "set_paused").args_json(json!({ "paused": false })).transact().await?.into_result()?;
    e.pay(&e.alice, REPO, 2, bond, json!({})).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_penny_budget_is_refused() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = e
        .alice
        .call(e.ft.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": e.pb.id(), "amount": "1",
            "msg": json!({ "action": "fund_budget", "agent": e.bob.id(), "daily_cap": "1" }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("at least 1.00 USDC"), "{}", failure_text(&r));
    assert!(e.view("get_budget", json!({ "agent": e.bob.id() })).await?.is_null());
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    Ok(())
}
