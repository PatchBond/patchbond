# PatchBond — end-to-end on NEAR testnet

Run `mw1xgm5i` · 2026-11-04T09:41:53.594Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mw1xgm5i.patchbond-e2e.testnet initialised with USDC usdc-mw1xgm5i.patchbond-e2e.testnet and wNEAR wrap.testnet
- ✅ alice holds 100 test USDC
- ✅ three repos registered by the oracle (instant, optimistic, flat-$1)

### 2. Attention pricing on-chain matches the web app's curve
- ✅ alice's quote with 0 of her own open = $1.580246 — identical to shared/curve.ts
- ✅ alice pays bond on #1
- ✅ alice's quote with 1 of her own open = $1.777777 — identical to shared/curve.ts
- ✅ alice pays bond on #2
- ✅ alice's quote with 2 of her own open = $2 — identical to shared/curve.ts
- ✅ alice pays bond on #3
- ✅ alice's quote with 3 of her own open = $2.25 — identical to shared/curve.ts
- ✅ alice pays bond on #4
- ✅ price rises with the queue: $1.580246 → $1.777777 → $2 → $2.25
- ✅ four submissions open
- ✅ a newcomer is priced as if alice had opened 2, not 4

### 3. Verdicts move money: refund, forfeit 90/10, void
- ✅ refund returns the whole bond to alice
- ✅ forfeit: 90% to the repo vault
- ✅ forfeit: 10% to the treasury
- ✅ void refunds the wrong payer in full
- ✅ after a void the real author (bob) can pay the same PR
- ✅ the slot now belongs to bob

### 4. Priority lane: tip earned only when reviewed in time
- ✅ reviewed within 72 h → the $3 tip goes to the vault
- ✅ never reviewed → bond and tip both come back

### 5. Slop funds the fix
- ✅ the forfeited PR's 90% became a bounty on issue #99
- ✅ bob, who really fixed #99, received the bounty

### 6. Only the linked maintainer can withdraw
- ✅ bob can't withdraw R1's vault
- ✅ the contract owner can't withdraw it either
- ✅ amaka withdrew $4.6

### 7. Bad input is refunded with a reason
- ✅ underpaying says why: “The bond is now 6.00 USDC but 0.00 USDC was sent; the transfer was refunded. Ask for a fre…”
- ✅ a second deposit on a settled PR is refused
- ✅ calling ft_on_transfer directly can't fake a deposit
- ✅ alice lost nothing on any of these

### 7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366)
- ✅ the bond was paid by the gasless account
- ✅ the contributor spent 0 yoctoNEAR — the relayer paid the gas
- ✅ the relayer refuses to pay gas for anything but bond payments

### 8. Optimistic verdicts: challenge and finalize, with a real 15-second window
- ✅ the AI's forfeit is only proposed
- ✅ alice challenges by staking the bond
- ✅ overturned: alice got bond + stake back
- ✅ finalize is refused while the window is open
- ⏳ waiting 18 s of real testnet time for the challenge window…
- ✅ anyone can finalize once the window passes
- ✅ the refund verdict stood: alice is whole

### 9. Agents: a capped budget and a function-call key
- ✅ MCP patchbond_deposit paid 1.00 USDC on testnet with the function-call key
- ✅ MCP reports $1.50 left today
- ✅ MCP patchbond_budget reads the on-chain budget
- ✅ agent pays another $1 directly with the same key
- ✅ third bond refused by the contract: “Daily cap reached: this bond is 1.00 USDC and 0.50 of the 2.50 USDC da…”
- ✅ the key can't touch the token contract
- ✅ the key can't call any other PatchBond method
- ✅ refund went back into the budget (10 − 2 + 1)
- ✅ claude-code's public record: 2 bonds, 1 refunded, 1 forfeited
- ✅ mike took the remaining budget back

### 10. Judge → chain: a signed verdict's hash lands on-chain
- ✅ judge forfeits a PR that calls a made-up parse_* function
- ✅ the deposit on-chain carries the record's verdict_hash
- ✅ the record verifies (hashes + signer + on-chain hash)

### 11. Reputation follows the account
- alice: 5 refunds on 2 repos, 3 forfeits
- ✅ recent forfeits → alice pays ×4

### 12. NEAR bonds through the real wrap.testnet
- ✅ R4 now takes NEAR (0.01–0.5 NEAR, base 0.05)
- ✅ get_repo reports currency near
- ✅ USDC is refused with a reason: “Repo 1000004 takes NEAR bonds; this USDC transfer was refund”
- ✅ one transaction: register + wrap + pay a 0.03950617283950617 NEAR bond
- ✅ the deposit is recorded as NEAR
- ✅ refund: the whole bond comes back as wNEAR
- ✅ forfeit: 90% to R4's NEAR vault
- ✅ forfeit: 10% to the NEAR treasury, USDC treasury untouched
- ✅ amaka received the vault as wNEAR
- ✅ …and unwrapped it to plain NEAR
- ✅ the contract's wNEAR = held + NEAR vaults + NEAR treasury

### 13. Conservation: every USDC unit is accounted for
- ✅ contract holds exactly held + vaults + treasury + budgets ($11.355554)
- ✅ no USDC created or destroyed across all accounts

### Cleanup
- deleted 10/10 accounts; their NEAR went back to patchbond-e2e.testnet

---
**✅ ALL PASSED** in 712 s · 62 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mw1xgm5i → new](https://testnet.nearblocks.io/txns/7bE6S6dPykgoo91jtMw1ehuvva6Rh4fjvVSKbytiwy2X)
- [1. Deploy a throwaway stack: vault-mw1xgm5i → new](https://testnet.nearblocks.io/txns/CuHEZZnJpWnf4dtjH4J6tx1LtEuRtkP7cwyaLd6Jfydh)
- [1. Deploy a throwaway stack: mint 0 → vault-mw1xgm5i](https://testnet.nearblocks.io/txns/G4dC8GtyDWvBpmsaETRezwMQ84DwLNvMCBo7D68vbZhX)
- [1. Deploy a throwaway stack: mint 100 → alice-mw1xgm5i](https://testnet.nearblocks.io/txns/NnoFBeYXunwpmmErLrxjFZwEuXE5rPPHZm4tKPCaD2f)
- [1. Deploy a throwaway stack: mint 20 → bob-mw1xgm5i](https://testnet.nearblocks.io/txns/9vXv2QswiaMaBu9iNteMdAdkboUj48xMzJ54bpGyVZbe)
- [1. Deploy a throwaway stack: mint 20 → amaka-mw1xgm5i](https://testnet.nearblocks.io/txns/uyMJ9vUBtup6nuArKqJ5kVhp2ygeBpZCBUhzV2uvx3p)
- [1. Deploy a throwaway stack: mint 20 → mike-mw1xgm5i](https://testnet.nearblocks.io/txns/6jJXonpG79s4KwxNesggxUcj9neiSkvyJaCYYmBHUe8C)
- [1. Deploy a throwaway stack: oracle-mw1xgm5i → register_repo](https://testnet.nearblocks.io/txns/2K9AJkvq1PparST6xfccN9QCNsRaqFY4rgdQjgCgsoyY)
- [1. Deploy a throwaway stack: oracle-mw1xgm5i → register_repo](https://testnet.nearblocks.io/txns/HVba2NDYf7eyBjsUQkuRU4VBccdfA3Rqre2diPQb5mLc)
- [1. Deploy a throwaway stack: oracle-mw1xgm5i → register_repo](https://testnet.nearblocks.io/txns/5LW8z8uC7HXDACjes8NBUnUV2j3jQevtu41bdScqwxEw)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw1xgm5i pays bond on 1000001#1](https://testnet.nearblocks.io/txns/8vWkZCfzwkumtZKy41BnzoxHJM1SuesqfPu6rFiXeyMZ)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw1xgm5i pays bond on 1000001#2](https://testnet.nearblocks.io/txns/6c3ZBroHc4AKcGWs4UfGgnpTGNWC8gMjqNoGJZSkdeeo)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw1xgm5i pays bond on 1000001#3](https://testnet.nearblocks.io/txns/94DrXYpVuRSj3w34N13JcZZB5Eprrd9agfum2fXX1QeN)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw1xgm5i pays bond on 1000001#4](https://testnet.nearblocks.io/txns/9J1QQE6kXrDZbuPLRxv1vSuKfzWQgW5RXwkRmz5C1M4Z)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/9e1fvwKbwS5fon3bJbnJw7c59sayt68nzFi59ER3fgQW)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/owEdnzJi2K54Qv9vQPemXx1Lqm6pxknN3eMxUCJ5nUT)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/GytJtMH6YNe1eR36yQkJ2v9vnUqWaH9iYBBkLgQmVLMS)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mw1xgm5i pays bond on 1000001#4](https://testnet.nearblocks.io/txns/5nHUKq9tTsK56MKXa2onKbEPTsLcCTpZsMtKCXrcGjVE)
- [4. Priority lane: tip earned only when reviewed in time: alice-mw1xgm5i pays bond on 1000001#5](https://testnet.nearblocks.io/txns/4eMGFvXHeiTLBTjB5QBtY7516eMad3LRSPykh2icamfD)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/AQbTSW4Xa9Wkv2puxyDfVmy7uwg4FGv56pe1YHQJaVRv)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/AQJ6H5oo3mtX6QxoJYg41PTpuFsAqSAkdP9W8J1xTwUS)
- [4. Priority lane: tip earned only when reviewed in time: alice-mw1xgm5i pays bond on 1000001#6](https://testnet.nearblocks.io/txns/2CiWY2sQYxbQdUb5rHJZddjZbHqfsjGa9zB99jAiLUPz)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/CBKLbrvzaN4qSC6t9jJ9Y3xMZ1Kq2tq3txSBYj1LGW6R)
- [5. Slop funds the fix: alice-mw1xgm5i pays bond on 1000001#7](https://testnet.nearblocks.io/txns/2jdoYwV4hzz8dHiUMHixBPSbdQ7ocBkWKfuabimzGRuZ)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/J63f7TmP8Sho3Q1FGozZF3kk7wGYcwKpxpYHXsqLrSpN)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/HBPZMS73jjeaKnRRrBugf5xrCqsVjaaT2d2ZCgZmZTR8)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/DgNUXiJxAiDftjdWAgoLMdg2PGKfAHokoQXtXccLEChJ)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/6sh54CHnWqMEmi77YtM2QZFj7T5acqFvyrYsVk2M7g2U)
- [7. Bad input is refunded with a reason: alice-mw1xgm5i pays bond on 1000001#8](https://testnet.nearblocks.io/txns/545obgeowHQCPz41ftSXRXSe7LoGYV2zyQKp2usPENnM)
- [7. Bad input is refunded with a reason: alice-mw1xgm5i pays bond on 1000001#1](https://testnet.nearblocks.io/txns/9pz3hqQR4L4qkFnA4PEGaX72kpVgLHpdzTmEM3HRV7Bv)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): mint 5 → gasless](https://testnet.nearblocks.io/txns/ALrL6UiAChg2YDLGRK4qwNDg3WnPFANwobAsYTXTMoDy)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): relayer submits the signed delegate](https://testnet.nearblocks.io/txns/EtCLkfsyxFRFZWwa57fAwAtRYfZPBayfLxyG6AeGWQLu)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): oracle settles 1000001#20: refund](https://testnet.nearblocks.io/txns/FK2b3bshTtJQQtY9fVVUF9pdXMpgtpCQzHwnuTnDAN3t)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mw1xgm5i → link_repo](https://testnet.nearblocks.io/txns/5ZikD7Ye7L8t3p5NnGMa2zVWqgYZxRnwRNAQSnG6r4V7)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mw1xgm5i pays bond on 1000002#1](https://testnet.nearblocks.io/txns/2vQP2UySxVc3Q7agEvbRGSvtWwF17XSFdTmk3ipVpbcf)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/CL9RmVtwcepW1mdsfgS4dGQ3mF7c4ge5ZYyqLX8rxjUc)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/9HXaX8B1hHKAEZyzKXM4yRYHemKKmFAuzkebdrwjzZfK)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/GwLFeJEtypWZASjSX4Sx4NGCsdQpQgmia95jz9iWzbu)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mw1xgm5i pays bond on 1000002#2](https://testnet.nearblocks.io/txns/4rSd3S9sUGdTd5YNwjK8rYv37XRDKLxiJYs8863LyV5h)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/6iYU9EHVVnVrVVmLCEw2SJS9DMneRfLEkq4Xz6LUfkTv)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/DtzKRnPKJRGfoYsh4ZoyK8LRrvz6JRCzwWdbrx1ajEfx)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/62uPCV4mzetwCwwTj9PcLvXbA9xuvkZJopZx8tYxA85Z)
- [9. Agents: a capped budget and a function-call key: agent pays via the MCP server](https://testnet.nearblocks.io/txns/Cs6ayN1kRV9wMvGmTmBb4PBZUgCokkYNyazqKzfdusdr)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/CzcnP41JwSneAJG7bvyLBfYYjmzc3VCXPMitCyRfVoJm)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/7bLcHuR1TfwiownbkDB3X3z54U5TDF2aaHCtwzAfk3TQ)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/7snU1rS4RGjz9rxwHvv1EHv2Ssk5tBsHxjAfbsxkmqLW)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/ED6t9mCQwc4upGHpCzcumYk8aMEKz1bhANyVjJoQ6dPN)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mw1xgm5i pays bond on 1000001#10](https://testnet.nearblocks.io/txns/F8zH59tQLJp11RvwSp6JtP7hwm7qSXzJMSjq1qAxFLR)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/DmNmobixLkCfEJabbs5pFmvCJFZPCmyyTvpZGgKuG4SL)
- [12. NEAR bonds through the real wrap.testnet: vault registers with wrap.testnet](https://testnet.nearblocks.io/txns/Bs7WPYqMQLYbuW1qqETPGbZMLSTS8PvwA5LmHfVnqJh6)
- [12. NEAR bonds through the real wrap.testnet: oracle-mw1xgm5i → register_repo](https://testnet.nearblocks.io/txns/DTfde6AkfG955zdmy4iHaZ4D8SK36Dh2CVuEqfQ6oLtr)
- [12. NEAR bonds through the real wrap.testnet: oracle switches R4 to NEAR](https://testnet.nearblocks.io/txns/2R44cce6fXRcG189YPEWWix32nvVohaC1KZJ7boh6EmE)
- [12. NEAR bonds through the real wrap.testnet: alice-mw1xgm5i pays bond on 1000004#1](https://testnet.nearblocks.io/txns/3anx2mEnL868ktqb8sDVgwBYA44mRbJWRbMW5R7sNPXJ)
- [12. NEAR bonds through the real wrap.testnet: dana wraps 0.03950617283950617 NEAR and pays R4#1 in one transaction](https://testnet.nearblocks.io/txns/9RebuVGp7VJEdBik5CvYjpBJRar7pYdNUmbWrXeA16Xd)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#1: refund](https://testnet.nearblocks.io/txns/F7WbWhjvJdXRXoWnE4k1mFBwAV8wTPWGTEJEyphnvbNW)
- [12. NEAR bonds through the real wrap.testnet: dana pays R4#2 from wNEAR](https://testnet.nearblocks.io/txns/DGCBJgib3vm29QCGHZH6qEdrbhRegvXVnjFiyymkqz1K)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#2: forfeit](https://testnet.nearblocks.io/txns/3568Bkwppu6w62R7eaQshcwEphtLJJoMYPF2dEauukZ1)
- [12. NEAR bonds through the real wrap.testnet: oracle links R4 → amaka](https://testnet.nearblocks.io/txns/9ymT2GNTQ74vJgouqrYNst447nw4p77RXSzxGRBaymU1)
- [12. NEAR bonds through the real wrap.testnet: amaka registers with wrap.testnet](https://testnet.nearblocks.io/txns/7WFXbHwZYYgMqaTurcxyx84YMLMMFpx5aemNJbsTT7Yq)
- [12. NEAR bonds through the real wrap.testnet: amaka withdraws the NEAR vault](https://testnet.nearblocks.io/txns/Hkv1enfhub9Xw91aFHaBfBhNuQf7rwBQqN9VRpcBvVRJ)
- [12. NEAR bonds through the real wrap.testnet: amaka unwraps to plain NEAR](https://testnet.nearblocks.io/txns/GTKivTQfMovUQ9sfvHcQ4xY9hzLCR6eaDTMFc4dDNbMY)
- [12. NEAR bonds through the real wrap.testnet: dana unwraps her refund](https://testnet.nearblocks.io/txns/F7xbuqqhHasT7FqQSB2pc3nw1VNkb1ATTFhvdX8sd5bH)
