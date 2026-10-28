import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/** The PatchBond mark: a git branch merging into a ridged coin with a check. Ink follows the theme. */
export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const ridges = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return [340 + 66 * Math.cos(a), 238 + 66 * Math.sin(a), 340 + 78 * Math.cos(a), 238 + 78 * Math.sin(a)];
  });
  return (
    <svg viewBox="40 90 420 340" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="30" strokeLinecap="round">
        <line x1="178" y1="182" x2="178" y2="330" />
        <path d="M178 330 C178 262 230 238 262 238" />
      </g>
      <circle cx="178" cy="140" r="36" fill="none" stroke="currentColor" strokeWidth="28" />
      <circle cx="178" cy="372" r="36" fill="none" stroke="currentColor" strokeWidth="28" />
      <circle cx="340" cy="238" r="80" fill="var(--accent)" />
      <g stroke="var(--accent-ink)" strokeWidth="5" opacity="0.4">
        {ridges.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <path d="M313 240 L333 260 L369 222" fill="none" stroke="var(--accent-ink)" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Variant = "primary" | "ghost" | "danger" | "quiet";

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:brightness-110 shadow-[0_1px_0_rgba(255,255,255,.15)_inset]",
    ghost: "border border-line text-ink hover:bg-raised",
    danger: "border border-danger/40 text-danger hover:bg-danger-soft",
    quiet: "text-muted hover:text-ink",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-panel ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">{children}</div>;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "ok"; title?: string; children: ReactNode }) {
  const t = {
    info: "border-line bg-raised text-ink",
    warn: "border-warn/30 bg-warn-soft text-ink",
    error: "border-danger/30 bg-danger-soft text-ink",
    ok: "border-accent/30 bg-accent-soft text-ink",
  }[tone];
  const icon = { info: "ℹ", warn: "!", error: "×", ok: "✓" }[tone];
  const iconTone = { info: "text-muted", warn: "text-warn", error: "text-danger", ok: "text-accent" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${t}`}>
      <span className={`mt-px font-bold ${iconTone}`}>{icon}</span>
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        <div className="text-muted [&_a]:text-accent [&_a]:underline">{children}</div>
      </div>
    </div>
  );
}

export function Hash({ value, chars = 10, label }: { value: string; chars?: number; label?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > chars * 2 + 1 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value;
  return (
    <button
      type="button"
      title={`Copy ${label ?? "value"}`}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="font-mono text-xs text-muted hover:text-ink"
    >
      {copied ? "copied ✓" : short}
    </button>
  );
}

export const VERDICT_STYLE = {
  refund: { label: "Refunded", tone: "text-accent bg-accent-soft border-accent/30", dot: "bg-accent", blurb: "Real contribution — deposit back in full" },
  forfeit: { label: "Forfeited", tone: "text-danger bg-danger-soft border-danger/30", dot: "bg-danger", blurb: "Wasted maintainers' time — deposit goes to the repo" },
  needs_human: { label: "Needs a maintainer", tone: "text-warn bg-warn-soft border-warn/30", dot: "bg-warn", blurb: "Not clear-cut — a maintainer decides" },
  void: { label: "Voided", tone: "text-muted bg-raised border-line", dot: "bg-faint", blurb: "Paid in error — refunded" },
} as const;

export function VerdictBadge({ verdict, size = "sm" }: { verdict: keyof typeof VERDICT_STYLE; size?: "sm" | "lg" }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border font-semibold ${s.tone} ${size === "lg" ? "px-4 py-1.5 text-base" : "px-2.5 py-0.5 text-xs"}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-label="Loading" />;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-faint">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
