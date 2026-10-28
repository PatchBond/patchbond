// Soundtrack for the short cut: an original 124 BPM electronic track synthesised from scratch (no
// samples, nothing to license), built bar-by-bar on src/cut.json so drops land on the cuts.
// Writes public/track.wav (music) and public/track-ducked.wav (dips under the voiceover).
//   bun gen-music.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SR = 44_100;
const dir = import.meta.dir;
const cut = JSON.parse(readFileSync(resolve(dir, "src/cut.json"), "utf8")) as {
  bpm: number;
  scenes: { id: string; bars: number }[];
  lines: { scene: string; at: number }[];
};
const BEAT = 60 / cut.bpm;
const BAR = BEAT * 4;
const barOf: Record<string, number> = {};
let bars = 0;
for (const s of cut.scenes) {
  barOf[s.id] = bars;
  bars += s.bars;
}
const TOTAL = bars * BAR + 2.5; // tail for the last chord
const N = Math.ceil(TOTAL * SR);
const DROP = barOf.logo!; // bar index of the drop
const OUTRO = barOf.close!;

// Separate busses so the chords and bass can be side-chained to the kick.
const drums = [new Float32Array(N), new Float32Array(N)] as const;
const music = [new Float32Array(N), new Float32Array(N)] as const;
const fx = [new Float32Array(N), new Float32Array(N)] as const;
const put = (bus: readonly [Float32Array, Float32Array], i: number, l: number, r = l) => {
  if (i >= 0 && i < N) {
    bus[0][i]! += l;
    bus[1][i]! += r;
  }
};
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;

/** RBJ biquad low-pass. */
class LowPass {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  run(x: number, fc: number, q = 0.9) {
    const w = (2 * Math.PI * Math.min(fc, SR * 0.45)) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const b0 = (1 - cos) / 2, b1 = 1 - cos, b2 = b0, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    const y = (b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2) / a0;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// F#m – D – A – E (i–VI–III–VII): bright, driving.
const PROG = [
  { root: 42, chord: [54, 57, 61, 66] },
  { root: 38, chord: [54, 57, 62, 66] },
  { root: 45, chord: [52, 57, 61, 64] },
  { root: 40, chord: [52, 56, 59, 64] },
];
const at = (t: number) => PROG[Math.floor(t / BAR) % 4]!;
const barAt = (t: number) => Math.floor(t / BAR);

// ---------- chords: supersaw (5 detuned saws per note), filter follows the arrangement ----------
{
  const lp = [new LowPass(), new LowPass()];
  const phases = new Float64Array(64).map(() => Math.random());
  const det = [-0.18, -0.08, 0, 0.08, 0.18];
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const b = barAt(t);
    if (t > bars * BAR + 2.4) break;
    const c = at(Math.min(t, bars * BAR - 0.01));
    let l = 0, r = 0;
    c.chord.forEach((n, k) =>
      det.forEach((d, j) => {
        const idx = k * 5 + j;
        phases[idx] = (phases[idx]! + midi(n + d) / SR) % 1;
        const v = phases[idx]! * 2 - 1;
        const pan = (j - 2) / 2.5;
        l += v * (1 - pan * 0.6);
        r += v * (1 + pan * 0.6);
      }),
    );
    // Intro opens slowly, the build sweeps up, the drop is bright, the outro mellows.
    let fc: number;
    if (b < 4) fc = 400 + (t / (4 * BAR)) * 900;
    else if (b < DROP) fc = 1300 + ((t - 4 * BAR) / ((DROP - 4) * BAR)) ** 2 * 5000;
    else if (b < OUTRO) fc = 3200 + 900 * Math.sin(t * 0.9);
    else fc = 2200 * Math.exp(-(t - OUTRO * BAR) * 0.25) + 500;
    const gain = b < DROP ? 0.022 : b < OUTRO ? 0.026 : 0.03 * Math.exp(-Math.max(0, t - bars * BAR) * 1.4);
    put(music, i, lp[0]!.run(l, fc) * gain, lp[1]!.run(r, fc) * gain);
  }
}

// ---------- drums ----------
function kick(t0: number, g: number) {
  const i0 = Math.floor(t0 * SR);
  let ph = 0;
  for (let j = 0; j < SR * 0.45; j++) {
    const t = j / SR;
    ph += (42 + 120 * Math.exp(-t * 28)) / SR;
    const click = j < 200 ? rnd() * 0.3 * (1 - j / 200) : 0;
    put(drums, i0 + j, (Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) + click) * g);
  }
}
function noiseHit(bus: readonly [Float32Array, Float32Array], t0: number, len: number, g: number, hp: number, decay: number, pan = 0) {
  const i0 = Math.floor(t0 * SR);
  const lp = new LowPass();
  for (let j = 0; j < len * SR; j++) {
    const t = j / SR;
    const x = rnd();
    const v = (x - lp.run(x, hp, 0.7)) * Math.exp(-t * decay) * g;
    put(bus, i0 + j, v * (1 - pan), v * (1 + pan));
  }
}
const clap = (t: number, g: number) => {
  for (let k = 0; k < 3; k++) noiseHit(drums, t + k * 0.011, 0.22, g * (k === 2 ? 1 : 0.6), 1200, k === 2 ? 14 : 60);
};
const crash = (t: number, g: number) => noiseHit(drums, t, 2.2, g, 5000, 1.8, 0.1);

const kicks: number[] = [];
for (let b = 0; b < bars; b++) {
  const t = b * BAR;
  // Intro: a heartbeat kick from bar 2.
  if (b >= 2 && b < 4) {
    kick(t, 0.5);
    kicks.push(t);
    kick(t + 2 * BEAT, 0.42);
    kicks.push(t + 2 * BEAT);
  }
  // Build: four on the floor, hats, then a snare roll that accelerates into the drop.
  if (b >= 4 && b < DROP) {
    for (let k = 0; k < 4; k++) {
      kick(t + k * BEAT, 0.55);
      kicks.push(t + k * BEAT);
    }
    const rollStart = (DROP - 1) * BAR;
    if (t >= rollStart - 0.001) {
      for (let s = 0; s < 16; s++) {
        const div = s < 8 ? 4 : 8;
        const tt = rollStart + (s < 8 ? s * (BEAT / 2) : 4 * BEAT * 0.5 + (s - 8) * (BEAT / div) * 2);
        if (tt < DROP * BAR - BEAT * 0.5) clap(tt, 0.05 + s * 0.012);
      }
    } else {
      clap(t + BEAT, 0.12);
      clap(t + 3 * BEAT, 0.12);
    }
  }
  // Drop through to the outro.
  if (b >= DROP && b < OUTRO) {
    if ((b - DROP) % 4 === 0) crash(t, 0.12);
    for (let k = 0; k < 4; k++) {
      kick(t + k * BEAT, 0.62);
      kicks.push(t + k * BEAT);
      noiseHit(drums, t + k * BEAT + BEAT / 2, 0.16, 0.06, 7000, 18, k % 2 ? 0.25 : -0.25); // off-beat open hat
      noiseHit(drums, t + k * BEAT + BEAT / 4, 0.04, 0.025, 9000, 90, 0.3);
      noiseHit(drums, t + k * BEAT + (3 * BEAT) / 4, 0.04, 0.025, 9000, 90, -0.3);
    }
    clap(t + BEAT, 0.2);
    clap(t + 3 * BEAT, 0.2);
    // A small fill before every 4th bar.
    if ((b - DROP) % 4 === 3) for (let s = 0; s < 4; s++) clap(t + 3 * BEAT + s * (BEAT / 4), 0.08 + s * 0.03);
  }
  // Hats in the intro, quietly.
  if (b < 4) for (let s = 0; s < 8; s++) noiseHit(drums, t + s * (BEAT / 2), 0.03, 0.012 + (b / 4) * 0.01, 9000, 110, s % 2 ? 0.3 : -0.3);
}
// The final hit.
kick(OUTRO * BAR, 0.7);
crash(OUTRO * BAR, 0.16);

// ---------- bass: 808-style sub with octave bounce; lead motif after the drop ----------
function note(bus: readonly [Float32Array, Float32Array], t0: number, len: number, f: number, g: number, shape: "sine" | "saw" | "sq", decay: number, pan = 0, glideFrom?: number) {
  const i0 = Math.floor(t0 * SR);
  let ph = 0;
  const lp = new LowPass();
  for (let j = 0; j < len * SR; j++) {
    const t = j / SR;
    const ff = glideFrom ? f + (glideFrom - f) * Math.exp(-t * 40) : f;
    ph = (ph + ff / SR) % 1;
    let w = shape === "sine" ? Math.sin(2 * Math.PI * ph) : shape === "saw" ? ph * 2 - 1 : ph < 0.5 ? 1 : -1;
    if (shape !== "sine") w = lp.run(w, 2600 * Math.exp(-t * 6) + 500, 1.2);
    const env = Math.min(1, t * 300) * Math.exp(-t * decay) * Math.min(1, (len - t) * 60);
    put(bus, i0 + j, w * env * g * (1 - pan), w * env * g * (1 + pan));
  }
}
for (let b = 4; b < OUTRO; b++) {
  const c = at(b * BAR);
  for (let s = 0; s < 8; s++) {
    if (b < DROP && s % 2) continue;
    const t = b * BAR + s * (BEAT / 2);
    const up = b >= DROP && s % 4 === 3;
    note(music, t, BEAT / 2, midi(c.root + (up ? 12 : 0) - 12), b >= DROP ? 0.26 : 0.18, "sine", 3, 0, up ? midi(c.root - 12) : undefined);
  }
}
// Lead: a short hook every 2 bars after the drop.
const MOTIF = [0, 3, 7, 10, 7, 3]; // relative to the chord's top note region
for (let b = DROP; b < OUTRO; b += 2) {
  const c = at(b * BAR);
  MOTIF.forEach((d, k) => note(fx, b * BAR + k * (BEAT / 2) + BEAT * 2, BEAT * 0.45, midi(c.root + 24 + d), 0.05, "sq", 5, k % 2 ? 0.3 : -0.3));
}
// Riser into the drop and a sub-drop on it.
{
  const t0 = (DROP - 2) * BAR;
  const len = 2 * BAR;
  const lp = new LowPass();
  for (let j = 0; j < len * SR; j++) {
    const x = j / (len * SR);
    put(fx, Math.floor(t0 * SR) + j, lp.run(rnd(), 300 + 9000 * x * x, 2) * x * x * 0.22);
  }
  note(fx, DROP * BAR, 1.6, midi(30), 0.5, "sine", 1.6, 0, midi(54));
}
// Whooshes on each cut after the drop.
for (const s of cut.scenes) {
  const b = barOf[s.id]!;
  if (b <= DROP || s.id === "close") continue;
  const tEnd = b * BAR;
  const len = 0.35;
  const lp = new LowPass();
  for (let j = 0; j < len * SR; j++) {
    const x = j / (len * SR);
    put(fx, Math.floor((tEnd - len) * SR) + j, lp.run(rnd(), 800 + 7000 * x, 1.5) * x * x * 0.12, lp.run(rnd(), 800 + 7000 * x, 1.5) * x * x * 0.12);
  }
}

// ---------- side-chain the music bus to the kick, then mix and master ----------
const duck = new Float32Array(N).fill(1);
for (const k of kicks) {
  const i0 = Math.floor(k * SR);
  for (let j = 0; j < 0.22 * SR && i0 + j < N; j++) duck[i0 + j] = Math.min(duck[i0 + j]!, 0.3 + 0.7 * (j / (0.22 * SR)) ** 0.7);
}

function master(voiceDuck: boolean): Buffer {
  const vgain = new Float32Array(N).fill(1);
  if (voiceDuck) {
    cut.lines.forEach((line, i) => {
      const f = resolve(dir, `public/vo2/${String(i).padStart(2, "0")}.wav`);
      if (!existsSync(f)) return;
      const secs = wavSeconds(readFileSync(f));
      const a = barOf[line.scene]! * BAR + line.at - 0.1;
      const b = a + secs + 0.25;
      for (let j = Math.floor(a * SR); j < Math.min(N, b * SR); j++) {
        const t = j / SR;
        vgain[j] = Math.min(vgain[j]!, 1 - 0.5 * Math.max(0, Math.min(1, (t - a) / 0.1, (b - t) / 0.2)));
      }
    });
  }
  const mix = (ch: 0 | 1, i: number) => (drums[ch][i]! + music[ch][i]! * duck[i]! + fx[ch][i]!) * vgain[i]!;
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix(0, i)), Math.abs(mix(1, i)));
  const pre = 1.6 / peak; // drive into the soft clipper for a loud, glued master
  const out = Buffer.alloc(44 + N * 4);
  out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const fade = Math.min(1, t / 0.08, (TOTAL - t) / 1.2);
    for (const ch of [0, 1] as const) out.writeInt16LE(Math.round(Math.tanh(mix(ch, i) * pre) * 0.93 * fade * 32767), 44 + i * 4 + ch * 2);
  }
  return out;
}

function wavSeconds(buf: Buffer): number {
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === "data") return size / (buf.readUInt16LE(22) * 2) / buf.readUInt32LE(24);
    o += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

writeFileSync(resolve(dir, "public/track.wav"), master(false));
writeFileSync(resolve(dir, "public/track-ducked.wav"), master(true));
console.log(`track: ${TOTAL.toFixed(1)} s (${bars} bars at ${cut.bpm} BPM, drop at ${(DROP * BAR).toFixed(2)} s)`);
