# PatchBond for maintainers — try it in 10 minutes

PatchBond asks strangers who open a pull request on your repo for a small **refundable bond**. An AI
judge in a TEE (NEAR AI Cloud) reviews the PR after your CI: real work gets the bond back
automatically; slop pays **you** for the time it took. Your team never pays.

> **This is a testnet trial.** Bonds are test USDC or test NEAR — no real money moves. Install it on
> a repo where a bot comment on outside PRs is fine, and uninstall any time.

## 1. Install the GitHub App (1 min)

**https://github.com/apps/patchbond/installations/new** → pick your account or org → choose the
repositories (one is enough to start) → **Install**.

Nothing changes yet: a new repo starts with bonds **off** until you turn them on in step 4.

What it asks for, and why:

| Permission | Why |
|---|---|
| Pull requests, Issues: read & write | Post the bond comment, label PRs, close unpaid ones after the notice, reopen them when paid |
| Checks: read & write | Show "Deposit required / received / verdict" as a check on the PR, and read your CI results |
| Actions: read & write | Reserved for approving first-time contributors' held CI runs once they've paid (planned — today PatchBond only reads results) |
| Contents, Metadata: read | Read the diff, `CONTRIBUTING.md` and `.github/patchbond.yml` |
| Members: read (org) | Recognise your team, including members whose org membership is private, so they never pay |

PatchBond **never runs contributor code** — it reads your repo's own CI results.

## 2. Get a testnet wallet (2 min)

1. Install **[Meteor](https://meteorwallet.app)** (or Intear) and create a **testnet** account, e.g. `yourname.testnet`.
2. Get test NEAR for fees from **[near-faucet.io](https://near-faucet.io)**.

This account is your **payout account**: forfeited bonds go to your repo's vault, and only this
account can withdraw them or change the bond policy.

## 3. Sign in and link (2 min)

1. Open **https://patchbond-production.up.railway.app/dashboard** → **Sign in with GitHub**. We
   check with GitHub that you're an admin of the repo.
2. Connect your wallet (top right), then **Link** next to your repo and sign the free message.
   No transaction, no fee — it proves the wallet is yours.

## 4. Turn bonds on (1 min)

Dashboard → your repo → **Bond policy → Edit**:

- **Currency**: USDC or NEAR.
- **Base bond**: what a newcomer pays when your queue is at capacity (try $1–2). It follows your
  queue on-chain: busy repo → higher, quiet repo → cents, spam wave → prices itself out.
- **Capacity**: how many outside PRs you can review at once.
- **Challenge window**: how long either side has to dispute an AI verdict (0 = settle at once).

**Save policy on-chain** (one wallet approval). From now on, outside PRs get the bond comment.

## 5. Optional: `.github/patchbond.yml`

```yaml
exempt: alice, bob              # people who never pay, beyond org members and collaborators
close_unpaid_after_hours: 24    # default 24; "off" to never close unpaid PRs
assignment_required: true       # contributors must be assigned the issue first
unassigned_pr: flag             # flag = a maintainer decides; evidence = counts toward a forfeit
```

## What your contributors see

1. A comment on their PR: the bond amount, a **Pay** link, and the deadline (24 h by default).
2. The pay page: one approval from Meteor/Intear/HOT. Test USDC comes from
   [faucet.circle.com](https://faucet.circle.com) ("Near Testnet"); for USDC, PatchBond pays the network fee.
3. After CI, the verdict on the PR with a link to a public page anyone can **verify** in the browser.
   - **Refund** → every cent back, automatically.
   - **Needs a maintainer** → you decide on the dashboard (refunded after 14 days if nobody does).
   - **Forfeit** → only if the model signed a forfeit with high confidence, evidence and a hard fact.
     90% to your vault, 10% to PatchBond. They can challenge it.

Not paid by the deadline → the PR closes itself; paying later reopens it.

**Who never pays:** your org's members, collaborators, people on your `exempt:` list, and
contributors with a proven record on PatchBond.

## You stay in control

- **Refund any bond at once** from its verdict page (cases waiting for you are listed on the dashboard) — no safeguard needed to give money back.
- **Your forfeit is a proposal**: the contributor can dispute it for free; a stronger model
  re-judges. Overturned maintainer forfeits pay the contributor a penalty, and your record is public.
- **Withdraw** your vault to your wallet whenever you like.
- **Turn bonds off** (Bond policy → off) or **uninstall** the App — nothing is charged after that.

## Help

Anything odd: open an issue at **https://github.com/PatchBond/patchbond/issues** with the PR link.
How the judge decides: [docs/JUDGE.md](JUDGE.md). Threat model: [SECURITY.md](../SECURITY.md).
