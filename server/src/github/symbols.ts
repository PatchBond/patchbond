// "Does this identifier exist anywhere in the repo at the base commit?"
// One tarball download per base commit, indexed into a set of identifiers — instead of code
// search, which is rate-limited to 10 requests a minute.

import { gunzipSync } from "bun";
import { namespaceOf, type SymbolIndex } from "../judge/facts";

const SOURCE = /\.(c|h|cc|cpp|hpp|cxx|rs|go|py|pyi|js|jsx|ts|tsx|mjs|cjs|java|kt|scala|rb|php|cs|swift|m|mm|lua|sh|bash|zig|ex|exs|erl|hs|ml|dart|vue|svelte|sql|pl|r|jl|nim|v|sv|vhd|cmake|mk|in|ac|y|l)$|(^|\/)(Makefile|CMakeLists\.txt|configure)$/i;
const MAX_FILE = 1_000_000;

/** Minimal ustar reader: regular files only, honours the 155-byte prefix and pax long names. */
export function* tarEntries(tar: Uint8Array): Generator<{ name: string; data: Uint8Array }> {
  const dec = new TextDecoder();
  const str = (o: number, n: number) => dec.decode(tar.subarray(o, o + n)).replace(/\0.*$/s, "");
  let off = 0;
  let paxName: string | null = null;
  while (off + 512 <= tar.length) {
    const name = str(off, 100);
    if (!name) break;
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] ?? 0);
    const prefix = str(off + 345, 155);
    const body = tar.subarray(off + 512, off + 512 + size);
    if (type === "x") {
      const m = dec.decode(body).match(/\d+ path=([^\n]*)\n/);
      paxName = m ? m[1]! : null;
    } else if (type === "0" || type === "\0") {
      yield { name: paxName ?? (prefix ? `${prefix}/${name}` : name), data: body };
      paxName = null;
    } else if (type !== "g") {
      paxName = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
}

export function indexIdentifiers(tarGz: Uint8Array<ArrayBuffer>): SymbolIndex {
  const ids = new Set<string>();
  const dec = new TextDecoder();
  for (const { name, data } of tarEntries(gunzipSync(tarGz))) {
    if (!SOURCE.test(name) || data.length > MAX_FILE) continue;
    for (const m of dec.decode(data).matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) ids.add(m[0]);
  }
  const namespaces = new Map<string, number>();
  for (const id of ids) {
    const ns = namespaceOf(id);
    if (ns) namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1);
  }
  return { has: (id) => ids.has(id), namespaceSize: (ns) => namespaces.get(ns) ?? 0 };
}

/** Small cache: base commits repeat across PRs on the same branch. */
const cache = new Map<string, Promise<SymbolIndex>>();

export function symbolIndex(key: string, download: () => Promise<Uint8Array<ArrayBuffer>>): Promise<SymbolIndex> {
  let hit = cache.get(key);
  if (!hit) {
    hit = download().then(indexIdentifiers);
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return hit;
}
