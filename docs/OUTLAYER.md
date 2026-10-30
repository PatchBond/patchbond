# Judging in OutLayer: the server leaves the loop

Without OutLayer, PatchBond's server gathers the PR, computes the facts and builds the prompt; the
contract then refuses any forfeit that NEAR AI's enclave didn't sign. That still leaves one thing to
trust: **the server chooses what the model sees.** A dishonest server could feed it a fake "CI
failed" and get a genuinely signed forfeit.

With OutLayer, nobody's server is in the path:

```
anyone ──judge_in_tee(repo, pr) + ~0.01 NEAR──▶ PatchBond vault ──request_execution──▶ outlayer.testnet
                                                    ▲                                     │ yield
                                                    │ on_tee_judgment (≤900 bytes)         ▼
                                                    └──── OutLayer worker (Intel TDX) runs outlayer/judge:
                                                           GitHub API → facts → prompt → NEAR AI (TEE)
                                                           → rules → verdict + NEAR AI signature
```

1. **The contract writes the input** — repo id, PR number, the GitHub login the bond was paid for,
   the payer's reputation, the repo's threshold, the model. Nothing from our server.
2. **The enclave program** ([`outlayer/judge`](../outlayer/judge)) fetches the PR, diff, files, check
   runs, open PRs, CONTRIBUTING.md, `.github/patchbond.yml`, the linked issue and the base tarball
   from GitHub itself, computes the same facts as the server, asks NEAR AI, applies the same rules.
   It refuses a PR whose author isn't the GitHub user the bond was paid for, and answers "wait"
   while CI is running.
3. **The callback checks the second enclave itself**: it recovers NEAR AI's signature over
   `<model>:<sha256(request)>:<sha256(response)>` with `ecrecover` and requires a registered enclave
   key, then computes the verdict hash itself. A forfeit still needs the model's *own* signed
   forfeit, above the repo's threshold, with evidence — the same bar as before.
4. **The full record** (exact request and response bytes) is posted to `record_url`; our server
   publishes it only if it verifies and its hash equals the one the contract stored
   (`get_tee_job`). Whoever hosts it can't alter it.

One enclave judgment per deposit — no re-rolls until a good answer comes out. A failed or "CI still
running" run clears the job so anyone can ask again; NEAR that OutLayer refused comes back.

**`exclusive: true`** turns the oracle's forfeit power off entirely: forfeits then come only from
the enclave. The oracle can still refund (the safe direction), a challenged verdict that the
stronger model re-judges then resolves as a refund (when in doubt, refund), and maintainers keep their
48 h disputable proposal.

## Same bytes as the server — proven

`outlayer/judge` is a Rust port of `server/src/judge/` (facts, malicious-code scan, prompt, rules,
verdict hash), with JavaScript's regex and string semantics emulated where they differ from Rust's
(`src/js.rs`). The parity test replays **30 real PRs from the labelled set** × 2 reputations and
checks the facts, the **exact NEAR AI request bytes**, and the final verdict + verdict hash for six
model answers each against the TypeScript judge:

```bash
cd outlayer/judge && cargo test                       # parity: 30 PRs, >300 decisions, byte for byte
GITHUB_TOKEN=$(gh auth token) bun server/scripts/make-outlayer-fixtures.ts   # regenerate fixtures
```

A real run (wasmtime, real GitHub, real NEAR AI) on tcpdump#1471: 16 GitHub calls + an 8 s tarball +
10 s of model, **50 s, <20 B instructions, 557-byte answer**, signed by NEAR AI's GLM enclave key
`0x3b75…fa0c`. That output is the `genuine` fixture in
[`contract/vault/tests/outlayer.rs`](../contract/vault/tests/outlayer.rs), verified on-chain in the
sandbox.

## Reproducible build

```bash
bash outlayer/judge/build.sh     # → dist/patchbond-judge.wasm and its sha256
```

Local paths are stripped, so the same source, `Cargo.lock` and Rust toolchain (1.97) give the same
hash. The contract pins that hash (`version_key`); OutLayer's worker refuses bytes that don't match.

## Turning it on (testnet)

Steps 1–3 sign with dev accounts on testnet; step 2 hands secrets to OutLayer, so a human does it.

1. **Host the wasm** at any https URL (the hash is what's trusted, not the host). FastFS:
   `bun server/scripts/outlayer-upload.ts outlayer/judge/dist/patchbond-judge.wasm patchbond-dev.testnet`
   (test.fastfs.io was returning 502 on 2026-10-30), or the GitHub raw URL of the committed
   `outlayer/judge/dist/patchbond-judge.wasm` at a commit.
2. **Create the project and its secrets** at https://outlayer.ai (or `outlayer deploy judge <url>`):
   project `patchbond-dev.testnet/judge`, WasmUrl source, build target `wasm32-wasip2`. Secrets
   profile `judge` with `NEARAI_API_KEY` (and optionally a read-only `GITHUB_TOKEN` for rate limits),
   access condition `Predecessor{Whitelist[patchbond-dev.testnet]}` so only the vault can relay.
3. **Point the contract at it** (owner):
   ```bash
   near contract call-function as-transaction patchbond-dev.testnet set_outlayer json-args '{"config":{
     "account":"outlayer.testnet","project_id":"patchbond-dev.testnet/judge",
     "version_key":"<sha256 from build.sh>","model":"z-ai/glm-5.3-flash",
     "record_url":"https://patchbond-production.up.railway.app/api/tee-records",
     "secrets_owner":"patchbond-dev.testnet","secrets_profile":"judge","exclusive":false}}' \
     prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as patchbond-dev.testnet network-config testnet sign-with-legacy-keychain send
   ```
4. **Run the bot in enclave mode**: `JUDGE_RUNNER=outlayer` on the server. It then asks the contract
   to judge each paid PR once CI is done (`judge_in_tee`, 0.02 NEAR attached, the unused part
   refunded) and announces the record the contract accepted.

Anyone can also call `judge_in_tee` themselves — the contributor, the maintainer, a watcher.

## What's still trusted

- **OutLayer's registration of workers**: its register contract verifies each worker's TDX quote
  (Intel DCAP) and measurements against an allowlist OutLayer's admins control. Per-run attestation
  is checked off-chain (`outlayer-verify`, the dashboard).
- **GitHub** for what a PR contains and what CI said — as for every maintainer.
- **NEAR AI**'s enclave key registration (`set_tee_signers`, from NEAR AI's attestation report).

## Sealed security reports

AI-written "vulnerability" reports that cite code which doesn't exist are drowning maintainers
(curl moved low-severity reports public to cope). PatchBond lets a repo take reports **sealed**:

1. **Two keys.** The maintainer's X25519 key is derived from a wallet signature (sign the same
   message again, get the same key — nothing to store) and registered on-chain with
   `set_report_key` by the repo's payout account. The enclave's key is derived from
   `PROTECTED_REPORT_KEY`, a secret **OutLayer generates inside the TEE** — no person ever sees it;
   the pinned program publishes the public half via `refresh_enclave_key` → `get_enclave_key`.
2. **Sealed in the browser** (`shared/src/sealed.ts`, X25519 → HKDF-SHA256 → ChaCha20-Poly1305) to
   both keys. PatchBond's server stores ciphertext only.
3. **The bond is bound to the ciphertext**: `ft_transfer_call` with
   `{"action":"report", repo_id, number, sealed_sha256, reporter}`; `judge_report_in_tee` refuses any
   other envelope.
4. **The enclave** (`outlayer/judge/src/report.rs`) opens the report, checks the files and calls it
   cites against the repo's real tree and identifiers, asks NEAR AI, applies rules (a forfeit needs
   the model's confident forfeit, evidence, and cited code that doesn't exist or prompt injection),
   and answers through the same callback as PRs — the contract checks NEAR AI's signature.
5. **The public sees** the verdict, the signature and the verdict hash. The request, response and
   reasons are **sealed to the maintainer**, who decrypts them in the dashboard and checks they match
   what NEAR AI signed.

Proof: `outlayer/judge/tests/sealed.rs` opens what the browser sealed; `tests/report.rs` (rules);
`contract/vault/tests/sealed_reports.rs` (keys, binding, settlement with a genuine NEAR AI
signature). A real wasmtime run on this repo forfeited a made-up report ("`vault_emergency_drain()`
in `contract/vault/src/admin_override.rs`") at 0.85.

**Setup (once):** add `PROTECTED_REPORT_KEY` (auto-generated, hex32) to the OutLayer secrets
profile; deploy the new program version; call `refresh_enclave_key` (≈0.01 NEAR). Then each
maintainer turns reports on in the dashboard → **Security reports**, and links
`/report/<repo_id>` from their SECURITY.md.
