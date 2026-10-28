import { Eyebrow, Panel, Spinner } from "../components/ui";
import { chain } from "../lib/api";
import { useConfig } from "../lib/config";
import { useAsync } from "../lib/useAsync";

const HARNESSES = ["claude-code", "codex", "cursor", "copilot", "devin", "aider", "openhands", "jules", "other"];

export function Agents() {
  const cfg = useConfig();
  const { data, loading } = useAsync(
    () => Promise.all(HARNESSES.map(async (h) => ({ h, s: await chain.harness(cfg, h) }))),
    [cfg],
  );
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <Eyebrow>Know your agent</Eyebrow>
      <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight">Which coding agents waste maintainers' time? A live, verifiable record.</h1>
      <p className="mt-4 max-w-3xl leading-relaxed text-muted">
        Agents pay bonds from a budget their owner funds, with a function-call key that can do nothing else — the contract enforces the daily cap. Each payment carries a passport
        (operator, harness, model). Every refund and forfeit is counted here, per harness, straight from the contract.
      </p>
      <Panel className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="text-left text-xs text-faint">
            <tr className="border-b border-line">
              <th className="px-5 py-3 font-medium">Harness</th>
              <th className="px-5 py-3 font-medium">Bonds</th>
              <th className="px-5 py-3 font-medium">Refunded</th>
              <th className="px-5 py-3 font-medium">Forfeited</th>
              <th className="px-5 py-3 font-medium">Refund rate</th>
            </tr>
          </thead>
          <tbody className="num">
            {loading && (
              <tr>
                <td className="px-5 py-6" colSpan={5}><Spinner /></td>
              </tr>
            )}
            {data
              ?.sort((a, b) => b.s.deposits - a.s.deposits)
              .map(({ h, s }) => {
                const judged = s.refunds + s.forfeits;
                const rate = judged ? s.refunds / judged : null;
                return (
                  <tr key={h} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-mono">{h}</td>
                    <td className="px-5 py-3">{s.deposits}</td>
                    <td className="px-5 py-3 text-accent">{s.refunds}</td>
                    <td className="px-5 py-3 text-danger">{s.forfeits}</td>
                    <td className="px-5 py-3">
                      {rate === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-danger/40">
                            <div className="h-full bg-accent" style={{ width: `${rate * 100}%` }} />
                          </div>
                          {Math.round(rate * 100)}%
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Panel>
      <Panel className="mt-6 p-6">
        <Eyebrow>Give your agent a capped wallet</Eyebrow>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-bg p-4 font-mono text-xs leading-relaxed text-muted">{`# 1. Fund a budget for the agent account (daily cap 5 USDC)
near contract call-function as-transaction ${cfg.token} ft_transfer_call \\
  json-args '{"receiver_id":"${cfg.contract}","amount":"20000000",
    "msg":"{\\"action\\":\\"fund_budget\\",\\"agent\\":\\"my-agent.testnet\\",\\"daily_cap\\":\\"5000000\\"}"}' \\
  prepaid-gas '150 Tgas' attached-deposit '1 yoctoNEAR' sign-as you.testnet ...

# 2. Give the agent a key that can only pay bonds
near account add-key my-agent.testnet grant-function-call-access \\
  --allowance '0.25 NEAR' --contract-account-id ${cfg.contract} \\
  --function-names deposit_from_budget autogenerate-new-keypair ...`}</pre>
      </Panel>
    </div>
  );
}
