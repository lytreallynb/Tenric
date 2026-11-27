# RFC-0001: A minimal contract-driven runtime

| | |
| --- | --- |
| Status | **Proposed.** Awaiting human review at the Phase 0 checkpoint. |
| Date | 2026-11-25 |
| Scope | Defines the smallest system worth building and the semantics it must obey. Does not authorise building the full architecture. |
| Related | `docs/trust-model.md`, `docs/reproducibility.md`, `docs/prior-art.md`, `docs/evaluation-plan.md`, `spec/` |

Each section is labelled with its state: **Implemented** (code exists and tests ran), **Specified** (written precisely, no code), or **Hypothesis** (a direction that could be wrong).

## 1. Problem

Agents are non-deterministic producers. A professional's standards (what a report must contain, what evidence must back it, how it is checked) are stable and belong to the professional, not to a model, a prompt or a harness.

Today those standards reach an agent as instructions: AGENTS.md, skills, system prompts. Instructions are advisory. Whether one is followed depends on model attention, and the agent that did the work is also the one reporting that it complied. Three structural problems follow, and none of them goes away as models improve:

1. **No independent acceptance.** "Done" is asserted by the producer.
2. **Claims and evidence are mixed.** A number in a report may be measured, copied, or invented, and the report does not say which.
3. **Standards are not portable artifacts.** They are rewritten per harness, unversioned, and cannot be regression-tested.

Core question: can a system enforce stable delivery contracts across heterogeneous, non-deterministic execution environments while preserving portability, provenance, reproducibility and controlled evolution, and does it beat scripts, templates, persistent instructions and skills by a measurable margin?

The second half makes this falsifiable. `docs/evaluation-plan.md` states what result would mean "no".

## 2. Boundaries

Tenric is **not**: a foundation model, a coding agent, a chatbot wrapper, a prompt marketplace, a task dashboard, a self-modifying agent, an experiment tracker, or a distributed orchestrator.

Tenric **does not**:

- Decide whether a finding is true. It decides whether stated requirements were met and reports by what means each was checked.
- Make a model follow instructions. It makes acceptance independent of whether the model did.
- Replace MLflow, CI, in-toto or JSON Schema. It composes them.

Smallest useful statement of what Tenric **is**: a contract format, a collector, and a verifier that turn "the agent says it is done" into "these named requirements passed, checked by these means, against this contract version".

## 3. Architecture

```
            contract (versioned, owner-controlled)
                     │
              ┌──────▼───────┐
              │   Compiler   │  resolve version, check applicability,
              └──────┬───────┘  lower to backend-specific form
        advisory     │                    enforceable
   ┌─────────────────┴───────────┐             │
   ▼                             ▼             ▼
instructions / skill       output schema   validator plan
   │                             │             │
┌──▼─────────────────────────────▼──┐          │
│  Backend adapter → PRODUCER       │          │     untrusted
│  (agent, or a plain script)       │          │
└──────────────┬────────────────────┘          │
- - - - - - - -│- - - - - - - - - - - - - - - -│- - trust boundary
        outputs│(claims)                       │
        ┌──────▼──────┐                 ┌──────▼──────┐
        │  Collector  ├── Artifact IR ─▶│  Verifier   ├──▶ verdict
        └─────────────┘   (evidence +   └─────────────┘   + per-requirement
                           claims,                          results
                           provenance-tagged)
```

| Component | Responsibility | State |
| --- | --- | --- |
| Contract Specification | Versioned requirements, each with a check kind, a verifiability class and a level | **Implemented** as a JSON Schema plus one contract (section 5) |
| Artifact IR | Canonical record of one deliverable and its evidence | **Implemented** for one artifact type (section 6) |
| Acceptance semantics | Results to verdict | **Implemented** as a pure function with tests (section 7) |
| Collector | Observes a run from outside the producer | **Implemented** only as the Python baseline script, which is conventional tooling and not the Tenric runtime |
| Verifier | Runs validators, computes the verdict | **Implemented** for the seven machine-checkable requirements of the first contract, with a command line (`src/cli.ts`). Re-execution and human review are **Specified**. |
| Contract Compiler | Section 4 | **Hypothesis** |
| Backend Adapter | Section 8 | **Hypothesis** |
| Execution Runtime | Lifecycle, timeouts, event log | **Hypothesis** |
| Controlled Evolution | Proposing and regression-testing contract changes | Out of scope. Not designed here. |

## 4. What the compiler must do that is not prompt concatenation (Hypothesis)

If the compiler only pastes requirements into a prompt, it should not exist. Deterministic work that appears to be real:

1. **Resolution.** Select the contract version, load referenced schemas by digest, and refuse unknown versions.
2. **Applicability.** Compare `requires_capabilities` with what the backend and environment declare. If the contract demands an independent collector and none is available, compilation fails before any tokens are spent. This is a precondition failure and is reported as such, not as a bad artifact.
3. **Schema lowering.** Provider constrained decoding supports a subset of JSON Schema (`docs/prior-art.md` section 1.3). The research Artifact IR schema already uses keywords outside the documented subset. The compiler derives the nearest supported schema for the backend and schedules full validation afterwards.
4. **Requirement partitioning.** Split requirements into what the producer must supply, what the collector must observe, and what a human must judge. Emit instructions for the first, a collection plan for the second, and a review checklist for the third.
5. **Validator planning.** Order validators by dependency (structure first), and mark each as available or unavailable so that the verdict can be predicted to be `inconclusive` before running.

Phase 1 implements none of this except a hard-coded form of 5. The compiler earns its place only when a second contract or a second backend makes the hard-coding painful.

## 5. Contract Specification v0.1.0 (Implemented, proposed for review)

Schema: `spec/contract.schema.json`. First instance: `spec/contracts/research.experiment-report/0.1.0.contract.json`.

A contract states the artifact type and IR version it governs, the capabilities it needs, and a list of requirements. Each requirement has:

| Field | Values | Meaning |
| --- | --- | --- |
| `id` | `R-001` … | Stable within a contract across versions |
| `level` | `mandatory`, `advisory` | Whether it can block acceptance |
| `verifiability` | `machine`, `empirical`, `human` | How it can be decided at all |
| `check.kind` | closed enumeration | Which validator decides it |
| `check.params` | object | Validator parameters, such as tolerances |

Design choices to review:

- **Check kinds are a closed enumeration.** A contract cannot name a validator the verifier does not know; such a contract is invalid. This keeps contracts from smuggling in "ask the model whether it complied". Cost: every new kind is a schema and code change. That friction is intended for now.
- **Contracts contain no code and no prompts.** They are data. Guidance text for backends is generated or kept beside the contract, never inside it.
- **Verifiability is declared per requirement.** A reader can see at a glance which parts of a standard are machine-enforced and which rest on a person.
- **Only one acceptance rule exists**, `all-mandatory-pass`. Weighted scores and thresholds are excluded on purpose: they turn a fail-closed decision into a tunable one.
- **Versions are semantic versions**, with the compatibility rules still to be defined (open question Q4).

The first contract has nine requirements: seven machine-checkable, one empirical (re-execution), one human (advisory).

## 6. Artifact IR v0.1.0: research experiment report (Implemented, proposed for review)

Schema: `spec/research-report.artifact.schema.json`. One narrowly defined artifact type. There is no universal artifact schema and none is planned.

| Record | Content | Provenance in the baseline |
| --- | --- | --- |
| `experiment_id`, `title`, `data_class` | Identity; `measured` or `fixture` | config |
| `source` | Git revision and dirty flag, or a hashed snapshot | collector |
| `environment` | OS, architecture, interpreter, package versions, lockfile digest, pinned variables | collector |
| `dataset` | Name, version, digest of the dataset file | collector |
| `config` | Path, digest, values, seed | collector |
| `execution` | Command, status, exit code, start time, runtime | collector |
| `metrics[]` | Name, value, and a pointer into a hashed output | producer (value), cross-checked by R-003 |
| `outputs[]` | Path, role, size, SHA-256, determinism class | collector |
| `figures[]` | Specification output, image output, renderer | collector |
| `findings[]` | Statement plus the metrics, figures or outputs it cites | template in the baseline; producer for an agent |
| `limitations[]` | Free text | template in the baseline |
| `reproduction` | Commands and what to expect | collector |
| `volatile_fields` | Pointers to values allowed to differ between reruns | collector |
| `failure` | Required unless the run succeeded | collector |

Properties worth noting:

- Every evidence record states who asserted it (`docs/trust-model.md` section 3).
- A metric is never free-standing. It names the hashed file and pointer it came from, which is what makes R-003 checkable.
- A finding must cite at least one metric, figure or output. The schema can require a citation; only a person can judge whether the citation supports the sentence.
- The IR is the canonical deliverable. `report.md` is a rendering of it.
- `outputs[]` entries are shaped like in-toto subjects (name and digest), so a verdict can later be published as an in-toto Statement without translation.

Known weaknesses: digests have no algorithm tag; `dataset` assumes a single file; there is no place for multiple seeds or repeated runs; `environment` is Python-specific; canonical serialisation is "sorted keys" and not RFC 8785 (JCS), which matters as soon as the artifact itself is hashed or signed.

## 7. Acceptance and failure semantics (Implemented: `src/verdict.ts`)

### 7.1 Requirement status

Every requirement of the contract gets exactly one status:

| Status | Meaning |
| --- | --- |
| `pass` | The validator ran to completion and the requirement holds |
| `fail` | The validator ran to completion and the requirement does not hold |
| `error` | The validator was attempted and could not reach a decision (crash, missing dependency, unreadable input, timeout) |
| `not_run` | No validator was executed. Includes: no validator exists, a human has not reviewed yet, a re-execution has not happened. A missing result is `not_run`. |

### 7.2 Verdict

Let *B* be the mandatory requirements whose status is not `pass`.

| Verdict | Condition | Meaning |
| --- | --- | --- |
| `rejected` | some requirement in *B* has status `fail` | At least one mandatory requirement is known to be violated |
| `inconclusive` | *B* is non-empty and contains no `fail` | Nothing is known to be wrong, but acceptance is not justified |
| `accepted` | *B* is empty | Every mandatory requirement was checked and passed |

Rules:

1. **Only `accepted` permits acceptance.** `inconclusive` is a non-acceptance. Tooling must exit non-zero for anything other than `accepted`. (`tenric verify` exits 0 accepted, 1 rejected, 3 inconclusive, 2 no verdict.)
2. **`rejected` dominates.** One definite failure is enough regardless of unknowns.
3. **Advisory requirements never change the verdict** and are always reported.
4. **No overrides inside the verdict.** A waiver is a new contract version or a recorded human decision outside the verdict, never a flag that turns `fail` into `pass`.
5. **A verdict is bound** to one contract id and version, one artifact digest, and the verifier's source revision. (Implemented: `src/verify.ts` returns a verdict record with the contract SHA-256, artifact SHA-256 and verifier revision; ADR-0007.)
6. **Precondition failures produce no verdict.** An unsupported contract version, an invalid contract, a contract whose content is not the registered one, or an unmet capability means verification could not start. (Capabilities are not checked yet: the verifier issues a verdict and states in the record that none is established. Open question Q14.) This is distinct from all three verdicts and is the caller's failure, not the producer's.
7. **Dependent validators do not guess.** If the artifact is not structurally valid, validators that read its structure report `error`.
8. **A verdict is not a truth claim.** The wording to use is "accepted under contract X version Y: N of N mandatory requirements passed (k machine, m empirical, h human)", followed by "; evidence collected by C (attested)" or "; collector not attested" (ADR-0011). Never "verified correct".

### 7.3 Why three verdicts and not two

Collapsing `inconclusive` into `rejected` would be simpler and equally fail-closed. They are kept apart because they call for different actions: `rejected` means fix the deliverable, `inconclusive` means finish the verification. The real baseline run is the example: verified without a re-execution, nothing is known to be wrong with it, one mandatory requirement (R-008) was not run, and its verdict is `inconclusive`. Reporting that as `rejected` would be as misleading as reporting it `accepted`.

## 8. Backend adapter (Hypothesis)

The minimal interface under consideration:

```
describe()  → capabilities: structured_output, event_stream, sandbox_modes,
              hooks, cancellation, cost_reporting, each with a stated guarantee
run(task, workspace, limits) → exit status, final message, event log location
cancel()
```

Constraints taken from the prior-art pass:

- Capabilities differ and are loosely documented. The adapter reports what a backend guarantees; the runtime never assumes parity.
- Nothing the adapter returns is evidence. Exit status and files are observed by the collector; the event stream is the backend's account of itself.
- Hooks are useful as an extra observation channel and as a guard, and they run inside the harness being constrained. They cannot be the only enforcement.
- A plain script is a valid backend. The Phase 0 baseline is the degenerate adapter: a subprocess with a timeout.

A mock adapter may be used to test the runtime's own logic. Results from a mock say nothing about any model and must never be reported as cross-model evidence.

## 9. Alternatives considered

| Alternative | Why not, for now |
| --- | --- |
| Instructions and skills only | Advisory by construction; no independent acceptance. Remains the advisory channel inside Tenric. |
| A `Stop` hook that runs a validator | Genuinely close to this RFC for one backend, and may be the right first integration. It ties the standard to one harness and leaves evidence collection inside the producer's process tree. |
| OPA and Rego for all checks | Sound model, extra runtime and language for three checks. Revisit when checks multiply or users need to write their own. |
| in-toto layout as the contract | Unevaluated and a real candidate (`docs/prior-art.md` section 5, item 6). Must be assessed before the compiler is designed. |
| An LLM judge as a validator | Not a deterministic mechanism and not independent of model quality. Could only ever back an `advisory` or `human`-class requirement, labelled as such. |
| One universal artifact schema | Would be either vacuous or enormous. One schema per artifact type. |

## 10. What would make this RFC wrong

- The baseline (scripts, schema check, hashes, CI) matches Tenric on the evaluation metrics at lower maintenance cost. Then Tenric is a pattern and a small library, not a runtime.
- Contracts do not transfer: writing the second and third contract costs as much as writing bespoke scripts.
- The trust boundary cannot be enforced without infrastructure a single engineer will not run.
- Harness vendors ship outcome verification natively.

## 11. Decisions requested

Listed with recommendations in `docs/reports/phase-0-report.md`, section 7.
