// The maintainer's side of sealed security reports: turn them on (a key derived from a wallet
// signature — nothing to store), share the private reporting link, and decrypt reports and the
// enclave judge's reasons in this browser. PatchBond's server only ever holds ciphertext.

import { maintainerKeyFromSignature, open, publicKeyOf, reportKeyMessage, reportKeyNonce, sha256Hex, type Envelope } from "@patchbond/shared";
import { KeyRound, Lock, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, chain, type SealedReportSummary } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";
import { Button, Notice, Spinner, VerdictBadge } from "./kit";

const REPORT_BASE = 1_000_000_000_000;

interface Opened {
  text: string;
  details?: { final?: { reasons?: string[]; evidence?: { file: string; note: string }[]; rules_applied?: string[] }; facts?: Record<string, unknown>; request_body?: string; response_body?: string };
  hashesMatch?: boolean;
}

export function SecurityReports({ repoId }: { repoId: number }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const { data, loading, reload } = useAsync(async () => {
    const [mk, ek, reports] = await Promise.all([chain.reportKey(cfg, repoId), chain.enclaveKey(cfg), api.reports(repoId).catch(() => [] as SealedReportSummary[])]);
    return { mk, ek, reports };
  }, [repoId]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<number, Opened>>({});

  async function deriveKey(): Promise<string> {
    if (secret) return secret;
    if (!wallet.accountId) throw new Error("Connect your wallet first.");
    const s = await wallet.signMessage({ message: reportKeyMessage(wallet.accountId), recipient: "patchbond.reports", nonce: reportKeyNonce(wallet.accountId) });
    const sig = Uint8Array.from(atob(s.signature), (c) => c.charCodeAt(0));
    const sk = maintainerKeyFromSignature(sig);
    setSecret(sk);
    return sk;
  }

  async function enable() {
    setBusy("enable");
    try {
      const sk = await deriveKey();
      const out = await wallet.call(cfg.contract, "set_report_key", { repo_id: repoId, key: publicKeyOf(sk) }, { tgas: 30 });
      if (out.error) throw new Error(out.error);
      toast.success("Private security reports are on", { description: "Share the reporting link; only you can decrypt what arrives." });
      reload();
    } catch (e) {
      toast.error("Not turned on", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function decrypt(r: SealedReportSummary) {
    setBusy(`open:${r.number}`);
    try {
      const sk = await deriveKey();
      if (data?.mk && publicKeyOf(sk) !== data.mk) throw new Error("This wallet's key isn't the one reports are sealed to — connect the repo's payout account.");
      const full = await api.report(repoId, r.number);
      const text = open(JSON.parse(full.sealed) as Envelope, sk);
      let details: Opened["details"];
      let hashesMatch: boolean | undefined;
      if (r.record?.sealed_for_maintainer) {
        details = JSON.parse(open(r.record.sealed_for_maintainer as Envelope, sk));
        if (details?.request_body && details.response_body) {
          const [, req, resp] = r.record.signature.text.split(":");
          hashesMatch = sha256Hex(details.request_body) === req && sha256Hex(details.response_body) === resp;
        }
      }
      setOpened((o) => ({ ...o, [r.number]: { text, details, hashesMatch } }));
    } catch (e) {
      toast.error("Couldn't decrypt", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Spinner />;
  const link = `${window.location.origin}/report/${repoId}`;
  if (!data?.mk) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Let researchers send you vulnerability reports <b className="text-ink">sealed</b>: encrypted in their browser to you and to an enclave judge whose key no person holds. Each report
          carries a refundable bond; the enclave checks it against your real code, so made-up "AI slop" reports pay for your time.
        </p>
        <p className="text-muted-foreground">Turning it on asks your wallet to sign a message (free — that derives your decryption key, so there's nothing to store) and to save the public half on-chain.</p>
        {!data?.ek && <Notice tone="warn" title="The enclave judge isn't ready yet">Its key hasn't been published on-chain; reports will open once it is.</Notice>}
        <Button onClick={() => void enable()} disabled={!!busy || !wallet.accountId}>
          {busy === "enable" ? <><Spinner /> Sign in your wallet…</> : <><KeyRound className="size-4" /> Turn on private reports</>}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg p-3">
        <span className="text-muted-foreground">Reporting link — put it in your SECURITY.md:</span>
        <button
          className="font-mono text-xs text-brand hover:underline"
          onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}
        >
          {link}
        </button>
      </div>
      {data.reports.length === 0 && <p className="text-muted-foreground">No reports yet.</p>}
      <ul className="space-y-3">
        {data.reports.map((r) => {
          const o = opened[r.number];
          return (
            <li key={r.number} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">Report #{r.number - REPORT_BASE + 1}</span>
                <span className="text-faint">from {r.reporter} · {new Date(r.created_at).toLocaleString()}</span>
                {r.record ? <VerdictBadge verdict={r.record.final.verdict} /> : <span className="text-xs text-faint">judging, or bond unpaid</span>}
                <span className="flex-1" />
                {!o && (
                  <Button variant="ghost" onClick={() => void decrypt(r)} disabled={!!busy}>
                    {busy === `open:${r.number}` ? <Spinner /> : <><Unlock className="size-4" /> Decrypt</>}
                  </Button>
                )}
              </div>
              {o && (
                <div className="mt-3 space-y-3">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-raised p-3 font-mono text-xs">{o.text}</pre>
                  {o.details?.final?.reasons && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-faint">Judge's reasons (sealed to you)</div>
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {o.details.final.reasons.map((x, i) => <li key={i}>{x}</li>)}
                        {o.details.final.rules_applied?.map((x, i) => <li key={`r${i}`} className="text-warn">{x}</li>)}
                      </ul>
                    </div>
                  )}
                  {o.hashesMatch !== undefined && (
                    <div className={`flex items-center gap-2 text-xs ${o.hashesMatch ? "text-brand" : "text-danger"}`}>
                      <Lock className="size-3.5" /> {o.hashesMatch ? "The sealed request and response match what NEAR AI's enclave signed." : "The sealed bytes don't match the signature — don't trust this record."}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
