// End-to-end test on real NEAR testnet: every money path of the vault, a real function-call key,
// a real challenge window, and the judge → chain link — then everything is deleted again.
//
//   cd contract && cargo near build non-reproducible-wasm --manifest-path vault/Cargo.toml \
//     && cargo near build non-reproducible-wasm --manifest-path mock-ft/Cargo.toml
//   cd server && bun run e2e:testnet
//
// Needs a funded parent account (default patchbond-e2e.testnet, ~8 NEAR) in near-cli's legacy
// keychain or E2E_PARENT_KEY. Writes docs/e2e/testnet-report.md with an explorer link per tx.

import { curveBond, verifyRecord } from "@patchbond/shared";
import { Account, JsonRpcProvider, KeyPair, actions, encodeSignedDelegate, type KeyPairString } from "near-api-js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { judge, type JudgeInput } from "../src/judge/judge";
import { MockInference } from "../src/judge/nearai";
import { Relayer } from "../src/relayer";

const ROOT = resolve(import.meta.dir, "../..");
const RPC = process.env.E2E_RPC ?? "https://test.rpc.fastnear.com";
const PARENT = process.env.E2E_PARENT ?? "patchbond-e2e.testnet";
const RUN = process.env.E2E_CLEANUP_RUN ?? Date.now().toString(36);
// Every sub-account key is saved here before use, so a crashed run can always be cleaned up:
//   E2E_CLEANUP_RUN=<run> bun run e2e:testnet
const KEYS_DIR = join(resolve(import.meta.dir, ".."), "data", "e2e-keys");
const USDC = 1_000_000n;
const TGAS = 1_000_000_000_000n;
const NEAR = 10n ** 24n;
const ZERO_HASH = "0".repeat(64);

const provider = new JsonRpcProvider({ url: RPC });
const report: string[] = [];
const txs: { step: string; hash: string }[] = [];
let failures = 0;
let step = "";

// ---------- tiny harness ----------

function log(line: string) {
  console.log(line);
  report.push(line);
}

function section(title: string) {
  step = title;
  log(`\n### ${title}`);
}

function check(cond: boolean, what: string, detail = "") {
  if (cond) log(`- ✅ ${what}`);
  else {
    failures++;
    log(`- ❌ **${what}** ${detail}`);
  }
}

function eq<T>(actual: T, expected: T, what: string) {
  const j = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
  check(j(actual) === j(expected), what, `(expected ${String(expected)}, got ${String(actual)})`);
}

function parentKey(): string {
  if (process.env.E2E_PARENT_KEY) return process.env.E2E_PARENT_KEY;
  const f = join(homedir(), ".near-credentials", "testnet", `${PARENT}.json`);
  if (!existsSync(f)) throw new Error(`No key for ${PARENT}: create it with near-cli (sponsor-by-faucet-service) or set E2E_PARENT_KEY`);
  return JSON.parse(readFileSync(f, "utf8")).private_key;
}

interface Outcome {
  hash: string;
  /** First receipt panic message, if any (an ft_transfer_call can "succeed" with a refunded receipt). */
  panic: string | null;
}

type Raw = { transaction?: { hash: string }; transaction_outcome?: { id: string }; status?: unknown; receipts_outcome?: { outcome: { status: unknown } }[] };

function readOutcome(raw: Raw): Outcome {
  const hash = raw.transaction?.hash ?? raw.transaction_outcome?.id ?? "";
  const statuses = [raw.status, ...(raw.receipts_outcome ?? []).map((r) => r.outcome.status)];
  const panic = statuses
    .map((s) => (s && typeof s === "object" && "Failure" in s ? JSON.stringify((s as { Failure: unknown }).Failure) : null))
    .filter(Boolean)
    .map((f) => f!.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? f!)[0];
  return { hash, panic: panic ?? null };
}

class Actor {
  readonly account: Account;
  constructor(
    readonly id: string,
    readonly key: string,
  ) {
    this.account = new Account(id, provider, key as KeyPairString);
  }

  /** Calls and records the tx; never throws on a contract panic — returns it instead. */
  async call(contractId: string, methodName: string, args: object, opts: { deposit?: bigint; tgas?: bigint; label?: string } = {}): Promise<Outcome> {
    // Public RPCs drop connections now and then. Retry transport errors (never contract panics);
    // a retry after a tx that did land is harmless here because the contract rejects duplicates.
    for (let attempt = 1; ; attempt++) {
      const out = await this.callOnce(contractId, methodName, args, opts);
      const transport = out.panic !== null && !out.hash && /socket connection|fetch failed|ECONNRESET|ETIMEDOUT|timed out|Too Many Requests|"code": -429|HTTP 50[234]/i.test(out.panic);
      if (!transport || attempt === 3) return out;
      log(`- ↻ RPC hiccup on ${methodName} (${(out.panic ?? "").slice(0, 60)}), retrying…`);
      await Bun.sleep(1500 * attempt);
    }
  }

  private async callOnce(contractId: string, methodName: string, args: object, opts: { deposit?: bigint; tgas?: bigint; label?: string }): Promise<Outcome> {
    try {
      const raw = (await this.account.callFunctionRaw({
        contractId,
        methodName,
        args,
        gas: (opts.tgas ?? 150n) * TGAS,
        deposit: opts.deposit ?? 0n,
        waitUntil: "FINAL",
      })) as unknown as Raw;
      const o = readOutcome(raw);
      txs.push({ step: `${step}: ${opts.label ?? `${this.short} → ${methodName}`}`, hash: o.hash });
      return o;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      return { hash: "", panic: msg.match(/Smart contract panicked: ([^"\\\n]+)/)?.[1] ?? msg.slice(0, 300) };
    }
  }

  get short() {
    return this.id.split(".")[0]!;
  }
}

async function view<T>(contractId: string, method: string, args: object): Promise<T> {
  return (await provider.callFunction({ contractId, method, args: args as Record<string, unknown> })) as T;
}

// ---------- the run ----------

const parent = new Actor(PARENT, parentKey());
const created: Actor[] = [];

async function sub(prefix: string, near: string): Promise<Actor> {
  const kp = KeyPair.fromRandom("ed25519");
  const a = new Actor(`${prefix}-${RUN}.${PARENT}`, kp.toString());
  mkdirSync(KEYS_DIR, { recursive: true });
  appendFileSync(join(KEYS_DIR, `${RUN}.jsonl`), JSON.stringify({ id: a.id, key: kp.toString() }) + "\n");
  await parent.account.createSubAccount({ accountOrPrefix: `${prefix}-${RUN}`, publicKey: kp.getPublicKey(), nearToTransfer: (BigInt(Math.round(Number(near) * 1000)) * NEAR) / 1000n });
  created.push(a);
  return a;
}

function wasm(name: string): Uint8Array {
  const f = join(ROOT, "contract/target/near", name, `${name}.wasm`);
  if (!existsSync(f)) throw new Error(`${f} is missing — build it: cd contract && cargo near build non-reproducible-wasm --manifest-path ${name === "mock_ft" ? "mock-ft" : "vault"}/Cargo.toml`);
  return readFileSync(f);
}

async function cleanup(actors: Actor[]) {
  let deleted = 0;
  for (const a of actors) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await a.account.deleteAccount(PARENT);
        deleted++;
        break;
      } catch (e) {
        const msg = String((e as Error).message);
        if (/does not exist|doesn't exist|AccountDoesNotExist/i.test(msg)) break;
        if (attempt === 3) log(`- couldn't delete ${a.id}: ${msg.slice(0, 120)} — retry with E2E_CLEANUP_RUN=${RUN}`);
        else await Bun.sleep(2000 * attempt);
      }
    }
  }
  log(`- deleted ${deleted}/${actors.length} accounts; their NEAR went back to ${PARENT}`);
}

if (process.env.E2E_CLEANUP_RUN) {
  const f = join(KEYS_DIR, `${RUN}.jsonl`);
  const actors = readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; key: string }).map((k) => new Actor(k.id, k.key));
  await cleanup(actors.reverse());
  console.log(report.join("\n"));
  process.exit(0);
}

const started = Date.now();
log(`# PatchBond — end-to-end on NEAR testnet\n\nRun \`${RUN}\` · ${new Date().toISOString()} · RPC ${RPC} · parent \`${PARENT}\``);

try {
  section("1. Deploy a throwaway stack");
  const ft = await sub("usdc", "1.5");
  const vault = await sub("vault", "4");
  const [oracle, alice, bob, amaka, mike, agent] = await Promise.all(
    ["oracle", "alice", "bob", "amaka", "mike", "agent"].map((p) => sub(p, "0.3")),
  );
  await ft.account.deployContract(wasm("mock_ft"));
  await ft.call(ft.id, "new", {}, { tgas: 30n });
  await vault.account.deployContract(wasm("patchbond_vault"));
  const init = await vault.call(vault.id, "new", { owner: vault.id, oracle: oracle!.id, treasury: vault.id, token: ft.id }, { tgas: 30n });
  check(!init.panic, `vault ${vault.id} initialised with token ${ft.id}`, init.panic ?? "");
  for (const [who, amount] of [[vault, 0n], [alice, 100n], [bob, 20n], [amaka, 20n], [mike, 20n]] as const) {
    await ft.call(ft.id, "mint", { account_id: who!.id, amount: (amount * USDC).toString() }, { tgas: 30n, label: `mint ${amount} → ${who!.short}` });
  }
  const bal = async (a: Actor) => BigInt(await view<string>(ft.id, "ft_balance_of", { account_id: a.id }));
  eq(await bal(alice!), 100n * USDC, "alice holds 100 test USDC");

  const pay = (who: Actor, repo: number, number: number, amount: bigint, extra: object = {}) =>
    who.call(ft.id, "ft_transfer_call", {
      receiver_id: vault.id,
      amount: amount.toString(),
      msg: JSON.stringify({ action: "bond", repo_id: repo, number, kind: "pr", github_user: who.short, ...extra }),
    }, { deposit: 1n, label: `${who.short} pays bond on ${repo}#${number}` });
  const settle = (repo: number, number: number, verdict: string, hash = ZERO_HASH) =>
    oracle!.call(vault.id, "settle", { repo_id: repo, number, verdict, verdict_hash: hash }, { label: `oracle settles ${repo}#${number}: ${verdict}` });
  const quote = async (repo: number, who?: Actor) => BigInt(await view<string>(vault.id, "quote_bond", { repo_id: repo, account_id: who?.id ?? null }));
  const repoOf = (repo: number) => view<{ vault: string; open: number; policy: { target_open: number } & Record<string, unknown>; stats: Record<string, unknown> }>(vault.id, "get_repo", { repo_id: repo });
  const policy = (o: object) => ({
    enabled: true, base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 2,
    review_window_sec: 259200, challenge_window_sec: 0, forfeit_threshold_bps: 8500, ...o,
  });

  const R1 = 1_000_001, R2 = 1_000_002, R3 = 1_000_003;
  await oracle!.call(vault.id, "register_repo", { repo_id: R1, policy: policy({}) });
  await oracle!.call(vault.id, "register_repo", { repo_id: R2, policy: policy({ challenge_window_sec: 15 }) });
  await oracle!.call(vault.id, "register_repo", { repo_id: R3, policy: policy({ base_bond: "1000000", min_bond: "1000000", max_bond: "1000000" }) });
  check((await repoOf(R1)) !== null, "three repos registered by the oracle (instant, optimistic, flat-$1)");

  section("2. Attention pricing on-chain matches the web app's curve");
  const p1 = policy({});
  const quotes: bigint[] = [];
  for (let n = 1; n <= 4; n++) {
    const q = await quote(R1);
    quotes.push(q);
    eq(q, curveBond(p1, n - 1), `quote with ${n - 1} open = $${Number(q) / 1e6} — identical to shared/curve.ts`);
    const o = await pay(alice!, R1, n, q);
    check(!o.panic, `alice pays bond on #${n}`, o.panic ?? "");
  }
  check(quotes.every((q, i) => i === 0 || q > quotes[i - 1]!), `price rises with the queue: ${quotes.map((q) => `$${Number(q) / 1e6}`).join(" → ")}`);
  eq((await repoOf(R1)).open, 4, "four submissions open");

  section("3. Verdicts move money: refund, forfeit 90/10, void");
  const before = await bal(alice!);
  await settle(R1, 1, "refund");
  eq((await bal(alice!)) - before, quotes[0]!, "refund returns the whole bond to alice");
  await settle(R1, 2, "forfeit");
  const fee = quotes[1]! / 10n;
  eq(BigInt((await repoOf(R1)).vault), quotes[1]! - fee, "forfeit: 90% to the repo vault");
  eq(BigInt((await view<{ treasury_balance: string }>(vault.id, "get_config", {})).treasury_balance), fee, "forfeit: 10% to the treasury");
  // Say #4 is really bob's PR and alice paid by mistake: the oracle voids it.
  const b4 = await bal(alice!);
  await settle(R1, 4, "void");
  eq((await bal(alice!)) - b4, quotes[3]!, "void refunds the wrong payer in full");
  const bobPays = await pay(bob!, R1, 4, await quote(R1, bob!));
  check(!bobPays.panic, "after a void the real author (bob) can pay the same PR", bobPays.panic ?? "");
  eq((await view<{ github_user: string }>(vault.id, "get_deposit", { repo_id: R1, number: 4 })).github_user, bob!.short, "the slot now belongs to bob");

  section("4. Priority lane: tip earned only when reviewed in time");
  const tip = 3n * USDC;
  const b5 = await quote(R1, alice!);
  await pay(alice!, R1, 5, b5 + tip, { tip: tip.toString() });
  await oracle!.call(vault.id, "mark_reviewed", { repo_id: R1, number: 5 }, { label: "maintainer reviewed #5 (in window)" });
  const vaultBefore = BigInt((await repoOf(R1)).vault);
  await settle(R1, 5, "refund");
  eq(BigInt((await repoOf(R1)).vault) - vaultBefore, tip, "reviewed within 72 h → the $3 tip goes to the vault");
  const b6 = await quote(R1, alice!);
  const a6 = await bal(alice!);
  await pay(alice!, R1, 6, b6 + tip, { tip: tip.toString() });
  await settle(R1, 6, "refund");
  eq(await bal(alice!), a6, "never reviewed → bond and tip both come back");

  section("5. Slop funds the fix");
  const b7 = await quote(R1, alice!);
  await pay(alice!, R1, 7, b7, { fixes_issue: 99 });
  await settle(R1, 7, "forfeit");
  const bounty = BigInt(await view<string>(vault.id, "get_bounty", { repo_id: R1, issue: 99 }));
  eq(bounty, b7 - b7 / 10n, "the forfeited PR's 90% became a bounty on issue #99");
  const bobBefore = await bal(bob!);
  await oracle!.call(vault.id, "pay_bounty", { repo_id: R1, issue: 99, recipient: bob!.id }, { label: "real fix merged → pay bounty to bob" });
  eq((await bal(bob!)) - bobBefore, bounty, "bob, who really fixed #99, received the bounty");

  section("6. Only the linked maintainer can withdraw");
  await oracle!.call(vault.id, "link_repo", { repo_id: R1, payout: amaka!.id }, { label: "oracle links R1 → amaka" });
  const stolen = await bob!.call(vault.id, "withdraw", { repo_id: R1, amount: "1" }, { deposit: 1n });
  check(!!stolen.panic?.includes("Only the repo's linked payout account"), "bob can't withdraw R1's vault", stolen.panic ?? "(no error!)");
  const ownerTry = await vault.call(vault.id, "withdraw", { repo_id: R1, amount: "1" }, { deposit: 1n });
  check(!!ownerTry.panic, "the contract owner can't withdraw it either", ownerTry.panic ?? "(no error!)");
  const v1 = BigInt((await repoOf(R1)).vault);
  const am = await bal(amaka!);
  await amaka!.call(vault.id, "withdraw", { repo_id: R1, amount: v1.toString() }, { deposit: 1n, label: "amaka withdraws the vault" });
  eq((await bal(amaka!)) - am, v1, `amaka withdrew $${Number(v1) / 1e6}`);

  section("7. Bad input is refunded with a reason");
  const a8 = await bal(alice!);
  const under = await pay(alice!, R1, 8, 1000n);
  check(!!under.panic?.includes("the transfer was refunded"), `underpaying says why: “${under.panic?.slice(0, 90)}…”`);
  const dup = await pay(alice!, R1, 1, 10n * USDC);
  check(!!dup.panic?.includes("already has a deposit"), "a second deposit on a settled PR is refused");
  const fake = await alice!.call(vault.id, "ft_on_transfer", { sender_id: alice!.id, amount: "50000000", msg: JSON.stringify({ action: "bond", repo_id: R1, number: 9, kind: "pr", github_user: "x" }) });
  check(!!fake.panic?.includes("only accepts"), "calling ft_on_transfer directly can't fake a deposit");
  eq(await bal(alice!), a8, "alice lost nothing on any of these");

  section("7b. Gasless: a contributor with no spare NEAR pays through the relayer (NEP-366)");
  const broke = await sub("gasless", "0.01");
  await ft.call(ft.id, "mint", { account_id: broke.id, amount: (5n * USDC).toString() }, { tgas: 30n, label: "mint 5 → gasless" });
  const nearBefore = BigInt((await provider.viewAccount({ accountId: broke.id })).amount);
  const gq = await quote(R1, broke);
  const meta = await broke.account.createSignedMetaTransaction({
    receiverId: ft.id,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        { receiver_id: vault.id, amount: gq.toString(), msg: JSON.stringify({ action: "bond", repo_id: R1, number: 20, kind: "pr", github_user: broke.short }) },
        150n * TGAS,
        1n,
      ),
    ],
  });
  const relayer = new Relayer(oracle!.id, oracle!.key, provider, ft.id, vault.id);
  const relayed = await relayer.relay(Buffer.from(encodeSignedDelegate(meta.signedDelegate)).toString("base64"));
  txs.push({ step: `${step}: relayer submits the signed delegate`, hash: relayed.hash });
  const gd = await view<{ payer: string } | null>(vault.id, "get_deposit", { repo_id: R1, number: 20 });
  eq(gd?.payer, broke.id, "the bond was paid by the gasless account");
  const nearAfter = BigInt((await provider.viewAccount({ accountId: broke.id })).amount);
  check(nearBefore - nearAfter <= 1n, `the contributor spent ${nearBefore - nearAfter} yoctoNEAR — the relayer paid the gas`);
  let refused = "";
  try {
    const bad = await broke.account.createSignedMetaTransaction({ receiverId: ft.id, actions: [actions.functionCall("ft_transfer", { receiver_id: broke.id, amount: "1" }, 30n * TGAS, 1n)] });
    await relayer.relay(Buffer.from(encodeSignedDelegate(bad.signedDelegate)).toString("base64"));
  } catch (e) {
    refused = (e as Error).message;
  }
  check(refused.includes("Only ft_transfer_call"), "the relayer refuses to pay gas for anything but bond payments");
  await settle(R1, 20, "refund");

  section("8. Optimistic verdicts: challenge and finalize, with a real 15-second window");
  await oracle!.call(vault.id, "link_repo", { repo_id: R2, payout: amaka!.id });
  const c1 = await quote(R2, alice!);
  const a9 = await bal(alice!);
  await pay(alice!, R2, 1, c1);
  await settle(R2, 1, "forfeit");
  const s1 = (await view<{ status: object }>(vault.id, "get_deposit", { repo_id: R2, number: 1 })).status;
  check("proposed" in s1, "the AI's forfeit is only proposed");
  const ch = await alice!.call(ft.id, "ft_transfer_call", { receiver_id: vault.id, amount: c1.toString(), msg: JSON.stringify({ action: "challenge", repo_id: R2, number: 1 }) }, { deposit: 1n, label: "alice stakes to challenge" });
  check(!ch.panic, "alice challenges by staking the bond", ch.panic ?? "");
  await oracle!.call(vault.id, "resolve_challenge", { repo_id: R2, number: 1, verdict: "refund", verdict_hash: ZERO_HASH }, { label: "stronger model overturns → refund" });
  eq(await bal(alice!), a9, "overturned: alice got bond + stake back");
  const c2 = await quote(R2, alice!);
  await pay(alice!, R2, 2, c2);
  await settle(R2, 2, "refund");
  const early = await bob!.call(vault.id, "finalize", { repo_id: R2, number: 2 });
  check(!!early.panic?.includes("still open"), "finalize is refused while the window is open");
  log("- ⏳ waiting 18 s of real testnet time for the challenge window…");
  await Bun.sleep(18_000);
  const fin = await bob!.call(vault.id, "finalize", { repo_id: R2, number: 2 }, { label: "bob (anyone) finalizes after the window" });
  check(!fin.panic, "anyone can finalize once the window passes", fin.panic ?? "");
  eq(await bal(alice!), a9, "the refund verdict stood: alice is whole");

  section("9. Agents: a capped budget and a function-call key");
  await mike!.call(ft.id, "ft_transfer_call", { receiver_id: vault.id, amount: (10n * USDC).toString(), msg: JSON.stringify({ action: "fund_budget", agent: agent!.id, daily_cap: "2500000" }) }, { deposit: 1n, label: "mike funds a 10 USDC budget, cap 2.5/day" });
  const fck = KeyPair.fromRandom("ed25519");
  await agent!.account.addFunctionCallAccessKey({ publicKey: fck.getPublicKey(), contractId: vault.id, methodNames: ["deposit_from_budget"], allowance: NEAR / 4n });
  const bot = new Actor(agent!.id, fck.toString());
  const passport = { operator: mike!.id, harness: "claude-code", model: "claude-opus-5-5" };
  const agentPay = (n: number) => bot.call(vault.id, "deposit_from_budget", { repo_id: R3, number: n, kind: "pr", github_user: "mikes-bot", passport }, { tgas: 50n, label: `agent (function-call key) pays bond on R3#${n}` });
  // The real MCP server, spawned like Claude Code would, holding only the function-call key.
  // A stub API serves the network config and stands in for GitHub (PR acme/widget#1 → repo R3).
  const stub = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url).pathname;
      if (u === "/api/config") return Response.json({ network: "testnet", rpc: RPC, contract: vault.id, token: ft.id });
      if (u.startsWith("/api/submissions/")) return Response.json({ verdicts: [] });
      if (u === "/gh/repos/acme/widget") return Response.json({ id: R3, full_name: "acme/widget" });
      if (u === "/gh/repos/acme/widget/pulls/1") return Response.json({ user: { login: "mikes-bot" }, state: "open", title: "Fix", body: "" });
      return new Response("no", { status: 404 });
    },
  });
  const mcp = new Client({ name: "e2e", version: "0" });
  await mcp.connect(
    new StdioClientTransport({
      command: "bun",
      args: [join(ROOT, "mcp/src/index.ts")],
      env: {
        ...process.env,
        PATCHBOND_API: `http://localhost:${stub.port}`,
        PATCHBOND_GITHUB_API: `http://localhost:${stub.port}/gh`,
        PATCHBOND_AGENT_ACCOUNT: agent!.id,
        PATCHBOND_AGENT_KEY: fck.toString(),
        PATCHBOND_OPERATOR: mike!.id,
        PATCHBOND_HARNESS: "claude-code",
        PATCHBOND_MODEL: "claude-opus-5-5",
      } as Record<string, string>,
    }),
  );
  const viaMcp = await mcp.callTool({ name: "patchbond_deposit", arguments: { pr_url: "https://github.com/acme/widget/pull/1" } });
  const paid = viaMcp.structuredContent as { paid?: boolean; bond_usdc?: string; tx?: string; budget_left_today_usdc?: string } | undefined;
  check(!viaMcp.isError && paid?.paid === true, `MCP patchbond_deposit paid $${paid?.bond_usdc} on testnet with the function-call key`, JSON.stringify(viaMcp.content).slice(0, 200));
  if (paid?.tx) txs.push({ step: `${step}: agent pays via the MCP server`, hash: paid.tx.split("/").pop()! });
  eq(paid?.budget_left_today_usdc, "1.50", "MCP reports $1.50 left today");
  const mcpBudget = (await mcp.callTool({ name: "patchbond_budget", arguments: {} })).structuredContent as { balance_usdc: string };
  eq(mcpBudget.balance_usdc, "9.00", "MCP patchbond_budget reads the on-chain budget");
  await mcp.close();
  stub.stop(true);
  check(!(await agentPay(2)).panic, "agent pays another $1 directly with the same key");
  const over = await agentPay(3);
  check(!!over.panic?.includes("Daily cap reached"), `third bond refused by the contract: “${over.panic?.slice(0, 70)}…”`);
  const escape = await bot.call(ft.id, "ft_transfer", { receiver_id: bot.id, amount: "1" }, { deposit: 1n });
  check(!!escape.panic, "the key can't touch the token contract", escape.panic?.slice(0, 80) ?? "(it could!)");
  const drain = await bot.call(vault.id, "withdraw_budget", { agent: agent!.id, amount: "1000000" }, { deposit: 1n });
  check(!!drain.panic, "the key can't call any other PatchBond method", drain.panic?.slice(0, 80) ?? "(it could!)");
  await settle(R3, 1, "refund");
  await settle(R3, 2, "forfeit");
  const budget = await view<{ balance: string; spent_today: string }>(vault.id, "get_budget", { agent: agent!.id });
  eq(BigInt(budget.balance), 9n * USDC, "refund went back into the budget (10 − 2 + 1)");
  const hs = await view<{ deposits: number; refunds: number; forfeits: number }>(vault.id, "get_harness_stats", { harness: "claude-code" });
  eq([hs.deposits, hs.refunds, hs.forfeits], [2, 1, 1], "claude-code's public record: 2 bonds, 1 refunded, 1 forfeited");
  const mk = await bal(mike!);
  await mike!.call(vault.id, "withdraw_budget", { agent: agent!.id, amount: (9n * USDC).toString() }, { deposit: 1n, label: "mike withdraws the rest" });
  eq((await bal(mike!)) - mk, 9n * USDC, "mike took the remaining budget back");

  section("10. Judge → chain: a signed verdict's hash lands on-chain");
  const input: JudgeInput = {
    repo: { id: R1, full_name: "PatchBond/e2e" },
    author: "alice",
    contribution: { kind: "pr", number: 10, title: "Harden parser", body: "Improves robustness.", diff: "+  parse_with_validation(s);", files: ["src/parse.c"], additions: 1, deletions: 0 },
    checkRuns: [{ name: "build", status: "completed", conclusion: "failure" }],
    openItems: [],
    symbolIndex: async () => ({ has: (s) => s.startsWith("parse_") && s !== "parse_with_validation", namespaceSize: () => 9 }),
    issueLookup: async () => ({ exists: false, open: false }),
    authorReputation: "new",
    threshold: 0.85,
  };
  const record = await judge(input, new MockInference());
  eq(record.final.verdict, "forfeit", "judge forfeits a PR that calls a made-up parse_* function");
  await pay(alice!, R1, 10, await quote(R1, alice!));
  await settle(R1, 10, record.final.verdict, record.verdict_hash);
  const onchain = await view<{ verdict_hash: string }>(vault.id, "get_deposit", { repo_id: R1, number: 10 });
  eq(onchain.verdict_hash, record.verdict_hash, "the deposit on-chain carries the record's verdict_hash");
  check((await verifyRecord(record)).every((c) => c.ok), "the record verifies (hashes + signer + on-chain hash)");

  section("11. Reputation follows the account");
  const rep = await view<{ refunds: number; forfeits: number; refund_repos: number[] }>(vault.id, "get_reputation", { account_id: alice!.id });
  log(`- alice: ${rep.refunds} refunds on ${rep.refund_repos.length} repos, ${rep.forfeits} forfeits`);
  const mult = BigInt(1 + Math.min(rep.forfeits, 3));
  eq(await quote(R1, alice!), curveBond(p1, (await repoOf(R1)).open) * mult, `recent forfeits → alice pays ×${mult}`);

  section("12. Conservation: every USDC unit is accounted for");
  const contractBal = await bal(vault);
  const totals = await view<{ held: string }>(vault.id, "get_totals", {});
  const inVaults = (await Promise.all([R1, R2, R3].map(repoOf))).reduce((s, r) => s + BigInt(r.vault), 0n);
  const treasury = BigInt((await view<{ treasury_balance: string }>(vault.id, "get_config", {})).treasury_balance);
  const budgets = BigInt((await view<{ balance: string }>(vault.id, "get_budget", { agent: agent!.id })).balance);
  const claim = BigInt(await view<string>(vault.id, "get_claimable", { account_id: alice!.id }));
  eq(contractBal, BigInt(totals.held) + inVaults + treasury + budgets + claim, `contract holds exactly held + vaults + treasury + budgets ($${Number(contractBal) / 1e6})`);
  const supply = BigInt(await view<string>(ft.id, "ft_total_supply", {}));
  const everyone = (await Promise.all([vault, alice!, bob!, amaka!, mike!, agent!, broke].map(bal))).reduce((s, b) => s + b, 0n);
  eq(everyone, supply, "no USDC created or destroyed across all accounts");
} catch (e) {
  failures++;
  log(`\n❌ **Run aborted:** ${(e as Error).stack ?? e}`);
} finally {
  section("Cleanup");
  await cleanup([...created].reverse());
}

const secs = Math.round((Date.now() - started) / 1000);
log(`\n---\n**${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}** in ${secs} s · ${txs.length} transactions`);
report.push("\n## Transactions\n", ...txs.map((t) => `- [${t.step}](https://testnet.nearblocks.io/txns/${t.hash})`));
mkdirSync(join(ROOT, "docs/e2e"), { recursive: true });
writeFileSync(join(ROOT, "docs/e2e/testnet-report.md"), report.join("\n") + "\n");
console.log(`report: docs/e2e/testnet-report.md`);
process.exit(failures === 0 ? 0 : 1);
