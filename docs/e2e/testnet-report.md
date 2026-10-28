# PatchBond — end-to-end on NEAR testnet

Run `mvsof9ya` · 2026-10-28T22:18:58.992Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mvsof9ya.patchbond-e2e.testnet initialised with USDC usdc-mvsof9ya.patchbond-e2e.testnet and wNEAR wrap.testnet
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
**✅ ALL PASSED** in 361 s · 62 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mvsof9ya → new](https://testnet.nearblocks.io/txns/ECnvUcqRgBLBJmfAbex5NG64tHgK9Qxx6mon3FVSabeD)
- [1. Deploy a throwaway stack: vault-mvsof9ya → new](https://testnet.nearblocks.io/txns/7oN2WZxq3BixTeVjoxgJk8CNZvwLvRK13ysay8GPnQ1z)
- [1. Deploy a throwaway stack: mint 0 → vault-mvsof9ya](https://testnet.nearblocks.io/txns/9YtgYoXw5XG5qn8TWquqmnhvsR9pzo9W3kgD4qWsRFv2)
- [1. Deploy a throwaway stack: mint 100 → alice-mvsof9ya](https://testnet.nearblocks.io/txns/GDNBSKQJDz78Yrtywaps2zj2qK3PYun43ENurDdiCyco)
- [1. Deploy a throwaway stack: mint 20 → bob-mvsof9ya](https://testnet.nearblocks.io/txns/AmPDJTEkKHdmt7XooVXVE9WK3KrhfpMARKnYqy38tsr8)
- [1. Deploy a throwaway stack: mint 20 → amaka-mvsof9ya](https://testnet.nearblocks.io/txns/2rJNEbyivqBpS3kMcnkmKVW69Nbuw9Q7kw4o2fHiEfeh)
- [1. Deploy a throwaway stack: mint 20 → mike-mvsof9ya](https://testnet.nearblocks.io/txns/FihaSkJb55KNCoDfcaJdAgApnpZ8J9YqHZn54YZ2GypN)
- [1. Deploy a throwaway stack: oracle-mvsof9ya → register_repo](https://testnet.nearblocks.io/txns/A5qFXCPVAec4yEgRhYQqi8MHZhqfvK9auiWwavF8iSJE)
- [1. Deploy a throwaway stack: oracle-mvsof9ya → register_repo](https://testnet.nearblocks.io/txns/GiNAmHc37B9K4YdoFVELsz5fDHA3dJMGDYfhy3LArAns)
- [1. Deploy a throwaway stack: oracle-mvsof9ya → register_repo](https://testnet.nearblocks.io/txns/7eXUb1iLU3nfdTC25N6Ndu2ihbmJecrDhaEW5VjCouU8)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsof9ya pays bond on 1000001#1](https://testnet.nearblocks.io/txns/2g6qB2ynrgnMYsyLFDMXe5fmHrmJoFfBeiXWPLJioyE6)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsof9ya pays bond on 1000001#2](https://testnet.nearblocks.io/txns/3itmsCjcjjHFGM18FhXtSyXLtABrXr9rVWt4TbMfrVCj)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsof9ya pays bond on 1000001#3](https://testnet.nearblocks.io/txns/Bqyuo56i5LtskGZSHJXf6Ku2ZvwuKwf5mkwGPu7V3iHY)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsof9ya pays bond on 1000001#4](https://testnet.nearblocks.io/txns/jnfMZ9KwAbkepEcwjQbvoqLsmsqJmPS9CB3ju6ZWCmm)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/8sxBC7qwQHcpCLHivtcx9sGZgba9UvECvcfXxHVYhams)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/5HfPgecAeWkVcx4SnVwG4AVxgT4eLUeiCSVhEWQBPgbP)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/Aj5vxu9pAbQ2Vp8AWB3BZTm2P5AX4JfNsJXUU4Qj8tAg)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mvsof9ya pays bond on 1000001#4](https://testnet.nearblocks.io/txns/3Lpx55LPfiNXcCTe6aqHPq99X4beG9TSBCVAvxfWs8a9)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvsof9ya pays bond on 1000001#5](https://testnet.nearblocks.io/txns/HCvMQeKGyqaxiEAKUigv3NeDmepzDbap9PEPPiqQUHnw)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/72CvgLWY8nZ3jH5AyXQV7zf5NtkKpAxtvCMKNHmr79HM)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/CbsnNfJKJnWwTdRU4vhEtoqb5aHKjNy6fmyZeTuwc4Ds)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvsof9ya pays bond on 1000001#6](https://testnet.nearblocks.io/txns/CuRq5EgEsjxFXYcV3Fxipa96jWHU5oMd9qiYZHEzSinz)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/CsWhWvdm4PHRhtctmLA3eo58Q769MENG4Vvb4bBsqUsv)
- [5. Slop funds the fix: alice-mvsof9ya pays bond on 1000001#7](https://testnet.nearblocks.io/txns/9wA36jsxwqUxEAT6ETpnu2R2VPsKxEZVjXLV9vFyeNK4)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/5ej1oNK4RVcf79XydQXbdU2NqJFpv6uHeQy1F38rNUrN)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/JCkb7RbSDcLue3vo1XuU9V2didcymj9V7CuDp1PqCvDX)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/AFaqxtFvsCNXmkRJ8J7bAqnij2MCD4bsJmtR36j3WQJT)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/4e4ZPQuT36kzZJwwYA5AQZKxYwcGv4QF9amLjfQx4449)
- [7. Bad input is refunded with a reason: alice-mvsof9ya pays bond on 1000001#8](https://testnet.nearblocks.io/txns/2haCYThPzyHU4KPUQ1sDeSoG6WPV9t4GkRPnFVU3e1YE)
- [7. Bad input is refunded with a reason: alice-mvsof9ya pays bond on 1000001#1](https://testnet.nearblocks.io/txns/J2V9Z9j2TQRNG67s6CQZwFBjETqcWxBJLnBZ4s1JXwga)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): mint 5 → gasless](https://testnet.nearblocks.io/txns/9dP4vPVDBs1q6BkkyMiSqhQjbJKxH33N7BKC7ymyhEA9)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): relayer submits the signed delegate](https://testnet.nearblocks.io/txns/EDtE2ArsDTQtvcu3d343LQQze9SVXGy7F3jLqS6JPbiy)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): oracle settles 1000001#20: refund](https://testnet.nearblocks.io/txns/5Y6dgxubgWKaF1trzuaYH2MTAFHWk7fhJrVDVg7zm3yp)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mvsof9ya → link_repo](https://testnet.nearblocks.io/txns/5ub2uBdPsG2oXFYfRgg342GiwsvgHuBpnwvNeY68dKML)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvsof9ya pays bond on 1000002#1](https://testnet.nearblocks.io/txns/EmNmYei3K6Tn1mU533SSxYrN1hXJrRt8K7WKmKVghsDc)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/58ui2RVUrZLMp9UCq5MhnkKRzUXpDN9VHdtKPcDzwZA7)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/BGX1K8HhaRBdseH5JcayLoFvxcMuTdfHCjxciM8eh1aw)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/3usf6HvDdEj1Hk3qruV95UtVRTwbQLudodqw2VqdL2WZ)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvsof9ya pays bond on 1000002#2](https://testnet.nearblocks.io/txns/DxACY8nRmc4FfpzimXmjcpAiSSswfD9YkBzz9WnWZudo)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/CjivmWcz3MkwWa97XgW8Rh8bnDT7sM7FTC5UZBrSeSNK)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/HDtDVwyageJJUP4hTE8U8uiZM1YVTi3auKtg2oUmSX9m)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/HMPn7CJrKTwYUodMZxfdqGszf7cVtvgVqfej3Fy1uNjN)
- [9. Agents: a capped budget and a function-call key: agent pays via the MCP server](https://testnet.nearblocks.io/txns/J6Dk6u5xktH5vmXdMcqJcTbPD1LQD2SAz5BHeesD9SkM)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/GaZvSmmoKY8Gp92qufhJh6eCmnznTcYu5BRkbM4eeebp)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/Ep1iUuxjgCJxV8mbEh5a4Kp7pYaBmVV1RGPFCEGUuTTQ)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/BuZmcqGtnprG9SfJjLypVGBF9mqqmtMuQDLRGoZtmMmS)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/9fayf3U7aEMAJTC26cfoqNBSvCFu6LzTAuxZ8fxg4RML)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mvsof9ya pays bond on 1000001#10](https://testnet.nearblocks.io/txns/7KahS7ZMnocLrCTX7ukYf8g2E95XyphBLwSEJfxT1Q3b)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/DUNrgJ139SJEAbGkbUX9RokWiR2kfjutUs4VMhUa2k9P)
- [12. NEAR bonds through the real wrap.testnet: vault registers with wrap.testnet](https://testnet.nearblocks.io/txns/GAwu6WUVWwdqGZKvnxqZ9y3rodSYL2F1gcrSDAv8rgUu)
- [12. NEAR bonds through the real wrap.testnet: oracle-mvsof9ya → register_repo](https://testnet.nearblocks.io/txns/FzbDqgpWxUfNctC7mQCZ8V7ep2rQs5scu9JjnbS43Lar)
- [12. NEAR bonds through the real wrap.testnet: oracle switches R4 to NEAR](https://testnet.nearblocks.io/txns/XrQaUBMwNM1Y2Pq5xame3xRiXwiwaQkduyxXr4H4KUr)
- [12. NEAR bonds through the real wrap.testnet: alice-mvsof9ya pays bond on 1000004#1](https://testnet.nearblocks.io/txns/564mzJxwugCRjxS1Bg8t9QTLGxfZ7gvyUb4V8KN8Avrt)
- [12. NEAR bonds through the real wrap.testnet: dana wraps 0.03950617283950617 NEAR and pays R4#1 in one transaction](https://testnet.nearblocks.io/txns/ApFkn14NctVKY5Npaqu7Nkj2dGNmZkveLcHSY2SvKoSm)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#1: refund](https://testnet.nearblocks.io/txns/2CcVYSgsXfcSTpBFj63ytbdSzsFP8ZG6xyqBYNysFgC1)
- [12. NEAR bonds through the real wrap.testnet: dana pays R4#2 from wNEAR](https://testnet.nearblocks.io/txns/Bk8QpJpQqNcfAbK7LjjsYodRo6yNtBjbHAf8WQUStCUM)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#2: forfeit](https://testnet.nearblocks.io/txns/695h6Y1a2d4Gq1SM2fMdJTeQPNVULZ9jx7ijuuZw5sKe)
- [12. NEAR bonds through the real wrap.testnet: oracle links R4 → amaka](https://testnet.nearblocks.io/txns/59KVCo4tro3vFKuzjcStAd8rYrt7RuUJaiMyvxQ5uc4w)
- [12. NEAR bonds through the real wrap.testnet: amaka registers with wrap.testnet](https://testnet.nearblocks.io/txns/FiZHZw8waCpH3kovxUoKwGc9vvGWWE5f4vs7pgu6uRNC)
- [12. NEAR bonds through the real wrap.testnet: amaka withdraws the NEAR vault](https://testnet.nearblocks.io/txns/85qzXQVCYvHiX1W7ziECM7phd4wwd9oj5q3Gfkb2k8dY)
- [12. NEAR bonds through the real wrap.testnet: amaka unwraps to plain NEAR](https://testnet.nearblocks.io/txns/8MKxXRDxgaPK981TdVUuZokpH14fnxho5nfYXus8UCyU)
- [12. NEAR bonds through the real wrap.testnet: dana unwraps her refund](https://testnet.nearblocks.io/txns/68miuFwm2ohFqxEzGGnrjKGJXPwKhF2bRYTkhVK9whny)
