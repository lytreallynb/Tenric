# Phase 1 plan (proposed)

Status: proposed. Nothing here is started. Each slice ends with `npm run verify` passing and a short report.

## Goal

Reach the first honest `accepted` verdict: the baseline run, verified against the first contract by a verifier the producer cannot alter, with the verdict recorded in a standard format. Still no agent.

## Smallest next slice (1A): a complete verifier for the first contract

Implement the four missing machine validators and a CLI.

| Requirement | Validator | Notes |
| --- | --- | --- |
| R-004 | `collector-provenance` | Listed sections must carry provenance `collector` |
| R-005 | `execution-succeeded` | Status `succeeded` and exit code 0 |
| R-006 | `source-pinned` | Clean git revision that exists in the repository being verified, or a hashed snapshot |
| R-007 | `finding-references` | Every `supported_by` entry resolves to a metric, figure or output |

Plus:

- `tenric verify <run-dir> --contract <file>` printing per-requirement results and the verdict, exiting 0 only for `accepted`.
- Tests for the failure paths not yet exercised: failed run, timeout, dirty tree, stale revision, fixture submitted as a measurement, symlinked output.
- Expected outcome: the baseline verdict moves from `inconclusive` (five blocking) to `inconclusive` (one blocking: R-008).

Size: roughly 200 lines of TypeScript and tests. No new dependencies.

## 1B: re-execution (R-008)

- `tenric reproduce <run-dir>`: check out the recorded revision into a temporary worktree, re-run, compare outputs by declared determinism class.
- Run it on a second platform (a CI runner with a different OS or architecture) to get the first real cross-platform numbers and replace the placeholder tolerance.
- After this the baseline can be `accepted`.

## 1C: an enforced trust boundary

- Pin contract, schema and verifier digests in the verdict record.
- CI workflow that runs collection and verification from the default branch's verifier. Requires the repository to be hosted.
- Emit the verdict as an in-toto Statement whose subjects are the artifact's outputs. Sign in CI if artifact attestations are available.

## 1D: a second task under the same contract

- A different experiment (for example a runtime benchmark) using the unchanged contract.
- Record what had to change. This is the first data point for hypothesis H3 in the evaluation plan, and it decides whether a generic collector is worth extracting from `run_baseline.py`.

## Then, and only with approval

- 1E: collector moved into the TypeScript runtime with a subprocess adapter.
- 1F: first real backend adapter, in a sandbox, behind a spending limit. First point at which paid model usage is needed.

## Explicitly not in Phase 1

Contract compiler beyond hard-coded planning, a second artifact type, Controlled Evolution, any UI, any database, multi-agent orchestration, an LLM judge.

## Exit criteria

1. The baseline is `accepted` under contract 0.1.0 by a verifier running in CI.
2. Every failure mode in `docs/trust-model.md` section 5 is either detected by a test or listed as out of scope with a reason.
3. A second task has run under the same contract and the adaptation cost is written down.
4. A go or no-go recommendation on the runtime, based on criterion 3.
