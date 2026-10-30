// Local state: published verdict records and the GitHub side of each submission.
// The chain is the source of truth for money; this is the source for verdict bytes and PR plumbing.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { VerdictRecord } from "@patchbond/shared";

export type SubmissionState = "awaiting_deposit" | "deposit_received" | "judging" | "judged" | "settled" | "exempt" | "closed" | "closed_unpaid";

export interface Submission {
  repo_id: number;
  number: number;
  full_name: string;
  installation_id: number;
  author: string;
  head_sha: string;
  check_run_id: number | null;
  comment_id: number | null;
  state: SubmissionState;
  verdict_id: string | null;
  deposit_seen_at: number | null;
  updated_at: number;
  /** When an unpaid PR gets closed — announced in the deposit comment; never closed without it. */
  close_at: number | null;
}

export interface Session {
  id: string;
  github_login: string;
  github_id: number;
  /** GitHub user-to-server token; stays on the server. */
  token: string;
  created_at: number;
}

export interface LinkChallenge {
  nonce: string;
  session_id: string;
  repo_id: number;
  account_id: string;
  message: string;
  expires_at: number;
}

interface SealedReportRow {
  repo_id: number;
  number: number;
  sealed: string;
  sha256: string;
  reporter: string;
  created_at: number;
  record: string | null;
}
export type SealedReport = Omit<SealedReportRow, "record"> & { record: SealedRecord | null };

/** What the enclave publishes for a sealed report: the verdict and signature; the rest is sealed. */
export interface SealedRecord {
  kind: "report";
  runner: "outlayer-tdx";
  id: string;
  repo: { id: number; full_name: string };
  number: number;
  model: string;
  signature: { text: string; signature: string; signing_address: string; signing_algo: string; signature_kind?: string };
  verdict_hash: string;
  final: { verdict: "refund" | "forfeit" | "needs_human"; category: string; confidence: number };
  sealed_for_maintainer: unknown;
  created_at: string;
}

export class Store {
  readonly db: Database;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new Database(join(dir, "patchbond.sqlite"), { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS verdicts (
        id TEXT PRIMARY KEY, repo_id INTEGER NOT NULL, number INTEGER NOT NULL,
        verdict TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS verdicts_repo ON verdicts (repo_id, number);
      CREATE TABLE IF NOT EXISTS submissions (
        repo_id INTEGER NOT NULL, number INTEGER NOT NULL, full_name TEXT NOT NULL,
        installation_id INTEGER NOT NULL, author TEXT NOT NULL, head_sha TEXT NOT NULL,
        check_run_id INTEGER, comment_id INTEGER, state TEXT NOT NULL, verdict_id TEXT,
        deposit_seen_at INTEGER, updated_at INTEGER NOT NULL, close_at INTEGER,
        PRIMARY KEY (repo_id, number));
      CREATE TABLE IF NOT EXISTS appeals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, verdict_id TEXT NOT NULL, author TEXT NOT NULL,
        note TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, github_login TEXT NOT NULL, github_id INTEGER NOT NULL,
        token TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS link_challenges (
        nonce TEXT PRIMARY KEY, session_id TEXT NOT NULL, repo_id INTEGER NOT NULL,
        account_id TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS github_accounts (
        github_user TEXT PRIMARY KEY, near_account TEXT NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS repo_maintainers (
        repo_id INTEGER PRIMARY KEY, github_login TEXT NOT NULL, linked_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (
        repo_id INTEGER NOT NULL, number INTEGER NOT NULL, sealed TEXT NOT NULL, sha256 TEXT NOT NULL,
        reporter TEXT NOT NULL, created_at INTEGER NOT NULL, record TEXT, PRIMARY KEY (repo_id, number));
    `);
    // Databases from before auto-close existed.
    if (!this.db.query<{ name: string }, []>("PRAGMA table_info(submissions)").all().some((c) => c.name === "close_at")) {
      this.db.exec("ALTER TABLE submissions ADD COLUMN close_at INTEGER");
    }
  }

  // ---- Sealed security reports: only ciphertext and the enclave's sealed record are stored. ----

  addReport(r: { repo_id: number; sealed: string; sha256: string; reporter: string }, base: number): number {
    const last = this.db.query<{ n: number | null }, [number]>("SELECT MAX(number) AS n FROM reports WHERE repo_id = ?").get(r.repo_id)?.n;
    const number = Math.max(base, (last ?? base - 1) + 1);
    this.db.query("INSERT INTO reports (repo_id, number, sealed, sha256, reporter, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(r.repo_id, number, r.sealed, r.sha256, r.reporter, Date.now());
    return number;
  }

  report(repoId: number, number: number): SealedReport | null {
    const row = this.db.query<SealedReportRow, [number, number]>("SELECT * FROM reports WHERE repo_id = ? AND number = ?").get(repoId, number);
    return row ? { ...row, record: row.record ? JSON.parse(row.record) : null } : null;
  }

  reports(repoId: number): SealedReport[] {
    return this.db
      .query<SealedReportRow, [number]>("SELECT * FROM reports WHERE repo_id = ? ORDER BY number DESC LIMIT 200")
      .all(repoId)
      .map((row) => ({ ...row, record: row.record ? JSON.parse(row.record) : null }));
  }

  saveReportRecord(repoId: number, number: number, record: unknown) {
    this.db.query("UPDATE reports SET record = ? WHERE repo_id = ? AND number = ?").run(JSON.stringify(record), repoId, number);
  }

  saveVerdict(r: VerdictRecord) {
    this.db
      .query("INSERT OR REPLACE INTO verdicts VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.id, r.repo.id, r.number, r.final.verdict, r.created_at, JSON.stringify(r));
  }

  verdict(id: string): VerdictRecord | null {
    const row = this.db.query<{ record: string }, [string]>("SELECT record FROM verdicts WHERE id = ?").get(id);
    return row ? JSON.parse(row.record) : null;
  }

  /** The newest verdict on `full_name#number` since `sinceIso` (made by the same kind of judge). */
  latestVerdictFor(fullName: string, number: number, sinceIso: string, live: boolean): VerdictRecord | null {
    const row = this.db
      .query<{ record: string }, [string, number, string, number]>(
        `SELECT record FROM verdicts WHERE json_extract(record, '$.repo.full_name') = ? AND number = ? AND created_at >= ?
           AND json_extract(record, '$.mock') = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(fullName, number, sinceIso, live ? 0 : 1);
    return row ? (JSON.parse(row.record) as VerdictRecord) : null;
  }

  /** Aggregate activity for the public live-numbers block (no names, no amounts). */
  stats(): { prs: number; by_state: Record<string, number>; repos: number; verdicts_live: number } {
    const by = this.db.query<{ state: string; n: number }, []>("SELECT state, COUNT(*) AS n FROM submissions GROUP BY state").all();
    const repos = this.db.query<{ n: number }, []>("SELECT COUNT(DISTINCT repo_id) AS n FROM submissions").get()?.n ?? 0;
    const live = this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM verdicts WHERE json_extract(record, '$.mock') = 0").get()?.n ?? 0;
    return { prs: by.reduce((a, r) => a + r.n, 0), by_state: Object.fromEntries(by.map((r) => [r.state, r.n])), repos, verdicts_live: live };
  }

  /** Newest first. `liveOnly` leaves out records from the offline dev judge. */
  recentVerdicts(limit = 50, repoId?: number, liveOnly = false): VerdictRecord[] {
    const live = liveOnly ? "AND json_extract(record, '$.mock') = 0" : "";
    const rows = repoId
      ? this.db.query<{ record: string }, [number, number]>(`SELECT record FROM verdicts WHERE repo_id = ? ${live} ORDER BY created_at DESC LIMIT ?`).all(repoId, limit)
      : this.db.query<{ record: string }, [number]>(`SELECT record FROM verdicts WHERE 1 = 1 ${live} ORDER BY created_at DESC LIMIT ?`).all(limit);
    return rows.map((r) => JSON.parse(r.record));
  }

  upsertSubmission(s: Omit<Submission, "updated_at" | "close_at"> & { close_at?: number | null }) {
    this.db
      .query(
        `INSERT INTO submissions (repo_id, number, full_name, installation_id, author, head_sha, check_run_id,
           comment_id, state, verdict_id, deposit_seen_at, updated_at, close_at)
         VALUES ($repo_id, $number, $full_name, $installation_id, $author, $head_sha,
           $check_run_id, $comment_id, $state, $verdict_id, $deposit_seen_at, $now, $close_at)
         ON CONFLICT (repo_id, number) DO UPDATE SET head_sha = $head_sha, full_name = $full_name,
           check_run_id = COALESCE($check_run_id, check_run_id), comment_id = COALESCE($comment_id, comment_id),
           state = $state, verdict_id = COALESCE($verdict_id, verdict_id),
           deposit_seen_at = COALESCE($deposit_seen_at, deposit_seen_at), updated_at = $now,
           close_at = COALESCE($close_at, close_at)`,
      )
      .run({ ...prefix({ close_at: null, ...s }), $now: Date.now() });
  }

  submission(repoId: number, number: number): Submission | null {
    return this.db.query<Submission, [number, number]>("SELECT * FROM submissions WHERE repo_id = ? AND number = ?").get(repoId, number);
  }

  submissionsIn(...states: SubmissionState[]): Submission[] {
    const q = `SELECT * FROM submissions WHERE state IN (${states.map(() => "?").join(",")})`;
    return this.db.query<Submission, string[]>(q).all(...states);
  }

  setState(repoId: number, number: number, state: SubmissionState, patch: Partial<Submission> = {}) {
    const s = this.submission(repoId, number);
    if (s) this.upsertSubmission({ ...s, ...patch, state });
  }

  addAppeal(verdictId: string, author: string, note: string) {
    this.db.query("INSERT INTO appeals (verdict_id, author, note, created_at) VALUES (?, ?, ?, ?)").run(verdictId, author, note, Date.now());
  }

  appeals(verdictId: string): { author: string; note: string; created_at: number }[] {
    return this.db
      .query<{ author: string; note: string; created_at: number }, [string]>("SELECT author, note, created_at FROM appeals WHERE verdict_id = ? ORDER BY id")
      .all(verdictId);
  }

  createSession(s: Session) {
    this.db.query("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(s.id, s.github_login, s.github_id, s.token, s.created_at);
  }

  session(id: string): Session | null {
    return this.db.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?").get(id);
  }

  deleteSession(id: string) {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  saveChallenge(c: LinkChallenge) {
    this.db.query("INSERT INTO link_challenges VALUES (?, ?, ?, ?, ?, ?)").run(c.nonce, c.session_id, c.repo_id, c.account_id, c.message, c.expires_at);
  }

  /** One-time: returns and deletes the challenge. */
  takeChallenge(nonce: string): LinkChallenge | null {
    const c = this.db.query<LinkChallenge, [string]>("SELECT * FROM link_challenges WHERE nonce = ?").get(nonce);
    this.db.query("DELETE FROM link_challenges WHERE nonce = ?").run(nonce);
    return c;
  }

  /** The GitHub login that linked the repo: who the bot @mentions (GitHub emails them for free). */
  setRepoMaintainer(repoId: number, githubLogin: string) {
    this.db.query("INSERT OR REPLACE INTO repo_maintainers VALUES (?, ?, ?)").run(repoId, githubLogin, Date.now());
  }

  repoMaintainer(repoId: number): string | null {
    return this.db.query<{ github_login: string }, [number]>("SELECT github_login FROM repo_maintainers WHERE repo_id = ?").get(repoId)?.github_login ?? null;
  }

  /** Recent submissions on these repos, newest first — the dashboard's activity feed. */
  recentSubmissions(repoIds: number[], limit = 20): Submission[] {
    if (!repoIds.length) return [];
    const q = `SELECT * FROM submissions WHERE repo_id IN (${repoIds.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT ?`;
    return this.db.query<Submission, number[]>(q).all(...repoIds, limit);
  }

  linkGithub(githubUser: string, nearAccount: string) {
    this.db.query("INSERT OR REPLACE INTO github_accounts VALUES (?, ?, ?)").run(githubUser.toLowerCase(), nearAccount, Date.now());
  }

  nearAccountOf(githubUser: string): string | null {
    return (
      this.db.query<{ near_account: string }, [string]>("SELECT near_account FROM github_accounts WHERE github_user = ?").get(githubUser.toLowerCase())
        ?.near_account ?? null
    );
  }
}

function prefix(o: object): Record<string, string | number | null> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [`$${k}`, v ?? null]));
}
