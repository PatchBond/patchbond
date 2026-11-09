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

/** 1793231373000 → "Thu 29 Oct 2026, 14:09 UTC" */
export const utc = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";

export function depositComment(o: { author: string; bond: string; currency: Currency; open: number; target: number; link: string; webUrl: string; closeAt?: number | null; hours?: number | null }) {
  return `${MARKER}
👋 Thanks for the contribution, @${o.author}!

This repository uses **PatchBond**: outside contributions carry a small **refundable deposit** so maintainers' review time goes to real work.

| | |
|---|---|
| **Deposit** | **${money(o.bond, o.currency)}** — the queue has ${o.open} open submission${o.open === 1 ? "" : "s"} (capacity ${o.target}); the price follows the queue |
| **Real contribution** | Deposit back in full |
| **Slop** | Deposit goes to the maintainers |

**[Pay the deposit →](${o.link})**
${o.hours === 0 ? `
> 🔒 **This repository closes unpaid PRs straight away.** Nothing is lost: pay the deposit and PatchBond reopens this PR automatically, usually within a minute.
` : o.closeAt ? `
> ⏰ **Pay within ${o.hours} h — by ${utc(o.closeAt)}.** Unpaid PRs are closed automatically then. Nothing is lost: paying later reopens this PR.
` : ""}
An AI judge running in a verified enclave (NEAR AI Cloud) reviews the PR after CI. Every verdict is public, signed and challengeable. Contributors with 3 refunds on 2 repos pay nothing.

<sub>[What is PatchBond?](${o.webUrl}) · ${o.hours === 0 ? "A maintainer can reopen it by hand to review it without a deposit." : o.closeAt ? "Maintainers can still review an unpaid PR before it closes." : "Not paying? The PR stays open; a maintainer can still review it."}</sub>`;
}

/** The account a PR names on a line of its own (`PatchBond: alice.near`); mirrors the enclave's `names_payout`. */
export function namedPayout(body: string | null | undefined): string | null {
  for (const line of (body ?? "").split("\n")) {
    const m = line.trim().toLowerCase().match(/^patchbond(?: payout)?:\s*`?([a-z0-9._-]+)`?$/);
    if (m) return m[1]!;
  }
  return null;
}

export function depositPaidComment(o: { maintainer: string | null; author: string; amount: string; tip: string | null; reviewHours: number; reopened: boolean; unlinked?: string }) {
  const who = o.maintainer ? `@${o.maintainer} — ` : "";
  const tip = o.tip ? ` A review within ${o.reviewHours} h earns the repo the ${o.tip} priority tip.` : "";
  return `${MARKER}
💰 ${who}@${o.author} paid a **${o.amount}** refundable deposit on this PR${o.reopened ? ", so it's reopened" : ""}.${tip}

The AI judge reviews it once CI finishes; the verdict appears here. Filter paid PRs with the \`patchbond: deposit paid\` label.${o.unlinked ? `

@${o.author}: add a line \`PatchBond: ${o.unlinked}\` to the PR description if that account is yours. Without it a refund still comes back, but it earns no reputation and the PR can't claim a bounty.` : ""}`;
}

export function unpaidClosedComment(o: { link: string }) {
  return `${MARKER}
Closing for now: the refundable deposit wasn't paid by the deadline announced above. Nothing is lost —
**[pay the deposit](${o.link})** and PatchBond reopens this PR automatically.`;
}

const ICON = { refund: "✅", forfeit: "⛔", needs_human: "🧑‍⚖️" } as const;
const TITLE = {
  refund: "Deposit refunded — looks like a real contribution",
  forfeit: "Deposit forfeited to the maintainers",
  needs_human: "A maintainer decides",
} as const;

/** Tells the contributor a maintainer proposed to forfeit their bond, and how to stop it in time. */
export function maintainerForfeitComment(o: { author: string; amount: string; deadline: number; link: string | null; contract: string; repoId: number; number: number }) {
  const how = o.link
    ? `Open the [verdict page](${o.link}), sign in with the NEAR account that paid the bond, and press **Dispute**. It's free.`
    : `Call \`dispute\` on \`${o.contract}\` from the NEAR account that paid the bond (it's free): \`near call ${o.contract} dispute '{"repo_id":${o.repoId},"number":${o.number}}' --useAccount <your-account>\`.`;
  return `${MARKER}
### ⚠️ A maintainer proposed to forfeit this deposit

@${o.author}, a maintainer proposed to keep your **${o.amount}** deposit on this PR.

**It becomes final on ${utc(o.deadline)}** (48 h after the proposal) unless you dispute it before then. If nobody disputes, the deposit goes to the repo's vault.

**To dispute:** ${how} A stronger AI model then re-judges the PR, with a statement from each side. If it sides with you, you get your deposit back plus one bond from the maintainers' vault.${o.link ? `\n\n<sub>[Verdict page](${o.link})</sub>` : ""}`;
}

/** Tells both sides a dispute is open: when the stronger model re-judges and how to be heard first. */
export function disputeOpenedComment(o: { author: string; maintainer: string | null; byMaintainer: boolean; free: boolean; proposed: string; rejudgeAt: number; link: string | null }) {
  const who = o.free
    ? `@${o.author} disputed the maintainer's forfeit (free).`
    : `The ${o.byMaintainer ? "maintainer" : "contributor"} staked to challenge the **${o.proposed}** verdict.`;
  const both = [`@${o.author}`, o.maintainer ? `@${o.maintainer}` : "the maintainer"].join(" and ");
  const where = o.link
    ? `on the [verdict page](${o.link}): connect the NEAR wallet that paid the bond (contributor) or the repo's payout account (maintainer) and press **Post statement on-chain**`
    : "with `add_statement` on the PatchBond contract, from the NEAR account that paid the bond or the repo's payout account";
  return `${MARKER}
### ⚖️ Dispute opened — a stronger model re-judges at ${utc(o.rejudgeAt)}

${who} A stronger verifiable model re-judges this PR inside the OutLayer enclave, and the contract pays out on its answer at once.

**${both}: until then, you can each post up to 2 statements (1,500 characters each)** ${where}. The model reads them word for word. What helps: the file and line that does (or doesn't) do what the PR claims, a test that proves it, or why the change is enough for the linked issue.

A forfeit needs the stronger model's own signed forfeit with evidence; anything less is a refund.`;
}

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
