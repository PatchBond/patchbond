// Voiceover for the short cut with Kokoro-82M (Apache-2.0), a neural TTS that runs locally — nothing
// is uploaded. Reads src/cut.json; writes public/vo2/NN.wav; refuses lines that overrun their scene.
// Runs under Node (Bun crashes inside onnxruntime-node).
//   node gen-voice.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";

const dir = dirname(fileURLToPath(import.meta.url));
const cut = JSON.parse(readFileSync(resolve(dir, "src/cut.json"), "utf8"));
const barSec = (60 / cut.bpm) * 4;
const bars = Object.fromEntries(cut.scenes.map((s) => [s.id, s.bars]));
mkdirSync(resolve(dir, "public/vo2"), { recursive: true });

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
for (const [i, line] of cut.lines.entries()) {
  const base = resolve(dir, `public/vo2/${String(i).padStart(2, "0")}`);
  const audio = await tts.generate(line.text, { voice: cut.voice, speed: line.speed ?? 1.05 });
  await audio.save(`${base}.raw.wav`);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", `${base}.raw.wav`, `${base}.wav`]);
  rmSync(`${base}.raw.wav`);
  const secs = audio.audio.length / audio.sampling_rate;
  const room = bars[line.scene] * barSec - line.at;
  const ok = secs <= room - 0.05;
  console.log(`${ok ? "✓" : "✗"} ${String(i).padStart(2)} ${line.scene.padEnd(11)} ${secs.toFixed(2)} s / ${room.toFixed(2)} s  ${line.text}`);
  if (!ok) process.exitCode = 1;
}
