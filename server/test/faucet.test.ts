// The testnet faucet tops up low wallets once a day, refuses everything else with a reason, and
// never sends what the faucet doesn't have.
import { describe, expect, test } from "bun:test";
import { Faucet, FaucetError, NEAR_DRIP, USDC_DRIP, type FaucetChain } from "../src/faucet";

function fakeChain(opts: { near?: Record<string, bigint>; usdc?: Record<string, bigint>; faucetUsdc?: bigint } = {}) {
  const sent: string[] = [];
  const registered = new Set(Object.keys(opts.usdc ?? {}));
  const chain: FaucetChain = {
    nearBalance: async (id) => opts.near?.[id] ?? (id.startsWith("ghost") ? null : 0n),
    usdcBalance: async (id) => opts.usdc?.[id] ?? 0n,
    usdcRegistered: async (id) => registered.has(id),
    faucetUsdc: async () => opts.faucetUsdc ?? 20_000_000n,
    faucetNear: async () => 9n * 10n ** 24n,
    sendNear: async (to, a) => void sent.push(`near ${to} ${a}`),
    registerUsdc: async (to) => void (registered.add(to), sent.push(`register ${to}`)),
    sendUsdc: async (to, a) => void sent.push(`usdc ${to} ${a}`),
  };
  return { chain, sent };
}

describe("testnet faucet", () => {
  test("a new wallet gets 0.2 NEAR and 2 USDC (registered for USDC first), once a day", async () => {
    const { chain, sent } = fakeChain();
    let t = 1_000;
    const f = new Faucet(chain, undefined, () => t);
    const d = await f.drip("Amaka.testnet", "1.2.3.4");
    expect(d).toMatchObject({ account_id: "amaka.testnet", near: NEAR_DRIP.toString(), usdc: USDC_DRIP.toString() });
    expect(sent).toEqual([`near amaka.testnet ${NEAR_DRIP}`, "register amaka.testnet", `usdc amaka.testnet ${USDC_DRIP}`]);
    expect(f.drip("amaka.testnet", "5.6.7.8")).rejects.toThrow("already got test funds today");
    t += 86_400_001;
    await f.drip("amaka.testnet", "5.6.7.8");
  });

  test("only what's missing is sent; nothing to send is an error", async () => {
    const { chain, sent } = fakeChain({ near: { "rich.testnet": 10n ** 25n, "both.testnet": 10n ** 25n }, usdc: { "both.testnet": 5_000_000n } });
    const f = new Faucet(chain);
    const d = await f.drip("rich.testnet", "a");
    expect(d.near).toBe("0");
    expect(d.usdc).toBe(USDC_DRIP.toString());
    expect(f.drip("both.testnet", "b")).rejects.toThrow("Nothing to send");
    expect(sent.some((s) => s.startsWith("near"))).toBe(false);
  });

  test("bad, missing or greedy requests are refused with a reason", async () => {
    const { chain } = fakeChain({ faucetUsdc: 0n });
    const f = new Faucet(chain, { perVisitorPerDay: 2, perDay: 3 });
    expect(f.drip("alice.near", "a")).rejects.toBeInstanceOf(FaucetError);
    expect(f.drip("ghost.testnet", "a")).rejects.toThrow("doesn't exist on testnet");
    const d = await f.drip("one.testnet", "v");
    expect(d.usdc).toBe("0");
    expect(d.note).toContain("faucet.circle.com");
    await f.drip("two.testnet", "v");
    expect(f.drip("three.testnet", "v")).rejects.toThrow("This browser");
    await f.drip("three.testnet", "w");
    expect(f.drip("four.testnet", "x")).rejects.toThrow("daily allowance");
  });
});
