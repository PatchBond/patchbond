#!/usr/bin/env bash
# The sandbox demo with nothing to compile: downloads the release bundle for this machine, checks its
# sha256 and runs it. Same demo as `bun run demo`, built by .github/workflows/release.yml.
#   bash scripts/demo-fast.sh
#   PATCHBOND_DEMO_TARBALL=/path/to/bundle.tar.gz bash scripts/demo-fast.sh   (a bundle you built)
set -euo pipefail

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) target=linux-x64 ;;
  Darwin-arm64) target=macos-arm64 ;;
  *) echo "No prebuilt demo for $(uname -s) $(uname -m). Use: bun run demo" >&2; exit 1 ;;
esac

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
file=patchbond-demo-$target.tar.gz

if [ -n "${PATCHBOND_DEMO_TARBALL:-}" ]; then
  cp "$PATCHBOND_DEMO_TARBALL" "$dir/$file"
else
  base=https://github.com/PatchBond/patchbond/releases/latest/download
  curl -fsSL "$base/$file" -o "$dir/$file"
  curl -fsSL "$base/$file.sha256" -o "$dir/$file.sha256"
  (cd "$dir" && shasum -a 256 -c "$file.sha256")
fi

tar xzf "$dir/$file" -C "$dir"
PATCHBOND_PREBUILT_DIR="$dir" "$dir/demo"
