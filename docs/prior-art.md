# Prior art

Status: research notes for Phase 0, compiled 2026-11-25. Not a literature review.

How to read the "Checked" column:

- **read**: the primary source was fetched and read in this session.
- **summary**: fetched in this session, but long pages were read through an extracted summary, so specifics need re-checking before anyone relies on them.
- **recalled**: written from background knowledge. The source exists, but its details were not re-verified here.

No novelty is claimed anywhere in this document. Section 4 lists what looks unsolved after this pass, and section 5 lists the existing work most likely to make Tenric unnecessary.

## 1. Findings by area

### 1.1 Portable agent instructions and skills

| | |
| --- | --- |
| **Agent Skills** ([spec](https://agentskills.io/specification), [repo](https://github.com/agentskills/agentskills)) | read |
| Solves | Packaging reusable procedures so that many agents can discover and load them. |
| Mechanism | A directory with `SKILL.md` (YAML frontmatter `name`, `description`, optional `license`, `compatibility`, `metadata`, experimental `allowed-tools`) plus optional `scripts/`, `references/`, `assets/`. Loaded progressively: metadata at startup, body on activation, resources on demand. `skills-ref validate` checks frontmatter and naming. |
| Limits | No version field in the spec. Validation covers the package shape only. Nothing verifies that a skill was followed or that its outcome is correct. Whether a skill triggers at all is decided by the model. |
| Reuse | Ship Tenric's *guidance* to backends as skills. A contract can compile to a skill plus a validator; the skill is the advisory half. |
| Remaining | Enforcement, outcome verification, versioned compatibility. |

| | |
| --- | --- |
| **AGENTS.md** ([agents.md](https://agents.md), [repo](https://github.com/agentsmd/agents.md)) | read |
| Solves | One predictable place for project instructions, read by many coding agents. Stewarded by the Agentic AI Foundation under the Linux Foundation. |
| Mechanism | Plain Markdown, no required fields. The nearest file in the directory tree takes precedence. Codex concatenates files root-first with a size cap (32 KiB by default, per its docs; summary). |
| Limits | Free text, so compliance is probabilistic. No schema, no version, no verification. |
| Reuse | This repository uses it as the single instruction entry point (ADR-0005). |

Evidence on how well skills work (all **summary**; numbers need re-checking against the papers):

- [SkillsBench](https://arxiv.org/abs/2602.12670): curated skills raise average pass rate from 33.9% to 50.5% across 18 model and harness configurations on 87 tasks, but 13 tasks get worse, and skills the agent wrote for itself lowered results in all three configurations tested (−8.1 to −11.5 points). Earlier versions of the paper report different figures.
- [SkillsVote](https://arxiv.org/abs/2605.18401): exposing a skill library indiscriminately produced more task-level loss than gain (+3.3/−6.7); gating evolution on attributed evidence helped. Reports curated libraries *reducing* scores for strong models on SWE-Bench Pro and Terminal-Bench 2.0.
- [SkillFlow](https://arxiv.org/abs/2604.17308): lifelong skill evolution helped some models (+8.4 points for the best) and hurt others (−6.0); incorrect skills caused drift in later tasks, and the hard part was repairing bad skills, not writing them.
- [SoK: Agentic Skills](https://arxiv.org/abs/2602.20867): names verification at library admission as a main open problem.

Implication for Tenric: instructions and skills have a measurable but uneven effect, the effect shrinks or reverses for stronger models, and negative transfer is real. This supports keeping Controlled Evolution out of scope until there is a regression harness, and it means comparison group B (section 10 of the brief) is a moving target that must be measured, not assumed weak.

### 1.2 Execution interfaces of real backends

| | |
| --- | --- |
| **Claude Code** ([headless](https://code.claude.com/docs/en/headless), [hooks](https://code.claude.com/docs/en/hooks)) | read |
| Solves | Scripted, non-interactive agent runs with machine-readable output and deterministic interception points. |
| Mechanism | `claude -p` with `--output-format json` or `stream-json`; `--json-schema` returns a `structured_output` field; `--allowedTools`; `--bare` skips discovery of hooks, skills, MCP servers and CLAUDE.md. Hooks are commands run by the harness on lifecycle events (`PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SubagentStop` and many more); a `PreToolUse` hook can deny a tool call. |
| Limits | Docs state `structured_output` is absent if the run ends without valid structured output, and that `format` keywords are not enforced. Without `--bare`, a `-p` run loads hooks and MCP servers from the working directory with no trust prompt, so the repository under work can alter the harness. Cost figures are client-side estimates. |
| Reuse | First real adapter candidate. Hooks give an out-of-band channel for collecting events and for denying writes to contract files. |

| | |
| --- | --- |
| **Codex CLI** ([non-interactive mode](https://developers.openai.com/codex/noninteractive), [CLI reference](https://developers.openai.com/codex/cli/reference)) | summary |
| Mechanism | `codex exec --json` emits JSONL events (`thread.started`, `turn.completed`, `turn.failed`, `item.*`, `error`); `--output-schema <file>` requests a final response matching a JSON Schema; sandbox modes `read-only`, `workspace-write`, `danger-full-access`; a hooks system with similar event names (`PreToolUse`, `PostToolUse`, `Stop`, …) configured in `hooks.json` or `config.toml`. |
| Limits | The pages read state no validation guarantee for `--output-schema`, give no numeric exit codes, and disagree about the default sandbox under `exec`. |
| Reuse | Second adapter candidate. |

| | |
| --- | --- |
| **Agent Client Protocol** ([agentclientprotocol.com](https://agentclientprotocol.com/)) | summary |
| Solves | A common JSON-RPC protocol between editors and coding agents, in the spirit of LSP. |
| Limits | Editor-facing. Remote agents are described as work in progress. Session and permission event shapes were not read. |
| Reuse | Candidate for a single adapter that covers several agents. Must be evaluated before writing per-vendor adapters (see section 5). |

Implication: both major CLIs now expose a JSONL event stream, a schema-constrained final answer, a sandbox, and pre/post tool hooks. The surface is converging but not equivalent, and the guarantees are documented loosely. A backend adapter must declare capabilities per backend, and Tenric must not depend on any event the backend could suppress.

### 1.3 Structured output and constrained generation

| | |
| --- | --- |
| **Provider structured outputs** ([Claude docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) | read |
| Solves | Syntactically valid, schema-shaped model output through constrained decoding. |
| Limits | Only a subset of JSON Schema. The Claude docs list as unsupported: recursive schemas, `oneOf`, `not`, numeric constraints (`minimum`, `maximum`), string length constraints, array constraints beyond `minItems` 0 or 1, and `additionalProperties` other than `false`. A refusal can produce output that does not match the schema. |
| **JSONSchemaBench** ([arXiv 2501.10868](https://arxiv.org/abs/2501.10868)) | summary |
| Shows | Across six constrained-decoding engines and about 10k real schemas, coverage varies widely (0.03 to 0.41 on the hardest set); hosted engines had high compliance on the schemas they accept but low coverage. |
| Reuse | Use constrained decoding where available to cut retries. Never treat it as verification. |
| Remaining | A contract's schema is generally *not* expressible in a provider's subset. Tenric's own Artifact IR schema already uses `pattern`, `minimum`, `if/then` and open maps, all outside the documented subset. Lowering a contract schema to each backend's subset and re-validating the full schema afterwards is deterministic compiler work. |

Schema validity says the output has the right shape. It says nothing about whether a value is true. A fabricated accuracy of `0.99` is perfectly valid JSON.

### 1.4 Contracts, schemas, policy

| | |
| --- | --- |
| **JSON Schema 2020-12** ([spec](https://json-schema.org/draft/2020-12)), **Ajv** ([repo](https://github.com/ajv-validator/ajv)) | read (Ajv README), recalled (spec) |
| Reuse | Contract and artifact structure are JSON Schema documents validated with Ajv in strict mode (ADR-0003). |
| Limits | Structural only. Cross-field and cross-file facts (a digest matches a file, a metric equals the value in a hashed output) need code. |

| | |
| --- | --- |
| **Design by Contract** (Meyer, *Object-Oriented Software Construction*; Eiffel) | recalled |
| Mechanism | Preconditions, postconditions and invariants attached to routines, checked at run time, with blame assigned to caller or supplier. |
| Reuse | Vocabulary and the blame idea: a failed precondition (missing capability, unsupported contract version) is the caller's fault and must not be reported as a bad artifact. |
| Limits | Assumes a deterministic supplier and executable predicates. Most of a professional standard is not an executable predicate. |

| | |
| --- | --- |
| **Open Policy Agent** ([repo](https://github.com/open-policy-agent/opa)) | read (README only) |
| Solves | Decoupling policy decisions from the services that enforce them; policies in Rego evaluated over JSON input. |
| Reuse | Candidate engine for cross-field requirement checks instead of hand-written validators. Not adopted yet: three TypeScript functions do not justify a second language and runtime (ADR-0003 records the trigger for revisiting). |

Agent-specific contract work (all **summary**):

- [AgentSpec](https://arxiv.org/abs/2503.18666) (ICSE '26): a rule DSL (`trigger`, `check`, `enforce`) enforced at LangChain action hooks.
- [Agent Behavioral Contracts](https://arxiv.org/abs/2602.22302): contracts as preconditions, invariants, governance and recovery, checked per action by a runtime library; evaluated partly with an LLM judge.
- [VIGIL](https://arxiv.org/abs/2606.26524): behavioral specifications of skills as finite-trace patterns, checked with an SMT solver before each tool call. States that behavior which never appears as a tool call is outside its view.

These constrain *what an agent does during a run*. Tenric's first contract constrains *what is delivered and what evidence backs it*. The two are complementary, and the overlap is the trace: if Tenric later needs in-run rules, it should adopt one of these rather than invent a rule language.

### 1.5 Orchestration and durable execution

| | |
| --- | --- |
| **Temporal** ([workflow definition docs](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-definition.mdx)) | read (determinism section) |
| Mechanism | Workflow code must be deterministic so it can be replayed against an event history; non-deterministic work (the docs name LLM calls) goes in Activities, which are recorded and retried. |
| Reuse | The split itself: deterministic coordinator, recorded non-deterministic steps. Tenric copies the idea, not the system. |
| Limits | Guarantees that a workflow completes and can resume. Says nothing about whether the result meets a standard. Heavy for a single-engineer project, and explicitly out of scope in the brief. |

### 1.6 Experiment tracking

| | |
| --- | --- |
| **MLflow Tracking** ([docs](https://mlflow.org/docs/latest/ml/tracking/), [repo](https://github.com/mlflow/mlflow)) | read (README), recalled (details) |
| Solves | Recording parameters, metrics, artifacts and source version per run, with a UI and a store. |
| Limits | The run logs about itself: values are whatever the training process sends. No acceptance decision, no requirement that a record exist, no integrity check on artifacts after logging. |
| Reuse | Do not replace it. If a user already has MLflow, the collector should export to it or read from it. The Artifact IR field names should map cleanly onto runs, params, metrics and artifacts. |

Also relevant, **recalled** and not examined: DVC (data and pipeline versioning by content hash), Sacred, Weights & Biases, RO-Crate (packaging research objects with metadata), and W3C PROV (a provenance data model).

### 1.7 Reproducible builds, attestations, provenance

| | |
| --- | --- |
| **Reproducible Builds** ([definition](https://reproducible-builds.org/docs/definition/), [SOURCE_DATE_EPOCH](https://reproducible-builds.org/docs/source-date-epoch/)) | read |
| Mechanism | A build is reproducible if the same source, build environment and build instructions let any party recreate bit-by-bit identical copies of the specified artifacts. The author defines which attributes of the environment matter. `SOURCE_DATE_EPOCH` replaces "now" in tools that embed timestamps. |
| Reuse | The definition, the practice of naming exactly which inputs are controlled, and the habit of removing volatile metadata. See `docs/reproducibility.md`. |
| Limits | Byte identity is the wrong target for numerical work across platforms. |

| | |
| --- | --- |
| **in-toto attestations** ([Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)), **SLSA provenance** ([v1](https://slsa.dev/spec/v1.0/provenance)) | read |
| Mechanism | A Statement binds `subject` artifacts (name plus digest) to a typed `predicate`. SLSA provenance is one predicate type, with `buildDefinition` (external parameters, resolved dependencies) and `runDetails`. Signing is a separate envelope layer. |
| Reuse | The Artifact IR's `outputs` are in-toto subjects already (path plus sha256). Phase 1 should emit the verification verdict as an in-toto Statement with a Tenric predicate type instead of a private format. |
| Limits | Attests *who* built *what* from *which* inputs. Says nothing about whether the content is right. A signature moves trust to the signer; it does not create it. |
| **GitHub artifact attestations** ([action](https://github.com/actions/attest-build-provenance)) | read (README) |
| Reuse | Signed provenance from CI using short-lived Sigstore certificates. The cheapest route to a collector the agent cannot impersonate is to run collection and verification in CI. |

### 1.8 Telemetry

| | |
| --- | --- |
| **OpenTelemetry GenAI semantic conventions** ([agent spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)) | read |
| Mechanism | Span and attribute names for model calls, agent invocation (`invoke_agent`, `create_agent`) and tool execution. |
| Limits | Status is **Development**, so names can change. Telemetry emitted by the agent process is self-reported. |
| Reuse | Use the attribute names when recording lifecycle events, and do not build an event vocabulary. Treat backend telemetry as a claim unless it was captured out of process. |

## 2. What already exists, in one table

| Need | Mature answer | Tenric's stance |
| --- | --- | --- |
| Portable instructions | AGENTS.md, Agent Skills | Reuse as the advisory channel |
| Schema-shaped output | Provider structured outputs | Reuse, then re-validate |
| Structural validation | JSON Schema, Ajv | Reuse |
| Policy over JSON | OPA and Rego | Defer; revisit when checks multiply |
| In-run behavior rules | AgentSpec, ABC, VIGIL | Out of scope; adopt if needed |
| Experiment records | MLflow, DVC | Interoperate |
| Artifact identity | Content hashing, in-toto subjects | Reuse |
| Provenance format | in-toto, SLSA, Sigstore | Reuse for verdicts in Phase 1 |
| Event vocabulary | OpenTelemetry GenAI | Reuse names |
| Durable execution | Temporal and similar | Not needed yet |

## 3. Mechanisms nobody above provides together

Each of these exists somewhere. The combination, applied to delivered work, is what was not found:

1. A **versioned requirement set** in which every requirement declares how it can be checked (machine, empirical, human) and what a failure or an unrun check means for acceptance.
2. A verdict that is **computed outside the producing agent**, from evidence the agent did not write, and that **fails closed** when a validator is missing.
3. **Provenance on each record** (who asserted it), so that reports cannot mix measured values and model-written claims without the difference being visible.
4. The same contract applied **unchanged across backends**, with per-backend lowering done by deterministic code.

## 4. The prior-art gap, stated carefully

After this pass, no system was found that takes a user-owned, versioned delivery standard and returns an acceptance verdict for an agent's deliverable based on independently collected evidence, portable across agent backends. This is a statement about what a few hours of research found. It is not a novelty claim, and the items in section 5 could close the gap.

## 5. Existing work that could invalidate the architecture

1. **CI plus scripts plus MLflow is enough.** A disciplined engineer gets most of the first contract with a Makefile, a JSON Schema check, `sha256sum`, and a CI job. Phase 0's baseline is exactly that and already rejects every tampering case tested. Tenric has to show value *beyond* this (see `docs/evaluation-plan.md`), most plausibly in portability of the contract across tasks and in the explicit verdict semantics.
2. **Harness-native enforcement.** Hooks in Claude Code and Codex already run deterministic checks at `Stop` and can block completion. A `Stop` hook that runs a validator is a contract runtime for one backend. If the hook surfaces converge, Tenric shrinks to a contract format plus a validator library.
3. **Agent Skills gains versioning and outcome verification.** The SoK names verification as the open problem and the standard is under active development.
4. **VIGIL-style trace verification** extended from tool calls to delivered artifacts.
5. **ACP or a similar protocol** standardising lifecycle and permission events would make a custom Backend Adapter layer redundant.
6. **in-toto layouts** already express "these steps must be performed by these parties and produce these artifacts". A research workflow could be written as a layout. Not evaluated here; it should be before the Contract Compiler is designed.
7. **Models stop skipping requirements.** If omission rates fall to near zero, the advisory channel suffices for most users, and what remains valuable is evidence integrity and reproducibility, which are independent of model quality. That is the part worth building first, and Phase 1 is ordered accordingly.
