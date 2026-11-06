// Picks a held-out PR set for the judge, by rules fixed before any of these PRs was judged:
//   slop: closed unmerged, labelled "ai slop", "ai-slop" or "llm slop" by a person (not a bot), newest
//         first, at most 2 per repo, none already in candidates.json, none from a bot.
//   good: from the same repos, the same number per repo where possible: merged, from outside the
//         repo's team, the author's only merged PR there.
// PRs we can't fetch are listed under `skipped`. Output: docs/eval/heldout.json.
//   GITHUB_TOKEN=$(gh auth token) bun server/scripts/collect-heldout.ts
// A later set: HELDOUT_OUT=heldout-2. PRs in candidates.json or any earlier heldout*.json are never picked.

import { Octokit } from "octokit";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const WANT = Number(process.env.HELDOUT_SIZE ?? 50);
const PER_REPO = 2;
const LABELS = ["ai slop", "ai-slop", "llm slop"];
const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OUT = process.env.HELDOUT_OUT ?? "heldout";
const used = readdirSync(join(ROOT, "docs/eval")).filter((f) => f === "candidates.json" || (/^heldout.*\.json$/.test(f) && f !== `${OUT}.json`));
const seen = new Set<string>();
for (const f of used) {
  const old = JSON.parse(readFileSync(join(ROOT, "docs/eval", f), "utf8"));
  for (const p of [...old.slop_prs, ...old.good_first_prs] as { repo: string; number: number }[]) seen.add(`${p.repo}#${p.number}`);
}
const isBot = (u?: { type?: string; login?: string } | null) => u?.type === "Bot" || /\[bot\]$|-bot$/i.test(u?.login ?? "");
const repoOf = (url: string) => url.replace("https://api.github.com/repos/", "");

async function search(q: string, pages = 3) {
  const items = [];
  for (let page = 1; page <= pages; page++) {
    const { data } = await gh.rest.search.issuesAndPullRequests({ q, sort: "created", order: "desc", per_page: 100, page });
    items.push(...data.items);
    await pause(2200);
    if (data.items.length < 100) break;
  }
  return items;
}

const pool = new Map<string, Awaited<ReturnType<typeof search>>[number]>();
for (const label of LABELS) {
  for (const it of await search(`is:pr is:closed is:unmerged label:"${label}"`)) pool.set(it.html_url, it);
}
const newest = [...pool.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

const slop: object[] = [];
const skipped: object[] = [];
const perRepo = new Map<string, number>();
for (const it of newest) {
  if (slop.length >= WANT) break;
  const repo = repoOf(it.repository_url);
  const id = `${repo}#${it.number}`;
  if (seen.has(id) || (perRepo.get(repo) ?? 0) >= PER_REPO || isBot(it.user)) continue;
  const [owner, name] = repo.split("/") as [string, string];
  try {
    const events = await gh.paginate(gh.rest.issues.listEvents, { owner, repo: name, issue_number: it.number, per_page: 100 });
    const labelled = events.find((e) => e.event === "labeled" && LABELS.includes((e as { label?: { name?: string } }).label?.name?.toLowerCase() ?? ""));
    if (!labelled?.actor || isBot(labelled.actor) || labelled.actor.login === it.user?.login) {
      skipped.push({ id, why: "label applied by a bot, the author, or not found" });
      continue;
    }
    const { data: pr } = await gh.rest.pulls.get({ owner, repo: name, pull_number: it.number });
    const comments = await gh.rest.issues.listComments({ owner, repo: name, issue_number: it.number, per_page: 100 });
    const said = comments.data.filter((c) => c.user?.login === labelled.actor!.login).at(-1)?.body?.slice(0, 300) ?? "";
    slop.push({
      repo, number: it.number, url: it.html_url, author: it.user?.login, title: it.title, additions: pr.additions, deletions: pr.deletions,
      changed_files: pr.changed_files, created_at: it.created_at, label: "slop", source: `label '${(labelled as { label?: { name?: string } }).label?.name}' by ${labelled.actor.login}`, closing_comment: said,
    });
    perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
  } catch (e) {
    skipped.push({ id, why: (e as Error).message.slice(0, 100) });
  }
  process.stderr.write(".");
}

const good: object[] = [];
for (const [repo, n] of perRepo) {
  const found: Awaited<ReturnType<typeof search>> = [];
  for (const it of await search(`repo:${repo} is:pr is:merged`, 1)) {
    if (found.length >= n) break;
    const id = `${repo}#${it.number}`;
    if (seen.has(id) || isBot(it.user) || ["OWNER", "MEMBER", "COLLABORATOR"].includes(it.author_association)) continue;
    const { data } = await gh.rest.search.issuesAndPullRequests({ q: `repo:${repo} is:pr is:merged author:${it.user?.login}`, per_page: 1 });
    await pause(2200);
    if (data.total_count !== 1) continue;
    const [owner, name] = repo.split("/") as [string, string];
    const { data: pr } = await gh.rest.pulls.get({ owner, repo: name, pull_number: it.number });
    found.push(it);
    good.push({
      repo, number: it.number, url: it.html_url, author: it.user?.login, title: it.title, additions: pr.additions, deletions: pr.deletions,
      changed_files: pr.changed_files, created_at: it.created_at, label: "good", source: "merged; outside the team; author's only merged PR in repo",
    });
  }
  process.stderr.write("+");
}

writeFileSync(
  join(ROOT, "docs/eval", `${OUT}.json`),
  JSON.stringify({ about: "Held-out PRs, selected by server/scripts/collect-heldout.ts before any was judged. Labels are the maintainers' own actions. None appears in candidates.json or an earlier held-out set.", collected: new Date().toISOString().slice(0, 10), slop_prs: slop, good_first_prs: good, skipped }, null, 2),
);
console.log(`\n${slop.length} slop, ${good.length} good, ${skipped.length} skipped, ${perRepo.size} repos`);
