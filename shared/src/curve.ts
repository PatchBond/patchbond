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

/** What a repo's bonds are paid in (contract `Currency`). NEAR travels as wNEAR. */
export type Currency = "usdc" | "near";
export const DECIMALS: Record<Currency, number> = { usdc: 6, near: 24 };
export const SYMBOL: Record<Currency, string> = { usdc: "USDC", near: "NEAR" };

/** 2_500_000n → "2.50" (usdc); 1.5e24 → "1.50" (near). */
export function formatAmount(units: string | bigint | number, currency: Currency = "usdc", decimals = 2): string {
  const n = BigInt(units);
  const scale = 10n ** BigInt(DECIMALS[currency] - decimals);
  const rounded = (n + scale / 2n) / scale;
  const unit = 10n ** BigInt(decimals);
  return decimals === 0 ? `${rounded}` : `${rounded / unit}.${(rounded % unit).toString().padStart(decimals, "0")}`;
}

/** "2.5" → 2_500_000n (usdc) or 2.5e24 (near). */
export function parseAmount(text: string, currency: Currency = "usdc"): bigint {
  const d = DECIMALS[currency];
  const m = text.trim().match(new RegExp(`^(\\d+)(?:\\.(\\d{0,${d}}))?$`));
  if (!m) throw new Error(`"${text}" isn't an amount like 2.50`);
  return BigInt(m[1]!) * 10n ** BigInt(d) + BigInt((m[2] ?? "").padEnd(d, "0") || "0");
}

/** 2_500_000n → "2.50" (USDC has 6 decimals). */
export const formatUsdc = (units: string | bigint | number, decimals = 2) => formatAmount(units, "usdc", decimals);

/** "2.5" → 2_500_000n */
export const parseUsdc = (text: string) => parseAmount(text, "usdc");
