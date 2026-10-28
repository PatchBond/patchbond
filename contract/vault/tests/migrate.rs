//! Upgrading live v0.2 state (USDC only) to currencies keeps every repo, deposit and balance.
//! Needs the v0.2 wasm: build commit 52d3fae with `cargo near build` and point
//! `PATCHBOND_V2_WASM` at it. Skipped when unset.
//! Run: `PATCHBOND_V2_WASM=… cargo test -p patchbond-vault --test migrate`

mod common;
use common::*;

#[tokio::test]
async fn v2_state_survives_the_upgrade() -> anyhow::Result<()> {
    let Ok(path) = std::env::var("PATCHBOND_V2_WASM") else {
        eprintln!("PATCHBOND_V2_WASM not set; skipping the migration test");
        return Ok(());
    };
    let worker = near_workspaces::sandbox().await?;
    let ft = worker.dev_deploy(&near_workspaces::compile_project("../mock-ft").await?).await?;
    ft.call("new").transact().await?.into_result()?;
    let wnear = worker.dev_deploy(&near_workspaces::compile_project("../mock-ft").await?).await?;
    let pb = worker.dev_deploy(&std::fs::read(path)?).await?;
    let oracle = account(&worker, "oracle").await?;
    let alice = account(&worker, "alice").await?;
    pb.call("new")
        .args_json(json!({ "owner": pb.id(), "oracle": oracle.id(), "treasury": pb.id(), "token": ft.id() }))
        .transact()
        .await?
        .into_result()?;
    for who in [pb.id(), alice.id()] {
        ft.call("mint")
            .args_json(json!({ "account_id": who, "amount": (100 * USDC).to_string() }))
            .transact()
            .await?
            .into_result()?;
    }
    oracle
        .call(pb.id(), "register_repo")
        .args_json(json!({ "repo_id": REPO, "policy": instant_policy() }))
        .transact()
        .await?
        .into_result()?;
    // One forfeit (vault + treasury) and one held deposit, under the old code.
    for number in [1, 2] {
        alice
            .call(ft.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": pb.id(), "amount": (10 * USDC).to_string(),
                "msg": json!({ "action": "bond", "repo_id": REPO, "number": number, "kind": "pr", "github_user": "alice" }).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?
            .into_result()?;
    }
    oracle
        .call(pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "forfeit", "verdict_hash": ZERO_HASH }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let before: Value = pb.view("get_repo").args_json(json!({ "repo_id": REPO })).await?.json()?;

    // Upgrade in place.
    let new_wasm = near_workspaces::compile_project("./").await?;
    pb.as_account().deploy(&new_wasm).await?.into_result()?;
    pb.call("migrate").args_json(json!({ "wnear": wnear.id() })).transact().await?.into_result()?;

    let after: Value = pb.view("get_repo").args_json(json!({ "repo_id": REPO })).await?.json()?;
    for k in ["vault", "open", "policy", "stats", "payout"] {
        assert_eq!(after[k], before[k], "{k} changed in the upgrade");
    }
    assert_eq!(after["currency"], "usdc");
    let cfg: Value = pb.view("get_config").args_json(json!({})).await?.json()?;
    assert_eq!(cfg["wnear"], wnear.id().to_string());
    let totals: Value = pb.view("get_totals").args_json(json!({})).await?.json()?;
    assert_eq!(totals["deposits"], 2);
    assert_eq!(u(&cfg["treasury_balance"]), u(&totals["forfeited"]) / 10, "10% fee kept");

    // The held USDC deposit still refunds in USDC under the new code.
    let held = 100 * USDC - 20 * USDC;
    oracle
        .call(pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": 2, "verdict": "refund", "verdict_hash": ZERO_HASH }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let bal: String = ft.view("ft_balance_of").args_json(json!({ "account_id": alice.id() })).await?.json()?;
    assert!(bal.parse::<u128>()? > held, "the old deposit refunded");

    // A second migrate can't run over new state.
    assert!(pb.call("migrate").args_json(json!({ "wnear": null })).transact().await?.is_failure());
    Ok(())
}
