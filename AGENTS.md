# Instructions for agents and contributors

This is the single source of working instructions for this repository. Tool-specific files (CLAUDE.md) only point here.

## Verify

```sh
npm ci && uv sync --locked   # once
npm run verify               # typecheck, run the baseline twice, run tests
```

A change is not done until `npm run verify` has been run on it and its actual output has been read. Never write that tests pass without having run them in the current state of the tree. If a step was skipped or failed, say so.

## Status vocabulary

Use exactly these words for any piece of work, and do not promote without the evidence named:

| Status | Evidence required |
| --- | --- |
| Proposed | A written description |
| Implemented | Code or specification in the repository |
| Tested | `npm run verify` output from the commit in question |
| Independently verified | Reproduced by someone or something other than the author, on a clean checkout |
| Approved | An explicit decision by the repository owner |

Work done by an agent is at most **Tested**. Only a person can mark something Approved.

## Hard rules

1. **Do not weaken acceptance criteria to make something pass.** `spec/`, `src/verdict.ts`, `scripts/verify.sh` and tests that assert a rejection are acceptance criteria. Changing them needs its own commit, a stated reason, and an ADR or RFC update when semantics change. Never skip or delete a failing test to get a green run.
2. **Fail closed.** A check that cannot run reports `error` or `not_run`. It never reports `pass` and is never silently dropped.
3. **Keep claims and evidence apart.** Anything the experiment or an agent writes about itself has provenance `producer`. Only code outside the producer may write `collector`.
4. **Label demonstration data.** Fixtures carry `data_class: "fixture"` and say so in their title. Never present a fixture, a mock or an unexecuted plan as a result.
5. **No semantic overclaiming.** Say "accepted under contract X version Y", never "verified correct".
6. **No new dependency, service, database or framework without a demonstrated use**, recorded in an ADR. Pin exact versions.
7. **Stay inside the phase.** Phase 0 ends at review. Do not build the compiler, runtime, adapters or evolution subsystem without an approved plan.

## Where decisions live

- `docs/rfcs/`: designs that need review before implementation. Status at the top.
- `docs/adr/`: one decision per file, with context, alternatives and what would reverse it.
- `docs/reports/`: evidence-based reports. Quote command output; do not paraphrase it into success.
- `docs/open-questions.md`: anything unresolved. Add to it instead of guessing.

## Layout and conventions

- TypeScript runs directly on Node 22 type stripping. No build step. Imports use the `.ts` extension.
- Python is for research execution and plotting only, managed by uv with a committed lockfile. Run it with `uv run --locked`.
- The collector (`experiments/baseline/run_baseline.py`) uses the standard library only and must not import experiment code.
- JSON written by tools has sorted keys and a trailing newline.
- `runs/` is disposable output and is not committed.
- Prefer a small vertical slice that runs over a general design that does not.
