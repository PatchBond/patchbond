//! The whole money story in one command, on a local NEAR sandbox — no wallet, no keys, no GitHub:
//!
//!   cd contract && cargo run -p patchbond-vault --example demo
//!
//! Real contract, real token transfers, real `ecrecover` — and only genuine NEAR AI signatures from
//! `tests/fixtures`: the forfeit is NEAR AI's GLM enclave judging a constructed slop PR
//! (`server/scripts/make-forfeit-example.ts`), the OutLayer act a real enclave run on tcpdump#1471.

#[path = "../tests/common/mod.rs"]
mod common;
use common::*;

fn usd(v: u128) -> String {
    format!("${}.{:02}", v / USDC, (v % USDC) / 10_000)
}

fn act(title: &str) {
    println!("\n\x1b[1m── {title} ──\x1b[0m");
}

fn ok(line: impl AsRef<str>) {
    println!("  \x1b[32m✓\x1b[0m {}", line.as_ref());
}

fn no(line: impl AsRef<str>) {
    println!("  \x1b[31m✗\x1b[0m {}", line.as_ref());
}

/// The contract's own panic message, without the RPC wrapping.
fn reason(r: &ExecutionFinalResult) -> String {
    let t = failure_text(r).replace("\\\"", "'");
    t.split("Smart contract panicked: ").nth(1).map_or(t.clone(), |s| s.split('"').next().unwrap_or(s).to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    std::env::set_current_dir(env!("CARGO_MANIFEST_DIR"))?; // the shared helpers build ./ and ../mock-*
    println!("\x1b[1mPatchBond — local sandbox demo\x1b[0m (starting a NEAR sandbox and deploying the vault…)");
    let e = setup().await?;
    let tee: Value = serde_json::from_str(include_str!("../tests/fixtures/tee.json"))?;
    let ol: Value = serde_json::from_str(include_str!("../tests/fixtures/outlayer.json"))?;
    let signed_forfeit: Value = serde_json::from_str(include_str!("../tests/fixtures/genuine_forfeit.json"))?;
    let glm = ol["genuine_signer"].as_str().unwrap();
    e.link(REPO, &e.amaka).await?;
    e.owner
        .call(e.pb.id(), "set_tee_signers")
        .args_json(json!({ "signers": [glm] }))
        .transact()
        .await?
        .into_result()?;
    ok(format!("repo {REPO} registered; maintainer payout linked to {}", e.amaka.id()));
    ok(format!("contract trusts NEAR AI's GLM enclave key {glm} (from NEAR AI's attestation report)"));

    act("1 · A real contribution gets every cent back");
    let bond = e.quote(REPO, Some(&e.alice)).await?;
    e.pay(&e.alice, REPO, 1, bond, json!({})).await?.into_result()?;
    ok(format!("alice opens PR #1 and pays a {} USDC bond — held by the contract, not by us", usd(bond)));
    e.settle(REPO, 1, "refund").await?.into_result()?;
    ok(format!("the judge says refund → alice is back to {} (no proof needed to give money back)", usd(e.balance(&e.alice).await?)));

    act("2 · Slop pays the maintainer — but only if the enclave signed it");
    e.ft.call("mint").args_json(json!({ "account_id": e.bob.id(), "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
    let bond = e.quote(REPO, Some(&e.bob)).await?;
    e.pay(&e.bob, REPO, 2, bond, json!({})).await?.into_result()?;
    ok(format!("bob opens slop PR #2 and pays {}", usd(bond)));
    let forfeit = |number: u64, proof: Option<Value>| {
        e.oracle
            .call(e.pb.id(), "settle")
            .args_json(json!({ "repo_id": REPO, "number": number, "verdict": "forfeit", "verdict_hash": ZERO_HASH, "proof": proof }))
            .gas(Gas::from_tgas(150))
            .transact()
    };
    let r = forfeit(2, None).await?;
    no(format!("PatchBond's own server tries to forfeit with no signature → \"{}\"", reason(&r)));
    let mut tampered = signed_forfeit.clone();
    tampered["response"] = json!(tampered["response"].as_str().unwrap().replace("0.99", "0.98"));
    let r = forfeit(2, Some(tampered)).await?;
    no(format!("…with one byte of the signed answer changed: the signature now recovers to a stranger's key → \"{}\"", reason(&r)));
    let r = forfeit(2, Some(tee["live"]["proof"].clone())).await?;
    no(format!("…with a genuine NEAR AI signature on a *refund* → \"{}\"", reason(&r)));
    forfeit(2, Some(signed_forfeit.clone())).await?.into_result()?;
    let repo = e.view("get_repo", json!({ "repo_id": REPO })).await?;
    let fee = u(&e.view("get_config", json!({})).await?["treasury_balance"]);
    ok(format!("with NEAR AI's enclave-signed forfeit (\"pipes a remote script into a shell… none of the claimed work\", confidence 0.99): {} to the repo's vault, {} to PatchBond", usd(u(&repo["vault"])), usd(fee)));
    let next = e.quote(REPO, Some(&e.bob)).await?;
    ok(format!("bob's record is on-chain: his next bond here costs {} (was {})", usd(next), usd(bond)));

    act("3 · Only the maintainer can take the money");
    let vault = u(&repo["vault"]);
    let r = e.oracle.call(e.pb.id(), "withdraw").args_json(json!({ "repo_id": REPO, "amount": vault.to_string() })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    no(format!("the oracle tries to withdraw the vault → \"{}\"", reason(&r)));
    e.amaka
        .call(e.pb.id(), "withdraw")
        .args_json(json!({ "repo_id": REPO, "amount": vault.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    ok(format!("amaka (the linked maintainer) withdraws {} — her wallet now holds {}", usd(vault), usd(e.balance(&e.amaka).await?)));

    act("4 · A spam wave prices itself out (EIP-1559 for attention)");
    let spammer = account(&e.worker, "spammer").await?;
    e.ft.call("mint").args_json(json!({ "account_id": spammer.id(), "amount": (1000 * USDC).to_string() })).transact().await?.into_result()?;
    let mut prices = vec![];
    for n in 100..116 {
        let p = e.quote(REPO, Some(&spammer)).await?;
        prices.push(usd(p));
        e.pay(&spammer, REPO, n, p, json!({})).await?.into_result()?;
    }
    ok(format!("16 PRs in a row, each priced on-chain by the open queue: {}", prices.join(" → ")));
    ok(format!("and a newcomer arriving now would pay {}", usd(e.quote(REPO, Some(&e.alice)).await?)));

    act("5 · Judged in an OutLayer enclave: our server leaves the loop");
    let mock = e.worker.dev_deploy(&near_workspaces::compile_project("../mock-outlayer").await?).await?;
    e.owner
        .call(e.pb.id(), "set_outlayer")
        .args_json(json!({ "config": {
            "account": mock.id(), "project_id": "demo/judge", "version_key": null, "model": ol["model"],
            "record_url": null, "secrets_owner": null, "secrets_profile": null, "exclusive": true,
        } }))
        .transact()
        .await?
        .into_result()?;
    let bond = e.quote(REPO, Some(&e.alice)).await?;
    e.pay(&e.alice, REPO, 3, bond, json!({})).await?.into_result()?;
    let mut answer = ol["genuine"].clone();
    answer["repo_id"] = json!(REPO);
    answer["number"] = json!(3);
    mock.call("set_answer").args_json(json!({ "answer": answer.to_string() })).transact().await?.into_result()?;
    let r = e
        .bob
        .call(e.pb.id(), "judge_in_tee")
        .args_json(json!({ "repo_id": REPO, "number": 3 }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    r.clone().into_result()?;
    let verified = r.logs().iter().any(|l| l.contains("tee_verified") && l.contains(&glm[2..]));
    ok("anyone (here: bob) asks the contract to judge alice's PR #3 in OutLayer");
    ok(format!(
        "the enclave's answer — a real run on tcpdump#1471 — carries NEAR AI's signature; the contract recovered {} on-chain: {}",
        glm,
        if verified { "✓ genuine" } else { "✗" }
    ));
    ok(format!("verdict refund → alice holds {} again", usd(e.balance(&e.alice).await?)));
    let bond = e.quote(REPO, Some(&e.bob)).await?;
    e.pay(&e.bob, REPO, 4, bond, json!({})).await?.into_result()?;
    let r = forfeit(4, Some(signed_forfeit.clone())).await?;
    no(format!("bob pays {} on PR #4; with `exclusive` on, even a signed forfeit from our server is refused → \"{}\"", usd(bond), reason(&r)));

    println!("\n\x1b[1mDone.\x1b[0m Every line above was a real transaction on a local NEAR node. Tests: `cargo test -p patchbond-vault`.");
    Ok(())
}
