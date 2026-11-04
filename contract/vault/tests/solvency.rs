//! Solvency under random use (docs/TRUST.md): after every step of a seeded random run of bonds, tips,
//! refunds, forfeits, bounties, withdrawals and failed payouts, the contract's token balance must equal
//! exactly what it owes: held money, vaults, treasury, bounties and claimable balances.
//! Run: `cargo test -p patchbond-vault --test solvency`

mod common;
use common::*;

const REPOS: [u64; 2] = [REPO, 102];
const ISSUES: [u64; 3] = [7, 8, 9];

/// A small deterministic generator, so a failure replays from its seed.
struct Rng(u64);
impl Rng {
    fn next(&mut self, below: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % below
    }
}

async fn owed(e: &Env, claimants: &[&Account]) -> anyhow::Result<u128> {
    let mut sum = u(&e.view("get_totals", json!({})).await?["held"]);
    sum += u(&e.view("get_config", json!({})).await?["treasury_balance"]);
    for repo in REPOS {
        sum += u(&e.view("get_repo", json!({ "repo_id": repo })).await?["vault"]);
        for issue in ISSUES {
            sum += u(&e.view("get_bounty", json!({ "repo_id": repo, "issue": issue })).await?);
        }
    }
    for who in claimants {
        sum += u(&e.view("get_claimable", json!({ "account_id": who.id() })).await?);
    }
    Ok(sum)
}

async fn run(seed: u64, steps: u32) -> anyhow::Result<()> {
    let e = setup().await?;
    e.register(102, Some(instant_policy())).await?;
    e.link(REPO, &e.amaka).await?;
    e.link(102, &e.amaka).await?;
    let carol = account(&e.worker, "carol").await?;
    for who in [e.bob.id(), carol.id()] {
        e.ft.call("mint").args_json(json!({ "account_id": who, "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
    }
    let payers = [&e.alice, &e.bob, &carol];
    let claimants = [&e.alice, &e.bob, &carol, &e.amaka, &e.treasury];

    let mut rng = Rng(seed);
    let mut open: Vec<(u64, u64)> = vec![];
    let mut next_pr = 1;
    let mut carol_left = false;
    for step in 0..steps {
        let op = rng.next(9);
        let what = match op {
            0..=3 => {
                let (repo, payer) = (REPOS[rng.next(2) as usize], payers[rng.next(3) as usize]);
                if payer.id() == carol.id() && carol_left {
                    continue;
                }
                let bond = e.quote(repo, Some(payer)).await?;
                let tip = if rng.next(3) == 0 { USDC / 4 } else { 0 };
                let extra = if rng.next(2) == 0 { json!({ "fixes_issue": ISSUES[rng.next(3) as usize], "tip": tip.to_string() }) } else { json!({ "tip": tip.to_string() }) };
                let number = next_pr;
                next_pr += 1;
                if e.pay(payer, repo, number, bond + tip, extra).await?.is_success() {
                    open.push((repo, number));
                }
                "bond"
            }
            4 | 5 if !open.is_empty() => {
                let (repo, number) = open.swap_remove(rng.next(open.len() as u64) as usize);
                let _ = e.settle(repo, number, if op == 4 { "refund" } else { "forfeit" }).await?;
                "settle"
            }
            6 => {
                let repo = REPOS[rng.next(2) as usize];
                let vault = u(&e.view("get_repo", json!({ "repo_id": repo })).await?["vault"]);
                if vault > 0 {
                    let amount = 1 + rng.next(vault as u64) as u128;
                    let _ = e.amaka.call(e.pb.id(), "withdraw").args_json(json!({ "repo_id": repo, "amount": amount.to_string() }))
                        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
                }
                "withdraw"
            }
            7 => {
                let (repo, issue) = (REPOS[rng.next(2) as usize], ISSUES[rng.next(3) as usize]);
                let _ = e.oracle.call(e.pb.id(), "pay_bounty").args_json(json!({ "repo_id": repo, "issue": issue, "recipient": payers[rng.next(3) as usize].id() }))
                    .gas(Gas::from_tgas(100)).transact().await?;
                "bounty"
            }
            _ if !carol_left && step > steps / 3 => {
                // Carol leaves the token contract: anything paid to her now has to fail and be booked.
                let left = e.ft.view("ft_balance_of").args_json(json!({ "account_id": carol.id() })).await?.json::<String>()?;
                carol.call(e.ft.id(), "ft_transfer").args_json(json!({ "receiver_id": e.alice.id(), "amount": left })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
                carol.call(e.ft.id(), "storage_unregister").args_json(json!({ "force": false })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
                carol_left = true;
                "carol leaves"
            }
            _ => {
                let _ = e.owner.call(e.pb.id(), "withdraw_treasury").deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
                "treasury"
            }
        };
        let held: u128 = e.ft.view("ft_balance_of").args_json(json!({ "account_id": e.pb.id() })).await?.json::<String>()?.parse()?;
        let owes = owed(&e, &claimants).await?;
        assert_eq!(held, owes, "seed {seed}, step {step} ({what}): the contract holds {held} and owes {owes}");
    }
    // The run has to have exercised the paths it claims to.
    let totals = e.view("get_totals", json!({})).await?;
    let stranded = u(&e.view("get_claimable", json!({ "account_id": carol.id() })).await?);
    println!("seed {seed}: {next_pr} PRs, refunded {}, forfeited {}, carol left: {carol_left}, claimable {stranded}", u(&totals["refunded"]), u(&totals["forfeited"]));
    assert!(u(&totals["refunded"]) > 0 && u(&totals["forfeited"]) > 0 && carol_left, "the run missed a path");
    Ok(())
}

#[tokio::test]
async fn the_balance_always_equals_what_is_owed() -> anyhow::Result<()> {
    run(0xB0ED, 120).await
}

#[tokio::test]
async fn the_balance_always_equals_what_is_owed_on_a_second_seed() -> anyhow::Result<()> {
    run(0x51A9, 120).await
}
