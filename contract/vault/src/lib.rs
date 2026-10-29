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
pub mod tee;
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
    MaintainerForfeits,
    MaintainerRecords,
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
    /// Forfeits proposed by the maintainer (not the AI), with what was escrowed from the repo's
    /// vault as a penalty if the contributor's dispute wins.
    maintainer_forfeits: LookupMap<(RepoId, Number), U128>,
    maintainer_records: LookupMap<RepoId, MaintainerRecord>,
    /// NEAR AI enclave signing addresses (lower-case hex, no 0x) from NEAR AI's attestation reports.
    /// Once any is registered, every forfeit the oracle posts must carry a TEE proof signed by one.
    tee_signers: Vec<String>,
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

/// v0.4 with the maintainer-forfeit safeguards (live on testnet 2026-10-29), before TEE proofs.
#[near(serializers = [borsh])]
struct PatchBondV4 {
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
    unsettled: LookupMap<RepoId, u32>,
    maintainer_forfeits: LookupMap<(RepoId, Number), U128>,
    maintainer_records: LookupMap<RepoId, MaintainerRecord>,
}

/// v0.3 with `unsettled` (live on testnet 2026-10-28), before the maintainer-forfeit safeguards.
#[near(serializers = [borsh])]
struct PatchBondV3 {
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
    unsettled: LookupMap<RepoId, u32>,
}

impl PatchBondV2 {
    fn upgrade(self, wnear: Option<AccountId>) -> PatchBondV3Pre {
        PatchBondV3Pre {
            owner: self.owner,
            oracle: self.oracle,
            treasury: self.treasury,
            token: self.token,
            wnear,
            currencies: LookupMap::new(StorageKey::Currencies),
            deposit_currency: LookupMap::new(StorageKey::DepositCurrency),
            repos: self.repos,
            deposits: self.deposits,
            reputation: self.reputation,
            bounties: self.bounties,
            claimable: self.claimable,
            claimable_near: LookupMap::new(StorageKey::ClaimableNear),
            bounty_held: LookupMap::new(StorageKey::BountyHeld),
            budgets: self.budgets,
            passports: self.passports,
            agent_stats: self.agent_stats,
            treasury_balance: self.treasury_balance,
            treasury_near: 0,
            totals: self.totals,
            totals_near: Totals::default(),
            paused: self.paused,
        }
    }
}

impl PatchBondV3Pre {
    fn upgrade(self, wnear: Option<AccountId>) -> PatchBondV3 {
        PatchBondV3 {
            owner: self.owner,
            oracle: self.oracle,
            treasury: self.treasury,
            token: self.token,
            wnear: self.wnear.or(wnear),
            currencies: self.currencies,
            deposit_currency: self.deposit_currency,
            repos: self.repos,
            deposits: self.deposits,
            reputation: self.reputation,
            bounties: self.bounties,
            claimable: self.claimable,
            claimable_near: self.claimable_near,
            bounty_held: self.bounty_held,
            budgets: self.budgets,
            passports: self.passports,
            agent_stats: self.agent_stats,
            treasury_balance: self.treasury_balance,
            treasury_near: self.treasury_near,
            totals: self.totals,
            totals_near: self.totals_near,
            paused: self.paused,
            unsettled: LookupMap::new(StorageKey::Unsettled),
        }
    }
}

impl PatchBondV3 {
    fn upgrade(self, wnear: Option<AccountId>) -> PatchBondV4 {
        PatchBondV4 {
            owner: self.owner,
            oracle: self.oracle,
            treasury: self.treasury,
            token: self.token,
            wnear: self.wnear.or(wnear),
            currencies: self.currencies,
            deposit_currency: self.deposit_currency,
            repos: self.repos,
            deposits: self.deposits,
            reputation: self.reputation,
            bounties: self.bounties,
            claimable: self.claimable,
            claimable_near: self.claimable_near,
            bounty_held: self.bounty_held,
            budgets: self.budgets,
            passports: self.passports,
            agent_stats: self.agent_stats,
            treasury_balance: self.treasury_balance,
            treasury_near: self.treasury_near,
            totals: self.totals,
            totals_near: self.totals_near,
            paused: self.paused,
            unsettled: self.unsettled,
            maintainer_forfeits: LookupMap::new(StorageKey::MaintainerForfeits),
            maintainer_records: LookupMap::new(StorageKey::MaintainerRecords),
        }
    }
}

impl PatchBondV4 {
    fn upgrade(self, wnear: Option<AccountId>) -> PatchBond {
        PatchBond {
            owner: self.owner,
            oracle: self.oracle,
            treasury: self.treasury,
            token: self.token,
            wnear: self.wnear.or(wnear),
            currencies: self.currencies,
            deposit_currency: self.deposit_currency,
            repos: self.repos,
            deposits: self.deposits,
            reputation: self.reputation,
            bounties: self.bounties,
            claimable: self.claimable,
            claimable_near: self.claimable_near,
            bounty_held: self.bounty_held,
            budgets: self.budgets,
            passports: self.passports,
            agent_stats: self.agent_stats,
            treasury_balance: self.treasury_balance,
            treasury_near: self.treasury_near,
            totals: self.totals,
            totals_near: self.totals_near,
            paused: self.paused,
            unsettled: self.unsettled,
            maintainer_forfeits: self.maintainer_forfeits,
            maintainer_records: self.maintainer_records,
            tee_signers: Vec::new(),
        }
    }
}

#[near]
impl PatchBond {
    /// One-time upgrade from any earlier layout (v0.2 USDC-only, v0.3-pre, v0.3, v0.4) to the current
    /// one, one step at a time. Only the contract account itself can call it, i.e. right after a
    /// redeploy by whoever holds the contract's key. `wnear` is used when the old state has none.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(wnear: Option<AccountId>) -> Self {
        use near_sdk::borsh::BorshDeserialize;
        let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        let v4 = if let Ok(old) = PatchBondV4::try_from_slice(&raw) {
            old
        } else if let Ok(old) = PatchBondV3::try_from_slice(&raw) {
            old.upgrade(wnear.clone())
        } else if let Ok(old) = PatchBondV3Pre::try_from_slice(&raw) {
            old.upgrade(wnear.clone()).upgrade(wnear.clone())
        } else if let Ok(old) = PatchBondV2::try_from_slice(&raw) {
            old.upgrade(wnear.clone()).upgrade(None).upgrade(wnear.clone())
        } else {
            env::panic_str("State matches no earlier layout; nothing to migrate")
        };
        v4.upgrade(wnear)
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
            maintainer_forfeits: LookupMap::new(StorageKey::MaintainerForfeits),
            maintainer_records: LookupMap::new(StorageKey::MaintainerRecords),
            tee_signers: Vec::new(),
        }
    }

    // ---------- owner ----------

    /// Owner: the NEAR AI signing keys to accept, from NEAR AI's attestation reports (anyone can check
    /// them): `0x<address>` for a model enclave key, `0x<address>@<model>` for the gateway key for one
    /// model. Replaces the list; an empty list turns the TEE-proof requirement off.
    pub fn set_tee_signers(&mut self, signers: Vec<String>) {
        self.assert_owner();
        require!(signers.len() <= 16, "At most 16 TEE signers");
        self.tee_signers = signers
            .iter()
            .map(|a| tee::normalize_signer(a).unwrap_or_else(|| env::panic_str(&format!("{a} isn't 0x<20-byte address> or 0x<address>@<model>"))))
            .collect();
        events::tee_signers(&self.tee_signers);
    }

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

    pub fn get_deposit(&self, repo_id: RepoId, number: Number) -> Option<DepositView> {
        let deposit = self.deposits.get(&(repo_id, number)).cloned()?;
        Some(DepositView { deposit, currency: self.deposit_currency_of(repo_id, number) })
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

    /// How this repo's maintainers have used their own forfeits — shown to contributors before paying.
    pub fn get_maintainer_record(&self, repo_id: RepoId) -> MaintainerRecord {
        self.maintainer_records.get(&repo_id).cloned().unwrap_or_default()
    }

    /// Whether `#number`'s pending forfeit came from the maintainer (free to dispute) rather than the AI.
    pub fn is_maintainer_forfeit(&self, repo_id: RepoId, number: Number) -> bool {
        self.maintainer_forfeits.contains_key(&(repo_id, number))
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

    /// Registered NEAR AI enclave signing addresses (0x-prefixed). Empty = forfeits need no TEE proof.
    pub fn get_tee_signers(&self) -> Vec<String> {
        self.tee_signers.iter().map(|a| format!("0x{a}")).collect()
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
