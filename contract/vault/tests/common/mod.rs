//! Shared sandbox setup for the integration tests.
#![allow(dead_code)]

pub use near_workspaces::network::Sandbox;
pub use near_workspaces::result::ExecutionFinalResult;
pub use near_workspaces::types::{Gas, NearToken};
pub use near_workspaces::{Account, Contract, Worker};
pub use serde_json::{json, Value};

/// Each wasm is compiled once per test binary: parallel tests compiling at the same time fight
/// over cargo's lock and fail now and then.
static VAULT_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();
static FT_WASM: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

pub async fn vault_wasm() -> anyhow::Result<&'static [u8]> {
    Ok(VAULT_WASM.get_or_try_init(|| near_workspaces::compile_project("./")).await?)
}

pub async fn ft_wasm() -> anyhow::Result<&'static [u8]> {
    Ok(FT_WASM.get_or_try_init(|| near_workspaces::compile_project("../mock-ft")).await?)
}

pub const USDC: u128 = 1_000_000;
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
pub const REPO: u64 = 101;
pub const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub ft: Contract,
    /// A second NEP-141 playing wNEAR (wrapping itself is wrap.near's job, not ours).
    pub wnear: Contract,
    pub pb: Contract,
    pub oracle: Account,
    pub owner: Account,
    pub treasury: Account,
    pub alice: Account,
    pub amaka: Account,
    pub bob: Account,
}

pub async fn account(worker: &Worker<Sandbox>, name: &str) -> anyhow::Result<Account> {
    let root = worker.root_account()?;
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?)
}

pub async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let ft = worker
        .dev_deploy(ft_wasm().await?)
        .await?;
    ft.call("new").transact().await?.into_result()?;
    let wnear = worker
        .dev_deploy(ft_wasm().await?)
        .await?;
    wnear.call("new").transact().await?.into_result()?;
    let pb = worker
        .dev_deploy(vault_wasm().await?)
        .await?;

    let owner = account(&worker, "owner").await?;
    let oracle = account(&worker, "oracle").await?;
    let treasury = account(&worker, "treasury").await?;
    let alice = account(&worker, "alice").await?;
    let amaka = account(&worker, "amaka").await?;
    let bob = account(&worker, "bob").await?;

    pb.call("new")
        .args_json(json!({
            "owner": owner.id(), "oracle": oracle.id(),
            "treasury": treasury.id(), "token": ft.id(), "wnear": wnear.id(),
        }))
        .transact()
        .await?
        .into_result()?;
    for (who, amount) in [
        (pb.id(), 0),
        (alice.id(), 100 * USDC),
        (amaka.id(), 0),
        (bob.id(), 0),
        (treasury.id(), 0),
    ] {
        ft.call("mint")
            .args_json(json!({ "account_id": who, "amount": amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
        let near_amount = if amount > 0 { 100 * NEAR } else { 0 };
        wnear
            .call("mint")
            .args_json(json!({ "account_id": who, "amount": near_amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
    }
    let env = Env { worker, ft, wnear, pb, oracle, owner, treasury, alice, amaka, bob };
    env.register(REPO, Some(instant_policy())).await?;
    Ok(env)
}

impl Env {
    pub async fn register(&self, repo: u64, policy: Option<Value>) -> anyhow::Result<()> {
        self.oracle
            .call(self.pb.id(), "register_repo")
            .args_json(json!({ "repo_id": repo, "policy": policy }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn balance(&self, who: &Account) -> anyhow::Result<u128> {
        let v: String = self
            .ft
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who.id() }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    pub async fn near_balance(&self, who: &Account) -> anyhow::Result<u128> {
        let v: String = self
            .wnear
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who.id() }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    pub async fn pay(
        &self,
        payer: &Account,
        repo: u64,
        number: u64,
        amount: u128,
        extra: Value,
    ) -> anyhow::Result<ExecutionFinalResult> {
        self.pay_with(&self.ft, payer, repo, number, amount, extra).await
    }

    /// Pay a bond with any token contract (USDC mock, wNEAR mock, …).
    pub async fn pay_with(
        &self,
        token: &Contract,
        payer: &Account,
        repo: u64,
        number: u64,
        amount: u128,
        extra: Value,
    ) -> anyhow::Result<ExecutionFinalResult> {
        let mut msg = json!({
            "action": "bond", "repo_id": repo, "number": number,
            "kind": "pr", "github_user": payer.id().as_str().split('.').next().unwrap(),
        });
        for (k, v) in extra.as_object().unwrap() {
            msg[k] = v.clone();
        }
        Ok(payer
            .call(token.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": self.pb.id(), "amount": amount.to_string(), "msg": msg.to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?)
    }

    pub async fn settle(&self, repo: u64, number: u64, verdict: &str) -> anyhow::Result<ExecutionFinalResult> {
        Ok(self
            .oracle
            .call(self.pb.id(), "settle")
            .args_json(json!({
                "repo_id": repo, "number": number, "verdict": verdict, "verdict_hash": ZERO_HASH,
            }))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?)
    }

    pub async fn view(&self, method: &str, args: Value) -> anyhow::Result<Value> {
        Ok(self.pb.view(method).args_json(args).await?.json()?)
    }

    pub async fn quote(&self, repo: u64, who: Option<&Account>) -> anyhow::Result<u128> {
        let v = self
            .view("quote_bond", json!({ "repo_id": repo, "account_id": who.map(|a| a.id()) }))
            .await?;
        Ok(v.as_str().unwrap().parse()?)
    }

    pub async fn link(&self, repo: u64, payout: &Account) -> anyhow::Result<()> {
        self.oracle
            .call(self.pb.id(), "link_repo")
            .args_json(json!({ "repo_id": repo, "payout": payout.id() }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }
}

pub fn u(v: &Value) -> u128 {
    v.as_str().expect("U128 is a string").parse().unwrap()
}

/// The receipt that panicked carries our error message.
pub fn failure_text(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.receipt_failures())
}


/// Default policy but AI verdicts settle at once (no challenge window).
pub fn instant_policy() -> Value {
    json!({
        "enabled": true, "base_bond": "2000000", "min_bond": "250000", "max_bond": "50000000",
        "target_open": 8, "review_window_sec": 259200, "challenge_window_sec": 0,
        "forfeit_threshold_bps": 8500,
    })
}

/// `instant_policy` priced in NEAR: base 1, min 0.1, max 25.
pub fn near_policy() -> Value {
    json!({
        "enabled": true, "base_bond": NEAR.to_string(), "min_bond": (NEAR / 10).to_string(),
        "max_bond": (25 * NEAR).to_string(), "target_open": 8, "review_window_sec": 259200,
        "challenge_window_sec": 0, "forfeit_threshold_bps": 8500,
    })
}
