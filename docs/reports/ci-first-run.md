# First CI run: `npm run verify` on three hosted platforms

| | |
| --- | --- |
| Date | 2026-11-25 |
| Run | https://github.com/lytreallynb/Tenric/actions/runs/45710167258 (pull request #1, attempt 1) |
| Revision under test | `c029d0e776547e2798ac5e556de7c502909e4e85`, the merge of branch commit `eca97af` into `main` at `410f26d`. Sources under `src/`, `spec/`, `tests/`, `scripts/` and `experiments/` are identical to `410f26d`. |
| Status | Reproducible execution (G6): **independently verified** on the three platforms below, with the limits in section 4. Cross-platform byte identity (G5): **does not hold** for the figure, and does not hold on Windows for the two JSON outputs. |
| Author | An AI agent (Claude). Not approved. |

## 1. What ran

`.github/workflows/verify.yml` ran `npm ci && uv sync --locked`, then `npm run verify` unchanged, on GitHub-hosted runners. Nothing was adjusted between writing the workflow and this run; this is its first execution.

| Runner | Platform line printed by `verify.sh` | Result |
| --- | --- | --- |
| `ubuntu-24.04` | `node v22.23.5, Python 3.13.14, Linux x86_64` | `Tests  39 passed (39)`, `== verify: OK` |
| `macos-15` | `node v22.23.5, Python 3.13.17, Darwin arm64` | `Tests  39 passed (39)`, `== verify: OK` |
| `windows-2025` | `node v22.23.5, Python 3.13.17, MINGW64_NT-10.0-26100 x86_64` | `Tests  39 passed (39)`, `== verify: OK` |

On each platform the two consecutive executions produced equal digests for `metrics.json` and the PNG (the lines printed by `verify.sh`), so same-platform byte identity held on all three.

## 2. Digests across platforms

From the `compare outputs across platforms` job log, timestamps removed:

```
metrics.json  ubuntu-24.04  76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53
metrics.json  macos-15  76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53
metrics.json  windows-2025  f5f9b7d76d15ab62c7033b0a1c3cd28aa0d7d40d20b92715501d173437bb43e9
##[warning]metrics.json is not byte-identical across platforms
figures/confusion_matrix.spec.json  ubuntu-24.04  c34a7c08ff4fd7d678a6dafa7caf11752700ac0f260b33fb093e18935d20ead1
figures/confusion_matrix.spec.json  macos-15  c34a7c08ff4fd7d678a6dafa7caf11752700ac0f260b33fb093e18935d20ead1
figures/confusion_matrix.spec.json  windows-2025  786d8717aed1f32dce35278b70119b2ddf2f9feb957b04e08509339a6bb87d65
##[warning]figures/confusion_matrix.spec.json is not byte-identical across platforms
figures/confusion_matrix.png  ubuntu-24.04  3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e
figures/confusion_matrix.png  macos-15  9964a0454406fe7bf11c6afd2bc8891f62e1bc564706474ddf75bacd63196aac
figures/confusion_matrix.png  windows-2025  9964a0454406fe7bf11c6afd2bc8891f62e1bc564706474ddf75bacd63196aac
##[warning]figures/confusion_matrix.png is not byte-identical across platforms
Result: outputs **differ** between platforms. See the table and the job log.
```

The job also printed each platform's `metrics.json`. The text was the same on all three: accuracy `0.9644444444444444`, macro F1 `0.9645031736305597`, reference accuracy `0.10222222222222223`, dataset digest `f6d9e39f…0443`.

## 3. Findings

1. **The hosted Linux runner reproduced the Phase 0 machine exactly.** All three digests equal the ones in the Phase 0 report, on a different machine, with Python 3.13.14 instead of 3.13.18.
2. **Metric values were identical on all three platforms**, including arm64. The contract's cross-platform tolerance of 0.01 on accuracy was not exercised: the observed difference is zero. One dataset, one seed, one model; this is not evidence about numerical agreement in general.
3. **On Windows the two JSON outputs have different bytes and the same content. Cause confirmed: line endings.** `experiments/baseline/experiment.py` line 38 writes with `Path.write_text` in text mode, which emits CRLF on Windows. Converting the Linux files to CRLF locally (`sed 's/$/\r/' <file> | sha256sum`) gives exactly `f5f9b7d7…43e9` and `786d8717…7d65`. The same applies to `artifact.json` and `report.md` written by the collector. This is an uncontrolled input that `docs/reproducibility.md` section 2 does not list. Not fixed here.
4. **The PNG differs between Linux and the other two platforms, and is identical between macOS arm64 and Windows x86_64. Cause not determined.** It does not follow CPU architecture or the Python patch version alone (macOS and Windows share 3.13.17, so that is not ruled out as a factor against Linux). The run directories are stored as workflow artifacts for 14 days; decoding both PNGs and comparing pixels would show whether the rendering differs or only the encoding.
5. **The Python patch version is not controlled.** Three different patch versions were used across the Phase 0 machine and the runners (3.13.18, 3.13.14, 3.13.17), because `.python-version` pins `3.13` and uv uses an interpreter already on the machine when one matches. `docs/reproducibility.md` already says the minor version only is pinned; this run shows the consequence.

## 4. Limits of this evidence

- One run, one attempt. Nothing here says the results are stable across runner image updates.
- The workflow was written and triggered by the same author as the code. The machines are independent; the party is not.
- A passing `verify` does not mean the baseline is accepted. Its verdict under contract `research.experiment-report` 0.1.0 is still `inconclusive`, and a test asserts that.
- The collector is not isolated from the producer in CI either.
- The digests were read from job logs. The workflow artifacts were not downloaded and re-hashed outside GitHub.

## 5. Decisions this raises for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Should JSON and report outputs be written with `\n` on every platform? | Yes: pass `newline="\n"` in the experiment and the collector. It makes `byte-identical` mean the same thing on Windows. It changes how evidence is written, so it is a separate change, not part of this pull request. |
| 2 | Should the PNG stay declared `byte-identical`? | Keep the declaration as defined (same platform), and investigate finding 4 before promising more. |
| 3 | Should the Python patch version be pinned exactly? | Pin it in `.python-version` and let uv install it, so that the interpreter stops being a per-machine variable. |
