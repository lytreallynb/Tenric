# Runtime interface: files and commands

Status: implemented and tested. This is what other tools (a UI, scripts, CI) may rely on. Files are JSON with sorted keys and a trailing newline unless stated.

## Run directory `<runs-root>/<run-id>/`

The default root is `runs/`, which is not committed.

| Path | Written by | Content |
| --- | --- | --- |
| `artifact.json` | runtime collector | Artifact IR (`spec/research-report.artifact.schema.json`). Absent when the run is `void`. |
| `report.md` | runtime collector | Rendering of the IR. Written only when the execution succeeded. |
| `metrics.json`, `figures/*`, other files at the root | the experiment, observed by the collector | Hashed outputs, all listed in `artifact.outputs[]` |
| `workspace/` | backend (content), runtime (commits) | Git repository: `TASK.md`, `tenric.task.json`, `claims.schema.json`, and the backend's `experiment.py`, `config.json`, `claims.json` |
| `tenric/run.json` | runtime | Summary of the run. The entry point for a UI. |
| `tenric/plan.json` | compiler | The compiled plan |
| `tenric/events.jsonl` | runtime | One JSON object per line: `seq`, `ts`, `source` (`runtime`, `collector` or `backend`), `type`, and type-specific fields. Events with source `backend` are derived from the backend's own stream and are claims. |
| `tenric/verification.json` | the verifier, through `verify()` | The verdict record (`VerdictRecord` in `src/verify.ts`) |
| `tenric/reproduce.task.json` | runtime | The task file the verifier re-executes with |
| `tenric/reexecution.json` | runtime | The runtime's own second execution, compared per output and per metric. Informational; the verifier does not read it. |
| `tenric/backend/` | adapter | The backend's own account: `prompt.txt`, `events.jsonl` (raw stream), `final_message.txt`, `result.json`, `stderr.txt`. Claims, not evidence. |
| `tenric/execution.stdout.txt`, `tenric/execution.stderr.txt` | collector | Captured from the experiment process |

A run directory written by the baseline script has no `tenric/` directory and is still a valid input to `tenric verify`.

### `tenric/run.json` (`run_schema` 0.1.0)

| Field | Meaning |
| --- | --- |
| `run_id`, `created_at`, `finished_at` | Identity and times (UTC) |
| `status` | Lifecycle, not the verdict: `completed`, `failed`, `timeout`, `cancelled`, or `void` (integrity violation or tooling error; no artifact, no verdict) |
| `status_detail` | Why, when not `completed` |
| `data_class` | `measured` or `fixture` |
| `task` | `id`, `title`, `path`, `sha256` |
| `contract` | `id`, `version`, `path`, `sha256` |
| `backend` | `name`, `kind`, `outcome`, `seconds`, `self_report` (backend-reported: model, cost, turns, CLI version) |
| `phases[]` | `name` (`compile`, `workspace`, `backend`, `integrity`, `commit`, `execute`, `reexecute`, `verify`), `status`, `started_at`, `seconds`, `detail` |
| `source` | `revision` of the workspace commit, or null |
| `trusted_base_sha256` | Digest over `spec/`, `src/`, `scripts/` and the lockfiles when the run started |
| `artifact` | `path`, `sha256`, or null |
| `verification` | `verdict`, `mandatory_passed`, `mandatory_total`, `wording` (the only sentence to quote), `path`; or null when no verdict was issued |
| `reexecution` | `consistent_with_declared`, `path`; or null |
| `review_notes[]` | Things for a human reviewer |
| `files` | Run-relative paths of the records above, null when absent |

### `tenric/plan.json` (`plan_schema` 0.1.0)

`task`, `contract` (with `sha256`, `registry_sha256`, `schema_sha256`), `backend` (with `capabilities`), `applicability` (`required`, `provided`, `missing`), `requirements[]` (`id`, `title`, `level`, `verifiability`, `kind`, `supplied_by`, `producer_obligations`, `validator.available`, `validator.order`), `predicted` (`best_verdict`, `blocking_unavailable`, `known_failures`), `review_checklist[]`, `warnings[]`, `instructions`, `limits`. The plan contains no timestamps: equal inputs give equal bytes.

## Command line

`node src/tenric.ts <command>` (or `npm run tenric -- <command>`).

| Command | Purpose |
| --- | --- |
| `backends [--json]` | List backends and what each capability guarantees |
| `compile --task <file> --backend <name> [--json]` | Compile only and print the plan |
| `run --task <file> --backend <name> [--out <run-dir>] [--model <id>] [--no-reexecute] [--json]` | Full run. Default run directory: `runs/<task-id>-<backend>-<timestamp>` |
| `collect --workspace <dir> --out <dir>` | Execute and collect a committed workspace. Used by the verifier's re-execution. |
| `runs [--root <dir>] [--json]` | List `tenric/run.json` summaries under a root, newest first |
| `show <run-dir> [--json]` | One run |
| `verify …` | Passed through to `src/cli.ts` unchanged |

Exit codes of `run`, as for `verify`: 0 `accepted`, 1 `rejected`, 3 `inconclusive`, 2 no verdict issued (bad usage, a precondition failure before anything ran, or a `void` run).

An agent run takes minutes and spends model usage. A caller should start it as a background process and follow `tenric/events.jsonl`.

## Inputs

- Tasks: `tasks/*.task.json`, schema `spec/runtime/task.schema.json`. A task names a contract id and version, a prose `brief` (for agent backends) and optionally a `script_producer` directory (for the script backend).
- Contracts: `spec/contracts/<id>/<version>.contract.json`, which must be listed in `spec/contracts/registry.json`.
- Producer interface: `spec/runtime/research.experiment-report.claims.schema.json`.

## Module exports

`src/runtime/backends.ts`: `listBackends()`, `getBackend(name)`. `src/runtime/compiler.ts`: `compile()`, `PreconditionError`. `src/runtime/runtime.ts`: `runTask()`. `src/runtime/runs.ts`: `listRuns(root)`, `readRun(dir)`. `src/runtime/collector.ts`: `collect()`.
