# PatchBond — end-to-end on NEAR testnet

Run `mw3cgmiq` · 2026-11-05T09:29:34.505Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mw3cgmiq.patchbond-e2e.testnet initialised with USDC usdc-mw3cgmiq.patchbond-e2e.testnet and wNEAR wrap.testnet
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
**✅ ALL PASSED** in 987 s · 62 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mw3cgmiq → new](https://testnet.nearblocks.io/txns/2QNAAK4mswyAqkqucUsEpHwdFqtmWPjCYwjcY6br6MrH)
- [1. Deploy a throwaway stack: vault-mw3cgmiq → new](https://testnet.nearblocks.io/txns/8pKc2uR7nCDFr5hLZKuL75tPSbN9BQHNvWZiTeQ1VaAk)
- [1. Deploy a throwaway stack: mint 0 → vault-mw3cgmiq](https://testnet.nearblocks.io/txns/BEMXQJvxPerFGhSPoF2CddwfYxo3hobRK929oNbceXkV)
- [1. Deploy a throwaway stack: mint 100 → alice-mw3cgmiq](https://testnet.nearblocks.io/txns/Dexe2ZqhFs1Vkhpm281Bt6XmXHKfeKjsCSgdi3N1LgJf)
- [1. Deploy a throwaway stack: mint 20 → bob-mw3cgmiq](https://testnet.nearblocks.io/txns/B4991depYnZr5NW6couLYUWraRYLsV2Z94JnezS2ffan)
- [1. Deploy a throwaway stack: mint 20 → amaka-mw3cgmiq](https://testnet.nearblocks.io/txns/8hRABZpGGtLnfGqzb3NsdR6mNRipSQsdAZpuABbg7nKU)
- [1. Deploy a throwaway stack: mint 20 → mike-mw3cgmiq](https://testnet.nearblocks.io/txns/7kKpMazUyt7F1VirN4WCVJsqUmGY4TLwvLTqH514jwX6)
- [1. Deploy a throwaway stack: oracle-mw3cgmiq → register_repo](https://testnet.nearblocks.io/txns/4q47ogwZTX7gAcqYbYsEQbEjkd3wzSmbBUt99TQoPXiN)
- [1. Deploy a throwaway stack: oracle-mw3cgmiq → register_repo](https://testnet.nearblocks.io/txns/Cwt4XL43cNjbodXzghg6T5Fa4Fxg3RnywSvTtKAigEJx)
- [1. Deploy a throwaway stack: oracle-mw3cgmiq → register_repo](https://testnet.nearblocks.io/txns/AjAS5hXjMRwNvV7Xzm6983SFK5uzDFQEC9xoFRDvSvUJ)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw3cgmiq pays bond on 1000001#1](https://testnet.nearblocks.io/txns/GW3Dj54XVnkke1Q3XZXGhd1gXVBDMB6xEvb9x6fD59EP)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw3cgmiq pays bond on 1000001#2](https://testnet.nearblocks.io/txns/9wU9McpW7dU9AzSCqEdQU84sZbMqvpTu6jLpR8FuDnN)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw3cgmiq pays bond on 1000001#3](https://testnet.nearblocks.io/txns/6WUrQo9MHVJjJHJ6Wr7i5gBz19432wuMHZdrHN4yMgcX)
- [2. Attention pricing on-chain matches the web app's curve: alice-mw3cgmiq pays bond on 1000001#4](https://testnet.nearblocks.io/txns/4rePV3pFv7QidWetKb7iAsDmuQ3xMfZ4weWYQaCxCmE1)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/AFGFGt5rmve45GcDjhLEaqa73geSLDvfehFGZ2XWxQ6B)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/4TX6QQyiuZ51rn8nxnmZ5iFd77BG3229Faf6UhKPte6a)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/3wSsf347YAiRYqVDRvLCsGrVuDSk5FhXWfjYkjU1cP1h)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mw3cgmiq pays bond on 1000001#4](https://testnet.nearblocks.io/txns/DJ4xqRc58jqGUd41fFeZDe9A2rvgNuXEW3HziXc3UKx4)
- [4. Priority lane: tip earned only when reviewed in time: alice-mw3cgmiq pays bond on 1000001#5](https://testnet.nearblocks.io/txns/13XXacB8aCAuaje9Ka7rxXGPSAi8hSPR9mHzBGS4dPXX)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/Gsbro4JgdG9Ww7wJiQm5kY4CHBk8ALFupvpKnMjqUQt2)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/3tHRBTNmrCVpUXcy7ZPVEDKd5HarCSTZLV5Fiz4Z6rY1)
- [4. Priority lane: tip earned only when reviewed in time: alice-mw3cgmiq pays bond on 1000001#6](https://testnet.nearblocks.io/txns/7uDNJU4yXiYsCMucgEFQfpmMnEbPDDYMQFpx13Lg7HrA)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/KuFAdgWWKzLHJtCK4WKeXAwbudo2qQHM7yass5DiCzu)
- [5. Slop funds the fix: alice-mw3cgmiq pays bond on 1000001#7](https://testnet.nearblocks.io/txns/9f2s85fAD3tBzJihBmkSDu56i94BhYs2p7uChyR4TNGe)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/GxNJCfj6Mimzpqr4szSNu15nhXRoRK22zifYQWWvMnYv)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/FgGgdhDv1MLLQe1wMa5kd8vqRm6cE3bv6zGeffmXmtWj)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/CLD7GgH4qZwmYCcKCf6c1Nbenzg1cXpnqphkZQJyuMHk)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/8Wj1QrtPatcBN8cAG8tp2qaYLU7ByxuzTb9Vi83qgkbY)
- [7. Bad input is refunded with a reason: alice-mw3cgmiq pays bond on 1000001#8](https://testnet.nearblocks.io/txns/F64VdqQrVGDtFVQn5NRrvycXhxhx5euuxR5ZuU4SqVhN)
- [7. Bad input is refunded with a reason: alice-mw3cgmiq pays bond on 1000001#1](https://testnet.nearblocks.io/txns/7YkDSDyJYo6WWFsS12rnK43gSQz4K5YRt32zwn76q95)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): mint 5 → gasless](https://testnet.nearblocks.io/txns/AYSCMWQiZLqSeeRaJopPKEGveosU2K4TjQsS6PzMMNMj)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): relayer submits the signed delegate](https://testnet.nearblocks.io/txns/FTaPiL4GK3Uwf4cqkaioJbzDCYhh8KdFHFz1prx5Jr9n)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): oracle settles 1000001#20: refund](https://testnet.nearblocks.io/txns/AG6QPfhGUnxNKeHXsjQ9AjZ4zSh9szzBs1U8wD6rBGak)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mw3cgmiq → link_repo](https://testnet.nearblocks.io/txns/9voFQ2aNXJGUDHs9NyP4gXTxMv1zCgphgJBqQE8BZTfC)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mw3cgmiq pays bond on 1000002#1](https://testnet.nearblocks.io/txns/E1DAM7TKu6ZV5LajvaWpyVxEpmrbqSqGXtRT1hJcFSQQ)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/3ruq85zezsXgHkUqmgwqRUzAo2tNZAP643chYB7yzeJA)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/EsxhXFFaumLXpwsH5Z1Eu1Z833bHenPJmPBkHpaZvZRe)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/ALHmc9DZDYp3nmDcN8dXsZsvvv9njSuYTDYGyAEaSdRA)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mw3cgmiq pays bond on 1000002#2](https://testnet.nearblocks.io/txns/FHJAtWF6Q5Emafwd3jvU6AxHpEhkhXbCncyZnSkQBnHx)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/GKhuxwoVQZAkyi1C9ZEZmCrGH6ph1hkmnj653fp6o5KE)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/D18op1cq72PhawVByiiTkRjzzdsM9jsfneJiyLF8TXvX)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/BDuJvHQitBzS7rhMmruSw68Mxf2mS58jn4oaC2z1J8JC)
- [9. Agents: a capped budget and a function-call key: agent pays via the MCP server](https://testnet.nearblocks.io/txns/GTG46fSzXYkxSjdJ3HRs8NfmV93w14ZH1HJnt2QWdNAZ)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/CSxDuZ4y3v1tevSFkZPYAEdidkyqXqqdQxRmCkr3V3BS)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/e7J7QuUJcdzjhnmibZUZxgA7cNFmZPNgWwtw6b4WVm3)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/2oc7YQqAuuTnh42gn9WzSssN9wUga9ej16mzxh7C5T2F)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/Dx4Jo4hby7UT467wFs5PwUF58fuSwQtActHYofB7CEYv)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mw3cgmiq pays bond on 1000001#10](https://testnet.nearblocks.io/txns/FSb6K2XbLB8ZMWyzFSWPzFfR4H8wxZDQzuRhKBTximFn)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/HfCLqdN3GNp58AnGcDWftd4SQ2HaeUfRJ8fPFv1rULPs)
- [12. NEAR bonds through the real wrap.testnet: vault registers with wrap.testnet](https://testnet.nearblocks.io/txns/8jgqgihSJjMD6gZSN48Yf9cQMcpJqb63FyBGTotqjzCo)
- [12. NEAR bonds through the real wrap.testnet: oracle-mw3cgmiq → register_repo](https://testnet.nearblocks.io/txns/FJ3qWRWTmecZjG39Gb8izQXZKQSdGEW7c4k8phpP9ZYF)
- [12. NEAR bonds through the real wrap.testnet: oracle switches R4 to NEAR](https://testnet.nearblocks.io/txns/5uVh2MvcakY75jkkxZ1UVhjPCKfXxn49JAkxD7LFWitE)
- [12. NEAR bonds through the real wrap.testnet: alice-mw3cgmiq pays bond on 1000004#1](https://testnet.nearblocks.io/txns/Aqutr3YRLkPGPXdvMu2JiX2zGhNsnFKy8Bo2A3C6YBFW)
- [12. NEAR bonds through the real wrap.testnet: dana wraps 0.03950617283950617 NEAR and pays R4#1 in one transaction](https://testnet.nearblocks.io/txns/FdScPMdE2CstLRvwAbAK2cnSXc5VmpxDhai9Va6RfZD7)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#1: refund](https://testnet.nearblocks.io/txns/DtqsHSP286TPMTiM8GwTJxP1uhnviKyBDEfsqezx3b6m)
- [12. NEAR bonds through the real wrap.testnet: dana pays R4#2 from wNEAR](https://testnet.nearblocks.io/txns/7nkNZeUSLACwsnmjXKT6MGzxrLNnyGdb66EUvAQtXw7q)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#2: forfeit](https://testnet.nearblocks.io/txns/CnNHuBjq2X32FFP4av9uKEC5vpjDYMFhTwFBJwHmvPjL)
- [12. NEAR bonds through the real wrap.testnet: oracle links R4 → amaka](https://testnet.nearblocks.io/txns/3cA2wPvDmLR1TfYvU2Zfz5mj3Q2zZoVS7FcN19ZgyuYt)
- [12. NEAR bonds through the real wrap.testnet: amaka registers with wrap.testnet](https://testnet.nearblocks.io/txns/BNDBZPJHGxGkrdyYDXF3t95u2D4csmeyoGLeGyjAUiPX)
- [12. NEAR bonds through the real wrap.testnet: amaka withdraws the NEAR vault](https://testnet.nearblocks.io/txns/8NFKeA77BP5PQ84eAATAqK3RodXqoTPrUNPT8C2oWbFE)
- [12. NEAR bonds through the real wrap.testnet: amaka unwraps to plain NEAR](https://testnet.nearblocks.io/txns/Di5oRPAdLCwhrXfTFYVoyFkgwoCAFsLurDbe6EjvYPUN)
- [12. NEAR bonds through the real wrap.testnet: dana unwraps her refund](https://testnet.nearblocks.io/txns/9YtBBTrEYoeGnhE7yVMs6ghyqh9P3r4wn7PtQjfUBnx9)
