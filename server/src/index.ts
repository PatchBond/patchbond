// PatchBond server: GitHub webhooks, the deposit/CI watcher, and the public verdict API.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { Octokit } from "octokit";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { Chain } from "./near";
import { Store } from "./store";
import { Bot } from "./github/bot";
import { gatherPr, parseGithubUrl } from "./github/gather";
import { computeFacts, judge } from "./judge/judge";
import { preflight } from "./judge/preflight";
import { makeInference } from "./judge/inference";
import { MockInference } from "./judge/nearai";

const cfg = loadConfig();
const chain = new Chain(cfg);
const store = new Store(cfg.dataDir);
const inference = makeInference(cfg);
const bot = cfg.github.configured ? new Bot(cfg, chain, store, inference) : null;

const app = new Hono();
app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true, github_app: Boolean(bot), judge: inference.model, mock: inference.mock }));

app.get("/api/config", (c) =>
  c.json({
    network: cfg.deployment.network,
    rpc: cfg.deployment.rpc,
    contract: cfg.deployment.contract,
    token: cfg.deployment.token,
    oracle: cfg.deployment.oracle,
    judge: { model: inference.model, mock: inference.mock, ...(inference instanceof MockInference ? { mock_signing_address: inference.signingAddress } : {}) },
  }),
);

app.get("/api/verdicts", (c) => {
  const repo = c.req.query("repo");
  const list = store.recentVerdicts(Math.min(Number(c.req.query("limit") ?? 50), 200), repo ? Number(repo) : undefined);
  // The list omits the raw bytes; the single-verdict endpoint has everything.
  return c.json(list.map(({ request_body: _q, response_body: _r, ...rest }) => rest));
});

app.get("/api/verdicts/:id", (c) => {
  const r = store.verdict(c.req.param("id"));
  return r ? c.json(r) : c.json({ error: "No verdict with this id. Check the link, or the verdict may be on another PatchBond server." }, 404);
});

app.get("/api/submissions/:repo/:number", async (c) => {
  const repo = Number(c.req.param("repo"));
  const number = Number(c.req.param("number"));
  const [deposit, repoOnChain] = await Promise.all([chain.getDeposit(repo, number), chain.getRepo(repo)]);
  return c.json({
    submission: store.submission(repo, number),
    deposit,
    repo: repoOnChain,
    verdicts: store.recentVerdicts(10, repo).filter((v) => v.number === number),
  });
});

// Try the judge on any public PR from the web app (hosted demo). Off unless ALLOW_PUBLIC_JUDGE=1.
let lastPublicJudge = 0;
app.post("/api/judge", async (c) => {
  if (process.env.ALLOW_PUBLIC_JUDGE !== "1") return c.json({ error: "Public judging is turned off on this server." }, 403);
  if (Date.now() - lastPublicJudge < 15_000) return c.json({ error: "The judge is busy; try again in 15 seconds." }, 429);
  lastPublicJudge = Date.now();
  const { url } = await c.req.json<{ url: string }>();
  try {
    const t = parseGithubUrl(url);
    if (t.kind !== "pr") return c.json({ error: "Paste a pull request URL (…/pull/123)." }, 400);
    const input = await gatherPr(new Octokit({ auth: process.env.GITHUB_TOKEN }), t, { authorReputation: "new", threshold: 0.85 });
    const record = await judge(input, inference);
    store.saveVerdict(record);
    return c.json({ id: record.id, verdict: record.final.verdict });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Pre-flight: the judge's facts as advice before paying. Free — no model call.
const preflightAt = new Map<string, number>();
app.post("/api/preflight", async (c) => {
  const { url } = await c.req.json<{ url: string }>().catch(() => ({ url: "" }));
  const ip = c.req.header("x-forwarded-for") ?? "local";
  if (Date.now() - (preflightAt.get(ip) ?? 0) < 5_000) return c.json({ error: "One pre-flight every 5 seconds, please." }, 429);
  preflightAt.set(ip, Date.now());
  try {
    const t = parseGithubUrl(url);
    if (t.kind !== "pr") return c.json({ error: "Pre-flight needs a pull request URL (…/pull/123)." }, 400);
    const input = await gatherPr(new Octokit({ auth: process.env.GITHUB_TOKEN }), t, { authorReputation: "new", threshold: 0.85 });
    return c.json({ repo_id: input.repo.id, author: input.author, ...preflight(await computeFacts(input)) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Appeals: a note from either side, shown next to the verdict. Staking a challenge is on-chain.
app.post("/api/appeals", async (c) => {
  const body = await c.req.json<{ verdict_id?: string; note?: string; from?: string }>().catch(() => ({}) as Record<string, string>);
  const note = (body.note ?? "").trim();
  if (!body.verdict_id || !store.verdict(body.verdict_id)) return c.json({ error: "Unknown verdict_id." }, 404);
  if (note.length < 10 || note.length > 2000) return c.json({ error: "The note must be 10–2000 characters: say what the judge got wrong." }, 400);
  store.addAppeal(body.verdict_id, (body.from ?? "anonymous").slice(0, 64), note);
  return c.json({ ok: true });
});
app.get("/api/appeals/:verdict", (c) => c.json(store.appeals(c.req.param("verdict"))));

app.post("/webhook", async (c) => {
  if (!bot) return c.json({ error: "GitHub App not configured on this server (see /setup)" }, 503);
  const body = await c.req.text();
  try {
    await bot.app.webhooks.verifyAndReceive({
      id: c.req.header("x-github-delivery") ?? "",
      name: c.req.header("x-github-event") as never,
      payload: body,
      signature: c.req.header("x-hub-signature-256") ?? "",
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ---- One-click GitHub App creation (GitHub's manifest flow) ----
const ORG = process.env.GITHUB_ORG ?? "PatchBond";

app.get("/setup", (c) => {
  if (bot) return c.html(`<p>The GitHub App is already configured. Install it on a repo from the App's page.</p>`);
  const manifest = {
    name: process.env.GITHUB_APP_NAME ?? "PatchBond",
    url: cfg.webUrl,
    // Behind a tunnel (smee.io) GitHub posts to the tunnel; otherwise straight to this server.
    hook_attributes: { url: process.env.WEBHOOK_URL ?? `${cfg.publicUrl}/webhook`, active: true },
    redirect_url: `${cfg.publicUrl}/setup/callback`,
    public: true,
    default_permissions: {
      pull_requests: "write", issues: "write", checks: "write", actions: "write", contents: "read", metadata: "read",
    },
    default_events: ["pull_request", "pull_request_review", "issues", "check_suite", "check_run"],
  };
  return c.html(`<!doctype html><meta charset="utf-8"><title>Create the PatchBond GitHub App</title>
<body style="font:16px system-ui;background:#0E1013;color:#ECEAE4;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" action="https://github.com/organizations/${ORG}/settings/apps/new" style="max-width:480px;padding:24px">
<h1 style="font-size:22px">Create the PatchBond GitHub App</h1>
<p>GitHub creates the App in the <b>${ORG}</b> org with the permissions PatchBond needs, then sends you back here and the server saves its credentials to <code>.env</code>.</p>
<p>Webhooks will go to <code>${process.env.WEBHOOK_URL ?? `${cfg.publicUrl}/webhook`}</code>.</p>
<input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, "&#39;")}'>
<button style="background:#22C55E;color:#0E1013;border:0;border-radius:10px;padding:12px 18px;font-weight:600;font-size:16px;cursor:pointer">Create on GitHub →</button>
</form></body>`);
});

app.get("/setup/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("Missing ?code from GitHub. Start again at /setup.", 400);
  const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) return c.text(`GitHub refused the conversion (HTTP ${res.status}). The code is single-use and expires in an hour — start again at /setup.`, 400);
  const app = (await res.json()) as { id: number; slug: string; pem: string; webhook_secret: string; html_url: string };
  appendFileSync(
    join(cfg.root, ".env"),
    `\n# GitHub App ${app.slug} (created ${new Date().toISOString()})\nGITHUB_APP_ID=${app.id}\nGITHUB_WEBHOOK_SECRET=${app.webhook_secret}\nGITHUB_PRIVATE_KEY="${app.pem.replace(/\n/g, "\\n")}"\n`,
  );
  return c.html(`<body style="font:16px system-ui;background:#0E1013;color:#ECEAE4;padding:40px">
<h1>✅ ${app.slug} created</h1><p>Credentials saved to <code>.env</code>. Restart the server, then
<a style="color:#22C55E" href="${app.html_url}/installations/new">install the App on a repo →</a></p></body>`);
});

if (bot) {
  setInterval(() => void bot.tick(), cfg.pollMs);
}

console.log(
  `PatchBond server on :${cfg.port} — ${cfg.deployment.network} contract ${cfg.deployment.contract}, judge ${inference.model}${inference.mock ? " (MOCK)" : ""}, GitHub App ${bot ? "on" : "off (open /setup)"}`,
);

export default { port: cfg.port, fetch: app.fetch };
