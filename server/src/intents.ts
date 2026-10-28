// Payout option B (SPEC §4.3): receive a vault withdrawal as USDC on another chain via NEAR Intents
// 1Click. Intents has no testnet, so the server only asks for *dry* quotes (no deposit address, no
// funds move). Going live on mainnet = withdraw to the maintainer's account, then transfer to the
// quote's deposit address — done only with the team's explicit go-ahead.

const ONE_CLICK = "https://1click.chaindefuser.com/v0";

/** Mainnet USDC on NEAR (Circle), the origin of every payout. */
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const CHAINS = {
  base: { name: "Base", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", address: "evm" },
  arb: { name: "Arbitrum", asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", address: "evm" },
  eth: { name: "Ethereum", asset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", address: "evm" },
  sol: { name: "Solana", asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", address: "solana" },
} as const;

export type Chain = keyof typeof CHAINS;

export interface PayoutQuoteRequest {
  /** USDC units (6 decimals). */
  amount: string;
  chain: string;
  recipient: string;
  /** NEAR account that gets the money back if the swap can't complete. */
  refund_to: string;
}

export interface PayoutQuote {
  dry: true;
  chain: string;
  amount_in: string;
  amount_out: string;
  min_amount_out: string;
  seconds: number;
  fees: { withdraw: string; refund: string };
  signature: string;
}

export class IntentsError extends Error {}

export function validate(r: PayoutQuoteRequest): Chain {
  if (!(r.chain in CHAINS)) throw new IntentsError(`Unsupported chain "${r.chain}". Choose one of: ${Object.keys(CHAINS).join(", ")}.`);
  const chain = r.chain as Chain;
  if (!/^\d+$/.test(r.amount) || BigInt(r.amount) < 100_000n) throw new IntentsError("The amount must be at least 0.10 USDC.");
  const ok = CHAINS[chain].address === "evm" ? /^0x[0-9a-fA-F]{40}$/.test(r.recipient) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.recipient);
  if (!ok) throw new IntentsError(`That doesn't look like a ${CHAINS[chain].name} address.`);
  if (!/^[a-z0-9._-]{2,64}$/.test(r.refund_to)) throw new IntentsError("refund_to must be a NEAR account.");
  return chain;
}

export async function dryQuote(r: PayoutQuoteRequest, http: typeof fetch = fetch): Promise<PayoutQuote> {
  const chain = validate(r);
  const res = await http(`${ONE_CLICK}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: NEAR_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: CHAINS[chain].asset,
      amount: r.amount,
      refundTo: r.refund_to,
      refundType: "ORIGIN_CHAIN",
      recipient: r.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  const body = (await res.json()) as {
    message?: string;
    signature?: string;
    quote?: { amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number; withdrawFee?: string; refundFee?: string };
  };
  if (!res.ok || !body.quote) throw new IntentsError(`NEAR Intents couldn't quote this: ${body.message ?? `HTTP ${res.status}`}.`);
  return {
    dry: true,
    chain: CHAINS[chain].name,
    amount_in: body.quote.amountIn,
    amount_out: body.quote.amountOut,
    min_amount_out: body.quote.minAmountOut,
    seconds: body.quote.timeEstimate,
    fees: { withdraw: body.quote.withdrawFee ?? "0", refund: body.quote.refundFee ?? "0" },
    signature: body.signature ?? "",
  };
}
