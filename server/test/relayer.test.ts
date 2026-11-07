import { describe, expect, test } from "bun:test";
import { serialize } from "borsh";
import { SCHEMA } from "near-api-js";
import { checkDelegate, GasBudget, Relayer, WORST_CASE_YOCTO, type DecodedDelegate } from "../src/relayer";

const TOKEN = "usdc.testnet";
const PB = "patchbond-dev.testnet";

function d(over: { sender?: string; receiverId?: string; method?: string; deposit?: bigint; gas?: bigint; args?: object; actions?: number } = {}): DecodedDelegate {
  const fc = {
    methodName: over.method ?? "ft_transfer_call",
    // As borsh decodes it: a plain number array, not a Uint8Array.
    args: [...new TextEncoder().encode(JSON.stringify(over.args ?? { receiver_id: PB, amount: "2000000", msg: JSON.stringify({ action: "bond", repo_id: 1, number: 1, kind: "pr", github_user: "x" }) }))],
    gas: over.gas ?? 150_000_000_000_000n,
    deposit: over.deposit ?? 1n,
  };
  return {
    delegateAction: { senderId: over.sender ?? "tunde.testnet", receiverId: over.receiverId ?? TOKEN, actions: Array.from({ length: over.actions ?? 1 }, () => ({ functionCall: fc })), nonce: 1n, maxBlockHeight: 1n, publicKey: {} },
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

const NEAR = 10n ** 24n;

describe("the relayer's daily gas budget across all senders", () => {
  test("holds the worst case, settles at what was burnt, and starts over at 00:00 UTC", () => {
    let now = Date.parse("2026-11-07T10:00:00Z");
    const b = new GasBudget(NEAR / 10n, () => now);
    const day = b.reserve(NEAR / 20n);
    b.settle(day, NEAR / 20n, NEAR / 1000n);
    expect(b.spent()).toBe(NEAR / 1000n);
    b.reserve(NEAR / 20n);
    expect(() => b.reserve(NEAR / 20n)).toThrow("resume at 00:00 UTC");
    now = Date.parse("2026-11-08T00:00:01Z");
    expect(b.spent()).toBe(0n);
    expect(() => b.reserve(NEAR / 20n)).not.toThrow();
  });

  /** The chain is replaced: each payment burns `burnt` yoctoNEAR and nothing is sent. */
  class OfflineRelayer extends Relayer {
    sent = 0;
    constructor(limit: bigint, private burnt: bigint) {
      super("relayer.testnet", "ed25519:" + "1".repeat(64), {} as never, TOKEN, PB, limit);
    }
    protected override async submit() {
      this.sent++;
      await Bun.sleep(5);
      return { transaction: { hash: `tx${this.sent}` }, transaction_outcome: { outcome: { tokens_burnt: String(this.burnt) } }, receipts_outcome: [] };
    }
  }
  const signed = (sender: string) => Buffer.from(serialize(SCHEMA.SignedDelegate, { ...d({ sender }), signature: { ed25519Signature: { data: new Uint8Array(64) } }, delegateAction: { ...d({ sender }).delegateAction, publicKey: { ed25519Key: { data: new Uint8Array(32) } }, actions: [{ functionCall: { ...d().delegateAction.actions[0]!.functionCall!, args: Uint8Array.from(d().delegateAction.actions[0]!.functionCall!.args) } }] } } as never)).toString("base64");

  test("500 different accounts at once can't spend past the limit", async () => {
    // Worst-case burns: the limit fits exactly 10 payments, whoever sends them
    const r = new OfflineRelayer(WORST_CASE_YOCTO * 10n, WORST_CASE_YOCTO);
    const results = await Promise.allSettled(Array.from({ length: 500 }, (_, i) => r.relay(signed(`sender${i}.testnet`))));
    expect(r.sent).toBe(10);
    expect(results.filter((x) => x.status === "rejected").every((x) => /today's gas budget/.test(String((x as PromiseRejectedResult).reason)))).toBe(true);
    expect(r.budget.spent()).toBe(WORST_CASE_YOCTO * 10n);
  });

  test("cheap payments free their unused reservation for later senders", async () => {
    const r = new OfflineRelayer(WORST_CASE_YOCTO * 2n, WORST_CASE_YOCTO / 10n);
    // Counting only worst cases would stop at 2; each settles at a tenth, so 10 fit
    for (let i = 0; i < 10; i++) await r.relay(signed(`s${i}.testnet`));
    expect(r.sent).toBe(10);
  });
});
