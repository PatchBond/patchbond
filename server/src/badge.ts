// "Protected by PatchBond" README badge: a shields-style SVG with the repo's live bond and refunds,
// read from the contract. Every maintainer who adds it shows contributors the price up front.

import type { Repo } from "./near";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Approximate Verdana 11px text width (what shields.io badges use). */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ilI.,:·'|!]/.test(ch) ? 3.5 : /[mwMW@]/.test(ch) ? 9.5 : /[A-Z0-9$]/.test(ch) ? 7.5 : 6.6;
  return Math.ceil(w);
}

export function badgeSvg(label: string, message: string, color: string): string {
  const lw = textWidth(label) + 26; // room for the shield glyph
  const mw = textWidth(message) + 14;
  const w = lw + mw;
  const title = esc(`${label}: ${message}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}"><title>${title}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#1c2027"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<path d="M8 4.5l4.5 1.6v3.4c0 2.7-1.9 4.6-4.5 5.6-2.6-1-4.5-2.9-4.5-5.6V6.1z" fill="#22c55e"/><path d="M6.2 9.6l1.3 1.3 2.5-2.7" stroke="#0e1013" stroke-width="1.2" fill="none" stroke-linecap="round"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${(lw + 14) / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${(lw + 14) / 2}" y="14">${esc(label)}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(message)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text>
</g></svg>`;
}

/** What the badge says for a repo (null repo = not registered). */
export function badgeFor(repo: Repo | null | undefined, quote: string | undefined): { message: string; color: string } {
  if (!repo) return { message: "not installed", color: "#6b7079" };
  if (!repo.policy.enabled) return { message: "off", color: "#6b7079" };
  const near = repo.currency === "near";
  const amount = Number(quote ?? repo.policy.base_bond) / (near ? 1e24 : 1e6);
  const price = near ? `${amount.toFixed(amount < 1 ? 2 : 1)} NEAR` : `$${amount.toFixed(2)}`;
  const refunds = repo.stats.refunds;
  return { message: `bond ${price}${refunds ? ` · ${refunds} refunded` : ""}`, color: "#16a34a" };
}
