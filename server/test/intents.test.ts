import { describe, expect, test } from "bun:test";
import { CHAINS, dryQuote, NEAR_USDC, NEAR_WNEAR, validate } from "../src/intents";

const ok = { amount: "5000000", chain: "base", recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", refund_to: "amaka.near" };

describe("NEAR Intents payout quotes", () => {
  test("bad input is refused with a reason before calling 1Click", () => {
    expect(() => validate({ ...ok, chain: "dogechain" })).toThrow("Unsupported chain");
    expect(() => validate({ ...ok, amount: "5" })).toThrow("at least 0.10");
    expect(() => validate({ ...ok, recipient: "amaka.near" })).toThrow("Base address");
    expect(() => validate({ ...ok, chain: "sol", recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" })).toThrow("Solana address");
    expect(validate(ok)).toBe("base");
  });

  test("always asks for a dry quote, NEAR USDC → the chosen chain's USDC", async () => {
    let sent: Record<string, unknown> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ signature: "ed25519:x", quote: { amountIn: "5000000", amountOut: "4996590", minAmountOut: "4946624", timeEstimate: 22, withdrawFee: "2400", refundFee: "5779" } });
    }) as unknown as typeof fetch;
    const q = await dryQuote(ok, fake);
    expect(sent.dry).toBe(true);
    expect(sent.originAsset).toBe(NEAR_USDC);
    expect(sent.destinationAsset).toBe(CHAINS.base.asset);
    expect(q).toMatchObject({ dry: true, chain: "Base", amount_out: "4996590", seconds: 22 });
  });

  test("a NEAR vault swaps wNEAR into USDC on the chosen chain", async () => {
    let sent: Record<string, unknown> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ signature: "ed25519:x", quote: { amountIn: "1", amountOut: "1", minAmountOut: "1", timeEstimate: 30 } });
    }) as unknown as typeof fetch;
    expect(() => validate({ ...ok, currency: "near", amount: "5000000" })).toThrow("at least 0.10 NEAR");
    await dryQuote({ ...ok, currency: "near", amount: (2n * 10n ** 24n).toString() }, fake);
    expect(sent.originAsset).toBe(NEAR_WNEAR);
    expect(sent.destinationAsset).toBe(CHAINS.base.asset);
  });

  test("a 1Click error is passed on in plain words", async () => {
    const fake = (async () => Response.json({ message: "recipient is not valid" }, { status: 400 })) as unknown as typeof fetch;
    await expect(dryQuote(ok, fake)).rejects.toThrow("recipient is not valid");
  });
});
