# How well the judge works

The judge is built to avoid taking a good contributor's money, and it misses most slop. The bond and the 24 h deadline do the filtering; the judge decides who gets their money back without a person looking.

## Held-out test, 2026-11-04

99 real PRs across 33 repos that were never used to tune anything. The selection rules were written first, in [`collect-heldout.ts`](../../server/scripts/collect-heldout.ts), and the judge, thresholds and prompts were unchanged from the earlier run. One run of `z-ai/glm-5.3-flash`.

- **Slop (50):** closed unmerged, labelled "ai slop", "ai-slop" or "llm slop" by a person, newest first, at most 2 per repo.
- **Good (49):** merged PRs from the same repos, from outside the team, each the author's only merged PR there.

What would happen to the bond:

| | Forfeited | To a maintainer | Refunded automatically | Error |
|---|---|---|---|---|
| **Good PRs (49)** | **0** | 13 | 35 | 1 |
| **Slop PRs (50)** | **3** | 24 | 23 | 0 |
| Slop, leaving out 6 closed under an AI-use policy (44) | 3 | 21 | 20 | 0 |

- **It catches little slop.** 3 of 50 forfeited (6%). **23 of 50 (46%) were refunded automatically**, so a spammer often gets the money back.
- **No good PR would lose its bond automatically.** With 48 judged, that puts the real rate below about 6% at 95% confidence, which is not a guarantee.
- **It costs maintainers more time than the earlier numbers suggested.** 13 of 48 good PRs (27%) went to a person, against 1 of 15 on the set used for tuning.
- **The model separated the two groups only weakly.** It said forfeit on 6 slop PRs and 0 good ones, and said refund on 39 of the 50 slop PRs. Three of its 6 forfeits were stopped by the confidence, evidence or hard-fact rules.

The numbers above are what the contract would do. The judge's own output differs in one case:

**A false alarm.** Our malicious-code scan marked good PR [dulwich#2550](https://github.com/jelmer/dulwich/pull/2550) as a forfeit, overruling the model's refund, because it contains the standard `curl https://sh.rustup.rs | sh` Rust installer line. The contract accepts only a forfeit the model itself made, so this PR goes to a maintainer and no money moves, which is why the table counts it under "To a maintainer". Counted by the judge's own output, 1 of 4 forfeits was wrong. The rule is unchanged, so this result stays held-out; it needs fixing and then a fresh test.

**The three forfeits:** [flathub#11002](https://github.com/flathub/flathub/pull/11002), [falcon#2770](https://github.com/falconry/falcon/pull/2770) and [tauri#16156](https://github.com/tauri-apps/tauri/pull/16156). Signed records: [flathub](examples/heldout-forfeit-flathub-11002.json), [falcon](examples/heldout-forfeit-falcon-2770.json), [tauri](examples/heldout-forfeit-tauri-16156.json), [dulwich false alarm](examples/heldout-false-alarm-dulwich-2550.json).

**Cost and time:** $0.0447 of inference in total, $0.00046 a verdict. Median 25 s with four running at once; the slowest took 17 minutes, so slow answers need a plan before heavy use.

### Limits of this test

- These labels record what maintainers decided. "Good" means merged, and "slop" means someone labelled it. Neither is an independent review.
- PRs were judged after closing, so some CI results may have aged and some duplicates may differ from what was visible at the time.
- It's one run: we didn't measure how much verdicts vary between runs.
- It has no deliberate prompt-injection set, and no measure of maintainer minutes.
- One good PR errored when fetching its details ([flathub#5146](https://github.com/flathub/flathub/pull/5146)) and has no verdict.

Reproduce: `GITHUB_TOKEN=… bun server/scripts/collect-heldout.ts` gives a fresh sample (GitHub's results change); `EVAL_SET=heldout JUDGE_MODE=nearai bun run --cwd server eval` re-judges this one. Set: [`heldout.json`](heldout.json). Results: [`results-heldout-z-ai-glm-5-3-flash.json`](results-heldout-z-ai-glm-5-3-flash.json).

## Earlier runs (used for tuning, not held out)

| Real PRs | Forfeited | To a maintainer | Refunded automatically |
|---|---|---|---|
| 15 good first PRs | 0 | 1 | 14 |
| 15 slop PRs labelled by maintainers | 0 | 8 | 7 |
| 20 open stranger PRs on [near/nearcore](nearcore/README.md) (unlabelled) | 0 | 7 | 13 |

The thresholds were set on the first 30, so those rows say little about new PRs. The nearcore PRs are unlabelled: they measure cost and triage, not accuracy. Results: [`results-z-ai-glm-5-3-flash.json`](results-z-ai-glm-5-3-flash.json).

## Signed examples

**See for yourself** — real records, every one signed by NEAR AI's GLM enclave key `0x3b75…fa0c`; check them offline with `bun scripts/verify-record.ts docs/eval/examples/*.json` (the same six checks as the verdict page):

| PR | Verdict | Why | Record |
|---|---|---|---|
| tj/commander.js#2636 | ✅ refund | "Small, focused fix extending the inspector-port regex to bracketed IPv6 hosts… CI passes." | [json](examples/refund-commander-2636.json) · [live page](https://patchbond-production.up.railway.app/v/7873cde589d23154) |
| microg/GmsCore#3922 "[BOUNTY] RCS Support [14999$]" | 🟡 to a maintainer | Model leaned refund at 0.7 — below the 0.8 bar for an automatic refund, so a human decides. | [json](examples/to-a-human-gmscore-3922-bounty.json) |
| OWASP/Nettacker#1787 | 🟡 to a maintainer | Model said *forfeit* at 0.65 — below the repo's 0.85 threshold, so it can't take the money. | [json](examples/model-said-forfeit-too-unsure-nettacker-1787.json) |
| constructed slop (not a real PR) | 🔴 forfeit, 0.99 | "Adds a postinstall hook that pipes a remote script into a shell… none of the claimed work: no tests, no src/queue.ts change." The contract accepts this signature on-chain ([test](../../contract/vault/tests/tee_proofs.rs), `bun run demo`). | [json](examples/constructed-slop-forfeit.json) |
