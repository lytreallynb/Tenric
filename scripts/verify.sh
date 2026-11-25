#!/usr/bin/env bash
# The single verification command for this repository: `npm run verify`.
# Installs nothing. Prerequisites: `npm ci` and `uv sync --locked`.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== tenric verify"
echo "revision: $(git rev-parse HEAD 2>/dev/null || echo none)$([ -n "$(git status --porcelain 2>/dev/null)" ] && echo ' (dirty)' || true)"
echo "node $(node --version), $(uv run --locked python --version 2>/dev/null), $(uname -sm)"

echo "== 1/3 typecheck"
npx tsc --noEmit

echo "== 2/3 baseline experiment, executed twice"
rm -rf runs/verify-a runs/verify-b
uv run --locked python experiments/baseline/run_baseline.py --out runs/verify-a
uv run --locked python experiments/baseline/run_baseline.py --out runs/verify-b
sha256sum runs/verify-a/metrics.json runs/verify-b/metrics.json \
          runs/verify-a/figures/confusion_matrix.png runs/verify-b/figures/confusion_matrix.png

echo "== 3/3 tests"
npx vitest run

echo "== verify: OK"
