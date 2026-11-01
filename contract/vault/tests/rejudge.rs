//! Disputes judged without PatchBond's server (`src/rejudge.rs`). With OutLayer `exclusive` on, the
//! oracle can't forfeit, so a disputed verdict is re-judged in the enclave by the stronger model,
//! with both sides' statements taken from the contract. A mock stands in for `outlayer.near`;
//! `fixtures/rejudge.json` holds gateway-signed answers (server/scripts/make-rejudge-contract-fixtures.ts).
//! Run: `cargo test -p patchbond-vault --test rejudge`

mod common;
use common::*;

static MOCK_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

fn fx() -> Value {
    serde_json::from_str(include_str!("fixtures/rejudge.json")).unwrap()
}

struct T {
    e: Env,
    ol: Contract,
}

/// REPO linked to amaka, OutLayer configured with `exclusive` on, the test key registered for Kimi K3.
async fn setup_rejudge() -> anyhow::Result<T> {
    let e = setup().await?;
    let ol = e.worker.dev_deploy(MOCK_WASM.get_or_try_init(|| near_workspaces::compile_project("../mock-outlayer")).await?).await?;
    let f = fx();
    e.owner
        .call(e.pb.id(), "set_tee_signers")
        .args_json(json!({ "signers": [format!("{}@{}", f["test_signer"].as_str().unwrap(), f["model"].as_str().unwrap())] }))
        .transact()
        .await?
        .into_result()?;
    e.owner
        .call(e.pb.id(), "set_outlayer")
        .args_json(json!({ "config": {
            "account": ol.id(), "project_id": "patchbond.testnet/judge", "version_key": "ab".repeat(32),
            "model": "z-ai/glm-5.3-flash", "record_url": "https://example.org/api/tee-records",
            "secrets_owner": e.owner.id(), "secrets_profile": "judge", "exclusive": true,
        } }))
        .transact()
        .await?
        .into_result()?;
    e.link(REPO, &e.amaka).await?;
    Ok(T { e, ol })
}

impl T {
    /// alice bonds `number`, the maintainer forfeits it (a proposal), alice disputes it for free.
    async fn disputed(&self, number: u64) -> anyhow::Result<()> {
        let b = self.e.quote(REPO, Some(&self.e.alice)).await?;
        self.e.pay(&self.e.alice, REPO, number, b, json!({})).await?.into_result()?;
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

    async fn say(&self, who: &Account, number: u64, note: &str) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who.call(self.e.pb.id(), "add_statement").args_json(json!({ "repo_id": REPO, "number": number, "note": note })).transact().await?)
    }

    async fn rejudge(&self, number: u64, mut answer: Value) -> anyhow::Result<ExecutionFinalResult> {
        answer["repo_id"] = json!(REPO);
        answer["number"] = json!(number);
        self.ol.call("set_answer").args_json(json!({ "answer": answer.to_string() })).transact().await?.into_result()?;
        Ok(self
            .e
            .bob
            .call(self.e.pb.id(), "rejudge_in_tee")
            .args_json(json!({ "repo_id": REPO, "number": number }))
            .deposit(NearToken::from_millinear(10))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    async fn status(&self, number: u64) -> anyhow::Result<Value> {
        Ok(self.e.view("get_deposit", json!({ "repo_id": REPO, "number": number })).await?["status"].clone())
    }
}

fn outcome(r: &ExecutionFinalResult) -> String {
    r.logs()
        .iter()
        .find_map(|l| {
            let v: Value = serde_json::from_str(l.strip_prefix("EVENT_JSON:")?).ok()?;
            (v["event"] == "tee_result").then(|| v["data"][0]["outcome"].as_str().unwrap().to_string())
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn a_disputed_forfeit_is_rejudged_in_the_enclave_with_both_sides_statements() -> anyhow::Result<()> {
    let t = setup_rejudge().await?;
    let f = fx();
    t.disputed(1).await?;

    // Both sides speak on-chain; nobody else can, and each side gets two.
    t.say(&t.e.alice, 1, "The README fix is real: it repairs the link in #59.").await?.into_result()?;
    t.say(&t.e.amaka, 1, "It only adds a period; #59 is a contract bug.").await?.into_result()?;
    assert!(failure_text(&t.say(&t.e.bob, 1, "me too").await?).contains("Only the person who paid the bond or the repo's linked payout account"));
    t.say(&t.e.alice, 1, "Second point.").await?.into_result()?;
    assert!(failure_text(&t.say(&t.e.alice, 1, "Third.").await?).contains("Each side can add 2 statements"));
    assert_eq!(
        t.e.view("get_statements", json!({ "repo_id": REPO, "number": 1 })).await?,
        json!([
            { "from": "contributor", "note": "The README fix is real: it repairs the link in #59." },
            { "from": "maintainer", "note": "It only adds a period; #59 is a contract bug." },
            { "from": "contributor", "note": "Second point." },
        ])
    );

    // With `exclusive` on, our server can't end it in a forfeit, even with a proof.
    let r = t.e.oracle
        .call(t.e.pb.id(), "resolve_challenge")
        .args_json(json!({ "repo_id": REPO, "number": 1, "verdict": "forfeit", "verdict_hash": ZERO_HASH }))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("come only from the OutLayer enclave"), "{}", failure_text(&r));

    // The enclave re-judges: the stronger model signed a forfeit (the rules found no hard fact, but a
    // human already decided this one), so the maintainer's forfeit stands.
    let r = t.rejudge(1, f["model_forfeit_no_hard_fact"].clone()).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(outcome(&r), "forfeit");
    assert_eq!(t.status(1).await?["settled"]["verdict"], "forfeit");
    assert_eq!(t.e.view("get_rejudge_job", json!({ "repo_id": REPO, "number": 1 })).await?["state"], "judged");

    // Everything the enclave got came from the contract.
    let (args, _): (String, String) = t.ol.view("last_request").await?.json()?;
    let input: Value = serde_json::from_str(serde_json::from_str::<Value>(&args)?["input_data"].as_str().unwrap())?;
    assert_eq!(input["mode"], "rejudge");
    assert_eq!(input["model"], "moonshotai/kimi-k3");
    assert_eq!(input["proposed"], "forfeit");
    assert_eq!(input["challenger"], "contributor");
    assert_eq!(input["statements"].as_array().unwrap().len(), 3);
    Ok(())
}

#[tokio::test]
async fn a_rejudge_refund_wins_the_dispute_and_a_wrong_key_changes_nothing() -> anyhow::Result<()> {
    let t = setup_rejudge().await?;
    let f = fx();
    t.disputed(2).await?;

    // A key registered for Kimi K3 doesn't count for an answer that claims another model.
    let r = t.rejudge(2, f["other_model"].clone()).await?;
    assert_eq!(outcome(&r), "not_rejudged");
    assert!(t.status(2).await?.get("challenged").is_some(), "still disputed: {}", t.status(2).await?);
    assert!(t.e.view("get_rejudge_job", json!({ "repo_id": REPO, "number": 2 })).await?.is_null(), "anyone can ask again");

    // A refund from the stronger model overturns the maintainer's forfeit: alice gets her bond back.
    let before = t.e.balance(&t.e.alice).await?;
    let r = t.rejudge(2, f["refund"].clone()).await?;
    assert_eq!(outcome(&r), "refund");
    assert_eq!(t.status(2).await?["settled"]["verdict"], "refund");
    assert!(t.e.balance(&t.e.alice).await? > before);

    // Statements close once settled; a re-judge runs once.
    assert!(failure_text(&t.say(&t.e.alice, 2, "late").await?).contains("open dispute"));
    assert!(t.rejudge(2, f["refund"].clone()).await?.is_failure());
    Ok(())
}

/// A *staked* challenge of an AI verdict (not a maintainer's forfeit): the stronger model's forfeit
/// also needs the rules to agree (a hard fact), so a bare model forfeit resolves as a refund.
#[tokio::test]
async fn a_staked_challenge_needs_the_rules_to_agree_before_a_forfeit() -> anyhow::Result<()> {
    const W: u64 = 505;
    let t = setup_rejudge().await?;
    let f = fx();
    let mut p = instant_policy();
    p["challenge_window_sec"] = json!(3600);
    t.e.register(W, Some(p)).await?;
    t.e.link(W, &t.e.amaka).await?;
    t.e.ft.call("mint").args_json(json!({ "account_id": t.e.amaka.id(), "amount": (20 * USDC).to_string() })).transact().await?.into_result()?;
    let mut stake = 0;
    for n in [1u64, 2] {
        let b = t.e.quote(W, Some(&t.e.alice)).await?;
        t.e.pay(&t.e.alice, W, n, b, json!({})).await?.into_result()?;
        // The AI proposes a refund (the oracle may refund under `exclusive`); the maintainer stakes to challenge.
        t.e.oracle
            .call(t.e.pb.id(), "settle")
            .args_json(json!({ "repo_id": W, "number": n, "verdict": "refund", "verdict_hash": ZERO_HASH }))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?
            .into_result()?;
        stake = b;
        t.e.amaka
            .call(t.e.ft.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": t.e.pb.id(), "amount": b.to_string(), "msg": json!({ "action": "challenge", "repo_id": W, "number": n }).to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?
            .into_result()?;
    }
    let rejudge = |n: u64, mut answer: Value| {
        answer["repo_id"] = json!(W);
        answer["number"] = json!(n);
        let ol = t.ol.clone();
        let bob = t.e.bob.clone();
        let pb = t.e.pb.id().clone();
        async move {
            ol.call("set_answer").args_json(json!({ "answer": answer.to_string() })).transact().await?.into_result()?;
            anyhow::Ok(bob.call(&pb, "rejudge_in_tee").args_json(json!({ "repo_id": W, "number": n })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?)
        }
    };
    let status = |n: u64| t.e.view("get_deposit", json!({ "repo_id": W, "number": n }));

    // Model says forfeit, rules found no hard fact → the challenge fails: refund.
    let r = rejudge(1, f["model_forfeit_no_hard_fact"].clone()).await?;
    assert_eq!(outcome(&r), "refund");
    assert_eq!(status(1).await?["status"]["settled"]["verdict"], "refund");
    // Model and rules both say forfeit → the challenge wins: forfeit.
    let r = rejudge(2, f["full_forfeit"].clone()).await?;
    assert_eq!(outcome(&r), "forfeit");
    assert_eq!(status(2).await?["status"]["settled"]["verdict"], "forfeit");
    assert!(stake > 0);
    Ok(())
}
