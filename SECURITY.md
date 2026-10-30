# Security

PatchBond holds other people's money and accuses people of wasting time, so both the contract and
the judge are built to fail safe: **funds can't be taken by us, and when in doubt the contributor
is refunded.** This page states what each key can and cannot do, the protections in place, and the
known limits — honestly.

Report a vulnerability privately to the maintainers via a GitHub security advisory on
[PatchBond/patchbond](https://github.com/PatchBond/patchbond/security/advisories/new). Please
don't open a public issue.

## Who can do what

| Key | Can | Cannot |
|---|---|---|
| **Repo payout account** (the maintainer, or their DAO) | Withdraw its own vault; change its bond policy; refund any deposit at once; *propose* a forfeit (48 h, disputable for free, re-judged); hand the repo to another account (`set_payout`) | Touch other repos; forfeit a bond on its own say-so; overrule an AI refund without a staked challenge; decide a dispute or a challenge it raised; shorten the 48 h dispute window |
| **Oracle** (our server) | Register repos; link an **unlinked** repo after GitHub sign-in + a NEP-413 wallet proof; propose verdicts; resolve challenges; mark reviews; pay bounties to merged fixes | Withdraw any vault; relink a repo that already has a payout account; move funds to itself |
| **Owner** | Rotate oracle and treasury; withdraw the 10% treasury balance to the treasury account; pause **new** deposits | Touch vaults, deposits, bounties, budgets or claims; block refunds or withdrawals |
| **Agent function-call key** | Call `deposit_from_budget` on the PatchBond contract, within the budget's daily cap | Attach tokens; call any other method or contract; withdraw or raise its own budget |
| **Anyone** | Pay a bond; finalize a verdict whose challenge window passed; stake a challenge (payer on a forfeit, maintainer on a refund) | Fake a deposit (`ft_on_transfer` only accepts the configured USDC contract) |

## Protections (each has a test)

- **Vault isolation** — only the linked payout account withdraws; owner and oracle are refused. ([money_paths.rs](contract/vault/tests/money_paths.rs))
- **Link once** — a stolen oracle key can't redirect a linked vault; only the current payout account hands it over. (`a_stolen_oracle_key_cannot_redirect_a_linked_vault`)
- **Linking needs two proofs** — GitHub admin rights (re-checked at the moment of linking) and a NEP-413 signature by a *full-access* key of the payout account; challenges are single-use and expire in 10 minutes; OAuth is CSRF-protected. ([maintainers.test.ts](server/test/maintainers.test.ts))
- **No lost or created money** — every payout's callback books the amount back (vault, treasury, budget or claimable) if the transfer fails; book-keeping happens before transfers. The split of every settlement is a pure function checked on 50,000 random cases; the testnet e2e checks conservation across all accounts. ([settle.rs](contract/vault/src/settle.rs), [testnet report](docs/e2e/testnet-report.md))
- **Pause** — the owner can stop new bonds, challenges and budgets during an incident; refunds, settlements, withdrawals and claims keep working. (`pause_stops_new_money_but_never_refunds`)
- **Storage griefing** — every stored record is paid for by real money: bonds (≥ the repo's minimum), challenges (= the bond) and new budgets (≥ 1 USDC). (`a_penny_budget_is_refused`)
- **Griefing a PR** — a deposit paid for someone else's PR is voided (full refund, no reputation effect) and the real author can still pay.
- **Agent keys** — the MCP server checks the key on-chain and refuses full-access keys or keys that can call anything but `deposit_from_budget`. ([mcp.test.ts](mcp/test/mcp.test.ts))
- **The judge can't forfeit on its own** — a forfeit needs confidence ≥ the repo's threshold, concrete evidence and a hard fact (failing CI, phantom code, a duplicate or injection). Contributor text is fenced as untrusted, our tags are neutralised, and output must match a strict schema. A failed lookup is never an accusation. ([judge.test.ts](server/test/judge.test.ts))
- **Optimistic verdicts** — AI verdicts stand only after a challenge window; either side can stake to force a re-judge.
- **Relayer** (gasless bonds) — forwards exactly one thing: USDC `ft_transfer_call` into PatchBond with a bond or challenge msg, 1 yocto, ≤150 Tgas, one per account per 10 s; anything else is refused before it spends gas. ([relayer.test.ts](server/test/relayer.test.ts), testnet e2e stage 7b)
- **Webhooks** are HMAC-verified; forged deliveries are rejected. ([bot.test.ts](server/test/bot.test.ts))

## Trust assumptions and known limits

- **The oracle is trusted for GitHub facts** (who is an admin, PR state, CI results), because a contract can't read GitHub. A compromised oracle could propose wrong *refunds* — mitigated by the challenge window and the public record — but it **cannot forfeit** without NEAR AI's TEE-signed response saying so (checked on-chain in `contract/vault/src/tee.rs` against the enclave keys in NEAR AI's attestation report, registered by the owner), and it cannot withdraw or redirect a linked vault.
- **The AI verdict is independently verifiable** — the TEE signature over the exact bytes is checked in the browser and, for every forfeit, inside the contract (`ecrecover`, `tee.rs`).
- **Removing the oracle from judging** — with OutLayer configured, `judge_in_tee` runs the whole judge (GitHub fetch, facts, prompt, NEAR AI call, rules) in an Intel TDX enclave, and with `exclusive` the oracle can't forfeit at all. What's then trusted is OutLayer's worker registration (TDX quotes checked on-chain against an allowlist its admins control), GitHub, and NEAR AI's enclave keys. See [docs/OUTLAYER.md](docs/OUTLAYER.md).
- **Upgrades** — the contract account's key (held by the team) can redeploy the code. That is normal for a hackathon deployment and is how the v0.1 → v0.2 `migrate` ran on testnet. For a production mainnet deployment the plan is to move upgrades behind a DAO with a time lock, or remove the key.
- **Storage** — the contract pays NEAR for storage out of its own balance; the floors above make griefing it cost more than it does.
- **Reputation** is per NEAR account; a determined spammer can make new accounts — and could farm the "proven" exemption (3 refunds on 2 repos) with trivial PRs to repos they control. Planned: count refunds only from repos with an outside, linked maintainer, and let repos opt out of the global exemption. That's why the bond, not reputation, is the defence: every new account pays the full, queue-priced bond.
- Not audited. It is hackathon software: read the code and the tests.
