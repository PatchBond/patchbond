// The public record: every verdict, filterable and searchable, each one verifiable on its own page.

import type { VerdictRecord } from "@patchbond/shared";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Eyebrow, Panel, Spinner, VerdictBadge } from "../components/kit";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

type Verdict = VerdictRecord["final"]["verdict"];
const FILTERS: { id: Verdict | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "refund", label: "Refunded" },
  { id: "forfeit", label: "Forfeited" },
  { id: "needs_human", label: "Needs a maintainer" },
];
const PAGE = 50;

export function Verdicts() {
  const [limit, setLimit] = useState(PAGE);
  const { data, loading } = useAsync(() => api.verdicts(limit), [limit]);
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const v of data ?? []) c[v.final.verdict] = (c[v.final.verdict] ?? 0) + 1;
    return c;
  }, [data]);
  const shown = (data ?? []).filter((v) => {
    if (filter !== "all" && v.final.verdict !== filter) return false;
    const needle = q.trim().toLowerCase();
    return !needle || `${v.repo.full_name}#${v.number} ${v.author} ${v.final.reasons.join(" ")}`.toLowerCase().includes(needle);
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <Eyebrow>Public record</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Every verdict, signed and checkable.</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Each one was judged by a verifiable model in a TEE on NEAR AI Cloud. Open any verdict and press <b className="text-ink">Verify signature</b> — your browser
        recomputes the hashes and recovers the enclave's key, without trusting PatchBond.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap rounded-xl border border-line p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.id ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink"}`}
            >
              {f.label} <span className="num text-faint">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="flex min-w-60 flex-1 items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm focus-within:border-brand">
          <Search className="size-4 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repo, PR, author or reason" className="w-full bg-transparent outline-none placeholder:text-faint" />
        </label>
      </div>

      <Panel className="mt-6 overflow-hidden">
        {loading && !data && (
          <div className="p-6 text-muted-foreground">
            <Spinner />
          </div>
        )}
        {data && shown.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            {data.length === 0 ? "No verdicts yet — press ⌘K and paste any public PR URL to make the first one." : "Nothing matches that filter."}
          </div>
        )}
        <ul className="divide-y divide-line">
          {shown.map((v, i) => (
            <motion.li key={v.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }}>
              <Link to={`/v/${v.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-raised/60">
                <VerdictBadge verdict={v.final.verdict} />
                <span className="font-medium">
                  {v.repo.full_name}
                  <span className="text-faint">#{v.number}</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{v.final.reasons[0]}</span>
                <span className="flex items-center gap-2 text-xs text-faint">
                  {!v.mock && <ShieldCheck className="size-3.5 text-brand" aria-label="TEE-signed" />}
                  <span className="hidden font-mono sm:inline">{v.model}</span>
                  <span className="num">{new Date(v.created_at).toLocaleDateString()}</span>
                  <ArrowRight className="size-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
      </Panel>
      {data && data.length >= limit && limit < 200 && (
        <div className="mt-6 text-center">
          <button onClick={() => setLimit((l) => Math.min(200, l + PAGE))} className="rounded-xl border border-line px-4 py-2 text-sm text-muted-foreground hover:bg-raised hover:text-ink">
            {loading ? <Spinner /> : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
