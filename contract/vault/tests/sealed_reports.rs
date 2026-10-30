//! Sealed security reports (src/sealed.rs): keys are set by the right parties, a report bond is
//! bound to its ciphertext, and only that ciphertext can be judged — through the same enclave
//! callback (NEAR AI signature checked on-chain) as pull requests.
//! Run: `cargo test -p patchbond-vault --test sealed_reports`

mod common;
use common::*;

static MOCK_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();
const REPORT: u64 = 1_000_000_000_001;

fn sha256_hex(s: &str) -> String {
    use std::fmt::Write;
    let d = near_sdk::env::sha256(s.as_bytes());
    d.iter().fold(String::new(), |mut o, b| {
        let _ = write!(o, "{b:02x}");
        o
    })
}

async fn answer(ol: &Contract, v: Value) -> anyhow::Result<()> {
    ol.call("set_answer").args_json(json!({ "answer": v.to_string() })).transact().await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_sealed_report_is_bound_to_its_ciphertext_and_judged_in_the_enclave() -> anyhow::Result<()> {
    let e = setup().await?;
    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| near_workspaces::compile_project("../mock-outlayer")).await?).await?;
    let fx: Value = serde_json::from_str(include_str!("fixtures/outlayer.json"))?;
    e.owner.call(e.pb.id(), "set_tee_signers").args_json(json!({ "signers": [fx["genuine_signer"]] })).transact().await?.into_result()?;
    e.owner
        .call(e.pb.id(), "set_outlayer")
        .args_json(json!({ "config": { "account": ol.id(), "project_id": "x/judge", "version_key": null, "model": fx["model"], "record_url": null, "secrets_owner": null, "secrets_profile": null, "exclusive": false } }))
        .transact()
        .await?
        .into_result()?;
    e.link(REPO, &e.amaka).await?;
    let sealed = r#"{"v":1,"alg":"x25519-hkdf-sha256-chacha20poly1305","nonce":"AAAA","ct":"BBBB","to":[]}"#;
    let pay = |key_ready: bool| {
        let msg = json!({ "action": "report", "repo_id": REPO, "number": REPORT, "sealed_sha256": sha256_hex(sealed), "reporter": "alice" });
        let _ = key_ready;
        e.alice
            .call(e.ft.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": e.pb.id(), "amount": (5 * USDC).to_string(), "msg": msg.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
    };

    // No keys yet: the report bond is refused (and nothing is charged).
    let before = e.balance(&e.alice).await?;
    pay(false).await?.into_result()?;
    assert_eq!(e.balance(&e.alice).await?, before, "refunded: repo has no report key");

    // Only the linked payout account sets the maintainer key; only the enclave sets its own.
    let mk = "ab".repeat(32);
    assert!(e.oracle.call(e.pb.id(), "set_report_key").args_json(json!({ "repo_id": REPO, "key": mk })).transact().await?.is_failure());
    e.amaka.call(e.pb.id(), "set_report_key").args_json(json!({ "repo_id": REPO, "key": mk })).transact().await?.into_result()?;
    answer(&ol, json!({ "status": "pubkey", "pubkey": "cd".repeat(32) })).await?;
    e.bob.call(e.pb.id(), "refresh_enclave_key").deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    assert_eq!(e.view("get_enclave_key", json!({})).await?, "cd".repeat(32));
    assert_eq!(e.view("get_report_key", json!({ "repo_id": REPO })).await?, mk);

    // Now the bond is taken, bound to the envelope's sha256.
    pay(true).await?.into_result()?;
    let d = e.view("get_deposit", json!({ "repo_id": REPO, "number": REPORT })).await?;
    assert_eq!(d["kind"], "issue");
    assert_eq!(d["status"], "held");

    let judge = |s: &str| {
        e.bob
            .call(e.pb.id(), "judge_report_in_tee")
            .args_json(json!({ "repo_id": REPO, "number": REPORT, "sealed": s }))
            .deposit(NearToken::from_millinear(10))
            .gas(Gas::from_tgas(300))
            .transact()
    };
    // A different ciphertext can't be judged against this bond.
    let r = judge(&sealed.replace("BBBB", "CCCC")).await?;
    assert!(failure_text(&r).contains("isn't the report this bond was paid for"), "{}", failure_text(&r));

    // The genuine enclave answer (real NEAR AI signature) settles it, as for a PR.
    let mut out = fx["genuine"].clone();
    out["repo_id"] = json!(REPO);
    out["number"] = json!(REPORT);
    answer(&ol, out).await?;
    let r = judge(sealed).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.contains("tee_verified")));
    assert_eq!(e.view("get_deposit", json!({ "repo_id": REPO, "number": REPORT })).await?["status"]["settled"]["verdict"], "refund");
    // The enclave's input carried the sealed report and the maintainer's key, never plaintext.
    let (args, _): (String, String) = ol.view("last_request").await?.json()?;
    let input: Value = serde_json::from_str(serde_json::from_str::<Value>(&args)?["input_data"].as_str().unwrap())?;
    assert_eq!(input["mode"], "report");
    assert_eq!(input["sealed"], sealed);
    assert_eq!(input["maintainer_key"], mk);
    Ok(())
}
