# PatchBond — end-to-end on NEAR testnet

Run `mvs8taqf` · 2026-10-28T15:01:59.339Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mvs8taqf.patchbond-e2e.testnet initialised with token usdc-mvs8taqf.patchbond-e2e.testnet
- ✅ alice holds 100 test USDC
- ✅ three repos registered by the oracle (instant, optimistic, flat-$1)

### 2. Attention pricing on-chain matches the web app's curve
- ✅ quote with 0 open = $1.580246 — identical to shared/curve.ts
- ✅ alice pays bond on #1
- ✅ quote with 1 open = $1.777777 — identical to shared/curve.ts
- ✅ alice pays bond on #2
- ✅ quote with 2 open = $2 — identical to shared/curve.ts
- ✅ alice pays bond on #3
- ✅ quote with 3 open = $2.25 — identical to shared/curve.ts
- ✅ alice pays bond on #4
- ✅ price rises with the queue: $1.580246 → $1.777777 → $2 → $2.25
- ✅ four submissions open

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
- ✅ underpaying says why: “The bond is now 6.00 USDC but 0.00 was sent; the transfer was refunded. Ask for a fresh qu…”
- ✅ a second deposit on a settled PR is refused
- ✅ calling ft_on_transfer directly can't fake a deposit
- ✅ alice lost nothing on any of these

### 8. Optimistic verdicts: challenge and finalize, with a real 15-second window
- ✅ the AI's forfeit is only proposed
- ✅ alice challenges by staking the bond
- ✅ overturned: alice got bond + stake back
- ✅ finalize is refused while the window is open
- ⏳ waiting 18 s of real testnet time for the challenge window…
- ✅ anyone can finalize once the window passes
- ✅ the refund verdict stood: alice is whole

### 9. Agents: a capped budget and a function-call key
- ✅ MCP patchbond_deposit paid $1.00 on testnet with the function-call key
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

### 12. Conservation: every USDC unit is accounted for
- ✅ contract holds exactly held + vaults + treasury + budgets ($11.355554)
- ✅ no USDC created or destroyed across all accounts

### Cleanup
- deleted 8/8 accounts; their NEAR went back to patchbond-e2e.testnet

---
**✅ ALL PASSED** in 293 s · 46 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mvs8taqf → new](https://testnet.nearblocks.io/txns/CMicrseiSVEivQqqZn2nct2U8fDJtHbQHzkSJ7WzHMRQ)
- [1. Deploy a throwaway stack: vault-mvs8taqf → new](https://testnet.nearblocks.io/txns/9NLeyvx33tFQ3R7LDbZPZkPdy5Qw9ZENCudpGNaCMuHp)
- [1. Deploy a throwaway stack: mint 0 → vault-mvs8taqf](https://testnet.nearblocks.io/txns/8KnVPEKU8DwGSJdSjHM1WBXkF7XuTSm6wp7PazM5bLzo)
- [1. Deploy a throwaway stack: mint 100 → alice-mvs8taqf](https://testnet.nearblocks.io/txns/BKe7EHsSXTPf96f9iGj4VWnhTVLDzvsFenizU322pPa4)
- [1. Deploy a throwaway stack: mint 20 → bob-mvs8taqf](https://testnet.nearblocks.io/txns/FgNmhPdJLukF1Ma6aDviqYVY53Q7BCGReqN6XwGtzjWp)
- [1. Deploy a throwaway stack: mint 20 → amaka-mvs8taqf](https://testnet.nearblocks.io/txns/52py25eWrkKYsNxxL67MKfePzjQwdaDYcoc68ofxGZt5)
- [1. Deploy a throwaway stack: mint 20 → mike-mvs8taqf](https://testnet.nearblocks.io/txns/9pD5Todkj874EpEdCGmpAPAgpd2pVTCmSETFGCran6u)
- [1. Deploy a throwaway stack: oracle-mvs8taqf → register_repo](https://testnet.nearblocks.io/txns/H5uvKjKZNxpsQjdMHreihHudGrAy7c9gQeHZPXjAjpuG)
- [1. Deploy a throwaway stack: oracle-mvs8taqf → register_repo](https://testnet.nearblocks.io/txns/eyG6fVtGwt2B9tnYs84prMUZAgcTy6gJFozcGAqLYYN)
- [1. Deploy a throwaway stack: oracle-mvs8taqf → register_repo](https://testnet.nearblocks.io/txns/8fU7NsQCqpyNiGi1JdfoL7SQv7aqpxM9QjLsxuQv3Kk5)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs8taqf pays bond on 1000001#1](https://testnet.nearblocks.io/txns/8ce6RLZHxKnTd121FiiWNSKANJDo2gPvQyfA8JanRpwy)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs8taqf pays bond on 1000001#2](https://testnet.nearblocks.io/txns/F8A96URdk942Ppi52iaT3zq7vZZNsnkboNYyvqQmHVfE)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs8taqf pays bond on 1000001#3](https://testnet.nearblocks.io/txns/AkTgUBvSLwFxNH5m3FpW2wTNuYDbkD9o1Xf9B11cpy6j)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs8taqf pays bond on 1000001#4](https://testnet.nearblocks.io/txns/GEshW8vGZk2WQxfS8qfsKz66oUfN22ZubDGvb9bc2YnM)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/5WFJHzUofmLL9JejvNb3mD9tv29Wpgk638nxHu6T53Ds)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/882Q2Vi99JHbcMQsfCraL9c5Tt8BU39tAvKKLwxxX6iY)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/DHjB9scUtTWRL4f3K5jvGgUQJzMgiTEpf8zYAYLJKsoK)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mvs8taqf pays bond on 1000001#4](https://testnet.nearblocks.io/txns/3gAsz9AAbppJJEH82vgUdx9gk8fKzQ3ekLDwVemsH2LK)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvs8taqf pays bond on 1000001#5](https://testnet.nearblocks.io/txns/AaPd3aFQoWpUyNmd4MtSinoBop4mKV49CkDEMMq78nYK)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/8FZJ1oaaQHvWbQPsA3vSS2RxQCPqFWeAoqJJr1y1qvCN)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/FLRpXSPLKCD4JaGGErzoNqg1whD2ibUfbEhyHRH6xYGm)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvs8taqf pays bond on 1000001#6](https://testnet.nearblocks.io/txns/FxxQy5VgjrptJJC5cMi8ZXmevrosQ6DC93vdiGVGT3s7)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/EBvHxtBc1xv8NF39SSwbSokJxXj7ztXJvTMRg1NK5dJe)
- [5. Slop funds the fix: alice-mvs8taqf pays bond on 1000001#7](https://testnet.nearblocks.io/txns/5y5azPJq3XmucUAAedJpmzDWSQaRgx32XuFJYk7bKk1Q)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/CY2xAMB2WrnJAo1NrGrsZ8bC2daNgAP7buknVq75hkR9)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/5F7Wn37v7zAJso7pQi2NKQ5wAUMepKVGTZfid8G5yT2v)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/5PKroRU8ekCLVxSejksTzUcsH8E2dwenyEpCVbckBeHT)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/2CxYRTam3rED2rtsRXZVVgW435EQF5pP2PF17jwjqfZ6)
- [7. Bad input is refunded with a reason: alice-mvs8taqf pays bond on 1000001#8](https://testnet.nearblocks.io/txns/4qNeS5Avvbhk25DUH2zs23kEQmhZcKSCLD1yfnQBtGEh)
- [7. Bad input is refunded with a reason: alice-mvs8taqf pays bond on 1000001#1](https://testnet.nearblocks.io/txns/QQY3q78tsqdWSumzoReqgaRGQSMSpSzjTHQiXko8k34)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mvs8taqf → link_repo](https://testnet.nearblocks.io/txns/3e8VW2SH3PSkE19To3Qh1k8HwdYWRFnRPBKFD6da8Exz)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvs8taqf pays bond on 1000002#1](https://testnet.nearblocks.io/txns/G5CZpUHP5W25mcZUbx3bV3hDRsq9ms332CnceJncRKr7)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/8MhLtW3pUjszU19oJ3c634JZddz3AmphiG8HFHuUyw5k)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/G8nBxLZQsgpjPKCP3H4gU8stStGidFpBQM5ThhSX6YbV)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/Cqn1uC1aEHpkF53FdQyKs4BufpkvuLErUbnFj5YVLLdF)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvs8taqf pays bond on 1000002#2](https://testnet.nearblocks.io/txns/F8xHjecfKQxbNQvBYCnAUdCLKZbrnuTnz5GP7E3BqqRX)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/8fUWRowEfM3xhJV716e62vbsh8zvmKqhhABGfNpvBakC)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/DEBqkwvpCwFjo4NiLQsVRVUKUSCCn46DLugU5TAnwWvg)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/J8CUAfyWmoGJ5LYJ2V6jGUog9z4E3mj8DK7XBDFCeFnL)
- [9. Agents: a capped budget and a function-call key: agent pays via the MCP server](https://testnet.nearblocks.io/txns/E6a1mJN82YnMYc3gjMcJfNZDgLFGHWWCAN2ugQB1ZxLc)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/4CfNuzi8VYv6T5G7oYd1z6myfNTxnvZ7Cc1kT32cZhfr)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/BHr84Gn5S61BLeiskKgURPyaYTTLgf9ac8Bs2ASCf5jV)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/2z2RyQBVCzLJuy7i3CkQMnaantMF7o8hxZ9QQJcAf9Ab)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/BHbV2iy8iA7ucXnb4XzYEY9G3V4Utk7K9Aquvpwv7xZQ)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mvs8taqf pays bond on 1000001#10](https://testnet.nearblocks.io/txns/moQSHAuGZZuUUc8dZ2xTerfBgUUubQCi2nGs8p4i6Wr)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/2bYsy1XpBo815ec9Baj4FakR6RvAtZHv4TZKDnErXCK6)
