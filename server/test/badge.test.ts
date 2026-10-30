// The README badge says what a newcomer would pay right now, and is valid SVG text.
import { describe, expect, test } from "bun:test";
import { badgeFor, badgeSvg } from "../src/badge";
import type { Repo } from "../src/near";

const repo = (p: Partial<Repo> = {}): Repo =>
  ({
    payout: "amaka.testnet", vault: "0", open: 0, linked_at: 1, currency: "usdc",
    policy: { enabled: true, base_bond: "1000000", min_bond: "250000", max_bond: "50000000", target_open: 8, review_window_sec: 1, challenge_window_sec: 1, forfeit_threshold_bps: 8500 },
    stats: { deposits: 3, refunds: 3, forfeits: 0, forfeited_total: "0", tips_earned: "0" },
    ...p,
  }) as Repo;

describe("README badge", () => {
  test("live price and refunds; off and not-installed states", () => {
    expect(badgeFor(repo(), "500000").message).toBe("bond $0.50 · 3 refunded");
    expect(badgeFor(repo({ currency: "near" }), (12n * 10n ** 23n).toString()).message).toBe("bond 1.2 NEAR · 3 refunded");
    expect(badgeFor(repo({ policy: { ...repo().policy, enabled: false } }), "1").message).toBe("off");
    expect(badgeFor(null, undefined).message).toBe("not installed");
  });

  test("escapes text and sizes to fit", () => {
    const svg = badgeSvg("PatchBond", 'bond <$1> & "x"', "#16a34a");
    expect(svg).toContain("&lt;$1&gt; &amp; &quot;x&quot;");
    expect(svg).not.toContain("<$1>");
    expect(Number(svg.match(/width="(\d+)"/)![1])).toBeGreaterThan(120);
  });
});
