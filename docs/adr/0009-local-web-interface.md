# ADR-0009: A local web interface that displays and never decides

Status: implemented and tested; awaiting owner approval. Date: 2026-11-27.

**Context.** Until now the only way to see a verdict was the command line. `docs/phase-1-plan.md` listed "any UI" as explicitly not in Phase 1. On 2026-11-27 the owner asked for the interfaces to be built now, in parallel with the trust-boundary and runtime work. This record covers what was built under that instruction and the constraints it was built to. The number 0009 leaves 0007 and 0008 for those two parallel pieces of work.

**Decision.**

- `npm run ui` starts a server on the loopback interface (`ui/server/`, Node's built-in `http`, TypeScript run by type stripping) that serves a static front end (`ui/public/`, plain ES modules, no build step, no framework). No dependency is added.
- The interface displays; it does not decide. Every verdict is the record issued by `verify()` in `src/verify.ts`, reached through one file, `ui/server/core.ts`. Verification with re-execution runs the verifier's own command line as a separate process, because it takes seconds to minutes, and reads the record from its output. A contract file the registry does not list gets "no verdict issued", as on the command line. The verdict wording is the command line's, and a test compares the two on the real runs that `scripts/verify.sh` produces.
- It stores nothing (ADR-0004 stands). Verdicts are recomputed from the files on disk on every request. The list of processes started from the interface is held in memory and says so.
- Anything a slice has not delivered is shown as "not yet available", found by looking for the file or command that would provide it. Nothing is rendered from sample data. Fixtures are listed, labelled as fixtures, and never verified.
- Capabilities a contract requires are shown as "not established", which is what the verdict record says.
- Provenance is shown as "declared provenance". The label is a string in `artifact.json`; the interface says so on the page that separates evidence from claims.
- It can start a run: the Phase 0 baseline collector, or any backend the runtime lists (`node src/tenric.ts backends --json`) with any task under `tasks/` or `fixtures/tasks/`. Runtime runs are started through the runtime's command line as a separate process and followed by reading `tenric/events.jsonl`; the interface does not import the runtime. It can also compile a task without running it.
- For a run the runtime made, it shows the compiled plan, the lifecycle events with their source, the backend's self-report labelled as a claim, the re-execution comparison and the verdict record the runtime stored. That stored record is shown as a stored file. The Verdict tab still recomputes: it verifies against the run's own `workspace/` repository, under the contract the run was compiled against, and with the run's own re-execution task when asked. A test checks that this reaches the statement the runtime recorded.
- Text is in English and Chinese. The verifier's vocabulary (`pass`, `fail`, `error`, `not_run`, `accepted`, `rejected`, `inconclusive`, provenance values) is never translated.

**Why a server and not static pages.** Verdicts must be computed by the verifier at the moment of viewing, against the files as they are, and digests on disk must be compared with digests on record. A static export would be a copy of a verdict, which is exactly what the trust model warns about.

**Trust.** The interface is not part of the trusted computing base and adds nothing to it. It runs as the same user in the same working tree as the producer, so it is advisory against a deliberate producer in the same way the command line is (`docs/trust-model.md`). Because it can start processes, it refuses requests whose `Host` is not a loopback name, state-changing requests from another origin or without a JSON content type, run ids that are not a single safe path segment, and file paths that resolve outside a run directory. Run output is produced by untrusted code: it is never served as HTML and the front end never parses it as HTML.

**What is not covered.** No authentication: anyone who can reach the loopback port as a local user can start a baseline run. No human-review recording (open question Q10 is unanswered). No cancellation of a started run. Starting an agent backend from the interface goes through the same code path as the script backend, which is tested; the agent path itself is not covered by an automated test, because it needs a model. The front end has no automated tests of its own beyond the API tests and a string-table check; it was exercised by hand in a headless browser.

**Alternatives.** A framework and bundler (React, Vite): a build step and several dozen dependencies for eight screens, against ADR-0002. A static report generator: see above. A terminal interface: no figures, and no side-by-side comparison worth having. A Python server: the verifier is TypeScript, and calling it across a process boundary for every page would be slower and no more independent.

**Reverse if** the interface starts to hold state that the verifier does not, or if any screen needs to compute a status itself. Either would mean it has stopped displaying and started deciding.
