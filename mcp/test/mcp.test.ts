import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { KeyPair } from "near-api-js";
import { join } from "node:path";
import { PatchBond, PatchBondError } from "../src/client";
import { defaultWorld, startFakeWorld, type World } from "./fakeworld";

const agentKey = KeyPair.fromRandom("ed25519").toString();
let world: World;
let fake: ReturnType<typeof startFakeWorld>;

beforeAll(() => {
  world = defaultWorld();
  fake = startFakeWorld(world);
});
afterAll(() => fake.stop());

const client = (agent = true) =>
  new PatchBond({
    api: fake.url,
    githubApi: `${fake.url}/gh`,
    agent: agent ? { accountId: "agent.testnet", key: agentKey } : undefined,
    passport: { operator: "mike.testnet", harness: "claude-code", model: "m" },
  });

describe("client", () => {
  test("policy: price, queue and advice for a PatchBond repo", async () => {
    const p = await client().policy("https://github.com/acme/widget/pull/7");
    expect(p).toMatchObject({ repo: "acme/widget", repo_id: 42, uses_patchbond: true, bond_usdc: "2.25", you_are_exempt: false });
    expect(p.queue).toEqual({ open: 9, capacity: 8, next_bond_if_one_more_usdc: "2.53" });
    expect(p.advice).toContain("patchbond_preflight");
  });

  test("policy: a repo without PatchBond needs no deposit", async () => {
    expect(await client().policy("acme/quiet")).toMatchObject({ uses_patchbond: false });
  });

  test("budget: what's left today is min(cap − spent, balance)", async () => {
    expect(await client().budget()).toMatchObject({ balance_usdc: "10.00", daily_cap_usdc: "2.50", spent_today_usdc: "1.00", left_today_usdc: "1.50" });
  });

  test("no agent wallet → a clear message, not a crash", async () => {
    await expect(client(false).budget()).rejects.toThrow("PATCHBOND_AGENT_ACCOUNT");
  });

  test("bad input says what was expected", async () => {
    await expect(client().policy("not a repo!")).rejects.toBeInstanceOf(PatchBondError);
    await expect(client().deposit("https://github.com/acme/widget")).rejects.toThrow("isn't a pull request URL");
  });
});

describe("key safety", () => {
  test("a function-call key limited to deposit_from_budget is accepted", async () => {
    world.keyPermission = { FunctionCall: { allowance: null, receiver_id: "pb.testnet", method_names: ["deposit_from_budget"] } };
    await expect(client().assertSafeKey()).resolves.toBeUndefined();
  });

  test("a full-access key is refused", async () => {
    world.keyPermission = "FullAccess";
    await expect(client().assertSafeKey()).rejects.toThrow("FULL-ACCESS");
  });

  test("a key for another contract or for every method is refused", async () => {
    world.keyPermission = { FunctionCall: { allowance: null, receiver_id: "evil.testnet", method_names: ["deposit_from_budget"] } };
    await expect(client().assertSafeKey()).rejects.toThrow("must be limited");
    world.keyPermission = { FunctionCall: { allowance: null, receiver_id: "pb.testnet", method_names: [] } };
    await expect(client().assertSafeKey()).rejects.toThrow("every method");
    world.keyPermission = defaultWorld().keyPermission;
  });
});

describe("over the MCP protocol (stdio, like Claude Code runs it)", () => {
  async function connect(extraEnv: Record<string, string> = {}) {
    const transport = new StdioClientTransport({
      command: "bun",
      args: [join(import.meta.dir, "../src/index.ts")],
      env: { ...process.env, PATCHBOND_API: fake.url, PATCHBOND_GITHUB_API: `${fake.url}/gh`, ...extraEnv } as Record<string, string>,
      stderr: "pipe",
    });
    const c = new Client({ name: "test", version: "0" });
    await c.connect(transport);
    return c;
  }

  test("exposes seven tools with safety annotations and a prompt", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "patchbond_appeal", "patchbond_budget", "patchbond_deposit", "patchbond_policy",
      "patchbond_preflight", "patchbond_reputation", "patchbond_status",
    ]);
    expect(tools.find((t) => t.name === "patchbond_policy")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "patchbond_deposit")?.annotations?.readOnlyHint).toBe(false);
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("contribute_responsibly");
    await c.close();
  });

  test("tools answer with structured content; errors are readable", async () => {
    const c = await connect();
    const ok = await c.callTool({ name: "patchbond_preflight", arguments: { pr_url: "https://github.com/acme/widget/pull/7" } });
    expect((ok.structuredContent as { risk: string }).risk).toBe("high");
    const bad = await c.callTool({ name: "patchbond_budget", arguments: {} });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("PATCHBOND_AGENT_ACCOUNT");
    await c.close();
  });

  test("the server refuses to start with a full-access key", async () => {
    world.keyPermission = "FullAccess";
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/index.ts")], {
      env: { ...process.env, PATCHBOND_API: fake.url, PATCHBOND_AGENT_ACCOUNT: "agent.testnet", PATCHBOND_AGENT_KEY: agentKey },
      stdin: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const err = await new Response(proc.stderr).text();
    world.keyPermission = defaultWorld().keyPermission;
    expect(code).toBe(1);
    expect(err).toContain("FULL-ACCESS");
  });
});
