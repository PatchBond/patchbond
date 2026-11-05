// The explainer (under 60 s): what PatchBond is, for someone who has never opened a pull request.
// Drawn scenes rather than screen recordings, captions burned in for muted autoplay. Scene lengths
// come from the measured voiceover (gen-explainer.mjs).

import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import timing from "./explainer-timing.json";

const { fontFamily } = loadFont();
const { fontFamily: mono } = loadMono();
const C = { bg: "#0b0d10", panel: "#14171c", line: "#2a2f37", ink: "#eceae4", ink2: "#a3a6ad", faint: "#6b7079", brand: "#22c55e", warn: "#fbbf24", danger: "#f87171" };
const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);
export const EXPLAINER_FRAMES = f(timing.total);

// ---------- primitives ----------

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function Pop({ children, at = 0, style }: { children: ReactNode; at?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - f(at), fps, config: { damping: 14, stiffness: 170, mass: 0.7 } });
  return <div style={{ transform: `scale(${0.7 + 0.3 * p}) translateY(${(1 - p) * 24}px)`, opacity: Math.min(1, p * 1.5), ...style }}>{children}</div>;
}

function Title({ children, at = 0.1 }: { children: ReactNode; at?: number }) {
  return (
    <Pop at={at} style={{ position: "absolute", top: 70, left: 0, right: 0, textAlign: "center", fontSize: 68, fontWeight: 800, letterSpacing: "-0.02em" }}>
      {children}
    </Pop>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink, fontFamily }}>
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(236,234,228,.06) 1.5px, transparent 1.5px)", backgroundSize: "44px 44px" }} />
      {children}
    </AbsoluteFill>
  );
}

function Person({ size = 150, color = C.ink2 }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 100 125">
      <circle cx="50" cy="32" r="24" fill={color} />
      <path d="M8 125 C8 80 28 66 50 66 C72 66 92 80 92 125 Z" fill={color} />
    </svg>
  );
}

function Robot({ size = 150, color = C.ink2 }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <line x1="50" y1="4" x2="50" y2="20" stroke={color} strokeWidth="5" />
      <circle cx="50" cy="6" r="5" fill={color} />
      <rect x="12" y="20" width="76" height="62" rx="16" fill={color} />
      <circle cx="35" cy="48" r="9" fill={C.bg} />
      <circle cx="65" cy="48" r="9" fill={C.bg} />
      <rect x="32" y="66" width="36" height="6" rx="3" fill={C.bg} />
    </svg>
  );
}

function Doc({ w = 150, tone = C.ink2, label }: { w?: number; tone?: string; label?: string }) {
  return (
    <div style={{ width: w, height: w * 1.2, borderRadius: 12, background: C.panel, border: `3px solid ${tone}`, padding: w * 0.12, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: w * 0.07 }}>
      {[0.9, 0.65, 0.8, 0.5].map((p, i) => (
        <div key={i} style={{ height: w * 0.05, width: `${p * 100}%`, borderRadius: 4, background: tone, opacity: 0.7 }} />
      ))}
      {label ? <div style={{ marginTop: "auto", fontSize: w * 0.15, fontWeight: 700, color: tone }}>{label}</div> : null}
    </div>
  );
}

function Coin({ size = 110, label = "$" }: { size?: number; label?: string }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size, background: C.brand, color: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.48, boxShadow: `0 0 40px ${C.brand}66` }}>
      {label}
    </div>
  );
}

function Lock({ size = 90, color = C.brand }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d="M28 46 V30 a22 22 0 0 1 44 0 V46" fill="none" stroke={color} strokeWidth="9" />
      <rect x="16" y="44" width="68" height="50" rx="10" fill={color} />
      <circle cx="50" cy="66" r="8" fill={C.bg} />
    </svg>
  );
}

// ---------- scenes ----------

const stream = ["Fix everything", "Improve docs", "Refactor all", "Add feature", "Fix security", "Update code"];

function Inbox() {
  const frame = useCurrentFrame();
  const count = Math.round(interpolate(frame, [f(2), f(5.5)], [3, 148], { ...clamp, easing: Easing.in(Easing.quad) }));
  return (
    <Stage>
      <div style={{ position: "absolute", left: 200, top: 280, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <Pop at={0.1}><Person size={210} color={C.brand} /></Pop>
        <Pop at={0.3} style={{ fontSize: 36, fontWeight: 700 }}>A volunteer</Pop>
      </div>
      <Pop at={1.9} style={{ position: "absolute", right: 170, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <Robot size={240} />
        <div style={{ fontSize: 36, fontWeight: 700 }}>Anyone, with AI</div>
      </Pop>
      {Array.from({ length: 16 }, (_, i) => {
        const start = 1.9 + i * 0.2;
        const p = interpolate(frame, [f(start), f(start + 0.8)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        if (p === 0) return null;
        const y = 300 + (i % 4) * 56 + (i % 3) * 12;
        return (
          <div key={i} style={{ position: "absolute", left: interpolate(p, [0, 1], [1430, 500 + (i % 5) * 18]), top: y, padding: "10px 18px", borderRadius: 10, background: C.panel, border: `2px solid ${C.line}`, fontSize: 24, fontWeight: 600, color: C.ink2, whiteSpace: "nowrap" }}>
            {stream[i % stream.length]}
          </div>
        );
      })}
      <Pop at={2.2} style={{ position: "absolute", left: 0, right: 0, top: 110, textAlign: "center", fontSize: 60, fontWeight: 800 }}>
        <span style={{ color: C.danger, fontVariantNumeric: "tabular-nums" }}>{count}</span> waiting to be read
      </Pop>
    </Stage>
  );
}

function Cost() {
  return (
    <Stage>
      <Title>Sending is free. Reading is not.</Title>
      <div style={{ position: "absolute", left: 0, right: 0, top: 260, display: "flex", justifyContent: "center", gap: 220 }}>
        <Pop at={0.4} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Robot size={190} />
          <div style={{ fontSize: 76, fontWeight: 800, color: C.brand }}>$0</div>
          <div style={{ fontSize: 34, color: C.ink2 }}>to send</div>
        </Pop>
        <Pop at={1.1} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Person size={160} color={C.warn} />
          <div style={{ fontSize: 76, fontWeight: 800, color: C.warn }}>Their time</div>
          <div style={{ fontSize: 34, color: C.ink2 }}>to read, check and close</div>
        </Pop>
      </div>
      <Pop at={3.2} style={{ position: "absolute", left: 0, right: 0, top: 690, display: "flex", justifyContent: "center", alignItems: "center", gap: 24 }}>
        {[0, 1, 2, 3].map((i) => (
          <Doc key={i} w={78} tone={i === 3 ? C.danger : C.ink2} />
        ))}
        <div style={{ fontSize: 44, fontWeight: 700, marginLeft: 24 }}>
          <span style={{ color: C.danger }}>About 1 in 4</span> is low quality AI output
        </div>
      </Pop>
    </Stage>
  );
}

function Deposit() {
  return (
    <Stage>
      <Title>A refundable deposit</Title>
      <div style={{ position: "absolute", left: 0, right: 0, top: 270, display: "flex", justifyContent: "center", alignItems: "center", gap: 130 }}>
        <Pop at={1.5} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          <svg width="280" height="260" viewBox="0 0 120 112">
            <path d="M60 6 L114 52 H98 V106 H22 V52 H6 Z" fill={C.panel} stroke={C.ink2} strokeWidth="4" strokeLinejoin="round" />
            <rect x="50" y="68" width="20" height="38" rx="3" fill={C.ink2} />
          </svg>
          <div style={{ fontSize: 38, fontWeight: 700 }}>A rental</div>
        </Pop>
        <Pop at={0.7}><Coin size={170} /></Pop>
        <Pop at={2.1} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          <Doc w={210} tone={C.brand} />
          <div style={{ fontSize: 38, fontWeight: 700 }}>A stranger’s code</div>
        </Pop>
      </div>
      <Pop at={2.9} style={{ position: "absolute", left: 0, right: 0, top: 770, textAlign: "center", fontSize: 46, fontWeight: 700, color: C.brand }}>
        Treat it well and you get it all back
      </Pop>
    </Stage>
  );
}

function Pay() {
  const frame = useCurrentFrame();
  const split = timing.scenes.find((s) => s.id === "pay")!.lines[1]!.at;
  const coin = interpolate(frame, [f(1.2), f(2.1)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const fade = interpolate(frame, [f(split + 1.3), f(split + 2)], [1, 0.25], clamp);
  return (
    <Stage>
      <Title>Pay within 24 hours, or it closes</Title>
      <div style={{ position: "absolute", left: 310, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Pop at={0.15}><Doc w={200} tone={C.brand} /></Pop>
        <Pop at={0.3} style={{ fontSize: 34, fontWeight: 700 }}>Paid</Pop>
      </div>
      <div style={{ position: "absolute", left: 340 + coin * 380, top: 390, opacity: coin > 0 && coin < 1 ? 1 : coin === 0 ? 1 : 0 }}>
        <Coin size={110} label="78¢" />
      </div>
      <Pop at={0.8} style={{ position: "absolute", left: 760, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ width: 230, height: 240, borderRadius: 24, background: C.panel, border: `4px solid ${C.brand}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={120} />
        </div>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Held safely on NEAR</div>
      </Pop>
      <Pop at={split} style={{ position: "absolute", right: 250, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, opacity: fade }}>
        <Doc w={200} tone={C.danger} />
      </Pop>
      <Pop at={split + 0.9} style={{ position: "absolute", right: 245, top: 575, fontSize: 34, fontWeight: 700, color: C.danger }}>Unpaid: closed</Pop>
    </Stage>
  );
}

function Judge() {
  const frame = useCurrentFrame();
  const scan = interpolate(frame, [f(1), f(3.4)], [0, 1], clamp);
  return (
    <Stage>
      <Title>An AI judge in a sealed box</Title>
      <Pop at={0.3} style={{ position: "absolute", left: 560, top: 240, width: 800, height: 470, borderRadius: 32, border: `5px solid ${C.brand}`, background: C.panel, boxShadow: `0 0 80px ${C.brand}33` }}>
        <div style={{ position: "absolute", left: 90, top: 110 }}><Robot size={230} color={C.brand} /></div>
        <div style={{ position: "absolute", right: 110, top: 100, overflow: "hidden" }}>
          <Doc w={210} tone={C.ink2} />
          <div style={{ position: "absolute", left: 0, right: 0, top: `${scan * 96}%`, height: 6, background: C.brand, boxShadow: `0 0 18px ${C.brand}` }} />
        </div>
        <div style={{ position: "absolute", top: -52, left: 345 }}><Lock size={100} /></div>
      </Pop>
      <Pop at={3.2} style={{ position: "absolute", left: 1090, top: 590, transform: "rotate(-8deg)", border: `6px solid ${C.warn}`, color: C.warn, borderRadius: 14, padding: "10px 26px", fontSize: 54, fontWeight: 800, background: C.bg }}>
        SIGNED
      </Pop>
      <Pop at={3.6} style={{ position: "absolute", left: 0, right: 0, top: 770, textAlign: "center", fontSize: 40, color: C.ink2 }}>
        Anyone can check the verdict wasn’t changed afterwards
      </Pop>
    </Stage>
  );
}

function Outcomes() {
  const lines = timing.scenes.find((s) => s.id === "outcomes")!.lines;
  const rows = [
    { at: lines[0]!.at, tone: C.brand, head: "Real work", body: "Every cent back", icon: <Coin size={120} /> },
    { at: lines[1]!.at, tone: C.warn, head: "Unsure", body: "A person decides", icon: <Person size={100} color={C.warn} /> },
    { at: lines[2]!.at, tone: C.danger, head: "Clear slop", body: "Deposit goes to the project", icon: <Lock size={120} color={C.danger} /> },
  ];
  return (
    <Stage>
      <Title>Three possible outcomes</Title>
      <div style={{ position: "absolute", left: 0, right: 0, top: 260, display: "flex", justifyContent: "center", gap: 44 }}>
        {rows.map((r) => (
          <Pop key={r.head} at={r.at} style={{ width: 500, height: 430, borderRadius: 24, background: C.panel, border: `4px solid ${r.tone}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, textAlign: "center", padding: 24, boxSizing: "border-box" }}>
            {r.icon}
            <div style={{ fontSize: 52, fontWeight: 800, color: r.tone }}>{r.head}</div>
            <div style={{ fontSize: 36, fontWeight: 600 }}>{r.body}</div>
          </Pop>
        ))}
      </div>
      <Pop at={lines[2]!.at + 2} style={{ position: "absolute", left: 0, right: 0, top: 745, textAlign: "center", fontSize: 40, color: C.ink2 }}>
        Forfeits can be disputed
      </Pop>
    </Stage>
  );
}

function Flood() {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [f(0.3), f(2.6)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const price = 0.77 + (4.56 - 0.77) * p;
  const newcomer = 0.77 + (0.98 - 0.77) * p;
  return (
    <Stage>
      <Title>Flood a project, pay more</Title>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 300, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 260 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 340 }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: C.danger, fontVariantNumeric: "tabular-nums" }}>${price.toFixed(2)}</div>
          <div style={{ width: 170, height: 60 + 300 * p, background: C.danger, borderRadius: 14 }} />
          <div style={{ fontSize: 36, fontWeight: 700 }}>The spammer</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 340 }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: C.brand, fontVariantNumeric: "tabular-nums" }}>${newcomer.toFixed(2)}</div>
          <div style={{ width: 170, height: 60 + 16 * p, background: C.brand, borderRadius: 14 }} />
          <div style={{ fontSize: 36, fontWeight: 700 }}>A newcomer</div>
        </div>
      </div>
    </Stage>
  );
}

function Agents() {
  const rows = ["Daily limit", "Only allowed projects", "Freeze any time"];
  return (
    <Stage>
      <Title>AI agents get limits, not your keys</Title>
      <div style={{ position: "absolute", left: 0, right: 0, top: 280, display: "flex", justifyContent: "center", alignItems: "center", gap: 120 }}>
        <Pop at={0.2}><Robot size={280} color={C.brand} /></Pop>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {rows.map((r, i) => (
            <Pop key={r} at={0.9 + i * 0.5} style={{ display: "flex", alignItems: "center", gap: 22, padding: "20px 34px", borderRadius: 16, background: C.panel, border: `3px solid ${C.line}`, fontSize: 44, fontWeight: 700 }}>
              <Lock size={52} />
              {r}
            </Pop>
          ))}
        </div>
      </div>
    </Stage>
  );
}

function Proof() {
  const lines = timing.scenes.find((s) => s.id === "proof")!.lines;
  return (
    <Stage>
      <Title>What we measured</Title>
      <div style={{ position: "absolute", left: 0, right: 0, top: 240, display: "flex", justifyContent: "center", gap: 60 }}>
        <Pop at={0.4} style={{ width: 640, padding: "40px 30px", boxSizing: "border-box", borderRadius: 24, background: C.panel, border: `4px solid ${C.brand}`, textAlign: "center" }}>
          <div style={{ fontSize: 130, fontWeight: 800, color: C.brand, lineHeight: 1 }}>0 of 48</div>
          <div style={{ fontSize: 38, fontWeight: 600, marginTop: 20 }}>good pull requests lost a deposit</div>
        </Pop>
        <Pop at={2} style={{ width: 640, padding: "40px 30px", boxSizing: "border-box", borderRadius: 24, background: C.panel, border: `4px solid ${C.warn}`, textAlign: "center" }}>
          <div style={{ fontSize: 130, fontWeight: 800, color: C.warn, lineHeight: 1 }}>3 of 50</div>
          <div style={{ fontSize: 38, fontWeight: 600, marginTop: 20 }}>slop pull requests forfeited</div>
        </Pop>
      </div>
      <Pop at={lines[1]!.at} style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center", fontSize: 54, fontWeight: 800 }}>
        The deposit is the filter, not the AI
      </Pop>
      <Pop at={lines[1]!.at + 0.2} style={{ position: "absolute", left: 0, right: 0, top: 725, textAlign: "center", fontSize: 30, color: C.ink2 }}>
        Our test on 98 real PRs, 4 Nov 2026. Not yet used by outside contributors.
      </Pop>
    </Stage>
  );
}

function End() {
  return (
    <Stage>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34, paddingBottom: 110 }}>
        <Pop at={0.1} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Img src={staticFile("mark.svg")} style={{ width: 230, height: 230, margin: "0 -30px 0 -50px" }} />
          <div style={{ fontSize: 124, fontWeight: 800, letterSpacing: "-0.04em" }}>Patch<span style={{ color: C.brand }}>Bond</span></div>
        </Pop>
        <Pop at={0.6} style={{ fontSize: 46, fontWeight: 600, textAlign: "center" }}>Make wasting a maintainer’s time cost something.</Pop>
        <Pop at={1.2} style={{ fontFamily: mono, fontSize: 36, color: C.brand }}>patchbond-production.up.railway.app</Pop>
        <Pop at={1.5} style={{ fontSize: 32, color: C.ink2 }}>Running on NEAR testnet · No token · Open source</Pop>
      </AbsoluteFill>
    </Stage>
  );
}

const SCENES: Record<string, () => ReactNode> = { inbox: Inbox, cost: Cost, deposit: Deposit, pay: Pay, judge: Judge, outcomes: Outcomes, flood: Flood, agents: Agents, proof: Proof, end: End };

function Caption({ text, dur }: { text: string; dur: number }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 4, f(dur) - 2, f(dur) + 2], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 56, opacity: o }}>
      <div style={{ maxWidth: 1560, padding: "16px 34px", borderRadius: 14, background: "rgba(0,0,0,.78)", color: "#fff", fontFamily, fontSize: 42, fontWeight: 600, lineHeight: 1.28, textAlign: "center" }}>{text}</div>
    </AbsoluteFill>
  );
}

export function Explainer() {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [EXPLAINER_FRAMES - f(1.4), EXPLAINER_FRAMES - 2], [0.11, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile("track.wav")} volume={fadeOut} />
      {timing.scenes.map((s) => {
        const Scene = SCENES[s.id]!;
        return (
          <Sequence key={s.id} from={f(s.start)} durationInFrames={f(s.dur) + 1}>
            <Scene />
            {s.lines.map((l) => (
              <Sequence key={l.file} from={f(l.at)} durationInFrames={f(l.dur) + 4}>
                <Audio src={staticFile(l.file)} />
                <Caption text={l.text} dur={l.dur} />
              </Sequence>
            ))}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
