# Reproduce it

Everything here works from a clean clone on macOS or Linux.

## Run it yourself

**Maintainers:** try it on your repo in 10 minutes — **[docs/MAINTAINERS.md](MAINTAINERS.md)** (testnet, no real money).

**Fastest:** open the [live demo](https://patchbond-production.up.railway.app), press ⌘K, paste any public PR URL, then **Verify signature** on the verdict.

**The whole money story in one command** — no wallet, no keys, no GitHub. `bash scripts/demo-fast.sh` runs the release bundle with nothing to compile, and builds from source by itself when no bundle is published for your system; to build from source directly (needs Rust + `cargo-near`, 9.5 minutes from a clean clone on 8 cores):

```bash
git clone https://github.com/PatchBond/patchbond && cd patchbond && bun install && bun run demo
```

A local NEAR sandbox runs the real contract with real token transfers: a real PR's bond refunded; our own server **refused** a forfeit with no signature, a tampered one, and a genuine NEAR AI signature on a *refund*; then **NEAR AI's own enclave-signed forfeit** pays the maintainer 90%; the oracle can't withdraw the vault, the maintainer can; one account's 16-PR flood prices *its own* bonds from $0.77 to $4.56 while a newcomer still pays $0.98; and an OutLayer enclave verdict recovered on-chain to NEAR AI's GLM key. [Sample output](demo-output.txt).

If the NEAR sandbox download times out, download the binary yourself and set `NEAR_SANDBOX_BIN_PATH` to it.

**Contract tests stalling, or a sandbox that can't write outside the repo?** `bash scripts/test-contract.sh` builds the three contracts once and runs every contract test one at a time against those builds, writing nothing outside the repo (`cargo near`'s config goes under `contract/target/`). On an M-series Mac: 81 passed, 5 upgrade replays ignored, about 17 minutes. One suite: `bash scripts/test-contract.sh --test screening`.

From a clean clone (macOS or Linux). **Prerequisites:** [Bun](https://bun.sh) ≥ 1.4, Rust stable with `wasm32-unknown-unknown`, [`cargo-near`](https://github.com/near/cargo-near) ≥ 0.22; optionally `near-cli-rs` and `gh`.

```bash
git clone https://github.com/PatchBond/patchbond && cd patchbond
bun install
cp .env.example .env          # testnet by default; set NEARAI_API_KEY + JUDGE_MODE=nearai for the live TEE judge
```

| # | Do | See |
|---|---|---|
| 1 | `bun run typecheck && (cd shared && bun test) && (cd server && bun test) && (cd mcp && bun test)` | All TypeScript tests pass — judge facts and rules, the malicious-code scan, the GitHub bot against a fake GitHub, maintainer sign-in and NEP-413 linking, the MCP server over real stdio. |
| 2 | `cd contract && cargo near build non-reproducible-wasm --manifest-path vault/Cargo.toml && cargo near build non-reproducible-wasm --manifest-path mock-ft/Cargo.toml && cargo near build non-reproducible-wasm --manifest-path mock-outlayer/Cargo.toml && cargo test -p patchbond-vault` | All contract tests pass on a local NEAR sandbox with real token transfers — every money path in USDC and NEAR, challenges, maintainer safeguards, a real function-call key, TEE proofs with **genuine NEAR AI signatures**, and the OutLayer callback verifying a real enclave run. |
| 3 | `bun run --cwd server judge-pr https://github.com/tj/commander.js/pull/2637` | A **refund** with reasons and facts (set `GITHUB_TOKEN` to avoid GitHub's 60-requests-an-hour limit). Without a NEAR AI key the output says `"mock": true` — its signature is from a local key, proving only the pipeline, not NEAR AI's TEE; `…/OWASP/Nettacker/pull/1787` → **needs_human** (failing CI). With a NEAR AI key it's TEE-signed (~$0.0004); without one the same pipeline runs offline with a local key. |
| 4 | `bun run dev`, open <http://localhost:5317> | Drag the bond curve, **Simulate a spam wave**, ⌘K → judge a PR → **Verify signature** in the browser. |
| 5 | With test USDC from [faucet.circle.com](https://faucet.circle.com) ("Near Testnet") or test NEAR from [near-faucet.io](https://near-faucet.io), and a Meteor or Intear wallet: `/pay/1/1?repo=PatchBond/playground&user=YOUR_LOGIN` (or `/pay/2/1?repo=PatchBond/playground-near&user=…` for NEAR) | Pay a real bond into [`patchbond-dev.testnet`](https://testnet.nearblocks.io/address/patchbond-dev.testnet) at the live on-chain quote. |
| 6 | `bun run --cwd server e2e:testnet` (needs a funded testnet account) | Real testnet transactions — each money path, a gasless bond, an agent via MCP, NEAR via the real `wrap.testnet` — then every account is deleted. [Last report](e2e/testnet-report.md), one explorer link per transaction. |

**Coding agents (MCP):** `claude mcp add patchbond -e PATCHBOND_API=https://patchbond-production.up.railway.app -- bun "$PWD/mcp/src/index.ts"`. Read-only tools work with no wallet (`patchbond_policy`, free `patchbond_preflight`, `patchbond_status`, `patchbond_reputation`); `patchbond_deposit` pays with a function-call key limited to `deposit_from_budget` — **the server refuses to start with a full-access key**. Setup is on the app's **Agents** page.

## Running your own

**Host the app** (one Docker service: site, API, webhook, sign-in): [docs/DEPLOY.md](DEPLOY.md). **Your own contract:** `cd contract/vault && cargo near deploy build-non-reproducible-wasm <account> with-init-call new json-args '{"owner":"…","oracle":"…","treasury":"…","token":"<USDC>","wnear":"wrap.near"}' …`, register it with USDC and wNEAR (`storage_deposit`), register NEAR AI's attested keys with `set_tee_signers`, and write the accounts to `deploy/<network>.json`. Then `bun run dev`, open `/setup` and click **Create on my GitHub account** — the App is created from a manifest and its credentials saved to `.env`. Everything network-specific comes from `deploy/<network>.json` and `.env`.
