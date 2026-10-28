# PatchBond — end-to-end on NEAR testnet

Run `mvs884ko` · 2026-10-28T14:45:31.583Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mvs884ko.patchbond-e2e.testnet initialised with token usdc-mvs884ko.patchbond-e2e.testnet
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
- ✅ agent pays $1 with its function-call key
- ✅ agent pays another $1
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
**✅ ALL PASSED** in 384 s · 46 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mvs884ko → new](https://testnet.nearblocks.io/txns/EgKvB3oBLgSrvBERUGXacNYG4n2PeFR47SAawRtd7Tv5)
- [1. Deploy a throwaway stack: vault-mvs884ko → new](https://testnet.nearblocks.io/txns/6CEqH3d8wKFVWW15P2ZhQa1PvjWPwJ5Ywxj6Evk8wKYj)
- [1. Deploy a throwaway stack: mint 0 → vault-mvs884ko](https://testnet.nearblocks.io/txns/7jZU9uZfwwZxZGTaqofzZ2HLiS2W8yc3FTwDJyRqZf5S)
- [1. Deploy a throwaway stack: mint 100 → alice-mvs884ko](https://testnet.nearblocks.io/txns/D9mM5GfMgof2cUj3xkFzFkzMjUj5TFpAX83AmnVoHGF5)
- [1. Deploy a throwaway stack: mint 20 → bob-mvs884ko](https://testnet.nearblocks.io/txns/7jn2Y1VHQ5K7DM2AbPqsGPUSEUMTiKrkzMC1D4gnbwC2)
- [1. Deploy a throwaway stack: mint 20 → amaka-mvs884ko](https://testnet.nearblocks.io/txns/3UEdHCbfJpuPyM32b9afs4ThLdNWDqmeuBLYmAgW2Fnk)
- [1. Deploy a throwaway stack: mint 20 → mike-mvs884ko](https://testnet.nearblocks.io/txns/C6KS4zhgkwTbMvhFePAEYBVQNyVDkXy4vHnxqaX6Jfz8)
- [1. Deploy a throwaway stack: oracle-mvs884ko → register_repo](https://testnet.nearblocks.io/txns/2df5EuHa8BbcRKxbxyf7eg8pMX2CtWGKXz2whPss1u5K)
- [1. Deploy a throwaway stack: oracle-mvs884ko → register_repo](https://testnet.nearblocks.io/txns/7phzFPCXbRGWtpbQKFhuinRG3sExCQtUt1cb5z2MieQ5)
- [1. Deploy a throwaway stack: oracle-mvs884ko → register_repo](https://testnet.nearblocks.io/txns/9CiqaV77HV3UumX9cSezRdxHXd2CDcip5mWr8sXNzYPr)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs884ko pays bond on 1000001#1](https://testnet.nearblocks.io/txns/7BZNjto1ZJxksAqNuQ5sML3WY8LYrdY7Gs6rA2u7y4My)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs884ko pays bond on 1000001#2](https://testnet.nearblocks.io/txns/8yDhweSaqLAvVqr1axoGYsc5PyEQtNW4rRyVeKtL7Hb)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs884ko pays bond on 1000001#3](https://testnet.nearblocks.io/txns/4XVD1Vqt7RJkmavFNeF83otwFAzNt8wCyW2xFgSWvGk7)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvs884ko pays bond on 1000001#4](https://testnet.nearblocks.io/txns/GxobAixeE31jZ1CQWUrXsgi8KB33BMnCxZgm9mszB761)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/HMkckSXo2wSyJ4wxqfXRy992uoq6YvRqkSoMZXrkZMMr)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/5pEy7MTsbXH3Q6tRvjH9MNP2wsa15qb1mbe27M9zayWk)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/GF4XZpmVEPhi3dTjMxjf9doT2yj4MQDVEdNh1pNcJkZr)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mvs884ko pays bond on 1000001#4](https://testnet.nearblocks.io/txns/Fdj2KJuhvMs2ev9kxoqztTqsDWa1cBU2tf6ii6yyjR5M)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvs884ko pays bond on 1000001#5](https://testnet.nearblocks.io/txns/Fpnw9rh9FJpF5HjatBqXeJKKs6Per4u9ETWDLamWda7b)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/CCRWHeTyQDK9RZqrAetMMEgLc7h24UUhpMzi4MrDRL4f)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/9hjMUg3gTLDJneLyYHKbdEUbHRk2ppFcfT4R3WaC7Gsh)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvs884ko pays bond on 1000001#6](https://testnet.nearblocks.io/txns/8UCj1f6QydtjjCURDCqiy5QqRU8xBBvepsB6NrYWJC6w)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/E2cXSqyDnmqXnti4F4bjWz7EvTJNF2FEHKNcgdHXPrEG)
- [5. Slop funds the fix: alice-mvs884ko pays bond on 1000001#7](https://testnet.nearblocks.io/txns/3tVtWu3p3yVu5n6iApZaojwvNE42Gqm7Kb9B6uG8LhoX)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/Bfx9cve3FkecQ3vEQA34fWwij4woNBqVC1nAzTaofxZS)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/Ew1FbEoTWRmXE1hQMrNPrvqDaBzP4gFM6RViMz2u86nA)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/Ez4fLGwZcTn9vbBspBefrsL6xrawW6uQ4uBiWxpUXwow)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/8HFEUaWDA7sy5D9Nr4mrge6iereFfNQCdQ2dLdotSgeh)
- [7. Bad input is refunded with a reason: alice-mvs884ko pays bond on 1000001#8](https://testnet.nearblocks.io/txns/5jGQryG5KiLYJ4cek9c8K8tmdYpeepNAvV1p6Xj5sKrc)
- [7. Bad input is refunded with a reason: alice-mvs884ko pays bond on 1000001#1](https://testnet.nearblocks.io/txns/3qDYmjKnmqiUi1MCzq1qH5vaTdFwGE5ARUe94brubPPe)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mvs884ko → link_repo](https://testnet.nearblocks.io/txns/J3qgBsd5bo9Lv3cDEjamvAu1xkv9nbwP7WgnMevy32h)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvs884ko pays bond on 1000002#1](https://testnet.nearblocks.io/txns/8ERJG6QwCWERKHwWBzRLNoSa2bvZWS3VPamiGZu9ofnJ)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/2sWzt27vs3YLFiATcXRNvYWQMRBXPz88BKwndL7Js1bV)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/56WhaqC7ujWrf74j7ti5GX6uWUCztQmdW5iEMAbbdAYS)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/Kdrcp8vqdkWCCg4wQeRWRFyaisARM9Cdm5uHEwcyavv)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvs884ko pays bond on 1000002#2](https://testnet.nearblocks.io/txns/F9uUU6UANBAkPh4CcQ63a1z6y3WmQYsLrTW6n8AJ83Fv)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/HhMChsLWVtFmUJG2MpkBeg6wCDax7QruDFsrnpea2DAW)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/CgZVvUgPe5CvK9dgmBsUrFMGSVz9w2jY3PB7oxmcXrhU)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/HHWsTervwN5nqtwuEgNdQwe4idMA8BA5t8L4tuKLhWn8)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#1](https://testnet.nearblocks.io/txns/2zeBm2xdvDxszLWkbYu2dvQdbsZMKuRYwKkeH3bayw2L)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/3i4QZLRRMuaK8YuBy2VzTqNc1rj8NGA7sL8t2iqkkQ5p)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/FnvTHVoD9HMeVBiLkA6KRfekgmZWjiXYaX6b5SyeW65S)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/52DExvtmwtzWNah1C6hSNwDiR2BfFsJdgaEngGK7Wa5S)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/3Zvmz8NvUiSTbdfCUyfuuCJw1yYtTHLadds5NCoZ4n8V)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mvs884ko pays bond on 1000001#10](https://testnet.nearblocks.io/txns/6i61aBWWvrhyxmg98Rbaoe79eJdpJokdi3MpsuBtWMnK)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/EjDbTfBoUiZ3we8pryEUsVNhMRrLxpKei3MpsvTAtP2S)
