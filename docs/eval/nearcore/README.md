# Case study: near/nearcore (2026-10-30)

What PatchBond would do on NEAR's own core repo today. Run:
`GITHUB_TOKEN=$(gh auth token) JUDGE_MODE=nearai bun --env-file=.env server/scripts/repo-report.ts near/nearcore`

## The queue

| | |
|---|---|
| Open PRs | **186** (101 drafts) |
| From NEAR's own engineers | ~161 — GitHub labels them `CONTRIBUTOR` because their org membership is private. **PatchBond never charges them**: the bot checks membership of the `near` org directly (or they can be listed under `exempt:`). |
| From strangers (`NONE` / first-timers) | **20** — the only PRs that would be asked for a bond |
| How long those 20 have waited | median **236 days**, oldest **623** |

## The verdicts

All 20 judged by `z-ai/glm-5.3-flash` in NEAR AI's TEE, each response signed by the GLM enclave key
`0x3b75…fa0c` — **$0.0074 for all 20**. Full signed records (exact request/response bytes):
[`records.json`](records.json); one line each: [`summary.json`](summary.json).

| Verdict | PRs | |
|---|---|---|
| ✅ Refund | **13** | Real, small, correct: a README link fix, a GC fix for an open issue, cold-storage and RPC fixes, regression tests, doc corrections, EIP-2537 test vectors. |
| 🟡 Needs a maintainer | **7** | 6 because CI is failing (often a stale base on a months-old PR — "when in doubt, refund"), 1 the model wasn't sure about. |
| 🔴 Forfeit | **0** | |

**Zero false forfeits on a real repo's real outside contributions** — the judge's job is never to
take a genuine contributor's money, and here it didn't.

## What this means for nearcore

nearcore doesn't have a slop problem today; it has a **review-queue problem**: genuine outside
fixes go unanswered for months. PatchBond helps with that even when nobody is spamming:

- **Signed triage, free to maintainers.** Each stranger PR arrives with a verifiable verdict and
  its facts (CI, claims vs diff, phantom code, malicious patterns). 13 of these 20 are marked
  "small and correct" — minutes each to merge.
- **Contributors aren't left holding a bond.** A refund verdict returns the bond as soon as the
  judge rules after CI — not when a maintainer finally reviews.
- **The priority lane** lets a contributor add a tip that the repo earns only if someone reviews
  within the promised window — a reason to answer in days, not 236.
- **Ready for the flood.** When AI agents start opening PRs in bulk (hackathons, bounty farms), the
  bond curve prices the wave out and unpaid PRs close themselves after 24 h — while NEAR's own
  engineers, as `near` org members, never see a bond.

Settings that fit nearcore (`.github/patchbond.yml`):

```yaml
assignment_required: true        # CONTRIBUTING.md already asks people to get issues assigned first
unassigned_pr: flag              # a maintainer decides, no extra penalty
close_unpaid_after_hours: 72     # longer notice for a core repo
```
