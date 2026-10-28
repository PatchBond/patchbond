import { formatUsdc } from "@patchbond/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { AttentionMeter } from "../components/AttentionMeter";
import { Button, Eyebrow, Mark, Notice, Panel, Spinner, VerdictBadge } from "../components/ui";
import { api, chain } from "../lib/api";
import { GITHUB_APP_URL, useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

const DEMO_POLICY = { base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8 };

export function Home() {
  const [open, setOpen] = useState(14);
  return (
    <>
      <Hero />
      <Counters />
      <section id="how" className="mx-auto max-w-6xl px-4 py-20">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">The sender spends ten seconds. The maintainer spends an hour. Now the sender has skin in the game.</h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="animate-rise" style={{ animationDelay: `${i * 80}ms` }}>
              <Panel className="h-full p-5">
                <div className="num flex size-8 items-center justify-center rounded-lg bg-raised text-sm font-semibold text-muted">{i + 1}</div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
              </Panel>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-panel/50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <Eyebrow>Attention pricing</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">EIP-1559 for maintainers.</h2>
            <p className="mt-4 leading-relaxed text-muted">
              The bond isn't a fixed fee. It follows the repo's queue of unreviewed outside submissions — computed <b className="text-ink">on-chain</b> from unsettled deposits, no oracle.
              A flood of slop prices itself out; a quiet repo costs a newcomer a few cents.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              Drag the queue. Proven contributors (3 refunds on 2 repos) pay <b className="text-ink">$0</b> at any level.
            </p>
            <p className="mt-6 font-mono text-xs text-faint">bond = clamp(min, max, base × 1.125^(open − capacity))</p>
          </div>
          <Panel className="p-5 sm:p-6">
            <AttentionMeter policy={DEMO_POLICY} open={open} onOpenChange={setOpen} />
          </Panel>
        </div>
      </section>

      <Mechanisms />
      <TryTheJudge />
      <RecentVerdicts />
      <Fairness />
    </>
  );
}

const STEPS = [
  { title: "A stranger opens a PR", body: "PatchBond asks for a small refundable deposit in one comment. Maintainers, collaborators and proven contributors are waved through." },
  { title: "They pay the bond", body: "USDC on NEAR, priced by the repo's queue. Agents pay from capped budgets their owners control." },
  { title: "A verifiable AI judges it", body: "After CI, a model running in a TEE on NEAR AI Cloud reviews it with facts we compute. The response is signed." },
  { title: "Refund — or the repo is paid", body: "Real work: every cent back. Slop: 90% to the repo's vault, 10% to run PatchBond. Either side can challenge." },
];

function Hero() {
  return (
    <section className="grid-bg relative overflow-hidden border-b border-line">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:pt-24">
        <div className="animate-rise flex items-center gap-3 text-sm text-muted">
          <Mark size={34} />
          <span className="rounded-full border border-line bg-panel px-3 py-1">Refundable bonds for pull requests · on NEAR</span>
        </div>
        <h1 className="animate-rise mt-8 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl" style={{ animationDelay: "60ms" }}>
          AI made sending free.
          <br />
          <span className="text-muted">PatchBond makes wasting a maintainer's time </span>
          <span className="text-accent">cost something.</span>
        </h1>
        <p className="animate-rise mt-6 max-w-2xl text-lg leading-relaxed text-muted" style={{ animationDelay: "120ms" }}>
          Strangers attach a small deposit to their pull request. Real contributions get every cent back. Slop pays the maintainers whose time it wasted — decided by an AI judge whose every verdict you can verify yourself.
        </p>
        <div className="animate-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
          <a href={GITHUB_APP_URL} target="_blank" rel="noreferrer">
            <Button>Install on a repo →</Button>
          </a>
          <a href="#try">
            <Button variant="ghost">Judge a PR now</Button>
          </a>
        </div>
      </div>
    </section>
  );
}

function Counters() {
  const cfg = useConfig();
  const { data } = useAsync(() => chain.totals(cfg), [cfg]);
  const items = [
    { label: "Held in bonds", value: data ? `$${formatUsdc(data.held)}` : "—" },
    { label: "Refunded to contributors", value: data ? `$${formatUsdc(data.refunded)}` : "—" },
    { label: "Paid by slop", value: data ? `$${formatUsdc(data.forfeited)}` : "—" },
    { label: "Deposits", value: data ? data.deposits : "—" },
  ];
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="bg-bg px-4 py-6">
            <div className="num text-2xl font-semibold tracking-tight sm:text-3xl">{i.value}</div>
            <div className="mt-1 text-xs text-faint">{i.label} · live from the contract</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const MECHANISMS = [
  { tag: "Priority lane", title: "Pay for attention, not for submitting", body: "Add a review tip. The repo earns it only if a maintainer reviews within the promised window — otherwise it comes back." },
  { tag: "Optimistic verdicts", title: "Cheap AI by default, strong AI when money's on the line", body: "A fast verifiable model decides. Either side can stake to challenge; a stronger model re-judges and the loser's stake pays the winner." },
  { tag: "Slop funds the fix", title: "Spam pays whoever really fixes the issue", body: "A forfeited PR that claimed to fix #N becomes a bounty on #N, paid automatically when a real fix is merged." },
  { tag: "Know your agent", title: "Capped wallets and passports for coding agents", body: "Agents pay bonds with a function-call key from a budget whose daily cap the contract enforces. Each harness gets a public refund record." },
];

function Mechanisms() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <Eyebrow>Not a slop filter — a market</Eyebrow>
      <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">Four mechanisms nobody else has, all enforced by one NEAR contract.</h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {MECHANISMS.map((m) => (
          <Panel key={m.tag} className="p-6">
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">{m.tag}</span>
            <h3 className="mt-4 text-lg font-semibold tracking-tight">{m.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{m.body}</p>
          </Panel>
        ))}
      </div>
    </section>
  );
}

function TryTheJudge() {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.judge(url.trim());
      nav(`/v/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="try" className="border-y border-line bg-panel/50">
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <Eyebrow>Try it</Eyebrow>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">Paste any public pull request.</h2>
        <p className="mt-3 text-muted">The judge reads the diff, the repo's CI and its code, then gives a signed verdict you can verify. No wallet needed.</p>
        <form onSubmit={submit} className="mx-auto mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 font-mono text-sm outline-none placeholder:text-faint focus:border-accent"
            required
            pattern="https://github\.com/.+/pull/\d+.*"
            title="A GitHub pull request URL"
          />
          <Button disabled={busy}>{busy ? <><Spinner /> Judging…</> : "Judge it"}</Button>
        </form>
        {busy && <p className="mt-3 text-xs text-faint">Fetching the diff, the repo's code and CI, then asking the model — about 15 seconds.</p>}
        {err && (
          <div className="mx-auto mt-4 max-w-xl text-left">
            <Notice tone="error">{err}</Notice>
          </div>
        )}
        <p className="mt-6 text-xs text-faint">
          Or from a terminal: <code className="font-mono text-muted">bun run --cwd server judge-pr &lt;url&gt;</code>
        </p>
      </div>
    </section>
  );
}

function RecentVerdicts() {
  const { data, loading, error } = useAsync(() => api.verdicts(8), []);
  return (
    <section id="verdicts" className="mx-auto max-w-6xl px-4 py-20">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Eyebrow>Public record</Eyebrow>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Every verdict is public and signed.</h2>
        </div>
      </div>
      <Panel className="mt-8 divide-y divide-line">
        {loading && <div className="p-6 text-muted"><Spinner /></div>}
        {error && <div className="p-4"><Notice tone="error">{error}</Notice></div>}
        {data?.length === 0 && <div className="p-6 text-sm text-muted">No verdicts yet — judge a PR above to make the first one.</div>}
        {data?.map((v) => (
          <Link key={v.id} to={`/v/${v.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-raised/60">
            <VerdictBadge verdict={v.final.verdict} />
            <span className="font-medium">
              {v.repo.full_name}
              <span className="text-faint">#{v.number}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{v.final.reasons[0]}</span>
            <span className="text-xs text-faint">{v.mock ? "mock judge" : v.model}</span>
          </Link>
        ))}
      </Panel>
    </section>
  );
}

function Fairness() {
  const points = [
    ["Optional per repo", "Maintainers turn it on. Nobody is forced to pay to contribute anywhere."],
    ["Proven people pay $0", "Three refunds on two repos and the bond disappears — everywhere, because reputation lives on-chain."],
    ["When in doubt, refund", "A forfeit needs high confidence and concrete evidence. Clean CI and real code can't be forfeited by the model alone."],
    ["Nobody is paid to submit", "No token, no rewards for volume. The money only flows from wasted time to the people whose time it was."],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24">
      <Panel className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>“Doesn't this make open source less open?”</Eyebrow>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Only for people who waste others' time.</h2>
        </div>
        <dl className="grid gap-6 sm:grid-cols-2">
          {points.map(([t, b]) => (
            <div key={t}>
              <dt className="font-semibold">{t}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted">{b}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </section>
  );
}
