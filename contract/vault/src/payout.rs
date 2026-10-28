//! Every outgoing transfer (USDC or wNEAR) goes through `send`, which books the money back if the
//! transfer fails — to the vault, the treasury, or the receiver's claimable balance.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, Promise, PromiseError,
};

use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_SEND: Gas = Gas::from_tgas(10);

/// Where the money goes back to if the transfer fails.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub enum Fallback {
    Vault(RepoId),
    Treasury,
    Claimable,
    /// Back into an agent's budget.
    Budget(AccountId),
}

#[near]
impl PatchBond {
    /// The linked payout account withdraws from its repo's vault (payout option A).
    #[payable]
    pub fn withdraw(&mut self, repo_id: RepoId, amount: U128) -> Promise {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let repo = self.repo_mut(repo_id);
        require!(
            repo.payout.as_ref() == Some(&caller),
            "Only the repo's linked payout account can withdraw its vault"
        );
        require!(amount.0 > 0, "Withdraw amount must be above zero");
        let vault = repo.vault.0;
        let currency = self.currency_of(repo_id);
        require!(
            amount.0 <= vault,
            format!("The vault holds {}; you asked for {}", currency.fmt(vault), currency.fmt(amount.0))
        );
        let repo = self.repo_mut(repo_id);
        repo.vault = U128(repo.vault.0 - amount.0);
        events::withdraw(repo_id, &caller, amount.0, currency);
        self.send(caller, amount.0, currency, Fallback::Vault(repo_id))
    }

    /// Owner sends accumulated fees, in every currency that has some, to the treasury account.
    #[payable]
    pub fn withdraw_treasury(&mut self) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        let usdc = std::mem::take(&mut self.treasury_balance);
        let near = std::mem::take(&mut self.treasury_near);
        let to = self.treasury.clone();
        self.send_each(&to, [(Currency::Usdc, usdc), (Currency::Near, near)], Fallback::Treasury)
            .unwrap_or_else(|| env::panic_str("The treasury balance is zero"))
    }

    /// Retry payouts that failed earlier, in every currency (register with the token contract first).
    #[payable]
    pub fn claim(&mut self) -> Promise {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let usdc = self.claimable.remove(&caller).map_or(0, |c| c.0);
        let near = self.claimable_near.remove(&caller).map_or(0, |c| c.0);
        self.send_each(&caller, [(Currency::Usdc, usdc), (Currency::Near, near)], Fallback::Claimable)
            .unwrap_or_else(|| env::panic_str("Nothing to claim for this account"))
    }

    #[private]
    pub fn on_send(
        &mut self,
        to: AccountId,
        amount: U128,
        currency: Option<Currency>,
        fallback: Fallback,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        let currency = currency.unwrap_or_default();
        events::payout_failed(&to, amount.0);
        match fallback {
            // The vault only takes it back in its own currency (it may have switched since).
            Fallback::Vault(repo_id) if self.repos.contains_key(&repo_id) && self.currency_of(repo_id) == currency => {
                let repo = self.repo_mut(repo_id);
                repo.vault = U128(repo.vault.0 + amount.0);
            }
            Fallback::Treasury => match currency {
                Currency::Usdc => self.treasury_balance += amount.0,
                Currency::Near => self.treasury_near += amount.0,
            },
            Fallback::Budget(agent) if currency == Currency::Usdc => self.credit_budget(&agent, amount.0),
            _ => self.credit_claimable(&to, amount.0, currency),
        }
        false
    }
}

impl PatchBond {
    pub(crate) fn send(&mut self, to: AccountId, amount: u128, currency: Currency, fallback: Fallback) -> Promise {
        ext_ft_core::ext(self.token_of(currency))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to.clone(), U128(amount), Some("PatchBond".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SEND)
                    .on_send(to, U128(amount), Some(currency), fallback),
            )
    }

    /// One transfer per non-zero amount, joined; `None` if every amount is zero.
    fn send_each(&mut self, to: &AccountId, amounts: [(Currency, u128); 2], fallback: Fallback) -> Option<Promise> {
        amounts
            .into_iter()
            .filter(|&(_, amount)| amount > 0)
            .map(|(currency, amount)| self.send(to.clone(), amount, currency, fallback.clone()))
            .reduce(Promise::and)
    }

    pub(crate) fn credit_claimable(&mut self, to: &AccountId, amount: u128, currency: Currency) {
        let map = self.claimable_map_mut(currency);
        let c = map.get(to).map_or(0, |c| c.0);
        map.insert(to.clone(), U128(c + amount));
    }
}
