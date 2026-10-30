// The owner's controls for an agent's budget: daily cap, most per bond, allowed repos, and a
// freeze switch. The contract enforces every one of them; the agent's key can't change any.

import { Lock, Snowflake, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { chain, money } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";
import { Button, Notice, Panel, Spinner } from "./kit";

const toUnits = (usd: string) => {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${usd}" isn't an amount in USDC.`);
  return String(Math.round(n * 1_000_000));
};
const toUsd = (units: string) => String(Number(units) / 1_000_000);

/** "owner/name" or a numeric GitHub repo id → the numeric id the contract keys repos by. */
async function repoId(s: string): Promise<number> {
  if (/^\d+$/.test(s)) return Number(s);
  const name = s.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  const r = await fetch(`https://api.github.com/repos/${name}`);
  if (!r.ok) throw new Error(`GitHub doesn't know the repo "${name}" (use owner/name).`);
  return ((await r.json()) as { id: number }).id;
}

export function AgentControls() {
  const cfg = useConfig();
  const wallet = useWallet();
  const [agent, setAgent] = useState("");
  const [loaded, setLoaded] = useState("");
  const { data, loading, reload } = useAsync(
    async () => (loaded ? Promise.all([chain.budget(cfg, loaded), chain.budgetPolicy(cfg, loaded).catch(() => null)]) : null),
    [loaded],
  );
  const [cap, setCap] = useState("");
  const [max, setMax] = useState("");
  const [repos, setRepos] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [budget, policy] = data ?? [null, null];
  const isOwner = !!budget && budget.owner === wallet.accountId;

  function open() {
    const a = agent.trim();
    setLoaded(a);
    setCap("");
    setMax("");
    setRepos("");
  }

  async function run(what: string, fn: () => Promise<{ error?: string | null }>, ok: string) {
    setBusy(what);
    try {
      const out = await fn();
      if (out.error) throw new Error(out.error);
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error("Not changed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const savePolicy = () =>
    run(
      "policy",
      async () => {
        const ids = await Promise.all(repos.split(/[\s,]+/).filter(Boolean).map(repoId));
        const out = await wallet.call(cfg.contract, "set_budget_policy", { agent: loaded, max_bond: max.trim() ? toUnits(max) : null, repos: ids, frozen: policy?.frozen ?? false }, { tgas: 30 });
        if (!out.error && cap.trim() && toUnits(cap) !== budget!.daily_cap) {
          return wallet.call(cfg.contract, "set_budget_cap", { agent: loaded, daily_cap: toUnits(cap) }, { tgas: 30 });
        }
        return out;
      },
      "Policy saved on-chain",
    );

  const freeze = (frozen: boolean) =>
    run("freeze", () => wallet.call(cfg.contract, "freeze_budget", { agent: loaded, frozen }, { tgas: 30 }), frozen ? "Frozen: the agent can't pay new bonds" : "Unfrozen");

  return (
    <Panel className="mt-6 space-y-4 p-6 text-sm">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
      >
        <input
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder={`my-agent.${cfg.network}`}
          className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2 font-mono outline-none focus:border-brand"
        />
        <Button type="submit" variant="ghost" disabled={!agent.trim()}>Look up</Button>
      </form>

      {loaded && loading && !data && <Spinner />}
      {loaded && data && !budget && <Notice tone="warn" title={`${loaded} has no budget`}>Fund one first (step 1 below).</Notice>}
      {budget && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Balance", money(budget.balance)],
              ["Daily cap", money(budget.daily_cap)],
              ["Most per bond", policy?.max_bond ? money(policy.max_bond) : "no limit"],
              ["Allowed repos", policy?.repos.length ? String(policy.repos.length) : "any"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-bg p-3">
                <dt className="text-[10px] uppercase tracking-wider text-faint">{k}</dt>
                <dd className="num mt-1 font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          {policy?.frozen && <Notice tone="warn" title="Frozen">The contract refuses this agent's new bonds. Refunds still come back into the budget.</Notice>}
          {!isOwner ? (
            <p className="text-muted-foreground">
              Owned by <span className="font-mono">{budget.owner}</span>. {wallet.accountId ? "Connect that account to change its limits." : "Connect it to change its limits."}
            </p>
          ) : (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block font-medium">
                  Daily cap (USDC)
                  <input value={cap} onChange={(e) => setCap(e.target.value)} placeholder={toUsd(budget.daily_cap)} inputMode="decimal" className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono outline-none focus:border-brand" />
                </label>
                <label className="block font-medium">
                  Most per bond (USDC)
                  <input value={max} onChange={(e) => setMax(e.target.value)} placeholder={policy?.max_bond ? toUsd(policy.max_bond) : "no limit"} inputMode="decimal" className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono outline-none focus:border-brand" />
                </label>
                <label className="block font-medium">
                  Allowed repos
                  <input value={repos} onChange={(e) => setRepos(e.target.value)} placeholder={policy?.repos.length ? policy.repos.join(", ") : "any — or owner/name, …"} className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono outline-none focus:border-brand" />
                </label>
              </div>
              <p className="text-xs text-faint">Saving replaces the whole policy: empty fields mean no per-bond limit and any repo. The daily cap only changes if you type one.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void savePolicy()} disabled={!!busy}>
                  {busy === "policy" ? <Spinner /> : <><Lock className="size-4" /> Save limits</>}
                </Button>
                <Button variant="ghost" onClick={() => void freeze(!policy?.frozen)} disabled={!!busy}>
                  {busy === "freeze" ? <Spinner /> : policy?.frozen ? <><Unlock className="size-4" /> Unfreeze</> : <><Snowflake className="size-4" /> Freeze now</>}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
