// One command for local development: API server, web app, and (if WEBHOOK_URL is set in .env) the
// smee.io tunnel that forwards GitHub webhooks to the API.
//   bun run dev

import { watch } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const env = { ...process.env } as Record<string, string>;

// Optional: a GitHub token raises API rate limits for judging (uses the gh CLI if logged in; never printed).
if (!env.GITHUB_TOKEN) {
  const gh = Bun.spawnSync(["gh", "auth", "token"], { stderr: "ignore" });
  if (gh.exitCode === 0) env.GITHUB_TOKEN = gh.stdout.toString().trim();
}

const webhook = Bun.spawnSync(["bash", "-c", `grep -E '^WEBHOOK_URL=' ${join(ROOT, ".env")} | cut -d= -f2-`]).stdout.toString().trim();

const procs: { name: string; color: string; cmd: string[]; cwd: string }[] = [
  { name: "api", color: "\x1b[32m", cmd: ["bun", "--env-file=../.env", "--watch", "src/index.ts"], cwd: join(ROOT, "server") },
  { name: "web", color: "\x1b[36m", cmd: ["bunx", "vite", "--strictPort"], cwd: join(ROOT, "web") },
  ...(webhook ? [{ name: "tunnel", color: "\x1b[35m", cmd: ["bunx", "smee-client", "--url", webhook, "--target", "http://localhost:8787/webhook"], cwd: ROOT }] : []),
];

function start(p: (typeof procs)[number]) {
  const child = Bun.spawn(p.cmd, { cwd: p.cwd, env, stdout: "pipe", stderr: "pipe" });
  for (const stream of [child.stdout, child.stderr]) {
    void (async () => {
      const dec = new TextDecoder();
      for await (const chunk of stream) {
        for (const line of dec.decode(chunk).split("\n")) if (line.trim()) console.log(`${p.color}${p.name.padEnd(6)}\x1b[0m ${line}`);
      }
    })();
  }
  return child;
}
const children = procs.map(start);

// /setup writes the new GitHub App's credentials to .env — restart the API so it picks them up.
let restartTimer: ReturnType<typeof setTimeout> | undefined;
watch(join(ROOT, ".env"), () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log("\x1b[33mdev\x1b[0m    .env changed — restarting the API");
    children[0]!.kill();
    children[0] = start(procs[0]!);
  }, 500);
});

console.log(`\n  PatchBond dev\n  web     http://localhost:5317\n  api     http://localhost:8787\n  setup   http://localhost:8787/setup${webhook ? `\n  tunnel  ${webhook} → /webhook` : ""}\n`);

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.all(children.map((c) => c.exited));
