#!/usr/bin/env bash
# The single verification command for this repository: `npm run verify`.
# Installs nothing. Prerequisites: `npm ci` and `uv sync --locked`.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== tenric verify"
echo "revision: $(git rev-parse HEAD 2>/dev/null || echo none)$([ -n "$(git status --porcelain 2>/dev/null)" ] && echo ' (dirty)' || true)"
echo "node $(node --version), $(uv run --locked python --version 2>/dev/null), $(uname -sm)"

# Evidence is always collected from a committed tree, because a run from a dirty
# tree is rejected by the contract (R-006). When the working tree has
# uncommitted changes, they are written to a snapshot commit (no branch, no
# change to the index or to HEAD) and the experiment runs from a checkout of it.
src="."
cleanup() { git worktree remove --force runs/.snapshot >/dev/null 2>&1 || true; rm -rf runs/.snapshot; git worktree prune >/dev/null 2>&1 || true; }
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  cleanup
  mkdir -p runs
  index="$(git rev-parse --git-dir)/tenric-verify-index"
  rm -f "$index"
  tree=$(GIT_INDEX_FILE="$index" sh -c 'git read-tree HEAD && git add -A && git write-tree')
  rm -f "$index"
  snapshot=$(git -c user.name=tenric-verify -c user.email=tenric-verify@invalid \
    commit-tree "$tree" -p HEAD -m "Snapshot of an uncommitted working tree, made by scripts/verify.sh")
  git worktree add --quiet --detach runs/.snapshot "$snapshot"
  trap cleanup EXIT
  src="runs/.snapshot"
  echo "evidence is collected at snapshot commit $snapshot"
fi
collector="$src/experiments/baseline/run_baseline.py"

echo "== 1/4 typecheck"
npx tsc --noEmit

echo "== 2/4 baseline experiment, executed twice, then once with a broken config and once with a timeout it cannot meet"
rm -rf runs/verify-a runs/verify-b runs/verify-fail runs/verify-timeout runs/broken-config.json runs/verdict.json
uv run --locked python "$collector" --out runs/verify-a
uv run --locked python "$collector" --out runs/verify-b
sha256sum runs/verify-a/metrics.json runs/verify-b/metrics.json \
          runs/verify-a/figures/confusion_matrix.png runs/verify-b/figures/confusion_matrix.png

sed 's/"max_iter": 2000/"max_iter": "not-a-number"/' experiments/baseline/config.json > runs/broken-config.json
if uv run --locked python "$collector" --out runs/verify-fail --config runs/broken-config.json; then
  echo "expected the broken run to exit non-zero" >&2; exit 1
fi
if uv run --locked python "$collector" --out runs/verify-timeout --timeout 0.01; then
  echo "expected the timed-out run to exit non-zero" >&2; exit 1
fi

cleanup

echo "== 3/4 tests"
npx vitest run

echo "== 4/4 verdict for the baseline run, with re-execution"
node src/cli.ts verify runs/verify-a --contract spec/contracts/research.experiment-report/0.2.0.contract.json \
  --repo . --reproduce --task experiments/baseline/task.json --record runs/verdict.json

echo "== verify: OK"
