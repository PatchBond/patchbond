// Spending guard for the public "judge any PR" endpoint: every live verdict costs NEAR AI credits,
// and on a hosted demo anyone can ask for one. Deposit-backed verdicts (the GitHub bot) never pass
// through here — a deposit pays for its own judgement.

export interface JudgeLimits {
  /** Live verdicts per UTC day for the whole server. */
  perDay: number;
  /** Live verdicts per UTC day for one visitor. */
  perVisitorDay: number;
  /** Minimum gap between two live verdicts, server-wide (the model runs one at a time). */
  gapMs: number;
}

export const DEFAULT_LIMITS: JudgeLimits = { perDay: 100, perVisitorDay: 10, gapMs: 15_000 };

export class JudgeBudget {
  private day = "";
  private total = 0;
  private byVisitor = new Map<string, number>();
  private last = 0;

  constructor(private limits: JudgeLimits = DEFAULT_LIMITS) {}

  /** Why this visitor can't have a live verdict right now, or null if they can. */
  refuse(visitor: string, now = Date.now()): string | null {
    this.roll(now);
    if (this.total >= this.limits.perDay) {
      return `The free public judge has done its ${this.limits.perDay} verdicts for today (UTC). Verdicts already made are still open, and every PR with a deposit is judged as usual.`;
    }
    if ((this.byVisitor.get(visitor) ?? 0) >= this.limits.perVisitorDay) {
      return `You've used today's ${this.limits.perVisitorDay} free verdicts. Try again tomorrow (UTC), or open a verdict that already exists.`;
    }
    const wait = this.last + this.limits.gapMs - now;
    if (wait > 0) return `The judge is busy; try again in ${Math.ceil(wait / 1000)} seconds.`;
    return null;
  }

  /** Call once a live verdict starts. */
  spend(visitor: string, now = Date.now()) {
    this.roll(now);
    this.total++;
    this.byVisitor.set(visitor, (this.byVisitor.get(visitor) ?? 0) + 1);
    this.last = now;
  }

  private roll(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.total = 0;
      this.byVisitor.clear();
    }
  }
}

/** The client's address behind a proxy (first hop of X-Forwarded-For), or "local". */
export function visitorOf(forwardedFor: string | undefined): string {
  return forwardedFor?.split(",")[0]?.trim() || "local";
}
