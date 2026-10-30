// Sealed security reports: a report is encrypted in the reporter's browser to two keys — the
// maintainer's and the OutLayer enclave judge's — so PatchBond's server, and the public, only ever
// see ciphertext. outlayer/judge/src/sealed.rs implements the same format; a fixture checks they agree.
//
// Envelope v1: the report is encrypted once with a random content key (ChaCha20-Poly1305); the
// content key is wrapped for each recipient with X25519 → HKDF-SHA256 → ChaCha20-Poly1305.

import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

export const SEALED_ALG = "x25519-hkdf-sha256-chacha20poly1305";
const INFO = utf8ToBytes("patchbond sealed v1");

export interface Recipient {
  /** Recipient's X25519 public key, hex. */
  kid: string;
  /** Ephemeral X25519 public key, hex. */
  epk: string;
  /** Nonce and wrapped content key, base64. */
  wnonce: string;
  wk: string;
}

export interface Envelope {
  v: 1;
  alg: typeof SEALED_ALG;
  nonce: string;
  ct: string;
  to: Recipient[];
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function kek(shared: Uint8Array, epk: Uint8Array, rpk: Uint8Array): Uint8Array {
  const salt = new Uint8Array(64);
  salt.set(epk);
  salt.set(rpk, 32);
  return hkdf(sha256, shared, salt, INFO, 32);
}

/** Encrypts `plaintext` so that each of `recipients` (X25519 public keys, hex) can open it. */
export function seal(plaintext: string, recipients: string[], rand: (n: number) => Uint8Array = randomBytes): Envelope {
  const key = rand(32);
  const nonce = rand(12);
  const ct = chacha20poly1305(key, nonce, INFO).encrypt(utf8ToBytes(plaintext));
  const to = recipients.map((hex) => {
    const rpk = hexToBytes(hex);
    const esk = rand(32);
    const epk = x25519.getPublicKey(esk);
    const wnonce = rand(12);
    const wk = chacha20poly1305(kek(x25519.getSharedSecret(esk, rpk), epk, rpk), wnonce).encrypt(key);
    return { kid: hex.toLowerCase(), epk: bytesToHex(epk), wnonce: b64(wnonce), wk: b64(wk) };
  });
  return { v: 1, alg: SEALED_ALG, nonce: b64(nonce), ct: b64(ct), to };
}

/** Opens an envelope with an X25519 secret key (hex). Throws if this key isn't a recipient. */
export function open(env: Envelope, secretHex: string): string {
  const sk = hexToBytes(secretHex);
  const pk = bytesToHex(x25519.getPublicKey(sk));
  const r = env.to.find((t) => t.kid === pk);
  if (!r) throw new Error("This report wasn't sealed to your key.");
  const epk = hexToBytes(r.epk);
  const key = chacha20poly1305(kek(x25519.getSharedSecret(sk, epk), epk, hexToBytes(pk)), unb64(r.wnonce)).decrypt(unb64(r.wk));
  return new TextDecoder().decode(chacha20poly1305(key, unb64(env.nonce), INFO).decrypt(unb64(env.ct)));
}

export const publicKeyOf = (secretHex: string) => bytesToHex(x25519.getPublicKey(hexToBytes(secretHex)));

/**
 * The maintainer's report key, derived from a wallet signature over a fixed message — nothing to
 * store: sign the same message again and the same key comes back (ed25519 signatures are
 * deterministic). Returns the X25519 secret key, hex.
 */
export function maintainerKeyFromSignature(signature: Uint8Array): string {
  return bytesToHex(sha256(new Uint8Array([...utf8ToBytes("patchbond report key v1:"), ...signature])));
}

/** The message a maintainer signs to derive their report key (one per payout account). */
export const reportKeyMessage = (account: string) =>
  `PatchBond sealed security reports: derive my decryption key for ${account}. Signing this costs nothing and moves no funds.`;

/** sha256 of the envelope's canonical JSON — what the bond is bound to on-chain. */
export const envelopeHash = (env: Envelope) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(env))));
