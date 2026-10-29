// All network-specific values come from deploy/<NETWORK>.json + env, so the same code runs on
// testnet (reproduce-it-yourself path) and mainnet (live demo).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Deployment {
  network: "testnet" | "mainnet";
  rpc: string;
  contract: string;
  oracle: string;
  token: string;
  token_decimals: number;
  /** wNEAR, for repos that take NEAR bonds. */
  wnear?: string;
}

const ROOT = resolve(import.meta.dir, "../..");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in (see README → "Run the server").`);
  return v;
}

export function loadConfig() {
  const network = (process.env.NEAR_NETWORK || "testnet") as Deployment["network"];
  const deployFile = join(ROOT, "deploy", `${network}.json`);
  if (!existsSync(deployFile)) throw new Error(`No deployment for ${network}: ${deployFile} is missing`);
  const deployment = JSON.parse(readFileSync(deployFile, "utf8")) as Deployment;

  // "offline" (formerly "mock"): the same pipeline without an API key.
  const judgeMode: "mock" | "nearai" = process.env.JUDGE_MODE === "nearai" ? "nearai" : "mock";
  return {
    root: ROOT,
    port: Number(process.env.PORT || 8787),
    publicUrl: process.env.PUBLIC_URL || "http://localhost:8787",
    webUrl: process.env.WEB_URL || "http://localhost:5317",
    dataDir: process.env.DATA_DIR || join(ROOT, "server", "data"),
    deployment,
    oracleKey: () => process.env.ORACLE_PRIVATE_KEY || legacyKey(network, deployment.oracle),
    /** Pays gas for gasless (NEP-366) bond payments; defaults to the oracle account. */
    relayer: {
      account: process.env.RELAYER_ACCOUNT || deployment.oracle,
      key: () => process.env.RELAYER_PRIVATE_KEY || process.env.ORACLE_PRIVATE_KEY || legacyKey(network, process.env.RELAYER_ACCOUNT || deployment.oracle),
    },
    judge: {
      mode: judgeMode,
      model: process.env.JUDGE_MODEL || "z-ai/glm-5.3-flash",
      /** Re-judges challenged verdicts. */
      strongModel: process.env.JUDGE_STRONG_MODEL || "moonshotai/kimi-k3",
      apiKey: () => need("NEARAI_API_KEY"),
      /** Optional fixed key so mock signatures keep one signing address across restarts. */
      mockKey: process.env.MOCK_SIGNER_KEY || undefined,
    },
    github: {
      appId: () => need("GITHUB_APP_ID"),
      privateKey: () => need("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n"),
      webhookSecret: () => need("GITHUB_WEBHOOK_SECRET"),
      configured: Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY),
      /** GitHub API base (tests point this at a fake GitHub; Enterprise works too). */
      apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
      /** GitHub web host for OAuth (tests point this at a fake GitHub). */
      webUrl: process.env.GITHUB_WEB_URL || "https://github.com",
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      /** Octokit spaces writes ≥1 s apart (GitHub's secondary rate limits). Off only in tests. */
      throttle: process.env.GITHUB_THROTTLE !== "off",
    },
    /** Signs session cookies. Generated per boot if unset (sessions then end on restart). */
    sessionSecret: process.env.SESSION_SECRET || crypto.randomUUID() + crypto.randomUUID(),
    /** How long to wait for CI before judging anyway. */
    ciTimeoutMs: Number(process.env.CI_TIMEOUT_MIN || 30) * 60_000,
    pollMs: Number(process.env.POLL_SEC || 10) * 1000,
    /** needs_human with no maintainer decision for this long → refunded ("when in doubt, refund"). */
    needsHumanTimeoutMs: Number(process.env.NEEDS_HUMAN_DAYS || 14) * 86_400_000,
  };
}

export type Config = ReturnType<typeof loadConfig>;

/** near-cli's legacy keychain: ~/.near-credentials/<network>/<account>.json */
function legacyKey(network: string, account: string): string {
  const file = join(homedir(), ".near-credentials", network, `${account}.json`);
  if (!existsSync(file)) {
    throw new Error(`No key for ${account}: set ORACLE_PRIVATE_KEY or add ${file} (near-cli legacy keychain)`);
  }
  return JSON.parse(readFileSync(file, "utf8")).private_key;
}
