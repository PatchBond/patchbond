// Operator tool for the playground and demos: judge a PR's content and settle a deposit on-chain.
//   bun run settle <repo_id> <number> <pr_url>          judge <pr_url> as submission <repo_id>#<number>
//   bun run settle <repo_id> <number> refund|forfeit    settle by hand (e.g. a maintainer decision)
// Signs as the oracle account from deploy/<network>.json.

import { Octokit } from "octokit";
import { sha256Hex } from "@patchbond/shared";
import { loadConfig } from "../config";
import { gatherPr, parseGithubUrl } from "../github/gather";
import { makeInference } from "../judge/inference";
import { judge } from "../judge/judge";
import { Chain } from "../near";
import { Store } from "../store";

const [repoArg, numArg, what] = process.argv.slice(2);
if (!repoArg || !numArg || !what) {
  console.error("Usage: bun run settle <repo_id> <number> <pr_url | refund | forfeit>");
  process.exit(1);
}
const repoId = Number(repoArg);
const number = Number(numArg);
const cfg = loadConfig();
const chain = new Chain(cfg);

const deposit = await chain.getDeposit(repoId, number);
if (!deposit) {
  console.error(`No deposit for ${repoId}#${number} on ${cfg.deployment.network}. Pay it first: ${cfg.webUrl}/pay/${repoId}/${number}`);
  process.exit(1);
}
if (deposit.status !== "held") {
  console.error(`${repoId}#${number} already has a verdict: ${JSON.stringify(deposit.status)}`);
  process.exit(1);
}

if (what === "refund" || what === "forfeit") {
  const hash = sha256Hex(`manual:${repoId}:${number}:${what}`);
  await chain.settle(repoId, number, what, hash);
  console.log(`settled ${repoId}#${number}: ${what}`);
  process.exit(0);
}

const input = await gatherPr(new Octokit({ auth: process.env.GITHUB_TOKEN }), { ...parseGithubUrl(what) }, { authorReputation: "new", threshold: 0.85 });
// Judge the PR's real content as this submission, so the record and the chain agree.
input.repo = { ...input.repo, id: repoId, full_name: repoId === 1 ? "PatchBond/playground" : input.repo.full_name };
input.contribution = { ...input.contribution, number };
input.author = deposit.github_user;
const record = await judge(input, makeInference(cfg));
new Store(cfg.dataDir).saveVerdict(record);

if (record.final.verdict === "needs_human") {
  console.log(`needs_human — not settled. A maintainer decides. Verdict: ${cfg.webUrl}/v/${record.id}`);
} else {
  await chain.settle(repoId, number, record.final.verdict, record.verdict_hash);
  console.log(`${record.final.verdict} proposed on-chain for ${repoId}#${number}. Verdict: ${cfg.webUrl}/v/${record.id}`);
}
