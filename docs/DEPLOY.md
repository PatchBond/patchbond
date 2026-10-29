# Deploying PatchBond

PatchBond runs as **one service**: the API, the GitHub webhook, GitHub sign-in and the built web app
share one origin. The [`Dockerfile`](../Dockerfile) builds it; any host that runs a container and
gives it a persistent disk works (Railway, Fly.io, Render, a VPS).

```bash
docker build -t patchbond .
docker run -p 8787:8787 --env-file .env.production -v patchbond-data:/data patchbond
```

## 1. Settings

**Railway shortcut:** the `patchbond` project already has its domain, volume and non-secret settings.
Run `bash scripts/railway-secrets.sh` yourself — it copies the secrets below from your `.env` and the
near-cli keychain into Railway (printing only their names) and deploys.

Set these in the host's secret/environment settings. **Never commit them or bake them into the image.**
`https://pb.example.com` stands for your public URL.

| Variable | Value |
|---|---|
| `PUBLIC_URL`, `WEB_URL` | `https://pb.example.com` (both the same — one service) |
| `NEAR_NETWORK` | `testnet` (reads `deploy/testnet.json`) |
| `ORACLE_PRIVATE_KEY` | The oracle account's key. Copy it without printing: `jq -r .private_key ~/.near-credentials/testnet/patchbond-oracle.testnet.json \| pbcopy` |
| `JUDGE_MODE` | `nearai` |
| `NEARAI_API_KEY` | Your NEAR AI Cloud key (`sk-…`) |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Copy from your local `.env` (written by `/setup`). Keep `GITHUB_PRIVATE_KEY` on one line with `\n` escapes, as in `.env`. |
| `SESSION_SECRET` | Any long random string (`openssl rand -hex 32`); keeps maintainers signed in across deploys |
| `ALLOW_PUBLIC_JUDGE` | `1` to let visitors judge any PR (capped by the next two) |
| `JUDGE_DAILY_LIMIT`, `JUDGE_VISITOR_DAILY_LIMIT` | `100`, `10` — at ~$0.0004 a verdict that's ≤ $0.04/day. The same PR within 24 h reuses its verdict for free. Deposit-backed verdicts are never limited. |
| `GITHUB_TOKEN` | Optional: a read-only token for higher GitHub rate limits when judging public PRs |

Mount a volume at **`/data`** (verdict records, submissions, sessions). To keep existing verdict
links working, copy your local `server/data/patchbond.sqlite` onto it before the first start.

## 2. Point the GitHub App at it

GitHub → Settings → Developer settings → GitHub Apps → **patchbond** → Edit:

| Field | Value |
|---|---|
| Homepage URL | `https://pb.example.com` |
| Callback URL (sign-in) | `https://pb.example.com/api/auth/github/callback` |
| Setup URL | `https://pb.example.com/dashboard` — and tick **Redirect on update** |
| Webhook URL | `https://pb.example.com/webhook` (secret unchanged) |

## 3. Stop the local bot

Once the webhook points at the hosted service, **stop `bun run dev` on your machine** (or remove the
`GITHUB_APP_*` lines from your local `.env`). Two servers with the same App would both act on the same
PRs — double comments and double settlements.

## 4. Check it

- `https://pb.example.com/health` → `{"ok":true,"github_app":true,"judge":"z-ai/glm-5.3-flash","mock":false}`
- Open the site → ⌘K → paste a PR URL → a live, TEE-signed verdict that verifies in the browser.
- Dashboard → **Sign in with GitHub** → your repos, with their bond policy.
- Open a PR on a test repo from a second account → the bot comments within seconds with a pay link
  on your domain and the 24 h deadline.

## Host notes

- **Railway:** New project → Deploy from GitHub repo (it finds the `Dockerfile`) → add a volume at `/data`
  → add the variables → Settings → Networking → generate a domain → put it in `PUBLIC_URL`/`WEB_URL`.
- **Fly.io:** `fly launch --no-deploy` (keep the Dockerfile; internal port 8787) →
  `fly volumes create data --size 1` → add `[mounts] source="data" destination="/data"` to `fly.toml`
  → `fly secrets set KEY=value …` → `fly deploy`. Keep one machine running (`min_machines_running = 1`):
  the bot polls the chain and must not sleep.
- One instance only: the store is SQLite on the volume, and the bot must run exactly once.
