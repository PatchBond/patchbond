import { Bot, Check, Copy, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Reveal, Spotlight } from "../components/fx";
import { Eyebrow, Mark, Panel, Spinner } from "../components/kit";
import { chain } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

const HARNESSES = ["claude-code", "codex", "cursor", "copilot", "devin", "aider", "openhands", "jules", "other"];

export function Agents() {
  const cfg = useConfig();
  const { data, loading, error } = useAsync(() => Promise.all(HARNESSES.map(async (h) => ({ h, s: await chain.harness(cfg, h) }))), [cfg]);
  const rows = (data ?? []).sort((a, b) => b.s.deposits - a.s.deposits || a.h.localeCompare(b.h));
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        <Reveal>
          <Eyebrow>Know your agent</Eyebrow>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Coding agents are the senders now. Give them a wallet that can't hurt you.</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
            An agent pays bonds from a budget you fund, signing with a NEAR <b className="text-ink">function-call key</b> that can call one method on one contract. The contract enforces the daily cap. Every payment carries a passport, and every
            harness earns a public, verifiable refund record.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <Passport />
        </Reveal>
      </div>

      <Reveal className="mt-16">
        <Eyebrow>Leaderboard · straight from the contract</Eyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Which harnesses waste maintainers' time?</h2>
      </Reveal>
      <Panel className="mt-6 overflow-hidden">
        {loading && <div className="p-6"><Spinner /></div>}
        {error && <div className="p-6 text-sm text-danger">Couldn't read the contract: {error}</div>}
        <ul className="divide-y divide-line">
          {rows.map(({ h, s }, i) => {
            const judged = s.refunds + s.forfeits;
            const rate = judged ? s.refunds / judged : null;
            return (
              <motion.li key={h} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="grid grid-cols-[1.2fr_repeat(3,0.5fr)_1.4fr] items-center gap-3 px-5 py-3.5 text-sm">
                <span className="flex items-center gap-2 font-mono">
                  <Bot className="size-4 text-faint" /> {h}
                </span>
                <span className="num text-muted-foreground">{s.deposits} <span className="hidden text-faint sm:inline">bonds</span></span>
                <span className="num text-brand">{s.refunds}</span>
                <span className="num text-danger">{s.forfeits}</span>
                <span className="flex items-center gap-3">
                  <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-raised">
                    {rate !== null && (
                      <>
                        <motion.span className="absolute inset-y-0 left-0 rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${rate * 100}%` }} transition={{ duration: 0.9, delay: 0.2 + i * 0.05 }} />
                        <motion.span className="absolute inset-y-0 right-0 rounded-full bg-danger/70" initial={{ width: 0 }} animate={{ width: `${(1 - rate) * 100}%` }} transition={{ duration: 0.9, delay: 0.2 + i * 0.05 }} />
                      </>
                    )}
                  </span>
                  <span className="num w-12 text-right text-xs text-muted-foreground">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</span>
                </span>
              </motion.li>
            );
          })}
        </ul>
        <div className="border-t border-line px-5 py-3 text-xs text-faint">Columns: bonds · refunded · forfeited · refund rate. Numbers update as verdicts settle on {cfg.network}.</div>
      </Panel>

      <Reveal className="mt-16">
        <Eyebrow>Set it up</Eyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Three steps. Your agent never holds more than it may spend.</h2>
      </Reveal>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Step
          n={1}
          icon={Wallet}
          title="Fund a capped budget"
          body="Send USDC to the contract for your agent's account, with a daily cap. Only you can top it up, change the cap or withdraw."
          code={`near contract call-function as-transaction ${cfg.token} ft_transfer_call \\
  json-args '{"receiver_id":"${cfg.contract}","amount":"20000000",
  "msg":"{\\"action\\":\\"fund_budget\\",\\"agent\\":\\"my-agent.${cfg.network}\\",\\"daily_cap\\":\\"5000000\\"}"}' \\
  prepaid-gas '150 Tgas' attached-deposit '1 yoctoNEAR' \\
  sign-as you.${cfg.network} network-config ${cfg.network} sign-with-keychain send`}
        />
        <Step
          n={2}
          icon={KeyRound}
          title="Give it a key that can only pay bonds"
          body="A function-call key limited to deposit_from_budget on PatchBond. It can't attach tokens or call anything else."
          code={`near account add-key my-agent.${cfg.network} \\
  grant-function-call-access --allowance '0.25 NEAR' \\
  --contract-account-id ${cfg.contract} \\
  --function-names deposit_from_budget \\
  autogenerate-new-keypair save-to-keychain \\
  network-config ${cfg.network} sign-with-keychain send`}
        />
        <Step
          n={3}
          icon={Bot}
          title="Plug in the MCP server"
          body="Seven tools: policy, a free pre-flight of your PR, deposit, status, budget, reputation, appeal. It refuses to start with a full-access key."
          code={`claude mcp add patchbond \\
  -e PATCHBOND_API=${location.origin.replace(/:\d+$/, ":8787")} \\
  -e PATCHBOND_AGENT_ACCOUNT=my-agent.${cfg.network} \\
  -e PATCHBOND_AGENT_KEY=ed25519:… \\
  -e PATCHBOND_OPERATOR=you.${cfg.network} \\
  -- bun /path/to/patchbond/mcp/src/index.ts`}
        />
      </div>
    </div>
  );
}

function Passport() {
  return (
    <Spotlight className="relative overflow-hidden border border-line bg-gradient-to-br from-panel to-raised p-6 shadow-2xl shadow-black/40">
      <div className="pointer-events-none absolute -right-10 -top-10 opacity-[0.07]">
        <Mark size={220} />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-faint">Agent passport · example</div>
        <ShieldCheck className="size-5 text-brand" />
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        {[
          ["Agent", "mikes-bot.testnet"],
          ["Operator", "mike.testnet"],
          ["Harness", "claude-code"],
          ["Model", "claude-opus-5-5"],
          ["Daily cap", "$5.00"],
          ["Key", "function-call only"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] uppercase tracking-wider text-faint">{k}</dt>
            <dd className="mt-0.5 font-mono text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex items-center justify-between border-t border-dashed border-line pt-4 font-mono text-[10px] text-faint">
        <span>FunctionCall → deposit_from_budget</span>
        <span className="text-brand">signed by the agent's key ✓</span>
      </div>
      <div className="mt-2 truncate font-mono text-[9px] tracking-[0.2em] text-faint/70">P&lt;NEAR&lt;MIKES&lt;BOT&lt;&lt;CLAUDE&lt;CODE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</div>
    </Spotlight>
  );
}

function Step({ n, icon: Icon, title, body, code }: { n: number; icon: typeof Bot; title: string; body: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Reveal delay={n * 0.08}>
      <Panel className="flex h-full flex-col p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl border border-line bg-bg text-brand">
            <Icon className="size-4" />
          </span>
          <span className="num text-xs font-semibold text-faint">STEP {n}</span>
        </div>
        <h3 className="mt-4 font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="relative mt-4 flex-1">
          <pre className="h-full overflow-x-auto rounded-xl border border-line bg-bg p-3 pr-10 font-mono text-[11px] leading-relaxed text-muted-foreground">{code}</pre>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="absolute right-2 top-2 rounded-lg border border-line bg-panel p-1.5 text-faint hover:text-ink"
            aria-label="Copy"
          >
            {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </Panel>
    </Reveal>
  );
}
