# Judging in OutLayer: the server leaves the loop

Without OutLayer, PatchBond's server gathers the PR, computes the facts and builds the prompt; the
contract then refuses any AI forfeit that NEAR AI's enclave didn't sign (a maintainer's forfeit is a disputable proposal — see [TRUST.md](TRUST.md)). That still leaves one thing to
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
the enclave. The oracle can still refund (the safe direction), and maintainers keep their disputable
proposal. **It is on for the live testnet contract since 1 Nov 2026**; the pinned build is `13d05fdc…` since 5 Nov (`cfcd8707…` from 3 Nov, `eb3baa69…` before).

**Disputes are re-judged in the enclave too.** While a verdict is challenged, the contributor and the
maintainer each post up to two statements on-chain (`add_statement`, signed by their own wallets).
Then anyone calls `rejudge_in_tee`: the enclave fetches the PR again, sends the stronger model
(`get_rejudge_model`) the PR, the challenged verdict and those statements, and the contract checks
NEAR AI's signature before it settles — the model's enclave key, or the gateway key registered for
that one model. The rule is the server's: a disputed *maintainer* forfeit stands only if the stronger
model itself signs a forfeit above the repo's threshold with evidence; an AI verdict also needs the
rules (a hard fact) to agree. Otherwise, refund. The re-judge request is byte-identical to the
server's (`outlayer/judge/tests/rejudge.rs`). Kimi K3 is the intended re-judge model; while NEAR AI
reports it unavailable, testnet uses GLM-5.3 (one owner call to switch back).

**Live on testnet, 2 Nov 2026** (our own test, not an outside user): [PatchBond/demo-widget#2](https://github.com/PatchBond/demo-widget/pull/2)
is a deliberately poor PR — it calls `acquireLockSafe` from a file that doesn't exist (CI fails), adds
no test and puts hype in the README. The contributor paid a $1 bond
([tx](https://testnet.nearblocks.io/txns/Fva33moq5uuQaUQYuAkGT1wQcov6U3hNb1XxedWpEq3W)), the maintainer
proposed a forfeit ([tx](https://testnet.nearblocks.io/txns/C6LTnkD2WmuUx5wUKgVDucvsKcAk7XikLchzMQWKHNvS)),
the contributor disputed it for free ([tx](https://testnet.nearblocks.io/txns/2cBKmi95kJ6yK2uMo9q2KiGNhyRBmAerdMchrKRiS7C7)),
both sides posted a statement on-chain, and `rejudge_in_tee`
([tx](https://testnet.nearblocks.io/txns/HV68yEs15FLQntpUJcfrHV9g4qVBbUMi5Dv8wTH9WaHP)) ran build
`eb3baa69…` in OutLayer (9.4 s, 0.0021 NEAR). The contract checked GLM-5.3's gateway signature
(`tee_verified`, signer `0xb98a…e779@z-ai/glm-5.3`) and settled the forfeit: $0.90 to the repo's vault,
$0.10 to the treasury. No PatchBond server call decided it.

**Bounties are paid on the enclave's check too.** A forfeit on a PR that claimed to fix #N is a
bounty on #N. Anyone calls `claim_bounty_in_tee(repo_id, issue, fix, recipient)`; the enclave runs
in "bounty" mode — no model, just GitHub — and answers `fix_ok` only if PR `fix` is merged into this
repo, its title or body says it fixes #N, and it's bound to `recipient`: if the fix had a bond, its
author must be the GitHub user that bond named (and the contract only lets the bond's payer be the
recipient); otherwise the PR's description must name the account on a line of its own,
`PatchBond: alice.near`. The contract checks the answer is about exactly this claim, then pays.
What's trusted here is OutLayer's attested worker running the pinned wasm, and GitHub — there's no
model signature, because nothing is judged. A repo's admins can edit a PR's description, so the
payout line is only as trustworthy as they are (they could also have kept the forfeit by not
linking an issue). With `exclusive` on, `pay_bounty` (the oracle's route) is refused.

**The two-step forfeit, live, 6 Nov 2026** (our own test PR, [demo-widget#5](https://github.com/PatchBond/demo-widget/pull/5): it imports a module that doesn't exist, so CI fails, and its description claims tests and README changes that aren't in the diff). The payer, `patchbond-e2e.testnet`, called `judge_in_tee` ([tx](https://testnet.nearblocks.io/txns/64nTqptKEPjAYLhqFBvs4V9EerMQvFLZACRHQVed3qzf)) on build `13d05fdc…`. The contract verified NEAR AI's signature and stored `forfeit_pending` with the PR's head commit `737e6b1`, and the $3 bond didn't move. A third account, `patchbond-e2e-fund.testnet`, then posted the signed bytes with `confirm_tee_forfeit` ([tx](https://testnet.nearblocks.io/txns/6qn3VuFZW1AX8nkSJN5ksiVL1Pry5Z3MsDAKy711fiAc)). The contract checked them against the stored hashes and the commit, read the forfeit from them, and only then settled: $2.70 to the repo's vault, $0.30 to the treasury ([public verdict](https://patchbond-production.up.railway.app/v/2ea3fd344e767358)). Neither call came from our oracle or server.

The run also found an outage. The NEAR AI key the enclave used had hit its $10 spend limit, so three earlier attempts on #5 came back `not_judged`. The bond stayed held each time, and the job cleared so it could be asked again. The key has since been replaced.

**Live on testnet, 3 Nov 2026** (our own test PRs on [PatchBond/demo-widget](https://github.com/PatchBond/demo-widget), not outside users):
[#3](https://github.com/PatchBond/demo-widget/pull/3) claimed to fix #1 but calls a `MutexPool` that
doesn't exist (CI fails). Its bond was **$2, not $1** — the payer already had a forfeit, so the
contract doubled their price. `judge_in_tee` ([tx](https://testnet.nearblocks.io/txns/DF6RznwH6BAoaYDc7g5ZpmGKiKp1LM7DqQTKYNmvv2e3))
ran build `cfcd8707…`; GLM-5.3-flash signed a forfeit, the contract checked the signature against
NEAR AI's enclave key and settled it ([public verdict](https://patchbond-production.up.railway.app/v/b77581d382460ebf)):
$1.80 became a bounty on #1. The real fix, [#4](https://github.com/PatchBond/demo-widget/pull/4)
(regression tests, one of which fails on the old code), was merged with `PatchBond: tester1604.testnet`
in its description. `claim_bounty_in_tee` ([tx](https://testnet.nearblocks.io/txns/Hd48Ju7spyayYof8mqo1H7424rrHn5ax8LXPFg99WbkB))
had the enclave confirm the merge on GitHub, and the contract paid **$1.80 to `tester1604.testnet`**.
Neither step was decided by a PatchBond server call.

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
The build the live contract trusts is `13d05fdc…`: `git checkout fab1e14 && bash outlayer/judge/build.sh`
prints `13d05fdc42ea9264eddc255c9eac9333bdf42556aef62eb941abe8ba9e3a07d8` (Rust 1.97.1). The earlier
`cfcd8707…` is the same command at `e31f6f4`, and
`eb3baa69…` is the same command at `a448538`. Compare with `get_outlayer` on `patchbond-dev.testnet`.

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

- **The enclave's answer itself.** The contract recovers NEAR AI's signature over the request and
  response hashes, but never sees those bytes: verdict, confidence and evidence are fields the wasm
  reports, and the contract gets no proof of which code ran. A compromised worker could pair a
  genuine unused signature with a false "forfeit". Exact checks:
  [docs/TRUST.md](TRUST.md#what-the-outlayer-callbacks-verify).
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

### Live on testnet (2026-10-31)

Enclave build `a2ecc8b3…b8d3` ([pinned URL](https://raw.githubusercontent.com/PatchBond/patchbond/bb2665d1b2e25a79552bacaf613e60ec30fc1dfb/outlayer/judge/dist/patchbond-judge.wasm)), contract repointed (`HhamFKtQ…`), enclave key published by the enclave itself (`6953UiuF…`, key `d21c0735…6e1b`). Two reports sent to `PatchBond/patchbond` (repo 1437287131):

| Report | Facts the enclave computed | Verdict (GLM-5.3-flash, signed) |
|---|---|---|
| **Real:** rate limits keyed on the client-controlled first `X-Forwarded-For` entry, with curl steps | cited files exist, no phantom code, has reproduction | **refund** — "concrete, checkable claim … includes a step-by-step reproduction" |
| **Made up:** "critical RCE" in `src/payments/withdraw_handler.py` and `contract/vault/src/escrow_v2.rs` | both files missing | **forfeit** — "both cited files do not exist in the repository" |

The public saw only the two verdicts. The maintainer decrypted both reports and the judge's reasons, and the sealed request/response bytes matched NEAR AI's signature. The real report was real: `visitorOf()` now uses the proxy-appended last entry ([`judgeBudget.ts`](../server/src/judgeBudget.ts)).
