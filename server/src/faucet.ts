// Testnet faucet: one click gives a new wallet enough to try PatchBond — a little NEAR for fees (a
// maintainer saving the bond policy, linking a repo) and a little test USDC (a contributor paying a
// bond). Testnet only. Rate-limited per account, per visitor and per day, so the faucet account
// can't be drained; it only tops up wallets that are actually low.

import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";

// Fees only: a testnet transaction costs well under 0.003 NEAR, and USDC bonds are gasless, so
// 0.05 NEAR covers a tester's ~15–20 transactions — and stretches the faucet ~4× further.
export const NEAR_DRIP = 5n * 10n ** 22n; // 0.05 NEAR
const NEAR_ENOUGH = 10n ** 23n; // skip NEAR if they already hold 0.1
export const USDC_DRIP = 2_000_000n; // 2 USDC (6 decimals)
const USDC_STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, NEP-145 registration
const DAY = 86_400_000;

export interface FaucetChain {
  /** null when the account doesn't exist. */
  nearBalance(accountId: string): Promise<bigint | null>;
  usdcBalance(accountId: string): Promise<bigint>;
  usdcRegistered(accountId: string): Promise<boolean>;
  faucetUsdc(): Promise<bigint>;
  faucetNear(): Promise<bigint>;
  sendNear(to: string, amount: bigint): Promise<void>;
  registerUsdc(to: string): Promise<void>;
  sendUsdc(to: string, amount: bigint): Promise<void>;
}

export class FaucetError extends Error {}

export interface Drip {
  account_id: string;
  near: string; // yoctoNEAR sent ("0" if none)
  usdc: string; // USDC base units sent
  note: string;
}

export class Faucet {
  private byAccount = new Map<string, number>();
  private byVisitor = new Map<string, number[]>();
  private today: number[] = [];

  constructor(
    private chain: FaucetChain,
    private limits = { perVisitorPerDay: 2, perDay: 40 },
    private now = () => Date.now(),
  ) {}

  async drip(accountId: string, visitor: string): Promise<Drip> {
    const id = accountId.trim().toLowerCase();
    if (!/^([a-z0-9]+[-_])*[a-z0-9]+\.testnet$|^[0-9a-f]{64}$/.test(id)) {
      throw new FaucetError("Use a testnet account (name.testnet) — connect Meteor or Intear on testnet.");
    }
    const t = this.now();
    const last = this.byAccount.get(id);
    if (last && t - last < DAY) throw new FaucetError(`${id} already got test funds today. Try again in ${Math.ceil((DAY - (t - last)) / 3_600_000)} h, or use the faucets below.`);
    const mine = (this.byVisitor.get(visitor) ?? []).filter((x) => t - x < DAY);
    if (mine.length >= this.limits.perVisitorPerDay) throw new FaucetError("This browser has had its test funds for today. Use the faucets below.");
    this.today = this.today.filter((x) => t - x < DAY);
    if (this.today.length >= this.limits.perDay) throw new FaucetError("Our faucet has handed out its daily allowance. Use the faucets below — they're free.");

    const near = await this.chain.nearBalance(id);
    if (near === null) throw new FaucetError(`${id} doesn't exist on testnet yet. Create it in your wallet first.`);

    let nearSent = 0n;
    let usdcSent = 0n;
    const notes: string[] = [];
    if (near < NEAR_ENOUGH) {
      if ((await this.chain.faucetNear()) < NEAR_DRIP + 5n * 10n ** 23n /* keep 0.5 NEAR for the oracle's own fees */) notes.push("our NEAR faucet is empty — use near-faucet.io");
      else {
        await this.chain.sendNear(id, NEAR_DRIP);
        nearSent = NEAR_DRIP;
      }
    } else notes.push("you already have NEAR for fees");

    const usdc = (await this.chain.usdcRegistered(id)) ? await this.chain.usdcBalance(id) : 0n;
    if (usdc < USDC_DRIP) {
      if ((await this.chain.faucetUsdc()) < USDC_DRIP) notes.push("our USDC faucet is empty — use faucet.circle.com (\"Near Testnet\")");
      else {
        if (!(await this.chain.usdcRegistered(id))) await this.chain.registerUsdc(id);
        await this.chain.sendUsdc(id, USDC_DRIP);
        usdcSent = USDC_DRIP;
      }
    } else notes.push("you already have test USDC");

    if (nearSent === 0n && usdcSent === 0n) throw new FaucetError(`Nothing to send: ${notes.join("; ")}.`);
    this.byAccount.set(id, t);
    this.byVisitor.set(visitor, [...mine, t]);
    this.today.push(t);
    return { account_id: id, near: nearSent.toString(), usdc: usdcSent.toString(), note: notes.join("; ") };
  }
}

/** The real chain: transfers from the faucet account (the oracle by default) on testnet. */
export function nearFaucetChain(rpc: string, faucetAccount: string, key: string, token: string): FaucetChain {
  const provider = new JsonRpcProvider({ url: rpc });
  const account = new Account(faucetAccount, provider, key as KeyPairString);
  const view = <T>(method: string, args: Record<string, unknown>) => provider.callFunction<T & {}>({ contractId: token, method, args }) as Promise<T>;
  const near = async (id: string) => {
    try {
      return BigInt((await provider.viewAccount({ accountId: id })).amount);
    } catch {
      return null;
    }
  };
  return {
    nearBalance: near,
    faucetNear: async () => (await near(faucetAccount)) ?? 0n,
    usdcBalance: async (id) => BigInt((await view<string>("ft_balance_of", { account_id: id })) ?? "0"),
    faucetUsdc: async () => BigInt((await view<string>("ft_balance_of", { account_id: faucetAccount })) ?? "0"),
    usdcRegistered: async (id) => (await view<unknown>("storage_balance_of", { account_id: id })) !== null,
    sendNear: async (to, amount) => {
      await account.transfer({ receiverId: to, amount });
    },
    registerUsdc: async (to) => {
      await account.callFunction({ contractId: token, methodName: "storage_deposit", args: { account_id: to, registration_only: true }, deposit: USDC_STORAGE, gas: 30_000_000_000_000n });
    },
    sendUsdc: async (to, amount) => {
      await account.callFunction({ contractId: token, methodName: "ft_transfer", args: { receiver_id: to, amount: amount.toString(), memo: "PatchBond testnet faucet" }, deposit: 1n, gas: 30_000_000_000_000n });
    },
  };
}
