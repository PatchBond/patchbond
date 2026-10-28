import { ArrowRight, Bot, Coins, Gavel, GitPullRequest, Scale, ShieldCheck, Sparkles, Timer, Waves } from "lucide-react";
import { animate, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { AttentionMeter } from "../components/AttentionMeter";
import { BondMachine } from "../components/BondMachine";
import { CountUp, Reveal, Spotlight, usd } from "../components/fx";
import { Button, Eyebrow, Mark, Panel, Spinner, VerdictBadge } from "../components/kit";
import { api, chain } from "../lib/api";
import { GITHUB_APP_URL, useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

const DEMO_POLICY = { base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8 };

export function Home() {
  return (
    <>
      <Hero />
      <Counters />
      <HowItWorks />
      <Pricing />
      <Mechanisms />
      <TryTheJudge />
      <RecentVerdicts />
      <Fairness />
      <Closing />
    </>
  );
}

function Hero() {
  const words = ["AI", "made", "sending", "free."];
  return (
    <section className="grain relative overflow-hidden border-b border-line">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <motion.div
        className="pointer-events-none absolute -top-48 left-1/3 h-[34rem] w-[50rem] -translate-x-1/2 rounded-full bg-brand/12 blur-3xl"
        animate={{ x: [0, 40, 0], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:pt-20 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="size-3.5 text-brand" /> Refundable bonds for pull requests · on NEAR
          </motion.div>
          <h1 className="mt-7 text-[2.5rem] font-semibold leading-[1.04] tracking-tight sm:text-[3.3rem]">
            {words.map((w, i) => (
              <motion.span key={w} className="mr-[0.25em] inline-block" initial={{ opacity: 0, y: 24, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}>
                {w}
              </motion.span>
            ))}
            <br />
            <motion.span className="text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.6 }}>
              Wasting a maintainer's time now{" "}
            </motion.span>
            <motion.span
              className="relative inline-block text-brand"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.75, type: "spring", stiffness: 260, damping: 14 }}
            >
              costs something.
              <motion.svg viewBox="0 0 300 12" className="absolute -bottom-2 left-0 w-full" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}>
                <motion.path d="M2 8 C 80 2, 200 2, 298 7" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1, duration: 0.8 }} />
              </motion.svg>
            </motion.span>
          </h1>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }} className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Strangers attach a small deposit to their pull request. Real contributions get <b className="text-ink">every cent back</b>. Slop pays the maintainers whose time it wasted — decided by an AI judge whose every verdict you can verify yourself.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05 }} className="mt-8 flex flex-wrap gap-3">
            <a href={GITHUB_APP_URL} target="_blank" rel="noreferrer">
              <Button className="group h-11 px-5">
                Install on a repo <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Button>
            </a>
            <a href="#try">
              <Button variant="ghost" className="h-11 px-5">
                <Gavel className="size-4" /> Judge a PR now
              </Button>
            </a>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-faint">
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-brand" /> verifiable AI in a TEE</span>
            <span className="flex items-center gap-1.5"><Coins className="size-3.5 text-brand" /> USDC held by a contract, not a company</span>
            <span className="flex items-center gap-1.5"><Bot className="size-3.5 text-brand" /> capped wallets for coding agents</span>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 30, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.35, duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }}>
          <BondMachine />
        </motion.div>
      </div>
    </section>
  );
}

function Counters() {
  const cfg = useConfig();
  const { data } = useAsync(() => chain.totals(cfg), [cfg]);
  const items = [
    { label: "Held in bonds", value: Number(data?.held ?? 0), money: true },
    { label: "Refunded to contributors", value: Number(data?.refunded ?? 0), money: true },
    { label: "Paid by slop to maintainers", value: Number(data?.forfeited ?? 0), money: true },
    { label: "Bonds paid", value: data?.deposits ?? 0, money: false },
  ];
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="bg-bg px-4 py-6">
            <CountUp value={i.value} format={i.money ? usd : (n) => n.toFixed(0)} className="text-2xl font-semibold tracking-tight sm:text-3xl" />
            <div className="mt-1 flex items-center gap-1.5 text-xs text-faint">
              <span className="size-1.5 rounded-full bg-brand/70" />
              {i.label} · live on {cfg.network}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  { icon: GitPullRequest, title: "A stranger opens a PR", body: "PatchBond asks for a small refundable deposit in one comment. Maintainers, collaborators and proven contributors are waved through." },
  { icon: Coins, title: "They pay the bond", body: "USDC on NEAR, priced by the repo's queue. Agents pay from capped budgets their owners control." },
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

const EXAMPLES: [string, string][] = [
  ["tcpdump#1471", "https://github.com/the-tcpdump-group/tcpdump/pull/1471"],
  ["commander.js#2637", "https://github.com/tj/commander.js/pull/2637"],
  ["yazi#4426", "https://github.com/sxyazi/yazi/pull/4426"],
];

function TryTheJudge() {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    const id = toast.loading("Judging — reading the diff, the repo's CI and its code…");
    try {
      const r = await api.judge(url.trim());
      toast.success(`Verdict: ${r.verdict.replace("_", " ")}`, { id });
      nav(`/v/${r.id}`);
    } catch (err) {
      toast.error("Couldn't judge it", { id, description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="try" className="relative scroll-mt-20 overflow-hidden border-y border-line bg-panel/40">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
      <Reveal className="relative mx-auto max-w-3xl px-4 py-24 text-center">
        <Eyebrow>Try it</Eyebrow>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Paste any public pull request.</h2>
        <p className="mt-3 text-muted-foreground">The judge reads the diff, the repo's CI and its code, then gives a signed verdict you can verify. No wallet needed.</p>
        <form onSubmit={submit} className="mx-auto mt-8 flex max-w-xl flex-col gap-2 rounded-2xl border border-line bg-bg p-2 shadow-2xl shadow-black/30 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm outline-none placeholder:text-faint"
            required
            pattern="https://github\.com/.+/pull/\d+.*"
            title="A GitHub pull request URL"
          />
          <Button disabled={busy} className="h-11 px-5">
            {busy ? <><Spinner /> Judging…</> : <><Gavel className="size-4" /> Judge it</>}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
          <span className="text-faint">Try:</span>
          {EXAMPLES.map(([label, href]) => (
            <button key={label} onClick={() => setUrl(href)} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-muted-foreground hover:border-brand/50 hover:text-ink">
              {label}
            </button>
          ))}
        </div>
        <p className="mt-6 text-xs text-faint">
          Anywhere on the site: <kbd className="rounded border border-line bg-raised px-1.5 font-mono">⌘K</kbd> · From a terminal: <code className="font-mono text-muted-foreground">bun run --cwd server judge-pr &lt;url&gt;</code>
        </p>
      </Reveal>
    </section>
  );
}

function RecentVerdicts() {
  const { data, loading } = useAsync(() => api.verdicts(12), []);
  return (
    <section id="verdicts" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24">
      <Reveal>
        <Eyebrow>Public record</Eyebrow>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Every verdict is public, signed and checkable.</h2>
      </Reveal>
      <Panel className="mt-10 overflow-hidden">
        {loading && <div className="p-6 text-muted-foreground"><Spinner /></div>}
        {data?.length === 0 && <div className="p-6 text-sm text-muted-foreground">No verdicts yet — judge a PR above to make the first one.</div>}
        <ul className="divide-y divide-line">
          {data?.map((v, i) => (
            <motion.li key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
              <Link to={`/v/${v.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-raised/60">
                <VerdictBadge verdict={v.final.verdict} />
                <span className="font-medium">
                  {v.repo.full_name}
                  <span className="text-faint">#{v.number}</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{v.final.reasons[0]}</span>
                <span className="flex items-center gap-1 text-xs text-faint">
                  {v.mock ? "mock judge" : v.model}
                  <ArrowRight className="size-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
      </Panel>
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

function Closing() {
  return (
    <section className="relative overflow-hidden border-t border-line">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <Reveal className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
        <motion.div whileInView={{ rotate: [0, -10, 0] }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <Mark size={64} />
        </motion.div>
        <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Make your repo's attention worth something.</h2>
        <p className="mt-3 max-w-xl text-muted-foreground">Install the GitHub App, set a bond, and let slop pay for the time it takes. Two minutes, no token, no lock-in.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={GITHUB_APP_URL} target="_blank" rel="noreferrer">
            <Button className="h-11 px-5">Install on GitHub <ArrowRight className="size-4" /></Button>
          </a>
          <Link to="/agents">
            <Button variant="ghost" className="h-11 px-5"><Bot className="size-4" /> I run coding agents</Button>
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
