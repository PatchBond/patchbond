// Gathers everything the judge needs about one PR or issue from GitHub.

import type { Octokit } from "octokit";
import type { Facts } from "@patchbond/shared";
import type { JudgeInput } from "../judge/judge";
import { parseRepoRules } from "../judge/facts";
import { symbolIndex } from "./symbols";

export interface Target {
  owner: string;
  repo: string;
  number: number;
}

export function parseGithubUrl(url: string): Target & { kind: "pr" | "issue" } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
  if (!m) throw new Error(`Not a GitHub PR or issue URL: ${url} (expected https://github.com/<owner>/<repo>/pull/<n>)`);
  return { owner: m[1]!, repo: m[2]!, number: Number(m[4]), kind: m[3] === "pull" ? "pr" : "issue" };
}

export async function gatherPr(
  gh: Octokit,
  t: Target,
  opts: { authorReputation: Facts["author_reputation"]; threshold: number; policyNote?: string },
): Promise<JudgeInput> {
  const { owner, repo, number } = t;
  const [{ data: pr }, { data: repoData }] = await Promise.all([
    gh.rest.pulls.get({ owner, repo, pull_number: number }),
    gh.rest.repos.get({ owner, repo }),
  ]);
  const [diff, files, checks, openPrs, contributing, rulesFile] = await Promise.all([
    gh.rest.pulls
      .get({ owner, repo, pull_number: number, mediaType: { format: "diff" } })
      .then((r) => r.data as unknown as string),
    gh.paginate(gh.rest.pulls.listFiles, { owner, repo, pull_number: number, per_page: 100 }, (r) => r.data.map((f) => f.filename)),
    gh.rest.checks
      .listForRef({ owner, repo, ref: pr.head.sha, per_page: 100 })
      .then((r) => r.data.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })))
      .catch(() => []),
    gh.rest.pulls.list({ owner, repo, state: "open", per_page: 50 }).then((r) => r.data.map((p) => ({ number: p.number, title: p.title }))),
    readFile(gh, owner, repo, "CONTRIBUTING.md", pr.base.sha),
    readFile(gh, owner, repo, "patchbond.yml", pr.base.sha, [".github/", ""]),
  ]);

  return {
    repo: { id: repoData.id, full_name: repoData.full_name, contributing, policy_note: opts.policyNote },
    author: pr.user?.login ?? "ghost",
    contribution: {
      kind: "pr",
      number,
      title: pr.title,
      body: pr.body ?? "",
      diff,
      files,
      additions: pr.additions,
      deletions: pr.deletions,
    },
    checkRuns: checks,
    openItems: openPrs,
    symbolIndex: () =>
      symbolIndex(`${repoData.full_name}@${pr.base.sha}`, async () => {
        const r = await gh.rest.repos.downloadTarballArchive({ owner, repo, ref: pr.base.sha });
        return new Uint8Array(r.data as ArrayBuffer);
      }),
    issueLookup: async (n) => {
      try {
        const { data } = await gh.rest.issues.get({ owner, repo, issue_number: n });
        return { exists: true, open: data.state === "open", title: data.title, assignees: (data.assignees ?? []).map((a) => a.login) };
      } catch {
        return { exists: false, open: false };
      }
    },
    authorReputation: opts.authorReputation,
    threshold: opts.threshold,
    rules: parseRepoRules(rulesFile),
  };
}

async function readFile(gh: Octokit, owner: string, repo: string, path: string, ref: string, dirs = ["", ".github/", "docs/"]): Promise<string | undefined> {
  for (const p of dirs.map((d) => `${d}${path}`)) {
    try {
      const { data } = await gh.rest.repos.getContent({ owner, repo, path: p, ref });
      if ("content" in data) return Buffer.from(data.content, "base64").toString("utf8");
    } catch {
      // try the next location
    }
  }
  return undefined;
}
