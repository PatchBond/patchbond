// An original soundtrack for the pitch video, synthesised from scratch (no samples, nothing to
// license), cut to src/timeline.json. Writes public/music.wav and public/music-ducked.wav (quieter
// under the narration lines in src/narration.json).
//   bun gen-audio.ts

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SR = 44_100;
const dir = import.meta.dir;
const timeline = JSON.parse(readFileSync(resolve(dir, "src/timeline.json"), "utf8")) as { scenes: { id: string; sec: number }[] };
const narration = JSON.parse(readFileSync(resolve(dir, "src/narration.json"), "utf8")) as { scene: string; at: number }[];

const starts: Record<string, number> = {};
let total = 0;
for (const s of timeline.scenes) {
  starts[s.id] = total;
  total += s.sec;
}
const N = Math.ceil(total * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

// ---------- helpers ----------
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
let seed = 7;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const add = (i: number, l: number, r = l) => {
  if (i >= 0 && i < N) {
    L[i]! += l;
    R[i]! += r;
  }
};
/** Gain of the arrangement over time: which layers play in which section. */
const section = (t: number) => ({
  pad: t < starts.idea! ? 1.0 : t < starts.close! ? 0.42 : 0.6,
  pulse: t >= starts.numbers! && t < starts.idea! ? 1 : 0,
  drums: t >= starts.idea! + 0.02 && t < starts.close! ? 1 : 0,
  pluck: t >= starts.hero! && t < starts.close! ? 1 : 0,
  lift: t >= starts.near! && t < starts.close! ? 1 : 0,
});

const BPM = 96;
const beat = 60 / BPM;
const bar = beat * 4;
// Am – F – C – G, one bar each.
const CHORDS = [
  { root: 45, notes: [57, 60, 64] },
  { root: 41, notes: [57, 60, 65] },
  { root: 48, notes: [55, 60, 64] },
  { root: 43, notes: [55, 59, 62] },
];
const chordAt = (t: number) => CHORDS[Math.floor(t / bar) % CHORDS.length]!;

// ---------- pad: detuned saws, low-passed, slow swell per chord ----------
{
  let lpL = 0, lpR = 0;
  const ph = new Float64Array(12);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const sec = section(t);
    const c = chordAt(t);
    const inBar = (t % bar) / bar;
    const env = Math.min(1, inBar * 6) * (0.75 + 0.25 * Math.cos(inBar * Math.PI * 2));
    let l = 0, r = 0;
    c.notes.forEach((n, k) => {
      for (const [d, side] of [[-0.09, 0], [0.09, 1]] as const) {
        const idx = k * 2 + side;
        ph[idx] = (ph[idx]! + midi(n + d) / SR) % 1;
        const saw = ph[idx]! * 2 - 1;
        if (side === 0) l += saw;
        else r += saw;
      }
    });
    // The filter opens as the story builds.
    const open = t < starts.numbers! ? 500 : t < starts.idea! ? 500 + 900 * ((t - starts.numbers!) / (starts.idea! - starts.numbers!)) : 1600 + 600 * sec.lift;
    const a = 1 - Math.exp((-2 * Math.PI * open) / SR);
    lpL += a * (l - lpL);
    lpR += a * (r - lpR);
    const g = 0.05 * sec.pad * env;
    add(i, lpL * g, lpR * g);
  }
}

// ---------- notes rendered as short events ----------
function tone(t0: number, dur: number, f: number, gain: number, pan = 0, kind: "sine" | "tri" = "sine", decay = 4) {
  const i0 = Math.floor(t0 * SR);
  const n = Math.floor(dur * SR);
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    const p = (f * t) % 1;
    const w = kind === "sine" ? Math.sin(2 * Math.PI * f * t) : 1 - 4 * Math.abs(p - 0.5);
    const env = Math.min(1, t * 400) * Math.exp(-t * decay);
    const v = w * env * gain;
    add(i0 + j, v * (1 - Math.max(0, pan)), v * (1 + Math.min(0, pan)));
  }
}

function kick(t0: number, gain: number) {
  const i0 = Math.floor(t0 * SR);
  let ph = 0;
  for (let j = 0; j < SR * 0.4; j++) {
    const t = j / SR;
    const f = 45 + 85 * Math.exp(-t * 30);
    ph += f / SR;
    add(i0 + j, Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * gain);
  }
}

function hiss(t0: number, dur: number, gain: number, hp: number, decay: number, pan = 0) {
  const i0 = Math.floor(t0 * SR);
  let lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * hp) / SR);
  for (let j = 0; j < dur * SR; j++) {
    const t = j / SR;
    const x = noise();
    lp += a * (x - lp);
    const v = (x - lp) * Math.exp(-t * decay) * gain;
    add(i0 + j, v * (1 - Math.max(0, pan)), v * (1 + Math.min(0, pan)));
  }
}

/** Filtered-noise sweep that peaks at `tEnd` — a transition whoosh. */
function whoosh(tEnd: number, len = 0.55, gain = 0.09) {
  const i0 = Math.floor((tEnd - len) * SR);
  let bp = 0, lp = 0;
  for (let j = 0; j < len * SR + SR * 0.25; j++) {
    const t = j / SR;
    const x = Math.min(1, t / len);
    const fc = 300 + 4500 * x * x;
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    const n = noise();
    lp += a * (n - lp);
    bp += 0.5 * (lp - bp);
    const env = t < len ? x ** 2 : Math.exp(-(t - len) * 18);
    const pan = Math.sin(t * 6) * 0.4;
    add(i0 + j, (lp - bp) * env * gain * (1 - pan), (lp - bp) * env * gain * (1 + pan));
  }
}

function impact(t0: number, gain: number) {
  kick(t0, gain);
  tone(t0, 2.5, midi(33), gain * 0.6, 0, "sine", 1.4);
  hiss(t0, 1.2, gain * 0.25, 2000, 4);
}

// ---------- arrangement ----------
for (let t = 0; t < total; t += beat / 2) {
  const s = section(t);
  const c = chordAt(t);
  const step = Math.round(t / (beat / 2)) % 8;
  if (s.pulse) tone(t, 0.3, midi(c.root), 0.13 * (0.5 + 0.5 * ((t - starts.numbers!) / 9)), 0, "tri", 7);
  if (s.drums) {
    if (step % 2 === 0) kick(t, 0.32);
    if (step === 2 || step === 6) hiss(t, 0.18, 0.09, 1500, 22);
    hiss(t, 0.05, step % 2 ? 0.035 : 0.022, 7000, 60, step % 2 ? 0.3 : -0.3);
    if (s.lift && step % 2 === 1) hiss(t, 0.25, 0.03, 6000, 9, 0.2);
    tone(t, 0.35, midi(c.root), 0.16, 0, "tri", 6);
  }
}
// Arpeggio plucks (16ths) through the product scenes, with a ping-pong echo below.
for (let t = starts.hero!; t < starts.close!; t += beat / 4) {
  const c = chordAt(t);
  const k = Math.round(t / (beat / 4)) % 4;
  const n = [...c.notes, c.notes[0]! + 12][k]!;
  tone(t, 0.3, midi(n + 12), 0.035, k % 2 ? 0.35 : -0.35, "tri", 11);
}

// Riser into the idea, impacts on the logo and the close, whooshes on every cut.
{
  const t1 = starts.idea!;
  const i0 = Math.floor((t1 - 1.6) * SR);
  let lp = 0;
  for (let j = 0; j < 1.6 * SR; j++) {
    const x = j / (1.6 * SR);
    const a = 1 - Math.exp((-2 * Math.PI * (200 + 6000 * x * x)) / SR);
    lp += a * (noise() - lp);
    add(i0 + j, lp * x * x * 0.16);
  }
}
impact(starts.idea!, 0.55);
impact(starts.close!, 0.6);
// Final chord rings out.
for (const n of CHORDS[0]!.notes) tone(starts.close! + 0.05, 7.5, midi(n), 0.05, 0, "tri", 0.45);
for (const s of timeline.scenes.slice(2)) if (s.id !== "close" && s.id !== "idea") whoosh(starts[s.id]!);
// On-chain receipts: a chime when the receipt lands, a soft tick per event line.
for (const id of ["tx-gasless", "tx-forfeit", "tx-agent"]) {
  const t0 = starts[id]!;
  tone(t0 + 0.55, 1.4, midi(88), 0.07, -0.2, "sine", 4);
  tone(t0 + 0.6, 1.4, midi(95), 0.045, 0.2, "sine", 4);
  for (let e = 0; e < 2; e++) tone(t0 + 1.2 + e * 0.4, 0.08, 2400, 0.05, 0, "sine", 60);
}

// ---------- echo, master, fades ----------
function echo(buf: Float32Array, other: Float32Array, delay: number, fb: number, mix: number) {
  const d = Math.floor(delay * SR);
  for (let i = d; i < N; i++) buf[i]! += other[i - d]! * mix + buf[i - d]! * fb * 0.15;
}
const dryL = L.slice(), dryR = R.slice();
echo(L, dryR, 0.31, 0.3, 0.18);
echo(R, dryL, 0.47, 0.3, 0.18);

function master(ducked: boolean): Buffer {
  const gain = new Float32Array(N).fill(1);
  if (ducked) {
    for (const [i, line] of narration.entries()) {
      const wav = readFileSync(resolve(dir, `public/vo/${String(i).padStart(2, "0")}.wav`));
      const secs = (wav.length - 44) / 2 / SR;
      const a = starts[line.scene]! + line.at - 0.15;
      const b = a + secs + 0.3;
      for (let j = Math.floor(a * SR); j < Math.min(N, b * SR); j++) {
        const t = j / SR;
        const ramp = Math.min(1, (t - a) / 0.15, (b - t) / 0.25);
        gain[j] = Math.min(gain[j]!, 1 - 0.55 * Math.max(0, ramp));
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!));
  const norm = 0.89 / peak;
  const out = Buffer.alloc(44 + N * 4);
  out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const fade = Math.min(1, t / 1.5, (total - t) / 2.5);
    const g = norm * fade * gain[i]!;
    // Soft clip keeps peaks round.
    out.writeInt16LE(Math.round(Math.tanh(L[i]! * g * 1.1) * 32000), 44 + i * 4);
    out.writeInt16LE(Math.round(Math.tanh(R[i]! * g * 1.1) * 32000), 46 + i * 4);
  }
  return out;
}

writeFileSync(resolve(dir, "public/music.wav"), master(false));
writeFileSync(resolve(dir, "public/music-ducked.wav"), master(true));
console.log(`soundtrack: ${total.toFixed(1)} s → public/music.wav, public/music-ducked.wav`);
