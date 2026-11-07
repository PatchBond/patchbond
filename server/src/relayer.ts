// Gasless bonds (NEP-366 meta transactions). A contributor with USDC but no NEAR signs a *delegate
// action* in their wallet; we wrap it in a transaction from our relayer account and pay the gas.
// The relayer only forwards exactly one thing: USDC ft_transfer_call into the PatchBond contract,
// with the 1-yocto deposit and bounded gas — so it can't be used to relay anything else on our dime.

import { deserialize } from "borsh";
import { Account, SCHEMA, actions, type KeyPairString, type Provider } from "near-api-js";

const MAX_GAS = 150_000_000_000_000n;

export interface DecodedDelegate {
  delegateAction: {
    senderId: string;
    receiverId: string;
    /** Borsh decodes `args` as a plain number array. */
    actions: { functionCall?: { methodName: string; args: Uint8Array | number[]; gas: bigint; deposit: bigint } }[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: unknown;
  };
  signature: unknown;
}

export class RelayError extends Error {}

interface SubmitResult {
  transaction: { hash: string };
  transaction_outcome?: { outcome: { tokens_burnt?: string } };
  receipts_outcome?: { outcome: { status: unknown; tokens_burnt?: string } }[];
}

export function decodeSignedDelegate(base64: string): DecodedDelegate {
  try {
    return deserialize(SCHEMA.SignedDelegate, Buffer.from(base64, "base64")) as unknown as DecodedDelegate;
  } catch (e) {
    throw new RelayError(`That isn't a signed delegate action (${(e as Error).message}).`);
  }
}

/** Throws a RelayError saying what's wrong unless this is a plain bond (or challenge) payment. */
export function checkDelegate(d: DecodedDelegate, token: string, contract: string) {
  const a = d.delegateAction;
  if (a.receiverId !== token) throw new RelayError(`The relayer only forwards payments to the USDC contract (${token}).`);
  if (a.actions.length !== 1 || !a.actions[0]!.functionCall) throw new RelayError("Exactly one function call is allowed.");
  const fc = a.actions[0]!.functionCall!;
  if (fc.methodName !== "ft_transfer_call") throw new RelayError("Only ft_transfer_call is relayed.");
  if (BigInt(fc.deposit) !== 1n) throw new RelayError("ft_transfer_call must attach exactly 1 yoctoNEAR.");
  if (BigInt(fc.gas) > MAX_GAS) throw new RelayError("Too much gas requested (max 150 Tgas).");
  let args: { receiver_id?: string; msg?: string };
  try {
    args = JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args)));
  } catch {
    throw new RelayError("The call's arguments aren't JSON.");
  }
  if (args.receiver_id !== contract) throw new RelayError(`The relayer only forwards payments into PatchBond (${contract}).`);
  const action = (() => {
    try {
      return JSON.parse(args.msg ?? "").action as string;
    } catch {
      return "";
    }
  })();
  if (action !== "bond" && action !== "challenge" && action !== "report") throw new RelayError('Only bond, challenge and report payments are relayed (msg.action "bond", "challenge" or "report").');
}

const YOCTO_PER_NEAR = 10n ** 24n;
/** Most one relayed payment can burn: its 150 Tgas plus the delegate wrapper, at twice the minimum gas price. */
export const WORST_CASE_YOCTO = (MAX_GAS + 20_000_000_000_000n) * 200_000_000n;

export const formatNear = (yocto: bigint) => (Number(yocto / 10n ** 20n) / 10_000).toString();

/**
 * The relayer's NEAR spend across all senders, per UTC day. The per-account limit doesn't stop many
 * accounts; this does. Each payment holds the worst case before it's sent and settles at what it
 * burnt, so payments in flight can't push the day past the limit.
 */
export class GasBudget {
  private day = "";
  private used = 0n;

  constructor(
    private limit: bigint,
    private now: () => number = Date.now,
  ) {}

  private roll() {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) [this.day, this.used] = [today, 0n];
  }

  /** Holds `amount` or throws a RelayError saying when gasless payments resume. */
  reserve(amount: bigint) {
    this.roll();
    if (this.used + amount > this.limit)
      throw new RelayError(
        `Gasless payments have used today's gas budget (${formatNear(this.limit)} NEAR) and resume at 00:00 UTC. You can still pay now from a wallet that holds a little NEAR for gas.`,
      );
    this.used += amount;
    return this.day;
  }

  /** Replaces a reservation made on `day` with what the payment actually burnt (0 if it was never sent). */
  settle(day: string, reserved: bigint, burnt: bigint) {
    if (day === this.day) this.used += burnt - reserved;
  }

  spent() {
    this.roll();
    return this.used;
  }
}

export class Relayer {
  private account: Account;
  private recent = new Map<string, number>();
  readonly budget: GasBudget;

  constructor(
    accountId: string,
    key: string,
    provider: Provider,
    private token: string,
    private contract: string,
    dailyLimitYocto = 2n * YOCTO_PER_NEAR,
  ) {
    this.account = new Account(accountId, provider, key as KeyPairString);
    this.budget = new GasBudget(dailyLimitYocto);
  }

  /** Sends the wrapped delegate action from the relayer account. Separate so tests can stand in for the chain. */
  protected async submit(d: DecodedDelegate): Promise<SubmitResult> {
    return (await this.account.signAndSendTransaction({
      receiverId: d.delegateAction.senderId,
      actions: [actions.signedDelegate({ delegateAction: d.delegateAction as never, signature: d.signature as never })],
      waitUntil: "FINAL",
    })) as unknown as SubmitResult;
  }

  /**
   * Validates, rate-limits per sender and against the daily gas budget, and submits. Returns the relayer's tx hash and, if the
   * contract refused the payment (e.g. underpaid), its reason — the token refunds it in that case.
   */
  async relay(base64: string): Promise<{ hash: string; sender: string; error: string | null }> {
    const d = decodeSignedDelegate(base64);
    checkDelegate(d, this.token, this.contract);
    const sender = d.delegateAction.senderId;
    if (Date.now() - (this.recent.get(sender) ?? 0) < 10_000) throw new RelayError("One relayed payment per account every 10 seconds.");
    const day = this.budget.reserve(WORST_CASE_YOCTO);
    this.recent.set(sender, Date.now());
    let out: SubmitResult;
    try {
      out = await this.submit(d);
    } catch (e) {
      // Not knowing whether it landed, keep the worst case counted
      this.budget.settle(day, WORST_CASE_YOCTO, WORST_CASE_YOCTO);
      throw e;
    }
    const burnt = [out.transaction_outcome, ...(out.receipts_outcome ?? [])].reduce((sum, r) => sum + BigInt(r?.outcome.tokens_burnt ?? 0), 0n);
    this.budget.settle(day, WORST_CASE_YOCTO, burnt);
    const panic = (out.receipts_outcome ?? [])
      .map((r) => JSON.stringify(r.outcome.status))
      .map((t) => t.match(/Smart contract panicked: ([^"\\]+)/)?.[1])
      .find(Boolean);
    return { hash: out.transaction.hash, sender, error: panic ?? null };
  }
}
