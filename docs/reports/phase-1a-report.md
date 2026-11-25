# Phase 1 slice 1A report: a verifier for the first contract

| | |
| --- | --- |
| Date | 2026-11-25 |
| Status of this slice | **Tested** by its author. Not independently verified. Not approved. |
| Evidence revision | `0ac4b9c23627d259ae9894481f1fbc37af51b7b2` (this report and the documentation updates were added in a later, documentation-only commit) |
| Author | An AI agent (Claude), working from `docs/phase-1-plan.md` |

## 1. Summary

**Implemented**

- Four validators in `src/checks.ts`: `collector-provenance` (R-004), `execution-succeeded` (R-005), `source-pinned` (R-006), `finding-references` (R-007).
- `output-integrity` and `metric-traceability` now resolve symlinks and fail an output that lands outside the run directory.
- A command line, `src/cli.ts`: `node src/cli.ts verify <run-dir> --contract <file> [--repo <dir>]`. Exit code 0 only for `accepted`, 1 for `rejected` or `inconclusive`, 2 when no verdict is issued.
- The collector takes `--timeout`, and `npm run verify` now runs the baseline once with a timeout it cannot meet.
- Tests went from 39 to 60.

**The baseline run is still not accepted.** Its verdict moved from `inconclusive` with five mandatory requirements not run to `inconclusive` with one: R-008, re-execution, which is slice 1B. A test asserts exactly this. No dependency was added, and the contract and both schemas are unchanged.

**Not done, and not claimed**

- Cancellation. The collector has no handling for an interrupt, so a cancelled run writes no artifact. The tests show only that the verifier rejects an artifact *recorded* as cancelled.
- A fixture that keeps `data_class: "fixture"` is not rejected for that reason. No requirement in contract 0.1.0 reads `data_class`; the repository's fixture is rejected because its outputs, provenance and revision do not check out. Closing this needs a contract change, which is the owner's decision (open question Q11).
- Snapshot sources. IR 0.1.0 records a snapshot digest but not where the snapshot is, so `source-pinned` reports `error` for them and never `pass` (open question Q12).
- The trust boundary is unchanged: producer and verifier still share a user and a working tree.

## 2. Assumptions made without the owner's decision

Section 7 of the Phase 0 report lists decisions that were not answered when this slice was built. It was built on the recommended options, and each of these is provisional:

| Decision | Assumed | Where it shows |
| --- | --- | --- |
| 5. Verdict model | Three verdicts, one rule, no overrides, closed list of check kinds, as written | `src/verdict.ts` is unchanged; the command line has no flag that alters a verdict |
| 6a. Does a dirty working tree always reject? | Yes | `source-pinned` fails when `source.dirty` is not `false` |
| 6b. Is human review of findings (R-009) mandatory? | No, it stays advisory | Contract unchanged; R-009 is reported as `not_run` and does not block |
| 7. Phase 1 ordering | Slice 1A first | This slice |
| 3. Language split | TypeScript plus Python kept | No change |

Two further choices were made here because the plan left them open:

- **"A revision that exists in the repository being verified"** is read as: the recorded revision is a commit object in that repository. It does not have to equal the current `HEAD`, so a run stays verifiable after later commits. The repository is the one containing the run directory unless `--repo` names another.
- **Exit codes** separate "not accepted" (1) from "no verdict issued" (2), following RFC-0001 section 7.2 rule 6.

## 3. Test execution evidence

Command, run in a fresh `git clone` of the evidence revision after `npm ci` and `uv sync --locked`:

```
$ npm run verify
== tenric verify
revision: 0ac4b9c23627d259ae9894481f1fbc37af51b7b2
node v22.23.5, Python 3.13.18, Linux x86_64
== 1/3 typecheck
== 2/3 baseline experiment, executed twice, then once with a broken config and once with a timeout it cannot meet
succeeded: wrote <clean clone>/runs/verify-a/artifact.json
succeeded: wrote <clean clone>/runs/verify-b/artifact.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-a/metrics.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-b/metrics.json
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-a/figures/confusion_matrix.png
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-b/figures/confusion_matrix.png
failed: wrote <clean clone>/runs/verify-fail/artifact.json
timeout: wrote <clean clone>/runs/verify-timeout/artifact.json
== 3/3 tests

 RUN  v5.1.2 <clean clone>


 Test Files  4 passed (4)
      Tests  60 passed (60)
   Start at  22:07:13
   Duration  2.76s (tests 76%, import 16%, transform 7%)

== verify: OK
```

Exit code: 0. The clone path is shortened and one repeated deprecation warning from uv is removed; nothing else is edited.

The command line on the baseline run in the same clone:

```
$ node src/cli.ts verify runs/verify-a --contract spec/contracts/research.experiment-report/0.1.0.contract.json
contract: research.experiment-report version 0.1.0
artifact: runs/verify-a/artifact.json sha256 e984794d408a0ee7872213ab32b3a1c77b42714732c8fee79f7dca9beac17470
R-001  pass     Artifact conforms to the IR schema (mandatory, machine)
R-002  pass     Every listed output exists and matches its recorded size and SHA-256 (mandatory, machine)
R-003  pass     Every reported metric equals the value at its pointer in a hashed output (mandatory, machine)
R-004  pass     Source, environment, dataset, config, execution and output digests were recorded by the collector (mandatory, machine)
R-005  pass     Execution completed successfully (mandatory, machine)
R-006  pass     Source is pinned to a clean revision or a hashed snapshot (mandatory, machine)
R-007  pass     Every finding references metrics, figures or outputs that exist in the artifact (mandatory, machine)
R-008  not_run  A re-execution reproduces the metrics (mandatory, empirical)
       no validator for numeric-reproduction yet
R-009  not_run  Findings and limitations are justified by the evidence (advisory, human)
       no validator for human-review yet
verdict: inconclusive under contract research.experiment-report version 0.1.0: 7 of 8 mandatory requirements passed (7 machine, 0 empirical, 0 human)
```

Exit code: 1.

Individual tests, from `npx vitest run --reporter=verbose` in the same clone (durations removed):

```
 ✓ tests/spec.test.ts > contract specification > loads the first contract
 ✓ tests/spec.test.ts > contract specification > refuses an unsupported contract schema version
 ✓ tests/spec.test.ts > contract specification > refuses an unknown check kind, an unknown field, and duplicate requirement ids
 ✓ tests/spec.test.ts > research artifact IR schema > accepts the demonstration fixture, which is labelled as a fixture
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: missing dataset identity
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: missing source revision for a git source
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: missing provenance on evidence
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: unsupported IR version
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: malformed digest
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: absolute output path
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: output path escaping the artifact directory
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: unknown top-level field
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: finding without cited support
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: failed execution without a failure record
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: success with a non-zero exit code
 ✓ tests/spec.test.ts > research artifact IR schema > rejects: metric given as a string
 ✓ tests/baseline.test.ts > baseline run: evidence checks > is a measured, successful, collector-observed execution
 ✓ tests/baseline.test.ts > baseline run: evidence checks > passes the seven machine validators
 ✓ tests/baseline.test.ts > baseline run: evidence checks > is NOT accepted: the mandatory re-execution requirement has no validator, so the verdict is inconclusive
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a metrics file edited after hashing (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a deleted figure (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a figure replaced by different bytes of the same length (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a metric inflated in the artifact only (R-003)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a metric that cites a file outside the hashed outputs (R-003)
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > accepts only when every mandatory requirement passed
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > an advisory failure is reported but does not block
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > rejects on any mandatory failure
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > is inconclusive, not accepted, when a mandatory validator errored or was not run
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > treats a missing result as not_run
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > a definite failure dominates unknowns
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > no combination containing a non-passing mandatory requirement is accepted
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > refuses results for unknown requirements and duplicate results
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects required metadata removed (R-001)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects an artifact file that is not JSON (R-001)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects an output replaced by a symlink to identical bytes outside the run directory (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects an execution record asserted by the producer (R-004)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects one output digest asserted by the producer (R-004)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a run recorded as timed out (R-005)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a run recorded as cancelled (R-005)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a run collected from a dirty working tree (R-006)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a revision that does not exist in the repository being verified (R-006)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a revision that names a tree, not a commit (R-006)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a run with no source identity (R-006)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a finding that cites a metric the artifact does not contain (R-007)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a finding that cites an unlisted output (R-007)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects the demonstration fixture relabelled as a measurement (R-002, R-004, R-006)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > does not run content validators on a structurally invalid artifact
 ✓ tests/baseline.test.ts > baseline run: a validator that cannot decide reports error, never pass > R-006 errors when there is no repository to check the revision against
 ✓ tests/baseline.test.ts > baseline run: a validator that cannot decide reports error, never pass > R-006 errors on a snapshot source, which this IR version gives no way to re-hash
 ✓ tests/baseline.test.ts > baseline run: a validator that cannot decide reports error, never pass > R-004 errors when the contract names no sections or a section the artifact lacks
 ✓ tests/baseline.test.ts > failed run: failure is explicit > still yields a schema-valid artifact that records the failure and lists no outputs
 ✓ tests/baseline.test.ts > failed run: failure is explicit > is rejected, because execution did not succeed (R-005)
 ✓ tests/baseline.test.ts > timed-out run: the collector records the timeout > yields a schema-valid artifact with status timeout, no exit code and no outputs
 ✓ tests/baseline.test.ts > timed-out run: the collector records the timeout > is rejected (R-005)
 ✓ tests/baseline.test.ts > baseline run: reproducibility across two executions in the same environment > outputs declared byte-identical have identical digests
 ✓ tests/baseline.test.ts > baseline run: reproducibility across two executions in the same environment > artifacts are equal once the declared volatile fields are removed
 ✓ tests/cli.test.ts > tenric verify > reports the baseline as inconclusive, exits 1, and never says more than the contract checked
 ✓ tests/cli.test.ts > tenric verify > reports the failed run as rejected and exits 1
 ✓ tests/cli.test.ts > tenric verify > exits 0 only for accepted: a contract without the unverifiable requirement accepts the baseline
 ✓ tests/cli.test.ts > tenric verify > issues no verdict and exits 2 on a precondition failure
```

Limits of this evidence:

- Same machine, same author, same session as the code. A fresh clone is not independent verification.
- The test named "exits 0 only for accepted" uses a contract written by the test with R-008 removed, to reach the exit code path. It is not the project's contract and nothing has been accepted under contract 0.1.0.
- The first full run during development failed one of 60 tests: an older tampering case (a metrics file edited after hashing) now also fails R-003, and the new assertion that no other requirement fails had not listed it. The expectation was corrected to name both.
- While the working tree had uncommitted changes, 19 tests failed because R-006 rejected runs collected from a dirty tree. That is the validator working as intended, and it is why the evidence comes from a committed revision.

## 4. Failure paths from the slice plan

| Path | What a test demonstrates | Verdict |
| --- | --- | --- |
| Timeout | The collector, given `--timeout 0.01`, writes a schema-valid artifact with status `timeout`; R-005 fails | rejected |
| Cancellation | An artifact recorded as `cancelled` fails R-005. The collector's own behaviour on cancellation is not implemented or tested | rejected |
| Dirty tree | R-006 fails | rejected |
| Stale revision | A revision absent from the repository, and one that names a tree, each fail R-006 | rejected |
| Fixture submitted as a measurement | The fixture relabelled `measured` fails R-002, R-004 and R-006 | rejected |
| Symlinked output | A listed output replaced by a symlink to identical bytes outside the run directory fails R-002 and R-003 | rejected |

## 5. Status ledger

| Item | Proposed | Implemented | Tested | Independently verified | Approved |
| --- | --- | --- | --- | --- | --- |
| Validators R-004 to R-007 | yes | yes | yes | no | no |
| Symlink escape check in R-002 and R-003 | yes | yes | yes | no | no |
| `tenric verify` command line | yes | yes | yes | no | no |
| Collector timeout path | yes | yes | yes | no | no |
| Collector cancellation path | yes | no | no | no | no |
| Validator R-008 (re-execution) | yes | no | no | no | no |
| Enforced trust boundary | yes | no | no | no | no |
