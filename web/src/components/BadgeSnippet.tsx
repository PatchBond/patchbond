// "Protected by PatchBond" README badge: live preview + the Markdown to paste, one click to copy.

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function BadgeSnippet({ repoId, compact = false }: { repoId: number; compact?: boolean }) {
  const origin = window.location.origin;
  const markdown = `[![Protected by PatchBond](${origin}/badge/${repoId}.svg)](${origin}/r/${repoId})`;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy", { description: markdown });
    }
  }
  return (
    <div className={`rounded-xl border border-line bg-bg ${compact ? "p-3" : "p-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">README badge</div>
          {!compact && <div className="text-xs text-muted-foreground">Shows contributors the live bond and refunds before they open a PR.</div>}
        </div>
        <img src={`/badge/${repoId}.svg`} alt="PatchBond badge" className="h-5" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-raised px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">{markdown}</code>
        <button onClick={() => void copy()} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-raised">
          {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
