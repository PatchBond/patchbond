//! Sealed security reports — the enclave side of `shared/src/sealed.ts` (same envelope format).
//! The enclave opens reports sealed to its key, and seals its verdict back to the maintainer.

use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const INFO: &[u8] = b"patchbond sealed v1";
pub const ALG: &str = "x25519-hkdf-sha256-chacha20poly1305";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Recipient {
    pub kid: String,
    pub epk: String,
    pub wnonce: String,
    pub wk: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u8,
    pub alg: String,
    pub nonce: String,
    pub ct: String,
    pub to: Vec<Recipient>,
}

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}
fn unb64(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD.decode(s).map_err(|e| format!("bad base64: {e}"))
}
fn key32(hex_str: &str) -> Result<[u8; 32], String> {
    hex::decode(hex_str).ok().and_then(|v| v.try_into().ok()).ok_or_else(|| "expected 32 bytes of hex".to_string())
}

fn kek(shared: &[u8; 32], epk: &[u8; 32], rpk: &[u8; 32]) -> [u8; 32] {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(epk);
    salt[32..].copy_from_slice(rpk);
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared).expand(INFO, &mut out).expect("32 bytes is a valid HKDF length");
    out
}

/// The enclave's X25519 secret, from its OutLayer-generated `PROTECTED_REPORT_KEY` (never seen by anyone).
pub fn enclave_secret(protected: &str) -> [u8; 32] {
    Sha256::new().chain_update(b"patchbond enclave report key v1:").chain_update(protected.as_bytes()).finalize().into()
}

pub fn public_key(secret: &[u8; 32]) -> String {
    hex::encode(PublicKey::from(&StaticSecret::from(*secret)).as_bytes())
}

pub fn open(env: &Envelope, secret: &[u8; 32]) -> Result<String, String> {
    let sk = StaticSecret::from(*secret);
    let pk = PublicKey::from(&sk);
    let kid = hex::encode(pk.as_bytes());
    let r = env.to.iter().find(|t| t.kid == kid).ok_or("this report wasn't sealed to the enclave's key")?;
    let epk = key32(&r.epk)?;
    let shared = sk.diffie_hellman(&PublicKey::from(epk));
    let wrap = ChaCha20Poly1305::new(&kek(shared.as_bytes(), &epk, pk.as_bytes()).into());
    let key = wrap
        .decrypt(Nonce::from_slice(&unb64(&r.wnonce)?), unb64(&r.wk)?.as_slice())
        .map_err(|_| "the wrapped key doesn't decrypt".to_string())?;
    let content = ChaCha20Poly1305::new_from_slice(&key).map_err(|_| "bad content key")?;
    let pt = content
        .decrypt(Nonce::from_slice(&unb64(&env.nonce)?), Payload { msg: &unb64(&env.ct)?, aad: INFO })
        .map_err(|_| "the report doesn't decrypt (tampered?)".to_string())?;
    String::from_utf8(pt).map_err(|_| "the report isn't UTF-8".into())
}

/// Seals `plaintext` to `recipients` (X25519 public keys, hex). Randomness is derived from
/// `seed` (the enclave's secret) and the message, so each message/recipient gets fresh keys.
pub fn seal(plaintext: &str, recipients: &[&str], seed: &[u8; 32]) -> Result<Envelope, String> {
    let derive = |label: &str, extra: &[u8]| -> [u8; 32] {
        Sha256::new().chain_update(label.as_bytes()).chain_update(seed).chain_update(plaintext.as_bytes()).chain_update(extra).finalize().into()
    };
    let key = derive("content key", b"");
    let nonce = &derive("content nonce", b"")[..12];
    let ct = ChaCha20Poly1305::new(&key.into())
        .encrypt(Nonce::from_slice(nonce), Payload { msg: plaintext.as_bytes(), aad: INFO })
        .map_err(|_| "encryption failed")?;
    let mut to = vec![];
    for r in recipients {
        let rpk = key32(r)?;
        let esk = StaticSecret::from(derive("ephemeral", &rpk));
        let epk = PublicKey::from(&esk);
        let wnonce = &derive("wrap nonce", &rpk)[..12];
        let shared = esk.diffie_hellman(&PublicKey::from(rpk));
        let wk = ChaCha20Poly1305::new(&kek(shared.as_bytes(), epk.as_bytes(), &rpk).into())
            .encrypt(Nonce::from_slice(wnonce), key.as_slice())
            .map_err(|_| "wrap failed")?;
        to.push(Recipient { kid: r.to_lowercase(), epk: hex::encode(epk.as_bytes()), wnonce: b64(wnonce), wk: b64(&wk) });
    }
    Ok(Envelope { v: 1, alg: ALG.into(), nonce: b64(nonce), ct: b64(&ct), to })
}
