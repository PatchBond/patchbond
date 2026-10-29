// Rewrites the "Live" block at the top of README.md from the hosted service (/api/stats) and the
// contract's own views. Run before committing README changes:
//   bun scripts/live-stats.ts            # PATCHBOND_URL defaults to the hosted demo
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const URL = process.env.PATCHBOND_URL ?? "https://patchbond-production.up.railway.app";
const deployment = JSON.parse(readFileSync(join(ROOT, "deploy", `${process.env.NEAR_NETWORK ?? "testnet"}.json`), "utf8")) as { rpc: string; contract: string; network: string };

async function view<T>(method: string, args: object): Promise<T> {
  const res = await fetch(deployment.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: deployment.contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
  });
  const body = (await res.json()) as { result?: { result: number[] }; error?: unknown };
  if (!body.result) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 200)}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}

type Totals = { held: string; refunded: string; forfeited: string; deposits: number };
const [stats, usdc, near, signers] = await Promise.all([
  fetch(`${URL}/api/stats`).then((r) => r.json() as Promise<{ prs: number; repos: number; by_state: Record<string, number>; verdicts_live: number }>),
  view<Totals>("get_totals", {}),
  view<Totals>("get_totals", { currency: "near" }),
  view<string[]>("get_tee_signers", {}),
]);

const usd = (u: string) => `$${(Number(u) / 1e6).toFixed(2)}`;
const nr = (u: string) => `${(Number(BigInt(u) / 10n ** 20n) / 1e4).toFixed(2)} NEAR`;
const both = (a: string, b: string) => (BigInt(b) > 0n ? `${usd(a)} + ${nr(b)}` : usd(a));
const date = new Date().toISOString().slice(0, 10);

const block = `<!-- live:start -->
### Live now — [${URL.replace("https://", "")}](${URL})

| | |
|---|---|
| Bonds paid on-chain | **${usdc.deposits + near.deposits}** |
| Refunded to real contributors | **${both(usdc.refunded, near.refunded)}** |
| Forfeited to maintainers | **${both(usdc.forfeited, near.forfeited)}** |
| Unpaid PRs closed after their 24 h notice | **${stats.by_state.closed_unpaid ?? 0}** |
| TEE-signed verdicts on the hosted service | **${stats.verdicts_live}** (PRs handled there: ${stats.prs}) · the contract trusts ${signers.length} NEAR AI key${signers.length === 1 ? "" : "s"} |

<sub>${deployment.network} · contract [\`${deployment.contract}\`](https://${deployment.network === "testnet" ? "testnet." : ""}nearblocks.io/address/${deployment.contract}) · updated ${date} by [\`scripts/live-stats.ts\`](scripts/live-stats.ts) from the contract's own views and the hosted service</sub>
<!-- live:end -->`;

const readmePath = join(ROOT, "README.md");
const readme = readFileSync(readmePath, "utf8");
if (!readme.includes("<!-- live:start -->")) throw new Error("README has no <!-- live:start --> … <!-- live:end --> block");
writeFileSync(readmePath, readme.replace(/<!-- live:start -->[\s\S]*?<!-- live:end -->/, block));
console.log(block);
