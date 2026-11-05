// Voiceover for the explainer with Kokoro-82M, run locally: reads src/explainer.json, writes
// public/vo3/NN.wav and src/explainer-timing.json. Scene lengths come from the measured speech, and
// the run fails if the video would pass 60 seconds. Runs under Node (Bun crashes in onnxruntime-node).
//   node gen-explainer.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";

const dir = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(resolve(dir, "src/explainer.json"), "utf8"));
const LINE_GAP = 0.12;
const SCENE_GAP = 0.2;
const LEAD_IN = 0.15;
const TAIL = 1.0;
mkdirSync(resolve(dir, "public/vo3"), { recursive: true });

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
let n = 0;
let clock = 0;
const scenes = [];
for (const scene of script.scenes) {
  const start = clock;
  let at = LEAD_IN;
  const lines = [];
  for (const text of scene.lines) {
    const name = String(n++).padStart(2, "0");
    const base = resolve(dir, `public/vo3/${name}`);
    const audio = await tts.generate(text, { voice: script.voice, speed: script.speed });
    await audio.save(`${base}.raw.wav`);
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", `${base}.raw.wav`, `${base}.wav`]);
    rmSync(`${base}.raw.wav`);
    const dur = audio.audio.length / audio.sampling_rate;
    lines.push({ text: text.replaceAll("A.I.", "AI"), file: `vo3/${name}.wav`, at: +at.toFixed(2), dur: +dur.toFixed(2) });
    at += dur + LINE_GAP;
  }
  const dur = at - LINE_GAP + SCENE_GAP + (scene.id === "end" ? TAIL : 0);
  scenes.push({ id: scene.id, start: +start.toFixed(2), dur: +dur.toFixed(2), lines });
  clock += dur;
  console.log(`${scene.id.padEnd(9)} ${dur.toFixed(2)} s`);
}
writeFileSync(resolve(dir, "src/explainer-timing.json"), JSON.stringify({ total: +clock.toFixed(2), scenes }, null, 2));
console.log(`total ${clock.toFixed(2)} s`);
if (clock > 60) process.exitCode = 1;
