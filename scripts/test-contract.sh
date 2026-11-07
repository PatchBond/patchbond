#!/usr/bin/env bash
# Every contract test, one at a time, writing nothing outside this repo: builds the three contracts
# once into contract/target/prebuilt, then runs each sandbox test against those builds. Parallel
# sandbox tests each start a NEAR node, which can stall a small machine; serial is slower but steady.
#   bash scripts/test-contract.sh                 (all suites)
#   bash scripts/test-contract.sh --test bounty   (one suite; arguments go to cargo test)
set -euo pipefail
cd "$(dirname "$0")/../contract"

# cargo near keeps a CLI config under $HOME; a HOME inside target/ keeps that write in the repo
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}" RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
mkdir -p target/home target/prebuilt
for c in vault mock-ft mock-outlayer; do
  HOME="$PWD/target/home" cargo near build non-reproducible-wasm --manifest-path "$c/Cargo.toml"
done
find target/near -name '*.wasm' -exec cp {} target/prebuilt/ \;

PATCHBOND_PREBUILT_DIR="$PWD/target/prebuilt" cargo test -p patchbond-vault "$@" -- --test-threads=1
