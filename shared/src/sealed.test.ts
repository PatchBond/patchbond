// Sealed reports open only for their recipients, tampering fails, and the enclave program (Rust)
// opens what the browser seals — fixtures/sealed.json is read by outlayer/judge/tests/sealed.rs.
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { envelopeHash, maintainerKeyFromSignature, open, publicKeyOf, seal } from "./sealed";

const maintainer = maintainerKeyFromSignature(new Uint8Array(64).fill(7));
const enclave = "11".repeat(32);
const stranger = "22".repeat(32);

describe("sealed reports", () => {
  test("both recipients open it; nobody else can; tampering fails", () => {
    const env = seal("SQL injection in /api/login via the `user` param", [publicKeyOf(maintainer), publicKeyOf(enclave)]);
    expect(open(env, maintainer)).toContain("SQL injection");
    expect(open(env, enclave)).toContain("SQL injection");
    expect(() => open(env, stranger)).toThrow("wasn't sealed to your key");
    const bad = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    expect(() => open(bad, maintainer)).toThrow();
  });

  test("the maintainer key is reproducible from the same signature", () => {
    expect(maintainerKeyFromSignature(new Uint8Array(64).fill(7))).toBe(maintainer);
    expect(maintainerKeyFromSignature(new Uint8Array(64).fill(8))).not.toBe(maintainer);
  });

  test("writes the cross-language fixture", () => {
    let n = 0;
    const rand = (k: number) => Uint8Array.from({ length: k }, () => (n++ * 37 + 11) & 255);
    const plaintext = "Report: the `withdraw` function skips the owner check (src/vault.rs:42). Steps: call withdraw from any account.";
    const env = seal(plaintext, [publicKeyOf(maintainer), publicKeyOf(enclave)], rand);
    const json = JSON.stringify(env);
    writeFileSync(join(import.meta.dir, "../../outlayer/judge/tests/fixtures/sealed.json"), JSON.stringify({ enclave_secret: enclave, maintainer_public: publicKeyOf(maintainer), envelope: json, sha256: envelopeHash(env), plaintext }, null, 1));
    expect(open(JSON.parse(json), enclave)).toBe(plaintext);
  });
});
