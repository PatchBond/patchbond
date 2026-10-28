# PatchBond — end-to-end on NEAR testnet

Run `mvsbg2u5` · 2026-10-28T16:15:41.429Z · RPC https://test.rpc.fastnear.com · parent `patchbond-e2e.testnet`

### 1. Deploy a throwaway stack
- ✅ vault vault-mvsbg2u5.patchbond-e2e.testnet initialised with token usdc-mvsbg2u5.patchbond-e2e.testnet
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

### 7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366)
- ✅ the bond was paid by the gasless account
- ✅ it spent 0 yoctoNEAR (only the 1-yocto security deposit) — the relayer paid the gas
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
- deleted 9/9 accounts; their NEAR went back to patchbond-e2e.testnet

---
**✅ ALL PASSED** in 360 s · 49 transactions

## Transactions

- [1. Deploy a throwaway stack: usdc-mvsbg2u5 → new](https://testnet.nearblocks.io/txns/EaYgJ6N7a2Xc89o5nXuyhUxCztCUSGdM1MtCUv3mkVzF)
- [1. Deploy a throwaway stack: vault-mvsbg2u5 → new](https://testnet.nearblocks.io/txns/6C1WfXzp9tj8tQVBaLRuRYzySEaDKWnNpZuBESa19jrH)
- [1. Deploy a throwaway stack: mint 0 → vault-mvsbg2u5](https://testnet.nearblocks.io/txns/BJ6MBXRZqFWCrek6tMXiMRoE1dR2C5pYuEbVKmeTA8mF)
- [1. Deploy a throwaway stack: mint 100 → alice-mvsbg2u5](https://testnet.nearblocks.io/txns/f2smDsaVmMJJ65dWQt5GkZ2REU4MCHSUxbss25gfZPR)
- [1. Deploy a throwaway stack: mint 20 → bob-mvsbg2u5](https://testnet.nearblocks.io/txns/5y9FpbfJgE6zFbd7or1HyQ8wqcg8EL6kiwkBXKUMe3Wh)
- [1. Deploy a throwaway stack: mint 20 → amaka-mvsbg2u5](https://testnet.nearblocks.io/txns/4DWgsdbfWoMq3wsVUviyWKk39RTGD7wfVFnWXa5gyYDg)
- [1. Deploy a throwaway stack: mint 20 → mike-mvsbg2u5](https://testnet.nearblocks.io/txns/AAn1tDiq5exNeqQT3YjSNBCJZLFGKxdWHkSoqvEaDQyL)
- [1. Deploy a throwaway stack: oracle-mvsbg2u5 → register_repo](https://testnet.nearblocks.io/txns/GMWPYZ2wW4ixpbpRdhNEYFu7GgV3TqsiYdGNh1puq5HS)
- [1. Deploy a throwaway stack: oracle-mvsbg2u5 → register_repo](https://testnet.nearblocks.io/txns/GacAmjkr2NsmLYgJQLgCf1uHMpk5pmuV1jftTAFWCdzE)
- [1. Deploy a throwaway stack: oracle-mvsbg2u5 → register_repo](https://testnet.nearblocks.io/txns/5wbNsxxv9KrJrbkYjspo2FwUckax9L6HQNBFr8pocGCS)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsbg2u5 pays bond on 1000001#1](https://testnet.nearblocks.io/txns/6TTmM6V7tNzAr4tpTmXZqq1bTMijKDePt8kYhav6eydh)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsbg2u5 pays bond on 1000001#2](https://testnet.nearblocks.io/txns/AN3rHwUwbLKfqqkXzbmnXRAHzf3SSu99xtYdooUEftdi)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsbg2u5 pays bond on 1000001#3](https://testnet.nearblocks.io/txns/3S143qQLasbbwEqEBpfk5obAjSYcCWca9QuEbdvdRTez)
- [2. Attention pricing on-chain matches the web app's curve: alice-mvsbg2u5 pays bond on 1000001#4](https://testnet.nearblocks.io/txns/4H9FrV8XCpxdsSo7RYeYD9VwHTLudVjBnfaE5HvzJ8JF)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#1: refund](https://testnet.nearblocks.io/txns/GUUKHGULxPWV7CjTTGkx7WH1mqQeLRDvRkEeX6S4tWP3)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#2: forfeit](https://testnet.nearblocks.io/txns/5cgCfDQ4tqB7zbeGp4Xvvpv7BpHXxJK5Fy1WnFthfc5o)
- [3. Verdicts move money: refund, forfeit 90/10, void: oracle settles 1000001#4: void](https://testnet.nearblocks.io/txns/C7xb2NoGxtsVd5GLgJur5boaqS9MDX6MvEJsgu6gvPnq)
- [3. Verdicts move money: refund, forfeit 90/10, void: bob-mvsbg2u5 pays bond on 1000001#4](https://testnet.nearblocks.io/txns/3cYj9qiiPr74osex92djMo4Ue6bZzQHSE3YHX1uYFE4H)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvsbg2u5 pays bond on 1000001#5](https://testnet.nearblocks.io/txns/BWfrDBgQVF6VTb562DrunR5HL8SMEJfQd9jKJpf6VQWo)
- [4. Priority lane: tip earned only when reviewed in time: maintainer reviewed #5 (in window)](https://testnet.nearblocks.io/txns/8zRzCpwwn9Q6GDJdrLhYJWzqP9rs7tstMBRZHsAzwiNu)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#5: refund](https://testnet.nearblocks.io/txns/Fot7Ao87wrfZK2CsTuWejv3KAhUw6dvArfTTg4BeiB9C)
- [4. Priority lane: tip earned only when reviewed in time: alice-mvsbg2u5 pays bond on 1000001#6](https://testnet.nearblocks.io/txns/Fks45bU1uD4XehDGKPZpV1ABvSfmLGWc6UqarhKuKRKw)
- [4. Priority lane: tip earned only when reviewed in time: oracle settles 1000001#6: refund](https://testnet.nearblocks.io/txns/8UmSJN3KoQGq9S94UYLgNXGRiF444XJ95ot8M1Sx9bou)
- [5. Slop funds the fix: alice-mvsbg2u5 pays bond on 1000001#7](https://testnet.nearblocks.io/txns/64PkCFNyxFyQZVNHQCwTzayVJwxrotTa8mbuQ9un6hvB)
- [5. Slop funds the fix: oracle settles 1000001#7: forfeit](https://testnet.nearblocks.io/txns/325G9RqubiokvQWMbVN8qbd3b4S2Mg1rnoMJg6fYJLDQ)
- [5. Slop funds the fix: real fix merged → pay bounty to bob](https://testnet.nearblocks.io/txns/5wT5HoL7T5Nxciw673YZjSCHp2ttmN5FYyrULPeST8Pz)
- [6. Only the linked maintainer can withdraw: oracle links R1 → amaka](https://testnet.nearblocks.io/txns/HBgBDuy237QqPv8AjyLLdDeD1QajLrP149DjrYz5m6Y8)
- [6. Only the linked maintainer can withdraw: amaka withdraws the vault](https://testnet.nearblocks.io/txns/51HxMbEEEeDkEZX7QaqJjqAvaZgCb8nfivvZTHsMyKMr)
- [7. Bad input is refunded with a reason: alice-mvsbg2u5 pays bond on 1000001#8](https://testnet.nearblocks.io/txns/ENsqakXazMc6RSeEoYqjxY9okmV2XUcPUQwBdL7Xf9G6)
- [7. Bad input is refunded with a reason: alice-mvsbg2u5 pays bond on 1000001#1](https://testnet.nearblocks.io/txns/9Q9vh6gPVEHiShjkASLfApNKXUFAbJS181bs4yUBrri4)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): mint 5 → gasless](https://testnet.nearblocks.io/txns/GK2HGLdUG7SsMddn1zL4hbJM5JopoCP6TQDgfYonxnoR)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): relayer submits the signed delegate](https://testnet.nearblocks.io/txns/4yUDk8A85exZXWSfqNncy64jwQhdVWCeNDFum55253HY)
- [7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366): oracle settles 1000001#20: refund](https://testnet.nearblocks.io/txns/25HM1GbNoPaXYfSpZWoinqHQ249UyThnZs92VUQougPm)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle-mvsbg2u5 → link_repo](https://testnet.nearblocks.io/txns/EbBxmpjnXdARrkHG8PvqSvKUW6oR2rnt5N4CjdyabWMB)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvsbg2u5 pays bond on 1000002#1](https://testnet.nearblocks.io/txns/2aptPHxfimTYYqei1iyshEqLgrJsRnFF7TkZR1QHQZx5)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#1: forfeit](https://testnet.nearblocks.io/txns/96HAiUhxH6cNr8Jgre1vVQ7iioa4WM71PjpXcbFF1GMi)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice stakes to challenge](https://testnet.nearblocks.io/txns/yuhDEEAbudnf24Q1czsnZnuXV6xu8ZELQwFL2H9NxRf)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: stronger model overturns → refund](https://testnet.nearblocks.io/txns/FN6W6p7MrhAJaxT8jmFMFPhd3DCkdmweJTDcSffiroH5)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: alice-mvsbg2u5 pays bond on 1000002#2](https://testnet.nearblocks.io/txns/4d1ToDiMVwUGDFnp8wERpzx32XV8R93hjVM1DriDpqQ9)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: oracle settles 1000002#2: refund](https://testnet.nearblocks.io/txns/5b4Fu1RwmSuEFf8keaKwfxfEsaNzpiVn34iywMAMgGVv)
- [8. Optimistic verdicts: challenge and finalize, with a real 15-second window: bob (anyone) finalizes after the window](https://testnet.nearblocks.io/txns/EqsNGm33k6C1nv4A6Q8LJL8wUYVgX5dhW5WPoNNy4SVu)
- [9. Agents: a capped budget and a function-call key: mike funds a 10 USDC budget, cap 2.5/day](https://testnet.nearblocks.io/txns/J3Y8Sc4dGjXHmn5xoq4q2D1fZxgNwuYg8mCjBzYuEWNA)
- [9. Agents: a capped budget and a function-call key: agent pays via the MCP server](https://testnet.nearblocks.io/txns/FDJxaKvSGiJXTP1T43jWd3siee9Q1Nco1JTfUpJSZ8aD)
- [9. Agents: a capped budget and a function-call key: agent (function-call key) pays bond on R3#2](https://testnet.nearblocks.io/txns/PYVjWFapPkipLWMKLELTHzpML4mVsv9C1FTt49PQcDB)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#1: refund](https://testnet.nearblocks.io/txns/71or59cpUf518RrnDYnB86kM4uS8C2eTSH1kLeamJQ6V)
- [9. Agents: a capped budget and a function-call key: oracle settles 1000003#2: forfeit](https://testnet.nearblocks.io/txns/2FxYPBQorkHLrpP9iwAJ9hh2CnY2b2KnUH9oVSeWPfbV)
- [9. Agents: a capped budget and a function-call key: mike withdraws the rest](https://testnet.nearblocks.io/txns/Ee3nL3wKpGMqbpRrbgMxEN4kNTfVRufRNwJbJ1npCQY6)
- [10. Judge → chain: a signed verdict's hash lands on-chain: alice-mvsbg2u5 pays bond on 1000001#10](https://testnet.nearblocks.io/txns/23WdtrZdv6cRRqCMWP83inMmCSi6hbJZEFbMH6PtqAJf)
- [10. Judge → chain: a signed verdict's hash lands on-chain: oracle settles 1000001#10: forfeit](https://testnet.nearblocks.io/txns/7wqGv95hjuU8Q1gFeMkMFe2o7XjfCcQKF5avWQAUhdmz)
