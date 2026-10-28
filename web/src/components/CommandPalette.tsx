// ⌘K: paste a PR URL to judge it, jump to a verdict or a page.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Gavel, Home, Bot, ScrollText, ShieldCheck, Wallet } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useWallet } from "@/lib/wallet";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNavigate();
  const wallet = useWallet();
  const [q, setQ] = useState("");
  const { data: verdicts } = useAsync(() => (open ? api.verdicts(8) : Promise.resolve([])), [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const isPr = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(q);
  const go = (to: string) => {
    onOpenChange(false);
    setQ("");
    nav(to);
  };

  async function judge() {
    const url = q.trim();
    onOpenChange(false);
    setQ("");
    const id = toast.loading("Judging — reading the diff, CI and the repo's code…");
    try {
      const r = await api.judge(url);
      toast.success(`Verdict: ${r.verdict.replace("_", " ")}`, { id, description: "Opening the signed record" });
      nav(`/v/${r.id}`);
    } catch (e) {
      toast.error("Couldn't judge it", { id, description: (e as Error).message });
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="PatchBond" description="Judge a PR or jump anywhere">
      <CommandInput value={q} onValueChange={setQ} placeholder="Paste a GitHub PR URL, or search…" />
      <CommandList>
        <CommandEmpty>Nothing matches. Paste a full PR URL to judge it.</CommandEmpty>
        {isPr && (
          <CommandGroup heading="Judge">
            <CommandItem value={`judge ${q}`} onSelect={() => void judge()}>
              <Gavel className="text-brand" /> Judge <span className="truncate font-mono text-xs text-muted-foreground">{q}</span>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go("/")}>
            <Home /> Home
          </CommandItem>
          <CommandItem onSelect={() => go("/agents")}>
            <Bot /> Agent passports
          </CommandItem>
          <CommandItem onSelect={() => go("/#verdicts")}>
            <ScrollText /> Public verdicts
          </CommandItem>
          {!wallet.accountId && (
            <CommandItem
              onSelect={() => {
                onOpenChange(false);
                void wallet.connect();
              }}
            >
              <Wallet /> Connect a NEAR wallet
            </CommandItem>
          )}
        </CommandGroup>
        {!!verdicts?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent verdicts">
              {verdicts.map((v) => (
                <CommandItem key={v.id} value={`${v.repo.full_name} ${v.number} ${v.final.verdict}`} onSelect={() => go(`/v/${v.id}`)}>
                  <ShieldCheck className={v.final.verdict === "refund" ? "text-brand" : v.final.verdict === "forfeit" ? "text-danger" : "text-warn"} />
                  <span className="truncate">
                    {v.repo.full_name}#{v.number}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{v.final.verdict.replace("_", " ")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
