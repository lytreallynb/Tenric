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
- `accepted` means the listed requirements passed. It is not a statement that the findings are true, and the trust boundary has known gaps: read `docs/trust-model.md` before relying on a verdict.

## Web interface

```sh
npm run ui        # then open http://localhost:4173
```

A local, read-only view of this checkout: contracts and their requirements, every run under `runs/`, the verdict for each run with the result of every requirement, evidence beside claims, output digests against the files on disk, a comparison of two runs, and the documents under `docs/`. For runs made by the runtime it also shows the compiled plan, lifecycle events and the backend's own account, labelled as such. It can start a baseline run or a runtime run with any listed backend and task. It computes every verdict by calling the verifier and stores nothing. It listens on the loopback interface only; `TENRIC_UI_PORT` changes the port. It is implemented and tested, and not approved; see [ADR-0009](docs/adr/0009-local-web-interface.md) for what it is and is not.

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
| `spec/` | Contract schema, research Artifact IR schema, contracts 0.1.0 and 0.2.0, the contract registry |
| `experiments/baseline/` | CPU-only experiment and a conventional collector, in Python |
| `src/`, `tests/` | Validators, re-execution, the verdict record, the `verify` command line, verdict semantics as executable specification, tests |
| `ui/` | The local web interface: `ui/server/` (Node `http`, TypeScript) and `ui/public/` (static files, no build step) |
| `fixtures/` | Hand-written demonstration data, labelled as such |

## Ground rules

- Passing schema validation or tests is never described as proof of semantic correctness.
- Evidence is what trusted tooling observed. What a producer says about itself is a claim.
- A mandatory requirement that was not checked blocks acceptance.
- Work is labelled proposed, implemented, tested, independently verified or approved, and nothing is promoted without the corresponding evidence.

Contributors, human or agent, start with [AGENTS.md](AGENTS.md).

## License

Not yet chosen. All rights reserved until a license is added.
