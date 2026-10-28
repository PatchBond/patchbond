// Maintainer onboarding: GitHub sign-in → admin repos → NEP-413 wallet proof → oracle links the vault.
// Real NEP-413 signatures; a fake GitHub and a fake chain/provider.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { loadConfig } from "../src/config";
import { LINK_RECIPIENT, maintainerRoutes } from "../src/maintainers";
import { Store } from "../src/store";
import { fakeChain, fakeGithub } from "./fakes";

const REPO = { id: 4242, owner: "acme", name: "widget" };
const wallet = KeyPair.fromRandom("ed25519");
let permission: unknown = "FullAccess";

let gh: ReturnType<typeof fakeGithub>;
let chain: ReturnType<typeof fakeChain>;
let app: Hono;

beforeAll(() => {
  gh = fakeGithub(REPO, []);
  chain = fakeChain(REPO.id);
  Object.assign(process.env, {
    GITHUB_API_URL: gh.url, GITHUB_WEB_URL: gh.url, GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "s",
    SESSION_SECRET: "test-secret-test-secret-test-secret", WEB_URL: "http://pb.test",
  });
  app = new Hono();
  const provider = { viewAccessKey: async () => ({ permission }) } as never;
  maintainerRoutes(app, { cfg: loadConfig(), store: new Store(mkdtempSync(join(tmpdir(), "pb-m-"))), chain, provider });
});
afterAll(() => gh.stop());

/** A tiny cookie jar over app.request. */
function client() {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const res = await app.request(path, { ...init, headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv!.split("=");
      if (v === "" || /Max-Age=0/i.test(c)) jar.delete(k!);
      else jar.set(k!, v!);
    }
    return res;
  };
}

async function signIn() {
  const req = client();
  const start = await req("/api/auth/github");
  expect(start.status).toBe(302);
  const loc = new URL(start.headers.get("location")!);
  expect(loc.pathname).toBe("/login/oauth/authorize");
  const back = await req(`/api/auth/github/callback?code=good&state=${loc.searchParams.get("state")}`);
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("http://pb.test/dashboard");
  return req;
}

async function sign(message: string, nonceB64: string, accountId = "amaka.testnet") {
  const signer = new Account(accountId, new JsonRpcProvider({ url: "http://unused" }), wallet.toString() as KeyPairString);
  const s = await signMessage({ signerAccount: signer, payload: { message, recipient: LINK_RECIPIENT, nonce: Buffer.from(nonceB64, "base64") } });
  const sig = s.signature as unknown;
  return {
    account_id: accountId,
    public_key: wallet.getPublicKey().toString(),
    signature: typeof sig === "string" ? sig : Buffer.from(sig as Uint8Array).toString("base64"),
  };
}

const post = (body: object) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("maintainer onboarding", () => {
  test("sign in with GitHub, see only the repos you administer", async () => {
    const req = await signIn();
    const me = (await (await req("/api/me")).json()) as { github_login: string; repos: { full_name: string }[] };
    expect(me.github_login).toBe("amaka");
    expect(me.repos.map((r) => r.full_name)).toEqual(["acme/widget"]);
  });

  test("a NEP-413 signature from the wallet links the repo to that account", async () => {
    const req = await signIn();
    const ch = (await (await req("/api/link/challenge", post({ repo_id: REPO.id, account_id: "amaka.testnet" }))).json()) as { message: string; nonce: string };
    expect(ch.message).toContain("acme/widget");
    expect(ch.message).toContain("amaka.testnet");
    const res = await req("/api/link/confirm", post({ nonce: ch.nonce, ...(await sign(ch.message, ch.nonce)) }));
    expect(res.status).toBe(200);
    expect(chain.log).toContain(`register ${REPO.id}`);
    expect(chain.log).toContain(`link ${REPO.id} → amaka.testnet`);
  });

  test("a challenge can't be replayed", async () => {
    const req = await signIn();
    const ch = (await (await req("/api/link/challenge", post({ repo_id: REPO.id, account_id: "amaka.testnet" }))).json()) as { message: string; nonce: string };
    const body = post({ nonce: ch.nonce, ...(await sign(ch.message, ch.nonce)) });
    expect((await req("/api/link/confirm", body)).status).toBe(200);
    const again = await req("/api/link/confirm", body);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain("expired");
  });

  test("a forged signature, a different account, or a function-call key is refused", async () => {
    const req = await signIn();
    const fresh = async () => (await (await req("/api/link/challenge", post({ repo_id: REPO.id, account_id: "amaka.testnet" }))).json()) as { message: string; nonce: string };

    let ch = await fresh();
    const forged = await sign("Link acme/widget to thief.testnet", ch.nonce);
    expect((await req("/api/link/confirm", post({ nonce: ch.nonce, ...forged }))).status).toBe(400);

    ch = await fresh();
    const other = await sign(ch.message, ch.nonce, "thief.testnet");
    const r2 = await req("/api/link/confirm", post({ nonce: ch.nonce, ...other }));
    expect(((await r2.json()) as { error: string }).error).toContain("request was for amaka.testnet");

    permission = { FunctionCall: { receiver_id: "x", method_names: [] } };
    ch = await fresh();
    const r3 = await req("/api/link/confirm", post({ nonce: ch.nonce, ...(await sign(ch.message, ch.nonce)) }));
    permission = "FullAccess";
    expect(r3.status).toBe(400);
    expect(((await r3.json()) as { error: string }).error).toContain("FullAccess");
  });

  test("you can't link a repo you don't administer, and nothing works signed out", async () => {
    const req = await signIn();
    const r = await req("/api/link/challenge", post({ repo_id: 99, account_id: "amaka.testnet" }));
    expect(r.status).toBe(403);
    const anon = client();
    expect((await anon("/api/link/challenge", post({ repo_id: REPO.id, account_id: "amaka.testnet" }))).status).toBe(401);
    expect(((await (await anon("/api/me")).json()) as { signed_in: boolean }).signed_in).toBe(false);
  });

  test("a sign-in callback with a wrong state is rejected (CSRF)", async () => {
    const req = client();
    await req("/api/auth/github");
    expect((await req("/api/auth/github/callback?code=good&state=evil")).status).toBe(400);
  });
});
