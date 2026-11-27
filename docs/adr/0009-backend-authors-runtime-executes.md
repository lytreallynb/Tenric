# ADR-0009: The backend authors the experiment; the runtime executes it and writes the artifact

Status: implemented and tested; awaiting owner approval. Date: 2026-11-27.

**Context.** Open question Q7 asked how evidence can be collected independently when an agent runs the experiment inside its own session. An agent that runs the experiment and then reports the numbers is the producer certifying itself, which is the problem RFC-0001 starts from. The first review also showed that a `provenance` string written by the producer is worth nothing.

**Decision.**

- A backend's deliverable is a *workspace*: `experiment.py`, `config.json` and `claims.json`. It is not a report and not an artifact.
- After the backend has exited, the runtime commits the workspace, executes `experiment.py` itself as a child process with a pinned environment and a time limit, hashes every file that execution writes, and assembles the Artifact IR. Runs the agent makes during its session are for its own checking and are never read.
- `claims.json` is validated against `spec/runtime/research.experiment-report.claims.schema.json`, which has no field for provenance, digests, exit status or metric values and refuses unknown fields. A metric is declared as a name and a JSON Pointer; the collector reads the value from the hashed file.
- Numbers in findings are slots (`{{metric:name}}`), filled by the collector from the same hashed values. A producer cannot mistype, round up or invent a metric value in a finding by this route. A decimal number typed outside a slot is listed in `tenric/run.json` under `review_notes` for the human reviewer; it is not a verdict input.
- The source the artifact pins (R-006) is the workspace commit made by the runtime, so the verifier's re-execution (ADR-0008) checks out exactly what the backend wrote.
- The verdict comes from `verify()` in `src/verify.ts`, unchanged. The runtime adds no acceptance logic of its own.

**What this does and does not establish.** Established by observation: the bytes the experiment wrote, its exit status and duration, the environment, and that the reported numbers are the numbers in those bytes. Not established: that the experiment computes what its brief asks. An agent can write an experiment that prints a constant; it would reproduce perfectly. That stays with human review (R-009).

**Trust boundary: detection, not prevention.** The backend and the experiment run as the runtime's own OS user. The runtime (a) puts the backend's working directory outside the repository, (b) pins the contract, registry, schema and compiled plan by digest before the backend starts and compares afterwards, (c) digests `spec/`, `src/`, `scripts/` and the lockfiles before and after, and (d) refuses a run directory that contains anything but its own records before collection. Any violation makes the run `void`: no artifact and no verdict. A backend that tampers and then restores the original bytes, or that alters the runtime's process or the installed Python packages, is not detected. Open question Q17 applies in full: this executes code an agent wrote, on the user's machine, without a sandbox.

**Alternatives.** Wrapping the agent's own commands (needs the harness to route execution through Tenric; differs per harness; hooks run inside the thing being constrained). Trusting a structured final message from the agent (no independence at all). Having the agent write the artifact and checking it afterwards (this is what the bypass experiments defeated).

**Cost.** The experiment runs three times per run: once for the record, once by the runtime to compare outputs per file, once by the verifier for R-008. Acceptable for experiments that take seconds. The runtime's own second execution is redundant with the verifier's for the verdict and exists to show *which* outputs differ; `--no-reexecute` turns it off.

**Reverse if** real tasks cannot be expressed as "a program plus claims" (for example work whose value is in the session itself), or if execution cost makes three runs unaffordable.
