<p align="center">
  <img src="brand/patchbond-logo-dark.png" alt="PatchBond" width="520">
</p>

<p align="center">
  <b>A refundable deposit on pull requests: an AI judge in an enclave refunds real work and forfeits low-effort PRs to the maintainer, settled by a NEAR contract.</b>
</p>

<p align="center">
  <a href="https://patchbond-production.up.railway.app"><img src="https://img.shields.io/badge/live%20demo-patchbond--production.up.railway.app-22C55E" alt="Live demo"></a>
  <a href="https://youtu.be/ObzFt_vIqBA"><img src="https://img.shields.io/badge/demo%20video-4%20min-FF0000" alt="Demo video (YouTube)"></a>
  <a href="https://github.com/PatchBond/patchbond/actions/workflows/ci.yml"><img src="https://github.com/PatchBond/patchbond/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-ECEAE4" alt="MIT">
</p>

---

A stranger's pull request needs a small **refundable bond** (USDC or NEAR) within 24 hours, or it closes itself (a repo can set this to close unpaid PRs at once, and require the PatchBond check so none can merge). The price follows the repo's review queue on-chain, like a base fee, and each extra open PR from the same payer costs them 12.5% more.

**The bond and the deadline are the filter; how far they deter real spammers isn't measured yet. The AI judge protects refunds.** A verifiable model in a TEE returns real work's bond automatically and sends doubtful cases to a person. It misses most slop. On two held-out sets, 99 labelled AI slop PRs judged, it forfeited 5, sent 42 to a person and refunded 52. Of 95 good PRs judged it forfeited none and sent 23 to a person ([results and limits](docs/eval/README.md)). When a forfeit does happen, with evidence and a window to dispute, 90% goes to the repo and 10% to PatchBond.

Lead track: **AI Security & Defense**. Also submitted to Agent Economy, Privacy and Open Innovation.

**A prompt-injected agent tries to drain its budget on the live testnet contract, and is refused.** The contract refuses a repo off its list ([tx](https://testnet.nearblocks.io/txns/EwFydECUFVX28muR344xGB3sX9bChmyFBgVuyfJVFay9)) and a bond past its daily cap ([tx](https://testnet.nearblocks.io/txns/9cgJ15GLC8Z3HTFDLTLmP7vbtuBVUL1ezHuvAc1BGjhV)); NEAR won't accept its key for another method, a USDC transfer or a NEAR transfer. The attempts are scripted; the refusals are the chain's. [Every step](docs/e2e/agent-attack-report.md) · rerun: `cd server && bun run e2e:agent-attack`

## Where it stands

Testnet, as of 2026-11-11. Full list with transactions: [docs/STATUS.md](docs/STATUS.md).

| | |
|---|---|
| ✅ **Running on testnet** | Vault contract, GitHub App bot, web app, MCP server for agents, gasless bonds, enclave judging, enclave dispute re-judging, enclave bounty checks, sealed security reports, in-app testnet faucet |
| ✅ **Tried by people outside the build** | A maintainer I invited installed the App on their own repo; contributors paid bonds, and one disputed a forfeit and lost to the enclave re-judge (below). Everyone was invited or came from my X post and tested on purpose: this is not organic spam |
| 🟡 **Partly done** | Cross-chain payouts are quotes only (NEAR Intents has no testnet). Payout to a DAO's account works, but there is no proposal flow |
| ❌ **Not shown yet** | Unprompted slop from strangers. Whether the deposit deters real spammers, or saves maintainers time. Mainnet |

**Contributors and testers, 2026-11-11** (times UTC). Who they are: `joelpeace48-cell` maintains modeltrace-contract and was invited to test; `codemagician1949` saw my X post and asked to try it as a contributor; `kulayddon` is an invited tester. Secureflow-protocol is my own organisation, used for test runs.

- **[FinesseStudioLab/modeltrace-contract#91](https://github.com/FinesseStudioLab/modeltrace-contract/pull/91)**, another maintainer's repo, PR by `codemagician1949`. The PR says it closes #82 but only adds a full stop to the README. The contributor paid the $1 bond; the enclave judge said forfeit, but with no hard fact the rules let it say only "needs a maintainer" ([verdict](https://patchbond-production.up.railway.app/v/a892986abcf8e571), [tx](https://testnet.nearblocks.io/txns/5p4rLbuizUf5JuAHrzzmdHbcVuwaPS8vbbLf53HPXrKf)). The maintainer [proposed a forfeit](https://testnet.nearblocks.io/txns/31464ZSvrxcHB7digJ4Y9se6eU7EWsSGVBCL9Dj7NgDM) at 16:19, the contributor [disputed it](https://testnet.nearblocks.io/txns/5oecG1aWMiXdbjGV63rLBYJSVpLnKXYh4ZzKpCS6mSeh) for free at 16:21, the stronger model [re-judged it in the enclave](https://testnet.nearblocks.io/txns/HvdQyqUjY78vAX8PVeRRb1ecfgJZ97G38mkyF96JWSUy) at 16:41 and signed forfeit ([verdict](https://patchbond-production.up.railway.app/v/041ceceb1bd80f73)), and [`confirm_tee_forfeit`](https://testnet.nearblocks.io/txns/CbHs72AkM82cX6eDyQCufXDKT8yAviNEqwGBc1d4b2TJ) paid $0.90 to that repo's vault.
- **[Secureflow-protocol/secureflow#57](https://github.com/Secureflow-protocol/secureflow/pull/57)**, my own repo, PR by the invited tester `kulayddon`: the title claims "a thorough e2e test", the diff is one README line. The contributor paid $0.78; the claim missing from the diff is a hard fact, so the enclave judge [proposed the forfeit on its own](https://testnet.nearblocks.io/txns/47iwbcmY4e12AqiQpBpEcufY1dBQnMGffqWA4T99G7vH) at 90% ([verdict](https://patchbond-production.up.railway.app/v/c04acf2a1b0f15b8), [signed bytes posted](https://testnet.nearblocks.io/txns/Ay1mGWQe9AxRqsUJum6L2woFjhUdF5JQheAJmgRBg96A)). It stands only if nobody challenges it within 72 h.

## Three claims you can check

Each one holds under a condition, stated here rather than in a footnote.

1. **Our server has no route to forfeit a bond.** With `exclusive` on, as it is live, the contract refuses the oracle's forfeit and bounty routes, and also refuses a forfeit with no signature, a forged one, or a spent one. The enclave route trusts OutLayer's attested worker for the verdict itself, because the contract sees only signed hashes there ([what the callback checks](docs/TRUST.md#what-the-outlayer-callbacks-verify)). A maintainer can still propose a forfeit with no signature: the contributor can dispute it for free, but **loses the bond if they don't within 48 h**; the bot comments on the PR when a forfeit is proposed, with the deadline in UTC. Open findings from screening, including a bounty path that isn't sound yet, are listed in [docs/TRUST.md](docs/TRUST.md#attacks-we-tested). → `bun run demo`, [`outlayer.rs`](contract/vault/src/outlayer.rs)
2. **The judge can run without our server.** Anyone can call `judge_in_tee`: an Intel TDX enclave reads GitHub itself, asks NEAR AI, and the contract acts on the answer. Disputes are re-judged the same way. → [docs/OUTLAYER.md](docs/OUTLAYER.md), with testnet transactions
3. **An agent can be given money without the keys.** Its function-call key can only pay bonds, within a daily cap, a per-bond limit and a repo list the contract enforces. The sandbox demo's last section has a prompt-injected agent try to drain its budget five ways; each is refused. → [`budget.rs`](contract/vault/src/budget.rs), `bash scripts/demo-fast.sh`, the app's **Agents** page

**What we still control:** the owner key can upgrade the code, change which NEAR AI keys are trusted, repoint OutLayer and turn `exclusive` off. So "non-custodial" describes today's code, not a promise that can't change. Every power, every money path and the attacks we ran are in **[docs/TRUST.md](docs/TRUST.md)**.

## Try it

**Watch first (4 min):** [the demo video](https://youtu.be/ObzFt_vIqBA) (also [on X](https://x.com/GbangbolaPhilip/status/2120643306438746442)), recorded on the live testnet app: judging a public PR, a maintainer's bond policy and activity feed, a real contributor dispute settled by the enclave re-judge, and verifying a signature in the browser.

### Judge it in 5 minutes: a browser, nothing installed

1. Open a live forfeit: **[patchbond-production.up.railway.app/v/2ea3fd344e767358](https://patchbond-production.up.railway.app/v/2ea3fd344e767358)**. It's [demo-widget#5](https://github.com/PatchBond/demo-widget/pull/5), our own test PR: it imports a module that doesn't exist, so CI fails, and it claims tests that aren't in the diff.
2. Press **Verify signature**. Your browser checks the record itself, and you should see six ✓:

   ```
   ✓ Request bytes match the signature
   ✓ Response bytes match the signature
   ✓ Signed by the stated model            (z-ai/glm-5.3-flash)
   ✓ Signature recovers to the signing address   (0x3b75…fa0c, NEAR AI's enclave key)
   ✓ Model verdict is inside the signed response (forfeit)
   ✓ Verdict hash recomputes from this record
   ```

   The sixth check is about the record itself. The **On-chain** panel on the same page reads the deposit from the contract (`get_deposit`) and shows whether the hash stored there matches this verdict.
3. See the money move in two steps. [`judge_in_tee`](https://testnet.nearblocks.io/txns/64nTqptKEPjAYLhqFBvs4V9EerMQvFLZACRHQVed3qzf) ends in `forfeit_pending`, and the $3 bond doesn't move. [`confirm_tee_forfeit`](https://testnet.nearblocks.io/txns/6qn3VuFZW1AX8nkSJN5ksiVL1Pry5Z3MsDAKy711fiAc), sent by a third account, posts the signed bytes; only then does the `settle` event pay $2.70 to the repo and $0.30 to PatchBond.
4. See a whole dispute on a live repo: [Secureflow-protocol/secureflow#56](https://github.com/Secureflow-protocol/secureflow/pull/56) claims to close an issue but only adds a period to a README badge link. The first model said forfeit, but with no hard fact the rules let it say only "needs a maintainer" ([its verdict](https://patchbond-production.up.railway.app/v/de582c2227c48958)). The maintainer [proposed a forfeit](https://testnet.nearblocks.io/txns/4beucH28TkrJ8y3799x5RcituNqQZ3xKusPfLvTYsm7F); the contributor [disputed it for free](https://testnet.nearblocks.io/txns/7uA65dhcEVbh3Jwz4TiJtieouMEuDdphFipsRQB2BHGY); after the statement window the [enclave re-judge](https://testnet.nearblocks.io/txns/5YQRf85AfGUYLFb1vGfeLkAJRoVPor8sv6FTfRYJCnTS) by the stronger model also signed forfeit ([its verdict](https://patchbond-production.up.railway.app/v/cd7b4a9aedc92cc9)), and 20 seconds later [`confirm_tee_forfeit`](https://testnet.nearblocks.io/txns/2Tu4ztnLzT4EpjPDLcRHBLvXCJ27HAa4UAqjc5tRBz7i) settled it: 90% of the $1.56 bond to the repo's vault, 10% to PatchBond.
5. Optional: press ⌘K, paste any public PR URL, and get a fresh signed verdict in about a minute.

**No browser, or a screening agent?** Fetching the page only shows that it loads: the checks run in your browser when you press the button. The same checks from a terminal, on this record and on 9 more signed ones (each prints six ✓; any ✗ exits 1):

```bash
bun install
bun scripts/verify-record.ts https://patchbond-production.up.railway.app/api/verdicts/2ea3fd344e767358
bun scripts/verify-record.ts docs/eval/examples/*.json
```

The testnet explorer pages linked in this README block scripted clients (HTTP 403). To check any linked transaction from a terminal, use the same explorer's API with the hash from the link:

```bash
curl -s https://api-testnet.nearblocks.io/v3/txns/CbHs72AkM82cX6eDyQCufXDKT8yAviNEqwGBc1d4b2TJ
```

### The sandbox demo: no keys, no wallet

The real contract on a local NEAR sandbox, using recorded NEAR AI signatures.

```bash
git clone https://github.com/PatchBond/patchbond && cd patchbond && bash scripts/demo-fast.sh
```

With a published release this runs a prebuilt bundle for Linux x64 or Apple Silicon, with nothing to install: about 2 minutes, download included. Without one, or on another system, the script builds from source instead: that needs Bun, Rust and `cargo-near`, and takes about 10 minutes the first time (9.5 on 8 cores from a clean clone). It shows a bond refunded, our own server refused a forfeit three ways, a genuine signed forfeit paying the maintainer, the oracle failing to touch the vault, a 16-PR flood pricing mostly its own sender, and a prompt-injected agent stopped five ways by its budget policy and its function-call key ([sample output](docs/demo-output.txt)).

**On real testnet**: deploys a throwaway copy of the contract and sends every money path through it, one explorer link per transaction, then deletes its accounts. Needs a funded testnet account; it costs test NEAR only. It doesn't call NEAR AI or OutLayer: those runs are recorded with transactions in [docs/OUTLAYER.md](docs/OUTLAYER.md).

```bash
bun run --cwd server e2e:testnet
```

**Maintainers:** [docs/MAINTAINERS.md](docs/MAINTAINERS.md). All steps: [docs/REPRODUCE.md](docs/REPRODUCE.md).

<!-- live:start -->
### Live now — [patchbond-production.up.railway.app](https://patchbond-production.up.railway.app)

| | |
|---|---|
| Bonds paid on-chain | **18** |
| Refunded to contributors | **$6.00** |
| Forfeited to maintainers | **$10.56** |
| Unpaid PRs closed after their 24 h notice | **1** |
| TEE-signed verdicts on the hosted service | **19** (PRs handled there: 12) · the contract trusts 3 NEAR AI keys |

<sub>testnet · contract [`patchbond-dev.testnet`](https://testnet.nearblocks.io/address/patchbond-dev.testnet) · updated 2026-11-11 by [`scripts/live-stats.ts`](scripts/live-stats.ts) from the contract's own views and the hosted service. Mostly the team's own test PRs; since 2026-11-11 also people outside the team, testing it on purpose (see Where it stands)</sub>
<!-- live:end -->

## How it works

```
 Stranger opens PR ──► bot comment: "refundable $0.78 deposit — pay within 24 h" (price follows the queue)
        │                    └─ unpaid after 24 h → closed (paying later reopens it)
        ▼
 Pays from a NEAR wallet: USDC (gasless) or NEAR ──► held by the contract
        ▼
 Repo's CI finishes ──► verifiable model in a TEE ──► signed verdict
        ├── refund      ──► every cent back, on-chain reputation (proven contributors pay $0)
        ├── needs_human ──► a maintainer decides (none in 14 days → our server refunds it)
        └── forfeit     ──► proposed on-chain ──► challenge window ──► 90% repo vault · 10% PatchBond
```

An AI verdict stands after the repo's challenge window (72 h by default, and a repo can shorten it); either side can stake to have a stronger model re-judge it. A maintainer's forfeit is a separate 48 h proposal, disputable for free; the bot tells the contributor on the PR, with the amount, the deadline in UTC and how to dispute. Maintainers, collaborators and proven contributors (≥3 refunds on ≥2 repos, no recent forfeit) never pay. **When in doubt, PatchBond refunds.** A refund costs the contributor nothing: PatchBond's 10% comes only from forfeits, to cover inference and gas ([where the 10% goes](docs/TRUST.md#where-the-10-goes)). More: [docs/DESIGN.md](docs/DESIGN.md).

## Why this exists

I maintain [Sanctifier](https://github.com/HyperSafeD/Sanctifier), with 120+ contributors and 570 pull requests. People keep opening tens of PRs for issues they were never assigned, or describing changes their PR doesn't contain, and each one costs a maintainer time. A Linux Foundation study (Oct 2026) estimates **~25% of incoming pull requests are low-quality AI output** ([Phoronix](https://www.phoronix.com/news/Linux-Foundation-25p-AI-Slop), [The Register](https://www.theregister.com/ai-and-ml/2026/10/21/ai-cuts-coding-time-but-its-also-filling-open-sources-inbox-with-crap/5304389)). PatchBond is installed on Sanctifier, with one test PR through it so far, paid from the maintainer's own second account.

Free slop detectors exist, and PatchBond isn't a code reviewer. What's different is the mechanism, enforced by one contract: queue pricing, disputable verdicts, forfeits that fund a bounty on the issue (paid when the maintainer merges a PR that says it fixes the issue and names a payout account; nothing checks the fix itself), and capped agent wallets. Nobody is ever paid for submitting, and there is no token.

## Tracks

| Track | What the work is | Where |
|---|---|---|
| **AI Security & Defense** | Function-call keys under a spending policy the contract enforces, shown stopping a prompt-injected agent in the sandbox demo and on the live testnet contract ([every transaction](docs/e2e/agent-attack-report.md)); forfeits only through signed enclave verdicts and disputable proposals; attacks run against every money path | [`budget.rs`](contract/vault/src/budget.rs), [`outlayer.rs`](contract/vault/src/outlayer.rs), [docs/TRUST.md](docs/TRUST.md) |
| **Agent Economy** | Agents pay for attention from capped budgets, declare a passport, and build a public record per agent and harness | [`mcp/`](mcp/src), the app's **Agents** page |
| **Privacy & Private AI** | Sealed security reports, encrypted in the reporter's browser to the maintainer and an enclave key, judged in OutLayer | [`outlayer/judge`](outlayer/judge), [docs/OUTLAYER.md](docs/OUTLAYER.md#sealed-security-reports) |
| **Open Innovation** | A price on a maintainer's attention: each repo's bond follows its open review queue on-chain, like EIP-1559's base fee, and a forfeit on a PR that claimed to fix an issue becomes a bounty on that issue | [`curve.rs`](contract/vault/src/curve.rs), [`queue.rs`](contract/vault/src/queue.rs), [`bounty.rs`](contract/vault/src/bounty.rs) |

## NEAR features used

| Feature | Where |
|---|---|
| **NEAR AI Cloud** verifiable inference, signatures verified in the browser and on-chain (`env::ecrecover`) | [`nearai.ts`](server/src/judge/nearai.ts), [`verify.ts`](shared/src/verify.ts), [`tee.rs`](contract/vault/src/tee.rs) |
| **OutLayer**: the judge as a wasm program in Intel TDX, called from the contract via yield/resume | [`outlayer.rs`](contract/vault/src/outlayer.rs), [`outlayer/judge`](outlayer/judge) |
| **Function Call access keys** as capped agent wallets | [`budget.rs`](contract/vault/src/budget.rs), [`mcp/src/client.ts`](mcp/src/client.ts) |
| NEP-141 USDC, `ft_transfer_call`; wNEAR wrapped in the same transaction | [`deposit.rs`](contract/vault/src/deposit.rs), [`Pay.tsx`](web/src/pages/Pay.tsx) |
| Meta transactions (NEP-366) for gasless bonds | [`relayer.ts`](server/src/relayer.ts) |
| NEP-413 signed messages, NEP-297 events, cross-contract callbacks | [`maintainers.ts`](server/src/maintainers.ts), [`events.rs`](contract/vault/src/events.rs), [`payout.rs`](contract/vault/src/payout.rs) |

## More

| Read | For |
|---|---|
| [docs/TRUST.md](docs/TRUST.md) | Who can move money, what each path checks, the attacks we tested |
| [docs/STATUS.md](docs/STATUS.md) | Every part with its evidence, test suites (245 tests, and how to get each count), how to check our claims |
| [docs/eval/README.md](docs/eval/README.md) | Judge results, including what it misses |
| [docs/DESIGN.md](docs/DESIGN.md) | Mechanisms, objections, costs, what comes next |
| [docs/REPRODUCE.md](docs/REPRODUCE.md) | Every step from a clean clone, and running your own |
| [SECURITY.md](SECURITY.md) | Threat model |
| [docs/BUILD_LOG.md](docs/BUILD_LOG.md) | How it was built, including what we got wrong |

## Built during the hackathon

Two tags mark the work (Q-003): `pre-hackathon` is the first commit (`2ee2f14`), and `hackathon-submission` is the final one. The full diff is [`pre-hackathon...hackathon-submission`](https://github.com/PatchBond/patchbond/compare/pre-hackathon...hackathon-submission). Building started on 2026-10-28, inside the hackathon window (Q-001), so there is no earlier code.

### Other project

I'm also a team member on **[Handova](https://github.com/UseHandova/handova-near)** (Lagos rentals with caution-fee escrow held by a lease NFT on NEAR), a separate and independent project submitted on its own (Q-015).

## Libraries and AI-assisted code

As the rules ask (Q-005): near-sdk, near-contract-standards, near-workspaces, cargo-near, near-api-js, NEAR Connect, Octokit, Hono, viem, zod, the MCP TypeScript SDK, React, Vite, Tailwind CSS, shadcn/ui (Radix), Motion, sonner, cmdk and lucide. Much of the code was drafted with AI coding assistants, directed, reviewed and tested by me (PatchBond is a solo build). No templates were used. First commit 2026-10-28.

## License

[MIT](LICENSE) © the PatchBond team.
