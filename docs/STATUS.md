# What is built, and how to check it

Status of each part, how to check our claims, and what the tests cover.

## What's real

Testnet is the reproduce-it-yourself path; mainnet follows with the team's go-ahead.

| Part | Status |
|---|---|
| Vault contract: USDC or NEAR bonds per repo, curve, refund/forfeit, void, tips, bounties, challenges, maintainer safeguards, agent budgets, reputation, NEP-297 events, link-once, pause, upgrades | ✅ **Live on testnet** ([`deploy/testnet.json`](../deploy/testnet.json)), full e2e |
| On-chain check of NEAR AI's TEE signature before any AI forfeit | ✅ **Live on testnet** with NEAR AI's GLM enclave key and gateway keys bound to one model each — Kimi K3, and GLM-5.3 for disputes (`get_tee_signers`) |
| **Judging in OutLayer** (`judge_in_tee`): the judge as a wasm program in Intel TDX — fetches the PR from GitHub itself, asks NEAR AI, the contract verifies the signature in the callback; byte-identical prompts to the server's (parity test, 30 real PRs) | ✅ **Live on testnet** — first run: [tx `GTZM613J…`](https://testnet.nearblocks.io/txns/GTZM613JkwxhDoEafaBsEmX5tFr4SGwEQ3SaVtAh6Hr4) (24.5 s in the enclave, 0.0036 NEAR, NEAR AI's GLM key recovered on-chain); the hosted bot is set to judge paid PRs this way; **`exclusive` is on** for the live contract, so the oracle can no longer forfeit |
| **Disputes re-judged in OutLayer** (`rejudge_in_tee`): both sides post statements on-chain, the enclave sends them and the PR to the stronger model, the contract settles on NEAR AI's signature | ✅ **Live on testnet** — a disputed maintainer forfeit re-judged and upheld ([demo-widget#2](https://github.com/PatchBond/demo-widget/pull/2), our test PR; [tx](https://testnet.nearblocks.io/txns/HV68yEs15FLQntpUJcfrHV9g4qVBbUMi5Dv8wTH9WaHP)) |
| **Bounties paid on the enclave's check** (`claim_bounty_in_tee`): slop that claimed to fix #N funds a bounty; the enclave confirms on GitHub that a real fix merged and who it pays | ✅ **Live on testnet** — slop [demo-widget#3](https://github.com/PatchBond/demo-widget/pull/3) forfeited in the enclave, the real fix [#4](https://github.com/PatchBond/demo-widget/pull/4) merged, $1.80 paid to its author's account ([tx](https://testnet.nearblocks.io/txns/Hd48Ju7spyayYof8mqo1H7424rrHn5ax8LXPFg99WbkB)); our test PRs, not outside users |
| AI judge on NEAR AI Cloud (`z-ai/glm-5.3-flash`; disputes re-judged by `moonshotai/kimi-k3`, and by `z-ai/glm-5.3` on testnet while NEAR AI reports Kimi K3 unavailable) | ✅ **Live**, TEE-signed, about $0.0005 a verdict; [held-out results](eval/README.md) |
| GitHub App bot: deposit comment + 24 h deadline, labels, check runs, deposit watch, judge after CI, settle, @mention on payment, review → tip, merge → bounty | ✅ **Live** as the [`patchbond` App](https://github.com/apps/patchbond) on Sanctifier — first live PR [#1972](https://github.com/HyperSafeD/Sanctifier/pull/1972) went comment → bond → verdict → settlement (a test: opened and paid from the maintainer's own second account, `coldroom5333.testnet`; no outside contributor has paid a bond yet) |
| Web app: pay, verdicts with in-browser verification, maintainer dashboard (sign-in, NEP-413 linking, withdraw, policy, activity), agents, ⌘K | ✅ **Live** at the demo URL |
| MCP server for agents (7 tools) | ✅ Paid a real bond on testnet in the e2e |
| Gasless bonds (NEP-366 relayer) | ✅ Proven on testnet — the contributor spent 0 NEAR |
| Payout to another chain via NEAR Intents 1Click | 🟡 Quotes live (dry-run — Intents has no testnet); the actual cross-chain transfer runs only on mainnet, not yet done |
| Payout to any NEAR account, including a Sputnik DAO / Trezu treasury (`set_payout`) | ✅ Built — no DAO-specific flow (proposals) yet |
| **Sealed security reports**: a vulnerability report is encrypted in the reporter's browser to the maintainer and to an OutLayer enclave key no person holds; the bond is bound to the ciphertext; the enclave checks the report against the repo's real code and asks NEAR AI. Plaintext exists only in the reporter's browser, inside the enclave and NEAR AI's TEE while judging, and with the maintainer; our server and the public see ciphertext and the verdict | ✅ **Live on testnet** — built and tested (cross-language crypto fixture, sandbox test, a real enclave run that forfeited a made-up report at 0.85); the enclave published its key on 2026-10-31; a real report was refunded and a made-up one forfeited ([run](OUTLAYER.md#live-on-testnet-2026-10-31)) |
| A token, or paying anyone for submitting | ❌ Never |

## Check our claims

| Claim | Check it |
|---|---|
| The judge models exist and are verifiable | NEAR AI's public model list: <https://cloud-api.near.ai/v1/model/list> (`metadata.verifiable: true`) |
| The contract makes an AI forfeit only on NEAR AI's signature | Call `get_tee_signers` on [`patchbond-dev.testnet`](https://testnet.nearblocks.io/address/patchbond-dev.testnet) and compare with `signing_address` in NEAR AI's attestation report (`GET /v1/attestation/report?model=…`) |
| A verdict wasn't edited | Any verdict on the [live demo](https://patchbond-production.up.railway.app) → **Verify signature** (runs in your browser) |
| The facts given to the model are true | Each verdict publishes the exact request bytes — diff, CI results, every computed fact — to compare with the PR on GitHub |
| Money moved on-chain | [`docs/e2e/testnet-report.md`](e2e/testnet-report.md): 62 transactions, one explorer link each |
| Built during the hackathon | First commit 2026-10-28 (window: 2026-10-19 → 11-14); see the commit history and [how it was built](BUILD_LOG.md) |

## Case study: NEAR's own core repo

We ran PatchBond on **[near/nearcore](https://github.com/near/nearcore)**'s open queue (186 PRs) on 2026-10-30. ~161 are NEAR's engineers — exempt as members of the `near` org. The **20 from strangers** were judged in NEAR AI's TEE for **$0.0074**: **13 refund, 7 to a maintainer, 0 forfeits** — unlabelled, so this measures cost and triage, not accuracy; they were waiting a median **236 days** for review. PatchBond's answer there is signed triage, bonds returned as soon as the judge rules, and a priority lane that pays for a timely review. Signed records and write-up: [docs/eval/nearcore](eval/nearcore/README.md).

## Testing

**228 automated tests run by default**, all passing, counted on 2026-11-06: contract 81 (13 unit, 68 sandbox), TypeScript 138 (server 103, shared 22, MCP 13), enclave program 12. CI runs all of them on every push. Five more, the contract upgrade replays, need old builds and run separately. The web app has **no tests of its own**; the verifier its "Verify signature" button runs is `shared/src/verify.ts`, tested on 9 real NEAR AI-signed records. This is the only place the breakdown is kept.

**Getting a smaller number?** The 68 sandbox tests start a local NEAR node, which `near-workspaces` downloads on first use. Without it, `cargo test` runs the 13 unit tests and the sandbox suites fail to start. If the download times out, see [REPRODUCE.md](REPRODUCE.md) (`NEAR_SANDBOX_BIN_PATH`). And `bun test` from the repo root runs only one package: use `bun run test`, which runs each package.

| Suite | Count | Command |
|---|---|---|
| Contract unit (curve, money-split property test, TEE parsing, signed-request subject) | 13 | `cd contract && cargo test -p patchbond-vault --lib` |
| Contract sandbox: money paths 16 · NEAR bonds 7 · optimistic & agents 9 · maintainer safeguards 4 · TEE proofs 5 · OutLayer 4 · disputes 3 · bounties 3 · sealed reports 1 | 52 | `cd contract && cargo test -p patchbond-vault` (runs every contract test: 81) |
| Contract attacks and solvency: adversarial 7 · screening findings 7 · random-use solvency 2 | 16 | `cargo test -p patchbond-vault --test adversarial --test screening --test solvency` |
| Contract upgrades (replay each older live build; reported as ignored, not passed, unless run with `--ignored` and the old wasm; last run 2026-11-05, 5 of 5) | 5 | [`tests/migrate.rs`](../contract/vault/tests/migrate.rs) |
| Server: facts, malicious scan, rules, bot vs fake GitHub, onboarding, spending guard, Intents, relayer and its daily gas budget | 103 | `cd server && bun test` |
| OutLayer program: JS-semantics unit 2 · byte parity with the TS judge on 30 real PRs 1 · bounty check 6 · rejudge 1 · report 1 · sealed envelope 1 | 12 | `cd outlayer/judge && cargo test` |
| MCP · shared (curve, sealed envelopes, the verifier on made-up and on 9 real signed records) | 13 · 22 | `cd mcp && bun test` · `cd shared && bun test` |
| Web app | 0 | — |
| **All TypeScript** | 138 | `bun install && bun run test` |
| **End-to-end on real NEAR testnet** | 62 tx, run 2026-11-05 | `bun run --cwd server e2e:testnet` → [report](e2e/testnet-report.md) |

## Security summary

Full threat model: **[SECURITY.md](../SECURITY.md)**.

- **With `exclusive` on, our server can't forfeit** — its route is refused. When that route is open, the contract requires a NEAR AI signature on the forfeit (a model's enclave key, or the gateway key bound to one verifiable model), checks the signed request names this repo and PR, and accepts each signature once; the server could still feed the model a fabricated PR under the right name, which is detectable because every request is published ([tests](../contract/vault/tests/tee_proofs.rs), incl. genuine NEAR AI signatures).
- **The server can leave the loop entirely** — `judge_in_tee` runs the judge in an OutLayer enclave (Intel TDX) that reads GitHub itself; the contract recovers NEAR AI's signature over the hashes in the callback, trusts the attested worker for the verdict ([details](TRUST.md#what-the-outlayer-callbacks-verify)), and `exclusive` mode removes the oracle's forfeit power. The enclave program builds **byte-identical prompts** to the server's (parity test over 30 real PRs) — [docs/OUTLAYER.md](OUTLAYER.md).
- **No contract method lets anyone but the linked payout account take a vault** — not the owner role, not the oracle; a stolen oracle key can't relink a linked repo. (The deployer key can still upgrade the code — see SECURITY.md → Upgrades.)
- **A maintainer's forfeit is a proposal** — 48 h, free dispute, re-judge, penalty if overturned, public record; undisputed, it stands ([tests](../contract/vault/tests/maintainer_safeguards.rs)).
- **Every payout has a callback** that books money back on failure; book-keeping precedes transfers, so nothing is paid twice.
- **Agents hold only a function-call key**; the contract enforces the cap; the MCP server refuses full-access keys.
- **Prompt injection** is fenced as untrusted data and is itself evidence, and output must match a strict schema. These reduce the risk; they don't prove a crafted PR can't sway a signed verdict. An AI forfeit needs confidence ≥ threshold, evidence and a hard fact.
- **Webhooks are HMAC-verified; repo linking** needs GitHub admin rights plus a NEP-413 signature from a full-access key; OAuth is CSRF-protected ([tests](../server/test/maintainers.test.ts)).
