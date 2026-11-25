# ADR-0002: TypeScript on Node.js for tooling, Python for research execution

Status: proposed; awaiting owner approval. Date: 2026-11-25.

**Context.** The brief suggests a TypeScript modular monolith with Python for experiments. Phase 0 needed a schema validator, hashing, a test runner, and a numerical experiment with a plot.

**Decision.**

- Tooling in TypeScript, run directly by Node.js 22 (built-in type stripping), with no bundler and no build output. `tsc --noEmit` is used for checking only.
- Research execution and plotting in Python, with uv and a committed `uv.lock`.
- One repository, one package, plain modules. No workspaces.

**Why.** JSON Schema tooling is strongest in the JavaScript ecosystem. Both candidate agent backends ship Node-based CLIs and SDKs. Scientific computing is in Python and there is no reason to fight that. The two halves talk through files, which is also the trust boundary.

**Alternatives considered.**

- *Python for everything.* One language and one lockfile, and good JSON Schema support (`jsonschema`, Pydantic). This is the strongest alternative. Rejected mainly because a verifier written in the language of the code it verifies invites accidental coupling, and the agent SDK ecosystem leans to TypeScript. If the owner prefers a single language, Phase 0 is small enough to port in a day.
- *Go or Rust.* Single static binary, which helps make the verifier tamper-evident. Slower to iterate and weaker schema tooling. Worth reconsidering for the verifier alone if it must ship as a trusted binary.

**Cost accepted.** Two toolchains, two lockfiles, two sets of pinned versions.

**Reverse if** the TypeScript side stays under a few hundred lines and never grows an adapter.
