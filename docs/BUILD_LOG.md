# Build log

How PatchBond was built, for judges reading the commit history. One person built it during the hackathon window (opened 2026-10-19), directing AI coding assistants and reviewing their work. No earlier code, no templates.

## Why so many commits on day one

There are about 50 commits on 2026-10-28. The design came first: the very first commit is the spec, the research notes and a labelled evaluation set (`docs/SPEC.md`, `docs/RESEARCH.md`, `docs/eval/candidates.json`), with no code. After that, the work went fast because:

- **The spec was detailed before any code existed.** Every contract method, money path and judge rule was written down first, so implementation was mostly translation.
- **AI assistants wrote most of the first drafts**, in parallel across the contract, the server, the web app and the MCP server. Each draft was reviewed, run and tested before it was committed. The README lists the libraries and says this too (rule Q-005).
- **Commits are small on purpose.** One change per commit, with a message that says what it does, so the history can be read and checked.

## How the work was checked

- **Tests before claims.** Every money path has a sandbox test with real token transfers (`contract/vault/tests/`). The judge has fixtures from real PRs (`server/test/`, `docs/eval/`). The enclave program is checked byte-for-byte against the TypeScript judge (`outlayer/judge/tests/parity.rs`).
- **Real runs on testnet.** One end-to-end run made 62 real testnet transactions ([report](e2e/testnet-report.md)). The OutLayer enclave and sealed reports were tested live, with transaction hashes in [OUTLAYER.md](OUTLAYER.md).
- **Outside reviews, acted on.** Several AI models were asked to judge the submission harshly. Their findings were fixed and are listed below.
- **Live users found real bugs.** Each one was fixed and given a test:
  - an empty PR was refunded (CivicLedger #60): an empty change is now a hard fact;
  - a maintainer's correct forfeit was overturned on dispute (CivicLedger #61): a disputed maintainer forfeit now stands if the stronger model also signs a forfeit;
  - a sealed security report sent to our own repo found a rate-limit bypass through a spoofed `X-Forwarded-For` header, now fixed.

## Timeline

| Date | What landed |
|---|---|
| 28 Oct | Design, research and labelled eval set first (no code), then the vault contract (bonds, curve, refund/forfeit, challenges, agent budgets, reputation), NEAR AI judge, GitHub App bot, web app, MCP server, NEAR bonds (wNEAR), gasless USDC (NEP-366), testnet deploy, first full testnet e2e, first video cut |
| 29 Oct | On-chain checks of NEAR AI's TEE signatures, maintainer safeguards, hosted service on Railway, live README numbers |
| 30 Oct | OutLayer: the judge as a Rust wasm program in Intel TDX, called by the contract; nearcore case study; maintainer guide; testnet faucet; sealed security reports; dispute fixes from live users; agent spending policy |
| 31 Oct | Sealed reports live on testnet; enclave key published by the enclave; per-payer queue cap (one payer can't price out newcomers); fixes and wording from the review |
| 1 Nov | Signed forfeits bound to their repo and PR (replay closed); full testnet e2e re-run on today's contract (62 transactions, all passed); public /stats page; "Who pays" economics; disputes re-judged in the enclave (`rejudge_in_tee`, on-chain statements) and `exclusive` turned on for testnet |

## Findings from review, and what was done

| Finding | Done |
|---|---|
| Test counts in the README and deck were out of date | Updated from a fresh run; the README says which command gives which count |
| One payer could flood the queue and raise the bond for everyone | Each payer counts at most 2 toward everyone else's price ([queue.rs](../contract/vault/src/queue.rs)), with a sandbox test |
| "0 of 35 genuine forfeited" counted 20 unlabelled nearcore PRs as genuine | Now reported separately, next to the other side: 0 of 15 labelled slop forfeited by the AI |
| A genuine signed forfeit could be replayed against a different PR (the contract checked the signature, not which PR it was about) | The contract now checks the signed request names this repo and PR and accepts each signature once; sandbox test and demo line show a replay refused; live on testnet |
| Absolute wording ("can't touch the money", "no custodian", "server isn't in the loop", "only the maintainer can read it") | Changed to say exactly what holds: the upgrade key, whether `exclusive` is on (it is on testnet since 1 Nov, once disputes could be re-judged in the enclave), and the enclave and NEAR AI seeing a sealed report while judging it |
