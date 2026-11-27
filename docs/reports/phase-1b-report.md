# Phase 1 slices 1B and 1C (part): verdict binding, re-execution, bypass regression tests

| | |
| --- | --- |
| Date | 2026-11-27 |
| Revision quoted | `8b3ace668a2d5c475739a5155a38d644d03c9235` for the local run; CI run 45937521527 for the three platforms, at `d7d684a` merged into `main` (merge commit `7040e20`). The commits between the two change the path separator in the verdict record and documentation only |
| Status | **Tested**. Not independently verified by a second party, not approved |
| Author | An AI agent (Claude) |
| Decisions | `docs/adr/0007-trust-boundary-and-verdict-binding.md`, `docs/adr/0008-re-execution-by-the-verifier.md` |

This responds to the engineering review of 2026-11-25, in its order of priority. It also carries pull requests 1 and 2: their commits are replayed here in sequence, with the one conflict (`docs/open-questions.md`) resolved by keeping both statements.

## 1. What changed

| Review item | Change | Where |
| --- | --- | --- |
| PR 2 never ran in CI and conflicted with PR 1 | Both are on this branch; CI ran on three platforms | section 4 |
| Verdict not bound to contract content (A4, A5) | Contract registry with SHA-256 per id and version; no verdict for a file that differs; verdict record names contract, registry, artifact and verifier | `src/spec.ts`, `src/verify.ts`, `spec/contracts/registry.json` |
| Empty lists pass vacuously; a fixture is not rejected (A2, A3) | Contract 0.2.0 adds R-010 and R-011 | `spec/contracts/research.experiment-report/0.2.0.contract.json`, `src/checks.ts` |
| Self-consistent forgeries pass (A1, A6); R-008 missing | The verifier re-executes the recorded revision in a fresh worktree with a scrubbed environment | `src/reproduce.ts`, `experiments/baseline/task.json` |
| Collector passes the whole environment to the experiment (A6) | `PYTHON*` variables removed, `-s` | `experiments/baseline/run_baseline.py` |
| `rejected` and `inconclusive` share an exit code; no machine-readable output | Exit 0, 1, 3 and 2; `--json`, `--record` | `src/cli.ts` |
| Contract fields nobody read | Artifact type and IR version are checked by R-001; `schema_sha256` is checked before any verdict | `src/checks.ts`, `src/spec.ts` |
| 19 of 60 tests fail with uncommitted changes | `verify.sh` collects from a snapshot commit when the tree is dirty | `scripts/verify.sh` |
| CRLF on Windows, unpinned Python patch, `>=` in pyproject | `newline="\n"`, `.gitattributes`, Python 3.13.14, exact pins | section 5 |
| PNG differs across platforms, cause unknown | Diagnosed: same pixels, different compression | section 5 |
| Trust boundary undefined; CI runs the PR's own verifier | Boundary written down; CI job that uses the base commit's verifier | ADR-0007, `.github/workflows/verify.yml` |

Size: `src/` went from about 320 to about 690 lines of TypeScript, tests from 60 to 108.

## 2. `npm run verify` at 8b3ace6

Linux x86_64, from a clean tree. Output unedited except for one repeated uv deprecation warning removed:

```
== tenric verify
revision: 8b3ace668a2d5c475739a5155a38d644d03c9235
node v22.23.5, Python 3.13.14, Linux x86_64
== 1/4 typecheck
== 2/4 baseline experiment, executed twice, then once with a broken config and once with a timeout it cannot meet
succeeded: wrote /home/claude/tenric/runs/verify-a/artifact.json
succeeded: wrote /home/claude/tenric/runs/verify-b/artifact.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-a/metrics.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-b/metrics.json
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-a/figures/confusion_matrix.png
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-b/figures/confusion_matrix.png
failed: wrote /home/claude/tenric/runs/verify-fail/artifact.json
timeout: wrote /home/claude/tenric/runs/verify-timeout/artifact.json
== 3/4 tests

 RUN  v5.1.2 /home/claude/tenric


 Test Files  7 passed (7)
      Tests  108 passed (108)
   Start at  04:05:33
   Duration  25.42s (tests 97%, import 2%)

== 4/4 verdict for the baseline run, with re-execution
contract: research.experiment-report version 0.2.0 sha256 6f1d9eafe02d17746ed3e106722fe2ae0a7c1a010f074f688eb5ee3003651e11 (matches the registry)
artifact: runs/verify-a/artifact.json sha256 456b81e974edeaace0a33fbe9101fab1c5d89b52bebe370602827aee5fac580d
verifier: revision 8b3ace668a2d5c475739a5155a38d644d03c9235
R-001  pass     Artifact conforms to the IR schema (mandatory, machine)
R-002  pass     Every listed output exists and matches its recorded size and SHA-256 (mandatory, machine)
R-003  pass     Every reported metric equals the value at its pointer in a hashed output (mandatory, machine)
R-004  pass     Source, environment, dataset, config, execution and output digests are marked as recorded by the collector (mandatory, machine)
R-005  pass     Execution completed successfully (mandatory, machine)
R-006  pass     Source is pinned to a clean revision or a hashed snapshot (mandatory, machine)
R-007  pass     Every finding references metrics, figures or outputs that exist in the artifact (mandatory, machine)
R-008  pass     A re-execution reproduces the metrics (mandatory, empirical)
       re-executed revision 8b3ace668a2d5c475739a5155a38d644d03c9235 in an equal environment: 3 metrics equal, 3 outputs byte-identical
R-009  not_run  Findings and limitations are justified by the evidence (advisory, human)
       no validator for human-review yet
R-010  pass     The artifact is a measurement and contains metrics, a report and at least one finding (mandatory, machine)
R-011  pass     Names are unique and every figure points at listed outputs (mandatory, machine)
note: the contract requires capabilities this verifier cannot establish: independent-collector, content-hashing
verdict: accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human)
== verify: OK
```

The same command with one tracked file modified also exits 0. It printed `revision: d7d684a… (dirty)`, `evidence is collected at snapshot commit 29272738dba6368a185e56a11a65b4c7df5adf91`, `Tests  108 passed (108)`, and the verdict record said `verifier: revision d7d684a… with uncommitted changes`. Before this change the same situation gave `19 failed, 41 passed (60)` (review, section 2).

## 3. The six bypass experiments, now

Each is rebuilt by `tests/bypass.test.ts` and asserted on every run of `npm run verify`.

| # | Forgery | Then | Now | By |
| --- | --- | --- | --- | --- |
| A1 | `metrics.json` edited to 0.9999, digests recomputed, finding rewritten | 7 of 7 machine checks pass, inconclusive | Still passes every check that reads only the artifact, and is never accepted on those alone. With re-execution: **rejected** | R-008 |
| A2 | Hand-written artifact, never executed, all lists empty, `data_class: fixture` | 7 of 7 pass | **rejected** | R-010 |
| A3 | Real run with another revision, a figure pointing at no file, a duplicated metric name | 7 of 7 pass | Figure and duplicate: **rejected** by R-011. A revision whose code does not produce the results: passes R-006 as before, **rejected** by R-008 | R-011, R-008 |
| A4 | A2 with a contract cut down to R-001, same id and version | accepted, exit 0 | **no verdict issued**, exit 2 | registry |
| A5 | A1 with a contract that makes R-008 advisory, same id and version | accepted, exit 0 | **no verdict issued**, exit 2 | registry |
| A6 | Nothing forged; `sitecustomize.py` on `PYTHONPATH` makes `accuracy_score` return 1.0 | 7 of 7 pass, accuracy recorded as 1.0 | The collector no longer passes `PYTHONPATH` on: a collected run reports the real accuracy. An artifact built from poisoned outputs is **rejected**, with the verifier itself started in the poisoned environment | collector, R-008 |

What is still true, and what these tests do not show:

- Without `--reproduce`, A1 and an A6-style artifact are indistinguishable from a real run. The verdict is then `inconclusive`. Acceptance now requires a re-execution; that is the whole defence.
- A3 with a revision that behaves identically to the real one passes. The verdict identifies behaviour at a revision, not which commit was actually checked out.
- A poisoned environment that survives the re-execution is not covered: a `sitecustomize.py` shipped inside a locked dependency, or user-level uv configuration in the home directory.
- Someone who can write to the verifier's checkout can register any contract. The record then carries another registry digest or verifier revision. Nothing compares it with a known value automatically.

## 4. CI, three platforms

Run 45937521527, pull request 3, workflow at `d7d684a`. Read from the job logs:

| Runner | Tests | Step 4 verdict |
| --- | --- | --- |
| `ubuntu-24.04` | job concluded success (the test summary line was not read from this log) | `"verdict": "accepted"` in the verdict record |
| `macos-15`, Darwin arm64, Python 3.13.14 | `Tests  108 passed (108)` | `accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human)` |
| `windows-2025`, x86_64 | `Tests  108 passed (108)` | the same sentence |

On each of macOS and Windows the R-008 line read `re-executed revision 7040e205171d9bbbe0fe983e662ea9bb3fa12c8b in an equal environment: 3 metrics equal, 3 outputs byte-identical`.

The earlier run 45936217207, at `60fd68a` (pull requests 1 and 2 only), concluded success on all jobs. That is the first time pull request 2's 60 tests ran on macOS and Windows; only the run's conclusion was read, not its logs.

The job "judged by the base branch's verifier" was **skipped** in both runs: `main` has no verifier, so the probe reported `not_run`. It has never executed on GitHub. Its commands were run once locally with two separate clones standing in for the base and the pull request, and gave `accepted` with exit 0; that is a simulation, not the job.

## 5. Cross-platform bytes

- **JSON outputs: fixed.** `metrics.json` is `76111195…faf53` and the figure specification is `c34a7c08…0ead1` on Linux, macOS and Windows (macOS and Windows read from this run's logs; Linux from the local run and the first CI run). In the first CI run the Windows digests differed because of CRLF.
- **Python: pinned.** All three runners and the local machine used 3.13.14. It is the newest 3.13 that uv 0.11.32 can install by itself; the first CI run had used 3.13.14, 3.13.17 and 3.13.17, and the Phase 0 machine 3.13.18.
- **PNG: explained to the level of "encoding".** From the compare job, `scripts/png_diff.py`:

```
runs/run-ubuntu-24.04/verify-a/figures/confusion_matrix.png: sha256 3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e, 600x600, 4 channels, IDAT 39789 bytes, zlib header 789c
  chunks: IHDR(13), pHYs(9), IDAT(39789), IEND(0)
runs/run-macos-15/verify-a/figures/confusion_matrix.png: sha256 9964a0454406fe7bf11c6afd2bc8891f62e1bc564706474ddf75bacd63196aac, 600x600, 4 channels, IDAT 35906 bytes, zlib header 789c
  chunks: IHDR(13), pHYs(9), IDAT(35906), IEND(0)
non-image chunks: equal
result: decoded pixels are EQUAL; the files differ only in how the same image is encoded
```

  Linux against Windows gave the same result, and macOS against Windows are the same file. So the renderer draws identical pixels on all three platforms, the metadata is identical, and the compressed image data on Linux is 3883 bytes longer. That points at the deflate implementation or its settings in the Linux build of the image library. Which library and why was **not** determined; this is an inference from the sizes, not an observation. The PNG stays declared byte-identical on one platform only. A `pixel-identical` class is open question Q18.

## 6. Defaults taken without an owner answer

Listed for a decision, not decided: a dirty working tree fails R-006; human review (R-009) is advisory and does not block; three verdicts, one rule, no override; the source revision must exist in the repository and need not be `HEAD`. New questions this slice raises are Q14 to Q18 in `docs/open-questions.md`; Q14 (capabilities) and Q15 (protecting the workflow file) need the owner.

## 7. Limits of this evidence

- `accepted` here is a statement about ten requirements of one contract on one deterministic scikit-learn experiment. No agent or model produced anything that was verified. No person reviewed the findings.
- The record says `capabilities.established: []`. The contract asks for an independent collector, and none exists: locally and in the `verify` jobs the collector, the experiment and the verifier come from the same checkout.
- Every re-execution so far ran in an environment equal to the original. The tolerance branch for differing environments is exercised by no real run.
- Re-execution runs the experiment's code on the verifier's machine with no sandbox.
- Author, workflow and code are from the same party. The machines are independent; the party is not.
- The license is still not chosen.
