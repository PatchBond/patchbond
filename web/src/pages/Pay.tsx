import { formatUsdc, parseUsdc } from "@patchbond/shared";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { AttentionMeter } from "../components/AttentionMeter";
import { Button, Eyebrow, Notice, Panel, Spinner } from "../components/ui";
import { chain, explorerTx } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";

export function Pay() {
  const cfg = useConfig();
  const wallet = useWallet();
  const { repoId: rid = "", number: num = "" } = useParams();
  const [q] = useSearchParams();
  const repoId = Number(rid);
  const number = Number(num);
  const fullName = q.get("repo") ?? `repo ${repoId}`;
  const [githubUser, setGithubUser] = useState(q.get("user") ?? "");
  const [tipText, setTipText] = useState("");
  const [fixes, setFixes] = useState(q.get("fixes") ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const { data, error, loading, reload } = useAsync(
    () =>
      Promise.all([
        chain.repo(cfg, repoId),
        chain.deposit(cfg, repoId, number),
        chain.quote(cfg, repoId, wallet.accountId),
        wallet.accountId ? chain.usdcBalance(cfg, wallet.accountId) : Promise.resolve(null),
      ]),
    [cfg, repoId, number, wallet.accountId],
  );

  if (!Number.isInteger(repoId) || !Number.isInteger(number)) {
    return <Centered><Notice tone="error" title="This pay link is broken">Use the link from the PatchBond comment on your pull request.</Notice></Centered>;
  }
  if (loading && !data) return <Centered><Spinner /></Centered>;
  if (error) return <Centered><Notice tone="error" title="Couldn't read the contract">{error}. Try again in a moment.</Notice></Centered>;
  const [repo, deposit, quote, balance] = data!;
  if (!repo) {
    return <Centered><Notice tone="error" title="This repo doesn't use PatchBond">Repo {repoId} isn't registered on {cfg.network}. Check the link, or ask the maintainers to install the GitHub App.</Notice></Centered>;
  }

  let tip = 0n;
  let tipError: string | null = null;
  try {
    tip = tipText ? parseUsdc(tipText) : 0n;
  } catch (e) {
    tipError = (e as Error).message;
  }
  const bond = BigInt(quote);
  // Headroom in case the queue grows before the tx lands; the contract returns any change.
  const send = bond + tip + bond / 20n;
  const short = balance !== null && BigInt(balance) < send;

  async function pay() {
    setBusy(true);
    setResult(null);
    try {
      const msg = {
        action: "bond",
        repo_id: repoId,
        number,
        kind: "pr",
        github_user: githubUser.trim(),
        ...(tip > 0n ? { tip: tip.toString() } : {}),
        ...(fixes ? { fixes_issue: Number(fixes) } : {}),
      };
      const out = await wallet.call(cfg.token, "ft_transfer_call", { receiver_id: cfg.contract, amount: send.toString(), msg: JSON.stringify(msg) }, { deposit: "1" });
      setResult(out.error ? { ok: false, text: out.error, hash: out.hash } : { ok: true, text: "Deposit held.", hash: out.hash });
      reload();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message || "The wallet closed before signing. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <Eyebrow>Refundable deposit</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {fullName}
          <span className="text-faint">#{number}</span>
        </h1>
        <p className="mt-3 leading-relaxed text-muted">
          This repository asks outside contributors for a small refundable deposit so maintainers' time goes to real work. If your pull request is a real contribution, you get{" "}
          <b className="text-ink">every cent back</b>.
        </p>
        <ol className="mt-6 space-y-3 text-sm">
          {[
            ["You pay", `$${formatUsdc(bond)} USDC from your NEAR wallet.`],
            ["CI runs, then an AI judge reviews", "In a verified enclave on NEAR AI Cloud. The verdict is signed and public."],
            ["Real work → refunded", "Automatically, to the wallet you paid from. Disagree with a verdict? Challenge it."],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-3">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-muted">{i + 1}</span>
              <div>
                <div className="font-medium">{t}</div>
                <div className="text-muted">{b}</div>
              </div>
            </li>
          ))}
        </ol>
        <Panel className="mt-8 p-5">
          <AttentionMeter policy={repo.policy} open={repo.open} maxOpen={Math.max(24, repo.policy.target_open * 3)} />
        </Panel>
      </div>

      <Panel className="h-fit p-6 lg:sticky lg:top-20">
        {deposit && deposit.status !== "held" && typeof deposit.status === "object" && "settled" in deposit.status && deposit.status.settled.verdict !== "void" ? (
          <Notice tone="info" title="Already judged">This submission's deposit is settled. See the verdict on the pull request.</Notice>
        ) : deposit && !(typeof deposit.status === "object" && "settled" in deposit.status) ? (
          <div className="text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-2xl text-accent">✓</div>
            <h2 className="mt-4 text-xl font-semibold">Deposit held</h2>
            <p className="mt-2 text-sm text-muted">
              ${formatUsdc(deposit.bond)} from <span className="font-mono">{deposit.payer}</span>. The judge runs after CI; the verdict appears on the pull request.
            </p>
            {result?.hash && (
              <a className="mt-4 inline-block text-sm text-accent underline" href={explorerTx(cfg, result.hash)} target="_blank" rel="noreferrer">
                View transaction
              </a>
            )}
          </div>
        ) : !repo.policy.enabled ? (
          <Notice tone="info" title="No deposit needed">PatchBond is turned off for this repo.</Notice>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Deposit</span>
              <span className="num text-4xl font-semibold tracking-tight">${formatUsdc(bond + tip)}</span>
            </div>
            {bond === 0n && wallet.accountId && (
              <div className="mt-4"><Notice tone="ok" title="You're a proven contributor">No deposit needed — 3+ refunds on 2+ repos. Just ask a maintainer to review.</Notice></div>
            )}

            <label className="mt-6 block text-sm">
              <span className="text-muted">Your GitHub username</span>
              <input
                value={githubUser}
                onChange={(e) => setGithubUser(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
                placeholder="octocat"
              />
              <span className="mt-1 block text-xs text-faint">Must be the PR's author — a deposit paid for someone else's PR is refunded.</span>
            </label>

            <details className="mt-4 rounded-xl border border-line">
              <summary className="cursor-pointer px-3 py-2.5 text-sm text-muted hover:text-ink">Optional: priority tip, linked issue</summary>
              <div className="space-y-4 border-t border-line p-3">
                <label className="block text-sm">
                  <span className="text-muted">Review tip (USDC)</span>
                  <input value={tipText} onChange={(e) => setTipText(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent" />
                  <span className="mt-1 block text-xs text-faint">
                    The repo earns it only if a maintainer reviews within {Math.round(repo.policy.review_window_sec / 3600)} h. Otherwise it comes back to you.
                  </span>
                  {tipError && <span className="mt-1 block text-xs text-danger">{tipError}</span>}
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Fixes issue #</span>
                  <input value={fixes} onChange={(e) => setFixes(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="e.g. 42" className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent" />
                  <span className="mt-1 block text-xs text-faint">If this PR is judged slop, its deposit becomes a bounty for whoever really fixes that issue.</span>
                </label>
              </div>
            </details>

            <div className="mt-6">
              {!wallet.accountId ? (
                <Button className="w-full py-3 text-base" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
                  {wallet.connecting ? "Connecting…" : "Connect a NEAR wallet"}
                </Button>
              ) : (
                <Button className="w-full py-3 text-base" onClick={() => void pay()} disabled={busy || !githubUser.trim() || !!tipError || short || bond === 0n}>
                  {busy ? <><Spinner /> Confirm in your wallet…</> : `Pay $${formatUsdc(bond + tip)} deposit`}
                </Button>
              )}
            </div>
            {wallet.accountId && balance !== null && (
              <p className={`mt-2 text-center text-xs ${short ? "text-danger" : "text-faint"}`}>
                Balance ${formatUsdc(balance)} USDC
                {short && cfg.network === "testnet" && (
                  <>
                    {" "}— not enough. Get test USDC at{" "}
                    <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                      faucet.circle.com
                    </a>
                    .
                  </>
                )}
                {short && cfg.network === "mainnet" && " — not enough USDC on NEAR."}
              </p>
            )}
            <p className="mt-3 text-center text-xs text-faint">Up to 5% extra is sent in case the queue grows meanwhile; any excess comes straight back.</p>
            {result && !result.ok && (
              <div className="mt-4">
                <Notice tone="error" title="Not paid">
                  {result.text}{" "}
                  {result.hash && <a href={explorerTx(cfg, result.hash)} target="_blank" rel="noreferrer">Transaction</a>}
                </Notice>
              </div>
            )}
          </>
        )}
        <p className="mt-6 border-t border-line pt-4 text-center text-xs text-faint">
          <Link to="/" className="hover:text-ink">What is PatchBond?</Link> · Funds are held by the{" "}
          <span className="font-mono">{cfg.contract}</span> contract, never by a company wallet.
        </p>
      </Panel>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto grid min-h-[50vh] max-w-lg place-items-center px-4 py-20">{children}</div>;
}
