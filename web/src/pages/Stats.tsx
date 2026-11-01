// Public numbers: what PatchBond has done so far, what a verdict costs, and where the money went.
// Everything is read live — the on-chain totals from the contract, the rest from the signed records.

import { Activity, Coins, Gavel, Lock, Scale, Timer } from "lucide-react";
import { Link } from "react-router";
import { Eyebrow, Panel, Spinner } from "../components/kit";
import { api, chain, money } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const minutes = (m: number | null) => (m === null ? "—" : m < 1 ? "< 1 min" : m < 120 ? `${Math.round(m)} min` : `${Math.round(m / 60)} h`);
const fmtUsd = (n: number) => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);

export function Stats() {
  const cfg = useConfig();
  const { data, loading, error } = useAsync(async () => {
    const [s, usdc, near] = await Promise.all([api.stats(), chain.totals(cfg, "usdc"), chain.totals(cfg, "near").catch(() => null)]);
    return { s, usdc, near };
  }, [cfg]);

  if (loading && !data) return <div className="p-10 text-center"><Spinner /></div>;
  if (error || !data) return <div className="mx-auto max-w-3xl px-4 py-12 text-danger">Couldn't load the numbers: {error}</div>;
  const { s, usdc, near } = data;
  const judged = s.verdicts.refund + s.verdicts.forfeit + s.verdicts.needs_human;
  const cleared = judged ? Math.round(((s.verdicts.refund + s.verdicts.forfeit) / judged) * 100) : null;
  const per = s.cost_per_verdict_usd;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <Eyebrow>Live numbers · {s.network}</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">What PatchBond has done so far</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Money figures come straight from the contract's own counters; verdict figures from the stored TEE-signed records (every one is on the{" "}
        <Link to="/verdicts" className="text-brand hover:underline">public record</Link>). This is a hackathon deployment on {s.network}, so the numbers are small — they're real.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Coins} label="Bonds paid on-chain" value={String(usdc.deposits + (near?.deposits ?? 0))} sub={`${money(usdc.held)} held right now`} />
        <Stat icon={Scale} label="Refunded to contributors" value={money(usdc.refunded)} sub={near && BigInt(near.refunded) > 0n ? `+ ${money(near.refunded, "near")}` : "every cent of each refunded bond"} />
        <Stat icon={Gavel} label="Forfeited to maintainers" value={money(usdc.forfeited)} sub="90% to the repo's vault, 10% to PatchBond" />
        <Stat icon={Lock} label="Sealed security reports" value={String(s.sealed_reports)} sub="encrypted in the reporter's browser" />
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">Verdicts</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Activity} label="TEE-signed verdicts" value={String(s.verdicts_live)} sub={`${s.verdicts.in_enclave} judged inside OutLayer TDX`} />
        <Stat icon={Scale} label="Cleared without a human" value={cleared === null ? "—" : `${cleared}%`} sub={`${s.verdicts.refund} refunded · ${s.verdicts.forfeit} forfeited · ${s.verdicts.needs_human} to a maintainer`} />
        <Stat icon={Timer} label="Bond to verdict (median)" value={minutes(s.median_minutes_to_verdict)} sub="from the bond being seen; waits for CI" />
        <Stat icon={Gavel} label="Disputed verdicts" value={String(s.disputes)} sub="re-judged by a stronger model" />
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">What it costs to run</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        The model is the cheap part. The cost per verdict below is measured from each signed response's token usage at NEAR AI Cloud's list price for <span className="font-mono">{s.judge}</span>.
      </p>
      <Panel className="mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {[
              ["A verdict (measured)", per === null ? "—" : fmtUsd(per), "TEE-signed, on every paid PR"],
              ["1,000 PRs a month", per === null ? "—" : fmtUsd(per * 1000), "the judge alone"],
              ["A dispute re-judge (Kimi K3)", "≈ $0.01", "only when someone disputes"],
              ["An OutLayer enclave run", "≈ 0.0015 NEAR", "only on the enclave route"],
              ["Hosting", "≈ $5–20 a month", "one small server; the contract holds the money"],
            ].map(([k, v, note]) => (
              <tr key={k}>
                <td className="px-5 py-3">{k}</td>
                <td className="num px-5 py-3 font-mono text-ink">{v}</td>
                <td className="hidden px-5 py-3 text-muted-foreground sm:table-cell">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="mt-3 text-xs text-faint">
        {plural(s.repos, "repo")} had PRs handled by the hosted bot; {plural(s.linked_repos, "repo")} with a maintainer linked. Updated {new Date(s.at).toLocaleString()}.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Coins; label: string; value: string; sub: string }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="num mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </Panel>
  );
}
