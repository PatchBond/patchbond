// Fixtures for the OutLayer judge's parity test (outlayer/judge/tests/parity.rs): for each PR in the
// labelled set, what GitHub returned, and what the TypeScript judge made of it — facts, the exact
// NEAR AI request bytes, and the final verdict + verdict hash for a few model answers. The Rust
// program in the enclave must reproduce every byte.
//   GITHUB_TOKEN=$(gh auth token) bun server/scripts/make-outlayer-fixtures.ts
import { Octokit } from "octokit";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verdictHash, type ModelVerdict } from "@patchbond/shared";
import { gatherPr } from "../src/github/gather";
import { calledSymbols, linkedIssue, namespaceOf } from "../src/judge/facts";
import { computeFacts } from "../src/judge/judge";
import { requestBody } from "../src/judge/prompt";
import { applyRules } from "../src/judge/rules";

const ROOT = resolve(import.meta.dir, "../..");
const MODEL = "z-ai/glm-5.3-flash";
const set = JSON.parse(readFileSync(join(ROOT, "docs/eval/candidates.json"), "utf8"));
const items: { repo: string; number: number }[] = [...set.slop_prs, ...set.good_first_prs];
const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });

/** Model answers to run through the rules on every PR (reputation varies too). */
const ANSWERS: (ModelVerdict | null)[] = [
  null,
  { verdict: "refund", confidence: 0.9, category: "ok", reasons: ["Looks fine."], evidence: [] },
  { verdict: "refund", confidence: 0.7, category: "ok", reasons: ["Probably fine."], evidence: [] },
  { verdict: "forfeit", confidence: 0.95, category: "does_not_work", reasons: ["Claims work it doesn't do."], evidence: [{ file: "README.md", line: 3, note: "no such change" }] },
  { verdict: "forfeit", confidence: 0.8, category: "boilerplate", reasons: ["Generic."], evidence: [{ file: "a", line: null, note: "x" }] },
  { verdict: "needs_human", confidence: 0.5, category: "ok", reasons: ["Unsure."], evidence: [] },
];

const out: unknown[] = [];
for (const it of items) {
  const [owner, repo] = it.repo.split("/") as [string, string];
  try {
    const input = await gatherPr(gh, { owner, repo, number: it.number }, { authorReputation: "new", threshold: 0.85 });
    const c = input.contribution;
    const issueNo = linkedIssue(`${c.title}\n${c.body}`);
    const issue = issueNo === null ? null : { number: issueNo, ...(await input.issueLookup(issueNo)) };
    // The symbol index, reduced to what this PR's lookups need.
    const called = calledSymbols(c.diff);
    let symbols: { present: string[]; namespaces: Record<string, number> } | null = null;
    if (called.length) {
      try {
        const idx = await input.symbolIndex();
        const namespaces: Record<string, number> = {};
        for (const s of called) {
          const ns = namespaceOf(s);
          if (ns) namespaces[ns] = idx.namespaceSize(ns);
        }
        symbols = { present: called.filter((s) => idx.has(s)), namespaces };
      } catch {
        symbols = null;
      }
    }
    const rulesText = [
      input.rules?.assignmentRequired ? "assignment_required: true" : "",
      input.rules?.unassignedEffect === "evidence" ? "unassigned_pr: evidence" : "",
    ].filter(Boolean).join("\n");
    const gathered = {
      full_name: input.repo.full_name,
      author: input.author,
      contribution: { number: c.number, title: c.title, body: c.body, diff: c.diff, files: c.files, additions: c.additions, deletions: c.deletions },
      check_runs: input.checkRuns,
      open_items: input.openItems.map((o) => ({ number: o.number, title: o.title })),
      contributing: input.repo.contributing ?? null,
      rules_text: rulesText || null,
      issue,
    };
    const cases = [];
    for (const reputation of ["new", "proven"] as const) {
      const facts = await computeFacts({ ...input, authorReputation: reputation, issueLookup: async () => issue ?? { exists: false, open: false } });
      const request_body = requestBody(MODEL, input.repo, facts, c);
      const signed_text = `${MODEL}:${"a".repeat(64)}:${"b".repeat(64)}`;
      const decisions = ANSWERS.map((model) => {
        const response_body = JSON.stringify({ id: "chat-x", choices: [{ index: 0, message: { role: "assistant", content: model === null ? "not json" : JSON.stringify(model) } }] });
        const final = applyRules({ model, facts, threshold: 0.85, rules: input.rules });
        return { response_body, final, verdict_hash: verdictHash({ repo: { id: input.repo.id, full_name: "" }, number: c.number, signature: { text: signed_text } as never, final }) };
      });
      cases.push({ reputation, facts, request_body, signed_text, decisions });
    }
    out.push({ url: `https://github.com/${it.repo}/pull/${it.number}`, repo_id: input.repo.id, gathered, symbols, cases });
    console.log(`✓ ${it.repo}#${it.number} (${c.diff.length} diff chars, ${called.length} calls)`);
  } catch (e) {
    console.log(`✗ ${it.repo}#${it.number}: ${String(e).slice(0, 120)}`);
  }
}
const path = join(ROOT, "outlayer/judge/tests/fixtures/parity.json");
writeFileSync(path, JSON.stringify(out));
console.log(`${out.length} fixtures → ${path}`);
