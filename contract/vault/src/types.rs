use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

/// GitHub's numeric repository id. Names change on rename/transfer; ids don't.
pub type RepoId = u64;
/// PR or issue number inside a repo.
pub type Number = u64;
/// Milliseconds since the Unix epoch (fits a JS number, unlike nanoseconds).
pub type TimestampMs = u64;

/// USDC has 6 decimals: 1_000_000 = $1.
pub const USDC: u128 = 1_000_000;
/// NEAR (and wNEAR) has 24 decimals.
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// What a repo's bonds are paid in. NEAR travels as wNEAR (NEP-141), so every money path is the
/// same `ft_transfer_call` → `ft_on_transfer` flow; the wallet wraps NEAR in the same transaction.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Currency {
    #[default]
    Usdc,
    Near,
}

impl Currency {
    pub fn symbol(self) -> &'static str {
        match self {
            Currency::Usdc => "USDC",
            Currency::Near => "NEAR",
        }
    }

    /// 2_500_000 → "2.50 USDC"; 1.5e24 → "1.50 NEAR"
    pub fn fmt(self, units: u128) -> String {
        let one = match self {
            Currency::Usdc => USDC,
            Currency::Near => NEAR,
        };
        format!("{}.{:02} {}", units / one, (units % one) / (one / 100), self.symbol())
    }
}
/// Share of every forfeit that goes to the PatchBond treasury (inference + gas), in basis points.
pub const TREASURY_FEE_BPS: u128 = 1_000;
pub const BPS: u128 = 10_000;
/// Longest window a repo may promise or a challenge may stay open.
pub const MAX_WINDOW_SEC: u64 = 30 * 24 * 3600;
/// Reputation: a forfeit inside this window blocks exemption and raises the price.
pub const FORFEIT_MEMORY_MS: u64 = 90 * 24 * 3600 * 1000;

/// What a repo charges and how fast it promises to look.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Off → no deposits accepted for this repo.
    pub enabled: bool,
    /// Bond when the open queue equals `target_open`.
    pub base_bond: U128,
    pub min_bond: U128,
    pub max_bond: U128,
    /// How many outside submissions the maintainers can review at once.
    pub target_open: u32,
    /// Priority lane: a tip is earned only if a maintainer reviews within this window.
    pub review_window_sec: u64,
    /// Optimistic verdicts: an AI verdict stands after this window unless someone stakes to challenge it.
    /// 0 = AI verdicts settle immediately.
    pub challenge_window_sec: u64,
    /// Minimum AI confidence (basis points) the oracle needs before proposing a forfeit.
    pub forfeit_threshold_bps: u16,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            enabled: true,
            base_bond: U128(2 * USDC),
            min_bond: U128(USDC / 4),
            max_bond: U128(50 * USDC),
            target_open: 8,
            review_window_sec: 72 * 3600,
            challenge_window_sec: 72 * 3600,
            forfeit_threshold_bps: 8_500,
        }
    }
}

impl Policy {
    pub fn assert_valid(&self) {
        let (min, base, max) = (self.min_bond.0, self.base_bond.0, self.max_bond.0);
        assert!(
            min <= base && base <= max,
            "Invalid policy: bonds must satisfy min_bond <= base_bond <= max_bond (got {min} / {base} / {max})"
        );
        assert!(min > 0, "Invalid policy: min_bond must be above zero; turn the repo off with enabled=false instead");
        assert!(self.target_open >= 1, "Invalid policy: target_open must be at least 1");
        assert!(
            self.review_window_sec <= MAX_WINDOW_SEC,
            "Invalid policy: review_window_sec can be at most {MAX_WINDOW_SEC} (30 days)"
        );
        assert!(
            self.challenge_window_sec <= MAX_WINDOW_SEC,
            "Invalid policy: challenge_window_sec can be at most {MAX_WINDOW_SEC} (30 days)"
        );
        assert!(
            self.forfeit_threshold_bps as u128 <= BPS && self.forfeit_threshold_bps >= 5_000,
            "Invalid policy: forfeit_threshold_bps must be between 5000 and 10000"
        );
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Repo {
    /// Who may withdraw and change policy. `None` until a maintainer links the repo;
    /// forfeits wait in the vault meanwhile.
    pub payout: Option<AccountId>,
    pub policy: Policy,
    /// Withdrawable balance, in units of the repo's currency.
    pub vault: U128,
    /// Unsettled deposits — the queue that drives the bond curve.
    pub open: u32,
    pub linked_at: Option<TimestampMs>,
    pub stats: RepoStats,
}

/// `get_repo`'s answer: the repo plus the currency its bonds and vault are in.
#[near(serializers = [json])]
pub struct RepoView {
    #[serde(flatten)]
    pub repo: Repo,
    pub currency: Currency,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct RepoStats {
    pub deposits: u32,
    pub refunds: u32,
    pub forfeits: u32,
    pub forfeited_total: U128,
    pub tips_earned: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Pr,
    Issue,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Real contribution: bond back to the payer.
    Refund,
    /// Slop: bond split 90% repo (or the linked issue's bounty) / 10% treasury.
    Forfeit,
    /// Deposit made in error (e.g. paid for someone else's PR): full refund, no reputation change.
    Void,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DepositStatus {
    /// Bond held, waiting for the judge.
    Held,
    /// The AI verdict stands at `deadline` unless challenged.
    Proposed { verdict: Verdict, deadline: TimestampMs },
    /// Someone staked against the proposed verdict; a stronger model + the maintainer decide.
    Challenged { verdict: Verdict, challenger: AccountId, stake: U128 },
    Settled { verdict: Verdict, at: TimestampMs },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Deposit {
    pub payer: AccountId,
    pub github_user: String,
    pub kind: Kind,
    pub bond: U128,
    /// Priority-lane tip, held separately from the bond.
    pub tip: U128,
    /// Issue this PR claims to fix; its forfeit becomes a bounty on that issue.
    pub fixes_issue: Option<Number>,
    pub created_at: TimestampMs,
    pub reviewed_at: Option<TimestampMs>,
    /// Hex sha256 of the latest signed verdict record, so anyone can match chain ↔ verdict page.
    pub verdict_hash: Option<String>,
    pub status: DepositStatus,
    /// Paid by an agent from its in-contract budget: refunds go back into the budget.
    pub from_budget: bool,
    /// The agent's declared harness (claude-code, codex, …), for per-harness records.
    pub harness: Option<String>,
}

/// Portable reputation per NEAR account; readable by any repo or app.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Reputation {
    pub refunds: u32,
    pub forfeits: u32,
    pub last_forfeit_at: Option<TimestampMs>,
    /// Distinct repos that refunded this account (capped; only "≥ 2" matters today).
    pub refund_repos: Vec<RepoId>,
}

pub const MAX_TRACKED_REPOS: usize = 8;

/// `msg` of `ft_transfer_call` into this contract.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// Pay the bond (plus an optional review tip) for a PR or issue.
    Bond {
        repo_id: RepoId,
        number: Number,
        kind: Kind,
        github_user: String,
        tip: Option<U128>,
        fixes_issue: Option<Number>,
    },
    /// Stake against a proposed verdict (stake = the bond). The payer may challenge a forfeit;
    /// the repo's payout account may challenge a refund.
    Challenge { repo_id: RepoId, number: Number },
    /// Fund (or top up) a capped budget that `agent` can spend on bonds with a function-call key.
    FundBudget { agent: AccountId, daily_cap: Option<U128> },
}

/// A capped agent wallet held inside the contract. Function-call keys can't attach
/// deposits, so the cap has to live here, enforced by the contract.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Budget {
    pub owner: AccountId,
    pub balance: U128,
    pub daily_cap: U128,
    pub spent_today: U128,
    /// Days since the epoch (UTC) that `spent_today` refers to.
    pub day: u64,
}

pub const DAY_MS: u64 = 24 * 3600 * 1000;
/// Smallest amount that opens a new agent budget (storage-griefing floor).
pub const MIN_BUDGET: u128 = USDC;

/// Know Your Agent: who runs this agent and on what. The transaction itself is signed by the
/// agent account's function-call key, so the declaration is attributable.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Passport {
    pub operator: AccountId,
    pub harness: String,
    pub model: String,
}

/// Public refund/forfeit record for one agent or one harness.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct AgentStats {
    pub deposits: u32,
    pub refunds: u32,
    pub forfeits: u32,
}

/// Global counters for the landing page.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Totals {
    pub held: U128,
    pub refunded: U128,
    pub forfeited: U128,
    pub deposits: u32,
}
