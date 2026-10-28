//! Paying a bond: `ft_transfer_call(receiver_id = patchbond, msg = TransferMsg)` on the repo's
//! token — USDC, or wNEAR for repos that take NEAR.
//! Anything paid above what's due is handed back to the payer by the token (the unused
//! amount we return). A panic here refunds the whole transfer.

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
        let paid_in = self.currency_of_token(&env::predecessor_account_id()).unwrap_or_else(|| {
            env::panic_str(&format!(
                "PatchBond only accepts USDC ({}){}; this token was refunded",
                self.token,
                self.wnear.as_ref().map_or(String::new(), |w| format!(" or wNEAR ({w})"))
            ))
        });
        require!(
            !self.paused,
            "PatchBond is paused for new deposits while an incident is handled; your transfer was refunded. Existing bonds are safe and refunds still work"
        );
        let msg: TransferMsg = serde_json::from_str(&msg).unwrap_or_else(|e| {
            env::panic_str(&format!(
                "Couldn't read the transfer msg ({e}); expected e.g. {{\"action\":\"bond\",\"repo_id\":1,\"number\":2,\"kind\":\"pr\",\"github_user\":\"octocat\"}}"
            ))
        });
        let unused = match msg {
            TransferMsg::Bond { repo_id, number, kind, github_user, tip, fixes_issue } => {
                self.assert_paid_in(repo_id, paid_in);
                let tip = tip.map_or(0, |t| t.0);
                let bond = self.price_for(&sender_id, repo_id, number, &github_user, fixes_issue);
                let due = bond + tip;
                require!(
                    amount.0 >= due,
                    format!(
                        "The bond is now {}{} but {} was sent; the transfer was refunded. Ask for a fresh quote and try again",
                        paid_in.fmt(bond),
                        if tip > 0 { format!(" + {} tip", paid_in.fmt(tip)) } else { String::new() },
                        paid_in.fmt(amount.0)
                    )
                );
                self.insert_deposit(sender_id, repo_id, number, kind, github_user, bond, tip, fixes_issue, None);
                amount.0 - due
            }
            TransferMsg::Challenge { repo_id, number } => {
                require!(
                    self.deposit_currency_of(repo_id, number) == paid_in,
                    "A challenge stake is paid in the same currency as the bond; your transfer was refunded"
                );
                self.take_challenge(sender_id, amount.0, repo_id, number)
            }
            TransferMsg::FundBudget { agent, daily_cap } => {
                require!(paid_in == Currency::Usdc, "Agent budgets hold USDC; your transfer was refunded");
                self.fund_budget(sender_id, agent, amount.0, daily_cap);
                0
            }
        };
        PromiseOrValue::Value(U128(unused))
    }
}

impl PatchBond {
    fn assert_paid_in(&self, repo_id: RepoId, paid_in: Currency) {
        let wants = self.currency_of(repo_id);
        require!(
            wants == paid_in,
            format!(
                "Repo {repo_id} takes {} bonds; this {} transfer was refunded",
                wants.symbol(),
                paid_in.symbol()
            )
        );
    }

    /// Validates a new submission and returns the bond `payer` owes for it right now.
    pub(crate) fn price_for(
        &self,
        payer: &AccountId,
        repo_id: RepoId,
        number: Number,
        github_user: &str,
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
        // A voided deposit (paid by the wrong person) frees the slot for the real author.
        let taken = self.deposits.get(&(repo_id, number)).is_some_and(|d| {
            !matches!(d.status, DepositStatus::Settled { verdict: Verdict::Void, .. })
        });
        require!(
            !taken,
            format!("#{number} on repo {repo_id} already has a deposit; nothing was charged")
        );
        let repo = self.repo(repo_id);
        require!(
            repo.policy.enabled,
            format!("PatchBond is turned off for repo {repo_id}: no deposit is needed")
        );
        let rep = self.reputation.get(payer).cloned().unwrap_or_default();
        let bond = curve::quote(&repo.policy, repo.open, &rep, env::block_timestamp_ms());
        require!(
            bond > 0,
            "You're a proven contributor (≥3 refunds on ≥2 repos, no recent forfeits): no deposit is needed"
        );
        bond
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn insert_deposit(
        &mut self,
        payer: AccountId,
        repo_id: RepoId,
        number: Number,
        kind: Kind,
        github_user: String,
        bond: u128,
        tip: u128,
        fixes_issue: Option<Number>,
        harness: Option<String>,
    ) {
        let currency = self.currency_of(repo_id);
        if currency != Currency::Usdc {
            self.deposit_currency.insert((repo_id, number), currency);
        } else {
            // A voided deposit's slot may be reused, possibly after the repo switched currency.
            self.deposit_currency.remove(&(repo_id, number));
        }
        let n = self.unsettled.get(&repo_id).copied().unwrap_or(0);
        self.unsettled.insert(repo_id, n + 1);
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
                created_at: env::block_timestamp_ms(),
                reviewed_at: None,
                verdict_hash: None,
                status: DepositStatus::Held,
                from_budget: harness.is_some(),
                harness,
            },
        );
        let totals = self.totals_mut(currency);
        totals.held = U128(totals.held.0 + bond + tip);
        totals.deposits += 1;
        events::deposit(repo_id, number, kind, &payer, &github_user, bond, tip, open, currency);
    }
}

/// 2_500_000 → "2.50"
pub(crate) fn fmt_usdc(units: u128) -> String {
    format!("{}.{:02}", units / USDC, (units % USDC) / 10_000)
}
