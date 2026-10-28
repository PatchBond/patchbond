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

  const judgeMode = (process.env.JUDGE_MODE || "mock") as "mock" | "nearai";
  return {
    root: ROOT,
    port: Number(process.env.PORT || 8787),
    publicUrl: process.env.PUBLIC_URL || "http://localhost:8787",
    webUrl: process.env.WEB_URL || "http://localhost:5317",
    dataDir: process.env.DATA_DIR || join(ROOT, "server", "data"),
    deployment,
    oracleKey: () => process.env.ORACLE_PRIVATE_KEY || legacyKey(network, deployment.oracle),
    judge: {
      mode: judgeMode,
      model: process.env.JUDGE_MODEL || "z-ai/glm-5.3-flash",
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
      /** Octokit spaces writes ≥1 s apart (GitHub's secondary rate limits). Off only in tests. */
      throttle: process.env.GITHUB_THROTTLE !== "off",
    },
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
