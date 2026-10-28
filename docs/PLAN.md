# Plan — what we need to make PatchBond a success

## Timeline change (2026-10-28)
The official FAQ (Q-001) allows code from 2026-10-19, so we start building now: **18 days (28 Oct → 14 Nov)** instead of 14. The extra days go to testing with real maintainers. The day-by-day table below keeps its order; shift it 4 days earlier (Day 1 = Tue 28 Oct) and use 11–14 Nov for the pilot, hardening, README, video and submission.

## A. Setup (in parallel with building)

### Accounts and keys (the human does these; agents must not create NEAR accounts for the team)
- [ ] Pick the final name; check the GitHub org, domain and X handle are free.
- [ ] NEAR **mainnet** account for the submission (`nearAddress`), created by the team lead.
- [ ] NEAR **testnet** accounts: `patchbond-dev.testnet` (contract), an oracle account, two test users, one agent account.
- [ ] NEAR AI Cloud account + API key (https://cloud.near.ai) → `.env` as `NEARAI_API_KEY`. Check which models support `provider_tee` signatures.
- [ ] NEAR Intents 1Click JWT (removes the extra 0.25% fee) → `.env`.
- [ ] Testnet USDC for test users (Circle faucet).
- [ ] GitHub: a new org (or the UseHandova org) for the repo + 2 demo repos we control. The repo stays **private** until the human makes it public.
- [ ] Register the GitHub App on 1 Nov (permissions: pull requests R/W, issues R/W, checks R/W, actions R/W for approving fork runs, contents R, metadata R; webhooks: pull_request, issues, check_suite, check_run, installation).
- [ ] Hosting: Vercel (web), Railway or Fly (server — Railway deploys were paused recently; have a fallback ready).
- [ ] X account ready for the demo post.

### Tools on this Mac
- [ ] Rust stable + `wasm32-unknown-unknown` target, `cargo-near`, `near-cli-rs`
- [ ] Bun (already installed for Handova)

### People (this is what wins "impact")
- [ ] Line up **3–5 real maintainers** willing to install PatchBond on a repo during 8–13 Nov. Start with friends' repos, then maintainers who've posted about AI slop. Ask: deposit size they'd want, what counts as slop, would they take the money or route it to a project fund.
- [ ] Collect **10 real slop PRs/issues** (public, linkable) and **10 real good first-time PRs** to use as the judge's evaluation set. This also gives us an honest accuracy number for the README.

### Learn (official tutorials only, nothing committed)
- [ ] near-sdk-rs fungible-token receiver (`ft_on_transfer`) example; near-workspaces tests.
- [ ] NEAR AI Cloud verification example repo (signature + attestation).
- [ ] 1Click quickstart (`/tokens`, `/quote`, `/status`).

## B. Build order (each day ends with green tests and small, descriptive commits; Day 1 = 28 Oct)

| Day | Date | Goal | Done when |
|---|---|---|---|
| 1 | Sat 1 Nov | `git init`, monorepo skeleton (`contract/ server/ web/ mcp/ shared/`), CI, README skeleton; verify every **VERIFY** item in SPEC | Skeleton builds; VERIFY list resolved and SPEC updated |
| 2 | Sun 2 Nov | Contract: repos, deposits via `ft_on_transfer`, `settle` (refund / 90-10 forfeit), `withdraw` | near-workspaces tests pass on sandbox |
| 3 | Mon 3 Nov | Judge v1: diff + CI + context → NEAR AI Cloud → JSON verdict; store request/response bytes + signature; run it on the 20-item eval set | Accuracy + cost per verdict measured and written down |
| 4 | Tue 4 Nov | GitHub App: webhook → policy → check run → pay-link comment; settle on verdict | A real PR on a demo repo goes pending → paid → judged (testnet) |
| 5 | Wed 5 Nov | Web app: `/pay`, wallet connect, `ft_transfer_call`; public verdict page with in-browser signature check | Pay and verify from a phone |
| 6 | Thu 6 Nov | Linking (`link_repo` via GitHub OAuth admin check), dashboard: policy, vault, withdraw (option A) | Amaka-flow works end to end |
| 7 | Fri 7 Nov | Agent budgets + Function Call keys + MCP server; Claude Code opens a PR and pays the bond through MCP | Daily cap enforced by contract; test proves over-cap refusal |
| 8 | Sat 8 Nov | Reputation + exemptions + vouching; **attention pricing** (on-chain bond curve) + **priority tips** | Bond rises in a flood test, falls when the queue empties; tip paid only if reviewed in time |
| 9 | Sun 9 Nov | Payout option B (Intents to another chain — tiny mainnet test **only with the human's OK**) and option C (Sputnik/Trezu DAO payout) | One real cross-chain payout or a clearly labelled dry-run |
| 10 | Mon 10 Nov | Pilot: install on the maintainers' repos; fix what breaks | ≥3 external repos live |
| 11 | Tue 11 Nov | **Optimistic verdicts + stake-to-challenge** (cheap model → Kimi K3), slop-funds-the-fix bounties, agent passports; abuse/injection tests | Challenge flips a wrong verdict in a test; earmarked forfeit pays the real fix |
| 12 | Wed 12 Nov | Stretch: on-chain signature verification (`ecrecover`), then sealed security reports — only if days 1–11 are solid | Contract rejects a forged verdict |
| 13 | Thu 13 Nov | README for humans + AI judges ("do X → see Y"), architecture diagram, honest "what's real" table, numbers from the pilot; demo video | A fresh agent can follow the README and see a verdict |
| 14 | Fri 14 Nov | Freeze. Human: make repo public, post the X demo, confirm the submission payload; then we submit | 201 from the submission API before 23:59 UTC |

Buffer: days 12 and 14 absorb slips. If behind, cut in this order: sealed reports → on-chain signature verification → DAO payout → agent passports page → cross-chain payout. Never cut: bond + judge + attention pricing + challenge.

## C. What makes it win
1. **Real usage:** real maintainers, real PRs, real verdicts and real money moving in 14 days, shown on the public verdict page.
2. **Verifiability:** anyone can check that the AI's verdict wasn't edited — "verify yourself" button.
3. **Depth the AI judges can see:** clean Rust contract with tests for every money path, abuse tests, small commits, a README that runs.
4. **Honesty:** an accuracy number from the eval set, a "what's real vs planned" table, and the curl objection answered openly.
5. **Agents as first-class users:** the judges (Claude Code, Codex) can install the MCP server and try paying the bond themselves.

## D. Team split (suggestion)
- **Contract + chain** (Rust, Intents, keys)
- **Server + judge** (GitHub App, NEAR AI Cloud, eval set)
- **Web + MCP + README/demo** (UI, verdict page, MCP, video)
