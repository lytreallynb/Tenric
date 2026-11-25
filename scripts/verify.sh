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

echo "== 2/3 baseline experiment, executed twice, then once with a broken config and once with a timeout it cannot meet"
rm -rf runs/verify-a runs/verify-b runs/verify-fail runs/verify-timeout runs/broken-config.json
uv run --locked python experiments/baseline/run_baseline.py --out runs/verify-a
uv run --locked python experiments/baseline/run_baseline.py --out runs/verify-b
sha256sum runs/verify-a/metrics.json runs/verify-b/metrics.json \
          runs/verify-a/figures/confusion_matrix.png runs/verify-b/figures/confusion_matrix.png

sed 's/"max_iter": 2000/"max_iter": "not-a-number"/' experiments/baseline/config.json > runs/broken-config.json
if uv run --locked python experiments/baseline/run_baseline.py --out runs/verify-fail --config runs/broken-config.json; then
  echo "expected the broken run to exit non-zero" >&2; exit 1
fi
if uv run --locked python experiments/baseline/run_baseline.py --out runs/verify-timeout --timeout 0.01; then
  echo "expected the timed-out run to exit non-zero" >&2; exit 1
fi

echo "== 3/3 tests"
npx vitest run

echo "== verify: OK"
