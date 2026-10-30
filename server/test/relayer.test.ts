import { describe, expect, test } from "bun:test";
import { checkDelegate, type DecodedDelegate } from "../src/relayer";

const TOKEN = "usdc.testnet";
const PB = "patchbond-dev.testnet";

function d(over: { receiverId?: string; method?: string; deposit?: bigint; gas?: bigint; args?: object; actions?: number } = {}): DecodedDelegate {
  const fc = {
    methodName: over.method ?? "ft_transfer_call",
    // As borsh decodes it: a plain number array, not a Uint8Array.
    args: [...new TextEncoder().encode(JSON.stringify(over.args ?? { receiver_id: PB, amount: "2000000", msg: JSON.stringify({ action: "bond", repo_id: 1, number: 1, kind: "pr", github_user: "x" }) }))],
    gas: over.gas ?? 150_000_000_000_000n,
    deposit: over.deposit ?? 1n,
  };
  return {
    delegateAction: { senderId: "tunde.testnet", receiverId: over.receiverId ?? TOKEN, actions: Array.from({ length: over.actions ?? 1 }, () => ({ functionCall: fc })), nonce: 1n, maxBlockHeight: 1n, publicKey: {} },
    signature: {},
  };
}

describe("relayer only forwards bond payments", () => {
  test("a bond payment into PatchBond passes", () => {
    expect(() => checkDelegate(d(), TOKEN, PB)).not.toThrow();
  });
  test("anything else is refused with a reason", () => {
    expect(() => checkDelegate(d({ receiverId: "wrap.testnet" }), TOKEN, PB)).toThrow("USDC contract");
    expect(() => checkDelegate(d({ method: "ft_transfer" }), TOKEN, PB)).toThrow("Only ft_transfer_call");
    expect(() => checkDelegate(d({ deposit: 0n }), TOKEN, PB)).toThrow("1 yoctoNEAR");
    expect(() => checkDelegate(d({ gas: 300_000_000_000_000n }), TOKEN, PB)).toThrow("Too much gas");
    expect(() => checkDelegate(d({ actions: 2 }), TOKEN, PB)).toThrow("Exactly one");
    expect(() => checkDelegate(d({ args: { receiver_id: "thief.testnet", amount: "1", msg: "{}" } }), TOKEN, PB)).toThrow("only forwards payments into PatchBond");
    expect(() => checkDelegate(d({ args: { receiver_id: PB, amount: "1", msg: JSON.stringify({ action: "fund_budget" }) } }), TOKEN, PB)).toThrow("Only bond, challenge and report");
  });
});
