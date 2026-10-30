// What PatchBond would do on a real repo today: judges every open PR from a stranger (GitHub's
// FIRST_TIME_CONTRIBUTOR / FIRST_TIMER / NONE — the people who'd be asked for a bond) with the real
// verifiable model, and writes the signed records plus a summary.
//   GITHUB_TOKEN=$(gh auth token) JUDGE_MODE=nearai bun --env-file=.env server/scripts/repo-report.ts near/nearcore
import { Octokit } from "octokit";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { VerdictRecord } from "@patchbond/shared";
import { loadConfig } from "../src/config";
import { gatherPr } from "../src/github/gather";
import { makeInference } from "../src/judge/inference";
import { judge } from "../src/judge/judge";

const [owner, repo] = (process.argv[2] ?? "").split("/") as [string, string];
if (!owner || !repo) throw new Error("usage: repo-report.ts <owner/repo>");
const cfg = loadConfig();
const inference = makeInference(cfg);
if (inference.mock) throw new Error("Set JUDGE_MODE=nearai: this report uses the real verifiable model");
const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
const STRANGER = new Set(["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"]);

const open = await gh.paginate(gh.rest.pulls.list, { owner, repo, state: "open", per_page: 100 });
const strangers = open.filter((p) => STRANGER.has(p.author_association) && p.user?.type !== "Bot");
console.log(`${owner}/${repo}: ${open.length} open PRs, ${open.filter((p) => p.draft).length} drafts, ${strangers.length} from strangers`);

const rows: { pr: (typeof strangers)[number]; record?: VerdictRecord; error?: string }[] = [];
for (const pr of strangers) {
  try {
    const input = await gatherPr(gh, { owner, repo, number: pr.number }, { authorReputation: "new", threshold: 0.85 });
    const record = await judge(input, inference);
    rows.push({ pr, record });
    console.log(`#${pr.number} ${record.final.verdict.padEnd(11)} ${record.final.reasons[0]?.slice(0, 90) ?? ""}`);
  } catch (e) {
    rows.push({ pr, error: String(e).slice(0, 200) });
    console.log(`#${pr.number} error ${String(e).slice(0, 120)}`);
  }
}

const dir = resolve(import.meta.dir, "../../docs/eval", repo);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "records.json"), JSON.stringify(rows.filter((r) => r.record).map((r) => r.record), null, 1));
const days = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
writeFileSync(
  join(dir, "summary.json"),
  JSON.stringify(
    {
      repo: `${owner}/${repo}`,
      at: new Date().toISOString(),
      model: inference.model,
      open: open.length,
      drafts: open.filter((p) => p.draft).length,
      strangers: rows.map((r) => ({
        number: r.pr.number,
        author: r.pr.user?.login,
        title: r.pr.title,
        age_days: days(r.pr.created_at),
        verdict: r.record?.final.verdict ?? "error",
        model_verdict: r.record?.model_verdict?.verdict ?? null,
        reason: r.record?.final.reasons[0] ?? r.error,
        facts: r.record && {
          ci: r.record.facts.ci,
          unbacked_claims: r.record.facts.unbacked_claims.length,
          phantom_symbols: r.record.facts.phantom_symbols,
          malicious: r.record.facts.malicious?.map((m) => `${m.severity}: ${m.rule}`) ?? [],
          files: r.record.facts.files_changed,
          additions: r.record.facts.additions,
        },
        verdict_id: r.record?.id,
        signer: r.record?.signature.signing_address,
      })),
    },
    null,
    1,
  ),
);
console.log(`→ ${dir}`);
