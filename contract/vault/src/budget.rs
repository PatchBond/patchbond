//! Capped agent wallets and agent passports (SPEC §5.4, §13.5).
//!
//! Mike funds a budget for his agent's account and gives the agent a function-call key limited
//! to `deposit_from_budget`. Function-call keys can't attach tokens, so the agent can only spend
//! what's in the budget, on bonds, under the daily cap — enforced here, not by the agent.

use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, Promise};

use crate::payout::Fallback;
use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

#[near]
impl PatchBond {
    /// The agent (signing with its function-call key) pays a bond from its budget and declares
    /// its passport. No attached deposit, by design.
    pub fn deposit_from_budget(
        &mut self,
        repo_id: RepoId,
        number: Number,
        kind: Kind,
        github_user: String,
        fixes_issue: Option<Number>,
        passport: Passport,
    ) -> U128 {
        let agent = env::predecessor_account_id();
        require!(!self.paused, "PatchBond is paused for new deposits while an incident is handled");
        require!(
            !passport.harness.is_empty() && passport.harness.len() <= 32 && passport.model.len() <= 64,
            "passport.harness must be 1–32 characters and passport.model at most 64"
        );
        let bond = self.price_for(&agent, repo_id, number, &github_user, fixes_issue);
        let today = env::block_timestamp_ms() / DAY_MS;
        let mut b = self.budgets.get(&agent).cloned().unwrap_or_else(|| {
            env::panic_str(&format!("{agent} has no PatchBond budget; its owner needs to fund one first"))
        });
        require!(
            passport.operator == b.owner,
            format!("passport.operator must be the budget's owner ({})", b.owner)
        );
        if b.day != today {
            b.day = today;
            b.spent_today = U128(0);
        }
        require!(
            b.spent_today.0 + bond <= b.daily_cap.0,
            format!(
                "Daily cap reached: this bond is {} USDC and {} of the {} USDC daily cap is left. Try again tomorrow (UTC) or ask {} to raise the cap",
                crate::deposit::fmt_usdc(bond),
                crate::deposit::fmt_usdc(b.daily_cap.0 - b.spent_today.0),
                crate::deposit::fmt_usdc(b.daily_cap.0),
                b.owner
            )
        );
        require!(
            bond <= b.balance.0,
            format!(
                "Budget too low: this bond is {} USDC and the budget holds {}. Ask {} to top it up",
                crate::deposit::fmt_usdc(bond),
                crate::deposit::fmt_usdc(b.balance.0),
                b.owner
            )
        );
        b.balance = U128(b.balance.0 - bond);
        b.spent_today = U128(b.spent_today.0 + bond);
        self.budgets.insert(agent.clone(), b);

        if self.passports.get(&agent) != Some(&passport) {
            events::passport(&agent, &passport);
            self.passports.insert(agent.clone(), passport.clone());
        }
        self.bump_agent(&agent, &passport.harness, |s| s.deposits += 1);
        self.insert_deposit(agent, repo_id, number, kind, github_user, bond, 0, fixes_issue, Some(passport.harness));
        U128(bond)
    }

    /// Owner changes the daily cap.
    pub fn set_budget_cap(&mut self, agent: AccountId, daily_cap: U128) {
        let b = self.owned_budget_mut(&agent);
        b.daily_cap = daily_cap;
    }

    /// Owner takes money back out of the agent's budget.
    #[payable]
    pub fn withdraw_budget(&mut self, agent: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        let b = self.owned_budget_mut(&agent);
        require!(
            amount.0 > 0 && amount.0 <= b.balance.0,
            format!("The budget holds {} USDC", crate::deposit::fmt_usdc(b.balance.0))
        );
        b.balance = U128(b.balance.0 - amount.0);
        let owner = b.owner.clone();
        self.send(owner, amount.0, Fallback::Budget(agent))
    }

    pub fn get_budget(&self, agent: AccountId) -> Option<Budget> {
        self.budgets.get(&agent).cloned()
    }

    pub fn get_passport(&self, agent: AccountId) -> Option<Passport> {
        self.passports.get(&agent).cloned()
    }

    /// Public record for one agent account.
    pub fn get_agent_stats(&self, agent: AccountId) -> AgentStats {
        self.agent_stats.get(&agent.to_string()).cloned().unwrap_or_default()
    }

    /// Public record for a whole harness, e.g. "claude-code".
    pub fn get_harness_stats(&self, harness: String) -> AgentStats {
        self.agent_stats.get(&harness_key(&harness)).cloned().unwrap_or_default()
    }
}

impl PatchBond {
    pub(crate) fn fund_budget(&mut self, owner: AccountId, agent: AccountId, amount: u128, daily_cap: Option<U128>) {
        let b = match self.budgets.get(&agent).cloned() {
            Some(mut b) => {
                require!(
                    b.owner == owner,
                    format!("{agent}'s budget belongs to {}; your transfer was refunded", b.owner)
                );
                b.balance = U128(b.balance.0 + amount);
                if let Some(cap) = daily_cap {
                    b.daily_cap = cap;
                }
                b
            }
            None => {
                // Each budget costs the contract storage; a floor stops penny-budget griefing.
                require!(
                    amount >= MIN_BUDGET,
                    format!("A new budget needs at least {} USDC; your transfer was refunded", crate::deposit::fmt_usdc(MIN_BUDGET))
                );
                Budget {
                owner: owner.clone(),
                balance: U128(amount),
                daily_cap: daily_cap.unwrap_or_else(|| {
                    env::panic_str("A new budget needs a daily_cap; your transfer was refunded")
                }),
                spent_today: U128(0),
                day: env::block_timestamp_ms() / DAY_MS,
                }
            }
        };
        events::budget(&agent, &owner, b.balance.0, b.daily_cap.0);
        self.budgets.insert(agent, b);
    }

    pub(crate) fn credit_budget(&mut self, agent: &AccountId, amount: u128) {
        if let Some(b) = self.budgets.get_mut(agent) {
            b.balance = U128(b.balance.0 + amount);
        } else {
            let c = self.claimable.get(agent).map_or(0, |c| c.0);
            self.claimable.insert(agent.clone(), U128(c + amount));
        }
    }

    pub(crate) fn record_agent(&mut self, payer: &AccountId, harness: Option<&str>, verdict: Verdict) {
        let Some(harness) = harness else { return };
        match verdict {
            Verdict::Refund => self.bump_agent(payer, harness, |s| s.refunds += 1),
            Verdict::Forfeit => self.bump_agent(payer, harness, |s| s.forfeits += 1),
            Verdict::Void => {}
        }
    }

    fn bump_agent(&mut self, agent: &AccountId, harness: &str, f: impl Fn(&mut AgentStats)) {
        for key in [agent.to_string(), harness_key(harness)] {
            let mut s = self.agent_stats.get(&key).cloned().unwrap_or_default();
            f(&mut s);
            self.agent_stats.insert(key, s);
        }
    }

    fn owned_budget_mut(&mut self, agent: &AccountId) -> &mut Budget {
        let caller = env::predecessor_account_id();
        let b = self
            .budgets
            .get_mut(agent)
            .unwrap_or_else(|| env::panic_str(&format!("{agent} has no PatchBond budget")));
        require!(b.owner == caller, "Only the budget's owner can do this");
        b
    }
}

/// Harness records share the map with agent accounts; "#" can't appear in an account id.
fn harness_key(harness: &str) -> String {
    format!("#{}", harness.to_lowercase())
}
