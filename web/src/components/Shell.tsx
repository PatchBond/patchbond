import { Check, ChevronDown, Command, Copy, Droplets, LogOut } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GITHUB_ORG_URL, useConfig } from "../lib/config";
import { useWallet } from "../lib/wallet";
import { CommandPalette } from "./CommandPalette";
import { FaucetDialog } from "./Faucet";
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
            <b className="text-ink">Testnet</b> — nothing here is real money · use Meteor or Intear wallet ·{" "}
            <FaucetDialog trigger={<button className="font-medium text-brand underline-offset-2 hover:underline">Get test funds</button>} />
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
              {(
                [
                  ["/how", "How it works"],
                  ["/verdicts", "Verdicts"],
                ] as const
              ).map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-2.5 py-1.5 hover:bg-raised hover:text-ink ${isActive ? "text-ink" : ""}`}>
                  {label}
                </NavLink>
              ))}
              <NavLink to="/agents" className={({ isActive }) => `rounded-lg px-2.5 py-1.5 hover:bg-raised hover:text-ink ${isActive ? "text-ink" : ""}`}>
                Agents
              </NavLink>
              <NavLink to="/dashboard" className={({ isActive }) => `rounded-lg px-2.5 py-1.5 hover:bg-raised hover:text-ink ${isActive ? "text-ink" : ""}`}>
                Maintainers
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
          {/* Phones: the same links on a second row (the desktop nav and ⌘K button are hidden there). */}
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm text-muted-foreground sm:hidden">
            {(
              [
                ["/how", "How it works"],
                ["/verdicts", "Verdicts"],
                ["/agents", "Agents"],
                ["/dashboard", "Maintainers"],
              ] as const
            ).map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => `shrink-0 rounded-lg px-2.5 py-1.5 hover:bg-raised hover:text-ink ${isActive ? "text-ink" : ""}`}>
                {label}
              </NavLink>
            ))}
            <button onClick={() => setPalette(true)} className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-ink">
              Judge a PR
            </button>
          </nav>
        </header>
        <main className="flex-1">
          {/* initial={false}: the first paint never waits on an animation (screenshots, slow devices). */}
          <AnimatePresence mode="wait" initial={false}>
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
  const cfg = useConfig();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [faucet, setFaucet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (accountId) {
    async function copy() {
      try {
        await navigator.clipboard.writeText(accountId!);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.error("Couldn't copy", { description: accountId! });
      }
    }
    const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-raised";
    return (
      <div ref={ref} className="relative">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-raised">
          <span className="size-2 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />
          <span className="max-w-36 truncate font-mono text-xs">{accountId}</span>
          <ChevronDown className="size-3.5 text-faint" />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-line bg-panel p-2 shadow-2xl">
            <div className="break-all px-3 pb-2 pt-1 font-mono text-xs text-muted-foreground">{accountId}</div>
            <button className={item} onClick={() => void copy()}>
              {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy address"}
            </button>
            {cfg.network === "testnet" && (
              <button className={item} onClick={() => { setOpen(false); setFaucet(true); }}>
                <Droplets className="size-4" /> Get test funds
              </button>
            )}
            <button className={`${item} text-danger`} onClick={() => { setOpen(false); void disconnect(); }}>
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
        )}
        <FaucetDialog open={faucet} onOpenChange={setFaucet} />
      </div>
    );
  }
  return (
    <Button variant="ghost" className="py-1.5" onClick={() => void connect()} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
