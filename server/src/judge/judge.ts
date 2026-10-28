// One verdict, end to end: facts → exact request bytes → signed inference → schema check →
// server rules → a VerdictRecord anyone can re-verify.

import { ModelVerdict, verdictHash, type Facts, type VerdictRecord } from "@patchbond/shared";
import {
  ciFact,
  duplicateOf,
  injectionMarkers,
  linkedIssue,
  symbolFacts,
  type CheckRun,
  type Contribution,
  type OpenItem,
  type SymbolIndex,
} from "./facts";
import { modelContent, type Inference } from "./nearai";
import { requestBody, type RepoContext } from "./prompt";
import { applyRules } from "./rules";

/** Everything the GitHub layer gathers for one contribution. */
export interface JudgeInput {
  repo: RepoContext & { id: number };
  author: string;
  contribution: Contribution;
  checkRuns: CheckRun[];
  openItems: OpenItem[];
  /** Identifiers in the repo at the base commit. */
  symbolIndex: () => Promise<SymbolIndex>;
  /** Looks up the issue the PR claims to fix. */
  issueLookup: (n: number) => Promise<{ exists: boolean; open: boolean; title?: string }>;
  authorReputation: Facts["author_reputation"];
  /** Repo policy forfeit_threshold_bps / 10_000. */
  threshold: number;
}

export async function computeFacts(i: JudgeInput): Promise<Facts> {
  const c = i.contribution;
  const issueNo = linkedIssue(`${c.title}\n${c.body}`);
  return {
    ...ciFact(i.checkRuns),
    ...(c.kind === "pr" ? await symbolFacts(c.diff, i.symbolIndex) : { phantom_symbols: [], unresolved_symbols: [] }),
    duplicate_of: duplicateOf(c, i.openItems),
    issue: issueNo === null ? null : { number: issueNo, ...(await i.issueLookup(issueNo).catch(() => ({ exists: false, open: false }))) },
    files_changed: c.files.length,
    additions: c.additions,
    deletions: c.deletions,
    injection_markers: injectionMarkers(c),
    author_reputation: i.authorReputation,
  };
}

export async function judge(i: JudgeInput, inference: Inference, now = new Date()): Promise<VerdictRecord> {
  const facts = await computeFacts(i);
  const request_body = requestBody(inference.model, i.repo, facts, i.contribution);
  const { chat_id, response_body, signature } = await inference.run(request_body);

  const parsed = ModelVerdict.safeParse(modelContent(response_body));
  const model_verdict = parsed.success ? parsed.data : null;
  const final = applyRules({ model: model_verdict, facts, threshold: i.threshold });

  const base = {
    repo: { id: i.repo.id, full_name: i.repo.full_name },
    number: i.contribution.number,
    signature,
    final,
  };
  const verdict_hash = verdictHash(base);
  return {
    id: verdict_hash.slice(0, 16),
    ...base,
    kind: i.contribution.kind,
    author: i.author,
    created_at: now.toISOString(),
    model: inference.model,
    chat_id,
    request_body,
    response_body,
    facts,
    model_verdict,
    verdict_hash,
    mock: inference.mock,
  };
}
