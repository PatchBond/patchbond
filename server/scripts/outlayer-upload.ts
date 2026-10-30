// Uploads the enclave program to FastFS (data recorded on NEAR, served by test/main.fastfs.io) the
// way `outlayer upload` does, then waits until the URL serves bytes with the right sha256.
//   bun server/scripts/outlayer-upload.ts outlayer/judge/dist/patchbond-judge.wasm <signer.testnet>
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, actions, type KeyPairString } from "near-api-js";

const [file, signerId] = process.argv.slice(2) as [string, string];
const network = process.env.NEAR_NETWORK ?? "testnet";
const deployment = JSON.parse(readFileSync(join(import.meta.dir, "../../deploy", `${network}.json`), "utf8")) as { rpc: string };
const receiver = network === "mainnet" ? "outlayer.near" : "outlayer.testnet";
const host = network === "mainnet" ? "main.fastfs.io" : "test.fastfs.io";
const keyFile = join(homedir(), ".near-credentials", network, `${signerId}.json`);
if (!file || !signerId || !existsSync(keyFile)) throw new Error(`usage: <wasm> <signer> (needs ${keyFile})`);

const content = readFileSync(file);
const hash = createHash("sha256").update(content).digest("hex");
const path = `${hash}.wasm`;
const MIME = "application/wasm";
const CHUNK = 1 << 20;

// Borsh, as fastnear/fastdata expects: FastfsData::Simple = 0, ::Partial = 1.
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const bytes = (b: Buffer) => Buffer.concat([u32(b.length), b]);
const payloads: Buffer[] =
  content.length <= CHUNK
    ? [Buffer.concat([Buffer.from([0]), str(path), Buffer.from([1]), str(MIME), bytes(content)])]
    : Array.from({ length: Math.ceil(content.length / CHUNK) }, (_, i) => {
        const nonce = Math.floor(Date.now() / 1000) - 1_769_376_240;
        const chunk = content.subarray(i * CHUNK, (i + 1) * CHUNK);
        return Buffer.concat([Buffer.from([1]), str(path), u32(i * CHUNK), u32(content.length), str(MIME), bytes(chunk), u32(nonce)]);
      });

const provider = new JsonRpcProvider({ url: deployment.rpc });
const account = new Account(signerId, provider, JSON.parse(readFileSync(keyFile, "utf8")).private_key as KeyPairString);
console.log(`${file}: ${content.length} bytes, sha256 ${hash}, ${payloads.length} chunk(s) → ${receiver}`);
for (const [i, p] of payloads.entries()) {
  // gas = 1: the call fails on purpose; the data stays on-chain for the FastFS indexer.
  const out = await account.signAndSendTransaction({
    receiverId: receiver,
    actions: [actions.functionCall("__fastdata_fastfs", p, 1n, 0n)],
    throwOnFailure: false,
  });
  console.log(`  chunk ${i + 1}/${payloads.length}: tx ${out.transaction.hash}`);
}
const url = `https://${host}/${signerId}/${receiver}/${path}`;
for (let i = 0; i < 40; i++) {
  const r = await fetch(url).catch(() => null);
  if (r?.ok) {
    const got = createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
    if (got === hash) {
      console.log(`✓ served: ${url}`);
      process.exit(0);
    }
  }
  await Bun.sleep(3000);
}
console.log(`uploaded, but ${url} isn't serving the right bytes yet — check again in a minute`);
