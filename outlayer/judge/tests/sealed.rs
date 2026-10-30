//! The enclave opens what the browser sealed (fixture written by shared/src/sealed.test.ts), and
//! what it seals for the maintainer round-trips.
use patchbond_judge::sealed::{open, public_key, seal, Envelope};
use serde_json::Value;

#[test]
fn opens_what_the_browser_sealed_and_seals_back() {
    let fx: Value = serde_json::from_str(include_str!("fixtures/sealed.json")).unwrap();
    let env: Envelope = serde_json::from_str(fx["envelope"].as_str().unwrap()).unwrap();
    let secret: [u8; 32] = hex::decode(fx["enclave_secret"].as_str().unwrap()).unwrap().try_into().unwrap();
    assert_eq!(open(&env, &secret).unwrap(), fx["plaintext"].as_str().unwrap());

    // Sealed back to the enclave's own key (stand-in for the maintainer's), it opens again.
    let me = public_key(&secret);
    let back = seal("verdict: real vulnerability", &[&me], &secret).unwrap();
    assert_eq!(open(&back, &secret).unwrap(), "verdict: real vulnerability");

    // Not sealed to it: refused; tampered: refused.
    let other = [9u8; 32];
    assert!(open(&env, &other).is_err());
    let mut bad = env.clone();
    bad.ct.replace_range(0..4, "AAAA");
    assert!(open(&bad, &secret).is_err());
}
