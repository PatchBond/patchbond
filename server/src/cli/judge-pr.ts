// Judge any public PR from the command line — no GitHub App, no wallet needed.
//   bun run judge-pr https://github.com/owner/repo/pull/123
// Uses JUDGE_MODE (mock | nearai) and an optional GITHUB_TOKEN for higher rate limits.
// The record is saved to the local store, so the web app's verdict page can show and verify it.

import { Octokit } from "octokit";
import { verifyRecord } from "@patchbond/shared";
import { loadConfig } from "../config";
import { gatherPr, parseGithubUrl } from "../github/gather";
import { judge } from "../judge/judge";
import { makeInference } from "../judge/inference";
import { Store } from "../store";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun run judge-pr https://github.com/<owner>/<repo>/pull/<n>");
  process.exit(1);
}

const cfg = loadConfig();
const target = parseGithubUrl(url);
if (target.kind !== "pr") throw new Error("Only pull requests for now; issues come next");

const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
const t0 = performance.now();
const input = await gatherPr(gh, target, { authorReputation: "new", threshold: 0.85 });
const inference = makeInference(cfg);
const record = await judge(input, inference);
new Store(cfg.dataDir).saveVerdict(record);

const ok = (await verifyRecord(record)).every((c) => c.ok);
console.log(
  JSON.stringify(
    {
      pr: url,
      verdict: record.final.verdict,
      model_said: record.model_verdict?.verdict ?? "(invalid)",
      confidence: record.final.confidence,
      category: record.final.category,
      reasons: record.final.reasons,
      rules_applied: record.final.rules_applied,
      facts: { ...record.facts },
      model: record.model,
      mock: record.mock,
      verifies: ok,
      verdict_page: `${cfg.webUrl}/v/${record.id}`,
      seconds: Math.round(performance.now() - t0) / 1000,
    },
    null,
    2,
  ),
);
