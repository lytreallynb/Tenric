# Phase 0 report

| | |
| --- | --- |
| Date | 2026-11-25 |
| Status of this phase | **Tested** by its author. Not independently verified. Not approved. |
| Evidence revision | `dcc1bb4dc53d0fdcf135f992b6fd72526e851b8f` (this report was added in a later, documentation-only commit). Commit authorship was rewritten at the owner's request before the first push, which changed the commit hashes but not the files; the verification below was re-run at the new revision. |
| Author | An AI agent (Claude), working from the Phase 0 brief |

## 1. Summary

**What was actually implemented**

- Specifications: a contract schema, a research Artifact IR schema, and one contract with nine requirements (`spec/`).
- Acceptance semantics as a pure function with three verdicts (`src/verdict.ts`).
- Three bootstrap validators: schema conformance, output integrity, metric traceability (`src/checks.ts`).
- One baseline experiment (logistic regression on the scikit-learn digits dataset) and a conventional collector that observes it from outside and writes the artifact and a templated report (`experiments/baseline/`).
- One verification command, 39 tests, and the development harness (AGENTS.md, ADRs, RFC).
- Documents: RFC-0001, trust model, reproducibility semantics, prior art, evaluation plan, Phase 1 plan, open questions.

**What was actually executed and verified**

- `npm run verify` from a fresh clone of the committed repository, on one machine: exit code 0, 39 of 39 tests passed. Full output in section 2.
- The experiment ran for real: 1,797 samples, 450 held out, test accuracy 0.9644, macro F1 0.9645, against 0.1022 for a most-frequent-class reference. These are measured values from this run, on a small saturated dataset, with one seed.
- Two consecutive executions produced byte-identical metrics, figure specification and PNG.
- Seven kinds of tampering applied to a real run were each rejected.
- A deliberately broken run produced a schema-valid artifact recording the failure.

**What remains hypothetical**

- The Contract Compiler, Execution Runtime, Backend Adapter and Controlled Evolution. No code exists for any of them.
- Any claim about agents or models. No model or agent backend was invoked at any point.
- Any advantage of Tenric over conventional scripts. The only thing built *is* the conventional baseline.
- Cross-platform reproducibility. Everything ran on a single Linux x86_64 machine.
- An enforced trust boundary. Today the producer could rewrite the collector.

**The baseline run is not accepted.** Its verdict under the first contract is `inconclusive`, because five mandatory requirements have no validator yet. A test asserts this, so the repository cannot drift into claiming acceptance by accident.

## 2. Test execution evidence

Command, run in a fresh `git clone` after `npm ci` and `uv sync --locked`:

```
$ npm run verify
== tenric verify
revision: dcc1bb4dc53d0fdcf135f992b6fd72526e851b8f
node v22.23.5, Python 3.13.18, Linux x86_64
== 1/3 typecheck
== 2/3 baseline experiment, executed twice, then once with a broken config
succeeded: wrote runs/verify-a/artifact.json
succeeded: wrote runs/verify-b/artifact.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-a/metrics.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-b/metrics.json
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-a/figures/confusion_matrix.png
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-b/figures/confusion_matrix.png
failed: wrote runs/verify-fail/artifact.json
== 3/3 tests

 RUN  v5.1.2 <clean clone>


 Test Files  3 passed (3)
      Tests  39 passed (39)
   Start at  21:45:25
   Duration  416ms (import 54%, transform 33%, tests 11%, worker 2%)

== verify: OK
```

Exit code: 0. The clone path is shortened and one repeated deprecation warning from uv is removed; nothing else is edited.

Individual tests, from `npx vitest run --reporter=verbose` in the same clone (durations removed):

```
✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > accepts only when every mandatory requirement passed
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > an advisory failure is reported but does not block
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > rejects on any mandatory failure
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > is inconclusive, not accepted, when a mandatory validator errored or was not run
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > treats a missing result as not_run
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > a definite failure dominates unknowns
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > no combination containing a non-passing mandatory requirement is accepted
 ✓ tests/verdict.test.ts > acceptance semantics (RFC-0001 section 7) > refuses results for unknown requirements and duplicate results
 ✓ tests/baseline.test.ts > baseline run: evidence checks > is a measured, successful, collector-observed execution
 ✓ tests/baseline.test.ts > baseline run: evidence checks > passes the three implemented validators
 ✓ tests/baseline.test.ts > baseline run: evidence checks > is NOT accepted: mandatory requirements without a validator leave the verdict inconclusive
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a metrics file edited after hashing (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a deleted figure (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a figure replaced by different bytes of the same length (R-002)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a metric inflated in the artifact only (R-003)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects a metric that cites a file outside the hashed outputs (R-003)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects required metadata removed (R-001)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > rejects an artifact file that is not JSON (R-001)
 ✓ tests/baseline.test.ts > baseline run: invalid artifacts are rejected > does not run content validators on a structurally invalid artifact
 ✓ tests/baseline.test.ts > failed run: failure is explicit > still yields a schema-valid artifact that records the failure and lists no outputs
 ✓ tests/baseline.test.ts > failed run: failure is explicit > is not accepted
 ✓ tests/baseline.test.ts > baseline run: reproducibility across two executions in the same environment > outputs declared byte-identical have identical digests
 ✓ tests/baseline.test.ts > baseline run: reproducibility across two executions in the same environment > artifacts are equal once the declared volatile fields are removed
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
```

Limits of this evidence:

- Same machine, same author, same session. A fresh clone rules out "works only in my working tree". It is not independent verification.
- `runs/` is not committed. The digests above can be regenerated, not re-read.
- Typecheck prints nothing on success; its evidence is that the script continued under `set -e`.

## 3. Things that went wrong and what they showed

Recorded because they are more informative than the green run.

1. **A host configuration file changed the figure.** The first rendered confusion matrix used the Inter typeface, set by a `matplotlibrc` on the bootstrap machine. Two runs on that machine were byte-identical, and the image would have differed anywhere else. Fixed by discarding host configuration and using the font bundled with matplotlib. Lesson: same-machine determinism tests cannot detect uncontrolled host inputs. Only a second machine can.
2. **The collector lost a failed run.** Trying the failure path by hand with a config file outside the repository crashed the collector before it wrote an artifact, which violates the invariant that failure is always recorded. Fixed, and `verify` now runs a broken experiment every time.
3. **Tests failed before the first commit**, because the collector correctly reported no source revision. This is the intended behaviour and is why the evidence above comes from a committed revision.
4. **Strict schema compilation rejected the first draft of the IR schema** twice (untyped conditional branches; a `required` in a conditional branch).
5. **The first attempt to write this report mangled it.** A shell quoting mistake made the shell execute the text between backticks, which ran `npm run verify` and a few harmless failing commands in the working tree. No tracked file other than this report was affected, and the report was rewritten. The evidence in section 2 was captured before that and comes from the separate clone.

## 4. Deliverables

| Deliverable | Location |
| --- | --- |
| README | `README.md` |
| RFC-0001 | `docs/rfcs/RFC-0001-minimal-contract-driven-runtime.md` |
| Prior-art findings with sources | `docs/prior-art.md` |
| Contract and artifact specifications | `spec/contract.schema.json`, `spec/research-report.artifact.schema.json`, `spec/contracts/research.experiment-report/0.1.0.contract.json` |
| Trust boundary and failure model | `docs/trust-model.md` |
| Reproducibility semantics | `docs/reproducibility.md` |
| Working baseline experiment | `experiments/baseline/`, run with `npm run baseline` |
| Test execution evidence | Section 2 |
| Phase 1 plan | `docs/phase-1-plan.md` |
| Evaluation design | `docs/evaluation-plan.md` |
| Open questions and risks | `docs/open-questions.md` |
| Decisions requiring review | Section 7 |

## 5. Architectural decisions made (all provisional until approved)

| Decision | Record |
| --- | --- |
| Decisions in ADRs, designs in RFCs, in the repository | ADR-0001 |
| TypeScript on Node for tooling, Python for experiments, communicating through files | ADR-0002 |
| JSON Schema 2020-12 with Ajv in strict mode; cross-file checks as code keyed by a closed list of check kinds | ADR-0003 |
| No database. A run is a directory of content-hashed files. | ADR-0004 |
| One instruction file and one verification command; five status words | ADR-0005 |
| Three verdicts (`accepted`, `rejected`, `inconclusive`); only one acceptance rule; no overrides | RFC-0001 section 7 |
| Every record carries provenance; producer-asserted records cannot satisfy evidence requirements | `docs/trust-model.md` section 3 |
| Contracts are data: no code, no prompts | RFC-0001 section 5 |
| One schema per artifact type; no universal schema | RFC-0001 section 6 |
| Six separate reproducibility guarantees; outputs declare which they claim | `docs/reproducibility.md` |

## 6. Why each dependency is there

| Dependency | Version | Use | Why not do without |
| --- | --- | --- | --- |
| Node.js | 22.23 (runtime) | Runs TypeScript directly; `crypto` for SHA-256 | Removes the need for a bundler or build step |
| ajv | 8.20.0 | JSON Schema 2020-12 validation in strict mode | Writing a schema validator is the reinvention the brief warns against |
| vitest | 5.1.2 | Test runner | Runs TypeScript with no configuration. `node --test` is the alternative with zero dependencies and would be a reasonable swap. |
| typescript | 7.0.2 | Type checking only | Catches interface drift between specification types and validators |
| @types/node | 22.x | Types for Node built-ins | Required by the type check |
| uv | 0.11 (tool) | Locked, reproducible Python environment | The lockfile digest is part of the recorded evidence |
| numpy | 2.5.5 | Arrays in the experiment | Needed by the experiment |
| scikit-learn | 1.9.1 | Bundled public dataset, model, metrics | Gives a real experiment with no download and no GPU |
| matplotlib | 3.11.2 | Deterministic figure rendering | Needed for the figure requirement |

Not added: a database, a CLI framework, a web framework, any agent SDK, any model client, a templating engine (the report uses `string.Template`), `ajv-formats`, OPA, MLflow, OpenTelemetry. Each is discussed in `docs/prior-art.md` or an ADR with the condition for adding it.

Versions are whatever was current on the day and are pinned exactly. Several are recent major versions, which is a churn risk and not a deliberate choice.

## 7. Decisions requiring human review

| # | Decision | Recommendation | Why it needs a person |
| --- | --- | --- | --- |
| 1 | Where the repository lives: owner, name, visibility | A private repository under the owner's account | Nothing has been pushed anywhere. CI, and therefore independent verification, depends on this. |
| 2 | License | Decide before making the repository public | Legal and strategic |
| 3 | Language split (ADR-0002) | Keep TypeScript plus Python | Python-only is a legitimate simpler option and cheap to switch to now, expensive later |
| 4 | How to enforce the trust boundary (`docs/trust-model.md` section 6) | Digest pinning now; verification in CI as the bar for "accepted" | Determines what "accepted" can honestly mean |
| 5 | Verdict model: three verdicts, one rule, no overrides, closed list of check kinds | Approve as written | These are the core semantics and are costly to change once contracts exist |
| 6 | The first contract's content | Approve with two points to settle: should a dirty working tree always reject (R-006), and should human review of findings (R-009) be mandatory | Encodes the owner's actual research standard, which the author can only guess |
| 7 | Phase 1 ordering: finish verification and reproduction before any agent integration | Approve slice 1A | Delays the visible "agent" part in favour of the part that does not depend on model quality |
| 8 | Evaluate in-toto layouts and a `Stop`-hook integration before designing a compiler | Yes, as a time-boxed spike | Either could replace a planned component |
| 9 | Budget and approval for paid model usage | Not needed until slice 1F | Spending |
| 10 | Schema identifiers use a `urn:tenric:` namespace | Keep until a domain is owned | Identifiers are hard to change after publication |

## 8. What should happen next

1. Review this report and RFC-0001; answer the decisions above, at minimum 1, 5 and 7.
2. Push to the chosen repository and add a CI job that runs `npm run verify`. This is the first independent check and the first run on a second machine.
3. Slice 1A from `docs/phase-1-plan.md`: the four missing validators and a `verify` command line.

## 9. Status ledger

| Item | Proposed | Implemented | Tested | Independently verified | Approved |
| --- | --- | --- | --- | --- | --- |
| Contract schema v0.1.0 | yes | yes | yes | no | no |
| Artifact IR v0.1.0 | yes | yes | yes | no | no |
| Verdict semantics | yes | yes | yes | no | no |
| Validators R-001 to R-003 | yes | yes | yes | no | no |
| Validators R-004 to R-008 | yes | no | no | no | no |
| Baseline experiment and collector | yes | yes | yes | no | no |
| Same-machine byte reproducibility | yes | yes | yes | no | no |
| Cross-platform reproducibility | yes | no | no | no | no |
| Enforced trust boundary | yes | no | no | no | no |
| Compiler, runtime, adapters | yes (as hypotheses) | no | no | no | no |
| Controlled Evolution | no | no | no | no | no |
