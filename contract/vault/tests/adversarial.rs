//! Attacks on the money paths (docs/TRUST.md): forged callbacks, late and replayed enclave answers,
//! admin changes mid-run, gateway/model key confusion, double bounty payouts, and the oracle trying
//! to re-point a repo. The mock OutLayer runs in deferred mode here — it yields like the real
//! `outlayer.near`, so other transactions land while the enclave "runs".
//! Run: `cargo test -p patchbond-vault --test adversarial`

mod common;
use common::*;
use near_workspaces::operations::TransactionStatus;

static MOCK_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

fn outlayer_fx() -> Value {
    serde_json::from_str(include_str!("fixtures/outlayer.json")).unwrap()
}
fn proofs_fx() -> Value {
    serde_json::from_str(include_str!("fixtures/proofs.json")).unwrap()
}
fn rejudge_fx() -> Value {
    serde_json::from_str(include_str!("fixtures/rejudge.json")).unwrap()
}

struct T {
    e: Env,
    ol: Contract,
}

/// OutLayer configured with `exclusive` on and the first-judgment test key registered; REPO linked
/// to amaka.
async fn setup_attack() -> anyhow::Result<T> {
    let e = setup().await?;
    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| wasm_of("../mock-outlayer", "mock_outlayer.wasm")).await?).await?;
    let t = T { e, ol };
    t.signers(json!([outlayer_fx()["test_signer"]])).await?;
    t.configure(true, "z-ai/glm-5.3-flash").await?;
    t.e.link(REPO, &t.e.amaka).await?;
    Ok(t)
}

impl T {
    async fn signers(&self, signers: Value) -> anyhow::Result<()> {
        self.e.owner.call(self.e.pb.id(), "set_tee_signers").args_json(json!({ "signers": signers })).transact().await?.into_result()?;
        Ok(())
    }

    async fn configure(&self, exclusive: bool, model: &str) -> anyhow::Result<()> {
        self.e
            .owner
            .call(self.e.pb.id(), "set_outlayer")
            .args_json(json!({ "config": {
                "account": self.ol.id(), "project_id": "patchbond.testnet/judge", "version_key": "ab".repeat(32),
                "model": model, "record_url": null, "secrets_owner": null, "secrets_profile": null, "exclusive": exclusive,
            } }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    async fn bond(&self, number: u64) -> anyhow::Result<()> {
        let b = self.e.quote(REPO, Some(&self.e.alice)).await?;
        self.e.pay(&self.e.alice, REPO, number, b, json!({})).await?.into_result()?;
        Ok(())
    }

    /// An enclave answer bound to `number`, as OutLayer would return it.
    fn answer(mut a: Value, number: u64) -> String {
        a["repo_id"] = json!(REPO);
        a["number"] = json!(number);
        a.to_string()
    }

    /// Instant mode: the mock answers `answer` inside the same transaction.
    async fn call_now(&self, method: &str, args: Value, answer: String) -> anyhow::Result<ExecutionFinalResult> {
        self.ol.call("set_deferred").args_json(json!({ "deferred": false })).transact().await?.into_result()?;
        self.ol.call("set_answer").args_json(json!({ "answer": answer })).transact().await?.into_result()?;
        Ok(self.e.bob.call(self.e.pb.id(), method).args_json(args).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?)
    }

    /// Deferred mode: starts `method` and returns once the enclave run is waiting for its answer.
    async fn start(&self, method: &str, args: Value) -> anyhow::Result<TransactionStatus> {
        self.ol.call("set_deferred").args_json(json!({ "deferred": true })).transact().await?.into_result()?;
        let run = self.e.bob.call(self.e.pb.id(), method).args_json(args).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact_async().await?;
        for _ in 0..60 {
            if self.ol.view("waiting").await?.json::<bool>()? {
                return Ok(run);
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        anyhow::bail!("the mock never started waiting")
    }

    /// Delivers the enclave's answer to the waiting run and returns the finished transaction.
    async fn resume(&self, run: TransactionStatus, answer: String) -> anyhow::Result<ExecutionFinalResult> {
        self.ol.call("resume").args_json(json!({ "answer": answer })).transact().await?.into_result()?;
        Ok(run.await?)
    }

    async fn status(&self, number: u64) -> anyhow::Result<Value> {
        Ok(self.e.view("get_deposit", json!({ "repo_id": REPO, "number": number })).await?["status"].clone())
    }

    /// alice bonds `number`, amaka (the maintainer) forfeits it, alice disputes it for free.
    async fn disputed(&self, number: u64) -> anyhow::Result<()> {
        self.bond(number).await?;
        self.e
            .amaka
            .call(self.e.pb.id(), "settle")
            .args_json(json!({ "repo_id": REPO, "number": number, "verdict": "forfeit", "verdict_hash": ZERO_HASH }))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?
            .into_result()?;
        self.e.alice.call(self.e.pb.id(), "dispute").args_json(json!({ "repo_id": REPO, "number": number })).transact().await?.into_result()?;
        Ok(())
    }
}

/// The last `event`'s `outcome` (or `detail` when asked) from the logs.
fn event(r: &ExecutionFinalResult, name: &str, field: &str) -> String {
    r.logs()
        .iter()
        .filter_map(|l| serde_json::from_str::<Value>(l.strip_prefix("EVENT_JSON:")?).ok())
        .filter(|v| v["event"] == name)
        .filter_map(|v| v["data"][0][field].as_str().map(String::from))
        .next_back()
        .unwrap_or_default()
}

#[tokio::test]
async fn nobody_can_call_the_enclave_callbacks_directly() -> anyhow::Result<()> {
    let t = setup_attack().await?;
    t.bond(1).await?;
    let fake = |method: &str, args: Value| t.e.bob.call(t.e.pb.id(), method).args_json(args).gas(Gas::from_tgas(100)).transact();
    let attempts = [
        ("on_tee_judgment", json!({ "repo_id": REPO, "number": 1, "caller": t.e.bob.id(), "attached": "0" })),
        ("on_tee_rejudgment", json!({ "repo_id": REPO, "number": 1, "free": true, "caller": t.e.bob.id(), "attached": "0" })),
        ("on_tee_bounty", json!({ "repo_id": REPO, "issue": 7, "fix": 2, "recipient": t.e.bob.id(), "caller": t.e.bob.id(), "attached": "0" })),
        ("on_send", json!({ "to": t.e.bob.id(), "amount": "1000000", "currency": "usdc", "fallback": "Claimable" })),
    ];
    for (method, args) in attempts {
        let r = fake(method, args).await?;
        assert!(failure_text(&r).contains("is private"), "{method}: {}", failure_text(&r));
    }
    assert_eq!(t.status(1).await?, "held");
    Ok(())
}

#[tokio::test]
async fn a_late_enclave_forfeit_cannot_undo_a_refund_given_while_it_ran() -> anyhow::Result<()> {
    let t = setup_attack().await?;
    t.bond(1).await?;
    let before = t.e.balance(&t.e.alice).await?;
    let run = t.start("judge_in_tee", json!({ "repo_id": REPO, "number": 1 })).await?;

    // While the enclave runs, the maintainer refunds the bond.
    t.e.amaka
        .call(t.e.pb.id(), "settle")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "refund", "verdict_hash": ZERO_HASH }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let r = t.resume(run, T::answer(outlayer_fx()["forfeit"].clone(), 1)).await?;
    assert_eq!(event(&r, "tee_result", "outcome"), "already_decided");
    assert_eq!(t.status(1).await?["settled"]["verdict"], "refund");
    assert!(t.e.balance(&t.e.alice).await? > before, "alice got her bond back, once");
    Ok(())
}

#[tokio::test]
async fn one_run_at_a_time_and_admin_changes_mid_run_void_the_answer() -> anyhow::Result<()> {
    let t = setup_attack().await?;
    t.bond(1).await?;
    let forfeit = || T::answer(outlayer_fx()["forfeit"].clone(), 1);

    let run = t.start("judge_in_tee", json!({ "repo_id": REPO, "number": 1 })).await?;
    let again = t.e.bob.call(t.e.pb.id(), "judge_in_tee").args_json(json!({ "repo_id": REPO, "number": 1 })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(failure_text(&again).contains("one is running"), "no second roll of the dice: {}", failure_text(&again));
    // The owner switches the judge model while it runs: an answer from the old model doesn't count.
    t.configure(true, "some/other-model").await?;
    let r = t.resume(run, forfeit()).await?;
    assert!(event(&r, "tee_result", "detail").contains("not some/other-model"), "{:?}", r.logs());
    assert_eq!(t.status(1).await?, "held");

    // The owner turns OutLayer off mid-run: the answer is dropped, nothing settles.
    t.configure(true, "z-ai/glm-5.3-flash").await?;
    let run = t.start("judge_in_tee", json!({ "repo_id": REPO, "number": 1 })).await?;
    t.e.owner.call(t.e.pb.id(), "set_outlayer").args_json(json!({ "config": null })).transact().await?.into_result()?;
    let r = t.resume(run, forfeit()).await?;
    assert!(event(&r, "tee_result", "detail").contains("turned off"), "{:?}", r.logs());
    assert_eq!(t.status(1).await?, "held");
    Ok(())
}

#[tokio::test]
async fn one_signed_forfeit_settles_one_deposit_even_if_the_relay_rewrites_which() -> anyhow::Result<()> {
    let t = setup_attack().await?;
    let f = proofs_fx();
    t.signers(json!([f["enclave_signer"]])).await?;
    t.bond(1).await?;
    t.bond(2).await?;
    let signed = &f["forfeit"]["1"];
    let r = t.call_now("judge_in_tee", json!({ "repo_id": REPO, "number": 1 }), T::answer(signed["output"].clone(), 1)).await?;
    assert_eq!(event(&r, "tee_result", "outcome"), "forfeit_pending");
    // A compromised worker replays the same signed answer, relabelled as deposit #2: the signed
    // request says #1, so its bytes can't confirm #2.
    let r = t.call_now("judge_in_tee", json!({ "repo_id": REPO, "number": 2 }), T::answer(signed["output"].clone(), 2)).await?;
    assert_eq!(event(&r, "tee_result", "outcome"), "forfeit_pending");
    let confirm = |n: u64| t.e.bob.call(t.e.pb.id(), "confirm_tee_forfeit").args_json(json!({ "repo_id": REPO, "number": n, "proof": signed["proof"] })).gas(Gas::from_tgas(150)).transact();
    let r = confirm(2).await?;
    assert!(failure_text(&r).contains("the signed request is about"), "{}", failure_text(&r));
    assert_eq!(t.status(2).await?, "held");

    confirm(1).await?.into_result()?;
    assert_eq!(t.status(1).await?["settled"]["verdict"], "forfeit");
    Ok(())
}

#[tokio::test]
async fn gateway_keys_and_model_keys_are_not_interchangeable() -> anyhow::Result<()> {
    let t = setup_attack().await?;
    let f = rejudge_fx();
    let gateway = f["test_signer"].as_str().unwrap();

    // A gateway key registered for the judge model still can't sign a first judgment: that path
    // accepts only a model's own enclave key.
    t.signers(json!([format!("{gateway}@z-ai/glm-5.3-flash")])).await?;
    t.bond(1).await?;
    let mut a = f["full_forfeit"].clone();
    a["model"] = json!("z-ai/glm-5.3-flash");
    let r = t.call_now("judge_in_tee", json!({ "repo_id": REPO, "number": 1 }), T::answer(a, 1)).await?;
    assert!(event(&r, "tee_result", "detail").contains("isn't a registered NEAR AI enclave key"), "{:?}", r.logs());
    assert_eq!(t.status(1).await?, "held");

    // The gateway key registered *bare* (as if it were a model key) doesn't count for a re-judge:
    // a gateway signature counts only when registered for that model.
    t.signers(json!([gateway])).await?;
    t.disputed(2).await?;
    let r = t.call_now("rejudge_in_tee", json!({ "repo_id": REPO, "number": 2 }), T::answer(f["full_forfeit"].clone(), 2)).await?;
    assert!(event(&r, "tee_result", "detail").contains("isn't a registered NEAR AI key for moonshotai/kimi-k3"), "{:?}", r.logs());
    assert!(t.status(2).await?.get("challenged").is_some());

    // Key rotation takes effect at once: with the key removed, its signature is refused.
    t.signers(json!([outlayer_fx()["test_signer"]])).await?;
    t.signers(json!([])).await?;
    t.bond(3).await?;
    let r = t.call_now("judge_in_tee", json!({ "repo_id": REPO, "number": 3 }), T::answer(outlayer_fx()["forfeit"].clone(), 3)).await?;
    assert!(event(&r, "tee_result", "detail").contains("isn't a registered NEAR AI enclave key"), "{:?}", r.logs());
    Ok(())
}

#[tokio::test]
async fn a_bounty_is_paid_once_however_the_claims_race() -> anyhow::Result<()> {
    // Create the bounty before OutLayer is configured (the oracle route, no keys registered yet).
    let e = setup().await?;
    let bond = e.quote(REPO, None).await?;
    e.pay(&e.alice, REPO, 10, bond, json!({ "fixes_issue": 7 })).await?.into_result()?;
    e.settle(REPO, 10, "forfeit").await?.into_result()?;
    let share = bond - bond / 10;
    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| wasm_of("../mock-outlayer", "mock_outlayer.wasm")).await?).await?;
    let t = T { e, ol };
    t.configure(true, "z-ai/glm-5.3-flash").await?;
    let claim = |to: &Account| json!({ "repo_id": REPO, "issue": 7, "fix": 11, "recipient": to.id() });
    let ok = |to: &Account| json!({ "repo_id": REPO, "number": 7, "status": "fix_ok", "fix": 11, "recipient": to.id(), "author": "bob-gh" }).to_string();

    let amaka_before = t.e.balance(&t.e.amaka).await?;
    let run = t.start("claim_bounty_in_tee", claim(&t.e.bob)).await?;
    // A second claim while the first is checked is refused…
    let second = t.e.amaka.call(t.e.pb.id(), "claim_bounty_in_tee").args_json(claim(&t.e.amaka)).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(failure_text(&second).contains("already being checked"), "{}", failure_text(&second));
    // …and if the owner turns `exclusive` off and the oracle pays it meanwhile, the first claim finds nothing left.
    t.configure(false, "z-ai/glm-5.3-flash").await?;
    t.e.oracle.call(t.e.pb.id(), "pay_bounty").args_json(json!({ "repo_id": REPO, "issue": 7, "recipient": t.e.amaka.id() })).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    let r = t.resume(run, ok(&t.e.bob)).await?;
    assert_eq!(event(&r, "bounty_claim", "outcome"), "not_paid");
    assert_eq!(event(&r, "bounty_claim", "detail"), "no bounty left");
    assert_eq!(t.e.balance(&t.e.bob).await?, 0);
    assert_eq!(t.e.balance(&t.e.amaka).await? - amaka_before, share, "paid exactly once");
    Ok(())
}

#[tokio::test]
async fn the_oracle_cannot_repoint_a_linked_repo() -> anyhow::Result<()> {
    let t = setup_attack().await?;
    // Renaming the repo would let a forfeit signed for another repo match this one.
    let r = t.e.oracle.call(t.e.pb.id(), "set_repo_name").args_json(json!({ "repo_id": REPO, "name": "evil/repo" })).transact().await?;
    assert!(failure_text(&r).contains("Only the oracle (once)"), "{}", failure_text(&r));
    // Re-linking would hand the vault to the oracle.
    let r = t.e.oracle.call(t.e.pb.id(), "link_repo").args_json(json!({ "repo_id": REPO, "payout": t.e.oracle.id() })).transact().await?;
    assert!(failure_text(&r).contains("already linked"), "{}", failure_text(&r));
    // It can't change the policy of a linked repo either, nor withdraw.
    let p = t.e.view("get_repo", json!({ "repo_id": REPO })).await?["policy"].clone();
    let r = t.e.oracle.call(t.e.pb.id(), "set_policy").args_json(json!({ "repo_id": REPO, "policy": p })).transact().await?;
    assert!(failure_text(&r).contains("Only the repo's linked payout account"), "{}", failure_text(&r));
    let r = t.e.oracle.call(t.e.pb.id(), "withdraw").args_json(json!({ "repo_id": REPO, "amount": "1" })).deposit(NearToken::from_yoctonear(1)).transact().await?;
    assert!(r.is_failure());
    assert_eq!(t.e.view("get_repo_name", json!({ "repo_id": REPO })).await?, "acme/widget");
    Ok(())
}
