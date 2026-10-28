// Maintainer onboarding (SPEC §4.2): sign in with GitHub → see the repos you administer that have
// the PatchBond App → prove you control a NEAR account by signing a NEP-413 message → the oracle
// links the repo's vault to that account. From then on only that account can withdraw or change policy.

import type { Context, Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { verifyMessage } from "near-api-js/nep413";
import { Octokit } from "octokit";
import type { Config } from "./config";
import type { ChainPort } from "./github/bot";
import type { Session, Store } from "./store";

const SESSION = "pb_session";
const STATE = "pb_oauth_state";
const CHALLENGE_TTL_MS = 10 * 60_000;
export const LINK_RECIPIENT = "PatchBond";

export interface MaintainerDeps {
  cfg: Config;
  store: Store;
  chain: Pick<ChainPort, "getRepo" | "registerRepo"> & { linkRepo: (repoId: number, payout: string) => Promise<unknown> };
  /** For NEP-413: must answer viewAccessKey (the real JsonRpcProvider does). */
  provider: Parameters<typeof verifyMessage>[0]["provider"];
}

export interface AdminRepo {
  repo_id: number;
  full_name: string;
  private: boolean;
}

/** The repos this GitHub user administers among the App's installations. */
export async function adminRepos(cfg: Config, token: string): Promise<AdminRepo[]> {
  const gh = new Octokit({ auth: token, baseUrl: cfg.github.apiUrl });
  const { data } = await gh.rest.apps.listInstallationsForAuthenticatedUser({ per_page: 100 });
  const out: AdminRepo[] = [];
  for (const inst of data.installations) {
    const repos = await gh.paginate(gh.rest.apps.listInstallationReposForAuthenticatedUser, { installation_id: inst.id, per_page: 100 });
    for (const r of repos) if (r.permissions?.admin) out.push({ repo_id: r.id, full_name: r.full_name, private: r.private });
  }
  return out;
}

export function linkMessage(fullName: string, repoId: number, account: string) {
  return `Link GitHub repository ${fullName} (id ${repoId}) to NEAR account ${account} as its PatchBond payout account. Only this account will be able to withdraw its vault and change its bond policy.`;
}

export function maintainerRoutes(app: Hono, d: MaintainerDeps) {
  const { cfg, store } = d;
  const redirectUri = `${cfg.webUrl}/api/auth/github/callback`;
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, path: "/", secure: cfg.webUrl.startsWith("https://") };

  async function session(c: Context): Promise<Session | null> {
    const id = await getSignedCookie(c, cfg.sessionSecret, SESSION);
    return id ? store.session(id) : null;
  }

  app.get("/api/auth/github", async (c) => {
    if (!cfg.github.clientId) return c.text("GitHub sign-in isn't configured on this server: create the App at /setup first.", 503);
    const state = crypto.randomUUID();
    await setSignedCookie(c, STATE, state, cfg.sessionSecret, { ...cookieOpts, maxAge: 600 });
    const q = new URLSearchParams({ client_id: cfg.github.clientId, redirect_uri: redirectUri, state });
    return c.redirect(`${cfg.github.webUrl}/login/oauth/authorize?${q}`);
  });

  app.get("/api/auth/github/callback", async (c) => {
    const expected = await getSignedCookie(c, cfg.sessionSecret, STATE);
    if (!expected || expected !== c.req.query("state")) return c.text("Sign-in expired or was tampered with. Start again from the dashboard.", 400);
    deleteCookie(c, STATE, { path: "/" });
    const res = await fetch(`${cfg.github.webUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: cfg.github.clientId, client_secret: cfg.github.clientSecret, code: c.req.query("code"), redirect_uri: redirectUri }),
    });
    const tok = (await res.json()) as { access_token?: string; error_description?: string };
    if (!tok.access_token) return c.text(`GitHub refused the sign-in: ${tok.error_description ?? "no token"}. Start again from the dashboard.`, 400);
    const { data: user } = await new Octokit({ auth: tok.access_token, baseUrl: cfg.github.apiUrl }).rest.users.getAuthenticated();
    const id = crypto.randomUUID();
    store.createSession({ id, github_login: user.login, github_id: user.id, token: tok.access_token, created_at: Date.now() });
    await setSignedCookie(c, SESSION, id, cfg.sessionSecret, { ...cookieOpts, maxAge: 7 * 86_400 });
    return c.redirect(`${cfg.webUrl}/dashboard`);
  });

  app.post("/api/auth/logout", async (c) => {
    const s = await session(c);
    if (s) store.deleteSession(s.id);
    deleteCookie(c, SESSION, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    const s = await session(c);
    if (!s) return c.json({ signed_in: false, github_ready: Boolean(cfg.github.clientId) });
    try {
      const repos = await adminRepos(cfg, s.token);
      const withChain = await Promise.all(repos.map(async (r) => ({ ...r, onchain: await d.chain.getRepo(r.repo_id) })));
      return c.json({ signed_in: true, github_login: s.github_login, repos: withChain });
    } catch (e) {
      return c.json({ error: `GitHub didn't list your repositories: ${(e as Error).message}. Sign in again.` }, 502);
    }
  });

  app.post("/api/link/challenge", async (c) => {
    const s = await session(c);
    if (!s) return c.json({ error: "Sign in with GitHub first." }, 401);
    const { repo_id, account_id } = await c.req.json<{ repo_id: number; account_id: string }>();
    if (!/^[a-z0-9._-]{2,64}$/.test(account_id ?? "")) return c.json({ error: "That isn't a NEAR account id." }, 400);
    const repo = (await adminRepos(cfg, s.token)).find((r) => r.repo_id === repo_id);
    if (!repo) return c.json({ error: "You're not an admin of that repository, or the PatchBond App isn't installed on it." }, 403);
    const linked = (await d.chain.getRepo(repo_id))?.payout;
    if (linked) {
      return c.json({ error: `${repo.full_name} already pays out to ${linked}. Only that account can hand it over (Dashboard → Vault → Hand over).` }, 409);
    }
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const message = linkMessage(repo.full_name, repo_id, account_id);
    store.saveChallenge({ nonce, session_id: s.id, repo_id, account_id, message, expires_at: Date.now() + CHALLENGE_TTL_MS });
    return c.json({ message, recipient: LINK_RECIPIENT, nonce });
  });

  app.post("/api/link/confirm", async (c) => {
    const s = await session(c);
    if (!s) return c.json({ error: "Sign in with GitHub first." }, 401);
    const b = await c.req.json<{ nonce: string; account_id: string; public_key: string; signature: string }>();
    const ch = store.takeChallenge(b.nonce ?? "");
    if (!ch || ch.session_id !== s.id || ch.expires_at < Date.now()) return c.json({ error: "This link request expired. Start again." }, 400);
    if (b.account_id !== ch.account_id) return c.json({ error: `The wallet signed as ${b.account_id}, but the request was for ${ch.account_id}.` }, 400);
    try {
      await verifyMessage({
        signerAccountId: b.account_id,
        signerPublicKey: b.public_key,
        payload: { message: ch.message, recipient: LINK_RECIPIENT, nonce: Buffer.from(ch.nonce, "base64") },
        signature: Buffer.from(b.signature, "base64"),
        provider: d.provider,
      });
    } catch (e) {
      return c.json({ error: `The signature didn't check out: ${(e as Error).message}` }, 400);
    }
    // Re-check admin rights at the moment of linking.
    if (!(await adminRepos(cfg, s.token)).some((r) => r.repo_id === ch.repo_id)) return c.json({ error: "You're no longer an admin of that repository." }, 403);
    if (!(await d.chain.getRepo(ch.repo_id))) await d.chain.registerRepo(ch.repo_id);
    await d.chain.linkRepo(ch.repo_id, ch.account_id);
    return c.json({ ok: true, repo_id: ch.repo_id, payout: ch.account_id });
  });
}
