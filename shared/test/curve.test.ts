import { describe, expect, test } from "bun:test";
import { curveBond, formatUsdc, parseUsdc } from "../src";

const p = { base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8 };

describe("curve matches the contract's unit tests", () => {
  test("same values as contract/vault/src/curve.rs", () => {
    expect(curveBond(p, 8)).toBe(2_000_000n);
    expect(curveBond(p, 9)).toBe(2_250_000n);
    expect(curveBond(p, 10)).toBe(2_531_250n);
    expect(curveBond(p, 14)).toBe(4_054_572n);
    expect(curveBond(p, 40)).toBe(50_000_000n);
    expect(curveBond({ ...p, target_open: 1000 }, 0)).toBe(250_000n);
    expect(curveBond({ ...p, target_open: 2 }, 6)).toBe(3_203_613n); // sandbox flood test
  });

  test("usdc formatting round-trips", () => {
    expect(formatUsdc(4_054_572n)).toBe("4.05");
    expect(formatUsdc("250000")).toBe("0.25");
    expect(parseUsdc("2.5")).toBe(2_500_000n);
    expect(parseUsdc("10")).toBe(10_000_000n);
    expect(() => parseUsdc("abc")).toThrow();
  });
});
