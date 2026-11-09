# PatchBond for maintainers — try it in 10 minutes

PatchBond asks strangers who open a pull request on your repo for a small **refundable bond**. An AI
judge in a TEE (NEAR AI Cloud) reviews the PR after your CI: real work gets the bond back
automatically; slop pays **you** for the time it took. Your team never pays.

> **This is a testnet trial.** Bonds are test USDC or test NEAR — no real money moves. Install it on
> a repo where a bot comment on outside PRs is fine, and uninstall any time.

## 1. Install the GitHub App (1 min)

**https://github.com/apps/patchbond/installations/select_target** → pick your account or org → choose
the repositories (one is enough to start) → **Install** → **Authorize** (that signs you in to the
dashboard). If GitHub later says *"GitHub App has already been installed"*, nothing went wrong — it's
installed; use **Configure** there to add repos, or go straight to the dashboard.

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
   No transaction, no fee — it proves the wallet is yours. **The bond settings appear only after
   this step**: only the linked account can change them on-chain.

## 4. Turn bonds on (1 min)

Dashboard → your repo → **Bond policy → Edit**:

- **Currency**: USDC or NEAR.
- **Base bond**: what a newcomer pays when your queue is at capacity (try $1–2). It follows your
  queue on-chain: busy repo → higher, quiet repo → cents, one payer's flood → raises only their own price.
- **Capacity**: how many outside PRs you can review at once.
- **Challenge window**: how long either side has to dispute an AI verdict (0 = settle at once).

**Save policy on-chain** (one wallet approval). From now on, outside PRs get the bond comment.

Under it, **Unpaid pull requests** sets how long a PR stays open without a deposit: at once, after
1 h … 7 days, a custom number of hours, or never. It's saved by PatchBond's server (it's what the bot
does, not money), so no wallet approval; it overrides `close_unpaid_after_hours` in the file below and
applies from the next PR.

## 5. Optional: `.github/patchbond.yml`

```yaml
exempt: alice, bob              # people who never pay, beyond org members and collaborators
close_unpaid_after_hours: 24    # default 24; "now" closes unpaid PRs as they open; "off" never closes them
close_forfeited: on             # default on: a PR closes once its forfeit is final; "off" keeps it open
assignment_required: true       # contributors must be assigned the issue first
unassigned_pr: flag             # flag = a maintainer decides; evidence = counts toward a forfeit
```

## 6. Optional: no unpaid PR stays open, none can merge

GitHub doesn't let any app stop a pull request from being *opened*. These two settings make that the
only thing a non-payer can do:

1. **Close unpaid PRs at once.** Dashboard → Bond policy → **Unpaid pull requests** → *At once*, or in
   `.github/patchbond.yml`:
   ```yaml
   close_unpaid_after_hours: now
   ```
   An unpaid PR gets the deposit comment and is closed within seconds. Paying reopens it
   automatically. If you reopen one yourself, it stays open (you chose to look at it).
2. **Require the PatchBond check to merge.** Settings → Rules → Rulesets → **New branch ruleset**
   → target your default branch → **Require status checks to pass** → add **PatchBond** → Save.
   (Classic branch protection works too: Settings → Branches → *Require status checks to pass*.)
   The check stays pending until the deposit is paid and fails on a forfeit, so an unpaid or
   forfeited PR can't be merged. Exempt people (your team, `exempt:`, proven contributors) get a
   passing check at once, and every new commit on a PR gets the check again.

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

**Slop funds the fix.** If a forfeited PR claimed to fix issue #N ("Fixes #N"), its forfeit becomes a
bounty on #N instead of going to your vault. When a real fix for #N is merged, the bounty goes to
the account named on a line of its own in the PR description, `PatchBond: alice.testnet`. This is checked in the
OutLayer enclave against GitHub, not decided by our server.

**Who never pays:** your org's members, collaborators, people on your `exempt:` list, and
contributors with a proven record on PatchBond.

## You stay in control

- **Refund any bond at once** from its verdict page (cases waiting for you are listed on the dashboard) — no safeguard needed to give money back.
- **Your forfeit is a proposal**: the contributor can dispute it for free; a stronger model
  re-judges it inside the OutLayer enclave, with a statement from each of you posted on-chain. Overturned maintainer forfeits pay the contributor a penalty, and your record is public.
- **Withdraw** your vault to your wallet whenever you like.
- **Turn bonds off** (Bond policy → off) or **uninstall** the App — nothing is charged after that.

## Help

Anything odd: open an issue at **https://github.com/PatchBond/patchbond/issues** with the PR link.
How the judge decides: [docs/JUDGE.md](JUDGE.md). Threat model: [SECURITY.md](../SECURITY.md).
