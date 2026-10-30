// "How it works" as its own page: the flow, the price curve, the mechanisms and the fairness rules.

import { Bot, Coins, Gavel, GitPullRequest, Scale, ShieldCheck, Timer, Waves } from "lucide-react";
import { animate, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AttentionMeter } from "../components/AttentionMeter";
import { Reveal, Spotlight } from "../components/fx";
import { Button, Eyebrow, Panel } from "../components/kit";

const DEMO_POLICY = { base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8 };

export function How() {
  return (
    <>
      <HowItWorks />
      <Pricing />
      <Mechanisms />
      <Fairness />
    </>
  );
}

const STEPS = [
  { icon: GitPullRequest, title: "A stranger opens a PR", body: "PatchBond asks for a small refundable deposit in one comment. Maintainers, collaborators and proven contributors are waved through." },
  { icon: Coins, title: "They pay the bond", body: "USDC or NEAR, priced by the repo's queue. Agents pay from capped budgets their owners control." },
  { icon: ShieldCheck, title: "A verifiable AI judges it", body: "After CI, a model in a TEE on NEAR AI Cloud reviews it with facts we compute. The response is signed." },
  { icon: Scale, title: "Refund — or the repo is paid", body: "Real work: every cent back. Slop: 90% to the repo's vault, 10% to run PatchBond. Either side can challenge." },
];

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24">
      <Reveal>
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">The sender spends ten seconds. The maintainer spends an hour. Now the sender has skin in the game.</h2>
      </Reveal>
      <ol className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div
          className="absolute left-6 right-6 top-[2.15rem] hidden h-px origin-left bg-gradient-to-r from-brand/60 via-brand/30 to-transparent lg:block"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.2, ease: [0.2, 0.7, 0.2, 1] }}
        />
        {STEPS.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.1}>
            <Spotlight className="h-full border border-line bg-panel p-5">
              <div className="relative grid size-10 place-items-center rounded-xl border border-line bg-bg text-brand">
                <s.icon className="size-5" />
                <span className="num absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-raised text-[10px] font-bold text-muted-foreground">{i + 1}</span>
              </div>
              <h3 className="mt-5 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </Spotlight>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

function Pricing() {
  const [open, setOpen] = useState(6);
  const [flooding, setFlooding] = useState(false);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  function flood() {
    stop.current();
    setFlooding(true);
    // A spam wave: the queue explodes, the price climbs to the ceiling, then verdicts clear it.
    const up = animate(open, 36, { duration: 1.6, ease: "easeIn", onUpdate: (v) => setOpen(Math.round(v)) });
    let down: { stop: () => void } | null = null;
    up.then(() => {
      down = animate(36, 4, { duration: 3.2, delay: 0.9, ease: "easeOut", onUpdate: (v) => setOpen(Math.round(v)), onComplete: () => setFlooding(false) });
    });
    stop.current = () => {
      up.stop();
      down?.stop();
    };
    toast("Spam wave incoming", { description: "200 AI-generated PRs hit the repo. Watch the bond." });
  }

  return (
    <section className="relative border-y border-line bg-panel/40">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 lg:grid-cols-[1fr_1.35fr] lg:items-center">
        <Reveal>
          <Eyebrow>Attention pricing</Eyebrow>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">EIP-1559 for maintainers.</h2>
          <p className="mt-5 leading-relaxed text-muted-foreground">
            The bond isn't a fixed fee. It follows the repo's queue of unreviewed outside submissions — computed <b className="text-ink">on-chain</b> from unsettled deposits, with no oracle. A flood of slop prices itself out; a quiet repo costs a newcomer a few cents.
          </p>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Proven contributors (3 refunds on 2 repos) pay <b className="text-ink">$0</b> at any level. The web app draws the contract's exact integer maths — our end-to-end test checks they match on testnet.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={flood} disabled={flooding}>
              <Waves className="size-4" /> {flooding ? "Flood in progress…" : "Simulate a spam wave"}
            </Button>
            <span className="font-mono text-xs text-faint">bond = clamp(min, max, base × 1.125^(open − capacity))</span>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <Panel className={`p-5 transition-shadow duration-500 sm:p-6 ${open > 16 ? "shadow-[0_0_80px_-20px_var(--danger)]" : "shadow-[0_0_80px_-30px_var(--brand)]"}`}>
            <AttentionMeter policy={DEMO_POLICY} open={open} onOpenChange={(n) => (stop.current(), setFlooding(false), setOpen(n))} />
          </Panel>
        </Reveal>
      </div>
    </section>
  );
}

const MECHANISMS = [
  { icon: Timer, tag: "Priority lane", title: "Pay for attention, not for submitting", body: "Add a review tip. The repo earns it only if a maintainer reviews within the promised window — otherwise it comes back." },
  { icon: Gavel, tag: "Optimistic verdicts", title: "Cheap AI by default, strong AI when money's on the line", body: "A fast verifiable model decides. Either side can stake to challenge; a stronger model re-judges and the loser's stake pays the winner." },
  { icon: Coins, tag: "Slop funds the fix", title: "Spam pays whoever really fixes the issue", body: "A forfeited PR that claimed to fix #N becomes a bounty on #N, paid automatically when a real fix is merged." },
  { icon: Bot, tag: "Know your agent", title: "Capped wallets and passports for coding agents", body: "Agents pay bonds with a function-call key from a budget whose daily cap the contract enforces. Each harness gets a public refund record." },
];

function Mechanisms() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <Eyebrow>Not a slop filter — a market</Eyebrow>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Four mechanisms, all enforced by one NEAR contract.</h2>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {MECHANISMS.map((m, i) => (
          <Reveal key={m.tag} delay={(i % 2) * 0.08}>
            <Spotlight className="group h-full border border-line bg-panel p-6">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">{m.tag}</span>
                <m.icon className="size-5 text-faint transition group-hover:scale-110 group-hover:text-brand" />
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{m.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{m.body}</p>
            </Spotlight>
          </Reveal>
        ))}
      </div>
    </section>
  );
}


function Fairness() {
  const points = [
    ["Optional per repo", "Maintainers turn it on. Nobody is forced to pay to contribute anywhere."],
    ["Proven people pay $0", "Three refunds on two repos and the bond disappears — everywhere, because reputation lives on-chain."],
    ["When in doubt, refund", "A forfeit needs high confidence and concrete evidence. Clean CI and real code can't be forfeited by the model alone."],
    ["Nobody is paid to submit", "No token, no rewards for volume. Money only flows from wasted time to the people whose time it was."],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24">
      <Reveal>
        <Panel className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <Eyebrow>“Doesn't this make open source less open?”</Eyebrow>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Only for people who waste others' time.</h2>
          </div>
          <dl className="grid gap-6 sm:grid-cols-2">
            {points.map(([t, b]) => (
              <div key={t} className="border-l-2 border-brand/40 pl-4">
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{b}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Reveal>
    </section>
  );
}
