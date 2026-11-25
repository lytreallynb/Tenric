# Tenric

*Intelligence evolves. Standards endure.*

Tenric is a model-agnostic runtime for contract-driven intelligence: it aims to give stable, verifiable, reproducible and portable deliverables across changing models, agent harnesses and execution environments.

**Status: Phase 0 bootstrap, plus Phase 1 slice 1A (a verifier for the first contract), which is tested and not yet approved.** This repository contains specifications, one working baseline experiment and the checks that exercise them. There is no runtime yet, no agent integration, and nothing here has been evaluated against a real model. See [the Phase 0 report](docs/reports/phase-0-report.md) and [the slice 1A report](docs/reports/phase-1a-report.md) for exactly what was built, run and left hypothetical.

## Quick start

Needs Node.js 22.18 or later, [uv](https://docs.astral.sh/uv/), and git.

```sh
npm ci
uv sync --locked
npm run verify
```

`npm run verify` typechecks, runs the baseline experiment twice plus a broken and a timed-out run, and runs the tests against those real runs. It is the only command whose output may be cited as evidence that the repository works.

To run the experiment alone: `npm run baseline`, then read `runs/baseline/report.md`.

To check a run against a contract:

```sh
node src/cli.ts verify runs/baseline --contract spec/contracts/research.experiment-report/0.1.0.contract.json
```

It prints each requirement's status and the verdict, and exits 0 only for `accepted`. The baseline is currently `inconclusive`: re-execution (R-008) has no validator yet. A run collected from a working tree with uncommitted changes is `rejected`.

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
| `spec/` | Contract schema, research Artifact IR schema, the first contract |
| `experiments/baseline/` | CPU-only experiment and a conventional collector, in Python |
| `src/`, `tests/` | Validators, the `verify` command line, verdict semantics as executable specification, tests |
| `fixtures/` | Hand-written demonstration data, labelled as such |

## Ground rules

- Passing schema validation or tests is never described as proof of semantic correctness.
- Evidence is what trusted tooling observed. What a producer says about itself is a claim.
- A mandatory requirement that was not checked blocks acceptance.
- Work is labelled proposed, implemented, tested, independently verified or approved, and nothing is promoted without the corresponding evidence.

Contributors, human or agent, start with [AGENTS.md](AGENTS.md).

## License

Not yet chosen. All rights reserved until a license is added.
