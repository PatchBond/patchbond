// Pulls real testnet transactions from the last e2e run (via the archival RPC) into public/txs.json,
// so the video shows on-chain receipts that anyone can look up by hash.
//   bun fetch-txs.ts

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC = "https://archival-rpc.testnet.fastnear.com";
const report = readFileSync(resolve(import.meta.dir, "../docs/e2e/testnet-report.md"), "utf8");
const run = report.match(/Run `(\w+)`/)?.[1];
if (!run) throw new Error("No run id in docs/e2e/testnet-report.md — run the e2e first");
const acct = (role: string) => `${role}-${run}.patchbond-e2e.testnet`;
const hashOf = (label: string) => report.match(new RegExp(`${label}\\]\\(https://testnet\\.nearblocks\\.io/txns/(\\w+)\\)`))?.[1];

const wanted = [
  { id: "gasless", title: "A gasless bond", label: "relayer submits the signed delegate", signer: acct("oracle") },
  { id: "forfeit", title: "Slop forfeited 90 / 10", label: "oracle settles 1000001#2: forfeit", signer: acct("oracle") },
  { id: "agent", title: "An agent pays through MCP", label: "agent pays via the MCP server", signer: acct("agent") },
];

const out = [];
for (const w of wanted) {
  const hash = hashOf(w.label);
  if (!hash) throw new Error(`No tx for "${w.label}"`);
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: w.signer, wait_until: "NONE" } }),
  });
  const { result: r } = (await res.json()) as { result: any };
  const events = r.receipts_outcome
    .flatMap((x: any) => x.outcome.logs as string[])
    .filter((l: string) => l.startsWith("EVENT_JSON:"))
    .map((l: string) => JSON.parse(l.slice("EVENT_JSON:".length)))
    .map((e: any) => ({ standard: e.standard, event: e.event, data: e.data[0] }));
  const gasBurnt = [r.transaction_outcome, ...r.receipts_outcome].reduce((s: bigint, o: any) => s + BigInt(o.outcome.tokens_burnt), 0n);
  out.push({
    id: w.id,
    title: w.title,
    hash,
    signer: r.transaction.signer_id,
    receiver: r.transaction.receiver_id,
    action: Object.keys(r.transaction.actions[0])[0],
    ok: "SuccessValue" in r.status,
    feeNear: Number(gasBurnt) / 1e24,
    events,
  });
  console.log(`✓ ${w.id} ${hash} — ${events.map((e: any) => e.event).join(", ")}`);
}
writeFileSync(resolve(import.meta.dir, "public/txs.json"), JSON.stringify({ run, txs: out }, null, 2));
