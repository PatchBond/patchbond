//! On-chain check of a NEAR AI Cloud TEE signature, so a forfeit doesn't rest on our server's word.
//!
//! NEAR AI signs with EIP-191 personal-sign keys whose addresses are in its attestation report, in
//! one of two ways:
//! - a **model enclave** key (`signature_kind: provider_tee`, e.g. GLM-5.3-flash) signs
//!   `<model>:<sha256(request)>:<sha256(response)>` — the model is named in the signed text;
//! - the **gateway** key (`signature_kind: gateway`, e.g. Kimi K3) signs `<sha256(request)>:<sha256(response)>`
//!   for every model it serves — so the contract also needs the request bytes, to read which model
//!   was asked, and accepts a gateway key only for the model it was registered with (`0x…@model`).
//!   That keeps a non-TEE model served through the same gateway from ever counting.
//!
//! Given the exact response bytes, the contract recomputes the hashes, recovers the signer and reads
//! the model's own verdict out of the response.

use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near};

/// What the oracle attaches to a forfeit: enough for the contract to verify it alone.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TeeProof {
    /// The model id exactly as signed, e.g. "z-ai/glm-5.3-flash".
    pub model: String,
    /// Hex sha256 of the exact request bytes (the request itself is public on the verdict page).
    pub request_sha256: String,
    /// The exact response bytes returned by NEAR AI Cloud.
    pub response: String,
    /// The exact request bytes — needed for gateway-signed proofs (they name the model).
    pub request: Option<String>,
    /// 65-byte r‖s‖v signature, hex (0x optional).
    pub signature: String,
}

/// The model's own answer inside the signed response.
#[derive(Debug, PartialEq)]
pub struct SignedVerdict {
    /// Lower-case hex address that signed `<model>:<req>:<resp>` (a model enclave key), no 0x.
    pub signer: String,
    /// `<address>@<model>` that signed `<req>:<resp>` (a gateway key), when the request bytes were
    /// given, match the signed hash and ask for `proof.model`.
    pub gateway_signer: Option<String>,
    pub verdict: String,
    /// Confidence in basis points (0.9 → 9000).
    pub confidence_bps: u32,
    pub evidence: usize,
}

/// Verifies `proof` and returns who signed and what the model said, or why it can't be trusted.
pub fn verify(proof: &TeeProof) -> Result<SignedVerdict, String> {
    if !is_hex(&proof.request_sha256, 64) {
        return Err("request_sha256 must be 64 hex characters".into());
    }
    let request_sha256 = proof.request_sha256.to_lowercase();
    let response_sha256 = to_hex(&env::sha256_array(proof.response.as_bytes()));
    let signer = recover_eip191(&format!("{}:{}:{}", proof.model, request_sha256, response_sha256), &proof.signature)?;
    let gateway_signer = match &proof.request {
        Some(request) => {
            if to_hex(&env::sha256_array(request.as_bytes())) != request_sha256 {
                return Err("The request bytes don't match request_sha256".into());
            }
            let asked: Value = serde_json::from_str(request).map_err(|_| "The request isn't JSON".to_string())?;
            if asked["model"].as_str() != Some(proof.model.as_str()) {
                return Err(format!("The request asked for {}, not {}", asked["model"], proof.model));
            }
            let gateway = recover_eip191(&format!("{request_sha256}:{response_sha256}"), &proof.signature)?;
            Some(format!("{gateway}@{}", proof.model))
        }
        None => None,
    };

    let body: Value = serde_json::from_str(&proof.response).map_err(|_| "The signed response isn't JSON".to_string())?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("The signed response has no model answer")?;
    let answer: Value =
        serde_json::from_str(strip_fences(content)).map_err(|_| "The model's answer isn't valid JSON".to_string())?;
    let verdict = answer["verdict"].as_str().ok_or("The model's answer has no verdict")?.to_string();
    let confidence = answer["confidence"].as_f64().filter(|c| (0.0..=1.0).contains(c)).ok_or("The model's answer has no valid confidence")?;
    let evidence = answer["evidence"].as_array().map_or(0, |e| e.len());
    Ok(SignedVerdict { signer, gateway_signer, verdict, confidence_bps: (confidence * 10_000.0).round() as u32, evidence })
}

/// EIP-191 `personal_sign` recovery: returns the lower-case hex address (no 0x).
fn recover_eip191(text: &str, signature_hex: &str) -> Result<String, String> {
    let sig = from_hex(signature_hex.trim_start_matches("0x")).filter(|s| s.len() == 65).ok_or("signature must be 65 bytes of hex")?;
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let hash = env::keccak256_array(prefixed.as_bytes());
    let v = match sig[64] {
        27 | 28 => sig[64] - 27,
        0 | 1 => sig[64],
        _ => return Err("signature has an invalid recovery id".into()),
    };
    let public_key = env::ecrecover(&hash, &sig[..64], v, true).ok_or("The signature doesn't recover to a key")?;
    let address = env::keccak256_array(public_key);
    Ok(to_hex(&address[12..]))
}

/// "```json\n{…}\n```" → "{…}" (models sometimes fence their JSON; mirrors shared/src/verify.ts).
fn strip_fences(s: &str) -> &str {
    let t = s.trim();
    t.strip_prefix("```json").or_else(|| t.strip_prefix("```")).and_then(|r| r.strip_suffix("```")).map_or(t, str::trim)
}

pub fn normalize_address(a: &str) -> Option<String> {
    let a = a.trim_start_matches("0x").to_lowercase();
    is_hex(&a, 40).then_some(a)
}

/// A registered signer: `0x<address>` (a model enclave key) or `0x<address>@<model>` (a gateway key,
/// valid for that model only). Returns the stored form: lower-case address, no 0x, `@model` kept.
pub fn normalize_signer(s: &str) -> Option<String> {
    match s.split_once('@') {
        Some((addr, model)) if !model.is_empty() && model.len() <= 100 => Some(format!("{}@{model}", normalize_address(addr)?)),
        Some(_) => None,
        None => normalize_address(s),
    }
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fences_and_hex() {
        assert_eq!(strip_fences("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_fences(" {\"a\":1} "), "{\"a\":1}");
        assert_eq!(from_hex("0aff").unwrap(), vec![10, 255]);
        assert!(from_hex("0g").is_none());
        assert_eq!(normalize_address("0x3B753B4406613C5E70AE640508632B600424FA0C").unwrap(), "3b753b4406613c5e70ae640508632b600424fa0c");
        assert_eq!(normalize_signer("0xB98A789CDC4817275F5155593BA73EF2A957E779@moonshotai/kimi-k3").unwrap(), "b98a789cdc4817275f5155593ba73ef2a957e779@moonshotai/kimi-k3");
        assert!(normalize_signer("0xb98a@kimi").is_none());
        assert!(normalize_signer("0xb98a789cdc4817275f5155593ba73ef2a957e779@").is_none());
    }
}
