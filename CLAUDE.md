# PatchBond — NEAR HACKATHON project memory

> Read this first. Then: `docs/SPEC.md` (full design, §13 = our edges), `docs/PLAN.md` (schedule), `docs/HACKATHON.md` (rules + official FAQ), `docs/RESEARCH.md` (verified facts, prior art, sources), `docs/JUDGE.md` (AI judge: model, prompt, verdict schema). Labelled test set: `docs/eval/candidates.json`.
> Name chosen 2026-10-26; GitHub `patchbond`, npm, patchbond.dev/.xyz/.app and `patchbond.near` were free then — the human registers them.

## One line
AI made sending free. PatchBond makes wasting a maintainer's time cost something — and pays the maintainer whose time was wasted.
Pitch: **"A market for maintainer attention — EIP-1559 for open source."** Also: "Kickback for pull requests" and "the opposite of tea.xyz".

## What we are building
A refundable **bond** on unsolicited work sent to open-source repos (pull requests and bug reports first).
1. A stranger opens a PR → PatchBond asks for a bond (or waives it for trusted/proven/vouched people).
2. An **AI judge** on **NEAR AI Cloud** (verifiable model in a TEE, signed response) reviews it, using facts we compute (CI results, phantom symbols, duplicates).
3. Real contribution → bond refunded (+ optional tip). Slop → bond goes to the **repo's vault** in our NEAR contract (90% repo / 10% PatchBond treasury).
4. Every verdict is public, with reasons, evidence, the exact request/response bytes and the NEAR AI signature → anyone can verify it.
5. Contributors and AI agents build a **portable reputation** on NEAR; proven ones pay $0.

### The edges (SPEC §13) — what makes us distinct; never drop the core four
1. **Attention pricing (core):** bond follows an EIP-1559-style curve on the repo's open queue, computed on-chain from unsettled deposits: `clamp(min, max, base × 1.125^(open − target))`, × reputation multiplier.
2. **Priority lane (core):** optional review tip → repo vault only if a maintainer reviews within the promised window; otherwise refunded.
3. **Optimistic AI verdicts (core):** cheap verifiable model (GLM-5.3-flash) decides → 72 h challenge window → either side stakes to challenge → stronger verifiable model (Kimi K3) re-judges → maintainer has final word. Loser's stake goes to the other side.
4. **Slop funds the fix (core):** forfeits on a PR claiming to fix issue #N become a bounty on #N, paid automatically to whoever's real fix is accepted.
5. **Agent passports / Know Your Agent:** agents paying via our MCP server declare operator + harness + model, signed with their function-call key; public refund/forfeit record per agent and per harness; repos can price by passport.
6. Stretch: **sealed security reports** (report judged in the TEE, stored encrypted to maintainers; public sees only the verdict).

### Where the maintainer's money goes (SPEC §4)
Repo vault in our contract, keyed by GitHub numeric `repo_id`. Maintainer links it by installing the GitHub App + GitHub OAuth admin check → our oracle calls `link_repo`. Payout options: **A** withdraw to their NEAR account (build) · **B** auto-pay to any chain via NEAR Intents (build; mainnet tiny amounts with the human's OK) · **C** a Sputnik DAO / Trezu treasury (build) · **D** bank/card (after the hackathon). Unclaimed money waits in the vault.

### One contract + three interfaces
| Part | Tech | Folder |
|---|---|---|
| Vault contract | Rust, near-sdk 5.x, cargo-near, near-workspaces tests | `contract/` |
| Judge + GitHub App server | Bun + TypeScript, Octokit, NEAR AI Cloud (OpenAI-compatible SDK), near-api-js | `server/` |
| Web app (pay, link, dashboard, public verdict pages with in-browser verification, agent passports) | React + Vite + TypeScript + Tailwind, NEAR Connect (`@hot-labs/near-connect`) | `web/` |
| MCP server for AI agents (`patchbond_policy`, `_reputation`, `_deposit`, `_status`, `_budget`, `_appeal`) | TypeScript, `@modelcontextprotocol/sdk` | `mcp/` |
| Shared types | TypeScript | `shared/` |

### NEAR features we use (name them in the README with file paths)
NEAR AI Cloud verifiable inference + signatures (judge) · NEP-141 USDC + `ft_transfer_call` (bonds, budgets) · Function Call access keys (capped agent wallets) · NEAR Intents 1Click (cross-chain in/out) · meta transactions NEP-366 (gasless contributors) · named/sub-accounts · Sputnik DAO / Trezu (treasury payouts) · NEP-297 events.
**OutLayer (adopted 2026-10-30):** the judge also runs as a wasm program in Intel TDX (`outlayer/judge`, Rust port of `server/src/judge/` with a byte-parity test); the contract calls it via `judge_in_tee` and verifies NEAR AI's signature in the callback (`contract/vault/src/outlayer.rs`). Setup + trust model: `docs/OUTLAYER.md`.

## Hackathon rules (official FAQ — docs/HACKATHON.md)
- **Building before 1 Nov is allowed** (Q-001): the window runs from the announcement on 2026-10-19 to 2026-11-14 23:59 UTC; earlier commits are baseline. We started 2026-10-28, so all our commits count. No registration.
- **Testnet-only projects are eligible in all tracks** (Q-010). Mainnet only where the integration is mainnet-only — NEAR Intents has no testnet (Q-007): separate dev accounts, tiny amounts, `dry: true` quotes.
- No mandatory integrations (Q-011); our own NEAR contract that fits the track is enough.
- Local demo OK, but a **hosted demo is a plus — keep it up until 2026-11-18, ideally 2026-11-25** (Q-012). Video in the X post; screenshots alone aren't enough.
- Add a **LICENSE** (MIT) (Q-014). Team keeps all rights (Q-013).
- AI judges (Claude Code, Codex) **screen**: reproducibility check, feature verification, structured report, preliminary score; humans decide (Q-017). → README "do X → see Y" steps must work from a clean clone.
- Libraries, templates and AI-written code are allowed; list them in the README (Q-005).
- Submissions only 1–14 Nov; one per team; can't be edited. Prizes fixed in USD, paid in NEAR within 30 days.
- 1Click JWT optional (0.2% fee without it; https://partners.near-intents.org).

## Network decision (confirmed by the human 2026-10-28)
- **Build and test everything on testnet first.** Testnet stays the README's "reproduce it yourself" path, so AI judges can test for free. Live testnet deploy: `deploy/testnet.json` (`patchbond-dev.testnet`, oracle `patchbond-oracle.testnet`, Circle testnet USDC).
- **The final demo runs on mainnet**: once testnet is solid, deploy the contract to mainnet for the demo video and hosted demo, and run the NEAR Intents cross-chain payout for real with tiny amounts. **Every mainnet step (deploy, spending, signing) needs the human's explicit go-ahead at the time.**
- Keep everything network-agnostic: account IDs, USDC contract and RPC come from `deploy/<network>.json` + env, never hardcoded.
- Human's personal testnet tester account: `tester1604.testnet` (Meteor wallet) — a tester, not a deployer.

## Submission
- Prize address (`nearAddress`): **crypticdev.near** (exists on mainnet). Never use it for deploys or signing.
- GitHub org: **https://github.com/PatchBond** (created by the human). Push only with the human's OK.
- **Claude must never appear as a contributor**: no `Co-Authored-By: Claude` (or any Claude/Anthropic) trailers, author or committer — every commit is authored and committed by the repo-local identity below. Check `git log --format='%an %ce %b' | grep -i claude` is empty before any push.

## Hard rules for agents working here
- Never, without the human's explicit confirmation: push, force-push, make the repo public, post on X, sign mainnet transactions, spend tokens, deploy to mainnet, submit the application.
- Never create or invent the team's NEAR mainnet account.
- Never commit secrets or the submission payload. Keys in `.env` (git-ignored). Never print secrets.
- Re-read https://nearhackathon.com/HACKATHON.md before submitting.

## Git identity (Handova-team project)
- Repo-local: `Gbangbolaoluwagbemiga <oluwagbemigagbangbola@gmail.com>`. Don't touch the global git config (other projects use another identity).
- Before every push: `gh api user --jq .login` must print `Gbangbolaoluwagbemiga`, else `gh auth switch -h github.com -u Gbangbolaoluwagbemiga`.
- Small, descriptive commits — the AI judges read the history.

## Key facts (verified — sources in docs/RESEARCH.md)
- **Shade Agent Framework is deprecated** (unmaintained after 2026-04-19) — don't use it.
- NEAR AI Cloud: `https://cloud-api.near.ai/v1`, OpenAI-compatible; key from https://cloud.near.ai (`sk-…`, env `NEARAI_API_KEY`). Only models with `metadata.verifiable: true` sign responses (GLM-5.3 / 5.3-flash, Kimi K3, Qwen 3.x…). **Claude/GPT there are external and not verifiable — never use them for verdicts.**
- Signature: `GET /v1/signature/<CHAT_ID>?signing_algo=ecdsa` → `text`, `signature`, `signing_address`, `signing_algo`, `signature_kind`. `provider_tee` text = `<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>`; recover the EIP-191 signer; send `x-no-aliasing: true`; keep exact bytes.
- On-chain verification works: `env::ecrecover` (near-sdk feature `unstable`) + keccak256 → address (proven in a throwaway test).
- Function Call keys **cannot attach deposits** (allowance = gas only) → agent spending caps live in our contract (`budgets`); the key only restricts methods.
- USDC on NEAR (Circle): mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`; testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (re-check). 6 decimals.
- 1Click: `https://1click.chaindefuser.com/v0` (`/tokens`, `/quote`, `/deposit/submit`, `/status`). `customRecipientMsg` → delivery via `ft_transfer_call` ("HIGHLY EXPERIMENTAL"); `appFees` can take our fee.
- Gasless (NEP-366): sender account must exist; one receiver per meta tx.
- GitHub: `POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve` approves first-time-contributor fork CI (App permission undocumented — test).
- Tools installed on this Mac: Rust 1.97 (+wasm32 targets), cargo-near 0.22, near-cli-rs 0.30, Bun 1.4, gh.

## Positioning (don't drift)
- PatchBond is **not a code reviewer** (Illia's idea list includes "private code review" — many teams will build that). Lead with the bond, the money flows, verifiable verdicts, reputation, capped agent wallets and the §13 mechanisms.
- Free slop detectors exist (anti-slop, aislop, PR Slop Gate) — detection isn't our edge; their signals can feed our facts block.
- **Never pay anyone for submitting. No token.** (tea.xyz caused spam floods doing that.)

## Product rules
- **When in doubt, refund.** `forfeit` needs confidence ≥ repo threshold (default 0.85) and ≥1 concrete evidence item; CI green + no phantom symbols + no duplicate → model can't forfeit; otherwise `needs_human`.
- PatchBond never runs contributor code; it reads the repo's own CI.
- Bonds optional per repo; vouched/proven contributors pay $0; every verdict public and challengeable.
- Error messages say what went wrong and what to do next. UI: neutral palette, one accent colour, mobile-friendly.

## Tests
- `contract/`: `cargo test` + near-workspaces integration tests for every money path (deposit, refund, forfeit split, tip, challenge, bounty, budget cap, withdraw, bond curve).
- `server/`, `mcp/`: `bun test`; judge eval script over `docs/eval/` (forfeit precision, needs_human rate, cost per verdict).
- `bun run typecheck` everywhere; one end-to-end script on testnet: real PR on a demo repo → bond → verdict → payout.

## Tracks (submit all; lead with security)
`security` (primary — spending limits, policy engine, reputation, scam detection, Function Call Keys, TEE attestation), `agents`, `privacy`, `social`, `open`.
