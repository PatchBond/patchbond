#!/usr/bin/env bash
# Copies PatchBond's secrets from your local .env (and the oracle key from near-cli's keychain) into the
# linked Railway service, then deploys. Run it yourself — it prints variable names, never values.
#   railway link   # once, to the patchbond project/service
#   bash scripts/railway-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

val() { # value of KEY in .env, without surrounding quotes
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2-)
  v="${v%\"}"; v="${v#\"}"
  [ -n "$v" ] || { echo "missing $1 in .env" >&2; exit 1; }
  printf '%s' "$v"
}

NETWORK=$(grep -E '^NEAR_NETWORK=' .env | cut -d= -f2 || true)
ORACLE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["oracle"])' "deploy/${NETWORK:-testnet}.json")
KEYFILE="$HOME/.near-credentials/${NETWORK:-testnet}/$ORACLE.json"
ORACLE_KEY=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["private_key"])' "$KEYFILE")

railway variables --skip-deploys \
  --set "ORACLE_PRIVATE_KEY=$ORACLE_KEY" \
  --set "NEARAI_API_KEY=$(val NEARAI_API_KEY)" \
  --set "GITHUB_PRIVATE_KEY=$(val GITHUB_PRIVATE_KEY)" \
  --set "GITHUB_WEBHOOK_SECRET=$(val GITHUB_WEBHOOK_SECRET)" \
  --set "GITHUB_CLIENT_SECRET=$(val GITHUB_CLIENT_SECRET)" \
  --set "SESSION_SECRET=$(openssl rand -hex 32)" >/dev/null
echo "set: ORACLE_PRIVATE_KEY NEARAI_API_KEY GITHUB_PRIVATE_KEY GITHUB_WEBHOOK_SECRET GITHUB_CLIENT_SECRET SESSION_SECRET"

railway up --detach
echo "deploying — follow it with: railway logs"
