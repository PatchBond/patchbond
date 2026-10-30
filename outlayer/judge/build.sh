#!/usr/bin/env bash
# Builds the enclave program reproducibly: local paths are stripped from the binary, so the same
# source + Cargo.lock + Rust toolchain gives the same sha256 on any machine. That hash is what the
# contract pins (`set_outlayer` → version_key) and what OutLayer's worker checks before running it.
#   bash outlayer/judge/build.sh        → prints the wasm path and its sha256
set -euo pipefail
cd "$(dirname "$0")"
export RUSTFLAGS="--remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$PWD=/judge --remap-path-prefix=$(rustc --print sysroot)=/rust"
export CARGO_TARGET_DIR="$PWD/target"
cargo build --locked --release --target wasm32-wasip2 >&2
mkdir -p dist
cp target/wasm32-wasip2/release/patchbond-judge.wasm dist/patchbond-judge.wasm
echo "rustc $(rustc --version | cut -d' ' -f2)" >&2
echo "dist/patchbond-judge.wasm"
shasum -a 256 dist/patchbond-judge.wasm | cut -d' ' -f1
