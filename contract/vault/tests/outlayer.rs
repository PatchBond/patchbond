//! Judging without PatchBond's server (`src/outlayer.rs`): anyone asks the contract to judge a held
//! PR bond in OutLayer; the enclave's answer settles it only if NEAR AI's signature over the hashes
//! recovers to a registered enclave key. A mock stands in for `outlayer.near`; `fixtures/outlayer.json`
//! holds a genuine enclave run (real NEAR AI signature) and synthetic ones
//! (server/scripts/make-outlayer-contract-fixtures.ts).
//! Run: `cargo test -p patchbond-vault --test outlayer`

mod common;
use common::*;

static MOCK_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

fn fx() -> Value {
    serde_json::from_str(include_str!("fixtures/outlayer.json")).unwrap()
}

struct T {
    e: Env,
    ol: Contract,
}

async fn setup_outlayer(exclusive: bool) -> anyhow::Result<T> {
    let e = setup().await?;
    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| near_workspaces::compile_project("../mock-outlayer")).await?).await?;
    let f = fx();
    e.owner
        .call(e.pb.id(), "set_tee_signers")
        .args_json(json!({ "signers": [f["genuine_signer"], f["test_signer"]] }))
        .transact()
        .await?
        .into_result()?;
    e.owner
        .call(e.pb.id(), "set_outlayer")
        .args_json(json!({ "config": {
            "account": ol.id(), "project_id": "patchbond.testnet/judge", "version_key": "ab".repeat(32),
            "model": f["model"], "record_url": "https://example.org/api/tee-records",
            "secrets_owner": e.owner.id(), "secrets_profile": "judge", "exclusive": exclusive,
        } }))
        .transact()
        .await?
        .into_result()?;
    Ok(T { e, ol })
}

impl T {
    async fn bond(&self, number: u64) -> anyhow::Result<()> {
        let b = self.e.quote(REPO, Some(&self.e.alice)).await?;
        self.e.pay(&self.e.alice, REPO, number, b, json!({})).await?.into_result()?;
        Ok(())
    }

    /// Scripts OutLayer's answer (bound to `number`) and has bob ask for a judgment.
    async fn judge(&self, number: u64, answer: Option<Value>) -> anyhow::Result<ExecutionFinalResult> {
        let text = match answer {
            Some(Value::String(raw)) => raw,
            Some(mut a) => {
                if a.is_object() {
                    a["repo_id"] = json!(REPO);
                    a["number"] = json!(a.get("number_override").cloned().unwrap_or(json!(number)));
                }
                a.to_string()
            }
            None => "null".into(),
        };
        self.ol.call("set_answer").args_json(json!({ "answer": text })).transact().await?.into_result()?;
        Ok(self
            .e
            .bob
            .call(self.e.pb.id(), "judge_in_tee")
            .args_json(json!({ "repo_id": REPO, "number": number }))
            .deposit(NearToken::from_millinear(10))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    async fn status(&self, number: u64) -> anyhow::Result<Value> {
        Ok(self.e.view("get_deposit", json!({ "repo_id": REPO, "number": number })).await?["status"].clone())
    }

    /// "requested" / "judged" / null.
    async fn job(&self, number: u64) -> anyhow::Result<Value> {
        Ok(self.e.view("get_tee_job", json!({ "repo_id": REPO, "number": number })).await?.get("state").cloned().unwrap_or(Value::Null))
    }
}

fn outcome(r: &ExecutionFinalResult) -> String {
    r.logs()
        .iter()
        .find_map(|l| {
            let v: Value = serde_json::from_str(l.strip_prefix("EVENT_JSON:")?).ok()?;
            (v["event"] == "tee_result").then(|| format!("{}|{}", v["data"][0]["outcome"].as_str().unwrap(), v["data"][0]["detail"].as_str().unwrap()))
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn a_genuine_enclave_verdict_settles_with_a_hash_the_contract_computes_itself() -> anyhow::Result<()> {
    let t = setup_outlayer(false).await?;
    let f = fx();
    t.bond(1).await?;
    let r = t.judge(1, Some(f["genuine"].clone())).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    // Recovered NEAR AI's GLM key on-chain, refunded, and the verdict hash matches the TypeScript one.
    assert_eq!(outcome(&r), format!("refund|{}", f["genuine_verdict_hash"].as_str().unwrap()));
    assert!(r.logs().iter().any(|l| l.contains("tee_verified") && l.contains(&f["genuine_signer"].as_str().unwrap()[2..])));
    assert_eq!(t.status(1).await?["settled"]["verdict"], "refund");
    assert_eq!(t.job(1).await?, "judged");
    let job = t.e.view("get_tee_job", json!({ "repo_id": REPO, "number": 1 })).await?;
    assert_eq!(job["verdict_hash"], f["genuine_verdict_hash"]);

    // The enclave got everything from the contract, nothing from PatchBond's server.
    let (args, deposit): (String, String) = t.ol.view("last_request").await?.json()?;
    let args: Value = serde_json::from_str(&args)?;
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap())?;
    assert_eq!(input["github_user"], "alice");
    assert_eq!(input["reputation"], "new");
    assert_eq!(input["model"], f["model"]);
    assert_eq!(args["source"]["Project"]["version_key"], "ab".repeat(32));
    assert_eq!(args["secrets_ref"]["profile"], "judge");
    assert_eq!(args["payer_account_id"], t.e.bob.id().as_str());
    assert_eq!(deposit, NearToken::from_millinear(10).as_yoctonear().to_string());

    // One enclave judgment per deposit: no re-rolls.
    let r = t.judge(1, Some(f["genuine"].clone())).await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn only_a_forfeit_the_model_signed_strongly_enough_takes_the_bond() -> anyhow::Result<()> {
    let t = setup_outlayer(false).await?;
    let f = fx();
    for n in 1..=4 {
        t.bond(n).await?;
    }
    let r = t.judge(1, Some(f["forfeit"].clone())).await?;
    assert!(outcome(&r).starts_with("forfeit|"), "{}", outcome(&r));
    assert_eq!(t.status(1).await?["settled"]["verdict"], "forfeit");

    // The rules reached forfeit but the model said refund, or the model wasn't confident enough:
    // nothing moves, a maintainer decides (and no re-roll).
    for (n, which) in [(2, "rules_only_forfeit"), (3, "weak_forfeit")] {
        let r = t.judge(n, Some(f[which].clone())).await?;
        assert!(outcome(&r).starts_with("needs_human|"), "{which}: {}", outcome(&r));
        assert_eq!(t.status(n).await?, "held");
        assert_eq!(t.job(n).await?, "judged");
    }

    // Signed by a key NEAR AI never attested: rejected, the job is cleared so anyone can retry.
    let r = t.judge(4, Some(f["stranger_forfeit"].clone())).await?;
    assert!(outcome(&r).contains("isn't a registered NEAR AI enclave key"), "{}", outcome(&r));
    assert_eq!(t.status(4).await?, "held");
    assert_eq!(t.job(4).await?, Value::Null);
    Ok(())
}

#[tokio::test]
async fn failed_waiting_or_mismatched_runs_settle_nothing_and_can_be_retried() -> anyhow::Result<()> {
    let t = setup_outlayer(false).await?;
    let f = fx();
    t.bond(1).await?;

    // CI still running.
    let r = t.judge(1, Some(json!({ "status": "wait", "reason": "CI is still running" }))).await?;
    assert!(outcome(&r).starts_with("not_judged|wait: CI is still running"), "{}", outcome(&r));
    // A failed run (OutLayer returns null).
    let r = t.judge(1, None).await?;
    assert!(outcome(&r).contains("failed or returned nothing"), "{}", outcome(&r));
    // An answer about another PR.
    let mut other = f["forfeit"].clone();
    other["number_override"] = json!(99);
    let r = t.judge(1, Some(other)).await?;
    assert!(outcome(&r).contains("answered for 101#99"), "{}", outcome(&r));
    // A different model than configured.
    let mut wrong = f["forfeit"].clone();
    wrong["model"] = json!("some/other-model");
    let r = t.judge(1, Some(wrong)).await?;
    assert!(outcome(&r).contains("not z-ai/glm-5.3-flash"), "{}", outcome(&r));
    assert_eq!(t.status(1).await?, "held");

    // OutLayer refused the call outright: the NEAR comes back to whoever attached it.
    let before = t.e.bob.view_account().await?.balance;
    let r = t.judge(1, Some(json!("PANIC"))).await?;
    let after = t.e.bob.view_account().await?.balance;
    assert!(outcome(&r).contains("failed or returned nothing"), "{}", outcome(&r));
    assert!(!r.receipt_failures().is_empty(), "the mock refused the call");
    let spent = before.as_yoctonear() as i128 - after.as_yoctonear() as i128;
    assert!(spent < NearToken::from_millinear(5).as_yoctonear() as i128, "only gas was spent, not the 10 mNEAR: spent {spent}");
    assert_eq!(t.job(1).await?, Value::Null);

    // Bonds that aren't held, aren't PRs, or with no NEAR attached are refused up front.
    let r = t
        .e
        .bob
        .call(t.e.pb.id(), "judge_in_tee")
        .args_json(json!({ "repo_id": REPO, "number": 1 }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("Attach NEAR"), "{}", failure_text(&r));
    let r = t.judge(7, Some(f["forfeit"].clone())).await?;
    assert!(failure_text(&r).contains("has no deposit"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn exclusive_mode_takes_forfeits_away_from_the_oracle() -> anyhow::Result<()> {
    let t = setup_outlayer(true).await?;
    let tee: Value = serde_json::from_str(include_str!("fixtures/tee.json"))?;
    t.e.owner
        .call(t.e.pb.id(), "set_tee_signers")
        .args_json(json!({ "signers": [tee["test_signer"]] }))
        .transact()
        .await?
        .into_result()?;
    t.bond(1).await?;
    t.bond(2).await?;
    // Even with a valid TEE proof, PatchBond's server can't forfeit any more…
    let r = t
        .e
        .oracle
        .call(t.e.pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "forfeit", "verdict_hash": ZERO_HASH, "proof": tee["forfeit"] }))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("only from the OutLayer enclave"), "{}", failure_text(&r));
    // …but it can still refund (the safe direction).
    t.e.settle(REPO, 2, "refund").await?.into_result()?;
    assert_eq!(t.status(2).await?["settled"]["verdict"], "refund");

    // Only the owner configures it.
    let r = t.e.oracle.call(t.e.pb.id(), "set_outlayer").args_json(json!({ "config": null })).transact().await?;
    assert!(r.is_failure());
    assert_eq!(t.e.view("get_outlayer", json!({})).await?["exclusive"], true);
    Ok(())
}
