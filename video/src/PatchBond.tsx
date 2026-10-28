// The PatchBond pitch video. Every product shot is a real recording of the running app
// (record.ts); every transaction is real testnet data pulled from the RPC (fetch-txs.ts).

import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { ReactNode } from "react";
import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import txData from "../public/txs.json";
import narration from "./narration.json";
import timeline from "./timeline.json";

const { fontFamily } = loadFont();
const { fontFamily: mono } = loadMono();

const C = { bg: "#0e1013", panel: "#15181d", line: "#2a2f37", ink: "#eceae4", ink2: "#a3a6ad", faint: "#6b7079", brand: "#22c55e", warn: "#fbbf24", danger: "#f87171" };
const s = (sec: number) => Math.round(sec * 30);

// ---------- building blocks ----------

function Stage({ children, glow = true }: { children: ReactNode; glow?: boolean }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily, color: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(rgba(236,234,228,.07) 1.5px, transparent 1.5px)`, backgroundSize: "34px 34px", maskImage: "radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 100%)" }} />
      {glow && (
        <div style={{ position: "absolute", width: 1300, height: 800, borderRadius: "50%", background: "rgba(34,197,94,.12)", filter: "blur(140px)", left: 300 + Math.sin(f / 60) * 80, top: -250 }} />
      )}
      {children}
    </AbsoluteFill>
  );
}

/** Fade + rise in, starting `delay` frames into the sequence. */
function In({ children, delay = 0, y = 30, style }: { children: ReactNode; delay?: number; y?: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping: 18, stiffness: 120 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * y}px)`, filter: `blur(${(1 - p) * 8}px)`, ...style }}>{children}</div>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brand }}>{children}</div>;
}

/** A real screen recording, framed like a browser window, with a headline above it. */
function Clip({ src, from, eyebrow, title, durationInFrames }: { src: string; from: number; eyebrow: string; title: ReactNode; durationInFrames: number }) {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, durationInFrames], [1, 1.035]);
  return (
    <Stage>
      <div style={{ position: "absolute", left: 110, top: 70, right: 110 }}>
        <In><Eyebrow>{eyebrow}</Eyebrow></In>
        <In delay={4}><div style={{ fontSize: 58, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 12, lineHeight: 1.1 }}>{title}</div></In>
      </div>
      <In delay={6} y={60} style={{ position: "absolute", left: 210, right: 210, top: 300 }}>
        <div style={{ borderRadius: 26, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 60px 140px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.04)", transform: `scale(${zoom})`, transformOrigin: "50% 0%" }}>
          <div style={{ height: 40, background: "#1a1d23", display: "flex", alignItems: "center", gap: 9, padding: "0 16px" }}>
            {["#f87171", "#fbbf24", "#22c55e"].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.7 }} />)}
            <span style={{ marginLeft: 16, fontSize: 15, color: C.faint, fontFamily: mono }}>localhost · PatchBond on NEAR testnet</span>
          </div>
          <OffthreadVideo src={staticFile(`clips/${src}.webm`)} startFrom={from} muted style={{ width: "100%", display: "block" }} />
        </div>
      </In>
    </Stage>
  );
}

// ---------- scenes ----------

function Hook() {
  const lines = [
    { t: "“Tens of pull requests", d: 0 },
    { t: "for issues nobody assigned.", d: 18 },
    { t: "PRs claiming work", d: 60 },
    { t: "they don't contain.”", d: 78 },
  ];
  const f = useCurrentFrame();
  const out = interpolate(f, [s(6.4), s(7)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Stage glow={false}>
      <div style={{ position: "absolute", left: 160, top: 220, opacity: out }}>
        <In><div style={{ fontSize: 26, color: C.faint, letterSpacing: "0.2em", fontWeight: 700 }}>FROM A MAINTAINER · 122 CONTRIBUTORS · 571 PRS</div></In>
        {lines.map((l, i) => (
          <In key={i} delay={l.d + 10}>
            <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.08, color: i % 2 ? C.brand : C.ink, marginTop: i === 2 ? 40 : 0 }}>{l.t}</div>
          </In>
        ))}
      </div>
      <Sequence from={s(6.8)}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <In><div style={{ fontSize: 70, fontWeight: 700, letterSpacing: "-0.03em" }}>Every one costs a maintainer <span style={{ color: C.brand }}>an hour.</span></div></In>
          <In delay={22}><div style={{ fontSize: 40, color: C.ink2, marginTop: 26 }}>AI is here to help open source — not to drown it.</div></In>
        </AbsoluteFill>
      </Sequence>
    </Stage>
  );
}

function Numbers() {
  const cards = [
    { n: "~25%", t: "of incoming PRs are low-quality AI output — 31% on large projects", src: "Linux Foundation Research, Oct 2026", c: C.brand },
    { n: "49", t: "AI-slop security reports on curl's public list", src: "curl maintainer's list", c: C.ink },
    { n: "PRs off", t: "GitHub now lets repos switch pull requests off — shutting newcomers out too", src: "GitHub, Aug 2026", c: C.ink },
  ];
  return (
    <Stage>
      <div style={{ position: "absolute", left: 130, top: 120 }}>
        <In><Eyebrow>Why now</Eyebrow></In>
        <In delay={5}><div style={{ fontSize: 76, fontWeight: 700, letterSpacing: "-0.035em", marginTop: 14 }}>AI made sending free.<br /><span style={{ color: C.ink2 }}>Receiving still costs a human.</span></div></In>
      </div>
      <div style={{ position: "absolute", left: 130, right: 130, top: 520, display: "flex", gap: 32 }}>
        {cards.map((c, i) => (
          <In key={c.n} delay={30 + i * 14} style={{ flex: 1 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 28, padding: 40, height: 380 }}>
              <div style={{ fontSize: c.n.length > 4 ? 96 : 124, fontWeight: 800, letterSpacing: "-0.04em", color: c.c, lineHeight: 1 }}>{c.n}</div>
              <div style={{ fontSize: 29, color: C.ink2, marginTop: 22, lineHeight: 1.4 }}>{c.t}</div>
              <div style={{ fontSize: 19, color: C.faint, marginTop: 18 }}>{c.src}</div>
            </div>
          </In>
        ))}
      </div>
    </Stage>
  );
}

function Idea() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 12 } });
  return (
    <Stage>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <Img src={staticFile("logo.svg")} style={{ width: 760, transform: `scale(${0.85 + pop * 0.15})`, opacity: pop }} />
        <In delay={16}><div style={{ fontSize: 84, fontWeight: 700, letterSpacing: "-0.035em", marginTop: 60 }}>A market for <span style={{ color: C.brand }}>maintainer attention.</span></div></In>
        <In delay={32}><div style={{ fontSize: 38, color: C.ink2, marginTop: 22 }}>Refundable bonds on pull requests · EIP-1559 for open source · on NEAR</div></In>
      </AbsoluteFill>
    </Stage>
  );
}

type Tx = (typeof txData)["txs"][number];

/** USDC amounts (6 decimals) as dollars; long account ids shortened. */
function fmt(key: string, v: unknown): string {
  if (["bond", "to_vault", "to_treasury", "amount"].includes(key) && typeof v === "string" && /^\d+$/.test(v)) return `$${(Number(v) / 1e6).toFixed(2)}`;
  return typeof v === "string" ? short(v, 14) : JSON.stringify(v);
}

function short(a: string, n = 10) {
  return a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

function Receipt({ tx, caption }: { tx: Tx; caption: string }) {
  const f = useCurrentFrame();
  return (
    <Stage>
      <div style={{ position: "absolute", left: 130, top: 90 }}>
        <In><Eyebrow>On-chain · NEAR testnet</Eyebrow></In>
        <In delay={4}><div style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 12 }}>{tx.title}</div></In>
        <In delay={10}><div style={{ fontSize: 30, color: C.ink2, marginTop: 14 }}>{caption}</div></In>
      </div>
      <In delay={14} y={50} style={{ position: "absolute", left: 130, right: 130, top: 400 }}>
        <div style={{ background: "#0a0c0e", border: `1px solid ${C.line}`, borderRadius: 28, padding: "36px 44px", fontFamily: mono, fontSize: 25, lineHeight: 1.75 }}>
          <div style={{ color: C.faint }}>tx {tx.hash}</div>
          <div><span style={{ color: C.faint }}>signer   </span>{short(tx.signer, 22)}</div>
          <div><span style={{ color: C.faint }}>receiver </span>{short(tx.receiver, 22)}</div>
          <div><span style={{ color: C.faint }}>action   </span>{tx.action}{"   "}<span style={{ color: tx.ok ? C.brand : C.danger }}>{tx.ok ? "✓ SuccessValue" : "✗ failed"}</span></div>
          <div style={{ height: 14 }} />
          {tx.events.map((e, i) => {
            const vis = interpolate(f, [s(1.2) + i * 12, s(1.2) + i * 12 + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const d = e.data as Record<string, unknown>;
            const keys = ["verdict", "bond", "to_vault", "to_treasury", "payer", "amount", "agent"].filter((k) => k in d);
            return (
              <div key={i} style={{ opacity: vis, transform: `translateX(${(1 - vis) * 20}px)` }}>
                <span style={{ color: C.brand }}>EVENT</span> {e.standard}.<b>{e.event}</b>{"  "}
                <span style={{ color: C.ink2 }}>{keys.map((k) => `${k}=${fmt(k, d[k])}`).join("  ")}</span>
              </div>
            );
          })}
        </div>
      </In>
    </Stage>
  );
}

function Near() {
  const items = ["NEAR AI Cloud · verifiable TEE inference", "Rust contract · NEP-297 events", "NEP-141 USDC · ft_transfer_call", "Function-call keys · capped agent wallets", "Meta transactions · NEP-366 gasless bonds", "NEP-413 signed messages · repo linking", "NEAR Intents 1Click · payouts on any chain", "Sputnik DAO / Trezu · project treasuries"];
  return (
    <Stage>
      <div style={{ position: "absolute", left: 130, top: 110 }}>
        <In><Eyebrow>Built on NEAR</Eyebrow></In>
        <In delay={4}><div style={{ fontSize: 70, fontWeight: 700, letterSpacing: "-0.035em", marginTop: 12 }}>Every piece is a NEAR primitive.</div></In>
      </div>
      <div style={{ position: "absolute", left: 130, right: 130, top: 360, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {items.map((t, i) => (
          <In key={t} delay={12 + i * 5}>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20, padding: "26px 32px", fontSize: 30, display: "flex", gap: 18, alignItems: "center" }}>
              <span style={{ color: C.brand, fontWeight: 800 }}>✓</span>
              <span>{t.split(" · ")[0]} <span style={{ color: C.ink2 }}>· {t.split(" · ")[1]}</span></span>
            </div>
          </In>
        ))}
      </div>
    </Stage>
  );
}

function Close() {
  return (
    <Stage>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <In><Img src={staticFile("mark.svg")} style={{ width: 170 }} /></In>
        <In delay={8}><div style={{ fontSize: 88, fontWeight: 700, letterSpacing: "-0.035em", marginTop: 40 }}>Real work gets its bond back.<br /><span style={{ color: C.brand }}>Slop pays the maintainer.</span></div></In>
        <In delay={26}><div style={{ fontSize: 34, color: C.ink2, marginTop: 34 }}>49 testnet transactions · 97 tests · 0 of 15 good PRs forfeited</div></In>
        <In delay={40}><div style={{ fontSize: 36, marginTop: 50, fontFamily: mono }}>github.com/PatchBond/patchbond</div></In>
        <In delay={50}><div style={{ fontSize: 24, color: C.faint, marginTop: 18 }}>Live on NEAR testnet · MIT · No token</div></In>
      </AbsoluteFill>
    </Stage>
  );
}

// ---------- timeline ----------

const tx = (id: string) => txData.txs.find((t) => t.id === id)!;
/** Scene length from the shared timeline (the soundtrack is cut to the same file). */
const sec = (id: string) => s(timeline.scenes.find((x) => x.id === id)!.sec);

const SCENES: { d: number; el: (d: number) => ReactNode }[] = [
  { d: sec("hook"), el: () => <Hook /> },
  { d: sec("numbers"), el: () => <Numbers /> },
  { d: sec("idea"), el: () => <Idea /> },
  { d: sec("hero"), el: (d) => <Clip src="hero" from={s(1.5)} durationInFrames={d} eyebrow="How it works" title={<>Strangers attach a refundable bond. <span style={{ color: C.brand }}>Real work gets it back.</span></>} /> },
  { d: sec("spam"), el: (d) => <Clip src="spam" from={s(3.4)} durationInFrames={d} eyebrow="Attention pricing · EIP-1559 for open source" title={<>Tens of PRs at once? <span style={{ color: C.brand }}>Each one costs 12.5% more.</span></>} /> },
  { d: sec("judge-paste"), el: (d) => <Clip src="judge" from={s(1.4)} durationInFrames={d} eyebrow="The judge" title={<>Paste any pull request.</>} /> },
  { d: sec("judge-facts"), el: (d) => <Clip src="judge" from={s(17.6)} durationInFrames={d} eyebrow="Facts first, then a verifiable model" title={<>CI, invented code, claims vs diff, <span style={{ color: C.brand }}>who was assigned.</span></>} /> },
  { d: sec("judge-verify"), el: (d) => <Clip src="judge" from={s(24.6)} durationInFrames={d} eyebrow="Don't trust us — verify" title={<>Every verdict is signed. <span style={{ color: C.brand }}>Check it in your browser.</span></>} /> },
  { d: sec("tx-gasless"), el: () => <Receipt tx={tx("gasless")} caption="The contributor signed; our relayer paid the fee. The bond landed — 0 NEAR spent by the contributor." /> },
  { d: sec("tx-forfeit"), el: () => <Receipt tx={tx("forfeit")} caption="Slop forfeited: 90% to the repo's vault, 10% to run PatchBond." /> },
  { d: sec("tx-agent"), el: () => <Receipt tx={tx("agent")} caption="A coding agent paid through our MCP server — with a key that can only pay bonds." /> },
  { d: sec("pay"), el: (d) => <Clip src="pay" from={s(0.8)} durationInFrames={d} eyebrow="For contributors" title={<>One tap to pay. <span style={{ color: C.brand }}>No gas needed.</span></>} /> },
  { d: sec("agents"), el: (d) => <Clip src="agents" from={s(0.6)} durationInFrames={d} eyebrow="Know your agent" title={<>Agents get wallets that <span style={{ color: C.brand }}>can't hurt you.</span></>} /> },
  { d: sec("maintainers"), el: (d) => <Clip src="maintainers" from={s(0.5)} durationInFrames={d} eyebrow="For maintainers" title={<>Link a wallet. <span style={{ color: C.brand }}>Get paid on any chain.</span></>} /> },
  { d: sec("near"), el: () => <Near /> },
  { d: sec("close"), el: () => <Close /> },
];

export const TOTAL = SCENES.reduce((t, x) => t + x.d, 0);

const sceneStart = (id: string) => {
  let t = 0;
  for (const x of timeline.scenes) {
    if (x.id === id) return t;
    t += x.sec;
  }
  throw new Error(`no scene ${id}`);
};

/** `narrated`: adds the voiceover and ducks the music under it (gen-audio.ts makes both mixes). */
export function PatchBond({ narrated = false }: { narrated?: boolean }) {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile(narrated ? "music-ducked.wav" : "music.wav")} />
      {narrated &&
        narration.map((line, i) => (
          <Sequence key={`vo${i}`} from={s(sceneStart(line.scene) + line.at)}>
            <Audio src={staticFile(`vo/${String(i).padStart(2, "0")}.wav`)} volume={0.95} />
          </Sequence>
        ))}
      {SCENES.map((sc, i) => {
        const from = at;
        at += sc.d;
        return (
          <Sequence key={i} from={from} durationInFrames={sc.d}>
            {sc.el(sc.d)}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
