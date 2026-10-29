//! Upgrading older state to the current layout keeps every repo, deposit and balance.
//! Needs the old wasm builds: commit 52d3fae (v0.2, USDC only) as `PATCHBOND_V2_WASM` and commit
//! 88ff441 (v0.3-pre, before `unsettled`) as `PATCHBOND_V3PRE_WASM`, commit a611282 (v0.3, before the
//! maintainer-forfeit safeguards) as `PATCHBOND_V3_WASM`, commit 8ad5007 (v0.4, before TEE proofs) as
//! `PATCHBOND_V4_WASM`. Each case is skipped when unset.
//! Run: `PATCHBOND_V2_WASM=… PATCHBOND_V3PRE_WASM=… cargo test -p patchbond-vault --test migrate`

mod common;
use common::*;

#[tokio::test]
async fn v2_state_survives_the_upgrade() -> anyhow::Result<()> {
    upgrade_from("PATCHBOND_V2_WASM", json!({})).await
}

#[tokio::test]
async fn v3_pre_state_survives_the_upgrade() -> anyhow::Result<()> {
    upgrade_from("PATCHBOND_V3PRE_WASM", json!({ "wnear": null })).await
}

#[tokio::test]
async fn v3_state_survives_the_upgrade() -> anyhow::Result<()> {
    upgrade_from("PATCHBOND_V3_WASM", json!({ "wnear": null })).await
}

#[tokio::test]
async fn v4_state_survives_the_upgrade() -> anyhow::Result<()> {
    upgrade_from("PATCHBOND_V4_WASM", json!({ "wnear": null })).await
}

/// Deploy the old wasm, make a forfeit and a held deposit, upgrade, check nothing moved.
/// `extra_init` = whatever the old `new` needs beyond owner/oracle/treasury/token.
async fn upgrade_from(var: &str, extra_init: Value) -> anyhow::Result<()> {
    let Ok(path) = std::env::var(var) else {
        eprintln!("{var} not set; skipping");
        return Ok(());
    };
    let worker = near_workspaces::sandbox().await?;
    let ft = worker.dev_deploy(ft_wasm().await?).await?;
    ft.call("new").transact().await?.into_result()?;
    let wnear = worker.dev_deploy(ft_wasm().await?).await?;
    let pb = worker.dev_deploy(&std::fs::read(path)?).await?;
    let oracle = account(&worker, "oracle").await?;
    let alice = account(&worker, "alice").await?;
    let mut init = json!({ "owner": pb.id(), "oracle": oracle.id(), "treasury": pb.id(), "token": ft.id() });
    for (k, v) in extra_init.as_object().unwrap() {
        init[k] = v.clone();
    }
    pb.call("new")
        .args_json(init)
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
    pb.as_account().deploy(vault_wasm().await?).await?.into_result()?;
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
