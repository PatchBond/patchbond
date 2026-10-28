//! Optimistic AI verdicts with stake-to-challenge, and capped agent wallets with function-call keys.
//! Run: `cargo test -p patchbond-vault --test optimistic_and_agents`

mod common;
use common::*;
use near_workspaces::types::{AccessKey, KeyType, SecretKey};

const OPT: u64 = 505;

/// Repo OPT: AI verdicts stand after a 20-second challenge window.
async fn optimistic() -> anyhow::Result<Env> {
    let e = setup().await?;
    let mut p = instant_policy();
    p["challenge_window_sec"] = json!(20);
    e.register(OPT, Some(p)).await?;
    e.link(OPT, &e.amaka).await?;
    for who in [&e.amaka, &e.bob] {
        e.ft.call("mint")
            .args_json(json!({ "account_id": who.id(), "amount": (20 * USDC).to_string() }))
            .transact()
            .await?
            .into_result()?;
    }
    Ok(e)
}

impl Env {
    async fn challenge(&self, who: &Account, repo: u64, number: u64, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.ft.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": self.pb.id(), "amount": amount.to_string(),
                "msg": json!({ "action": "challenge", "repo_id": repo, "number": number }).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?)
    }

    async fn resolve(&self, repo: u64, number: u64, verdict: &str) -> anyhow::Result<ExecutionFinalResult> {
        Ok(self
            .oracle
            .call(self.pb.id(), "resolve_challenge")
            .args_json(json!({ "repo_id": repo, "number": number, "verdict": verdict, "verdict_hash": ZERO_HASH }))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?)
    }

    async fn status(&self, repo: u64, number: u64) -> anyhow::Result<Value> {
        Ok(self.view("get_deposit", json!({ "repo_id": repo, "number": number })).await?["status"].clone())
    }

    /// Let the 20-second challenge window pass.
    async fn wait_window(&self) -> anyhow::Result<()> {
        self.worker.fast_forward(300).await?;
        Ok(())
    }
}

#[tokio::test]
async fn an_unchallenged_ai_verdict_stands_after_the_window() -> anyhow::Result<()> {
    let e = optimistic().await?;
    let bond = e.quote(OPT, None).await?;
    e.pay(&e.alice, OPT, 1, bond, json!({})).await?.into_result()?;
    e.settle(OPT, 1, "forfeit").await?.into_result()?;

    assert!(e.status(OPT, 1).await?["proposed"].is_object(), "verdict is only proposed");
    assert_eq!(e.view("get_repo", json!({ "repo_id": OPT })).await?["open"], 0, "AI-reviewed → off the queue");
    assert_eq!(u(&e.view("get_repo", json!({ "repo_id": OPT })).await?["vault"]), 0, "no money moved yet");

    let early = e.bob.call(e.pb.id(), "finalize").args_json(json!({ "repo_id": OPT, "number": 1 })).transact().await?;
    assert!(failure_text(&early).contains("still open"));

    e.wait_window().await?;
    e.bob
        .call(e.pb.id(), "finalize")
        .args_json(json!({ "repo_id": OPT, "number": 1 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(u(&e.view("get_repo", json!({ "repo_id": OPT })).await?["vault"]), bond - bond / 10);
    Ok(())
}

#[tokio::test]
async fn a_contributor_who_wins_a_challenge_gets_bond_and_stake_back() -> anyhow::Result<()> {
    let e = optimistic().await?;
    let bond = e.quote(OPT, None).await?;
    e.pay(&e.alice, OPT, 1, bond, json!({})).await?.into_result()?;
    e.settle(OPT, 1, "forfeit").await?.into_result()?;

    let bob_tries = e.challenge(&e.bob, OPT, 1, bond).await?;
    assert!(failure_text(&bob_tries).contains("Only the person who paid"));
    assert_eq!(e.balance(&e.bob).await?, 20 * USDC, "bob's stake refunded");
    let cheap = e.challenge(&e.alice, OPT, 1, bond / 2).await?;
    assert!(failure_text(&cheap).contains("stakes the bond"), "{}", failure_text(&cheap));

    e.challenge(&e.alice, OPT, 1, bond).await?.into_result()?;
    assert!(e.status(OPT, 1).await?["challenged"].is_object());
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - 2 * bond);

    e.wait_window().await?;
    let fin = e.bob.call(e.pb.id(), "finalize").args_json(json!({ "repo_id": OPT, "number": 1 })).transact().await?;
    assert!(failure_text(&fin).contains("being challenged"), "a challenge freezes the clock");

    e.resolve(OPT, 1, "refund").await?.into_result()?; // the stronger model overturns
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC, "bond + stake back");
    assert_eq!(u(&e.view("get_repo", json!({ "repo_id": OPT })).await?["vault"]), 0);
    assert_eq!(u(&e.view("get_totals", json!({})).await?["held"]), 0);
    Ok(())
}

#[tokio::test]
async fn a_contributor_who_loses_a_challenge_pays_the_stake_to_the_repo() -> anyhow::Result<()> {
    let e = optimistic().await?;
    let bond = e.quote(OPT, None).await?;
    e.pay(&e.alice, OPT, 1, bond, json!({})).await?.into_result()?;
    e.settle(OPT, 1, "forfeit").await?.into_result()?;
    e.challenge(&e.alice, OPT, 1, bond).await?.into_result()?;
    e.resolve(OPT, 1, "forfeit").await?.into_result()?; // upheld

    assert_eq!(e.balance(&e.alice).await?, 100 * USDC - 2 * bond);
    let vault = u(&e.view("get_repo", json!({ "repo_id": OPT })).await?["vault"]);
    assert_eq!(vault, bond + (bond - bond / 10), "stake + 90% of the bond");
    assert_eq!(e.view("get_reputation", json!({ "account_id": e.alice.id() })).await?["forfeits"], 1);
    Ok(())
}

#[tokio::test]
async fn a_maintainer_who_loses_a_challenge_pays_the_contributor() -> anyhow::Result<()> {
    let e = optimistic().await?;
    let bond = e.quote(OPT, None).await?;
    e.pay(&e.alice, OPT, 1, bond, json!({})).await?.into_result()?;
    e.settle(OPT, 1, "refund").await?.into_result()?;

    let not_hers = e.challenge(&e.alice, OPT, 1, bond).await?;
    assert!(failure_text(&not_hers).contains("Only the repo's linked payout account can challenge a refund"));
    e.challenge(&e.amaka, OPT, 1, bond).await?.into_result()?;

    let self_judge = e
        .amaka
        .call(e.pb.id(), "settle")
        .args_json(json!({ "repo_id": OPT, "number": 1, "verdict": "forfeit", "verdict_hash": ZERO_HASH }))
        .transact()
        .await?;
    assert!(failure_text(&self_judge).contains("re-judge decides"), "no judging your own challenge");

    e.resolve(OPT, 1, "refund").await?.into_result()?; // upheld: it was a real contribution
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC + bond, "bond back + the maintainer's stake");
    assert_eq!(e.balance(&e.amaka).await?, 20 * USDC - bond);
    Ok(())
}

#[tokio::test]
async fn a_maintainer_can_refund_at_once_but_not_overrule_a_proposed_refund() -> anyhow::Result<()> {
    let e = optimistic().await?;
    let bond = e.quote(OPT, None).await?;
    e.pay(&e.alice, OPT, 1, bond, json!({})).await?.into_result()?;
    e.settle(OPT, 1, "refund").await?.into_result()?;
    let again = e.settle(OPT, 1, "forfeit").await?;
    assert!(failure_text(&again).contains("challenge it instead"), "the oracle can't re-propose");

    let maintainer = |verdict: &str| {
        e.amaka
            .call(e.pb.id(), "settle")
            .args_json(json!({ "repo_id": OPT, "number": 1, "verdict": verdict, "verdict_hash": ZERO_HASH }))
            .gas(Gas::from_tgas(100))
            .transact()
    };
    // Taking the bond against the AI's refund needs a staked challenge, not a say-so.
    let grab = maintainer("forfeit").await?;
    assert!(failure_text(&grab).contains("stake a challenge"), "{}", failure_text(&grab));
    // Giving it back early is always fine.
    maintainer("refund").await?.into_result()?;
    assert!(e.status(OPT, 1).await?["settled"].is_object());
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);
    assert_eq!(e.view("get_repo", json!({ "repo_id": OPT })).await?["open"], 0, "queue counted once");
    Ok(())
}

// ---------- agents ----------

const FLAT: u64 = 606;

/// Mike funds a budget (10 USDC, cap 2.5/day) for his agent on a repo with a flat $1 bond.
async fn agent_setup() -> anyhow::Result<(Env, Account, Account)> {
    let e = setup().await?;
    let mut p = instant_policy();
    for k in ["base_bond", "min_bond", "max_bond"] {
        p[k] = json!("1000000");
    }
    e.register(FLAT, Some(p)).await?;
    let mike = account(&e.worker, "mike").await?;
    let agent = account(&e.worker, "agent").await?;
    e.ft.call("mint")
        .args_json(json!({ "account_id": mike.id(), "amount": (10 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    mike.call(e.ft.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": e.pb.id(), "amount": (10 * USDC).to_string(),
            "msg": json!({ "action": "fund_budget", "agent": agent.id(), "daily_cap": "2500000" }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?
        .into_result()?;
    Ok((e, mike, agent))
}

fn passport(operator: &Account) -> Value {
    json!({ "operator": operator.id(), "harness": "claude-code", "model": "claude-opus-5-5" })
}

async fn agent_deposit(e: &Env, agent: &Account, mike: &Account, number: u64) -> anyhow::Result<ExecutionFinalResult> {
    Ok(agent
        .call(e.pb.id(), "deposit_from_budget")
        .args_json(json!({
            "repo_id": FLAT, "number": number, "kind": "pr", "github_user": "mikes-bot",
            "passport": passport(mike),
        }))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?)
}

#[tokio::test]
async fn the_contract_enforces_the_agents_daily_cap() -> anyhow::Result<()> {
    let (e, mike, agent) = agent_setup().await?;
    agent_deposit(&e, &agent, &mike, 1).await?.into_result()?;
    agent_deposit(&e, &agent, &mike, 2).await?.into_result()?;
    let over = agent_deposit(&e, &agent, &mike, 3).await?;
    assert!(failure_text(&over).contains("Daily cap reached"), "{}", failure_text(&over));

    let b = e.view("get_budget", json!({ "agent": agent.id() })).await?;
    assert_eq!(u(&b["balance"]), 8 * USDC);
    assert_eq!(u(&b["spent_today"]), 2 * USDC);

    // Refunds flow back into the budget, not to the agent's own wallet.
    e.settle(FLAT, 1, "refund").await?.into_result()?;
    e.settle(FLAT, 2, "forfeit").await?.into_result()?;
    assert_eq!(u(&e.view("get_budget", json!({ "agent": agent.id() })).await?["balance"]), 9 * USDC);
    assert_eq!(e.balance(&agent).await?, 0);

    let stats = e.view("get_harness_stats", json!({ "harness": "Claude-Code" })).await?;
    assert_eq!((stats["deposits"].as_u64(), stats["refunds"].as_u64(), stats["forfeits"].as_u64()), (Some(2), Some(1), Some(1)));
    assert_eq!(e.view("get_passport", json!({ "agent": agent.id() })).await?, passport(&mike));
    Ok(())
}

#[tokio::test]
async fn a_function_call_key_can_pay_bonds_and_nothing_else() -> anyhow::Result<()> {
    let (e, mike, agent) = agent_setup().await?;
    // Mike gives the agent a key limited to deposit_from_budget on PatchBond.
    let sk = SecretKey::from_random(KeyType::ED25519);
    agent
        .batch(agent.id())
        .add_key(
            sk.public_key(),
            AccessKey::function_call_access(e.pb.id(), &["deposit_from_budget"], Some(NearToken::from_near(1))),
        )
        .transact()
        .await?
        .into_result()?;
    let restricted = Account::from_secret_key(agent.id().clone(), sk, &e.worker);

    agent_deposit(&e, &restricted, &mike, 1).await?.into_result()?;
    assert_eq!(u(&e.view("get_budget", json!({ "agent": agent.id() })).await?["balance"]), 9 * USDC);

    let other_method = restricted
        .call(e.pb.id(), "withdraw_budget")
        .args_json(json!({ "agent": agent.id(), "amount": "1" }))
        .transact()
        .await;
    assert!(other_method.map(|r| r.is_failure()).unwrap_or(true), "key is limited to one method");
    let other_contract = restricted
        .call(e.ft.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": agent.id(), "amount": "1" }))
        .transact()
        .await;
    assert!(other_contract.map(|r| r.is_failure()).unwrap_or(true), "key is limited to PatchBond");
    Ok(())
}

#[tokio::test]
async fn only_the_owner_controls_the_budget() -> anyhow::Result<()> {
    let (e, mike, agent) = agent_setup().await?;
    let wrong_operator = agent
        .call(e.pb.id(), "deposit_from_budget")
        .args_json(json!({
            "repo_id": FLAT, "number": 1, "kind": "pr", "github_user": "mikes-bot",
            "passport": passport(&e.bob),
        }))
        .transact()
        .await?;
    assert!(failure_text(&wrong_operator).contains("passport.operator must be the budget's owner"));

    let steal = agent
        .call(e.pb.id(), "withdraw_budget")
        .args_json(json!({ "agent": agent.id(), "amount": "1000000" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(failure_text(&steal).contains("Only the budget's owner"), "the agent can't drain its own budget");

    let hijack = e
        .alice
        .call(e.ft.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": e.pb.id(), "amount": "1000000",
            "msg": json!({ "action": "fund_budget", "agent": agent.id(), "daily_cap": "999000000" }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(failure_text(&hijack).contains("belongs to"), "nobody else can raise the cap");
    assert_eq!(e.balance(&e.alice).await?, 100 * USDC);

    mike.call(e.pb.id(), "withdraw_budget")
        .args_json(json!({ "agent": agent.id(), "amount": (4 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.balance(&mike).await?, 4 * USDC);
    assert_eq!(u(&e.view("get_budget", json!({ "agent": agent.id() })).await?["balance"]), 6 * USDC);
    Ok(())
}
