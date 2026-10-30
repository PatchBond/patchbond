// Maintainers: sign in with GitHub, link each repo's vault to a NEAR account (NEP-413 proof),
// then withdraw, tune the bond policy (with a live price preview) and decide needs_human cases.

import { DECIMALS, formatAmount, parseAmount, SYMBOL, type Currency, type VerdictRecord } from "@patchbond/shared";
import { Bell, Link2, LogOut, Scale, Settings2, Vault } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttentionMeter } from "../components/AttentionMeter";
import { AnimatedNumber, Reveal } from "../components/fx";
import { Button, Eyebrow, GithubIcon, Notice, Panel, Spinner, VerdictBadge } from "../components/kit";
import { api, chain, money, type ActivityItem, type Deposit, type MaintainerRepo, type Policy } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";

export function Dashboard() {
  const { data: me, error, loading, reload } = useAsync(api.me, []);
  // GitHub's Setup URL brings maintainers back here with ?installation_id=…&setup_action=install|update.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const action = q.get("setup_action");
    if (!action) return;
    history.replaceState(null, "", location.pathname);
    toast.success(action === "install" ? "PatchBond is installed" : "Repositories updated", {
      description: "Link each repository to your NEAR account below. Bonds stay off until you turn them on.",
    });
  }, []);
  if (loading && !me) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
  if (error) return <div className="mx-auto max-w-lg px-4 py-24"><Notice tone="error" title="Couldn't load your repositories">{error}</Notice></div>;
  if (!me?.signed_in) return <SignedOut ready={me?.github_ready ?? false} expired={me?.expired ?? false} />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Maintainer dashboard</Eyebrow>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Hi @{me.github_login}</h1>
          <p className="mt-1 text-muted-foreground">Repositories you administer that have the PatchBond App installed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <InstallButton label="Add repositories" />
          <Button variant="ghost" onClick={() => void api.logout().then(reload)}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </div>
      {me.repos.length > 0 && <Activity />}
      {me.repos.length === 0 ? (
        <Panel className="mt-8 p-8 text-center">
          <p className="text-muted-foreground">No repositories yet. Install the PatchBond App on a repository you administer, then come back.</p>
          <InstallButton className="mt-5" />
        </Panel>
      ) : (
        <div className="mt-8 space-y-6">
          {me.repos.map((r, i) => (
            <Reveal key={r.repo_id} delay={i * 0.05}>
              <RepoCard repo={r} onChange={reload} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

const SEEN_KEY = "pb-activity-seen";

const ACTIVITY: Record<ActivityItem["state"], { text: (i: ActivityItem) => string; urgent?: boolean }> = {
  awaiting_deposit: { text: (i) => `@${i.author} opened #${i.number} — waiting for the deposit` },
  closed_unpaid: { text: (i) => `#${i.number} closed: no deposit (reopens if paid)` },
  deposit_received: { text: (i) => `@${i.author} paid the deposit on #${i.number} — ready for review`, urgent: true },
  judging: { text: (i) => `The judge is reviewing #${i.number}` },
  judged: { text: (i) => `Verdict on #${i.number}`, urgent: true },
  settled: { text: (i) => `#${i.number} settled on-chain` },
  exempt: { text: (i) => `#${i.number} by @${i.author}: no deposit needed` },
  closed: { text: (i) => `#${i.number} closed` },
};

/** In-app notifications: the latest events across your repos, refreshed every 30 s; new ones glow. */
function Activity() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [seen] = useState(() => {
    try {
      return Number(localStorage.getItem(SEEN_KEY) ?? 0);
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    let live = true;
    const load = () => api.activity().then((r) => live && setItems(r.items)).catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!items?.length) return;
    try {
      localStorage.setItem(SEEN_KEY, String(Math.max(...items.map((i) => i.at))));
    } catch {
      // private mode: "new" just isn't remembered
    }
  }, [items]);
  if (!items) return null;
  const fresh = items.filter((i) => i.at > seen).length;
  return (
    <Panel className="mt-8 p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bell className="size-4" /> Activity
        {fresh > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-bg">{fresh} new</span>}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing yet. When an outside PR arrives, it shows up here — and the bot @mentions you on GitHub when a deposit lands.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.slice(0, 8).map((i) => {
            const a = ACTIVITY[i.state];
            const isNew = i.at > seen;
            const body = (
              <span className={`min-w-0 flex-1 truncate ${a.urgent ? "text-ink" : "text-muted-foreground"}`}>
                <span className="text-faint">{i.full_name}</span> · {a.text(i)}
              </span>
            );
            return (
              <li key={`${i.repo_id}/${i.number}`} className="flex items-center gap-3 py-2 text-sm">
                <span className={`size-2 shrink-0 rounded-full ${isNew ? "bg-brand" : "bg-line"}`} />
                {i.verdict_id ? <Link to={`/v/${i.verdict_id}`} className="min-w-0 flex-1 hover:underline">{body}</Link> : <a href={`https://github.com/${i.full_name}/pull/${i.number}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">{body}</a>}
                <span className="num shrink-0 text-xs text-faint">{ago(i.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

function InstallButton({ className = "", label = "Install the GitHub App" }: { className?: string; label?: string }) {
  const cfg = useConfig();
  if (!cfg.github?.app_url) return null; // nothing to install until the operator creates the App
  // select_target lists the user's accounts with Install or Configure — so someone who already
  // installed the App adds repos instead of hitting GitHub's "already installed" notice.
  const url = `${cfg.github.app_url}/installations/select_target`;
  return (
    // Same tab: after installing, GitHub's Setup URL returns the maintainer to this page.
    <a href={url} className={className}>
      <Button variant="ghost">
        <GithubIcon /> {label}
      </Button>
    </a>
  );
}

function SignedOut({ ready, expired }: { ready: boolean; expired: boolean }) {
  const steps = [
    ["Install the App", "On any repository you administer. GitHub only lets admins install Apps."],
    ["Sign in with GitHub", "We check — with GitHub — that you're an admin of the repo."],
    ["Link a NEAR account", "Sign a free message in your wallet. Only that account can withdraw or change the policy."],
    ["Set your bond", "Base price, capacity, review window. Slop now pays for the time it takes."],
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <Reveal>
          <Eyebrow>For maintainers</Eyebrow>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Get paid for the time slop takes.</h1>
          <p className="mt-5 leading-relaxed text-muted-foreground">
            Forfeited bonds collect in your repository's vault on NEAR — held by a contract, not by us — and wait for you even before you link. Link once, then withdraw whenever you like.
          </p>
          {expired && (
            <div className="mt-6">
              <Notice tone="warn" title="Your GitHub sign-in expired">
                GitHub ends these sign-ins after a few hours, and whenever the App's permissions change. Sign in again — your linked repos and vaults are untouched.
              </Notice>
            </div>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            {ready ? (
              <a href="/api/auth/github">
                <Button className="h-11 px-5">
                  <GithubIcon /> Sign in with GitHub
                </Button>
              </a>
            ) : (
              <div className="space-y-3">
                <Notice tone="warn" title="The GitHub App doesn't exist yet">
                  Whoever runs this server creates it once — GitHub fills in every permission. Be signed in to GitHub as an admin of the organisation that will own it.
                </Notice>
                <a href="/setup">
                  <Button className="h-11 px-5">
                    <GithubIcon /> Create the GitHub App
                  </Button>
                </a>
              </div>
            )}
            <InstallButton />
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <ol className="space-y-3">
            {steps.map(([t, b], i) => (
              <li key={t} className="animate-rise" style={{ animationDelay: `${150 + i * 80}ms` }}>
                <Panel className="flex gap-4 p-4">
                  <span className="num grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-bold text-brand">{i + 1}</span>
                  <div>
                    <div className="font-semibold">{t}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{b}</div>
                  </div>
                </Panel>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </div>
  );
}

function RepoCard({ repo, onChange }: { repo: MaintainerRepo; onChange: () => void }) {
  const wallet = useWallet();
  const r = repo.onchain;
  const linkedToMe = !!r?.payout && r.payout === wallet.accountId;
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line p-5">
        <div className="min-w-0 flex-1">
          <a href={`https://github.com/${repo.full_name}`} target="_blank" rel="noreferrer" className="text-lg font-semibold tracking-tight hover:underline">
            {repo.full_name}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {!r ? (
              <span className="rounded-full bg-raised px-2 py-0.5 text-muted-foreground">Not registered yet</span>
            ) : r.payout ? (
              <span className="flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-brand">
                <Link2 className="size-3" /> paid out to <span className="font-mono">{r.payout}</span>
              </span>
            ) : (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">Not linked — forfeits wait safely in the vault</span>
            )}
            {r && !r.policy.enabled && <span className="rounded-full bg-raised px-2 py-0.5 text-muted-foreground">PatchBond off</span>}
            <Link to={`/r/${repo.repo_id}`} className="text-faint hover:text-ink">public page →</Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 text-right">
          <Mini
            label="Vault"
            value={
              <AnimatedNumber
                value={Number(r?.vault ?? 0) / 10 ** DECIMALS[r?.currency ?? "usdc"]}
                format={(n) => (r?.currency === "near" ? `${n.toFixed(2)} NEAR` : `$${n.toFixed(2)}`)}
              />
            }
          />
          <Mini label="Open" value={r?.open ?? 0} />
          <Mini label="Refund / forfeit" value={`${r?.stats.refunds ?? 0} / ${r?.stats.forfeits ?? 0}`} />
        </div>
      </div>
      <div className="p-5">
        {!linkedToMe ? (
          <LinkPanel repo={repo} onLinked={onChange} />
        ) : (
          <Tabs defaultValue="vault">
            <TabsList>
              <TabsTrigger value="vault"><Vault className="size-4" /> Vault</TabsTrigger>
              <TabsTrigger value="policy"><Settings2 className="size-4" /> Bond policy</TabsTrigger>
              <TabsTrigger value="queue"><Scale className="size-4" /> Needs you</TabsTrigger>
            </TabsList>
            <TabsContent value="vault" className="pt-4">
              <Withdraw repo={repo} onDone={onChange} />
              <CrossChain repo={repo} />
              <HandOver repo={repo} onDone={onChange} />
            </TabsContent>
            <TabsContent value="policy" className="pt-4"><PolicyTab repo={repo} onSaved={onChange} /></TabsContent>
            <TabsContent value="queue" className="pt-4"><Queue repo={repo} /></TabsContent>
          </Tabs>
        )}
      </div>
    </Panel>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-faint">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
    </div>
  );
}

function LinkPanel({ repo, onLinked }: { repo: MaintainerRepo; onLinked: () => void }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const payout = repo.onchain?.payout;
  async function link() {
    if (!wallet.accountId) return;
    setBusy(true);
    try {
      const ch = await api.linkChallenge(repo.repo_id, wallet.accountId);
      const signed = await wallet.signMessage({ message: ch.message, recipient: ch.recipient, nonce: Uint8Array.from(atob(ch.nonce), (c) => c.charCodeAt(0)) });
      await api.linkConfirm({ nonce: ch.nonce, account_id: signed.accountId, public_key: signed.publicKey, signature: signed.signature });
      toast.success(`${repo.full_name} linked to ${signed.accountId}`, { description: "Only this account can withdraw, change the policy or hand it over." });
      onLinked();
    } catch (e) {
      toast.error("Not linked", { description: (e as Error).message || "The wallet closed before signing." });
    } finally {
      setBusy(false);
    }
  }
  if (payout) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          This repo pays out to <span className="font-mono text-ink">{payout}</span>. Connect that wallet to manage it. Only that account can hand the repo to another — not PatchBond, not anyone with our keys.
        </p>
        {!wallet.accountId && <Button variant="ghost" onClick={() => void wallet.connect()}>Connect {payout}</Button>}
      </div>
    );
  }
  const steps = [
    { n: 1, t: "Connect a NEAR wallet", done: !!wallet.accountId },
    { n: 2, t: "Link it — a free signature, no fee", done: false },
    { n: 3, t: "Set your bond and turn PatchBond on", done: false },
  ];
  return (
    <div className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((st) => (
          <li key={st.n} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${st.done ? "border-brand/40 bg-brand-soft text-ink" : "border-line text-muted-foreground"}`}>
            <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${st.done ? "bg-brand text-bg" : "bg-raised"}`}>{st.done ? "✓" : st.n}</span>
            {st.t}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-xl text-sm text-muted-foreground">
        Link this repository to your NEAR account first: the bond settings unlock here once it's linked, because only that account can change them on-chain — not PatchBond. Until then nobody is asked for a deposit.
      </p>
      {wallet.accountId ? (
        <Button onClick={() => void link()} disabled={busy}>
          {busy ? <><Spinner /> Sign in your wallet…</> : <><Link2 className="size-4" /> Link to {wallet.accountId}</>}
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => void wallet.connect()}>Connect a NEAR wallet</Button>
      )}
      </div>
    </div>
  );
}

const CHAINS = [
  ["base", "Base", "0x…"],
  ["arb", "Arbitrum", "0x…"],
  ["eth", "Ethereum", "0x…"],
  ["sol", "Solana", "base58 address"],
] as const;

function CrossChain({ repo }: { repo: MaintainerRepo }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const vault = BigInt(repo.onchain?.vault ?? "0");
  const currency = repo.onchain?.currency ?? "usdc";
  const [chainId, setChainId] = useState<string>("base");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof api.intentsQuote>> | null>(null);
  async function ask() {
    setBusy(true);
    setQuote(null);
    try {
      // Quote the whole vault (or 5 USDC / 5 NEAR when it's nearly empty, to show what it would look like).
      const five = parseAmount("5", currency);
      const amount = (vault >= five / 50n ? vault : five).toString();
      setQuote(await api.intentsQuote({ amount, currency, chain: chainId, recipient: to.trim(), refund_to: wallet.accountId ?? "" }));
    } catch (e) {
      toast.error("No quote", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const meta = CHAINS.find(([id]) => id === chainId)!;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        Receive on another chain <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint">NEAR Intents</span>
      </div>
      <p className="mt-1 text-xs text-faint">USDC lands on the chain you pick, through NEAR Intents 1Click{currency === "near" ? " (your NEAR is swapped on the way)" : ""}.{cfg.network === "testnet" ? " Intents has no testnet, so this shows a live dry-run quote; nothing moves." : ""}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex rounded-xl border border-line p-0.5">
          {CHAINS.map(([id, name]) => (
            <button key={id} onClick={() => setChainId(id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${chainId === id ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink"}`}>
              {name}
            </button>
          ))}
        </div>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={`${meta[1]} address (${meta[2]})`} className="min-w-64 flex-1 rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-brand" />
        <Button variant="ghost" disabled={busy || !to.trim()} onClick={() => void ask()}>
          {busy ? <Spinner /> : "Get quote"}
        </Button>
      </div>
      {quote && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm">
          <div>
            Send <b className="num">{money(quote.amount_in, currency)}</b> → receive <b className="num text-brand">{money(quote.amount_out)}</b> USDC on {quote.chain} in about <b>{quote.seconds} s</b>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            At least {money(quote.min_amount_out)} guaranteed · withdraw fee ${formatAmount(quote.fees.withdraw, "usdc", 4)} · {cfg.network === "testnet" ? "dry-run quote — nothing moved" : "live on mainnet"}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function HandOver({ repo, onDone }: { repo: MaintainerRepo; onDone: () => void }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^[a-z0-9._-]{2,64}$/.test(to) && to !== wallet.accountId;
  async function go() {
    setBusy(true);
    try {
      const out = await wallet.call(cfg.contract, "set_payout", { repo_id: repo.repo_id, payout: to }, { deposit: "1", tgas: 30 });
      if (out.error) toast.error("Not handed over", { description: out.error });
      else toast.success(`${repo.full_name} now pays out to ${to}`);
      onDone();
    } catch (e) {
      toast.error("Not handed over", { description: (e as Error).message || "The wallet closed before signing." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="text-sm font-medium">Hand over to another account</div>
      <p className="mt-1 text-xs text-faint">E.g. a project DAO (Sputnik / Trezu). After this, only that account controls the vault and policy.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="project.sputnik-dao.near" className="w-72 rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-brand" />
        <Button variant="ghost" disabled={!valid || busy} onClick={() => void go()}>
          {busy ? <Spinner /> : "Hand over"}
        </Button>
      </div>
    </div>
  );
}

function Withdraw({ repo, onDone }: { repo: MaintainerRepo; onDone: () => void }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const vault = BigInt(repo.onchain?.vault ?? "0");
  const currency = repo.onchain?.currency ?? "usdc";
  const near = currency === "near";
  const [amount, setAmount] = useState(formatAmount(vault, currency));
  const [unwrap, setUnwrap] = useState(true);
  const [busy, setBusy] = useState(false);
  let units = 0n;
  let err: string | null = null;
  try {
    units = parseAmount(amount, currency);
    if (units > vault) err = `The vault holds ${money(vault, currency)}.`;
    if (units === 0n) err = "Enter an amount above zero.";
  } catch (e) {
    err = (e as Error).message;
  }
  async function go() {
    setBusy(true);
    try {
      const withdraw = { receiverId: cfg.contract, actions: [{ methodName: "withdraw", args: { repo_id: repo.repo_id, amount: units.toString() }, deposit: "1", tgas: 100 }] };
      let out;
      if (near && cfg.wnear && wallet.accountId) {
        // wNEAR has to know you before it can pay you; then optionally unwrap to plain NEAR.
        const registered = await chain.registered(cfg, cfg.wnear, wallet.accountId);
        out = await wallet.send([
          ...(registered ? [] : [{ receiverId: cfg.wnear, actions: [{ methodName: "storage_deposit", args: { registration_only: true }, deposit: "1250000000000000000000", tgas: 10 }] }]),
          withdraw,
          ...(unwrap ? [{ receiverId: cfg.wnear, actions: [{ methodName: "near_withdraw", args: { amount: units.toString() }, deposit: "1", tgas: 10 }] }] : []),
        ]);
      } else {
        out = await wallet.send([withdraw]);
      }
      if (out.error) toast.error("Withdrawal failed", { description: out.error });
      else toast.success(`${money(units, currency)} sent to ${wallet.accountId}`);
      onDone();
    } catch (e) {
      toast.error("Not sent", { description: (e as Error).message || "The wallet closed before signing." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <div className="text-xs text-faint">Available</div>
        <div className="num text-3xl font-semibold">{money(vault, currency)}</div>
      </div>
      <label className="text-sm">
        <span className="text-muted-foreground">Amount ({SYMBOL[currency]})</span>
        <div className="mt-1 flex gap-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-32 rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-brand" />
          <Button variant="quiet" onClick={() => setAmount(formatAmount(vault, currency))}>Max</Button>
        </div>
      </label>
      <Button onClick={() => void go()} disabled={busy || !!err || vault === 0n}>
        {busy ? <Spinner /> : <Vault className="size-4" />} Withdraw to {wallet.accountId}
      </Button>
      {near && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={unwrap} onChange={(e) => setUnwrap(e.target.checked)} className="size-4 accent-[var(--brand)]" />
          Receive plain NEAR (unwrap the wNEAR)
        </label>
      )}
      {err && vault > 0n && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

/** Starting prices when a repo switches currency (the old amounts mean nothing in the new one). */
const DEFAULT_PRICES: Record<Currency, { base: string; min: string; max: string }> = {
  usdc: { base: "2.00", min: "0.25", max: "50.00" },
  near: { base: "1.00", min: "0.10", max: "25.00" },
};

/** The policy in force, read from the contract — with Edit to change it. */
function PolicyTab({ repo, onSaved }: { repo: MaintainerRepo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const r = repo.onchain!;
  const p = r.policy;
  const currency = r.currency ?? "usdc";
  if (editing) {
    return (
      <PolicyEditor
        repo={repo}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onSaved();
        }}
      />
    );
  }
  const isDefault =
    currency === "usdc" && p.base_bond === "2000000" && p.min_bond === "250000" && p.max_bond === "50000000" && p.target_open === 8 &&
    p.review_window_sec === 259200 && p.challenge_window_sec === 259200 && p.forfeit_threshold_bps === 8500;
  const rows: [string, string][] = [
    ["Paid in", SYMBOL[currency]],
    ["Base bond", `${money(p.base_bond, currency)} at capacity`],
    ["Range", `${money(p.min_bond, currency)} – ${money(p.max_bond, currency)}`],
    ["Review capacity", `${p.target_open} outside PRs at once`],
    ["Review window", `${p.review_window_sec / 3600} h (earns the priority tip)`],
    ["Challenge window", `${p.challenge_window_sec / 3600} h before a verdict stands`],
    ["Forfeit threshold", `${p.forfeit_threshold_bps / 100}% AI confidence`],
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <div className={`rounded-xl border px-4 py-3 text-sm ${p.enabled ? "border-brand/30 bg-brand-soft" : "border-line bg-bg"}`}>
          <div className="font-medium">{p.enabled ? "On — outside PRs are asked for a refundable deposit" : "Off — nobody is asked for a deposit"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {p.enabled
              ? "Maintainers, collaborators and proven contributors are never asked. Nobody is blocked from opening a PR."
              : "Your settings are saved. Turn PatchBond on (Edit) when you're ready for contributors to see it."}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-medium">Current policy</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted-foreground">{isDefault ? "Default settings" : "Your settings · on-chain"}</span>
          </div>
          <dl className="divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="num text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Button onClick={() => setEditing(true)}>
          <Settings2 className="size-4" /> Edit policy
        </Button>
      </div>
      <div className="rounded-2xl border border-line bg-bg p-4">
        <div className="mb-2 text-xs text-faint">What newcomers pay as the queue grows</div>
        <AttentionMeter policy={p} open={r.open} maxOpen={Math.max(24, p.target_open * 3)} compact currency={currency} />
      </div>
    </div>
  );
}

function PolicyEditor({ repo, onSaved, onCancel }: { repo: MaintainerRepo; onSaved: () => void; onCancel: () => void }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const r = repo.onchain!;
  const p = r.policy;
  const current = r.currency ?? "usdc";
  const [currency, setCurrency] = useState<Currency>(current);
  const switching = currency !== current;
  // The contract only lets a repo switch while nothing is held in the old currency.
  const switchBlocked = r.open > 0 || BigInt(r.vault) > 0n ? "Withdraw the vault and let open deposits settle before switching currency." : null;
  const [f, setF] = useState({
    enabled: p.enabled,
    base: formatAmount(p.base_bond, current),
    min: formatAmount(p.min_bond, current),
    max: formatAmount(p.max_bond, current),
    capacity: String(p.target_open),
    reviewH: String(p.review_window_sec / 3600),
    challengeH: String(p.challenge_window_sec / 3600),
    threshold: String(p.forfeit_threshold_bps / 100),
  });
  const [preview, setPreview] = useState(repo.onchain!.open);
  const [busy, setBusy] = useState(false);

  let next: Policy | null = null;
  let err: string | null = null;
  try {
    next = {
      enabled: f.enabled,
      base_bond: parseAmount(f.base, currency).toString(),
      min_bond: parseAmount(f.min, currency).toString(),
      max_bond: parseAmount(f.max, currency).toString(),
      target_open: Number(f.capacity),
      review_window_sec: Math.round(Number(f.reviewH) * 3600),
      challenge_window_sec: Math.round(Number(f.challengeH) * 3600),
      forfeit_threshold_bps: Math.round(Number(f.threshold) * 100),
    };
    const [mn, b, mx] = [BigInt(next.min_bond), BigInt(next.base_bond), BigInt(next.max_bond)];
    if (!(mn > 0n && mn <= b && b <= mx)) err = "Bonds must satisfy 0 < min ≤ base ≤ max.";
    else if (!Number.isInteger(next.target_open) || next.target_open < 1) err = "Capacity must be a whole number ≥ 1.";
    else if (next.review_window_sec > 30 * 86400 || next.challenge_window_sec > 30 * 86400 || next.review_window_sec < 0 || next.challenge_window_sec < 0) err = "Windows must be between 0 and 720 hours.";
    else if (next.forfeit_threshold_bps < 5000 || next.forfeit_threshold_bps > 10000) err = "The forfeit threshold must be between 50% and 100%.";
  } catch (e) {
    err = (e as Error).message;
  }
  useEffect(() => setPreview(repo.onchain!.open), [repo.onchain]);

  async function save() {
    if (!next) return;
    setBusy(true);
    try {
      const out = switching
        ? await wallet.call(cfg.contract, "set_currency", { repo_id: repo.repo_id, currency, policy: next }, { tgas: 30 })
        : await wallet.call(cfg.contract, "set_policy", { repo_id: repo.repo_id, policy: next }, { tgas: 30 });
      if (out.error) {
        toast.error("Policy not saved", { description: out.error });
      } else {
        toast.success(switching ? `Bonds are now paid in ${SYMBOL[currency]}` : "Bond policy saved on-chain", {
          description: next.enabled ? "PatchBond is on for this repo." : "PatchBond is still off — nobody is asked for a deposit yet.",
        });
        onSaved();
      }
    } catch (e) {
      toast.error("Not saved", { description: (e as Error).message || "The wallet closed before signing." });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof f, label: string, hint: string, suffix = "") => (
    <label className="text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} className="w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-brand" />
        {suffix && <span className="text-xs text-faint">{suffix}</span>}
      </div>
      <span className="mt-1 block text-[11px] text-faint">{hint}</span>
    </label>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <label className="flex items-center justify-between rounded-xl border border-line bg-bg px-4 py-3 text-sm">
          <span>
            <span className="font-medium">PatchBond on</span>
            <span className="block text-xs text-faint">Off: no deposits are asked for this repo.</span>
          </span>
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="size-5 accent-[var(--brand)]" />
        </label>
        <div className="rounded-xl border border-line bg-bg px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="font-medium">Contributors pay in</span>
              <span className="block text-xs text-faint">NEAR is held as wNEAR; contributors pay plain NEAR and the wallet wraps it.</span>
            </span>
            <div className="flex rounded-xl border border-line p-0.5">
              {(["usdc", "near"] as const).map((c) => (
                <button
                  key={c}
                  disabled={c === "near" && !cfg.wnear}
                  onClick={() => {
                    setCurrency(c);
                    // Prices carry over only within a currency.
                    setF({ ...f, ...(c === current ? { base: formatAmount(p.base_bond, current), min: formatAmount(p.min_bond, current), max: formatAmount(p.max_bond, current) } : DEFAULT_PRICES[c]) });
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${currency === c ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink"}`}
                >
                  {SYMBOL[c]}
                </button>
              ))}
            </div>
          </div>
          {switching && <p className={`mt-2 text-xs ${switchBlocked ? "text-danger" : "text-warn"}`}>{switchBlocked ?? `Saving switches this repo to ${SYMBOL[currency]}. Check the prices below — they're in ${SYMBOL[currency]} now.`}</p>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {field("base", "Base bond", "at capacity", SYMBOL[currency])}
          {field("min", "Minimum", "quiet repo", SYMBOL[currency])}
          {field("max", "Maximum", "flood ceiling", SYMBOL[currency])}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("capacity", "Review capacity", "outside PRs at once")}
          {field("threshold", "Forfeit threshold", "AI confidence needed", "%")}
          {field("reviewH", "Review window", "earns the priority tip", "h")}
          {field("challengeH", "Challenge window", "before a verdict stands", "h")}
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy || !!err || (switching && !!switchBlocked)}>
            {busy ? <Spinner /> : <Settings2 className="size-4" />} {switching ? `Switch to ${SYMBOL[currency]} and save` : "Save policy on-chain"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-bg p-4">
        <div className="mb-2 text-xs text-faint">Live preview — drag to see what newcomers would pay</div>
        {next && !err ? <AttentionMeter policy={next} open={preview} onOpenChange={setPreview} maxOpen={Math.max(24, next.target_open * 3)} compact currency={currency} /> : <div className="p-8 text-sm text-faint">Fix the fields to see the curve.</div>}
      </div>
    </div>
  );
}

function Queue({ repo }: { repo: MaintainerRepo }) {
  const cfg = useConfig();
  const wallet = useWallet();
  const { data, loading, reload } = useAsync(async () => {
    const list = (await api.verdicts(50, repo.repo_id)).filter((v) => v.final.verdict === "needs_human");
    const withDeposit = await Promise.all(list.map(async (v) => ({ v, d: await chain.deposit(cfg, repo.repo_id, v.number) })));
    return withDeposit.filter((x): x is { v: (typeof list)[number]; d: Deposit } => !!x.d && !(typeof x.d.status === "object" && "settled" in x.d.status));
  }, [repo.repo_id]);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(v: Pick<VerdictRecord, "number" | "verdict_hash">, verdict: "refund" | "forfeit") {
    setBusy(`${v.number}:${verdict}`);
    try {
      const out = await wallet.call(cfg.contract, "settle", { repo_id: repo.repo_id, number: v.number, verdict, verdict_hash: v.verdict_hash }, { tgas: 150 });
      if (out.error) toast.error("Not settled", { description: out.error });
      else toast.success(`#${v.number}: ${verdict === "refund" ? "refunded" : "forfeited"}`);
      reload();
    } catch (e) {
      toast.error("Not settled", { description: (e as Error).message || "The wallet closed before signing." });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Nothing needs you. Undecided cases are refunded automatically after 14 days.</p>;
  return (
    <ul className="space-y-2">
      {data.map(({ v, d }) => (
        <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg px-4 py-3">
          <VerdictBadge verdict="needs_human" />
          <a href={`https://github.com/${repo.full_name}/pull/${v.number}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            #{v.number}
          </a>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{v.final.reasons[0]}</span>
          <span className="num text-xs text-faint">{money(d.bond, repo.onchain?.currency)}</span>
          <Link to={`/v/${v.id}`} className="text-xs text-faint hover:text-ink">verdict</Link>
          <Button variant="ghost" disabled={!!busy} onClick={() => void decide(v, "refund")}>
            {busy === `${v.number}:refund` ? <Spinner /> : "Refund"}
          </Button>
          <Button variant="danger" disabled={!!busy} onClick={() => void decide(v, "forfeit")}>
            {busy === `${v.number}:forfeit` ? <Spinner /> : "Forfeit"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
