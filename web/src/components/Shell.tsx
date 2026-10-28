import { Command, LogOut } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GITHUB_ORG_URL, useConfig } from "../lib/config";
import { useWallet } from "../lib/wallet";
import { CommandPalette } from "./CommandPalette";
import { Button, Mark } from "./kit";

export function Shell({ children }: { children: ReactNode }) {
  const cfg = useConfig();
  const loc = useLocation();
  const [palette, setPalette] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col">
        {cfg.network === "testnet" && (
          <div className="border-b border-line bg-raised/70 px-4 py-1.5 text-center text-xs text-muted-foreground">
            <b className="text-ink">Testnet</b> · test USDC from{" "}
            <a className="text-brand underline-offset-2 hover:underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
              faucet.circle.com
            </a>{" "}
            (“Near Testnet”) · use Meteor or Intear wallet
          </div>
        )}
        <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
              <motion.span whileHover={{ rotate: -12, scale: 1.08 }} transition={{ type: "spring", stiffness: 400, damping: 12 }}>
                <Mark size={26} />
              </motion.span>
              <span>
                Patch<span className="text-brand">Bond</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
              {[
                ["/#how", "How it works"],
                ["/#verdicts", "Verdicts"],
              ].map(([href, label]) => (
                <a key={href} href={href} className="rounded-lg px-2.5 py-1.5 hover:bg-raised hover:text-ink">
                  {label}
                </a>
              ))}
              <NavLink to="/agents" className={({ isActive }) => `rounded-lg px-2.5 py-1.5 hover:bg-raised hover:text-ink ${isActive ? "text-ink" : ""}`}>
                Agents
              </NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setPalette(true)}
                    className="hidden items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-xs text-muted-foreground hover:bg-raised hover:text-ink md:flex"
                  >
                    Judge a PR…
                    <kbd className="flex items-center gap-0.5 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px]">
                      <Command className="size-3" />K
                    </kbd>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Paste any public PR URL to judge it</TooltipContent>
              </Tooltip>
              <WalletButton />
            </div>
          </div>
        </header>
        <main className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={loc.pathname}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
              transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
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
        <CommandPalette open={palette} onOpenChange={setPalette} />
        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </TooltipProvider>
  );
}

function WalletButton() {
  const { accountId, connect, disconnect, connecting } = useWallet();
  if (accountId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={() => void disconnect()} className="group flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-raised">
            <span className="size-2 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />
            <span className="max-w-36 truncate font-mono text-xs">{accountId}</span>
            <LogOut className="hidden size-3.5 text-faint group-hover:block" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Disconnect</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button variant="ghost" className="py-1.5" onClick={() => void connect()} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
