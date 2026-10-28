// The bond curve as a live "attention meter": price vs the repo's open queue — the exact maths the
// contract runs (shared/src/curve.ts). Drag on the chart when interactive.

import { curveBond, DECIMALS, SYMBOL, type Currency, type CurvePolicy } from "@patchbond/shared";
import { motion } from "motion/react";
import { useId, useMemo, useRef, type PointerEvent } from "react";
import { AnimatedNumber } from "./fx";

const W = 640;
const H = 260;
const PAD = { l: 52, r: 20, t: 24, b: 40 };

export function AttentionMeter({
  policy,
  open,
  onOpenChange,
  maxOpen = 40,
  compact = false,
  currency = "usdc",
}: {
  policy: CurvePolicy;
  open: number;
  onOpenChange?: (n: number) => void;
  maxOpen?: number;
  compact?: boolean;
  currency?: Currency;
}) {
  const gid = useId();
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  // Everything below is in whole USDC / NEAR (display units), not token units.
  const unit = 10 ** DECIMALS[currency];
  const fmt = (v: number, digits = 2) => (currency === "usdc" ? `$${v.toFixed(digits)}` : `${v.toFixed(digits)} Ⓝ`);
  const max = Number(policy.max_bond) / unit;
  const pts = useMemo(() => Array.from({ length: maxOpen + 1 }, (_, i) => Number(curveBond(policy, i)) / unit), [policy, maxOpen, unit]);
  const top = Math.min(max, Math.max(...pts));
  const step = niceStep(top / 4);
  const yMax = Math.ceil((top * 1.05) / step) * step;
  const x = (i: number) => PAD.l + (i / maxOpen) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);

  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxOpen)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`;
  const cur = Math.min(Math.max(open, 0), maxOpen);
  const bond = Number(curveBond(policy, open)) / unit;
  const target = policy.target_open;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const state = open > target * 2 ? "flooded" : open > target ? "busy" : "calm";
  const stateText = {
    calm: "Quiet repo — newcomers pay almost nothing",
    busy: "Over capacity — each new submission costs 12.5% more",
    flooded: "Flood — spam prices itself out",
  }[state];
  const stateColor = state === "calm" ? "text-brand" : state === "busy" ? "text-warn" : "text-danger";
  // The stretch of the curve the queue has already climbed glows.
  const usedLine = pts.slice(0, cur + 1).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  function fromPointer(e: PointerEvent<SVGSVGElement>) {
    if (!onOpenChange || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const n = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * maxOpen);
    onOpenChange(Math.min(maxOpen, Math.max(0, n)));
  }

  const spring = { type: "spring", stiffness: 300, damping: 30 } as const;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-faint">Bond right now</div>
          <div className={`num font-semibold tracking-tight ${compact ? "text-4xl" : "text-5xl"}`}>
            <AnimatedNumber value={bond} format={(n) => (currency === "usdc" ? `$${n.toFixed(2)}` : n.toFixed(2))} />
            <span className="ml-2 text-base font-medium text-faint">{SYMBOL[currency]}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="num text-muted-foreground">
            <b className="text-ink">{open}</b> open · capacity <b className="text-ink">{target}</b>
          </div>
          <motion.div key={state} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={stateColor}>
            {stateText}
          </motion.div>
        </div>
      </div>

      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className={`mt-4 w-full touch-none select-none ${onOpenChange ? "cursor-ew-resize" : ""}`}
        role="img"
        aria-label={`Bond curve: ${fmt(bond)} at ${open} open submissions`}
        onPointerDown={(e) => {
          if (!onOpenChange) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--brand)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
          <filter id={`${gid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect x={x(target)} y={PAD.t} width={x(maxOpen) - x(target)} height={H - PAD.t - PAD.b} fill="var(--warn)" opacity="0.04" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="num fill-faint text-[11px]">
              {fmt(t, t >= 1 || t === 0 ? 0 : 2)}
            </text>
          </g>
        ))}
        <line x1={x(target)} x2={x(target)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-2)" strokeDasharray="4 4" opacity="0.6" />
        <text x={x(target) + 6} y={PAD.t + 10} className="fill-faint text-[11px]">
          capacity {target}
        </text>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--brand)" strokeOpacity="0.35" strokeWidth="2" strokeLinejoin="round" />
        <path d={usedLine} fill="none" stroke="var(--brand)" strokeWidth="6" strokeOpacity="0.35" filter={`url(#${gid}-glow)`} />
        <path d={usedLine} fill="none" stroke="var(--brand)" strokeWidth="2.75" strokeLinejoin="round" />
        <motion.line initial={false} animate={{ x1: x(cur), x2: x(cur), y1: y(pts[cur]!), y2: H - PAD.b }} transition={spring} stroke="var(--ink)" strokeOpacity="0.3" />
        <motion.circle initial={false} animate={{ cx: x(cur), cy: y(pts[cur]!) }} transition={spring} r="14" fill="var(--brand)" opacity="0.18" />
        <motion.circle initial={false} animate={{ cx: x(cur), cy: y(pts[cur]!) }} transition={spring} r="7" fill="var(--bg)" stroke="var(--brand)" strokeWidth="3" />
        {[0, 10, 20, 30, 40].filter((t) => t <= maxOpen).map((t) => (
          <text key={t} x={x(t)} y={H - 20} textAnchor="middle" className="num fill-faint text-[11px]">
            {t}
          </text>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 1} textAnchor="middle" className="fill-faint text-[10px]">
          open submissions{onOpenChange ? " — drag the curve" : ""}
        </text>
      </svg>
    </div>
  );
}

/** 1, 2 or 5 × 10^k (whole USDC or NEAR, fractions allowed), so axis labels are round. */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw > 0 ? raw : 1));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
