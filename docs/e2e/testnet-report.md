# PatchBond — end-to-end on NEAR testnet

Run `mvx6a6ab` · 2026-11-01T01:49:58.753Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mvx6a6ab.patchbond-e2e.testnet initialised with USDC usdc-mvx6a6ab.patchbond-e2e.testnet and wNEAR wrap.testnet
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
**✅ ALL PASSED** in 381 s · 62 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mvx6a6ab → new](https://testnet.nearblocks.io/txns/ExQntepx1ajhLXvVC1BRTkWxnGEV5Zbuzimw6PnYX7Zp)
- [1. Deploy a throwaway stack: vault-mvx6a6ab → new](https://testnet.nearblocks.io/txns/Ce1FX11iDB3GE4uWjo3Nsbr3CfnTTDW9axzj1RU8utN3)
- [1. Deploy a throwaway stack: mint 0 → vault-mvx6a6ab](https://testnet.nearblocks.io/txns/Dq7gvdjqtrzPYVoEym1vnGMpYdtfTC1GfEVRov1Db2c5)
- [1. Deploy a throwaway stack: mint 100 → alice-mvx6a6ab](https://testnet.nearblocks.io/txns/BB7PoVo1PZRQiQhc4q3xgfZMFRCHdrmDRy8wumgndQSr)
- [1. Deploy a throwaway stack: mint 20 → bob-mvx6a6ab](https://testnet.nearblocks.io/txns/2LdN1fy8izij34yWziyFWjmR88tTKoGASeD8W6WxjNK9)
- [1. Deploy a throwaway stack: mint 20 → amaka-mvx6a6ab](https://testnet.nearblocks.io/txns/CJzZ1Kq2cchaVZ2bGxt4AfWJdRCCTyhvy253K1PQicTx)
- [1. Deploy a throwaway stack: mint 20 → mike-mvx6a6ab](https://testnet.nearblocks.io/txns/8x29P3a5rzzCMBtAwq7of5QJJcMV1LrWG59FT1wHb1dD)
- [1. Deploy a throwaway stack: oracle-mvx6a6ab → register_repo](https://testnet.nearblocks.io/txns/ERkF3amjTmfW5pn1B3WFkrbbdVdYjwUkki5b6Nw2bVDR)
- [1. Deploy a throwaway stack: oracle-mvx6a6ab → register_repo](https://testnet.nearblocks.io/txns/9mbvm7gXbEPyduCztyKthPqcE4Y8KknCQeWCkYexuN38)
- [1. Deploy a throwaway stack: oracle-mvx6a6ab → register_repo](https://testnet.nearblocks.io/txns/5jyqPnNYyygF95Xkp5pQPjr754meoJUMHx2oZR8y4S5w)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvx6a6ab pays bond on 1000001#1](https://testnet.nearblocks.io/txns/C1yh9ez4S2nXLPYdM5HUuHtpMEUNyJt2hAmtGCHNvLKP)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvx6a6ab pays bond on 1000001#2](https://testnet.nearblocks.io/txns/ArhPtyWAs7RAD6gRRRY6754HnF9KWLQUPMKnk8AFJuwW)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvx6a6ab pays bond on 1000001#3](https://testnet.nearblocks.io/txns/7dbukARkWU8nxQ2TP6WScYiANCkWw2DNvWsStqu8a4XY)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvx6a6ab pays bond on 1000001#4](https://testnet.nearblocks.io/txns/6cPoW8Wu2CvHfFNTPwzLEGXaAVEjcymFztjc6gXkAW5)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/4MAh2VYUmXJL8Deywvkr3cnW63f3ZkDTXN7CfUtNZLSi)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/4jHj2ewodbQUwPPFUd3HTzLY8F4vukau2MM6xftWBgqX)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/9RqUChKMoDipsXn1CSNSi5rKXyo1s1civ9cCB58iNN2Y)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mvx6a6ab pays bond on 1000001#4](https://testnet.nearblocks.io/txns/Due5AjLGXpMqZjAmxxJd92uNmJmnWmVvnvVX4PkQ5XLp)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvx6a6ab pays bond on 1000001#5](https://testnet.nearblocks.io/txns/4o2HCKHzdHREfvLC2AjGBE7cf7RBuU2fEkvvfuXPrU6r)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/CPoNsXgop99Vis8hVBeqH4MDnTpH3Dt37xxbQF1jNKVN)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/2vPCWLBZXkYXrDSyQ9omxwhfVwEcFUCNEZwie2o1Nk2L)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvx6a6ab pays bond on 1000001#6](https://testnet.nearblocks.io/txns/EddDcVqtWBUTqdDU2VeLQ6SLWLBVcHKEDpiTPWgYUDx2)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/9hVFXgz3NbzeHoSgxVSUL96APmr1vBuCZ4LVcPWffUHn)
- [5. Slop funds the fix: alice-mvx6a6ab pays bond on 1000001#7](https://testnet.nearblocks.io/txns/3EjxjLKv1HM3Cvyer3LcnjJUXTKH3vQnP6kVpHWGfzWh)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/5QR9k6JsMq1qZ1nZEprn9JnTJ5c9gRRXKuJiMhsvQtmn)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/4kDScwybDX3c4NekWM4thTXaaMtFU8gGXqJT8KZ7hZ6i)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/9Q2sD4i58ut3uA6VDAdfBnPtXdN7j7WpDgMyKVUQvCSU)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/8aeYdJdsw7mi3HTS1yrLqktEm6GD2nuMmgr4Sde2fhYW)
- [7. Bad input is refunded with a reason: alice-mvx6a6ab pays bond on 1000001#8](https://testnet.nearblocks.io/txns/7FCsWQNPCFe997FYTRNKerUfhjvWsdGRHL6MwsjpmDPw)
- [7. Bad input is refunded with a reason: alice-mvx6a6ab pays bond on 1000001#1](https://testnet.nearblocks.io/txns/GXH8iUk7we6fDMpeVkJWiXP5QJU8WJZJ8JST8jiUBn8d)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): mint 5 → gasless](https://testnet.nearblocks.io/txns/CEWzRcELmrdfr1dLxvXetAarMP5dg1XfVfVpXLpg3jUp)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): relayer submits the signed delegate](https://testnet.nearblocks.io/txns/HL4mfEKPXAqbCdWUHhYyVScpKC6ViBoP7Bt9NDPojCB1)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): oracle settles 1000001#20: refund](https://testnet.nearblocks.io/txns/2dr4PQ5edW6UkS9tvaQjBr4dnDtvg4djLjxvZSnnhQRW)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mvx6a6ab → link_repo](https://testnet.nearblocks.io/txns/96Ysg6QoHdxGhHvaPG8CejaVqo1yesv9inLGQaCCyd2E)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvx6a6ab pays bond on 1000002#1](https://testnet.nearblocks.io/txns/6DjH376vGrBL1gRGfU7JhRayu6W1ABq8JhX1SD4xYuaC)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/Dc5oH6J76hWW2xLHezktRb3kQdZrckC4gyFyd13jHSG8)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/3CXBbfAgw7vnqniPvjr8AmwvQzk2xm6jCJNnXxaNoebz)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/96f5wmaEsDqvXrPVax2pzfFegzP91gNuWKhJsM7Jg3zK)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvx6a6ab pays bond on 1000002#2](https://testnet.nearblocks.io/txns/EBobkrRAGaciACPtefYzMe7BnnfbKz6sQZoqVZY2fnEs)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/7Xt2CCydYx6KmywbAVbeKSyArfvoxbqsTpdZJLj4pWeR)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/75FKfx4NBYCe3Yka9ju1j6wTZABZWWYGhgaddUpe11zn)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/6PiMoFbLmA4i7pFgfKoTYxVJYbjZXgruDYpWesiAHgi5)
- [9. Agents: a capped budget and a function-call key: agent pays via the MCP server](https://testnet.nearblocks.io/txns/5Paok1JcMCU9e5vYTgSMs7VmxTz3FyD32vJn3ACLfkav)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/3XRPEN4SVKeMRKjRaf3gpZw71Cw1pWdD8LvK7UjKRY87)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/HkffvdMHZJrv6rTKFk3TfJHktT5PPXL3gF6bSvnyy51c)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/31jy2YGezbM3YBLRn3R86mwwiYTrawmmNxiRYXVde7c3)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/57pstBoQ8gagy4caxqghWpZxVh8v7Ei5EZURRAmZLMvU)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mvx6a6ab pays bond on 1000001#10](https://testnet.nearblocks.io/txns/39qNomqznNwGYQj2BK6bpLzYpV6gWKVb7ib8DbG9xRsv)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/AFt7xdfnCbrVg2Ai9UWKritXhJGeTmyFpSGKLcA156Cu)
- [12. NEAR bonds through the real wrap.testnet: vault registers with wrap.testnet](https://testnet.nearblocks.io/txns/ETMGd3BEijVpysbNRQT8Yq8JfAhP1r4vKCLJimmqwBnr)
- [12. NEAR bonds through the real wrap.testnet: oracle-mvx6a6ab → register_repo](https://testnet.nearblocks.io/txns/GgDaXqkPp93eKzgHvRXCmCdpFLEfKoggiCNkqtxLrzTu)
- [12. NEAR bonds through the real wrap.testnet: oracle switches R4 to NEAR](https://testnet.nearblocks.io/txns/Bp1idU8b3RZSiDAfsPQoBFC91sqqk1i1qkeyo7zxzBiV)
- [12. NEAR bonds through the real wrap.testnet: alice-mvx6a6ab pays bond on 1000004#1](https://testnet.nearblocks.io/txns/3Es4hPSnExn2evfrW9AZpufzNtoSaDQYNQcJmqKtP3fF)
- [12. NEAR bonds through the real wrap.testnet: dana wraps 0.03950617283950617 NEAR and pays R4#1 in one transaction](https://testnet.nearblocks.io/txns/5D6RBrVaMCBXgSr7PpcjTX1FMbc3VGXFM5hJtWnHuLKq)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#1: refund](https://testnet.nearblocks.io/txns/6TrETaTh7eGQzEW4QgJrJwZMikuwikDAfBudMuPRmqTq)
- [12. NEAR bonds through the real wrap.testnet: dana pays R4#2 from wNEAR](https://testnet.nearblocks.io/txns/CySoPNbviBqo5re37uTu7cbmYQs9VhMZPNSA3c4jGY8R)
- [12. NEAR bonds through the real wrap.testnet: oracle settles 1000004#2: forfeit](https://testnet.nearblocks.io/txns/7g38TqKR6V14UKXPf7FhMpyHAJ3oKcHHfQaVBP9JFCLo)
- [12. NEAR bonds through the real wrap.testnet: oracle links R4 → amaka](https://testnet.nearblocks.io/txns/GdeqM9iFMvNaPha4V32yAYQ5zC9VwS88CqK85HcAhFTD)
- [12. NEAR bonds through the real wrap.testnet: amaka registers with wrap.testnet](https://testnet.nearblocks.io/txns/6qpxTMYKhZzzukkMrN46XJKRXEEN6Fx9uzfhffdWARRD)
- [12. NEAR bonds through the real wrap.testnet: amaka withdraws the NEAR vault](https://testnet.nearblocks.io/txns/EUTBr7tRp8BeMFN815K52We9hyyiyaZVH3rjHofgPK4R)
- [12. NEAR bonds through the real wrap.testnet: amaka unwraps to plain NEAR](https://testnet.nearblocks.io/txns/BqonnkWCQ2Pa98V9QXvZrPQqgqWGa4QuAK1KGTYsMw8B)
- [12. NEAR bonds through the real wrap.testnet: dana unwraps her refund](https://testnet.nearblocks.io/txns/8i9pgEqekPHsa1fgUiN3nPMNzWLefAZeAcoinNR95xHL)
