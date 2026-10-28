# NEAR HACKATHON — rules we must follow

Source: https://nearhackathon.com/HACKATHON.md (read 2026-10-26). Re-read before submitting.

## Timeline (UTC)
| | |
|---|---|
| Build window opens (code allowed) | 2026-10-19 (announcement) — FAQ Q-001 |
| Submissions open | 2026-11-01 00:00 |
| Build ends / submission deadline | 2026-11-14 23:59 |
| Judging | 2026-11-16 00:00 → |
| Results by | 2026-11-18 23:59 |

## Official FAQ (from HACKATHON.md, read 2026-10-28)
- **Q-001 Code before 1 Nov?** Yes, from the announcement on 2026-10-19. Earlier commits are baseline.
- **Q-002** Existing product on another chain: allowed; only the NEAR integration built in the window is judged; disclose.
- **Q-003** New repo not required (branch or tags + README diff link).
- **Q-004** Old project as-is: no. New feature in the window: yes.
- **Q-005** Libraries, templates, boilerplate, AI code: allowed — list them in the README.
- **Q-006** 1Click JWT not required (0.2% fee without it): https://partners.near-intents.org
- **Q-007** No Intents testnet — mainnet, separate dev accounts, tiny amounts, `dry: true` quotes.
- **Q-008** Testnet NEAR free (near-cli faucet, near-faucet.io); mainnet costs not reimbursed.
- **Q-009** Public RPCs: https://docs.near.org/api/rpc/providers
- **Q-010 Testnet-only projects eligible?** Yes, all tracks. Mainnet only where the integration is mainnet-only.
- **Q-011** No mandatory integrations; own NEAR contract fitting the track is enough.
- **Q-012** Local-only demo OK with public repo + reproducible README + X video; hosted demo is a plus — keep up to 2026-11-18, ideally 2026-11-25.
- **Q-013/014** Team keeps rights; any licence (MIT fine) — add a LICENSE file; repo public through judging.
- **Q-015** One person, max 2 independent projects, each README names the other.
- **Q-016** Single payout within 30 days.
- **Q-017** Claude Code & Codex screen (reproducibility, feature verification, report, preliminary score); humans decide; a low AI score alone can't reject.

## Partners listed (docs to check before integrating)
NEAR Intents, Aurora, HOT, Rhea, meme.cooking, HEX, NEAR.AI, SVRN, Trezu, SputnikDAO, **OutLayer** (verifiable off-chain execution for NEAR contracts — candidate for our judge pipeline), GoMining.

## Registration
None. "No advance sign-up required" (NEAR announcement, 2026-10-19). One submission per team, 1–14 Nov. No wallet connection to submit — just a mainnet account address for the payout.

## Prizes and jury
- Prizes are **paid in NEAR**.
- $250K total; $55K grand prize; $10K / $3K / $2K for places 1–3 in each of 13 tracks.
- Human jury: Illia Polosukhin, Eddy Lazzarin (a16z), Mert Mumtaz (Helius), Avichal Garg (Electric Capital), Kain Warwick (Synthetix), Haseeb Qureshi (Dragonfly), Stepan Gershuni (cyber.fund).
- **AI judges: Claude Code and Codex.** They read the repo, the README and the commit history.
- Past criteria: technical implementation, design, impact, originality, sustainability.

## What we must deliver
1. A **public** GitHub repo by the deadline (the human makes it public).
2. A **public X post** from the team lead saying it was built at NEAR HACKATHON, with a demo video or screenshots (the human posts).
3. One submission (POST https://nearhackathon.com/api/applications), sent only after the human confirms the full payload. It can't be edited afterwards.

## Submission fields (no extra fields; `website` is a spam trap — never send it)
| Field | Rule |
|---|---|
| requestId | UUID, generated once, reused on retries |
| projectName | 2–80 chars, unique |
| leadName | 2–80 chars |
| email | valid, ≤160 chars, unique |
| size | `1` · `2 - 4` · `4 - 6` · `6 - 8` · `8+` |
| tracks | any of `defi thesis privacy business swarms security agents realworld games nfts memecoins social open` |
| nearAddress | mainnet account, 2–64 lowercase chars (the human's real account) |
| projectUrl | public repo URL |
| demoUrl | public X post URL |
| idea | 20–2000 chars: problem, product, how NEAR fits |
| consent | `true`, only after the team agrees to the contact notice |

Responses: 201 saved · 400 bad field · 403 closed/cross-site (don't retry) · 409 name/email taken (don't rename to dodge) · 413 too big · 503 retry later with the same requestId.

## README rules
- Readable by humans **and** AI judges.
- Say what it is, the problem, and how to try it as "do X → see Y" steps.
- No marketing language. Name every NEAR feature used and where in the code.

## Agents must never
- submit without explicit confirmation of the full payload;
- post on X or any network;
- make the repo public, push or force-push without permission;
- sign transactions, spend tokens, or deploy to mainnet;
- commit secrets or the submission payload;
- create or invent a NEAR account for the team;
- use placeholder values in the real submission;
- retry a 403, or rename the project to get around a 409.

## Tracks relevant to PatchBond (wording from the site)
- **AI Security & Defense** — "spending limits, policy engines, sandboxed wallets, reputation and scam detection. Give AI money without giving it the keys to everything." Tags: Function Call Keys, TEE Attestation.
- **Agent Economy** — "agents that earn, spend, negotiate, hire other agents and pay for APIs, compute or data."
- **Privacy & Private AI** — "confidential computation … AI that protects sensitive data." Tags: TEE, NEAR AI Cloud.
- **Social Money** — "shared budgets, programmable rewards, collective ownership and reputation-based access on top of Sputnik DAO and Trezu."
- **Open Innovation** — "Something we haven't seen."
