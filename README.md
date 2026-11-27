# Tenric

*Intelligence evolves. Standards endure.*

Tenric is a model-agnostic runtime for contract-driven intelligence: it aims to give stable, verifiable, reproducible and portable deliverables across changing models, agent harnesses and execution environments.

**Status: Phase 0 bootstrap, plus Phase 1 slices 1A and 1B (a verifier that binds its verdict to the contract's content and re-executes the experiment), which are tested and not yet approved.** This part of the repository contains specifications, one working baseline experiment and the checks that exercise them. Nothing here has been evaluated against a real model. See [the Phase 0 report](docs/reports/phase-0-report.md), [the slice 1A report](docs/reports/phase-1a-report.md) and [the slice 1B report](docs/reports/phase-1b-report.md) for exactly what was built, run and left hypothetical.

## Quick start

Needs Node.js 22.18 or later, [uv](https://docs.astral.sh/uv/), and git.

```sh
npm ci
uv sync --locked
npm run verify
```

`npm run verify` typechecks, runs the baseline experiment twice plus a broken and a timed-out run, runs the tests against those real runs, and finally verifies the baseline with a re-execution, which must end in `accepted`. It is the only command whose output may be cited as evidence that the repository works. It also works with uncommitted changes: it then collects its evidence from a snapshot commit of the working tree.

To run the experiment alone: `npm run baseline`, then read `runs/baseline/report.md`.

To check a run against a contract:

```sh
node src/cli.ts verify runs/baseline \
  --contract spec/contracts/research.experiment-report/0.2.0.contract.json \
  --repo . --reproduce --task experiments/baseline/task.json
```

It prints the contract's SHA-256, the artifact's SHA-256, the verifier's revision, each requirement's status and the verdict. Exit codes: 0 `accepted`, 1 `rejected`, 3 `inconclusive`, 2 no verdict issued. `--json` prints the verdict record and `--record <file>` writes it.

- With `--reproduce`, the verifier checks out the recorded revision into a fresh worktree, runs the experiment again in a clean environment and compares. Without it, R-008 is `not_run` and the verdict is at best `inconclusive`.
- A contract file whose bytes are not the ones listed in `spec/contracts/registry.json` gets no verdict.
- A run collected from a working tree with uncommitted changes is `rejected`.
- Every verdict says whether a collector the operator trusts signed the run (`; collector not attested` otherwise). Contract 0.4.0 requires that signature (R-012). Trusted collectors are listed in `spec/collectors/registry.json`, which is empty, or in the file given with `--collectors`. `node src/cli.ts collector-key` makes a key and its entry; `node src/cli.ts attest` signs a run. See ADR-0011.
- `accepted` means the listed requirements passed. It is not a statement that the findings are true, and the trust boundary has known gaps: read `docs/trust-model.md` before relying on a verdict.

## Running a task under a contract

```sh
node src/tenric.ts backends                                   # what each backend guarantees
node src/tenric.ts compile --task tasks/digits-logreg.task.json --backend claude-code
node src/tenric.ts run --task tasks/digits-logreg.task.json --backend script
node src/tenric.ts run --task tasks/digits-logreg.task.json --backend claude-code [--model <id>]
node src/tenric.ts runs
```

`run` compiles the task against its contract, lets the backend write an experiment in a workspace, executes that experiment itself, assembles the artifact from what it observed and has the verifier judge it with a re-execution. The backend never writes the artifact. Exit codes are those of `verify`. The `claude-code` backend needs the Claude Code CLI installed and signed in, takes a few minutes and spends model usage; it runs code an agent wrote on your machine **without a sandbox** (ADR-0009). File layout and commands: [docs/runtime-interface.md](docs/runtime-interface.md). What real runs showed: [docs/reports/runtime-report.md](docs/reports/runtime-report.md).

## What is here

| Path | Content |
| --- | --- |
| `docs/rfcs/RFC-0001-…md` | The minimal contract-driven runtime: problem, boundaries, architecture, acceptance semantics |
| `docs/trust-model.md` | Trusted computing base, evidence versus claims, invariants, failure modes |
| `docs/reproducibility.md` | Six distinct reproducibility guarantees and what each needs controlled |
| `docs/prior-art.md` | Existing systems, what to reuse, and what could make Tenric unnecessary |
| `docs/evaluation-plan.md` | How Tenric would be compared with instructions, skills and plain scripts |
| `docs/phase-1-plan.md`, `docs/open-questions.md` | Next slice, unresolved questions, risks |
| `docs/adr/` | Architecture decision records |
| `spec/` | Contract schema, research Artifact IR schema, contracts 0.1.0 to 0.4.0, the contract registry, the (empty) list of trusted collectors |
| `experiments/baseline/` | CPU-only experiment and a conventional collector, in Python |
| `src/runtime/`, `src/tenric.ts` | Contract compiler, execution runtime, collector, backend adapters, command line |
| `tasks/`, `spec/runtime/` | Task files; schemas for tasks and for what a producer may claim |
| `experiments/sort-benchmark/` | The second experiment, with both a runtime producer and a conventional collector |
| `evaluation/group-b/` | Runner for the comparison group that gets the standard as instructions only |
| `src/`, `tests/` | Validators, re-execution, the verdict record, the `verify` command line, verdict semantics as executable specification, tests |
| `fixtures/` | Hand-written demonstration data, labelled as such |

## Ground rules

- Passing schema validation or tests is never described as proof of semantic correctness.
- Evidence is what trusted tooling observed. What a producer says about itself is a claim.
- A mandatory requirement that was not checked blocks acceptance.
- Work is labelled proposed, implemented, tested, independently verified or approved, and nothing is promoted without the corresponding evidence.

Contributors, human or agent, start with [AGENTS.md](AGENTS.md).

## License

Not yet chosen. All rights reserved until a license is added.
