//! Paying a bond: USDC `ft_transfer_call(receiver_id = patchbond, msg = TransferMsg)`.
//! Anything paid above the quoted bond + tip is handed back to the payer by the token
//! (the unused amount we return). A panic here refunds the whole transfer.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{env, near, require, AccountId, PromiseOrValue};

use crate::types::*;
use crate::{curve, events, PatchBond, PatchBondExt};

#[near]
impl FungibleTokenReceiver for PatchBond {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token,
            format!("PatchBond only accepts {}; this token was refunded", self.token)
        );
        let msg: TransferMsg = serde_json::from_str(&msg).unwrap_or_else(|e| {
            env::panic_str(&format!(
                "Couldn't read the transfer msg ({e}); expected e.g. {{\"action\":\"bond\",\"repo_id\":1,\"number\":2,\"kind\":\"pr\",\"github_user\":\"octocat\"}}"
            ))
        });
        match msg {
            TransferMsg::Bond { repo_id, number, kind, github_user, tip, fixes_issue } => {
                let unused = self.take_bond(
                    sender_id, amount.0, repo_id, number, kind, github_user,
                    tip.map_or(0, |t| t.0), fixes_issue,
                );
                PromiseOrValue::Value(U128(unused))
            }
        }
    }
}

impl PatchBond {
    /// Records the deposit and returns the unused part of `amount`.
    #[allow(clippy::too_many_arguments)]
    fn take_bond(
        &mut self,
        payer: AccountId,
        amount: u128,
        repo_id: RepoId,
        number: Number,
        kind: Kind,
        github_user: String,
        tip: u128,
        fixes_issue: Option<Number>,
    ) -> u128 {
        require!(
            !github_user.is_empty() && github_user.len() <= 39,
            "github_user must be a GitHub login (1–39 characters)"
        );
        require!(
            fixes_issue != Some(number),
            "fixes_issue can't be the submission's own number"
        );
        require!(
            !self.deposits.contains_key(&(repo_id, number)),
            format!("#{number} on repo {repo_id} already has a deposit; nothing was charged")
        );
        let now = env::block_timestamp_ms();
        let rep = self.reputation.get(&payer).cloned().unwrap_or_default();
        let repo = self.repo(repo_id);
        require!(
            repo.policy.enabled,
            format!("PatchBond is turned off for repo {repo_id}: no deposit is needed")
        );
        let bond = curve::quote(&repo.policy, repo.open, &rep, now);
        require!(
            bond > 0,
            "You're a proven contributor (≥3 refunds on ≥2 repos, no recent forfeits): no deposit is needed"
        );
        let due = bond + tip;
        require!(
            amount >= due,
            format!(
                "The bond is now {} USDC{} but {} was sent; the transfer was refunded. Ask for a fresh quote and try again",
                fmt_usdc(bond),
                if tip > 0 { format!(" + {} tip", fmt_usdc(tip)) } else { String::new() },
                fmt_usdc(amount)
            )
        );

        let repo = self.repo_mut(repo_id);
        repo.open += 1;
        repo.stats.deposits += 1;
        let open = repo.open;
        self.deposits.insert(
            (repo_id, number),
            Deposit {
                payer: payer.clone(),
                github_user: github_user.clone(),
                kind,
                bond: U128(bond),
                tip: U128(tip),
                fixes_issue,
                created_at: now,
                reviewed_at: None,
                verdict_hash: None,
                status: DepositStatus::Held,
            },
        );
        self.totals.held = U128(self.totals.held.0 + due);
        self.totals.deposits += 1;
        events::deposit(repo_id, number, kind, &payer, &github_user, bond, tip, open);
        amount - due
    }
}

/// 2_500_000 → "2.50"
pub(crate) fn fmt_usdc(units: u128) -> String {
    format!("{}.{:02}", units / USDC, (units % USDC) / 10_000)
}
