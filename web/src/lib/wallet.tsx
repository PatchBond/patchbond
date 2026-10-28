import { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppConfig } from "./api";

export interface CallResult {
  hash: string;
  /** Our contract's panic message if a receipt failed (e.g. a refunded ft_transfer_call). */
  error: string | null;
}

interface WalletState {
  accountId: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  call: (receiverId: string, methodName: string, args: object, opts?: { deposit?: string; tgas?: number }) => Promise<CallResult>;
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

  const call = useCallback<WalletState["call"]>(
    async (receiverId, methodName, args, opts = {}) => {
      const wallet = await connector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName, args, gas: `${opts.tgas ?? 150}000000000000`, deposit: opts.deposit ?? "0" },
          },
        ],
      });
      return readOutcome(outcome);
    },
    [connector],
  );

  return <Ctx.Provider value={{ accountId, connecting, connect, disconnect, call }}>{children}</Ctx.Provider>;
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
