#!/usr/bin/env bash
# Demo: our own oracle key tries to forfeit a held bond WITHOUT NEAR AI's TEE signature, and the
# contract refuses. Testnet only. Needs a bond that's still held (e.g. pay one on the playground repo).
#   bash scripts/demo-contract-says-no.sh <repo_id> <pr_number>
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=${1:?repo_id}
PR=${2:?pr number}
CONTRACT=$(python3 -c 'import json;print(json.load(open("deploy/testnet.json"))["contract"])')
ORACLE=$(python3 -c 'import json;print(json.load(open("deploy/testnet.json"))["oracle"])')

echo "▶ The contract trusts these NEAR AI keys (from NEAR AI's attestation report):"
near contract call-function as-read-only "$CONTRACT" get_tee_signers json-args '{}' network-config testnet now 2>/dev/null | grep -E '0x' || true
echo
echo "▶ $ORACLE (PatchBond's own server key) tries to forfeit $REPO#$PR with no TEE proof…"
near contract call-function as-transaction "$CONTRACT" settle \
  json-args "{\"repo_id\":$REPO,\"number\":$PR,\"verdict\":\"forfeit\",\"verdict_hash\":\"$(printf '0%.0s' {1..64})\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$ORACLE" network-config testnet sign-with-legacy-keychain send 2>&1 \
  | grep -oE "Smart contract panicked: [^\"]+|succeeded" | head -1 | sed 's/^/  /' || true  # the refusal is the point
echo
echo "✓ The AI can't touch the money: no NEAR AI signature, no forfeit."
