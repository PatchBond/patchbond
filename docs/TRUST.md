# Who can move money, and who can change the rules

What the live testnet contract (`patchbond-dev.testnet`, config in [`deploy/testnet.json`](../deploy/testnet.json))
enforces today, method by method, and what each guarantee still rests on. Live config: OutLayer
`exclusive` **on**, enclave build `cfcd8707…` pinned. Every row names the code that enforces it.

## Roles

| Role | Account (testnet) | Can |
|---|---|---|
| **Owner** | `patchbond-dev.testnet` | Register NEAR AI keys (`set_tee_signers`), configure OutLayer and turn `exclusive` on or off (`set_outlayer`), set the dispute model, rotate the oracle and treasury, pause new deposits, withdraw the treasury's 10%. **Holds the contract account's full-access key, so it can also deploy new code.** It can't withdraw a repo's vault or a held bond with any method in the current code. |
| **Oracle** | `patchbond-oracle.testnet` | Register a repo, link an *unlinked* repo to a payout account (once), set its name (once), propose AI **refunds**, mark a PR reviewed (tip → vault), pay a bounty **only if `exclusive` is off**. With `exclusive` on it can't forfeit. |
| **Repo's payout account** | set by `link_repo` | Withdraw the vault, set the bond policy, hand the repo to another account (`set_payout`), propose a forfeit (disputable), refund any bond. |
| **Payer** | whoever paid the bond | Dispute a maintainer's forfeit for free, stake to challenge an AI verdict, post statements. |
| **Anyone** | — | Ask the enclave to judge (`judge_in_tee`), re-judge a dispute (`rejudge_in_tee`), check a bounty claim (`claim_bounty_in_tee`), finalize after a window. Paying for the run gives no say in the result. |

## Every way a bond or bounty moves

| Path | Who triggers it | What the contract requires | Still trusted |
|---|---|---|---|
| **Refund** (AI or oracle) | Oracle, or the enclave's callback | Nothing beyond the role — giving money back is the safe direction ("when in doubt, refund") | The oracle not refunding slop (which would cost maintainers, not contributors) |
| **AI forfeit, enclave route** | Anyone → `judge_in_tee` → OutLayer callback | The model's own signed forfeit ≥ repo threshold with ≥1 evidence item, signature recovered on-chain to a registered NEAR AI key, from the pinned wasm, each signature once ([`outlayer.rs`](../contract/vault/src/outlayer.rs)). Proposed for the repo's challenge window (0 on demo-widget) | OutLayer's attested worker running the pinned wasm; GitHub's answers; NEAR AI's keys as registered by the owner |
| **AI forfeit, oracle route** | Oracle → `settle` | **Refused while `exclusive` is on** (live). When off: a NEAR AI signature on a request naming this repo and PR, each signature once ([`settle.rs`](../contract/vault/src/settle.rs), [`tee.rs`](../contract/vault/src/tee.rs)) | When off: the oracle chose the request bytes, so it could feed the model a fabricated diff under the right name (detectable — every request is published) |
| **Maintainer forfeit, not disputed** | Payout account → `settle(forfeit)`, then anyone → `finalize` after 48 h | **No model signature.** A 48 h proposal; a penalty is escrowed from the repo's vault in case it's overturned; the maintainer's forfeit and dispute counts are public | **The maintainer's honesty, and the payer noticing within 48 h.** This is the one forfeit path without a signature |
| **Maintainer forfeit, disputed** | Payer → `dispute` (free), then anyone → `rejudge_in_tee` | The stronger model's own signed forfeit ≥ threshold with evidence, recovered to a key registered *for that model*, each signature once ([`rejudge.rs`](../contract/vault/src/rejudge.rs)). Otherwise refund, and the maintainer pays a penalty | Same as the enclave route. A human already decided, so the AI's hard-fact rule isn't required here — by design |
| **Staked challenge of an AI verdict** | Either side stakes → `rejudge_in_tee` | The stronger model's signed forfeit **and** the rules (a hard fact) for a forfeit; the loser's stake goes to the other side | Same as the enclave route |
| **Bounty** | Anyone → `claim_bounty_in_tee` | The enclave confirms on GitHub: the fix is merged into this repo, its title or body says it fixes #N, and it's bound to the recipient — the bond's payer (author = the bond's GitHub user), or a `PatchBond: <account>` line in the PR ([`bounty.rs`](../contract/vault/src/bounty.rs), `check_fix` in [`lib.rs`](../outlayer/judge/src/lib.rs)). Paid once; the oracle's `pay_bounty` is refused while `exclusive` is on | **The maintainer's merge decision** — the enclave checks the PR was merged and claims the issue, not that the issue is really fixed. Repo admins can edit a PR description, so the payout line is as trustworthy as they are |
| **Tip** | Oracle → `mark_reviewed` | Review within the window → vault, else refunded | The oracle's report that a maintainer reviewed (from GitHub's review event) |
| **Withdraw a vault** | Payout account only | `predecessor == payout` | — |
| **Agent spending** | The agent's function-call key → `deposit_from_budget` | Daily cap, most per bond, allowed repos, frozen flag — all in the contract ([`budget.rs`](../contract/vault/src/budget.rs)) | The owner's policy |

## What a compromised party could do

| If this is compromised | It could | It couldn't |
|---|---|---|
| **Oracle key** | Refund bonds; link a repo that **nobody has linked yet** to itself, then propose (disputable) maintainer forfeits there; mark PRs reviewed so tips go to vaults | Forfeit through its own route (`exclusive`), re-link a linked repo, withdraw any vault, pay a bounty |
| **A maintainer's payout account** | Propose forfeits on its own repo (each disputable for free, penalised if overturned); withdraw its own vault | Touch other repos, settle a dispute in its own favour |
| **Owner key** | **Everything, via a code upgrade.** Without upgrading: register a key of its own as a "NEAR AI" key, then either point OutLayer at different code (`set_outlayer`) or turn `exclusive` off — after which forfeits signed by that key would pass. Each of these is a public transaction with an event (`set_tee_signers`, `set_outlayer`). Also: with **no** keys registered at all, the oracle route skips the signature check (that's how the sandbox money-path tests run) — so emptying the key list and turning `exclusive` off would let the oracle forfeit freely | — on testnet this is the root of trust. On mainnet the plan is a DAO time-lock on the account, then removing the key |
| **OutLayer's worker** | Return a false enclave answer (the TDX attestation is what rules this out) | Forge NEAR AI's signature on a forfeit |
| **GitHub** | Serve a false PR, merge state or CI result | — |

## Attacks we tested

Each row is a sandbox test against the real contract with a mock OutLayer that answers *later*, the
way the real one does (yield and resume), so other transactions land while the enclave runs.
[`contract/vault/tests/adversarial.rs`](../contract/vault/tests/adversarial.rs):

| Attack | Result |
|---|---|
| Call the enclave callbacks (`on_tee_judgment`, `on_tee_rejudgment`, `on_tee_bounty`) or the payout callback directly | Refused — they're private to the contract |
| A forfeit arrives from the enclave after the maintainer already refunded | Ignored (`already_decided`); the contributor keeps the refund |
| Ask for a second judgment while one runs, to re-roll the verdict | Refused |
| The owner changes the judge model, or turns OutLayer off, while a run is in flight | The late answer is dropped; nothing settles |
| **Replay one genuine signed forfeit against a second deposit, relabelled by the relay** | **Found and fixed on 3 Nov:** the enclave routes didn't record used signatures (the oracle route did). Now every route spends a signed request once; the test fails on the old code |
| Use a gateway key registered for the judge model to sign a first judgment | Refused — first judgments accept only a model's own enclave key |
| Register a gateway key *bare* and use it for a dispute | Refused — a gateway signature counts only when registered for that model |
| Rotate keys: remove a key, then submit its signature | Refused at once |
| Two bounty claims at once; and the oracle paying the same bounty while a claim runs (with `exclusive` turned off) | The second claim is refused; the running claim finds nothing left — paid exactly once |
| The oracle renames a linked repo (so another repo's forfeit matches), re-links it, changes its policy or withdraws | All refused |
| Swap a bounty's recipient, PR or issue in the enclave's answer | Refused ([`bounty.rs`](../contract/vault/tests/bounty.rs)) |
| Replay a signed forfeit through the oracle route, or use one about another PR | Refused ([`tee_proofs.rs`](../contract/vault/tests/tee_proofs.rs)) |

Not covered yet:
- **Head-commit binding.** A verdict covers the PR as it was when judged; the contract doesn't record the head commit, so commits pushed after a refund aren't re-judged.
- Rounding and insolvency fuzzing of the vault accounting.
- Relayer (NEP-366) abuse.

## Rebuilding the trusted enclave build

The contract pins the wasm's sha256 (`get_outlayer` → `version_key`). To check it yourself:
`git checkout e31f6f4 && bash outlayer/judge/build.sh` prints `cfcd8707a89b546f709e9182bfcf99c2b02dd351c0c4f99e27547b97dd398af8`
(Rust 1.97.1, pinned in `outlayer/judge/rust-toolchain.toml`; local paths are stripped, so the
folder doesn't matter). The previous build, `eb3baa69…`, is the same command at `a448538`.
