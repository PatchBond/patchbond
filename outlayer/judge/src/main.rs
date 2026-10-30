//! The enclave side: reads the contract's `input_data` on stdin, fetches the PR from GitHub, asks
//! NEAR AI, prints the ≤900-byte result for the contract and publishes the full record.
//!
//! Secrets (OutLayer encrypted, injected as env): NEARAI_API_KEY (required), GITHUB_TOKEN (optional,
//! read-only — only for rate limits; public repos need none).

#[cfg(target_os = "wasi")]
mod enclave;
#[cfg(target_os = "wasi")]
mod http;

fn main() {
    #[cfg(target_os = "wasi")]
    enclave::run();
    #[cfg(not(target_os = "wasi"))]
    eprintln!("Build for wasm32-wasip2: cargo build --release --target wasm32-wasip2");
}
