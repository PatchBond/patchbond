// "The bond machine": the whole idea in one loop. PRs queue up with a bond, the verifiable judge
// scans each one, and its coin flies back to the contributor (real work) or into the maintainers'
// vault (slop). The bond price follows the queue, exactly like the contract's curve.

import { curveBond, formatUsdc } from "@patchbond/shared";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AnimatedNumber, usd } from "./fx";
import { Mark } from "./kit";

type Kind = "good" | "slop";
interface Pr {
  id: number;
  title: string;
  author: string;
  kind: Kind;
  bond: number;
  fact: string;
}

const SAMPLES: Omit<Pr, "id" | "bond">[] = [
  { title: "fix: handle empty config file", author: "tunde", kind: "good", fact: "CI ✓ · tests added" },
  { title: "Improve robustness and performance", author: "gpt-farm-07", kind: "slop", fact: "calls parse_with_validation() — doesn't exist" },
  { title: "docs: correct the --since flag example", author: "amara", kind: "good", fact: "CI ✓ · 1 file" },
  { title: "Refactor entire codebase for clarity", author: "slopbot", kind: "slop", fact: "CI ✗ · 214 files reformatted" },
  { title: "Add retry with backoff to HTTP client", author: "kenji", kind: "good", fact: "CI ✓ · fixes #212" },
  { title: "Fix security vulnerability (critical!!)", author: "bounty-hunter-ai", kind: "slop", fact: "prompt injection in description" },
  { title: "perf: cache compiled regexes", author: "lena", kind: "good", fact: "CI ✓ · benchmark included" },
  { title: "Update README.md", author: "agent-4421", kind: "slop", fact: "duplicate of #318 (91%)" },
];

const POLICY = { base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 3 };

export function BondMachine() {
  const reduce = useReducedMotion();
  const [queue, setQueue] = useState<Pr[]>([]);
  const [judging, setJudging] = useState<Pr | null>(null);
  const [verdict, setVerdict] = useState<Kind | null>(null);
  const [coins, setCoins] = useState<{ id: number; to: Kind; bond: number }[]>([]);
  const [totals, setTotals] = useState({ back: 0, vault: 0, judged: 0 });
  const next = useRef(0);

  // New submissions arrive faster than one judge can clear them, so the queue (and price) breathe.
  useEffect(() => {
    if (reduce) return;
    const arrive = setInterval(() => {
      setQueue((q) => {
        if (q.length >= 5) return q;
        const s = SAMPLES[next.current % SAMPLES.length]!;
        const pr = { ...s, id: next.current++, bond: Number(curveBond(POLICY, q.length + 1)) };
        return [...q, pr];
      });
    }, 1700);
    return () => clearInterval(arrive);
  }, [reduce]);

  // The judge takes the oldest PR when it's free…
  useEffect(() => {
    if (judging || queue.length === 0) return;
    const [head, ...rest] = queue;
    setQueue(rest);
    setVerdict(null);
    setJudging(head!);
  }, [queue, judging]);

  // …scans it, decides, and sends the coin. Keyed on the PR alone, so arrivals don't reset it.
  useEffect(() => {
    if (!judging) return;
    const pr = judging;
    const t1 = setTimeout(() => setVerdict(pr.kind), 1500);
    const t2 = setTimeout(() => {
      setCoins((c) => [...c, { id: pr.id, to: pr.kind, bond: pr.bond }]);
      setTotals((t) => ({
        back: t.back + (pr.kind === "good" ? pr.bond : 0),
        vault: t.vault + (pr.kind === "slop" ? Math.round(pr.bond * 0.9) : 0),
        judged: t.judged + 1,
      }));
      setJudging(null);
    }, 2300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [judging]);

  const open = queue.length + (judging ? 1 : 0);
  const price = Number(curveBond(POLICY, open));

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-panel/80 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-5">
      <div className="mb-4 flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 font-medium text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          live simulation
        </span>
        <span className="num text-muted-foreground">
          bond now <AnimatedNumber value={price / 1e6} format={(n) => `$${n.toFixed(2)}`} className="font-semibold text-ink" /> · {open} open
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Queue */}
        <div className="flex min-h-56 min-w-0 flex-col gap-2">
          <Label>Incoming PRs</Label>
          <AnimatePresence initial={false}>
            {queue.slice(0, 4).map((pr) => (
              <motion.div
                key={pr.id}
                layout
                initial={{ opacity: 0, x: -24, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className="min-w-0 rounded-xl border border-line bg-bg/80 px-3 py-2"
              >
                <div className="truncate text-xs font-medium">{pr.title}</div>
                <div className="mt-0.5 flex justify-between text-[10px] text-faint">
                  <span className="truncate">@{pr.author}</span>
                  <span className="num shrink-0 text-muted-foreground">${formatUsdc(BigInt(pr.bond))}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {queue.length === 0 && <div className="text-xs text-faint">queue empty — bonds are cheap</div>}
        </div>

        {/* Judge */}
        <div className="flex min-w-0 flex-col gap-2">
          <Label>Verifiable judge · TEE</Label>
          <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-line bg-bg/70 p-3 text-center">
            <AnimatePresence mode="wait">
              {judging ? (
                <motion.div key={judging.id} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -10 }} className="w-full">
                  <div className="relative mx-auto w-full overflow-hidden rounded-lg border border-line bg-panel px-3 py-2.5 text-left">
                    <div className="truncate text-xs font-semibold">{judging.title}</div>
                    <div className="mt-1 truncate font-mono text-[10px] text-faint">{judging.fact}</div>
                    {!verdict && <div className="pointer-events-none absolute inset-x-0 top-0 h-6 animate-scan bg-gradient-to-b from-transparent via-brand/30 to-transparent" />}
                  </div>
                  <AnimatePresence>
                    {verdict && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.4, rotate: -12 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 380, damping: 16 }}
                        className={`mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                          verdict === "good" ? "border-brand/40 bg-brand-soft text-brand" : "border-danger/40 bg-danger-soft text-danger"
                        }`}
                      >
                        {verdict === "good" ? "✓ REFUND" : "✕ FORFEIT"}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="mt-2 font-mono text-[9px] text-faint">{verdict ? "signed · sha256 ✓" : "reading diff, CI, repo code…"}</div>
                </motion.div>
              ) : (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-faint">
                  <Mark size={34} className="mx-auto mb-2 opacity-50" />
                  waiting…
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Outcomes */}
        <div className="col-span-2 grid grid-cols-2 gap-3">
          <Outcome tone="good" label="Back to contributors" value={totals.back} />
          <Outcome tone="slop" label="Paid to maintainers" value={totals.vault} />
        </div>
      </div>

      {/* Coins in flight */}
      <AnimatePresence>
        {coins.map((c) => (
          <motion.div
            key={c.id}
            className="pointer-events-none absolute z-10"
            initial={{ left: "72%", top: "42%", scale: 0.4, opacity: 0 }}
            animate={{ left: c.to === "good" ? "26%" : "74%", top: "80%", scale: [0.4, 1.2, 0.6], opacity: [0, 1, 0] }}
            transition={{ duration: 0.9, ease: [0.5, 0, 0.2, 1] }}
            onAnimationComplete={() => setCoins((all) => all.filter((x) => x.id !== c.id))}
          >
            <span className={`grid size-7 place-items-center rounded-full text-[10px] font-black shadow-lg ${c.to === "good" ? "bg-brand text-brand-ink shadow-brand/40" : "bg-warn text-bg shadow-warn/40"}`}>$</span>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-faint">
        <span>{totals.judged} judged · every verdict signed & public</span>
        <span>90% of every forfeit → the repo</span>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{children}</div>;
}

function Outcome({ tone, label, value }: { tone: Kind; label: string; value: number }) {
  return (
    <div className={`flex flex-col justify-center rounded-2xl border p-3 ${tone === "good" ? "border-brand/25 bg-brand-soft" : "border-warn/25 bg-warn-soft"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <AnimatedNumber value={value} format={(n) => usd(n)} className={`mt-1 text-xl font-semibold ${tone === "good" ? "text-brand" : "text-warn"}`} />
    </div>
  );
}
