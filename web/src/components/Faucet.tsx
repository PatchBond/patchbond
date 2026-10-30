// "Get test funds": one click puts a little testnet NEAR (fees) and test USDC (a bond) into the
// connected wallet, from PatchBond's faucet account; links to the official faucets as a fallback.

import { Droplets } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "../lib/api";
import { useWallet } from "../lib/wallet";
import { Button, Spinner } from "./kit";

export function FaucetDialog({ trigger, open, onOpenChange }: { trigger?: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function drip() {
    if (!wallet.accountId) return;
    setBusy(true);
    try {
      const d = await api.faucet(wallet.accountId);
      const parts = [Number(d.near) > 0 && `${Number(BigInt(d.near) / 10n ** 21n) / 1000} NEAR`, Number(d.usdc) > 0 && `${Number(d.usdc) / 1e6} USDC`].filter(Boolean);
      const msg = `Sent ${parts.join(" + ")} to ${d.account_id}.`;
      setDone(d.note ? `${msg} (${d.note})` : msg);
      toast.success("Test funds sent", { description: msg });
    } catch (e) {
      toast.error("No test funds sent", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Droplets className="size-5 text-brand" /> Get test funds</DialogTitle>
          <DialogDescription>
            This is NEAR testnet — nothing here is real money. One click sends your wallet <b className="text-ink">0.05 NEAR</b> — enough for ~15 transactions' fees (saving a bond policy, linking a repo) — and{" "}
            <b className="text-ink">2 test USDC</b> for a bond. Once a day per account; it only tops up what you're missing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {wallet.accountId ? (
            <Button onClick={() => void drip()} disabled={busy} className="w-full">
              {busy ? <><Spinner /> Sending…</> : <>Send test funds to <span className="font-mono">{wallet.accountId}</span></>}
            </Button>
          ) : (
            <Button onClick={() => void wallet.connect()} className="w-full">Connect a testnet wallet first</Button>
          )}
          {done && <p className="rounded-xl border border-brand/30 bg-brand-soft px-3 py-2 text-sm">{done}</p>}
          <div className="border-t border-line pt-4 text-sm text-muted-foreground">
            Or use the official faucets (free):
            <ul className="mt-2 space-y-1.5">
              <li>
                Test NEAR (more, e.g. for a bond priced in NEAR) — <a className="text-brand hover:underline" href="https://near-faucet.io" target="_blank" rel="noreferrer">near-faucet.io</a>
              </li>
              <li>
                Test USDC — <a className="text-brand hover:underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com</a> → USDC → “Near Testnet”
              </li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
