#!/usr/bin/env bash
# The sandbox demo with nothing to compile: downloads the release bundle for this machine, checks its
# sha256 and runs it. Same demo as `bun run demo`, built by .github/workflows/release.yml. With no
# bundle for this machine (no release, or another OS), it builds from source instead if it can.
#   bash scripts/demo-fast.sh
#   PATCHBOND_DEMO_TARBALL=/path/to/bundle.tar.gz bash scripts/demo-fast.sh   (a bundle you built)
set -euo pipefail

# Same demo, compiled here: needs Bun, Rust and cargo-near; about 10 minutes the first time.
from_source() {
  echo "$1" >&2
  missing=""
  for tool in bun cargo cargo-near; do command -v "$tool" >/dev/null || missing="$missing $tool"; done
  if [ -n "$missing" ]; then
    echo "Building it here needs:$missing (see docs/REPRODUCE.md). Or skip the build: the hosted demo at https://patchbond-production.up.railway.app shows real signed verdicts." >&2
    exit 1
  fi
  echo "Building the demo from source instead (about 10 minutes the first time)..." >&2
  bun install && exec bun run demo
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) target=linux-x64 ;;
  Darwin-arm64) target=macos-arm64 ;;
  *) from_source "No prebuilt demo for $(uname -s) $(uname -m)." ;;
esac

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
file=patchbond-demo-$target.tar.gz

if [ -n "${PATCHBOND_DEMO_TARBALL:-}" ]; then
  cp "$PATCHBOND_DEMO_TARBALL" "$dir/$file"
else
  base=https://github.com/PatchBond/patchbond/releases/latest/download
  curl -fsSL "$base/$file" -o "$dir/$file" || from_source "Couldn't download $file (no release published yet, or no network)."
  curl -fsSL "$base/$file.sha256" -o "$dir/$file.sha256"
  # sha256sum on Linux (minimal images have no shasum), shasum on macOS
  if command -v sha256sum >/dev/null; then sum="sha256sum"; else sum="shasum -a 256"; fi
  (cd "$dir" && $sum -c "$file.sha256")
fi

tar xzf "$dir/$file" -C "$dir"
PATCHBOND_PREBUILT_DIR="$dir" NEAR_SANDBOX_BIN_PATH="$dir/near-sandbox" "$dir/demo"
