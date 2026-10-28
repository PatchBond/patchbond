// The verdict's seal: the brand's ridged coin. It spins while the browser checks the signature
// and stamps itself VERIFIED (or BROKEN) when the checks finish.

import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";

export type SealState = "idle" | "checking" | "ok" | "bad";

export function Seal({ state, size = 148, mock = false }: { state: SealState; size?: number; mock?: boolean }) {
  const id = useId();
  const color = state === "ok" ? "var(--brand)" : state === "bad" ? "var(--danger)" : "var(--faint)";
  const ring = state === "ok" ? (mock ? "VERIFIED · DEV KEY · UNTOUCHED · " : "VERIFIED · TEE SIGNED · UNTOUCHED · ") : state === "bad" ? "TAMPERED · DO NOT TRUST · " : "SIGNED VERDICT · CHECK IT YOURSELF · ";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.svg
        viewBox="0 0 200 200"
        className="absolute inset-0"
        animate={{ rotate: state === "checking" ? 360 : 0 }}
        transition={state === "checking" ? { repeat: Infinity, duration: 1.6, ease: "linear" } : { type: "spring", stiffness: 60, damping: 12 }}
      >
        <defs>
          <path id={id} d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
        </defs>
        {Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={100 + 88 * Math.cos(a)}
              y1={100 + 88 * Math.sin(a)}
              x2={100 + 96 * Math.cos(a)}
              y2={100 + 96 * Math.sin(a)}
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              opacity={state === "idle" ? 0.4 : 0.9}
            />
          );
        })}
        <text className="fill-current font-mono text-[11px] font-bold tracking-[0.2em]" style={{ color }}>
          <textPath href={`#${id}`}>{ring.repeat(2)}</textPath>
        </text>
      </motion.svg>
      <motion.div
        className="absolute inset-[24%] grid place-items-center rounded-full"
        animate={{
          backgroundColor: state === "ok" ? "var(--brand)" : state === "bad" ? "var(--danger)" : "var(--raised)",
          scale: state === "ok" || state === "bad" ? [1, 1.12, 1] : 1,
        }}
        transition={{ duration: 0.5 }}
      >
        <AnimatePresence mode="wait">
          {state === "ok" && (
            <motion.svg key="ok" viewBox="0 0 24 24" className="size-1/2" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 400, damping: 14 }}>
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--brand-ink)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.1 }} />
            </motion.svg>
          )}
          {state === "bad" && (
            <motion.svg key="bad" viewBox="0 0 24 24" className="size-1/2" initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <path d="M7 7l10 10M17 7L7 17" stroke="var(--bg)" strokeWidth="3.2" strokeLinecap="round" />
            </motion.svg>
          )}
          {(state === "idle" || state === "checking") && (
            <motion.span key="q" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="font-mono text-xs text-faint">
              {state === "checking" ? "…" : "sig"}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
