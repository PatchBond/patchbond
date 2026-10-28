import { Link, useParams } from "react-router";
import { AttentionMeter } from "../components/AttentionMeter";
import { Eyebrow, Notice, Panel, Spinner, Stat, VerdictBadge } from "../components/kit";
import { api, chain, money } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

export function RepoPage() {
  const cfg = useConfig();
  const repoId = Number(useParams().repoId);
  const { data: repo, error, loading } = useAsync(() => chain.repo(cfg, repoId), [cfg, repoId]);
  const { data: verdicts } = useAsync(() => api.verdicts(30, repoId), [repoId]);
  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
  if (error || !repo) return <div className="mx-auto max-w-lg px-4 py-24"><Notice tone="error" title="Repo not found">{error ?? `Repo ${repoId} isn't registered with PatchBond on ${cfg.network}.`}</Notice></div>;
  const name = verdicts?.[0]?.repo.full_name ?? `Repo ${repoId}`;
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <Eyebrow>Repository</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {repo.payout ? <>Payouts to <span className="font-mono">{repo.payout}</span></> : "No payout account linked yet — forfeits wait safely in the vault."}
        {!repo.policy.enabled && " · PatchBond is off"}
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel className="p-6">
          <AttentionMeter policy={repo.policy} open={repo.open} maxOpen={Math.max(24, repo.policy.target_open * 3)} currency={repo.currency} />
        </Panel>
        <Panel className="grid grid-cols-2 gap-6 p-6">
          <Stat label="Vault" value={money(repo.vault, repo.currency)} sub="withdrawable by the maintainer" />
          <Stat label="Paid by slop" value={money(repo.stats.forfeited_total, repo.currency)} />
          <Stat label="Refunds" value={repo.stats.refunds} />
          <Stat label="Forfeits" value={repo.stats.forfeits} />
          <Stat label="Tips earned" value={money(repo.stats.tips_earned, repo.currency)} sub="reviewed on time" />
          <Stat label="Review window" value={`${Math.round(repo.policy.review_window_sec / 3600)} h`} />
        </Panel>
      </div>
      <Panel className="mt-6 divide-y divide-line">
        {verdicts?.length === 0 && <div className="p-6 text-sm text-muted-foreground">No verdicts yet.</div>}
        {verdicts?.map((v) => (
          <Link key={v.id} to={`/v/${v.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-raised/60">
            <VerdictBadge verdict={v.final.verdict} />
            <span className="text-faint">#{v.number}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{v.final.reasons[0]}</span>
          </Link>
        ))}
      </Panel>
    </div>
  );
}
