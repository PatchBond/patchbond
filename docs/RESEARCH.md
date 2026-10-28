# Research — verified facts and sources (2026-10-26)

## The problem is real and current
- Linux Foundation Research (Oct 2026): ~25% of incoming PRs estimated low-quality AI output; 31% on larger projects; survey of 234 contributors/maintainers.
  https://www.phoronix.com/news/Linux-Foundation-25p-AI-Slop · https://www.theregister.com/ai-and-ml/2026/10/21/ai-cuts-coding-time-but-its-also-filling-open-sources-inbox-with-crap/5304389
- curl moved low/medium-severity vulns to public view because AI-assisted reports nearly overwhelmed its security team; Daniel Stenberg rejected a monetary-deposit idea as against open source's openness (our main objection to answer).
  https://leaddev.com/software-quality/open-source-has-a-big-ai-slop-problem
- GitHub weighing options to limit/disable PRs.
  https://www.opensourceforu.com/2026/02/github-weighs-pull-request-kill-switch-as-ai-slop-floods-open-source/

## Uniqueness check
- No crypto deposit / bond system for open-source submissions found.
- "Pay to email me" existed pre-AI (Earn.com, ~2018; Hashcash-style postage ideas date to the 1990s). New here: AI judge with verifiable verdicts + portable reputation + agent budgets, aimed at AI spam.

## NEAR facts
- **Shade Agent Framework deprecated** — not maintained after 2026-04-19; docs moved to https://github.com/NearDeFi/shade-agent-framework/tree/main/docs. Don't build on it.
- **NEAR AI Cloud**: `https://cloud-api.near.ai/v1`, OpenAI-compatible. Private inference in TEEs (Intel TDX + NVIDIA GPU TEEs per marketing pages).
  - Signature: `GET https://cloud-api.near.ai/v1/signature/<CHAT_ID>?signing_algo=ecdsa` (or `ed25519`), bearer auth.
  - Fields: `text`, `signature`, `signing_address`, `signing_algo`, `signature_kind` (`provider_tee` | `gateway`).
  - `provider_tee` text: `<MODEL_ID>:<request_hash>:<response_hash>`; `gateway`: `<request_hash>:<response_hash>`; hashes = SHA-256 of exact body bytes (don't re-serialize).
  - ecdsa: recover EIP-191 signer from `text` + `signature`, compare to `signing_address`; then match against the verified attestation report.
  - Send completions with header `x-no-aliasing: true` and a canonical model ID.
  - Docs: https://docs.near.ai/cloud/verification · https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md · https://docs.near.ai/cloud/private-inference
- **Access keys**: Function Call keys can only call one contract (optionally specific methods) and **cannot attach tokens**; the allowance only pays gas/fees.
  https://docs.near.org/protocol/accounts-contracts/access-keys
- **USDC on NEAR** (Circle native): mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`; testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (re-check at https://developers.circle.com/stablecoins/usdc-contract-addresses).
- **NEAR Intents 1Click**: base `https://1click.chaindefuser.com/v0`; `GET /tokens`, `POST /quote`, `POST /deposit/submit`, `GET /status?depositAddress=…`.
  - Quote fields: `dry`, `swapType` (`EXACT_INPUT`, `EXACT_OUTPUT`, also `FLEX_INPUT`, `ANY_INPUT`), `slippageTolerance` (bps), `originAsset`, `depositType` (`ORIGIN_CHAIN` | `INTENTS` | `CONFIDENTIAL_INTENTS`), `destinationAsset`, `amount`, `recipient`, `recipientType` (`DESTINATION_CHAIN` | `INTENTS` | `CONFIDENTIAL_INTENTS`), `refundTo`, `refundType`, `confidentiality` (`public` | `basic` | `advanced`), `deadline`.
  - Statuses: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, `FAILED`.
  - **No testnet** — use small mainnet amounts (needs the human's approval). JWT avoids an extra 0.25% fee.
  - https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md

## What the judges' world is asking for
- a16z crypto "17 things for 2026": Know Your Agent (KYA), privacy as moat, prediction markets with LLM oracles, staked media, "invisible tax on the open web".
  https://a16zfrontier.com/posts/article/big-ideas-things-excited-about-crypto-2026/
- Track wording: https://nearhackathon.com/ (see docs/HACKATHON.md)
- Past NEAR hackathon winners were mostly swap assistants and tipping bots (One Trillion Agents, 2025) — the depth bar is beatable.
  https://x.com/NEARDevHub/status/1899907018523369591

## Open questions — findings from throwaway tests (2026-10-26; test code deleted, not reused)
1. **Verifiable models** — answered. `GET /v1/model/list` is public; models carry `metadata.verifiable`. Verifiable: GLM-5.3 / GLM-5.3-flash, Kimi K3 / K2.6, Qwen 3.x, DeepSeek v3.2, plus embeddings/reranker. Claude/GPT there are external and **not** verifiable. See docs/JUDGE.md. *Still open:* how often signing addresses rotate (needs an API key — day 1).
2. **1Click into our contract** — answered: quote field `customRecipientMsg` makes the withdrawal use `ft_transfer_call` with that msg. Marked "HIGHLY EXPERIMENTAL" (funds can be lost if storage/`ft_on_transfer` is wrong). Default to the two-step flow; try direct delivery with a tiny amount only with the human's OK. `appFees` (Intents account + bps) could take our fee. Verifier `ft_withdraw` with any string `msg` also uses `ft_transfer_call`.
3. **On-chain signature check** — answered: works. `near_sdk::env::ecrecover(hash, sig64, v, malleability_flag) -> Option<[u8;64]>` (needs feature `unstable`); keccak256 of the 64-byte key, last 20 bytes = Ethereum address. A unit test signed `<MODEL>:<hash>:<hash>` EIP-191-style with k256, recovered the right address, and a tampered text failed. (near-sdk 5, Rust 1.97.)
4. **Approve fork CI runs** — endpoint confirmed: `POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve` ("pull request from a public fork of a first time contributor"). App permission not documented → test on day 1 (expect Actions: write).
5. **Gasless (NEP-366)** — relayer wraps the user's signed DelegateAction and pays gas. Limits: one receiver per meta tx, sender account must already exist, inner action signed with a full-access/regular key. Plan: sponsor account creation; verify `ft_transfer_call` (1 yocto) via meta tx on testnet on day 1. Docs: https://docs.near.org/chain-abstraction/meta-transactions

## Test-set evidence
- GitHub search (2026-10-26): `label:"ai slop" is:pr` → 2,018 PRs; `label:ai-slop` → 587; `label:slop` → 1,236; `label:"AI spam"` → 112. Useful as a "problem is real" stat (label counts, not a measurement of all slop).
- Some repos (e.g. flathub, SPLURT) label any AI use "ai slop" by policy, not quality → modelled as a repo policy, excluded from the quality eval.
- curl's maintainer keeps a public list of 49 AI-slop HackerOne reports: https://gist.github.com/bagder/07f7581f6e3d78ef37dfbfc81fd1d1cd ; disclosed reports are fetchable as JSON at `https://hackerone.com/reports/<id>.json`.

## Hackathon announcement (NEAR, X, 2026-10-19) — https://x.com/NEARProtocol/status/2112257967818997891
- "No advance sign-up required." No registration — just submit once, 1–14 Nov.
- Form asks for "your **preferred track**" (article) — the API accepts several; still lead with one primary.
- Prize pool $250,000, **paid in NEAR** to the nearAddress.
- Toolkit they name: Intents, Chain Signatures, chain abstraction, NEAR AI Cloud, TEEs, 1-Click Swap SDK, function call keys, meta transactions, sub-accounts, named accounts. "Not a checklist — name the ones you used in the README."
- Testnet vs mainnet: not stated anywhere. Ask in NEAR Discord.

## Illia's 13 ideas (X, 2026-10-03) — https://x.com/ilblackdragon/status/2106269343881519444
Judges will see many builds of these. Two touch us:
- **"Code review that is fully private — agent that verifiably privately runs code review on private PRs using NEAR AI."** Expect several "private AI code reviewer" entries. PatchBond is NOT a code reviewer: the judge is one component; the product is the bond, payouts, reputation and agent budgets for public repos. Say this in the first line of the README so we aren't lumped in with them.
- **Kickback-style event escrow** ("guests who showed up split the deposits"). Same mechanic as ours (deposit, refund the honest, forfeit to the wronged) — Illia already likes it. Pitch line: "Kickback for pull requests."
- Distribution tips from Illia: NEAR Legion, **Aurora Intent Connect** (any-chain wallets without bridging), Product Hunt, X.

## Competitors / prior art for PatchBond (checked 2026-10-28)
| What | Does | Gap we fill |
|---|---|---|
| GitHub native controls (Aug 2026) | Turn PRs off, limit to collaborators, cap concurrent PRs per outsider | Shuts newcomers out; no money, no reputation |
| peakoss/anti-slop (Action, v0) | 34 heuristic rules incl. contributor history; auto-closes | No deposit, no payment to maintainers, no portable reputation |
| Scan AI Slop – aislop (App) | Scores PRs 0–100, no LLM | Same |
| PR Slop Gate (Action) | Heuristics + optional LLM grader; label/close | Same; verdicts not verifiable |
| Spampr (App) | Labels spam PRs | Same |
| contributor-report (Action) | Contributor quality metrics | Not portable, no economics |
| HN comments | Proposed "$10 deposit per PR, refunded if accepted" | Idea only — nobody built it |
Sources: https://github.com/peakoss/anti-slop · https://github.com/apps/scan-ai-slop-aislop · https://github.com/marketplace/actions/pr-slop-gate · https://github.com/marketplace/spampr · https://news.ycombinator.com/item?id=48181125 · https://www.heise.de/en/news/GitHub-introduces-measures-against-AI-slop-without-clearly-naming-the-problem-11176690.html

Takeaway: **slop detection alone is crowded and free.** Our edge is the economics + verifiability: refundable bond, maintainers paid, verdicts provable, reputation that travels, capped agent wallets. We can even *use* free detectors as extra signals in the facts block.

## Warning from history: tea.xyz
tea.xyz paid crypto for open-source "contributions" and caused floods of spam PRs (2024) and spam packages (~70% of new npm packages at one point). Maintainers associate "crypto + open source" with spam.
- PatchBond must never pay anyone for submitting. Money only flows *from* bad senders *to* maintainers (and tips decided by maintainers). No token.
- README line: "PatchBond is the opposite of tea.xyz: it makes spam cost money instead of paying for it."
Sources: https://web3isgoinggreat.com/single/teaxyz-spam · https://nesbitt.io/2026/06/11/what-happened-to-tea.html · https://www.theregister.com/2025/12/17/tea_ceo_fends_off_token_farmers/

## Prior-art checks for the edges (2026-10-28)
- Congestion pricing of maintainer attention / EIP-1559-style PR fees: nothing found (results only about Ethereum's fee market).
- Optimistic AI verdict with stake-to-challenge escalating to a stronger model: nothing found; UMA's optimistic oracle escalates to token-holder votes; arXiv 2605.30802 / 2604.15674 study LLMs as resolution layers. https://docs.polymarket.com/developers/resolution/UMA
- Agent PR quality: only offline academic merge-rate studies (e.g. arXiv 2607.21832: Claude 84.3%, Codex 73.5%; MSR 2026 33k-PR study: Codex 82.6%, Copilot 43.0%) — no live, verifiable per-agent record. https://arxiv.org/pdf/2607.21832 · https://arxiv.org/html/2601.18749v1
