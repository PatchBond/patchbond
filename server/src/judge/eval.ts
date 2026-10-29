// Runs the judge over the labelled set in docs/eval/candidates.json and reports what matters:
// good PRs forfeited (must be 0), forfeit precision, slop caught, needs_human rate, cost and time.
// Every record is saved to the local store, so any verdict can be opened (and verified) at /v/<id>
// without paying for it twice.
//   bun run eval            (JUDGE_MODE=mock measures the deterministic facts layer)
//   JUDGE_MODE=nearai bun run eval   (the real verifiable model; needs NEAR AI credits)

import { Octokit } from "octokit";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { gatherPr } from "../github/gather";
import { makeInference } from "./inference";
import { judge } from "./judge";
import { Store } from "../store";

interface Item { repo: string; number: number; url: string; label: "slop" | "good"; title: string }

const cfg = loadConfig();
const set = JSON.parse(readFileSync(join(cfg.root, "docs/eval/candidates.json"), "utf8"));
const items: Item[] = [...set.slop_prs, ...set.good_first_prs];
const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
const inference = makeInference(cfg);
const store = new Store(cfg.dataDir);
/** USD per token, from NEAR AI's public price list (GET /v1/model/list). */
const PRICE: Record<string, [number, number]> = { "z-ai/glm-5.3-flash": [80e-9, 500e-9], "moonshotai/kimi-k3": [3300e-9, 16500e-9] };

const rows: Array<Item & { verdict: string; model: string; phantom: string[]; ci: string; ms: number; usd: number; id?: string; error?: string }> = [];
const queue = [...items];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      const t0 = performance.now();
      try {
        const [owner, repo] = it.repo.split("/") as [string, string];
        const input = await gatherPr(gh, { owner, repo, number: it.number }, { authorReputation: "new", threshold: 0.85 });
        const r = await judge(input, inference);
        store.saveVerdict(r);
        const usage = (JSON.parse(r.response_body) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage ?? {};
        const [pin, pout] = PRICE[r.model] ?? [0, 0];
        const usd = (usage.prompt_tokens ?? 0) * pin + (usage.completion_tokens ?? 0) * pout;
        rows.push({ ...it, verdict: r.final.verdict, model: r.model_verdict?.verdict ?? "invalid", phantom: r.facts.phantom_symbols, ci: r.facts.ci, ms: performance.now() - t0, usd, id: r.id });
      } catch (e) {
        rows.push({ ...it, verdict: "error", model: "-", phantom: [], ci: "-", ms: performance.now() - t0, usd: 0, error: (e as Error).message.slice(0, 120) });
      }
      process.stderr.write(".");
    }
  }),
);

const ok = rows.filter((r) => r.verdict !== "error");
const forfeits = ok.filter((r) => r.verdict === "forfeit");
const goodForfeited = forfeits.filter((r) => r.label === "good");
const slop = ok.filter((r) => r.label === "slop");
const summary = {
  model: inference.model,
  mock: inference.mock,
  judged: ok.length,
  errors: rows.length - ok.length,
  good_prs_forfeited: goodForfeited.length,
  forfeit_precision: forfeits.length ? +(1 - goodForfeited.length / forfeits.length).toFixed(3) : null,
  slop_caught: `${slop.filter((r) => r.verdict === "forfeit").length}/${slop.length}`,
  needs_human_rate: +(ok.filter((r) => r.verdict === "needs_human").length / Math.max(ok.length, 1)).toFixed(3),
  invalid_model_answers: ok.filter((r) => r.model === "invalid").length,
  avg_seconds: +(ok.reduce((a, r) => a + r.ms, 0) / Math.max(ok.length, 1) / 1000).toFixed(1),
  total_usd: +rows.reduce((a, r) => a + r.usd, 0).toFixed(4),
  usd_per_verdict: +(rows.reduce((a, r) => a + r.usd, 0) / Math.max(ok.length, 1)).toFixed(5),
};
console.log("\n" + JSON.stringify(summary, null, 2));
console.table(rows.map((r) => ({ label: r.label, verdict: r.verdict, model: r.model, ci: r.ci, phantom: r.phantom.join(" ").slice(0, 50), pr: `${r.repo}#${r.number}`, error: r.error ?? "" })));
const out = join(cfg.root, "docs/eval", `results-${inference.mock ? "mock" : inference.model.replace(/\W+/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
console.log(`saved ${out}`);
