import { ArrowRight, Bot, Coins, Gavel, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { BondMachine } from "../components/BondMachine";
import { CountUp, Reveal, usd } from "../components/fx";
import { Button, Eyebrow, Mark, Panel, Spinner } from "../components/kit";
import { api, chain } from "../lib/api";
import { installUrl, useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

export function Home() {
  return (
    <>
      <Hero />
      <Counters />
      <TryTheJudge />
      <Explore />
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
            Strangers attach a small deposit to their pull request. Real contributions get <b className="text-ink">every cent back</b>. A forfeited bond pays the maintainers whose time it wasted — decided by an AI judge whose every verdict you can verify yourself.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05 }} className="mt-8 flex flex-wrap gap-3">
            <InstallLink>
              <Button className="group h-11 px-5">
                Install on a repo <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Button>
            </InstallLink>
            <a href="#try">
              <Button variant="ghost" className="h-11 px-5">
                <Gavel className="size-4" /> Judge a PR now
              </Button>
            </a>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-faint">
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-brand" /> verifiable AI in a TEE</span>
            <span className="flex items-center gap-1.5"><Coins className="size-3.5 text-brand" /> USDC or NEAR held by a contract, not a company</span>
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

/** The landing page stays short: the explainer and the public record are their own pages. */
function Explore() {
  const links = [
    { to: "/how", icon: Scale, title: "How it works", body: "The flow, the attention-priced bond curve, optimistic verdicts, priority lane, bounties — and the rules that keep it fair to both sides." },
    { to: "/verdicts", icon: ShieldCheck, title: "Every verdict", body: "The public record: each verdict signed in a TEE, with the exact bytes — open one and verify the signature in your browser." },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="group">
            <Panel className="h-full p-6 transition group-hover:border-brand/50">
              <l.icon className="size-5 text-brand" />
              <h3 className="mt-4 flex items-center gap-2 text-lg font-semibold">
                {l.title} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{l.body}</p>
            </Panel>
          </Link>
        ))}
      </div>
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
          <InstallLink>
            <Button className="h-11 px-5">Install on GitHub <ArrowRight className="size-4" /></Button>
          </InstallLink>
          <Link to="/agents">
            <Button variant="ghost" className="h-11 px-5"><Bot className="size-4" /> I run coding agents</Button>
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/** The GitHub App's install page once it exists; the maintainer page (which explains setup) until then. */
function InstallLink({ children }: { children: React.ReactNode }) {
  const { href, external } = installUrl(useConfig());
  return external ? (
    // Same tab, so GitHub's Setup URL can bring the maintainer back to the dashboard.
    <a href={href}>{children}</a>
  ) : (
    <Link to={href}>{children}</Link>
  );
}
