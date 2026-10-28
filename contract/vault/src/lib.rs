//! PatchBond vault: refundable bonds on unsolicited open-source work.
//!
//! - A stranger pays a bond (USDC, via `ft_transfer_call`) on a PR or issue.
//! - The bond's price follows an on-chain attention curve over the repo's open queue (`curve`).
//! - The oracle (our judge server) settles it with a verifiable AI verdict: refund, or forfeit
//!   (90% to the repo's vault or the linked issue's bounty, 10% to the treasury).
//! - Only the repo's linked payout account can withdraw its vault. Nobody else — not the owner,
//!   not the oracle — can move vault funds.

mod curve;
mod deposit;
mod events;
mod payout;
mod settle;
pub mod types;

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub use types::*;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Repos,
    Deposits,
    Reputation,
    Bounties,
    Claimable,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PatchBond {
    /// Can rotate the oracle and treasury; can't touch vaults, deposits or bounties.
    owner: AccountId,
    /// Our judge/GitHub server: registers and links repos, settles deposits.
    oracle: AccountId,
    treasury: AccountId,
    /// The only token accepted (USDC).
    token: AccountId,
    repos: LookupMap<RepoId, Repo>,
    deposits: LookupMap<(RepoId, Number), Deposit>,
    reputation: LookupMap<AccountId, Reputation>,
    /// Forfeits earmarked for whoever really fixes `(repo, issue)`.
    bounties: LookupMap<(RepoId, Number), U128>,
    /// Payouts whose transfer failed (e.g. receiver not registered with the token); claim later.
    claimable: LookupMap<AccountId, U128>,
    treasury_balance: u128,
    totals: Totals,
}

#[near]
impl PatchBond {
    #[init]
    pub fn new(owner: AccountId, oracle: AccountId, treasury: AccountId, token: AccountId) -> Self {
        Self {
            owner,
            oracle,
            treasury,
            token,
            repos: LookupMap::new(StorageKey::Repos),
            deposits: LookupMap::new(StorageKey::Deposits),
            reputation: LookupMap::new(StorageKey::Reputation),
            bounties: LookupMap::new(StorageKey::Bounties),
            claimable: LookupMap::new(StorageKey::Claimable),
            treasury_balance: 0,
            totals: Totals::default(),
        }
    }

    // ---------- owner ----------

    pub fn set_oracle(&mut self, oracle: AccountId) {
        self.assert_owner();
        self.oracle = oracle;
    }

    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_owner();
        self.treasury = treasury;
    }

    // ---------- repos ----------

    /// Oracle: the GitHub App was installed on `repo_id`. Starts with the default policy;
    /// forfeits collect in the vault until a maintainer links a payout account.
    pub fn register_repo(&mut self, repo_id: RepoId, policy: Option<Policy>) {
        self.assert_oracle();
        require!(
            !self.repos.contains_key(&repo_id),
            format!("Repo {repo_id} is already registered")
        );
        let policy = policy.unwrap_or_default();
        policy.assert_valid();
        self.repos.insert(
            repo_id,
            Repo {
                payout: None,
                policy,
                vault: U128(0),
                open: 0,
                linked_at: None,
                stats: RepoStats::default(),
            },
        );
        events::repo_registered(repo_id);
    }

    /// Oracle: GitHub confirmed the maintainer is an admin of `repo_id`; `payout` now controls it.
    pub fn link_repo(&mut self, repo_id: RepoId, payout: AccountId) {
        self.assert_oracle();
        let repo = self.repo_mut(repo_id);
        repo.payout = Some(payout.clone());
        repo.linked_at = Some(env::block_timestamp_ms());
        events::link(repo_id, &payout);
    }

    /// The linked payout account sets policy. Before linking, the oracle may (dashboard
    /// settings saved via GitHub sign-in).
    pub fn set_policy(&mut self, repo_id: RepoId, policy: Policy) {
        policy.assert_valid();
        let caller = env::predecessor_account_id();
        let oracle = self.oracle.clone();
        let repo = self.repo_mut(repo_id);
        match &repo.payout {
            Some(payout) => require!(
                &caller == payout,
                "Only the repo's linked payout account can change its policy"
            ),
            None => require!(
                caller == oracle,
                "This repo isn't linked yet: link it from the dashboard before changing its policy"
            ),
        }
        repo.policy = policy;
        events::policy(repo_id);
    }

    // ---------- views ----------

    pub fn get_repo(&self, repo_id: RepoId) -> Option<Repo> {
        self.repos.get(&repo_id).cloned()
    }

    pub fn get_deposit(&self, repo_id: RepoId, number: Number) -> Option<Deposit> {
        self.deposits.get(&(repo_id, number)).cloned()
    }

    pub fn get_reputation(&self, account_id: AccountId) -> Reputation {
        self.reputation.get(&account_id).cloned().unwrap_or_default()
    }

    /// What `account_id` would pay for a new submission on `repo_id` right now (0 = exempt).
    pub fn quote_bond(&self, repo_id: RepoId, account_id: Option<AccountId>) -> U128 {
        let repo = self.repo(repo_id);
        let rep = account_id
            .map(|a| self.get_reputation(a))
            .unwrap_or_default();
        U128(curve::quote(&repo.policy, repo.open, &rep, env::block_timestamp_ms()))
    }

    pub fn is_exempt(&self, account_id: AccountId) -> bool {
        curve::is_exempt(&self.get_reputation(account_id), env::block_timestamp_ms())
    }

    pub fn get_bounty(&self, repo_id: RepoId, issue: Number) -> U128 {
        self.bounties.get(&(repo_id, issue)).copied().unwrap_or(U128(0))
    }

    pub fn get_claimable(&self, account_id: AccountId) -> U128 {
        self.claimable.get(&account_id).copied().unwrap_or(U128(0))
    }

    pub fn get_totals(&self) -> Totals {
        self.totals.clone()
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "owner": self.owner, "oracle": self.oracle, "treasury": self.treasury,
            "token": self.token, "treasury_balance": U128(self.treasury_balance),
            "treasury_fee_bps": TREASURY_FEE_BPS,
        })
    }
}

// ---------- internal helpers ----------
impl PatchBond {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the contract owner can do this"
        );
    }

    fn assert_oracle(&self) {
        require!(
            env::predecessor_account_id() == self.oracle,
            "Only the PatchBond oracle can do this"
        );
    }

    fn repo(&self, repo_id: RepoId) -> &Repo {
        self.repos.get(&repo_id).unwrap_or_else(|| {
            env::panic_str(&format!(
                "Repo {repo_id} isn't registered with PatchBond: a maintainer needs to install the GitHub App first"
            ))
        })
    }

    fn repo_mut(&mut self, repo_id: RepoId) -> &mut Repo {
        self.repos.get_mut(&repo_id).unwrap_or_else(|| {
            env::panic_str(&format!(
                "Repo {repo_id} isn't registered with PatchBond: a maintainer needs to install the GitHub App first"
            ))
        })
    }
}
