# Open questions and risks

Status: living document. Add to it instead of guessing.

## Research questions

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | What share of a real professional standard is machine-checkable? | If most requirements are `human`, the verdict is mostly `inconclusive` and Tenric is a checklist. Measure on two or three real standards before generalising. |
| Q2 | Can findings be tied to evidence more tightly than "cites something that exists"? | R-007 is weak. Options: numbers quoted in a statement must equal cited metrics; statements built from templates with typed slots. An LLM judge is not a deterministic answer. |
| Q3 | Does one contract transfer across tasks without edits? | This is hypothesis H3. Slice 1D gives the first data point. |
| Q4 | What does contract version compatibility mean? | When may an artifact produced under 0.1.0 be verified under 0.2.0? Needs rules for adding, tightening and removing requirements. Prerequisite for Controlled Evolution. |
| Q5 | What tolerance is right for numerical reproduction, and who sets it? | The 0.01 in the first contract is a placeholder. Probably per metric, from measured variance across platforms and seeds. First data point (2026-11-27, runtime work, a sort timing benchmark): R-008 rejects it under contract 0.2.0, because in an equal environment metrics must be equal and wall-clock metrics never repeat (0.0243 s against 0.0222 s). The contract does not transfer to a task with inherently noisy metrics without a new contract version, for example a per-metric tolerance or a determinism class for metrics. Contract 0.3.0 adds an opt-in per-metric tolerance for names ending in `_seconds` (ADR-0008 amendment); taken by default, for the owner to confirm. It is a result for H3 either way: the contract needed a new version for the second task. |
| Q6 | What do real backends actually guarantee? | Documentation for structured output, exit codes and default sandboxing is loose or inconsistent. Needs black-box conformance tests per backend, which are themselves an evaluation product. |
| Q7 | Can evidence be collected independently when the agent itself runs the experiment inside its session? | The collector must wrap or re-run the execution. Re-running is clean and costs compute; wrapping needs the backend to route commands through Tenric. |
| Q8 | How should partial or failed work be delivered? | A failed run with an honest failure record is a valid deliverable under some contracts. The current contract makes success mandatory. |
| Q9 | Is there measurable value over group C? | See the falsification condition in `docs/evaluation-plan.md`. |
| Q10 | How are human review results recorded and bound to an artifact digest? | Needed before any contract with a mandatory `human` requirement can be accepted. |
| Q11 | Should a contract be able to demand `data_class: "measured"`? | Answered in contract 0.2.0: R-010 (`required-content`) does. Contract 0.1.0 is unchanged and still does not. |
| Q12 | How is a snapshot source located and re-hashed? | The IR records `snapshot_sha256` and nothing else. Until this is answered `source-pinned` reports `error` for snapshots, so only git sources can pass R-006. |
| Q13 | Must the recorded revision equal the tree being verified, or only exist in the repository? | `source-pinned` requires a commit that exists; kept as the default without an explicit owner answer. With R-008 the revision must also reproduce the results, so naming an unrelated commit is rejected unless it behaves identically. |
| Q14 | Should an unestablished capability block the verdict, as RFC-0001 section 7.2 rule 6 says? | The contract requires `independent-collector`. Nothing can attest that today, and the verifier issues a verdict anyway while stating that no capability is established. Enforcing rule 6 literally means no verdict exists outside a trusted runner. Owner decision. Update 2026-11-27: contract 0.4.0 lets a run establish capabilities through a signed record from a collector listed by the operator (ADR-0011); `capabilities.established` is then the listed entry's `establishes`. Whether a missing capability should block the verdict is still open. |
| Q15 | How is the CI workflow itself protected from the pull request it judges? | Partly answered 2026-11-27: the trusted job now runs on `pull_request_target`, so its definition comes from the base branch and a pull request cannot edit it. Still open: making that check required and protecting the base branch's workflow files needs a repository rule only the owner can set. |
| Q16 | What is the root of trust for the contract registry once contracts leave this repository? | `spec/contracts/registry.json` is trusted because the verifier's checkout is. Distribution needs signatures or a transparency log. |
| Q17 | Is running the producer's code on the verifier's machine acceptable without a sandbox? | R-008 does exactly that. Fine for this repository's own experiment; not for code an agent wrote. |
| Q18 | Should images be compared by decoded pixels instead of file bytes? | The figure is pixel-identical and not byte-identical across platforms. A `pixel-identical` determinism class would let the contract promise what actually holds; it needs an image decoder in the verifier. Cause found 2026-11-27: on Linux, Pillow's PNG encoder calls the operating system's `libz.so.1` (Ubuntu 24.04: zlib 1.3), not the zlib-ng 2.3.3 that the same wheel bundles on macOS and Windows (`ldd` and `LD_DEBUG=bindings` locally; CI prints `pillow zlib 1.3` on Linux and `1.3.1.zlib-ng` on both others). So even on Linux the PNG bytes depend on a system package the lockfile does not pin, and the equal-environment test of R-008 does not record it. |
| Q19 | Does the verdict need to say who collected the evidence? | A group B agent wrote its own `collect.py`, marked its records `collector`, and was accepted under the same contract with the same statement as a runtime run (`docs/reports/runtime-report.md` section 6). R-004 reads a label. The difference between the two exists only in how the run was produced, and nothing in the verdict record carries it. Related to Q14. Options: the runtime signs or attests its artifact and the contract requires the attestation; or the verdict statement names the established capabilities prominently. |
| Q20 | Should the runtime sandbox the code an agent wrote? | The runtime executes `experiment.py` written by a model on the host, as the user, with whatever network access the host has. It detects writes to the repository's trusted files after the fact and voids the run; it prevents nothing. Extends Q17. |
| Q21 | How should a multi-file or derived dataset be recorded? | The IR has one dataset file. In the ridge task scikit-learn's diabetes data is two files; agents hashed one of them, or wrote a combined CSV and hashed that. Both pass. A manifest of digests is the obvious extension. |
| Q22 | Should numbers in findings be allowed outside collector-filled slots? | The collector fills `{{metric:name}}` slots; an agent can still type a number in the prose. The runtime adds a review note when it sees a decimal outside a slot (see the report for how often) and does not reject. Making it mandatory needs a rule for what counts as a number. |
| Q23 | Is the runtime's own re-execution worth its cost now that the verifier re-executes? | Every run executes the experiment three times: once for evidence, once by the runtime to learn early whether it reproduces, once by the verifier. The second is redundant for the verdict. |
| Q24 | How should a contract tell a producer about naming conventions it depends on? | Contract 0.3.0 tolerates metrics matching `*_seconds`. Three of the six runs by the two cheaper models named timing metrics `..._seconds_1000` and were rejected. The compiler states the rule in the task instructions; a pre-execution lint that warns when a metric looks like a timing and does not match would catch it before spending a run. It would also be a heuristic. |
| Q25 | What does a second agent harness need from the backend interface? | Only the Claude Code CLI is implemented. The interface (`src/runtime/backends.ts`) was designed from one example and is unproven until a second, different harness fits it without change. |
| Q26 | Who keeps the collectors file, and where do collector keys live? | Contract 0.4.0 accepts only runs signed by a key the verifier's operator listed (ADR-0011). The repository ships an empty list. For CI, a key would be a repository secret, which a pull request from a fork cannot read but a maintainer's branch can; a key in the runtime's home directory is readable by anything running as that user outside the sandbox. Owner decision, together with Q14 and Q15. (Q19 to Q25 are numbered on the runtime branch.) |

## Technical risks

| Risk | Consequence | Mitigation or status |
| --- | --- | --- |
| Producer and verifier share a user and a working tree | Trust model is advisory against a deliberate producer | Known; options in `docs/trust-model.md` section 6; slice 1C |
| Cross-platform numerical drift | "Reproducible" claims fail on a second machine | Metrics were identical on three platforms in the first CI run. The re-execution's cross-environment comparison (tolerance) has not been exercised by a real run: every re-execution so far ran in an environment equal to the original |
| Canonical JSON is "sorted keys", not RFC 8785 | Digests of artifacts differ across implementations | Adopt JCS before any artifact digest is signed |
| Collector and verifier are in different languages | Two hash and JSON implementations must agree | Fine for SHA-256 over bytes; a risk for anything canonicalised |
| Schema strictness slows iteration | Every IR change breaks fixtures | Intended while the IR is small; revisit at the second artifact type |
| Very new dependency majors (TypeScript 7, Vitest 5, NumPy 2.5) | Ecosystem churn | Exact pins and lockfiles; versions were simply the latest at bootstrap, not a deliberate choice |
| The `runs/` directory is not committed | Evidence quoted in reports cannot be re-read later, only regenerated | Acceptable while runs are reproducible; revisit with attestations |
| Environment record is Python-specific | The IR does not fit non-Python experiments | Generalise only when a second ecosystem appears |
| Output paths may be symlinks | A listed output could point outside the run directory | Done in slice 1A: R-002 and R-003 resolve real paths and fail on escape |
| Dataset identity assumes one file bundled in a package | Does not cover downloaded or multi-file datasets | Extend to a manifest of digests when needed |

## Things that could invalidate the architecture

Kept in one place: `docs/prior-art.md` section 5, and RFC-0001 section 10.

## Not verified in Phase 0

- Any behaviour of any model or agent backend. No backend was invoked.
- Reproduction on a second machine, operating system or architecture. Since done in CI: see `docs/reports/ci-first-run.md` and `docs/reports/phase-1b-report.md`. Line endings and the Python patch version are now controlled. The PNG difference is narrowed down: decoded pixels are equal on all three platforms and only the compressed stream differs. Which library build causes that is not determined.
- The cancellation path through the collector, which is not implemented: an interrupted run writes no artifact. (Non-zero exit and timeout are tested.)
- Prior-art entries marked "summary" or "recalled" in `docs/prior-art.md`.
- That anyone other than the author can follow the README from a clean clone.
