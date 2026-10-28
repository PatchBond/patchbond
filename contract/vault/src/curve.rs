//! Attention pricing — "EIP-1559 for maintainers" (SPEC §13.1).
//!
//! bond = clamp(min, max, base × 1.125^(open − target)) × reputation multiplier
//!
//! Each outside submission above the repo's review capacity raises the next bond by 12.5%;
//! each one below lowers it by 1/9 (the exact inverse step). Integer maths only, and the
//! loop stops as soon as the bound is hit, so gas is bounded by the clamp, not the queue.

use crate::types::{Policy, Reputation, TimestampMs, FORFEIT_MEMORY_MS};

pub fn curve_bond(policy: &Policy, open: u32) -> u128 {
    let (min, max) = (policy.min_bond.0, policy.max_bond.0);
    let mut bond = policy.base_bond.0;
    let target = policy.target_open;
    if open > target {
        for _ in 0..(open - target) {
            bond = bond * 9 / 8;
            if bond >= max {
                break;
            }
        }
    } else {
        for _ in 0..(target - open) {
            bond = bond * 8 / 9;
            if bond <= min {
                break;
            }
        }
    }
    bond.clamp(min, max)
}

/// Proven contributors: ≥3 refunds across ≥2 repos and no forfeit in the last 90 days.
pub fn is_exempt(rep: &Reputation, now: TimestampMs) -> bool {
    rep.refunds >= 3 && rep.refund_repos.len() >= 2 && !recent_forfeit(rep, now)
}

fn recent_forfeit(rep: &Reputation, now: TimestampMs) -> bool {
    rep.last_forfeit_at
        .is_some_and(|at| now.saturating_sub(at) < FORFEIT_MEMORY_MS)
}

/// 0 = exempt; 1 = normal; 2–4 = recently forfeited (one step per forfeit, capped).
pub fn multiplier(rep: &Reputation, now: TimestampMs) -> u128 {
    if is_exempt(rep, now) {
        0
    } else if recent_forfeit(rep, now) {
        1 + rep.forfeits.min(3) as u128
    } else {
        1
    }
}

/// The bond `rep` must pay right now on a repo with `open` unsettled deposits.
pub fn quote(policy: &Policy, open: u32, rep: &Reputation, now: TimestampMs) -> u128 {
    let m = multiplier(rep, now);
    if m == 0 {
        return 0;
    }
    (curve_bond(policy, open) * m).min(policy.max_bond.0 * 4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::USDC;

    fn p() -> Policy {
        Policy::default() // base $2, min $0.25, max $50, target 8
    }

    #[test]
    fn at_target_the_bond_is_base() {
        assert_eq!(curve_bond(&p(), 8), 2 * USDC);
    }

    #[test]
    fn each_extra_open_submission_adds_12_5_percent() {
        assert_eq!(curve_bond(&p(), 9), 2_250_000);
        assert_eq!(curve_bond(&p(), 10), 2_531_250);
        // 14 open, target 8 → 2 × 1.125^6 ≈ $4.05
        assert_eq!(curve_bond(&p(), 14), 4_054_572);
    }

    #[test]
    fn a_flood_hits_the_ceiling_and_stays_there() {
        assert_eq!(curve_bond(&p(), 40), 50 * USDC);
        assert_eq!(curve_bond(&p(), u32::MAX), 50 * USDC); // bounded loop, no overflow
    }

    #[test]
    fn a_quiet_repo_is_cheap_but_never_below_min() {
        let empty = curve_bond(&p(), 0);
        assert!((USDC / 4..USDC).contains(&empty), "empty queue bond = {empty}");
        let mut tiny = p();
        tiny.target_open = 1000;
        assert_eq!(curve_bond(&tiny, 0), USDC / 4);
    }

    #[test]
    fn the_curve_is_monotonic() {
        let mut prev = 0;
        for open in 0..60 {
            let b = curve_bond(&p(), open);
            assert!(b >= prev, "bond dropped at open={open}");
            prev = b;
        }
    }

    #[test]
    fn proven_contributors_pay_nothing() {
        let rep = Reputation { refunds: 3, refund_repos: vec![1, 2], ..Default::default() };
        assert_eq!(quote(&p(), 30, &rep, 0), 0);
    }

    #[test]
    fn refunds_on_a_single_repo_do_not_exempt() {
        let rep = Reputation { refunds: 10, refund_repos: vec![1], ..Default::default() };
        assert_eq!(quote(&p(), 8, &rep, 0), 2 * USDC);
    }

    #[test]
    fn recent_forfeits_multiply_the_bond_then_fade() {
        let now = 100 * 24 * 3600 * 1000;
        let rep = Reputation {
            refunds: 5,
            refund_repos: vec![1, 2],
            forfeits: 2,
            last_forfeit_at: Some(now - 1000),
        };
        assert_eq!(quote(&p(), 8, &rep, now), 6 * USDC); // ×3, and not exempt
        let later = now + FORFEIT_MEMORY_MS;
        assert_eq!(quote(&p(), 8, &rep, later), 0); // forgiven after 90 days → exempt again
    }
}
