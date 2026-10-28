#!/usr/bin/env bun
// PatchBond MCP server (stdio). Add to Claude Code:
//   claude mcp add patchbond -e PATCHBOND_API=http://localhost:8787 \
//     -e PATCHBOND_AGENT_ACCOUNT=my-agent.testnet -e PATCHBOND_AGENT_KEY=ed25519:… \
//     -e PATCHBOND_OPERATOR=me.testnet -- bun /path/to/patchbond/mcp/src/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PatchBond, PatchBondError } from "./client";

const env = process.env;
const pb = new PatchBond({
  api: env.PATCHBOND_API ?? "http://localhost:8787",
  agent: env.PATCHBOND_AGENT_ACCOUNT && env.PATCHBOND_AGENT_KEY ? { accountId: env.PATCHBOND_AGENT_ACCOUNT, key: env.PATCHBOND_AGENT_KEY } : undefined,
  passport: {
    operator: env.PATCHBOND_OPERATOR ?? env.PATCHBOND_AGENT_ACCOUNT ?? "unknown",
    harness: env.PATCHBOND_HARNESS ?? "claude-code",
    model: env.PATCHBOND_MODEL ?? "unknown",
  },
  githubToken: env.GITHUB_TOKEN,
  githubApi: env.PATCHBOND_GITHUB_API,
});

const server = new McpServer(
  { name: "patchbond", version: "0.1.0" },
  {
    instructions: `PatchBond: some open-source repos ask outside contributors (you included) for a small refundable USDC bond on each pull request. Real contributions get it back; slop is forfeited to the maintainers.
Workflow before opening or after opening a PR on a repo you don't maintain:
1. patchbond_policy(repo) — does the repo use PatchBond, what does it cost right now?
2. Open the PR, then patchbond_preflight(pr_url) — free; fix every warning before paying.
3. patchbond_deposit(pr_url) — pays from your capped budget. Never pay for a PR you haven't pre-flighted.
4. patchbond_status(pr_url) — verdict and next steps.
Respect maintainers' time: one focused change per PR, real tests, no invented APIs.`,
  },
);

/** Every tool answers with readable JSON, and errors say what to do next. */
function tool<A>(fn: (a: A) => Promise<unknown>) {
  return async (a: A) => {
    try {
      const out = (await fn(a)) as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out };
    } catch (e) {
      const msg = e instanceof PatchBondError ? e.message : `Unexpected error: ${(e as Error).message}`;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  };
}

const prUrl = z.string().describe("Pull request URL, e.g. https://github.com/owner/repo/pull/123");

server.registerTool(
  "patchbond_policy",
  {
    title: "Repo bond policy",
    description: "Does this repo use PatchBond, and what bond would you pay right now? The price follows the repo's open queue (EIP-1559 style) and your on-chain reputation. Call this before contributing to a repo you don't maintain.",
    inputSchema: { repo: z.string().describe('"owner/name", a repo URL, or a PR URL') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(({ repo }: { repo: string }) => pb.policy(repo)),
);

server.registerTool(
  "patchbond_preflight",
  {
    title: "Pre-flight a PR (free)",
    description: "Runs the judge's deterministic checks on your PR — CI, calls to functions that don't exist, duplicates, the linked issue, prompt-injection — and predicts the verdict. Free; no bond. Fix every warning before patchbond_deposit.",
    inputSchema: { pr_url: prUrl },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(({ pr_url }: { pr_url: string }) => pb.preflight(pr_url)),
);

server.registerTool(
  "patchbond_deposit",
  {
    title: "Pay the bond",
    description: "Pays the refundable bond for your open PR from your capped in-contract budget, signed with your function-call key, and records your agent passport (operator, harness, model). The contract enforces the daily cap. Refunded into the budget if the PR is a real contribution.",
    inputSchema: {
      pr_url: prUrl,
      fixes_issue: z.number().int().positive().optional().describe("Issue number this PR fixes, if any"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  tool(({ pr_url, fixes_issue }: { pr_url: string; fixes_issue?: number }) => pb.deposit(pr_url, fixes_issue)),
);

server.registerTool(
  "patchbond_status",
  {
    title: "Bond and verdict status",
    description: "Where your PR's bond stands (held, proposed, challenged, settled) and the judge's verdict with reasons and a link to the signed, verifiable record.",
    inputSchema: { pr_url: prUrl },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(({ pr_url }: { pr_url: string }) => pb.status(pr_url)),
);

server.registerTool(
  "patchbond_budget",
  {
    title: "Your budget",
    description: "Your agent budget: balance, daily cap, spent today, what's left today and when it resets.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(() => pb.budget()),
);

server.registerTool(
  "patchbond_reputation",
  {
    title: "Reputation",
    description: "On-chain reputation of a NEAR account (default: you): refunds, forfeits, whether it's exempt from bonds, its record as an agent, and your harness's public record.",
    inputSchema: { account: z.string().optional().describe("NEAR account id; omit for your own") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(({ account }: { account?: string }) => pb.reputation(account)),
);

server.registerTool(
  "patchbond_appeal",
  {
    title: "Appeal a verdict",
    description: "Attach a short, specific note to a verdict you believe is wrong (what the judge misread, with file and line). The maintainer sees it. A stake-backed challenge is made by your operator from the verdict page.",
    inputSchema: {
      verdict_id: z.string().describe("The id at the end of the verdict page URL (/v/<id>)"),
      note: z.string().min(10).max(2000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  tool(({ verdict_id, note }: { verdict_id: string; note: string }) => pb.appeal(verdict_id, note)),
);

server.registerPrompt(
  "contribute_responsibly",
  {
    title: "Contribute to a PatchBond repo",
    description: "A checklist for opening a PR on a repo that charges a bond",
    argsSchema: { repo: z.string().describe('"owner/name"'), change: z.string().describe("What you intend to change") },
  },
  ({ repo, change }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to contribute "${change}" to ${repo}, which may use PatchBond.
1. Call patchbond_policy for ${repo}; tell me the bond and whether I'm exempt.
2. Read CONTRIBUTING.md and the code you'll touch; reuse existing functions — never call APIs that don't exist.
3. Make one focused change with tests; run the repo's own checks locally.
4. Open the PR with an honest description (what, why, how tested). Link the issue only if it really fixes it.
5. Call patchbond_preflight on the PR and fix every warning.
6. Only then call patchbond_deposit. Afterwards, patchbond_status.`,
        },
      },
    ],
  }),
);

// Fail fast on an unsafe key, before the agent ever tries to pay.
if (pb.s.agent) {
  pb.assertSafeKey().catch((e: Error) => {
    console.error(`[patchbond] ${e.message}`);
    if (e.message.startsWith("Refusing")) process.exit(1);
  });
}

await server.connect(new StdioServerTransport());
console.error(`[patchbond] MCP server ready — API ${pb.s.api}${pb.s.agent ? `, agent ${pb.s.agent.accountId}` : ", read-only (no agent wallet)"}`);
