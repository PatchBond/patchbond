import { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppConfig } from "./api";

export interface CallResult {
  hash: string;
  /** Our contract's panic message if a receipt failed (e.g. a refunded ft_transfer_call). */
  error: string | null;
}

/** One function call inside a transaction. */
export interface Act {
  methodName: string;
  args: object;
  /** yoctoNEAR (or token-less 1 yocto for NEP-141 calls). */
  deposit?: string;
  tgas?: number;
}

interface WalletState {
  accountId: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  call: (receiverId: string, methodName: string, args: object, opts?: { deposit?: string; tgas?: number }) => Promise<CallResult>;
  /**
   * Several actions per transaction and/or several transactions, signed once in the wallet (e.g.
   * register with wNEAR + wrap NEAR + pay the bond). Reports the first contract panic, if any.
   */
  send: (txs: { receiverId: string; actions: Act[] }[]) => Promise<CallResult>;
  /**
   * Gasless (NEP-366): the wallet signs a delegate action and PatchBond's relayer pays the gas.
   * Falls back to a normal transaction if the wallet can't sign delegate actions.
   */
  callGasless: (receiverId: string, methodName: string, args: object, opts?: { deposit?: string; tgas?: number }) => Promise<CallResult & { gasless: boolean }>;
  /** NEP-413: sign an off-chain message (proves control of the account; costs nothing). */
  signMessage: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ accountId: string; publicKey: string; signature: string }>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ cfg, children }: { cfg: AppConfig; children: ReactNode }) {
  const connector = useMemo(
    () =>
      new NearConnector({
        network: cfg.network,
        // On testnet, list only wallets that support it (HOT doesn't flag testnet; Meteor and Intear do).
        features: cfg.network === "testnet" ? { testnet: true, signAndSendTransaction: true } : { signAndSendTransaction: true },
        footerBranding: { icon: `${location.origin}/favicon.svg`, heading: "PatchBond", link: location.origin, linkText: "Refundable bonds for pull requests" },
      }),
    [cfg.network],
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    connector
      .getConnectedWallet()
      .then(({ accounts }) => setAccountId(accounts[0]?.accountId ?? null))
      .catch(() => setAccountId(null));
    const onIn = (t: { accounts: { accountId: string }[] }) => setAccountId(t.accounts[0]?.accountId ?? null);
    const onOut = () => setAccountId(null);
    connector.on("wallet:signIn", onIn);
    connector.on("wallet:signOut", onOut);
    return () => {
      connector.off("wallet:signIn", onIn);
      connector.off("wallet:signOut", onOut);
    };
  }, [connector]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await connector.connect();
    } finally {
      setConnecting(false);
    }
  }, [connector]);

  const disconnect = useCallback(async () => {
    await connector.disconnect();
    setAccountId(null);
  }, [connector]);

  const send = useCallback<WalletState["send"]>(
    async (txs) => {
      const wallet = await connector.wallet();
      const toActions = (acts: Act[]) =>
        acts.map((a) => ({
          type: "FunctionCall" as const,
          params: { methodName: a.methodName, args: a.args, gas: `${a.tgas ?? 150}000000000000`, deposit: a.deposit ?? "0" },
        }));
      if (txs.length === 1) {
        return readOutcome(await wallet.signAndSendTransaction({ receiverId: txs[0]!.receiverId, actions: toActions(txs[0]!.actions) }));
      }
      const outcomes = await wallet.signAndSendTransactions({
        transactions: txs.map((t) => ({ receiverId: t.receiverId, actions: toActions(t.actions) })),
      });
      const results = outcomes.map(readOutcome);
      return results.find((r) => r.error) ?? results[results.length - 1]!;
    },
    [connector],
  );

  const call = useCallback<WalletState["call"]>(
    (receiverId, methodName, args, opts = {}) => send([{ receiverId, actions: [{ methodName, args, ...opts }] }]),
    [send],
  );

  const callGasless = useCallback<WalletState["callGasless"]>(
    async (receiverId, methodName, args, opts = {}) => {
      const wallet = await connector.wallet();
      const action = { type: "FunctionCall" as const, params: { methodName, args, gas: `${opts.tgas ?? 150}000000000000`, deposit: opts.deposit ?? "0" } };
      let signed: string | undefined;
      try {
        signed = (await wallet.signDelegateActions({ delegateActions: [{ receiverId, actions: [action] }] })).signedDelegateActions[0];
      } catch (e) {
        // Wallet can't do delegate actions (or the user closed it): use a normal transaction.
        if (/reject|cancel|closed|denied/i.test(String((e as Error).message))) throw e;
      }
      if (!signed) return { ...(await call(receiverId, methodName, args, opts)), gasless: false };
      const res = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed_delegate: signed }) });
      const body = (await res.json()) as { hash?: string; error?: string | null };
      if (!res.ok) throw new Error(body.error ?? `The relayer answered ${res.status}`);
      return { hash: body.hash ?? "", error: body.error ?? null, gasless: true };
    },
    [connector, call],
  );

  const signMessage = useCallback<WalletState["signMessage"]>(
    async (p) => {
      const wallet = await connector.wallet();
      const s = await wallet.signMessage(p);
      return { accountId: s.accountId, publicKey: s.publicKey, signature: s.signature };
    },
    [connector],
  );

  return <Ctx.Provider value={{ accountId, connecting, connect, disconnect, call, send, callGasless, signMessage }}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

interface Outcome {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: unknown;
  receipts_outcome?: { outcome: { status: unknown } }[];
}

/** The tx can succeed while a receipt (our ft_on_transfer) panicked and the token refunded. */
function readOutcome(raw: unknown): CallResult {
  const o = raw as Outcome;
  const hash = o.transaction?.hash ?? o.transaction_outcome?.id ?? "";
  const failures = [o.status, ...(o.receipts_outcome ?? []).map((r) => r.outcome.status)]
    .map((s) => (s && typeof s === "object" && "Failure" in s ? JSON.stringify((s as { Failure: unknown }).Failure) : null))
    .filter(Boolean) as string[];
  const panic = failures.map((f) => f.match(/Smart contract panicked: ([^"\\]+)/)?.[1]).find(Boolean);
  return { hash, error: panic ?? (failures[0] ? "The transaction failed on-chain; nothing was charged." : null) };
}
