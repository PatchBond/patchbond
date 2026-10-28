import { formatUsdc, verifyRecord, type Check, type VerdictRecord } from "@patchbond/shared";
import { ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Scramble } from "../components/fx";
import { Seal, type SealState } from "../components/Seal";
import { useParams } from "react-router";
import { Button, Eyebrow, Hash, Notice, Panel, Spinner, VERDICT_STYLE, VerdictBadge } from "../components/kit";
import { api, chain, explorerTx, type Deposit, type Repo } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";

export function VerdictPage() {
  const { id = "" } = useParams();
  const { data: r, error, loading } = useAsync(() => api.verdict(id), [id]);
  if (loading) return <div className="grid min-h-[50vh] place-items-center text-muted-foreground"><Spinner /></div>;
  if (error || !r) return <div className="mx-auto max-w-xl px-4 py-24"><Notice tone="error" title="Verdict not found">{error}</Notice></div>;
  return <Verdict r={r} />;
}

function Verdict({ r }: { r: VerdictRecord }) {
  const v = r.final.verdict;
  const ghUrl = `https://github.com/${r.repo.full_name}/${r.kind === "pr" ? "pull" : "issues"}/${r.number}`;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      {r.mock && (
        <div className="mb-6">
          <Notice tone="warn" title="Mock judge — not a TEE verdict">
            This verdict came from PatchBond's deterministic stand-in judge, signed with a development key, while the NEAR AI Cloud account is being funded. The checks below still
            run for real; the signer just isn't an enclave.
          </Notice>
        </div>
      )}

      <div className="animate-rise">
        <a href={ghUrl} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:text-ink">
          {r.repo.full_name} <span className="text-faint">#{r.number}</span> · by @{r.author} ↗
        </a>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <VerdictBadge verdict={v} size="lg" />
          <ConfidenceBar value={r.final.confidence} />
        </div>
        <h1 className="mt-4 max-w-3xl text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{r.final.reasons[0] ?? VERDICT_STYLE[v].blurb}</h1>
        <p className="mt-2 text-sm text-faint">
          Judged {new Date(r.created_at).toLocaleString()} by <span className="font-mono">{r.model}</span>
        </p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel className="p-6">
            <Eyebrow>Reasons</Eyebrow>
            <ul className="mt-3 space-y-2">
              {r.final.reasons.map((x, i) => (
                <li key={i} className="flex gap-3 leading-relaxed">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-faint" />
                  {x}
                </li>
              ))}
            </ul>
            {r.final.evidence.length > 0 && (
              <>
                <div className="mt-6"><Eyebrow>Evidence</Eyebrow></div>
                <ul className="mt-3 space-y-2">
                  {r.final.evidence.map((e, i) => (
                    <li key={i} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-brand">
                        {e.file}
                        {e.line ? `:${e.line}` : ""}
                      </span>
                      <div className="mt-0.5 text-muted-foreground">{e.note}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {r.final.rules_applied.length > 0 && (
              <div className="mt-6">
                <Notice tone="info" title="Safety rules changed the model's answer">
                  {r.final.rules_applied.join(" · ")} (model said: <b>{r.model_verdict?.verdict ?? "invalid output"}</b>)
                </Notice>
              </div>
            )}
          </Panel>

          <Facts r={r} />
          <VerifyPanel r={r} />
          <RawBytes r={r} />
          <Appeals r={r} />
        </div>

        <div className="space-y-6">
          <OnChain r={r} />
          <Panel className="p-5 text-sm leading-relaxed text-muted-foreground">
            <Eyebrow>Why you can trust this</Eyebrow>
            <p className="mt-3">
              The model ran inside a trusted execution environment on NEAR AI Cloud. The enclave signed <span className="font-mono text-ink">model:sha256(request):sha256(response)</span>. This page
              keeps the exact bytes, so you can recompute both hashes and recover the signer — in your browser, without trusting PatchBond.
            </p>
            <p className="mt-3">
              The hash posted on-chain with the settlement commits to this signature, this PR and this verdict. Change any byte and a check fails.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" title="Model confidence">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-ink/70" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="num">{Math.round(value * 100)}% confident</span>
    </div>
  );
}

function Facts({ r }: { r: VerdictRecord }) {
  // Older records may lack newer fact fields.
  const f = {
    ...r.facts,
    unresolved_symbols: r.facts.unresolved_symbols ?? [],
    phantom_symbols: r.facts.phantom_symbols ?? [],
    injection_markers: r.facts.injection_markers ?? [],
    unbacked_claims: r.facts.unbacked_claims ?? [],
    assignment: r.facts.assignment ?? "no_issue",
  };
  const assignText = {
    ok: "assigned to the author",
    assigned_to_other: `assigned to ${f.issue?.assignees?.join(", ") ?? "someone else"}`,
    unassigned: "not assigned (repo requires it)",
    not_required: "not required by this repo",
    no_issue: "no linked issue",
  }[f.assignment];
  const items: [string, string, "ok" | "bad" | "meh"][] = [
    ["CI", f.ci === "none" ? "no CI" : f.ci, f.ci === "success" ? "ok" : f.ci === "failure" ? "bad" : "meh"],
    ["Phantom code", f.phantom_symbols.length ? f.phantom_symbols.join(", ") : "none", f.phantom_symbols.length ? "bad" : "ok"],
    ["Unresolved calls", f.unresolved_symbols.length ? f.unresolved_symbols.slice(0, 4).join(", ") : "none", "meh"],
    ["Duplicate", f.duplicate_of ? `#${f.duplicate_of.number} (${Math.round(f.duplicate_of.similarity * 100)}%)` : "none", f.duplicate_of ? "bad" : "ok"],
    ["Linked issue", f.issue ? `#${f.issue.number} ${f.issue.exists ? (f.issue.open ? "open" : "closed") : "doesn't exist"}` : "none", f.issue && !f.issue.exists ? "bad" : "meh"],
    ["Prompt injection", f.injection_markers.length ? `“${f.injection_markers[0]}”` : "none", f.injection_markers.length ? "bad" : "ok"],
    ["Claims vs diff", f.unbacked_claims.length ? `${f.unbacked_claims.length} claim${f.unbacked_claims.length > 1 ? "s" : ""} not in the diff: ${f.unbacked_claims.flatMap((c) => c.missing).slice(0, 4).join(", ")}` : "every claim backed", f.unbacked_claims.length ? "bad" : "ok"],
    ["Issue assignment", assignText, f.assignment === "assigned_to_other" || f.assignment === "unassigned" ? "bad" : f.assignment === "ok" ? "ok" : "meh"],
    ["Size", `${f.files_changed} files · +${f.additions} −${f.deletions}`, "meh"],
    ["Author", f.author_reputation, f.author_reputation === "has_forfeits" ? "bad" : f.author_reputation === "proven" ? "ok" : "meh"],
  ];
  const dot = { ok: "bg-brand", bad: "bg-danger", meh: "bg-faint" };
  return (
    <Panel className="p-6">
      <Eyebrow>Facts the server computed (the model can't invent these)</Eyebrow>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {items.map(([k, val, tone]) => (
          <div key={k} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot[tone]}`} />
            <div className="min-w-0">
              <dt className="text-faint">{k}</dt>
              <dd className="break-words">{val}</dd>
            </div>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function VerifyPanel({ r }: { r: VerdictRecord }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setChecks(null);
    setShown(0);
    const c = await verifyRecord(r);
    setChecks(c);
    for (let i = 1; i <= c.length; i++) {
      await new Promise((ok) => setTimeout(ok, 420));
      setShown(i);
    }
    setRunning(false);
    if (c.every((x) => x.ok)) toast.success("Verified in your browser", { description: "Bytes, signer and on-chain hash all match." });
    else toast.error("This record doesn't match its signature", { description: "Don't trust it." });
  }
  const done = checks && shown === checks.length;
  const allOk = done && checks.every((c) => c.ok);
  const state: SealState = running ? "checking" : done ? (allOk ? "ok" : "bad") : "idle";

  return (
    <Panel className={`relative overflow-hidden p-6 transition-colors duration-500 ${allOk ? "border-brand/50" : done ? "border-danger/50" : ""}`}>
      {allOk && <motion.div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand/15 blur-3xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <Seal state={state} size={132} mock={r.mock} />
        <div className="flex-1">
          <Eyebrow>Verify it yourself</Eyebrow>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Recomputes both SHA-256 hashes from the exact bytes, recovers the signer from the signature, and matches the hash posted on-chain. Runs in your browser — nothing is sent anywhere.
          </p>
          <Button onClick={() => void run()} disabled={running} className={`mt-4 ${checks ? "" : "animate-pulse-ring"}`}>
            {running ? <><Spinner /> Checking…</> : checks ? "Run again" : <><ShieldCheck className="size-4" /> Verify signature</>}
          </Button>
        </div>
      </div>
      {checks && (
        <ol className="relative mt-6 space-y-2">
          {checks.map((c, i) => {
            const visible = i < shown;
            const active = i === shown && running;
            return (
              <motion.li
                key={c.name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: visible || active ? 1 : 0.35, y: 0 }}
                className="flex gap-3 rounded-xl border border-line bg-bg px-3 py-2.5"
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
                  {visible ? (
                    <motion.span
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 15 }}
                      className={`grid size-5 place-items-center rounded-full text-xs font-bold ${c.ok ? "bg-brand text-brand-ink" : "bg-danger text-bg"}`}
                    >
                      {c.ok ? "✓" : "×"}
                    </motion.span>
                  ) : active ? (
                    <Spinner className="size-3.5 text-faint" />
                  ) : (
                    <span className="size-2 rounded-full bg-line" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <Scramble text={c.detail} active={active} className="block truncate font-mono text-xs text-faint" />
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
      {allOk && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative mt-4 text-sm text-brand">
          ✓ Untouched. Signed by {r.mock ? "the dev key " : "the enclave key "}
          <span className="font-mono">{r.signature.signing_address.slice(0, 10)}…</span>
          {!r.mock && (
            <>
              {" "}— check that key's TEE attestation at{" "}
              <a className="underline" href="https://docs.near.ai/cloud/verification" target="_blank" rel="noreferrer">
                NEAR AI Cloud
              </a>
              .
            </>
          )}
        </motion.div>
      )}
    </Panel>
  );
}

function RawBytes({ r }: { r: VerdictRecord }) {
  const pretty = (s: string) => {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  };
  const download = (name: string, text: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
  };
  return (
    <Panel className="p-6">
      <Eyebrow>Exact bytes</Eyebrow>
      <dl className="mt-3 grid gap-2 text-sm">
        <Row k="Signed text"><span className="break-all font-mono text-xs text-muted-foreground">{r.signature.text}</span></Row>
        <Row k="Signature"><Hash value={r.signature.signature} label="signature" /></Row>
        <Row k="Signer"><Hash value={r.signature.signing_address} label="signing address" /></Row>
        <Row k="Chat id"><Hash value={r.chat_id} label="chat id" /></Row>
        <Row k="Verdict hash"><Hash value={r.verdict_hash} label="verdict hash" /></Row>
      </dl>
      {(["request_body", "response_body"] as const).map((k) => (
        <details key={k} className="group mt-4 rounded-lg border border-line">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-ink">
            {k === "request_body" ? "Request sent to the model" : "Response from the model"}
            <span className="text-xs text-faint">{(r[k].length / 1024).toFixed(1)} KB</span>
          </summary>
          <div className="border-t border-line p-3">
            <button onClick={() => download(`${r.id}-${k === "request_body" ? "request" : "response"}.json`, r[k])} className="mb-2 text-xs text-brand hover:underline">
              Download exact bytes
            </button>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">{pretty(r[k])}</pre>
          </div>
        </details>
      ))}
    </Panel>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3">
      <dt className="text-faint">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// ---- On-chain state and actions ----

function OnChain({ r }: { r: VerdictRecord }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const { data, reload, loading } = useAsync(
    () => Promise.all([chain.deposit(cfg, r.repo.id, r.number), chain.repo(cfg, r.repo.id)]),
    [cfg, r.repo.id, r.number],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string; hash?: string } | null>(null);
  const [deposit, repo] = data ?? [null, null];

  async function act(label: string, f: () => Promise<{ hash: string; error: string | null }>) {
    setBusy(label);
    setResult(null);
    try {
      const out = await f();
      setResult(out.error ? { tone: "error", text: out.error, hash: out.hash } : { tone: "ok", text: `${label}: done.`, hash: out.hash });
      if (out.error) toast.error(`${label} failed`, { description: out.error });
      else toast.success(`${label}: confirmed on-chain`);
      reload();
    } catch (e) {
      setResult({ tone: "error", text: (e as Error).message || "The wallet rejected the request." });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Panel className="p-5"><Spinner /></Panel>;
  if (!deposit) {
    return (
      <Panel className="p-5">
        <Eyebrow>On-chain</Eyebrow>
        <p className="mt-3 text-sm text-muted-foreground">No deposit for this {r.kind === "pr" ? "PR" : "issue"} on {cfg.network}. This verdict is a demo judgement — nothing was settled.</p>
      </Panel>
    );
  }
  const me = wallet.accountId;
  const isPayer = me === deposit.payer;
  const isMaintainer = !!repo?.payout && me === repo.payout;
  const status = describe(deposit);
  const hashMatches = deposit.verdict_hash === r.verdict_hash;

  return (
    <Panel className="p-5">
      <Eyebrow>On-chain · {cfg.network}</Eyebrow>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="num text-3xl font-semibold">${formatUsdc(deposit.bond)}</span>
        <span className="text-sm text-muted-foreground">bond{deposit.tip !== "0" ? ` + $${formatUsdc(deposit.tip)} tip` : ""}</span>
      </div>
      <div className="mt-1 text-xs text-faint">paid by <span className="font-mono">{deposit.payer}</span></div>
      <div className="mt-4 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm">
        <div className="font-medium">{status.title}</div>
        <div className="mt-0.5 text-muted-foreground">{status.detail}</div>
      </div>
      {deposit.verdict_hash && (
        <div className={`mt-3 text-xs ${hashMatches ? "text-brand" : "text-warn"}`}>
          {hashMatches ? "✓ On-chain hash matches this verdict" : "On-chain hash is from a different verdict (e.g. a maintainer override or re-judge)"}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {typeof deposit.status === "object" && "proposed" in deposit.status && (
          <ProposedActions
            deposit={deposit}
            repo={repo}
            isPayer={isPayer}
            isMaintainer={isMaintainer}
            busy={busy}
            onChallenge={() =>
              act("Challenge", () =>
                wallet.call(cfg.token, "ft_transfer_call", {
                  receiver_id: cfg.contract,
                  amount: deposit.bond,
                  msg: JSON.stringify({ action: "challenge", repo_id: r.repo.id, number: r.number }),
                }, { deposit: "1" }),
              )
            }
            onFinalize={() => act("Finalize", () => wallet.call(cfg.contract, "finalize", { repo_id: r.repo.id, number: r.number }))}
          />
        )}
        {isMaintainer && (deposit.status === "held" || (typeof deposit.status === "object" && !("settled" in deposit.status))) && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" disabled={!!busy} onClick={() => act("Refund", () => wallet.call(cfg.contract, "settle", { repo_id: r.repo.id, number: r.number, verdict: "refund", verdict_hash: r.verdict_hash }))}>
              Refund
            </Button>
            <Button variant="danger" disabled={!!busy} onClick={() => act("Forfeit", () => wallet.call(cfg.contract, "settle", { repo_id: r.repo.id, number: r.number, verdict: "forfeit", verdict_hash: r.verdict_hash }))}>
              Forfeit
            </Button>
          </div>
        )}
        {!me && deposit.status !== "held" && !(typeof deposit.status === "object" && "settled" in deposit.status) && (
          <Button variant="ghost" className="w-full" onClick={() => void wallet.connect()}>
            Connect wallet to act
          </Button>
        )}
      </div>
      {busy && <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> {busy}: confirm in your wallet…</div>}
      {result && (
        <div className="mt-3">
          <Notice tone={result.tone}>
            {result.text}{" "}
            {result.hash && (
              <a href={explorerTx(cfg, result.hash)} target="_blank" rel="noreferrer">
                View transaction
              </a>
            )}
          </Notice>
        </div>
      )}
    </Panel>
  );
}

function ProposedActions(p: {
  deposit: Deposit;
  repo: Repo | null | undefined;
  isPayer: boolean;
  isMaintainer: boolean;
  busy: string | null;
  onChallenge: () => void;
  onFinalize: () => void;
}) {
  const s = p.deposit.status as { proposed: { verdict: string; deadline: number } };
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = s.proposed.deadline - now;
  const canChallenge = left > 0 && ((s.proposed.verdict === "forfeit" && p.isPayer) || (s.proposed.verdict === "refund" && p.isMaintainer));
  return (
    <div className="space-y-2">
      {canChallenge && (
        <Button className="w-full" disabled={!!p.busy} onClick={p.onChallenge}>
          Challenge — stake ${formatUsdc(p.deposit.bond)}
        </Button>
      )}
      {canChallenge && <p className="text-xs text-faint">A stronger model re-judges with both sides' statements. Win: stake back and the verdict flips. Lose: the stake goes to the other side.</p>}
      {left <= 0 && (
        <Button variant="ghost" className="w-full" disabled={!!p.busy} onClick={p.onFinalize}>
          Finalize verdict (anyone can)
        </Button>
      )}
    </div>
  );
}

function describe(d: Deposit): { title: string; detail: string } {
  const s = d.status;
  if (s === "held") return { title: "Bond held", detail: "Waiting for the verdict to be posted." };
  if ("proposed" in s) {
    const left = s.proposed.deadline - Date.now();
    return left > 0
      ? { title: `Proposed: ${s.proposed.verdict}`, detail: `Stands in ${fmtDuration(left)} unless challenged.` }
      : { title: `Proposed: ${s.proposed.verdict}`, detail: "Challenge window closed — anyone can finalize it." };
  }
  if ("challenged" in s) return { title: `Challenged by ${s.challenged.challenger}`, detail: `Stake $${formatUsdc(s.challenged.stake)}. A stronger model is re-judging.` };
  return { title: `Settled: ${s.settled.verdict}`, detail: new Date(s.settled.at).toLocaleString() };
}

function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${Math.floor((ms % 60_000) / 1000)} s`;
}

function Appeals({ r }: { r: VerdictRecord }) {
  const wallet = useWallet();
  const { data, reload } = useAsync(() => api.appeals(r.id), [r.id]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await api.appeal(r.id, note.trim(), wallet.accountId ?? "anonymous");
      setNote("");
      toast.success("Appeal attached", { description: "The maintainer sees it next to this verdict." });
      reload();
    } catch (e) {
      toast.error("Not sent", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel className="p-6">
      <Eyebrow>Appeals</Eyebrow>
      <p className="mt-1.5 text-sm text-muted-foreground">Think the judge got it wrong? Say exactly what it misread — file and line. To force a re-judge by a stronger model, stake a challenge in the on-chain panel.</p>
      {!!data?.length && (
        <ul className="mt-4 space-y-2">
          {data.map((a, i) => (
            <li key={i} className="rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
              <div className="flex justify-between text-xs text-faint">
                <span className="font-mono">{a.author}</span>
                <span>{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{a.note}</p>
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="e.g. parse_with_validation() is defined in src/validate.c:40 on the base branch — the judge missed it."
        className="mt-4 w-full resize-y rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-brand"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-faint">{note.trim().length}/2000 · at least 10 characters</span>
        <Button variant="ghost" disabled={busy || note.trim().length < 10} onClick={() => void send()}>
          {busy ? <Spinner /> : "Attach appeal"}
        </Button>
      </div>
    </Panel>
  );
}
