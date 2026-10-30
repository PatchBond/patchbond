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
> The AI can't touch the money: the NEAR contract only forfeits a bond if the AI's enclave signed
> that verdict, and every verdict is public and verifiable. On NEAR's own nearcore it judged 20
> stranger PRs and forfeited none of the genuine ones.
>
> It runs on **testnet** right now, so no real money moves. Setup is install → sign in → link a
> testnet wallet → turn bonds on: https://github.com/PatchBond/patchbond/blob/main/docs/MAINTAINERS.md
>
> I'd love 10 minutes of your time and blunt feedback — especially anything confusing for your
> contributors.
>
> Thanks,
> {you}
