// A fake PatchBond API + NEAR RPC + GitHub in one Bun server, for testing the MCP server offline.

export interface World {
  keyPermission: unknown;
  repos: Record<number, unknown>;
  quote: string;
  exempt: boolean;
  budget: unknown;
  budgetPolicy: unknown;
  deposits: Record<string, unknown>;
}

export function defaultWorld(): World {
  return {
    keyPermission: { FunctionCall: { allowance: null, receiver_id: "pb.testnet", method_names: ["deposit_from_budget"] } },
    repos: {
      42: {
        payout: "maintainer.testnet",
        open: 9,
        vault: "0",
        policy: { enabled: true, base_bond: "2000000", min_bond: "250000", max_bond: "50000000", target_open: 8, review_window_sec: 259200, challenge_window_sec: 259200, forfeit_threshold_bps: 8500 },
      },
    },
    quote: "2250000",
    exempt: false,
    budget: { owner: "mike.testnet", balance: "10000000", daily_cap: "2500000", spent_today: "1000000", day: Math.floor(Date.now() / 86_400_000) },
    budgetPolicy: null,
    deposits: {},
  };
}

export function startFakeWorld(world: World) {
  const enc = (v: unknown) => ({ result: [...new TextEncoder().encode(JSON.stringify(v))], logs: [], block_height: 1, block_hash: "11111111111111111111111111111111" });
  let port = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const base = `http://localhost:${port}`;
      if (url.pathname === "/api/config") {
        return Response.json({ network: "testnet", rpc: `${base}/rpc`, contract: "pb.testnet", token: "usdc.testnet" });
      }
      if (url.pathname === "/api/preflight") {
        return Response.json({ repo_id: 42, author: "bot", risk: "high", likely: "forfeit", warnings: ["Calls widget_frobnicate, which the repository doesn't define."] });
      }
      if (url.pathname.startsWith("/api/submissions/")) return Response.json({ verdicts: [] });
      if (url.pathname === "/gh/repos/acme/widget") return Response.json({ id: 42, full_name: "acme/widget" });
      if (url.pathname === "/gh/repos/acme/quiet") return Response.json({ id: 43, full_name: "acme/quiet" });
      if (url.pathname === "/gh/repos/acme/widget/pulls/7") return Response.json({ user: { login: "bot" }, state: "open", title: "t", body: "" });
      if (url.pathname === "/rpc") {
        const body = (await req.json()) as { id: unknown; params: { request_type: string; method_name?: string; args_base64?: string } };
        const p = body.params;
        if (p.request_type === "view_access_key") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: { nonce: 1, permission: world.keyPermission, block_height: 1, block_hash: "11111111111111111111111111111111" } });
        }
        const args = JSON.parse(atob(p.args_base64 ?? "") || "{}");
        const views: Record<string, () => unknown> = {
          get_repo: () => world.repos[args.repo_id] ?? null,
          quote_bond: () => world.quote,
          is_exempt: () => world.exempt,
          get_budget: () => world.budget,
          get_budget_policy: () => world.budgetPolicy,
          get_deposit: () => world.deposits[`${args.repo_id}/${args.number}`] ?? null,
          get_reputation: () => ({ refunds: 1, forfeits: 0, last_forfeit_at: null, refund_repos: [42] }),
          get_agent_stats: () => ({ deposits: 1, refunds: 1, forfeits: 0 }),
          get_harness_stats: () => ({ deposits: 10, refunds: 8, forfeits: 2 }),
        };
        const f = views[p.method_name ?? ""];
        if (!f) return Response.json({ jsonrpc: "2.0", id: body.id, error: { message: `fake rpc: unknown ${p.method_name}` } });
        return Response.json({ jsonrpc: "2.0", id: body.id, result: enc(f()) });
      }
      return new Response("not found", { status: 404 });
    },
  });
  port = server.port ?? 0;
  return { url: `http://localhost:${port}`, stop: () => server.stop(true) };
}
