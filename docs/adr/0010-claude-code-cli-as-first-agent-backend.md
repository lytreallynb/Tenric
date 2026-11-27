# ADR-0010: Claude Code in headless mode is the first agent backend; it is not a dependency

Status: implemented; exercised by real runs (see `docs/reports/runtime-report.md`); awaiting owner approval. Date: 2026-11-27.

**Context.** RFC-0001 section 8 asked for a minimal adapter interface and warned against assuming that backends are alike. Hard rule 6 forbids a new dependency without a demonstrated use. The owner approved building the adapters on 2026-11-27.

**Decision.**

- The adapter interface is `describe()` and `run(request)` (`src/runtime/backends.ts`). `describe()` returns named capabilities, each with `supported` and a sentence saying what is actually guaranteed. `run()` receives the compiled instructions, a workspace directory, limits and an abort signal, and returns an outcome (`completed`, `failed`, `timeout`, `cancelled`) plus a `self_report` that is labelled backend-reported everywhere it appears.
- Two backends exist. `script` copies a producer written in advance; it is the degenerate adapter the RFC describes. `claude-code` runs the `claude` executable found on `PATH` with `-p --output-format stream-json`, the instructions on stdin, the workspace as working directory, tools limited to Read, Write, Edit, Glob, Grep and Bash, no MCP servers, and `--max-budget-usd` from the task's limits.
- The CLI is **not** added to `package.json` or any lockfile. It is an external program the user installs and signs in to. The version that ran is recorded per run in `tenric/run.json` (`backend.self_report.cli_version`), as reported by the CLI itself.
- The adapter fails closed: a non-zero exit, an exit of 0 without a result event, and a result event marked as an error are all `failed`.
- Neither backend claims a sandbox, and a test asserts that.

**Not done.** A second agent harness (for example Codex CLI) is not implemented: none is installed in the environment this was built in, and an adapter that has never run would be a claim. "Replaceable backend" is therefore demonstrated between a script and one agent harness, and between four models of that harness, not between harnesses. Structured output (`--json-schema`) is not used, so the schema lowering described in RFC-0001 section 4 item 3 is not implemented; the file-based producer interface made it unnecessary for this artifact type.

**Alternatives.** The Agent SDK as a library (a real dependency, more control over tools and hooks; not needed to get a workspace written). Calling a model API directly (then Tenric would be writing an agent loop, which section 2 of the RFC rules out).

**Reverse if** the CLI's flags or stream format change often enough that the adapter needs constant repair, or a contract needs guarantees (a sandbox, tool-level audit) the CLI cannot give.
