// Narration for the pitch video from src/narration.json, using macOS's built-in `say` (voice Daniel).
// Writes public/vo/NN.wav and fails if a line runs past the next line or the end of its scene.
//   bun gen-vo.ts

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const dir = import.meta.dir;
const lines = JSON.parse(readFileSync(resolve(dir, "src/narration.json"), "utf8")) as { scene: string; at: number; text: string }[];
const scenes = JSON.parse(readFileSync(resolve(dir, "src/timeline.json"), "utf8")).scenes as { id: string; sec: number }[];
const length = Object.fromEntries(scenes.map((s) => [s.id, s.sec]));
mkdirSync(resolve(dir, "public/vo"), { recursive: true });

for (const [i, l] of lines.entries()) {
  const base = resolve(dir, `public/vo/${String(i).padStart(2, "0")}`);
  Bun.spawnSync(["say", "-v", process.env.VOICE ?? "Daniel", "-r", "178", "-o", `${base}.aiff`, l.text]);
  Bun.spawnSync(["afconvert", "-f", "WAVE", "-d", "LEI16@44100", `${base}.aiff`, `${base}.wav`]);
  rmSync(`${base}.aiff`);
  const secs = (readFileSync(`${base}.wav`).length - 44) / 2 / 44_100;
  const next = lines.slice(i + 1).find((n) => n.scene === l.scene);
  const room = (next ? next.at : length[l.scene]!) - l.at;
  if (secs > room - 0.2) throw new Error(`Line ${i} ("${l.text}") is ${secs.toFixed(2)} s but has ${room.toFixed(2)} s — shorten it`);
  console.log(`✓ ${i} ${secs.toFixed(2)} s / ${room.toFixed(2)} s`);
}
