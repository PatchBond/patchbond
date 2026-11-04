# Invite messages for maintainers

## Short (DM / X / Discord)

> Hey! I'm building **PatchBond** for the NEAR hackathon: strangers who open a PR on your repo post a
> small refundable bond. An AI judge in a TEE reviews it after your CI — real work gets every cent
> back, slop pays *you* for the time it took. Your team never pays.
>
> It's on **testnet** (no real money) and takes ~10 minutes to try on one repo. Would you test it
> and tell me what breaks?
> Guide: https://github.com/PatchBond/patchbond/blob/main/docs/MAINTAINERS.md

## Longer (email / GitHub discussion)

> Subject: Would you try a refundable bond on outside PRs? (10 min, testnet)
>
> Hi {name},
>
> AI made opening a pull request free, but reviewing one still costs you an hour. I'm building
> **PatchBond**: a stranger's PR gets a small refundable bond, priced by your review queue (a quiet
> repo charges cents; a spam wave prices itself out). After your CI, an AI judge running in a TEE on
> NEAR AI Cloud reviews it:
>
> - real contribution → the bond is refunded automatically;
> - slop → the bond goes to your repo's vault, which only you can withdraw;
> - unpaid PRs close themselves after a 24 h notice; your team and collaborators never pay.
>
> The bond and the deadline do most of the filtering. The judge is deliberately cautious: it rarely
> forfeits, and when it isn't sure it refunds or asks you. It runs in an OutLayer enclave that reads
> GitHub directly, and our server has no route to forfeit on the live contract. You can propose a
> forfeit yourself; the contributor can dispute it for free within 48 h. Every verdict is public, with
> the exact bytes the model saw. It's early and no outside contributor has paid a bond yet, so your
> feedback decides what it becomes.
> On NEAR's own nearcore it judged 20 stranger PRs for under a cent in total.
>
> It runs on **testnet** right now, so no real money moves. Setup is install → sign in → link a
> testnet wallet → turn bonds on: https://github.com/PatchBond/patchbond/blob/main/docs/MAINTAINERS.md
>
> I'd love 10 minutes of your time and blunt feedback — especially anything confusing for your
> contributors.
>
> Thanks,
> {you}

## For contributors and agent builders

> PatchBond is live on testnet: open-source repos can ask strangers for a small refundable bond on a
> pull request. Good work gets it back automatically, with a public, signed verdict that builds your
> reputation — proven contributors pay $0. Try it: get test USDC from the faucet at
> https://patchbond-production.up.railway.app and pay a bond on a PatchBond-enabled repo.
> Fixed an issue that someone's slop claimed to fix? Add `PatchBond: <your account>` to your PR and
> you're paid that slop's bond when it merges. AI agents can pay from a capped wallet through our
> MCP server (setup on the app's **Agents** page).
