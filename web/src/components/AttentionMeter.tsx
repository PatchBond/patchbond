// The bond curve as a live "attention meter": price vs the repo's open queue, the exact maths
// the contract runs (shared/src/curve.ts). Interactive on the home page, live on repo pages.

import { curveBond, formatUsdc, type CurvePolicy } from "@patchbond/shared";
import { useId, useMemo } from "react";

const W = 640;
const H = 260;
const PAD = { l: 52, r: 20, t: 24, b: 40 };

export function AttentionMeter({
  policy,
  open,
  onOpenChange,
  maxOpen = 40,
}: {
  policy: CurvePolicy;
  open: number;
  onOpenChange?: (n: number) => void;
  maxOpen?: number;
}) {
  const gid = useId();
  const max = Number(policy.max_bond);
  const pts = useMemo(() => Array.from({ length: maxOpen + 1 }, (_, i) => Number(curveBond(policy, i))), [policy, maxOpen]);
  const top = Math.min(max, Math.max(...pts));
  const step = niceStep(top / 4);
  const yMax = Math.ceil((top * 1.05) / step) * step;
  const x = (i: number) => PAD.l + (i / maxOpen) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);

  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxOpen)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`;
  const cur = Math.min(open, maxOpen);
  const bond = curveBond(policy, open);
  const target = policy.target_open;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const state = open > target * 2 ? "flooded" : open > target ? "busy" : "calm";
  const stateText = {
    calm: "Quiet repo — newcomers pay almost nothing",
    busy: "Over capacity — each new submission costs 12.5% more",
    flooded: "Flood — spam prices itself out",
  }[state];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-faint">Bond right now</div>
          <div className="num text-5xl font-semibold tracking-tight">
            ${formatUsdc(bond)}
            <span className="ml-2 text-base font-medium text-faint">USDC</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="num text-muted">
            <b className="text-ink">{open}</b> open · capacity <b className="text-ink">{target}</b>
          </div>
          <div className={state === "calm" ? "text-accent" : state === "busy" ? "text-warn" : "text-danger"}>{stateText}</div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full touch-none select-none" role="img" aria-label={`Bond curve: $${formatUsdc(bond)} at ${open} open submissions`}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="num fill-faint text-[11px]">
              ${t / 1e6 >= 1 || t === 0 ? (t / 1e6).toFixed(0) : (t / 1e6).toFixed(2)}
            </text>
          </g>
        ))}
        {/* capacity */}
        <line x1={x(target)} x2={x(target)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="4 4" />
        <text x={x(target) + 6} y={PAD.t + 10} className="fill-muted text-[11px]">
          capacity {target}
        </text>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
        {/* current point */}
        <line x1={x(cur)} x2={x(cur)} y1={y(pts[cur]!)} y2={H - PAD.b} stroke="var(--ink)" strokeOpacity="0.35" />
        <circle cx={x(cur)} cy={y(pts[cur]!)} r="7" fill="var(--bg)" stroke="var(--accent)" strokeWidth="3" style={{ transition: "cx .15s, cy .15s" }} />
        {[0, 10, 20, 30, 40].filter((t) => t <= maxOpen).map((t) => (
          <text key={t} x={x(t)} y={H - 20} textAnchor="middle" className="num fill-faint text-[11px]">
            {t}
          </text>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 1} textAnchor="middle" className="fill-faint text-[10px]">
          open submissions →
        </text>
      </svg>

      {onOpenChange && (
        <label className="mt-2 block">
          <span className="sr-only">Open submissions</span>
          <input
            type="range"
            min={0}
            max={maxOpen}
            value={open}
            onChange={(e) => onOpenChange(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </label>
      )}
    </div>
  );
}

/** 1, 2 or 5 × 10^k USDC units, so axis labels are round dollars. */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
