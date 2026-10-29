// Records the real, running app (bun run dev) and real testnet transactions as 1080p clips for the
// pitch video. Nothing is mocked here: every frame is the live UI or a public block explorer.
//   (repo root) bun run dev      # in another terminal
//   cd video && bun run record   # ONLY=judge,pay bun run record → just those scenes

import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const WEB = process.env.WEB ?? "http://localhost:5317";
const OUT = resolve(import.meta.dir, "public/clips");
const SIZE = { width: 1920, height: 1080 };
mkdirSync(OUT, { recursive: true });

// Real transactions from the last testnet e2e run.
const report = readFileSync(resolve(import.meta.dir, "../docs/e2e/testnet-report.md"), "utf8");
const tx = (label: string) => report.match(new RegExp(`\\[[^\\]]*${label}[^\\]]*\\]\\((https://testnet\\.nearblocks\\.io/txns/\\w+)\\)`))?.[1];

const browser = await chromium.launch({ channel: "chrome", headless: true });

const ONLY = process.env.ONLY?.split(",");
/** Seconds since the current scene's recording started — printed so the cut can line up with it. */
let sceneStart = 0;
const mark = (what: string) => console.log(`  ${what} at ${((Date.now() - sceneStart) / 1000).toFixed(1)} s`);

async function scene(name: string, run: (page: Page) => Promise<void>) {
  if (ONLY && !ONLY.includes(name)) return;
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, colorScheme: "dark" });
  const page = await context.newPage();
  const t0 = Date.now();
  sceneStart = t0;
  try {
    await run(page);
  } catch (e) {
    console.error(`scene ${name} failed: ${(e as Error).message}`);
  }
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), join(OUT, `${name}.webm`));
  console.log(`✓ ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
}

async function scrollTo(page: Page, text: string, offset = -120) {
  await page.getByText(text, { exact: false }).first().evaluate((el, off) => {
    const y = el.getBoundingClientRect().top + window.scrollY + off;
    window.scrollTo({ top: y, behavior: "smooth" });
  }, offset);
  await page.waitForTimeout(1200);
}

async function glide(page: Page, px: number, steps = 30) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(40);
  }
}

await scene("hero", async (p) => {
  await p.goto(WEB, { waitUntil: "networkidle" });
  await p.waitForTimeout(11_000); // the bond machine runs
});

await scene("spam", async (p) => {
  await p.goto(WEB, { waitUntil: "networkidle" });
  await scrollTo(p, "EIP-1559 for maintainers.", -180);
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /Simulate a spam wave/ }).click();
  await p.waitForTimeout(7500);
});

// Judged live by the NEAR AI model in a TEE (~$0.0004); the wait for the verdict is cut in the edit.
await scene("judge", async (p) => {
  await p.goto(WEB, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.keyboard.press("Meta+K");
  await p.waitForTimeout(600);
  mark("typing");
  await p.keyboard.type("https://github.com/tj/commander.js/pull/2637", { delay: 28 });
  await p.waitForTimeout(700);
  await p.keyboard.press("Enter");
  await p.waitForURL(/\/v\//, { timeout: 180_000 });
  mark("verdict page");
  await p.waitForTimeout(3500);
  await glide(p, 700);
  await p.waitForTimeout(1500);
  await scrollTo(p, "Verify it yourself", -200);
  mark("verify clicked");
  await p.getByRole("button", { name: /Verify signature/ }).click();
  await p.waitForTimeout(5500);
});

await scene("pay", async (p) => {
  await p.goto(`${WEB}/pay/2/1?repo=PatchBond/playground-near&user=tunde`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.getByText("Optional: priority tip, linked issue").click();
  await p.waitForTimeout(3000);
});

await scene("agents", async (p) => {
  await p.goto(`${WEB}/agents`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await glide(p, 1100, 45);
  await p.waitForTimeout(2500);
});

await scene("maintainers", async (p) => {
  await p.goto(`${WEB}/dashboard`, { waitUntil: "networkidle" });
  await p.waitForTimeout(4000);
});

for (const [name, label] of [["tx-gasless", "relayer submits the signed delegate"], ["tx-mcp", "agent pays via the MCP server"]] as const) {
  const url = tx(label);
  if (!url) {
    console.error(`no tx for "${label}" in the e2e report`);
    continue;
  }
  await scene(name, async (p) => {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await p.waitForTimeout(7000);
  });
}

await browser.close();
console.log(`clips in ${OUT}`);
