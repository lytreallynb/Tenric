# Open questions and risks

Status: living document. Add to it instead of guessing.

## Research questions

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | What share of a real professional standard is machine-checkable? | If most requirements are `human`, the verdict is mostly `inconclusive` and Tenric is a checklist. Measure on two or three real standards before generalising. |
| Q2 | Can findings be tied to evidence more tightly than "cites something that exists"? | R-007 is weak. Options: numbers quoted in a statement must equal cited metrics; statements built from templates with typed slots. An LLM judge is not a deterministic answer. |
| Q3 | Does one contract transfer across tasks without edits? | This is hypothesis H3. Slice 1D gives the first data point. |
| Q4 | What does contract version compatibility mean? | When may an artifact produced under 0.1.0 be verified under 0.2.0? Needs rules for adding, tightening and removing requirements. Prerequisite for Controlled Evolution. |
| Q5 | What tolerance is right for numerical reproduction, and who sets it? | The 0.01 in the first contract is a placeholder. Probably per metric, from measured variance across platforms and seeds. |
| Q6 | What do real backends actually guarantee? | Documentation for structured output, exit codes and default sandboxing is loose or inconsistent. Needs black-box conformance tests per backend, which are themselves an evaluation product. |
| Q7 | Can evidence be collected independently when the agent itself runs the experiment inside its session? | The collector must wrap or re-run the execution. Re-running is clean and costs compute; wrapping needs the backend to route commands through Tenric. |
| Q8 | How should partial or failed work be delivered? | A failed run with an honest failure record is a valid deliverable under some contracts. The current contract makes success mandatory. |
| Q9 | Is there measurable value over group C? | See the falsification condition in `docs/evaluation-plan.md`. |
| Q10 | How are human review results recorded and bound to an artifact digest? | Needed before any contract with a mandatory `human` requirement can be accepted. |

## Technical risks

| Risk | Consequence | Mitigation or status |
| --- | --- | --- |
| Producer and verifier share a user and a working tree | Trust model is advisory against a deliberate producer | Known; options in `docs/trust-model.md` section 6; slice 1C |
| Cross-platform numerical drift | "Reproducible" claims fail on a second machine | Untested; slice 1B |
| Canonical JSON is "sorted keys", not RFC 8785 | Digests of artifacts differ across implementations | Adopt JCS before any artifact digest is signed |
| Collector and verifier are in different languages | Two hash and JSON implementations must agree | Fine for SHA-256 over bytes; a risk for anything canonicalised |
| Schema strictness slows iteration | Every IR change breaks fixtures | Intended while the IR is small; revisit at the second artifact type |
| Very new dependency majors (TypeScript 7, Vitest 5, NumPy 2.5) | Ecosystem churn | Exact pins and lockfiles; versions were simply the latest at bootstrap, not a deliberate choice |
| The `runs/` directory is not committed | Evidence quoted in reports cannot be re-read later, only regenerated | Acceptable while runs are reproducible; revisit with attestations |
| Environment record is Python-specific | The IR does not fit non-Python experiments | Generalise only when a second ecosystem appears |
| Output paths may be symlinks | A listed output could point outside the run directory | Verifier must resolve real paths; slice 1A |
| Dataset identity assumes one file bundled in a package | Does not cover downloaded or multi-file datasets | Extend to a manifest of digests when needed |

## Things that could invalidate the architecture

Kept in one place: `docs/prior-art.md` section 5, and RFC-0001 section 10.

## Not verified in Phase 0

- Any behaviour of any model or agent backend. No backend was invoked.
- Reproduction on a second machine, operating system or architecture.
- The timeout and cancellation paths through the collector. (A run that exits non-zero is tested.)
- Prior-art entries marked "summary" or "recalled" in `docs/prior-art.md`.
- That anyone other than the author can follow the README from a clean clone.
