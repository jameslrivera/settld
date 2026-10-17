#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)"; exit 1; }; }
need solana "https://solana-install.solana.workers.dev"
need anchor "avm install 1.2.0 && avm use 1.2.0"
need node    "Node 22 or 23"
need python3 "Python 3.12+"

echo "== versions"
solana --version
anchor --version
node --version

echo "== program"
anchor build

echo "== client and dashboard"
npm install
(cd dashboard && npm install)

echo "== service"
python3 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r services/auth/requirements.txt

echo "== fraud model"
./.venv/bin/python ml/live_train.py

cat <<'TXT'

Next:
  cp .env.example .env     and fill in ANCHOR_PROVIDER_URL
  anchor deploy            deploy the program
  npx ts-node -P tsconfig.json scripts/seed.ts        config, vault, merchants

Then three processes:
  npx ts-node -P tsconfig.json services/chain/sidecar.ts
  CHAIN_URL=http://127.0.0.1:8787 ./.venv/bin/uvicorn services.auth.main:app --host 0.0.0.0 --port 8000
  (cd dashboard && npm run dev)

With a reader plugged in:
  MERCHANT_ID=1 ./.venv/bin/python services/auth/tap_listener.py
TXT
