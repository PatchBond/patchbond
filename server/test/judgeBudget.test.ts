import { describe, expect, test } from "bun:test";
import { JudgeBudget, visitorOf } from "../src/judgeBudget";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 29, 12);

describe("public judge spending guard", () => {
  test("a gap between live verdicts, server-wide", () => {
    const b = new JudgeBudget({ perDay: 100, perVisitorDay: 10, gapMs: 15_000 });
    expect(b.refuse("a", t0)).toBeNull();
    b.spend("a", t0);
    expect(b.refuse("b", t0 + 5_000)).toContain("try again in 10 seconds");
    expect(b.refuse("b", t0 + 15_000)).toBeNull();
  });

  test("a per-visitor daily cap", () => {
    const b = new JudgeBudget({ perDay: 100, perVisitorDay: 2, gapMs: 0 });
    b.spend("a", t0);
    b.spend("a", t0 + 1);
    expect(b.refuse("a", t0 + 2)).toContain("today's 2 free verdicts");
    expect(b.refuse("b", t0 + 2)).toBeNull();
  });

  test("a global daily cap that resets at midnight UTC", () => {
    const b = new JudgeBudget({ perDay: 3, perVisitorDay: 10, gapMs: 0 });
    for (const v of ["a", "b", "c"]) b.spend(v, t0);
    expect(b.refuse("d", t0)).toContain("its 3 verdicts for today");
    expect(b.refuse("d", t0 + DAY)).toBeNull();
  });

  test("the visitor is the first X-Forwarded-For hop", () => {
    expect(visitorOf("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(visitorOf(undefined)).toBe("local");
  });
});
