/**
 * The contract's attention-pricing curve (contract/vault/src/curve.rs), step for step, so the
 * web app can draw exactly what the contract will charge.
 * bond = clamp(min, max, base × 1.125^(open − target)), integer maths, rounded down per step.
 */
export interface CurvePolicy {
  base_bond: string | bigint;
  min_bond: string | bigint;
  max_bond: string | bigint;
  target_open: number;
}

export function curveBond(p: CurvePolicy, open: number): bigint {
  const min = BigInt(p.min_bond);
  const max = BigInt(p.max_bond);
  let bond = BigInt(p.base_bond);
  if (open > p.target_open) {
    for (let i = 0; i < open - p.target_open; i++) {
      bond = (bond * 9n) / 8n;
      if (bond >= max) break;
    }
  } else {
    for (let i = 0; i < p.target_open - open; i++) {
      bond = (bond * 8n) / 9n;
      if (bond <= min) break;
    }
  }
  return bond < min ? min : bond > max ? max : bond;
}

/** 2_500_000n → "2.50" (USDC has 6 decimals). */
export function formatUsdc(units: string | bigint | number, decimals = 2): string {
  const n = BigInt(units);
  const scale = 10n ** BigInt(6 - decimals);
  const rounded = (n + scale / 2n) / scale;
  const unit = 10n ** BigInt(decimals);
  return decimals === 0 ? `${rounded}` : `${rounded / unit}.${(rounded % unit).toString().padStart(decimals, "0")}`;
}

/** "2.5" → 2_500_000n */
export function parseUsdc(text: string): bigint {
  const m = text.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!m) throw new Error(`"${text}" isn't an amount like 2.50`);
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}
