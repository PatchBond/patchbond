# Who can move money, and who can change the rules

What the live testnet contract (`patchbond-dev.testnet`, config in [`deploy/testnet.json`](../deploy/testnet.json))
enforces today, method by method, and what each guarantee still rests on. Live config: OutLayer
`exclusive` **on**, enclave build `13d05fdc…` pinned. Every row names the code that enforces it.

## Roles

| Role | Account (testnet) | Can |
|---|---|---|
| **Owner** | `patchbond-dev.testnet` | Register NEAR AI keys (`set_tee_signers`), configure OutLayer and turn `exclusive` on or off (`set_outlayer`), set the dispute model, rotate the oracle and treasury, pause new deposits, withdraw the treasury's 10%. **Holds the contract account's full-access key, so it can also deploy new code.** It can't withdraw a repo's vault or a held bond with any method in the current code. |
| **Oracle** | `patchbond-oracle.testnet` | Register a repo, link an *unlinked* repo to a payout account (once), set its name (once), propose AI **refunds**, mark a PR reviewed (tip → vault), pay a bounty **only if `exclusive` is off**. With `exclusive` on it can't forfeit. |
| **Repo's payout account** | set by `link_repo` | Withdraw the vault, set the bond policy, hand the repo to another account (`set_payout`), propose a forfeit (disputable), refund any bond. |
| **OutLayer project owner** | `tester1604.testnet` | Owns the enclave project and its secrets (`judge`: NEAR AI and GitHub keys). It's a team member's account. It can publish new versions, but the contract pins which build it asks for (`version_key`). Holding the NEAR AI key means it can obtain genuine NEAR AI signatures. |
| **Payer** | whoever paid the bond | Dispute a maintainer's forfeit for free, stake to challenge an AI verdict, post statements. |
| **Anyone** | — | Ask the enclave to judge (`judge_in_tee`), re-judge a dispute (`rejudge_in_tee`), check a bounty claim (`claim_bounty_in_tee`), finalize after a window. Paying for the run gives no say in the result. |

## Every way a bond or bounty moves

| Path | Who triggers it | What the contract requires | Still trusted |
|---|---|---|---|
| **Refund** (AI or oracle) | Oracle, or the enclave's callback | Nothing beyond the role — giving money back is the safe direction ("when in doubt, refund") | The oracle not refunding slop (which would cost maintainers, not contributors) |
| **AI forfeit, enclave route** | Anyone → `judge_in_tee` → OutLayer callback | A NEAR AI signature over the request and response *hashes*, recovered on-chain to a registered key and used once; the enclave's answer reporting a model forfeit ≥ repo threshold with ≥1 evidence item ([`outlayer.rs`](../contract/vault/src/outlayer.rs)). **The contract doesn't see the signed bytes on this route, so it can't read the verdict itself** — see [below](#what-the-outlayer-callbacks-verify). Proposed for the repo's challenge window (0 on demo-widget) | **OutLayer's attested worker running the pinned wasm — for the verdict itself, not only the inputs**; GitHub's answers; NEAR AI's keys as registered by the owner |
| **AI forfeit, oracle route** | Oracle → `settle` | **Refused while `exclusive` is on** (live). When off: a NEAR AI signature on a request naming this repo and PR, each signature once ([`settle.rs`](../contract/vault/src/settle.rs), [`tee.rs`](../contract/vault/src/tee.rs)) | When off: the oracle chose the request bytes, so it could feed the model a fabricated diff under the right name (detectable — every request is published) |
| **Maintainer forfeit, not disputed** | Payout account → `settle(forfeit)`, then anyone → `finalize` after 48 h | **No model signature.** A 48 h proposal; a penalty is escrowed from the repo's vault in case it's overturned; the maintainer's forfeit and dispute counts are public | **The maintainer's honesty, and the payer noticing within 48 h.** This is the one forfeit path without a signature |
| **Maintainer forfeit, disputed** | Payer → `dispute` (free), then anyone → `rejudge_in_tee` | A signature over the hashes, recovered to a key registered *for that model* and used once; the enclave's answer reporting the stronger model's forfeit ≥ threshold with evidence ([`rejudge.rs`](../contract/vault/src/rejudge.rs)). Otherwise refund, and the maintainer pays a penalty | Same as the enclave route, including for the verdict itself. A human already decided, so the AI's hard-fact rule isn't required here — by design |
| **Staked challenge of an AI verdict** | Either side stakes → `rejudge_in_tee` | As above, **and** the enclave's rules (a hard fact) must report a forfeit; the loser's stake goes to the other side | Same as the enclave route |
| **Bounty** | Anyone → `claim_bounty_in_tee` | The enclave confirms on GitHub: the fix is merged into this repo, its title or body says it fixes #N, and its description names the recipient on a line of its own, `PatchBond: <account>`, whether or not it had a bond ([`bounty.rs`](../contract/vault/src/bounty.rs), `check_fix` in [`lib.rs`](../outlayer/judge/src/lib.rs)). Paid once; the oracle's `pay_bounty` is refused while `exclusive` is on | **The maintainer's merge decision** — the enclave checks the PR was merged and claims the issue, not that the issue is really fixed. Repo admins can edit a PR description, so the payout line is as trustworthy as they are |
| **Tip** | Oracle → `mark_reviewed` | Review within the window → vault, else refunded | The oracle's report that a maintainer reviewed (from GitHub's review event) |
| **Withdraw a vault** | Payout account only | `predecessor == payout` | — |
| **Agent spending** | The agent's function-call key → `deposit_from_budget` | Daily cap, most per bond, allowed repos, frozen flag — all in the contract ([`budget.rs`](../contract/vault/src/budget.rs)) | The owner's policy |

## What a compromised party could do

| If this is compromised | It could | It couldn't |
|---|---|---|
| **Oracle key** | Refund bonds; link a repo that **nobody has linked yet** to itself, then propose (disputable) maintainer forfeits there; mark PRs reviewed so tips go to vaults | Forfeit through its own route (`exclusive`), re-link a linked repo, withdraw any vault, pay a bounty |
| **A maintainer's payout account** | Propose forfeits on its own repo (each disputable for free, penalised if overturned); withdraw its own vault | Touch other repos, settle a dispute in its own favour |
| **Owner key** | **Everything, via a code upgrade.** Without upgrading: register a key of its own as a "NEAR AI" key, then either point OutLayer at different code (`set_outlayer`) or turn `exclusive` off — after which forfeits signed by that key would pass. Each of these is a public transaction with an event (`set_tee_signers`, `set_outlayer`). Also: with **no** keys registered at all, the oracle route skips the signature check (that's how the sandbox money-path tests run) — so emptying the key list and turning `exclusive` off would let the oracle forfeit freely | — on testnet this is the root of trust. On mainnet the plan is a DAO time-lock on the account, then removing the key |
| **OutLayer's worker** | Return a false enclave answer: report "forfeit" alongside any genuine, unused NEAR AI signature — even one from a refund, or from a run about another PR — or report a false bounty check. The contract can't tell. OutLayer's TDX worker registration is what rules this out; the contract adds no check of its own | Invent a NEAR AI signature, reuse a spent one, answer for a different repo or PR than was asked |
| **GitHub** | Serve a false PR, merge state or CI result | — |

## What the OutLayer callbacks verify

The contract calls OutLayer and gets one JSON answer back. `on_tee_judgment`, `on_tee_rejudgment` and
`on_tee_bounty` are private, so only that promise's result can reach them.

| Checked by the contract | Not checked by the contract |
|---|---|
| The answer names the repo and PR (or the issue, fix and recipient) that were asked about | **Which code ran.** `version_key` is sent with the request; OutLayer is trusted to honour it, and no code hash or attestation comes back |
| The model is the configured one | **What the model said.** The signature covers `sha256(request)` and `sha256(response)`; the bytes aren't sent, so verdict, confidence and evidence are fields the wasm reports |
| The signature recovers to a registered key (for rejudging, one registered for that model) | **What the model was asked.** The oracle route checks the signed request names this repo and PR; this route has no request bytes to check |
| The signature hasn't been used on a forfeit before | Bounty answers carry no signature at all: nothing is judged, so they rest on the worker alone |

So on this route the signature shows that a NEAR AI model answered *something*, and anyone with a
NEAR AI key can get such a signature. What makes the verdict trustworthy is the pinned wasm in an
attested TDX worker. OutLayer's register contract checks each worker's TDX quote against a
measurement allowlist its admins control; per-run attestation is checked off-chain
(`outlayer-verify`). The oracle route is the one where the contract reads the verdict itself from
the signed bytes ([`tee.rs`](../contract/vault/src/tee.rs)), and `exclusive` closes that route because
the oracle chooses what the model sees. Each route trusts a different party: the enclave route trusts OutLayer
with the verdict, the oracle route trusts our server with the input.

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
| Random use: 240 steps of bonds, tips, refunds, forfeits, bounties, withdrawals and payouts to an account that left the token contract | After every step the contract's balance equals what it owes, to the unit; failed payouts are booked as claimable ([`solvency.rs`](../contract/vault/tests/solvency.rs)) |
| Send the relayer anything but a bond or challenge payment into PatchBond | Refused before it spends gas ([`relayer.test.ts`](../server/test/relayer.test.ts)) |
| **A compromised OutLayer worker labels a genuine signed *refund* as a forfeit** | **Refused since the 2026-11-05 upgrade**: the deposit moves only on signed bytes that show a forfeit ([`screening.rs`](../contract/vault/tests/screening.rs), `a_relabelled_refund_never_forfeits_…`). Sealed reports stay one step; see below |

## Screening fixes: what's live

Outside screening found these. Each fix has a test that failed first
([`screening.rs`](../contract/vault/tests/screening.rs), [`outlayer/judge/tests/bounty.rs`](../outlayer/judge/tests/bounty.rs)).
**The contract with them went live on 2026-11-05** (tx
[`6G7R4DES…`](https://testnet.nearblocks.io/txns/6G7R4DES8ei9QRMnaVYaVfUzFMUMJY4xZ2Aag4UUdyo1)): a
code-only upgrade, rehearsed from the live build in the sandbox, with config and totals identical
before and after. Enclave build `13d05fdc…` was pinned the same day (tx
[`5gVR78CR…`](https://testnet.nearblocks.io/txns/5gVR78CRXPDZwsZDwcEu36NHp98prpYW9nmCCPCsQsc2)) and
[ran on the live contract](https://testnet.nearblocks.io/txns/BuapF8CcfHnJ9gWGKq6mkSDaf1vUqxtpkFZQ7nKukyWz)
through `refresh_enclave_key`, with the enclave key unchanged. That run makes no model call.

Fixed terms apply to bonds paid from the upgrade on; older bonds use the repo's current policy. The
two-step forfeit and the commit check ran on a real verdict on 6 Nov
([demo-widget#5](OUTLAYER.md), our own test PR). The payer check (refund credit) has run only in sandbox tests so far.

| Finding | Fix | What it still rests on |
|---|---|---|
| **Bounty theft.** `github_user` is whatever the payer declares, so someone could bond a merged fix, name its real author and claim the bounty | Every bounty now needs the line `PatchBond: <account>` in the PR's own text, bonded or not. A bond no longer has any say, so a squatted bond can't block the real author either | The enclave's reading of GitHub; anyone with write access to the repo can edit a PR's text |
| **Reputation on someone else's PR.** Paying first took the refund credit | With `exclusive` on, a refund earns reputation only if the enclave read the payer's name in the PR. The bond itself still comes back. The bot links a GitHub user to an account on the same evidence | The enclave's report: this field isn't signed |
| **A relabelled verdict.** A compromised worker could report a genuine signed refund as a forfeit | An enclave forfeit is now two steps. The callback only stores the signed hashes; the deposit doesn't move until someone posts the matching request and response (`confirm_tee_forfeit`). Those go through the oracle route's check, so the verdict, confidence, evidence, repo and PR are read from the bytes NEAR AI signed. If nobody posts them, the bond is refunded at the timeout | See below |
| **Which commit was judged.** Nothing tied a verdict to a commit | The commit is in the signed prompt, the enclave reports it, and a confirmed forfeit must match | The contract can't ask GitHub whether that commit is the PR's head |
| **No on-chain exit for an undecided bond** | `refund_expired`: anyone can return a bond with no verdict 14 days after it was paid, or an unresolved dispute after 60. It earns no reputation | Nothing: it needs no server, maintainer or enclave |
| **Policy can change after payment** | The challenge window, threshold and review window are copied when the bond is paid (`get_deposit_terms`). A repo can still set a window of 0 for *future* bonds | Bonds paid before the upgrade keep following the current policy |
| **"Proven" differed by route** | One definition everywhere (3 refunds on 2 repos, no recent forfeit), including disputes and sealed reports, which used to say otherwise | — |

**What the two-step forfeit doesn't close.** A compromised worker can still choose what the model is
*shown*: it can send NEAR AI a doctored prompt naming the right repo and PR, and get a genuine
signed forfeit. It can also report a hard fact the rules never found, or a false bounty check, which
carries no signature at all. Sealed reports stay one step, since publishing their bytes would expose
the report. So the worker is still trusted for the input, and OutLayer's attestation is what stands
behind that. The fix removes one attack, relabelling, and it fails safe: a forfeit nobody can prove
becomes a refund.

**Evidence from live runs.** Both live enclave transactions inspected in screening were sent by our
oracle account. On 6 Nov the payer's own account called `judge_in_tee` on demo-widget#5 and a third
account confirmed the forfeit; neither is our oracle or server. Both are still team test accounts, not
an outside user.

Not covered yet:
- **Relayer gas.** Its limit is one payment per account every 10 seconds, with no overall cap, so many accounts sending payments the contract refuses could spend its NEAR. The money isn't at risk; gasless bonds would stop until it's refilled.
- **Economic attacks.** Sybil accounts and reputation farming are described in [SECURITY.md](../SECURITY.md), not measured.
- **No outside review.** Every test here was written by the team.

## Rebuilding the trusted enclave build

The contract pins the wasm's sha256 (`get_outlayer` → `version_key`). To check it yourself:
`git checkout fab1e14 && bash outlayer/judge/build.sh` prints `13d05fdc42ea9264eddc255c9eac9333bdf42556aef62eb941abe8ba9e3a07d8`
(Rust 1.97.1, pinned in `outlayer/judge/rust-toolchain.toml`; local paths are stripped, so the
folder doesn't matter). The previous build, `eb3baa69…`, is the same command at `a448538`.
