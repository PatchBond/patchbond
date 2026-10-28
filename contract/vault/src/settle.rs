//! Settling a deposit: optimistic AI verdicts with stake-to-challenge (SPEC §13.3), the priority
//! lane (§13.2) and slop-funds-the-fix bounties (§13.4).
//!
//! Held ──oracle verdict──▶ Proposed ──window passes──▶ Settled
//!   │                         │ └─stake─▶ Challenged ──re-judged──▶ Settled
//!   ├──window 0──────────────────────────────────────────────────▶ Settled
//!   └──maintainer forfeit──▶ Proposed (48 h, fixed) ──free dispute──▶ Challenged
//!
//! A maintainer can always *refund* at once, but can never take a contributor's bond on their own
//! say-so: their forfeit is a proposal the contributor can dispute for free, a re-judge decides,
//! and an overturned maintainer forfeit pays the contributor a penalty escrowed from the vault.
//!
//! Money moves only in `execute`, once, when a deposit becomes Settled.

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
        let d = self.unsettled_mut(repo_id, number);
        require!(d.reviewed_at.is_none(), "This submission is already marked as reviewed");
        d.reviewed_at = Some(now);
        let in_window = now <= d.created_at + window_ms;
        events::reviewed(repo_id, number, in_window);
    }

    /// The oracle posts the AI verdict: it is *proposed* and stands after the repo's challenge
    /// window (or settles at once if the window is 0). The repo's payout account can refund (or
    /// void) at once at any stage; its forfeit only proposes — see the module docs.
    /// `verdict_hash` = hex sha256 of the signed verdict record on the public verdict page.
    pub fn settle(&mut self, repo_id: RepoId, number: Number, verdict: Verdict, verdict_hash: String) {
        assert_hash(&verdict_hash);
        let caller = env::predecessor_account_id();
        let repo = self.repo(repo_id);
        let is_maintainer = repo.payout.as_ref() == Some(&caller);
        require!(
            caller == self.oracle || is_maintainer,
            "Only the PatchBond oracle or the repo's linked payout account can settle a deposit"
        );
        let window_ms = repo.policy.challenge_window_sec * 1000;
        let now = env::block_timestamp_ms();
        let status = self.unsettled_mut(repo_id, number).status.clone();

        if is_maintainer {
            if verdict != Verdict::Forfeit {
                // Giving the money back needs no safeguard.
                if let DepositStatus::Challenged { challenger, .. } = &status {
                    require!(
                        !self.is_repo_payout(repo_id, challenger),
                        "You challenged this verdict yourself, so the re-judge decides it, not you"
                    );
                }
                return self.finish(repo_id, number, verdict, verdict_hash, status);
            }
            require!(
                status == DepositStatus::Held,
                match status {
                    DepositStatus::Proposed { verdict: Verdict::Refund, .. } =>
                        "The AI proposed a refund; to dispute it, stake a challenge (the re-judge decides)",
                    DepositStatus::Proposed { .. } =>
                        "A forfeit is already proposed; it stands when its window ends unless the contributor disputes it",
                    _ => "This deposit is being re-judged; the re-judge decides, not the maintainer",
                }
            );
            return self.propose_maintainer_forfeit(repo_id, number, verdict_hash, now);
        }
        require!(
            status == DepositStatus::Held,
            format!("#{number} on repo {repo_id} already has a verdict; challenge it instead")
        );
        if window_ms == 0 {
            return self.finish(repo_id, number, verdict, verdict_hash, status);
        }
        self.leave_queue(repo_id);
        let deadline = now + window_ms;
        let d = self.unsettled_mut(repo_id, number);
        d.verdict_hash = Some(verdict_hash.clone());
        d.status = DepositStatus::Proposed { verdict, deadline };
        events::proposed(repo_id, number, verdict, &verdict_hash, deadline);
    }

    /// Anyone: the challenge window passed without a challenge, so the proposed verdict stands.
    pub fn finalize(&mut self, repo_id: RepoId, number: Number) {
        let d = self.unsettled_mut(repo_id, number);
        let status = d.status.clone();
        let hash = d.verdict_hash.clone().unwrap_or_default();
        match status {
            DepositStatus::Proposed { verdict, deadline } => {
                require!(
                    env::block_timestamp_ms() > deadline,
                    format!("The challenge window is still open until {deadline} (ms since epoch)")
                );
                self.finish(repo_id, number, verdict, hash, status);
            }
            DepositStatus::Challenged { .. } => {
                env::panic_str("This verdict is being challenged; it settles when the re-judge resolves it")
            }
            _ => env::panic_str("There is no proposed verdict to finalize yet"),
        }
    }

    /// Oracle (after the stronger model re-judged with both sides' statements), or the maintainer
    /// for a contributor's challenge: the final verdict on a challenged deposit.
    pub fn resolve_challenge(&mut self, repo_id: RepoId, number: Number, verdict: Verdict, verdict_hash: String) {
        require!(
            env::predecessor_account_id() == self.oracle,
            "Only the PatchBond oracle resolves challenges (maintainers use settle)"
        );
        assert_hash(&verdict_hash);
        let status = self.unsettled_mut(repo_id, number).status.clone();
        require!(
            matches!(status, DepositStatus::Challenged { .. }),
            "This deposit isn't being challenged"
        );
        self.finish(repo_id, number, verdict, verdict_hash, status);
    }

    /// The contributor disputes a forfeit the *maintainer* proposed — free, because the maintainer is
    /// an interested party. A stronger model re-judges; the maintainer can no longer decide it.
    pub fn dispute(&mut self, repo_id: RepoId, number: Number) {
        let caller = env::predecessor_account_id();
        require!(
            self.maintainer_forfeits.contains_key(&(repo_id, number)),
            "Only a forfeit the maintainer proposed can be disputed for free; an AI verdict is challenged with a stake"
        );
        let d = self.unsettled_mut(repo_id, number);
        require!(caller == d.payer, "Only the person who paid the bond can dispute its forfeit");
        let DepositStatus::Proposed { verdict, deadline } = d.status.clone() else {
            env::panic_str("This forfeit is already disputed")
        };
        require!(env::block_timestamp_ms() <= deadline, "The dispute window has closed");
        d.status = DepositStatus::Challenged { verdict, challenger: caller.clone(), stake: U128(0) };
        let mut rec = self.maintainer_records.get(&repo_id).cloned().unwrap_or_default();
        rec.disputed += 1;
        self.maintainer_records.insert(repo_id, rec);
        events::challenged(repo_id, number, &caller, 0);
    }

    /// Oracle: a real fix for `issue` was merged; pay its whole bounty to the fix's author.
    pub fn pay_bounty(&mut self, repo_id: RepoId, issue: Number, recipient: AccountId) -> Promise {
        self.assert_oracle();
        let amount = self.bounties.remove(&(repo_id, issue)).map_or(0, |b| b.0);
        require!(amount > 0, format!("Issue #{issue} on repo {repo_id} has no bounty"));
        let held = self.bounty_held.get(&repo_id).map_or(0, |b| b.0);
        self.bounty_held.insert(repo_id, U128(held.saturating_sub(amount)));
        events::bounty_paid(repo_id, issue, &recipient, amount);
        // Bounties are in the repo's currency: it can't switch while one is unpaid.
        let currency = self.currency_of(repo_id);
        self.send(recipient, amount, currency, Fallback::Claimable)
    }
}

impl PatchBond {
    /// The maintainer's forfeit: a 48 h proposal the contributor may dispute for free. Up to one
    /// bond is escrowed from the vault, paid to the contributor if the dispute wins.
    fn propose_maintainer_forfeit(&mut self, repo_id: RepoId, number: Number, verdict_hash: String, now: TimestampMs) {
        self.leave_queue(repo_id);
        let deadline = now + MAINTAINER_FORFEIT_WINDOW_MS;
        let d = self.unsettled_mut(repo_id, number);
        let bond = d.bond.0;
        d.verdict_hash = Some(verdict_hash.clone());
        d.status = DepositStatus::Proposed { verdict: Verdict::Forfeit, deadline };
        let repo = self.repo_mut(repo_id);
        let escrow = bond.min(repo.vault.0);
        repo.vault = U128(repo.vault.0 - escrow);
        self.maintainer_forfeits.insert((repo_id, number), U128(escrow));
        let mut rec = self.maintainer_records.get(&repo_id).cloned().unwrap_or_default();
        rec.forfeits += 1;
        self.maintainer_records.insert(repo_id, rec);
        events::proposed(repo_id, number, Verdict::Forfeit, &verdict_hash, deadline);
    }

    /// Called from `ft_on_transfer` with a `challenge` msg. Returns the unused amount.
    pub(crate) fn take_challenge(&mut self, challenger: AccountId, amount: u128, repo_id: RepoId, number: Number) -> u128 {
        let is_maintainer = self.is_repo_payout(repo_id, &challenger);
        let by_maintainer = self.maintainer_forfeits.contains_key(&(repo_id, number));
        let d = self.unsettled_mut(repo_id, number);
        let DepositStatus::Proposed { verdict, deadline } = d.status.clone() else {
            env::panic_str("Only a proposed verdict inside its challenge window can be challenged; your stake was refunded")
        };
        require!(
            env::block_timestamp_ms() <= deadline,
            "The challenge window has closed; your stake was refunded"
        );
        match verdict {
            Verdict::Forfeit => {
                require!(
                    challenger == d.payer,
                    "Only the person who paid the bond can challenge a forfeit; your stake was refunded"
                );
                require!(
                    !by_maintainer,
                    "The maintainer proposed this forfeit, so disputing it is free: call dispute instead; your stake was refunded"
                );
            }
            Verdict::Refund => require!(
                is_maintainer,
                "Only the repo's linked payout account can challenge a refund; your stake was refunded"
            ),
            Verdict::Void => env::panic_str("A void verdict can't be challenged; your stake was refunded"),
        }
        let stake = d.bond.0;
        d.status = DepositStatus::Challenged { verdict, challenger: challenger.clone(), stake: U128(stake) };
        let currency = self.deposit_currency_of(repo_id, number);
        require!(
            amount >= stake,
            format!(
                "A challenge stakes the bond ({}) but {} was sent; your stake was refunded",
                currency.fmt(stake),
                currency.fmt(amount)
            )
        );
        let totals = self.totals_mut(currency);
        totals.held = U128(totals.held.0 + stake);
        events::challenged(repo_id, number, &challenger, stake);
        amount - stake
    }

    /// Settle with the final `verdict`, sorting out any challenge stake first.
    fn finish(&mut self, repo_id: RepoId, number: Number, verdict: Verdict, verdict_hash: String, from: DepositStatus) {
        if from == DepositStatus::Held {
            self.leave_queue(repo_id);
        }
        // A maintainer's forfeit: once the contributor disputed it and it didn't stand, the escrow is
        // their compensation. A forfeit that stands, or one retracted before any dispute, returns it.
        if let Some(escrow) = self.maintainer_forfeits.remove(&(repo_id, number)) {
            let currency = self.deposit_currency_of(repo_id, number);
            if verdict != Verdict::Forfeit && matches!(from, DepositStatus::Challenged { .. }) {
                let mut rec = self.maintainer_records.get(&repo_id).cloned().unwrap_or_default();
                rec.overturned += 1;
                self.maintainer_records.insert(repo_id, rec);
                let d = self.deposits.get(&(repo_id, number)).unwrap().clone();
                self.pay_out(d.payer, escrow.0, d.from_budget, currency);
            } else {
                self.credit_vault(repo_id, escrow.0, currency);
            }
        }
        if let DepositStatus::Challenged { verdict: proposed, challenger, stake } = from {
            let overturned = verdict != proposed;
            let currency = self.deposit_currency_of(repo_id, number);
            let totals = self.totals_mut(currency);
            totals.held = U128(totals.held.0 - stake.0);
            if overturned {
                // The challenger was right: stake back.
                self.pay_out(challenger.clone(), stake.0, false, currency);
            } else if self.is_repo_payout(repo_id, &challenger) {
                // The maintainer challenged a refund and lost: the contributor gets the stake.
                let d = self.deposits.get(&(repo_id, number)).unwrap().clone();
                self.pay_out(d.payer, stake.0, d.from_budget, currency);
            } else {
                // The contributor challenged a forfeit and lost: the stake goes to the repo.
                self.credit_vault(repo_id, stake.0, currency);
            }
            events::resolved(repo_id, number, verdict, overturned, &challenger, stake.0);
        }
        self.execute(repo_id, number, verdict, verdict_hash);
    }

    /// The only place a bond and tip move. The deposit must not be Settled yet.
    fn execute(&mut self, repo_id: RepoId, number: Number, verdict: Verdict, verdict_hash: String) {
        let now = env::block_timestamp_ms();
        let window_ms = self.repo(repo_id).policy.review_window_sec * 1000;
        let d = self.unsettled_mut(repo_id, number);
        d.status = DepositStatus::Settled { verdict, at: now };
        d.verdict_hash = Some(verdict_hash.clone());
        let d = d.clone();
        let currency = self.deposit_currency_of(repo_id, number);
        if let Some(n) = self.unsettled.get(&repo_id).copied() {
            // Deposits from before v0.3 were never counted.
            self.unsettled.insert(repo_id, n.saturating_sub(1));
        }

        let (bond, tip) = (d.bond.0, d.tip.0);
        let tip_earned =
            verdict != Verdict::Void && d.reviewed_at.is_some_and(|r| r <= d.created_at + window_ms);
        let Split { to_payer, to_vault, to_bounty, to_treasury } =
            split(bond, tip, verdict, tip_earned, d.fixes_issue.is_some());

        // Book-keeping before any transfer, so a failed transfer can never double-pay.
        self.credit_vault(repo_id, to_vault, currency);
        let same_currency = self.currency_of(repo_id) == currency;
        let repo = self.repo_mut(repo_id);
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
        if !same_currency && to_bounty > 0 {
            // A bounty is in the repo's currency; this one can't join it (see `credit_vault`).
            self.credit_vault(repo_id, to_bounty, currency);
        } else if let Some(issue) = d.fixes_issue.filter(|_| to_bounty > 0) {
            let b = self.bounties.get(&(repo_id, issue)).map_or(0, |b| b.0);
            self.bounties.insert((repo_id, issue), U128(b + to_bounty));
            let held = self.bounty_held.get(&repo_id).map_or(0, |b| b.0);
            self.bounty_held.insert(repo_id, U128(held + to_bounty));
        }
        match currency {
            Currency::Usdc => self.treasury_balance += to_treasury,
            Currency::Near => self.treasury_near += to_treasury,
        }
        let totals = self.totals_mut(currency);
        totals.held = U128(totals.held.0 - bond - tip);
        match verdict {
            Verdict::Forfeit => totals.forfeited = U128(totals.forfeited.0 + bond),
            _ => totals.refunded = U128(totals.refunded.0 + to_payer),
        }
        self.record_reputation(&d.payer, repo_id, verdict, now);
        self.record_agent(&d.payer, d.harness.as_deref(), verdict);

        events::settle(repo_id, number, verdict, &verdict_hash, to_payer, to_vault, to_bounty, to_treasury, currency);
        self.pay_out(d.payer, to_payer, d.from_budget, currency);
    }

    /// Money owed to a payer: back into the agent's budget, or a token transfer.
    fn pay_out(&mut self, to: AccountId, amount: u128, from_budget: bool, currency: Currency) {
        if amount == 0 {
            return;
        }
        // Budgets hold USDC only, so a budget-paid deposit is always USDC.
        if from_budget {
            self.credit_budget(&to, amount);
        } else {
            // Detached: settlement stands even if the transfer fails (it then becomes claimable).
            let _ = self.send(to, amount, currency, Fallback::Claimable);
        }
    }

    /// Money for the repo. A vault holds one currency; if this amount is in another (only possible
    /// for deposits made before v0.3 counted unsettled deposits), it goes to the payout account's
    /// claimable balance in its own currency — or the treasury's if the repo isn't linked.
    fn credit_vault(&mut self, repo_id: RepoId, amount: u128, currency: Currency) {
        if amount == 0 {
            return;
        }
        if self.currency_of(repo_id) == currency {
            let repo = self.repo_mut(repo_id);
            repo.vault = U128(repo.vault.0 + amount);
        } else if let Some(payout) = self.repo(repo_id).payout.clone() {
            self.credit_claimable(&payout, amount, currency);
        } else {
            match currency {
                Currency::Usdc => self.treasury_balance += amount,
                Currency::Near => self.treasury_near += amount,
            }
        }
    }

    /// The deposit left the maintainers' review queue (the bond curve's `open`).
    fn leave_queue(&mut self, repo_id: RepoId) {
        let repo = self.repo_mut(repo_id);
        repo.open -= 1;
    }

    fn is_repo_payout(&self, repo_id: RepoId, account: &AccountId) -> bool {
        self.repo(repo_id).payout.as_ref() == Some(account)
    }

    fn unsettled_mut(&mut self, repo_id: RepoId, number: Number) -> &mut Deposit {
        let d = self.deposits.get_mut(&(repo_id, number)).unwrap_or_else(|| {
            env::panic_str(&format!("#{number} on repo {repo_id} has no deposit"))
        });
        require!(
            !matches!(d.status, DepositStatus::Settled { .. }),
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

/// Where a settled bond and tip go. Pure, so the invariant "nothing created, nothing lost" is
/// checked exhaustively in tests.
#[derive(Debug, PartialEq)]
pub(crate) struct Split {
    pub to_payer: u128,
    pub to_vault: u128,
    pub to_bounty: u128,
    pub to_treasury: u128,
}

pub(crate) fn split(bond: u128, tip: u128, verdict: Verdict, tip_earned: bool, fixes_issue: bool) -> Split {
    let mut s = Split { to_payer: 0, to_vault: 0, to_bounty: 0, to_treasury: 0 };
    match verdict {
        Verdict::Refund | Verdict::Void => s.to_payer += bond,
        Verdict::Forfeit => {
            s.to_treasury = bond * TREASURY_FEE_BPS / BPS;
            let repo_share = bond - s.to_treasury;
            if fixes_issue {
                s.to_bounty = repo_share;
            } else {
                s.to_vault = repo_share;
            }
        }
    }
    if tip_earned {
        s.to_vault += tip;
    } else {
        s.to_payer += tip;
    }
    s
}

fn assert_hash(h: &str) {
    require!(
        h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()),
        "verdict_hash must be a 64-character hex sha256"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Small deterministic PRNG so the property test needs no extra crates.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.0 >> 11
        }
    }

    #[test]
    fn the_split_never_creates_or_loses_a_unit() {
        let mut rng = Lcg(42);
        for _ in 0..50_000 {
            let bond = (rng.next() % 1_000_000_000) as u128 + 1;
            let tip = (rng.next() % 100_000_000) as u128;
            let verdict = [Verdict::Refund, Verdict::Forfeit, Verdict::Void][(rng.next() % 3) as usize];
            let earned = verdict != Verdict::Void && rng.next().is_multiple_of(2);
            let issue = rng.next().is_multiple_of(2);
            let s = split(bond, tip, verdict, earned, issue);
            assert_eq!(s.to_payer + s.to_vault + s.to_bounty + s.to_treasury, bond + tip, "{bond} {tip} {verdict:?}");
            match verdict {
                Verdict::Forfeit => {
                    assert_eq!(s.to_treasury, bond / 10);
                    assert!(s.to_payer <= tip, "a forfeit never refunds the bond");
                    assert_eq!(s.to_bounty > 0, issue);
                }
                _ => {
                    assert_eq!(s.to_treasury, 0, "refunds pay no fee");
                    assert!(s.to_payer >= bond, "a refund returns the whole bond");
                }
            }
        }
    }

    #[test]
    fn a_tip_goes_to_the_vault_only_when_earned() {
        assert_eq!(split(2_000_000, 500_000, Verdict::Refund, true, false), Split { to_payer: 2_000_000, to_vault: 500_000, to_bounty: 0, to_treasury: 0 });
        assert_eq!(split(2_000_000, 500_000, Verdict::Refund, false, false), Split { to_payer: 2_500_000, to_vault: 0, to_bounty: 0, to_treasury: 0 });
        assert_eq!(split(2_000_000, 0, Verdict::Forfeit, false, true), Split { to_payer: 0, to_vault: 0, to_bounty: 1_800_000, to_treasury: 200_000 });
    }
}
