//! PatchBond vault: refundable bonds on unsolicited open-source work.
//!
//! - A stranger pays a bond (USDC or NEAR — the repo chooses — via `ft_transfer_call`) on a PR or issue.
//! - The bond's price follows an on-chain attention curve over the repo's open queue (`curve`).
//! - The oracle (our judge server) settles it with a verifiable AI verdict: refund, or forfeit
//!   (90% to the repo's vault or the linked issue's bounty, 10% to the treasury).
//! - AI verdicts are optimistic: they stand after a challenge window unless either side stakes
//!   to challenge, and a stronger model re-judges (`settle`).
//! - Agents spend from capped in-contract budgets with function-call keys (`budget`).
//! - Only the repo's linked payout account can withdraw its vault. Nobody else — not the owner,
//!   not the oracle — can move vault funds.

mod budget;
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
    Budgets,
    Passports,
    AgentStats,
    Currencies,
    DepositCurrency,
    ClaimableNear,
    BountyHeld,
    Unsettled,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PatchBond {
    /// Can rotate the oracle and treasury; can't touch vaults, deposits or bounties.
    owner: AccountId,
    /// Our judge/GitHub server: registers and links repos, settles deposits.
    oracle: AccountId,
    treasury: AccountId,
    /// USDC.
    token: AccountId,
    /// wNEAR (`wrap.near` / `wrap.testnet`), for repos that take NEAR. Set by the owner.
    wnear: Option<AccountId>,
    /// Repos whose currency isn't USDC.
    currencies: LookupMap<RepoId, Currency>,
    /// Deposits paid in something other than USDC — so a refund always goes back in what was paid.
    deposit_currency: LookupMap<(RepoId, Number), Currency>,
    repos: LookupMap<RepoId, Repo>,
    deposits: LookupMap<(RepoId, Number), Deposit>,
    reputation: LookupMap<AccountId, Reputation>,
    /// Forfeits earmarked for whoever really fixes `(repo, issue)`.
    bounties: LookupMap<(RepoId, Number), U128>,
    /// Payouts whose transfer failed (e.g. receiver not registered with the token); claim later.
    claimable: LookupMap<AccountId, U128>,
    claimable_near: LookupMap<AccountId, U128>,
    /// Unpaid bounties per repo, so a repo can't switch currency under them.
    bounty_held: LookupMap<RepoId, U128>,
    /// Capped agent wallets, keyed by the agent's account.
    budgets: LookupMap<AccountId, Budget>,
    passports: LookupMap<AccountId, Passport>,
    /// Refund/forfeit record per agent account and per harness ("#claude-code").
    agent_stats: LookupMap<String, AgentStats>,
    treasury_balance: u128,
    treasury_near: u128,
    totals: Totals,
    totals_near: Totals,
    /// Emergency brake on *new* money (bonds, challenges, budgets). Never blocks refunds,
    /// settlements, withdrawals or claims.
    paused: bool,
    /// Deposits not yet settled per repo (held, proposed or challenged) — `open` only counts held.
    unsettled: LookupMap<RepoId, u32>,
}

/// State layout before currencies existed (v0.2, live on testnet); read once by `migrate`.
#[near(serializers = [borsh])]
struct PatchBondV2 {
    owner: AccountId,
    oracle: AccountId,
    treasury: AccountId,
    token: AccountId,
    repos: LookupMap<RepoId, Repo>,
    deposits: LookupMap<(RepoId, Number), Deposit>,
    reputation: LookupMap<AccountId, Reputation>,
    bounties: LookupMap<(RepoId, Number), U128>,
    claimable: LookupMap<AccountId, U128>,
    budgets: LookupMap<AccountId, Budget>,
    passports: LookupMap<AccountId, Passport>,
    agent_stats: LookupMap<String, AgentStats>,
    treasury_balance: u128,
    totals: Totals,
    paused: bool,
}

/// v0.3 before `unsettled` existed (live on testnet for a few hours on 2026-10-28).
#[near(serializers = [borsh])]
struct PatchBondV3Pre {
    owner: AccountId,
    oracle: AccountId,
    treasury: AccountId,
    token: AccountId,
    wnear: Option<AccountId>,
    currencies: LookupMap<RepoId, Currency>,
    deposit_currency: LookupMap<(RepoId, Number), Currency>,
    repos: LookupMap<RepoId, Repo>,
    deposits: LookupMap<(RepoId, Number), Deposit>,
    reputation: LookupMap<AccountId, Reputation>,
    bounties: LookupMap<(RepoId, Number), U128>,
    claimable: LookupMap<AccountId, U128>,
    claimable_near: LookupMap<AccountId, U128>,
    bounty_held: LookupMap<RepoId, U128>,
    budgets: LookupMap<AccountId, Budget>,
    passports: LookupMap<AccountId, Passport>,
    agent_stats: LookupMap<String, AgentStats>,
    treasury_balance: u128,
    treasury_near: u128,
    totals: Totals,
    totals_near: Totals,
    paused: bool,
}

#[near]
impl PatchBond {
    /// One-time upgrade from v0.2 (USDC only) or v0.3-pre to the current layout. Only the contract
    /// account itself can call it, i.e. right after a redeploy by whoever holds the contract's key.
    /// Existing repos and deposits stay USDC. `wnear` is used when the old state has none.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(wnear: Option<AccountId>) -> Self {
        use near_sdk::borsh::BorshDeserialize;
        let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        if let Ok(old) = PatchBondV3Pre::try_from_slice(&raw) {
            return Self {
                owner: old.owner,
                oracle: old.oracle,
                treasury: old.treasury,
                token: old.token,
                wnear: old.wnear.or(wnear),
                currencies: old.currencies,
                deposit_currency: old.deposit_currency,
                repos: old.repos,
                deposits: old.deposits,
                reputation: old.reputation,
                bounties: old.bounties,
                claimable: old.claimable,
                claimable_near: old.claimable_near,
                bounty_held: old.bounty_held,
                budgets: old.budgets,
                passports: old.passports,
                agent_stats: old.agent_stats,
                treasury_balance: old.treasury_balance,
                treasury_near: old.treasury_near,
                totals: old.totals,
                totals_near: old.totals_near,
                paused: old.paused,
                unsettled: LookupMap::new(StorageKey::Unsettled),
            };
        }
        let old = PatchBondV2::try_from_slice(&raw)
            .unwrap_or_else(|_| env::panic_str("State is neither v0.2 nor v0.3-pre; nothing to migrate"));
        Self {
            owner: old.owner,
            oracle: old.oracle,
            treasury: old.treasury,
            token: old.token,
            wnear,
            currencies: LookupMap::new(StorageKey::Currencies),
            deposit_currency: LookupMap::new(StorageKey::DepositCurrency),
            repos: old.repos,
            deposits: old.deposits,
            reputation: old.reputation,
            bounties: old.bounties,
            claimable: old.claimable,
            claimable_near: LookupMap::new(StorageKey::ClaimableNear),
            bounty_held: LookupMap::new(StorageKey::BountyHeld),
            budgets: old.budgets,
            passports: old.passports,
            agent_stats: old.agent_stats,
            treasury_balance: old.treasury_balance,
            treasury_near: 0,
            totals: old.totals,
            totals_near: Totals::default(),
            paused: old.paused,
            unsettled: LookupMap::new(StorageKey::Unsettled),
        }
    }

    #[init]
    pub fn new(owner: AccountId, oracle: AccountId, treasury: AccountId, token: AccountId, wnear: Option<AccountId>) -> Self {
        Self {
            owner,
            oracle,
            treasury,
            token,
            wnear,
            currencies: LookupMap::new(StorageKey::Currencies),
            deposit_currency: LookupMap::new(StorageKey::DepositCurrency),
            repos: LookupMap::new(StorageKey::Repos),
            deposits: LookupMap::new(StorageKey::Deposits),
            reputation: LookupMap::new(StorageKey::Reputation),
            bounties: LookupMap::new(StorageKey::Bounties),
            claimable: LookupMap::new(StorageKey::Claimable),
            claimable_near: LookupMap::new(StorageKey::ClaimableNear),
            bounty_held: LookupMap::new(StorageKey::BountyHeld),
            budgets: LookupMap::new(StorageKey::Budgets),
            passports: LookupMap::new(StorageKey::Passports),
            agent_stats: LookupMap::new(StorageKey::AgentStats),
            treasury_balance: 0,
            treasury_near: 0,
            totals: Totals::default(),
            totals_near: Totals::default(),
            paused: false,
            unsettled: LookupMap::new(StorageKey::Unsettled),
        }
    }

    // ---------- owner ----------

    /// Owner: the wNEAR contract to accept for NEAR-denominated repos.
    pub fn set_wnear(&mut self, wnear: AccountId) {
        self.assert_owner();
        self.wnear = Some(wnear);
    }

    pub fn set_oracle(&mut self, oracle: AccountId) {
        self.assert_owner();
        self.oracle = oracle;
    }

    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_owner();
        self.treasury = treasury;
    }

    /// Owner: stop or resume new bonds, challenges and budget funding (incident response).
    /// Refunds, settlements, withdrawals and claims keep working while paused.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        events::paused(paused);
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
    /// Only an unlinked repo can be linked by the oracle — so a stolen oracle key can't redirect a
    /// vault that already has an owner. After that, only the payout account can hand it over.
    pub fn link_repo(&mut self, repo_id: RepoId, payout: AccountId) {
        self.assert_oracle();
        let repo = self.repo_mut(repo_id);
        require!(
            repo.payout.is_none(),
            "This repo is already linked; only its current payout account can change it (set_payout)"
        );
        repo.payout = Some(payout.clone());
        repo.linked_at = Some(env::block_timestamp_ms());
        events::link(repo_id, &payout);
    }

    /// The current payout account hands the repo to another account (e.g. a project DAO).
    #[payable]
    pub fn set_payout(&mut self, repo_id: RepoId, payout: AccountId) {
        near_sdk::assert_one_yocto();
        let caller = env::predecessor_account_id();
        let repo = self.repo_mut(repo_id);
        require!(
            repo.payout.as_ref() == Some(&caller),
            "Only the repo's current payout account can change it"
        );
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

    /// Switch what the repo's bonds are paid in, with a policy priced in the new currency (the old
    /// amounts would mean nothing in it). Same permission as `set_policy`. Only while nothing is
    /// held in the old currency: no unsettled deposits, an empty vault and no unpaid bounties.
    pub fn set_currency(&mut self, repo_id: RepoId, currency: Currency, policy: Policy) {
        require!(
            currency == Currency::Usdc || self.wnear.is_some(),
            "NEAR bonds aren't enabled on this contract yet (no wNEAR token configured)"
        );
        let unpaid_bounties = self.bounty_held.get(&repo_id).map_or(0, |b| b.0);
        let unsettled = self.unsettled.get(&repo_id).copied().unwrap_or(0);
        let repo = self.repo(repo_id);
        require!(
            repo.open == 0 && unsettled == 0 && repo.vault.0 == 0 && unpaid_bounties == 0,
            "Withdraw the vault and settle every open deposit and bounty before switching currency"
        );
        self.set_policy(repo_id, policy);
        match currency {
            Currency::Usdc => self.currencies.remove(&repo_id),
            _ => self.currencies.insert(repo_id, currency),
        };
        events::currency(repo_id, currency);
    }

    // ---------- views ----------

    pub fn get_repo(&self, repo_id: RepoId) -> Option<RepoView> {
        let repo = self.repos.get(&repo_id).cloned()?;
        Some(RepoView { repo, currency: self.currency_of(repo_id) })
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

    pub fn get_claimable(&self, account_id: AccountId, currency: Option<Currency>) -> U128 {
        self.claimable_map(currency.unwrap_or_default()).get(&account_id).copied().unwrap_or(U128(0))
    }

    /// Global counters per currency (USDC when `currency` is omitted).
    pub fn get_totals(&self, currency: Option<Currency>) -> Totals {
        match currency.unwrap_or_default() {
            Currency::Usdc => self.totals.clone(),
            Currency::Near => self.totals_near.clone(),
        }
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "paused": self.paused,
            "owner": self.owner, "oracle": self.oracle, "treasury": self.treasury,
            "token": self.token, "wnear": self.wnear, "treasury_balance": U128(self.treasury_balance),
            "treasury_near": U128(self.treasury_near),
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

    pub(crate) fn currency_of(&self, repo_id: RepoId) -> Currency {
        self.currencies.get(&repo_id).copied().unwrap_or_default()
    }

    pub(crate) fn deposit_currency_of(&self, repo_id: RepoId, number: Number) -> Currency {
        self.deposit_currency.get(&(repo_id, number)).copied().unwrap_or_default()
    }

    /// Which currency a token contract is, if we accept it.
    pub(crate) fn currency_of_token(&self, token: &AccountId) -> Option<Currency> {
        if token == &self.token {
            Some(Currency::Usdc)
        } else if self.wnear.as_ref() == Some(token) {
            Some(Currency::Near)
        } else {
            None
        }
    }

    pub(crate) fn token_of(&self, currency: Currency) -> AccountId {
        match currency {
            Currency::Usdc => self.token.clone(),
            Currency::Near => self.wnear.clone().unwrap_or_else(|| env::panic_str("No wNEAR token configured")),
        }
    }

    pub(crate) fn claimable_map(&self, currency: Currency) -> &LookupMap<AccountId, U128> {
        match currency {
            Currency::Usdc => &self.claimable,
            Currency::Near => &self.claimable_near,
        }
    }

    pub(crate) fn claimable_map_mut(&mut self, currency: Currency) -> &mut LookupMap<AccountId, U128> {
        match currency {
            Currency::Usdc => &mut self.claimable,
            Currency::Near => &mut self.claimable_near,
        }
    }

    pub(crate) fn totals_mut(&mut self, currency: Currency) -> &mut Totals {
        match currency {
            Currency::Usdc => &mut self.totals,
            Currency::Near => &mut self.totals_near,
        }
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
