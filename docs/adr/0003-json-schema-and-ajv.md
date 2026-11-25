# ADR-0003: JSON Schema 2020-12 validated by Ajv in strict mode

Status: proposed; awaiting owner approval. Date: 2026-11-25.

**Context.** Contracts and artifacts need a structural definition that is language-neutral and that existing tools understand.

**Decision.** Contract and Artifact IR structure are JSON Schema draft 2020-12 documents. Validation uses Ajv 8 (`ajv/dist/2020`) with `strict: true`, so unknown keywords and ambiguous schemas are errors. `strictRequired` is turned off because `if`/`then` branches require properties declared on the parent. No `format` keywords are used; patterns are explicit, so there is no dependency on `ajv-formats`.

Requirements that cross fields or files (digests match files, metrics equal values in hashed outputs) are written as TypeScript functions keyed by a closed list of check kinds.

**Alternatives.**

- *Zod or TypeBox.* Pleasant in TypeScript, but the schema would live in code and stop being a portable artifact.
- *CUE.* Unifies schema and constraints elegantly; far smaller ecosystem and another tool to install.
- *OPA with Rego for cross-field checks.* The right shape for policy as code. Not justified for three checks.
- *Hand-written validation.* No.

**Reverse or extend if** validators exceed roughly ten kinds, or contract owners need to write checks without changing Tenric's code. At that point evaluate OPA (as WebAssembly, to avoid a daemon) before inventing a rule language.
