// Everything PatchBond says on GitHub. Short, specific, and always says what to do next.

import { formatAmount, SYMBOL, type Currency, type VerdictRecord } from "@patchbond/shared";

/** "$2.00 USDC" or "0.78 NEAR" */
export const money = (units: string, currency: Currency) =>
  `${currency === "usdc" ? "$" : ""}${formatAmount(units, currency)} ${SYMBOL[currency]}`;

export const CHECK_NAME = "PatchBond";
export const MARKER = "<!-- patchbond -->";

export function payLink(webUrl: string, repoId: number, number: number, fullName: string, author: string) {
  const q = new URLSearchParams({ repo: fullName, user: author });
  return `${webUrl}/pay/${repoId}/${number}?${q}`;
}

export function depositComment(o: { author: string; bond: string; currency: Currency; open: number; target: number; link: string; webUrl: string }) {
  return `${MARKER}
👋 Thanks for the contribution, @${o.author}!

This repository uses **PatchBond**: outside contributions carry a small **refundable deposit** so maintainers' review time goes to real work.

| | |
|---|---|
| **Deposit** | **${money(o.bond, o.currency)}** — the queue has ${o.open} open submission${o.open === 1 ? "" : "s"} (capacity ${o.target}); the price follows the queue |
| **Real contribution** | Deposit back in full |
| **Slop** | Deposit goes to the maintainers |

**[Pay the deposit →](${o.link})**

An AI judge running in a verified enclave (NEAR AI Cloud) reviews the PR after CI. Every verdict is public, signed and challengeable. Contributors with 3 refunds on 2 repos pay nothing.

<sub>[What is PatchBond?](${o.webUrl}) · Not paying? The PR stays open; a maintainer can still review it.</sub>`;
}

export function depositPaidComment(o: { maintainer: string | null; author: string; amount: string; tip: string | null; reviewHours: number; reopened: boolean }) {
  const who = o.maintainer ? `@${o.maintainer} — ` : "";
  const tip = o.tip ? ` A review within ${o.reviewHours} h earns the repo the ${o.tip} priority tip.` : "";
  return `${MARKER}
💰 ${who}@${o.author} paid a **${o.amount}** refundable deposit on this PR${o.reopened ? ", so it's reopened" : ""}.${tip}

The AI judge reviews it once CI finishes; the verdict appears here. Filter paid PRs with the \`patchbond: deposit paid\` label.`;
}

export function unpaidClosedComment(o: { hours: number; link: string }) {
  return `${MARKER}
Closing for now: this repository asks for a refundable deposit within ${o.hours} h, and none arrived. Nothing is lost —
**[pay the deposit](${o.link})** and PatchBond reopens this PR automatically.`;
}

const ICON = { refund: "✅", forfeit: "⛔", needs_human: "🧑‍⚖️" } as const;
const TITLE = {
  refund: "Deposit refunded — looks like a real contribution",
  forfeit: "Deposit forfeited to the maintainers",
  needs_human: "A maintainer decides",
} as const;

export function verdictComment(r: VerdictRecord, o: { webUrl: string; challengeHours: number; onChain: boolean }) {
  const v = r.final.verdict;
  const link = `${o.webUrl}/v/${r.id}`;
  const reasons = r.final.reasons.map((x) => `- ${x}`).join("\n") || "- (no reasons given)";
  const evidence = r.final.evidence.length
    ? `\n**Evidence**\n${r.final.evidence.map((e) => `- \`${e.file}${e.line ? `:${e.line}` : ""}\` — ${e.note}`).join("\n")}\n`
    : "";
  const rules = r.final.rules_applied.length ? `\n<sub>Safety rules applied: ${r.final.rules_applied.join("; ")}</sub>\n` : "";
  const next =
    v === "needs_human"
      ? "**Maintainers:** refund or forfeit from the [verdict page](" + link + "). No decision in 14 days → refunded."
      : o.challengeHours > 0
        ? `This verdict stands in **${o.challengeHours} h** unless challenged. Disagree? [Challenge it](${link}) by staking the deposit — a stronger model re-judges, and you get the stake back if you're right.`
        : "Settled.";
  return `${MARKER}
### ${ICON[v]} ${TITLE[v]}

${reasons}
${evidence}${rules}
${next}

<sub>Judge: \`${r.model}\`${r.mock ? " ⚠️ **mock judge (dev key, not a TEE)**" : " in a TEE"} · confidence ${r.final.confidence} · [verify the signature yourself](${link})${o.onChain ? "" : " · not yet settled on-chain"}</sub>`;
}

export function checkSummary(state: "awaiting" | "received" | "exempt" | VerdictRecord["final"]["verdict"], detail: string) {
  const titles = {
    awaiting: "Deposit required",
    received: "Deposit received — judging after CI",
    exempt: "No deposit needed",
    refund: "Refunded: real contribution",
    forfeit: "Forfeited: wastes maintainers' time",
    needs_human: "Needs a maintainer",
  } as const;
  return { title: titles[state], summary: detail };
}
