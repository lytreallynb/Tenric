# ADR-0007: The trust boundary is the verifier's checkout, and a verdict names what it was computed from

Status: implemented and tested; awaiting owner approval. Date: 2026-11-27.

**Context.** The engineering review of 2026-11-25 built six forged or tampered results (A1 to A6). All six passed the seven machine checks. Two of them (A4, A5) were printed as `accepted under contract research.experiment-report version 0.1.0` with exit code 0, because the verifier took any file that carried that id and version as the contract. The review's first recommendation was to define the trust boundary before adding validators.

**Decision.**

1. **The boundary.** Trusted: the verifier's own checkout (`src/`, `spec/`, the contract registry, the task files it is given) and the person who chose that checkout. Untrusted: everything in the run directory, including `artifact.json` and every `provenance` field in it, and the source revision the artifact names. The verifier never takes a decision input from the run directory other than the artifact and the outputs it is judging.
2. **Contracts are identified by content.** `spec/contracts/registry.json` lists each published contract id and version with the SHA-256 of its file. `verify()` issues no verdict for a contract that is not listed or whose bytes differ (a precondition failure, RFC-0001 section 7.2 rule 6). A published version is never edited; a change is a new version and a new registry entry.
3. **A verdict is a record.** `verify()` returns, and `tenric verify --json` or `--record` writes, the verdict together with the contract SHA-256, the registry SHA-256, the artifact SHA-256, the verifier's git revision and whether its tree had uncommitted changes, and every requirement's status. The sentence required by rule 8 is the record's `statement` field.
4. **Exit codes separate the three verdicts**: 0 accepted, 1 rejected, 3 inconclusive, 2 no verdict.
5. **Contract 0.2.0** adds R-010 and R-011 so that an artifact listing nothing, or a fixture, cannot pass by having nothing to check. The contract schema's closed list of check kinds gains `required-content` and `internal-consistency`; `contract_schema` stays 0.1.0 because every existing contract remains valid.
6. **In CI, a pull request is judged by the base commit's verifier**, contract, registry and task file (job "judged by the base branch's verifier"), option A of `docs/trust-model.md` section 6. Until the base branch contains a verifier the job is skipped and says `not_run`. Amendment, 2026-11-27: the job first ran on pull request 5 (base: this branch) and the base verifier at c9c431f accepted the pull request's run under 0.2.0 with re-execution (run 45941972996). It then moved to its own workflow, `.github/workflows/trusted-verify.yml`, on `pull_request_target`, so the job definition is also read from the base branch and a pull request that edits it does not change how it is judged. Risk taken: `pull_request_target` runs the pull request's code with the base repository's context. Mitigations: read-only token not persisted to disk, no secrets, no cache, no uploads. What it does not close: someone with write access can still change the workflow on the base branch itself, which needs a branch rule (Q15).

**What this does and does not establish.**

- It establishes which contract, artifact and verifier a verdict refers to, and it removes the two routes to a false `accepted` that the review found.
- It does not make the producer unable to tamper. On one machine the producer can still edit the registry, the verifier or the run directory. The record then shows a different registry digest or verifier revision, which only helps a reader who compares it with a known value.
- The CI job is trusted only as far as the workflow file is: a pull request can edit `.github/workflows/verify.yml` itself. Closing that needs a repository rule that the owner sets (required workflow or protected workflow path). It is listed as an open question.
- `capabilities.established` in the record is always empty. The contract asks for an independent collector; nothing here can attest one. Rule 6 says an unmet capability means no verdict; this verifier issues a verdict and states the gap in every record and every printed result. Whether that is acceptable is an owner decision.
- `provenance: "collector"` remains a field anyone can write. R-004 is retitled in 0.2.0 to say so.

**Defaults taken without an explicit owner answer** (the recommended options from the Phase 0 report and the review): a dirty working tree fails R-006; human review (R-009) stays advisory; three verdicts, one rule, no override; the source revision must exist in the repository and need not be `HEAD`.

**Alternatives.** Signing verdicts (in-toto, Sigstore): the right next step once verification runs somewhere the producer cannot reach; signing a verdict computed on the producer's machine would add ceremony, not trust. Embedding the contract digest in the artifact: the artifact is producer-side, so it binds nothing. A `--registry` flag on the command line: left out so that the default route has one root of trust; `verify()` takes `registryPath` for tools that pin their own registry, and the record carries its digest.

**Reverse if** contracts need to be distributed outside this repository (the registry then needs signatures or a transparency log), or the owner decides that an unestablished capability must block the verdict as rule 6 says.
