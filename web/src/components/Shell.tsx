import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { useConfig, GITHUB_ORG_URL } from "../lib/config";
import { useWallet } from "../lib/wallet";
import { Button, Mark } from "./ui";

export function Shell({ children }: { children: ReactNode }) {
  const cfg = useConfig();
  return (
    <div className="flex min-h-screen flex-col">
      {cfg.network === "testnet" && (
        <div className="border-b border-line bg-raised px-4 py-1.5 text-center text-xs text-muted">
          <b className="text-ink">Testnet</b> — test USDC only. Get some at{" "}
          <a className="text-accent underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
            faucet.circle.com
          </a>{" "}
          (choose “Near Testnet”). Use Meteor or Intear wallet; HOT works on mainnet.
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <Mark size={26} />
            <span>
              Patch<span className="text-accent">Bond</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted sm:flex">
            <a href="/#how" className="hover:text-ink">
              How it works
            </a>
            <a href="/#verdicts" className="hover:text-ink">
              Verdicts
            </a>
            <NavLink to="/agents" className={({ isActive }) => (isActive ? "text-ink" : "hover:text-ink")}>
              Agents
            </NavLink>
          </nav>
          <div className="ml-auto">
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-sm text-faint">
          <span className="flex items-center gap-2">
            <Mark size={18} /> PatchBond — a market for maintainer attention
          </span>
          <span className="num">
            {cfg.network} · <span className="font-mono">{cfg.contract}</span>
          </span>
          <a className="hover:text-ink sm:ml-auto" href={GITHUB_ORG_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span>MIT · No token. Never pays anyone for submitting.</span>
        </div>
      </footer>
    </div>
  );
}

function WalletButton() {
  const { accountId, connect, disconnect, connecting } = useWallet();
  if (accountId) {
    return (
      <button onClick={() => void disconnect()} title="Disconnect" className="group flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-raised">
        <span className="size-2 rounded-full bg-accent" />
        <span className="max-w-36 truncate font-mono text-xs">{accountId}</span>
        <span className="hidden text-faint group-hover:inline">×</span>
      </button>
    );
  }
  return (
    <Button variant="ghost" className="py-1.5" onClick={() => void connect()} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
