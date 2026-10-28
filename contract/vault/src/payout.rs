//! Every outgoing USDC transfer goes through `send`, which books the money back if the
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
        require!(
            amount.0 <= repo.vault.0,
            format!(
                "The vault holds {} USDC; you asked for {}",
                crate::deposit::fmt_usdc(repo.vault.0),
                crate::deposit::fmt_usdc(amount.0)
            )
        );
        repo.vault = U128(repo.vault.0 - amount.0);
        events::withdraw(repo_id, &caller, amount.0);
        self.send(caller, amount.0, Fallback::Vault(repo_id))
    }

    /// Owner sends accumulated fees to the treasury account.
    #[payable]
    pub fn withdraw_treasury(&mut self) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        let amount = self.treasury_balance;
        require!(amount > 0, "The treasury balance is zero");
        self.treasury_balance = 0;
        self.send(self.treasury.clone(), amount, Fallback::Treasury)
    }

    /// Retry a payout that failed earlier (register with the USDC contract first).
    #[payable]
    pub fn claim(&mut self) -> Promise {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let amount = self.claimable.remove(&caller).map_or(0, |c| c.0);
        require!(amount > 0, "Nothing to claim for this account");
        self.send(caller, amount, Fallback::Claimable)
    }

    #[private]
    pub fn on_send(
        &mut self,
        to: AccountId,
        amount: U128,
        fallback: Fallback,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        events::payout_failed(&to, amount.0);
        match fallback {
            Fallback::Vault(repo_id) => {
                if let Some(repo) = self.repos.get_mut(&repo_id) {
                    repo.vault = U128(repo.vault.0 + amount.0);
                }
            }
            Fallback::Treasury => self.treasury_balance += amount.0,
            Fallback::Claimable => {
                let c = self.claimable.get(&to).map_or(0, |c| c.0);
                self.claimable.insert(to, U128(c + amount.0));
            }
        }
        false
    }
}

impl PatchBond {
    pub(crate) fn send(&mut self, to: AccountId, amount: u128, fallback: Fallback) -> Promise {
        ext_ft_core::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to.clone(), U128(amount), Some("PatchBond".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SEND)
                    .on_send(to, U128(amount), fallback),
            )
    }
}
