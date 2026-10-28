//! Settling a deposit with the judge's verdict, the priority lane, and slop-funds-the-fix bounties.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Promise};

use crate::payout::Fallback;
use crate::types::*;
use crate::{events, PatchBond, PatchBondExt};

#[near]
impl PatchBond {
    /// Oracle: a maintainer reviewed `#number` (approved, requested changes or commented).
    /// Within the repo's window, this earns the priority-lane tip for the vault.
    pub fn mark_reviewed(&mut self, repo_id: RepoId, number: Number) {
        self.assert_oracle();
        let now = env::block_timestamp_ms();
        let window_ms = self.repo(repo_id).policy.review_window_sec * 1000;
        let d = self.held_mut(repo_id, number);
        require!(d.reviewed_at.is_none(), "This submission is already marked as reviewed");
        d.reviewed_at = Some(now);
        let in_window = now <= d.created_at + window_ms;
        events::reviewed(repo_id, number, in_window);
    }

    /// Oracle settles with the AI verdict; the repo's payout account may settle too
    /// (the maintainer has the final word on `needs_human` cases).
    /// `verdict_hash` = hex sha256 of the signed verdict record on the public verdict page.
    pub fn settle(&mut self, repo_id: RepoId, number: Number, verdict: Verdict, verdict_hash: String) {
        let caller = env::predecessor_account_id();
        let repo = self.repo(repo_id);
        require!(
            caller == self.oracle || repo.payout.as_ref() == Some(&caller),
            "Only the PatchBond oracle or the repo's linked payout account can settle a deposit"
        );
        require!(
            verdict_hash.len() == 64 && verdict_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "verdict_hash must be a 64-character hex sha256"
        );
        let window_ms = repo.policy.review_window_sec * 1000;
        let now = env::block_timestamp_ms();

        let d = self.held_mut(repo_id, number);
        d.status = DepositStatus::Settled { verdict, at: now };
        d.verdict_hash = Some(verdict_hash.clone());
        let d = d.clone();

        let (bond, tip) = (d.bond.0, d.tip.0);
        let tip_earned =
            verdict != Verdict::Void && d.reviewed_at.is_some_and(|r| r <= d.created_at + window_ms);
        let (mut to_payer, mut to_vault, mut to_bounty, mut to_treasury) = (0, 0, 0, 0);
        match verdict {
            Verdict::Refund | Verdict::Void => to_payer += bond,
            Verdict::Forfeit => {
                to_treasury = bond * TREASURY_FEE_BPS / BPS;
                let repo_share = bond - to_treasury;
                if d.fixes_issue.is_some() {
                    to_bounty = repo_share;
                } else {
                    to_vault = repo_share;
                }
            }
        }
        if tip_earned {
            to_vault += tip;
        } else {
            to_payer += tip;
        }

        // Book-keeping before any transfer, so a failed transfer can never double-pay.
        let repo = self.repo_mut(repo_id);
        repo.open -= 1;
        repo.vault = U128(repo.vault.0 + to_vault);
        if tip_earned {
            repo.stats.tips_earned = U128(repo.stats.tips_earned.0 + tip);
        }
        match verdict {
            Verdict::Refund => repo.stats.refunds += 1,
            Verdict::Forfeit => {
                repo.stats.forfeits += 1;
                repo.stats.forfeited_total = U128(repo.stats.forfeited_total.0 + bond);
            }
            Verdict::Void => {}
        }
        if let Some(issue) = d.fixes_issue.filter(|_| to_bounty > 0) {
            let b = self.bounties.get(&(repo_id, issue)).map_or(0, |b| b.0);
            self.bounties.insert((repo_id, issue), U128(b + to_bounty));
        }
        self.treasury_balance += to_treasury;
        self.totals.held = U128(self.totals.held.0 - bond - tip);
        match verdict {
            Verdict::Forfeit => self.totals.forfeited = U128(self.totals.forfeited.0 + bond),
            _ => self.totals.refunded = U128(self.totals.refunded.0 + to_payer),
        }
        self.record_reputation(&d.payer, repo_id, verdict, now);

        events::settle(repo_id, number, verdict, &verdict_hash, to_payer, to_vault, to_bounty, to_treasury);
        if to_payer > 0 {
            // Detached: settlement stands even if the transfer fails (it then becomes claimable).
            let _ = self.send(d.payer, to_payer, Fallback::Claimable);
        }
    }

    /// Oracle: a real fix for `issue` was merged; pay its whole bounty to the fix's author.
    pub fn pay_bounty(&mut self, repo_id: RepoId, issue: Number, recipient: AccountId) -> Promise {
        self.assert_oracle();
        let amount = self.bounties.remove(&(repo_id, issue)).map_or(0, |b| b.0);
        require!(amount > 0, format!("Issue #{issue} on repo {repo_id} has no bounty"));
        events::bounty_paid(repo_id, issue, &recipient, amount);
        self.send(recipient, amount, Fallback::Claimable)
    }
}

impl PatchBond {
    fn held_mut(&mut self, repo_id: RepoId, number: Number) -> &mut Deposit {
        let d = self.deposits.get_mut(&(repo_id, number)).unwrap_or_else(|| {
            env::panic_str(&format!("#{number} on repo {repo_id} has no deposit"))
        });
        require!(
            d.status == DepositStatus::Held,
            format!("#{number} on repo {repo_id} is already settled")
        );
        d
    }

    fn record_reputation(&mut self, payer: &AccountId, repo_id: RepoId, verdict: Verdict, now: TimestampMs) {
        if verdict == Verdict::Void {
            return;
        }
        let mut rep = self.reputation.get(payer).cloned().unwrap_or_default();
        match verdict {
            Verdict::Refund => {
                rep.refunds += 1;
                if !rep.refund_repos.contains(&repo_id) && rep.refund_repos.len() < MAX_TRACKED_REPOS {
                    rep.refund_repos.push(repo_id);
                }
            }
            Verdict::Forfeit => {
                rep.forfeits += 1;
                rep.last_forfeit_at = Some(now);
            }
            Verdict::Void => unreachable!(),
        }
        self.reputation.insert(payer.clone(), rep);
    }
}
