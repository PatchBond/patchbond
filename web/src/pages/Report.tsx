// Report a security issue privately. The report is encrypted in this browser to the maintainer's key
// and the OutLayer enclave judge's key — PatchBond's server, and the public, only ever see ciphertext.
// A refundable bond comes with it; the enclave checks the report against the repo's real code.

import { seal } from "@patchbond/shared";
import { Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { FaucetDialog } from "../components/Faucet";
import { Button, Eyebrow, Notice, Panel, Spinner } from "../components/kit";
import { api, chain, money } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";

type Step = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "done"; number: number } | { kind: "error"; text: string };

export function ReportPage() {
  const repoId = Number(useParams().repoId);
  const cfg = useConfig();
  const wallet = useWallet();
  const { data, loading } = useAsync(async () => {
    const [repo, mk, ek, quote] = await Promise.all([
      chain.repo(cfg, repoId),
      chain.reportKey(cfg, repoId),
      chain.enclaveKey(cfg),
      chain.quote(cfg, repoId, wallet.accountId).catch(() => null),
    ]);
    return { repo, mk, ek, quote };
  }, [repoId, wallet.accountId]);
  const [text, setText] = useState("");
  const [reporter, setReporter] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });

  if (loading && !data) return <div className="p-10 text-center"><Spinner /></div>;
  const { repo, mk, ek, quote } = data ?? {};

  async function submit() {
    if (!repo || !mk || !ek || !quote || !wallet.accountId) return;
    try {
      setStep({ kind: "busy", text: "Encrypting in your browser…" });
      const sealed = JSON.stringify(seal(text, [mk, ek]));
      setStep({ kind: "busy", text: "Storing the sealed report…" });
      const r = await api.submitReport(repoId, sealed, reporter || wallet.accountId.split(".")[0]!);
      setStep({ kind: "busy", text: "Paying the bond — approve in your wallet…" });
      const amount = ((BigInt(quote) * 105n) / 100n).toString(); // the unused part comes straight back
      const msg = { action: "report", repo_id: repoId, number: r.number, sealed_sha256: r.sha256, reporter: (reporter || wallet.accountId.split(".")[0]!).slice(0, 39) };
      const out = await wallet.callGasless(cfg.token, "ft_transfer_call", { receiver_id: cfg.contract, amount, msg: JSON.stringify(msg) }, { deposit: "1" });
      if (out.error) throw new Error(out.error);
      setStep({ kind: "busy", text: "Asking the enclave to judge it…" });
      await api.judgeReport(repoId, r.number).catch(() => null);
      setStep({ kind: "done", number: r.number });
    } catch (e) {
      setStep({ kind: "error", text: (e as Error).message || "The wallet closed before signing. Nothing was sent." });
    }
  }

  const enabled = !!repo && !!mk && !!ek;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Eyebrow>Private security report</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Report a vulnerability — sealed.</h1>
      <p className="mt-3 text-muted-foreground">
        Your report is <b className="text-ink">encrypted in this browser</b> to two keys: the maintainer's, and an enclave judge's that no person holds (it was generated inside an Intel TDX
        enclave on OutLayer). PatchBond's server and the public only ever see ciphertext. The enclave checks the report against the repository's real code, asks a verifiable model in
        NEAR AI's TEE, and the contract checks its signature. A real report gets its bond back; a made-up one pays the maintainer for the time it took.
      </p>

      {!enabled && (
        <div className="mt-8">
          <Notice tone="warn" title={!repo ? "This repository isn't on PatchBond" : !mk ? "This repository hasn't turned on private reports" : "The enclave judge isn't ready yet"}>
            {!mk && repo ? "Ask the maintainer to turn on sealed reports in their PatchBond dashboard." : "Try again in a little while."}
          </Notice>
        </div>
      )}
      {enabled && repo.currency !== "usdc" && (
        <div className="mt-8"><Notice tone="warn" title="USDC repos only, for now">Sealed reports take USDC bonds; this repository prices bonds in NEAR.</Notice></div>
      )}

      {enabled && repo.currency === "usdc" && step.kind !== "done" && (
        <Panel className="mt-8 space-y-4 p-6">
          <label className="block text-sm font-medium">
            The report
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              maxLength={12_000}
              placeholder={"What's vulnerable, where (file, function), the impact, and steps to reproduce."}
              className="mt-2 w-full rounded-xl border border-line bg-bg p-3 font-mono text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm font-medium">
            How the maintainer can reach you <span className="font-normal text-faint">(GitHub login or a handle — optional)</span>
            <input value={reporter} onChange={(e) => setReporter(e.target.value)} maxLength={39} className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="text-sm text-muted-foreground">
              Bond <b className="text-ink">{quote ? money(quote, "usdc") : "…"}</b> USDC · refunded for a real report · no NEAR needed (we pay the gas)
              {cfg.network === "testnet" && (
                <> · <FaucetDialog trigger={<button className="text-brand hover:underline">get test USDC</button>} /></>
              )}
            </div>
            {wallet.accountId ? (
              <Button onClick={() => void submit()} disabled={step.kind === "busy" || text.trim().length < 40}>
                {step.kind === "busy" ? <><Spinner /> {step.text}</> : <><Lock className="size-4" /> Seal and send</>}
              </Button>
            ) : (
              <Button onClick={() => void wallet.connect()}>Connect a wallet</Button>
            )}
          </div>
          {step.kind === "error" && <Notice tone="error" title="Not sent">{step.text}</Notice>}
        </Panel>
      )}

      {step.kind === "done" && (
        <Panel className="mt-8 p-6">
          <div className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="size-5 text-brand" /> Sealed, bonded and sent to the enclave.</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Report #{step.number - 1_000_000_000_000 + 1} on this repository. The enclave usually answers within a minute or two; the verdict appears on the{" "}
            <Link className="text-brand hover:underline" to={`/r/${repoId}`}>repository page</Link>. Only the maintainer can read your report and the judge's reasons.
          </p>
        </Panel>
      )}
    </div>
  );
}
