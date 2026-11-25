# Trust boundary, invariants and failure model

Status: proposed (Phase 0). Columns marked "Phase 0" say what is actually implemented and tested today.

## 1. Roles

| Role | What it is | Trusted? |
| --- | --- | --- |
| **Contract owner** | The person who writes and approves contracts | Yes. Root of trust. |
| **Producer** | Whatever does the work: an agent backend, or in Phase 0 `experiment.py` | **No.** Everything it writes is a claim. |
| **Collector** | Code that observes the run from outside the producer: exit status, time, source revision, environment, digests | Yes, if it runs where the producer cannot modify it |
| **Verifier** | Code that evaluates an artifact against one contract version and computes a verdict | Yes, under the same condition |
| **Reviewer** | A person answering requirements that need judgement | Yes, and recorded as `human` |

## 2. Trusted computing base

The verdict is only as trustworthy as these, so the list should stay short:

1. The contract file and the schemas it references, at a known digest.
2. The collector and verifier code, at a known source revision.
3. The schema validator (Ajv), the hash implementation (Node `crypto`, Python `hashlib`), and their runtimes.
4. `git`, for source identity.
5. The operating system and filesystem underneath all of the above.

Explicitly **outside** the TCB: the model, the agent harness, prompts, skills, AGENTS.md, anything the producer writes, and telemetry the producer emits about itself.

### The gap that exists today

In Phase 0 the producer and the collector run as the same OS user in the same working tree. A producer that wanted to could edit the collector, the contract, or `artifact.json` after the fact. The current design therefore detects *accidental* and *careless* violations (missing records, stale or edited outputs, mismatched numbers) and does **not** withstand a producer that deliberately attacks the collector. Closing this needs real isolation, and the options are in section 6. No document in this repository should claim more than this.

## 3. Evidence versus claims

Every record in the Artifact IR carries `provenance`:

| Value | Meaning | Can satisfy a mandatory evidence requirement? |
| --- | --- | --- |
| `collector` | Observed by trusted tooling outside the producer | Yes |
| `human` | Entered by a person | Yes, for human-verifiable requirements |
| `template` | Derived by fixed code from other records | Only as strong as its inputs |
| `producer` | Asserted by the executing process or agent | **No.** At best it can be cross-checked. |

In the baseline, the metric *values* are `producer` claims: the experiment computed them. What the collector establishes is narrower: these exact bytes were present when the process exited with status 0, and the numbers in the report equal the numbers in those bytes. Whether the experiment computed accuracy correctly is not established by anything in Phase 0. Establishing it would take re-execution (R-008) or independent recomputation from saved predictions.

## 4. Invariants

| ID | Invariant | Phase 0 |
| --- | --- | --- |
| I-1 | An artifact is `accepted` only if every mandatory requirement of the stated contract version has status `pass`. | Implemented in `src/verdict.ts`, tested exhaustively over all status combinations |
| I-2 | A mandatory requirement whose validator failed to run, was unavailable, or was never executed blocks acceptance. | Implemented, tested |
| I-3 | A verdict names exactly one contract id and version. Unknown contract schema versions are refused, never coerced. | Implemented in `loadContract`, tested |
| I-4 | The producer cannot change the contract, the schemas, the collector or the verifier that judge its own output. | **Not enforced** (section 2) |
| I-5 | Records marked `collector` were produced by code that does not import or execute producer code. | Held by construction in `run_baseline.py` (standard library only, subprocess boundary); not checked mechanically |
| I-6 | Every output listed in an artifact is identified by content digest, and verification re-hashes the bytes. | Implemented, tested with seven tampering cases |
| I-7 | A fixture can never be reported as a measurement: `data_class` is mandatory and fixtures say `fixture`. | Schema-enforced; no validator yet rejects a `fixture` under a contract that demands `measured` (open question Q11) |
| I-8 | Failure is recorded, never dropped: a failed, timed-out or cancelled run still yields an artifact with `execution.status` and a `failure` record. | Implemented in the collector for non-zero exit and timeout, both tested. Cancellation is not implemented: an interrupted run writes no artifact |
| I-9 | A verdict does not assert semantic correctness. It asserts which requirements passed, by which means. | Convention; wording rule in AGENTS.md |

## 5. Failure modes

"Detected today" means a test in this repository demonstrates detection on a real run.

| Failure mode | Intended response | Verdict | Detected today |
| --- | --- | --- | --- |
| Missing required metadata | R-001 fails | rejected | Yes |
| Invalid schema, or artifact not parseable | R-001 fails; dependent validators report `error` | rejected | Yes |
| Unsupported contract schema version | Contract refused before any check | none issued | Yes |
| Unsupported artifact IR version | R-001 fails | rejected | Yes |
| Output missing | R-002 fails | rejected | Yes |
| Output modified after collection | R-002 fails | rejected | Yes (edited text, flipped byte) |
| Reported metric differs from the hashed source | R-003 fails | rejected | Yes |
| Metric cites a file that is not a hashed output | R-003 fails | rejected | Yes |
| Mismatched source identifier (artifact revision is not a commit in the repository verified) | R-006 fails | rejected | Yes. Equality with the checked-out tree is not required (open question Q13) |
| Dirty working tree at run time | R-006 fails | rejected | Yes |
| Evidence asserted by the producer instead of the collector | R-004 fails | rejected | Yes, as far as the `provenance` field goes. A producer that writes `collector` itself is the gap in section 2 |
| Fabricated or unsupported finding | R-007 checks that citations resolve; R-009 (human) judges whether they justify the statement | rejected, or flagged | Yes for citations that do not resolve; the semantic part is never machine-decidable |
| Incomplete execution, timeout, cancellation | Collector records the status; R-005 fails | rejected | Yes for a failed and a timed-out run, end to end. A cancelled status is rejected by R-005, but the collector does not record cancellation |
| Validator crashes or is unavailable | Requirement status `error` or `not_run` | inconclusive | Yes (verdict logic) |
| Unauthorized file access by the producer | Sandbox denies; attempts appear in the event log | rejected | **Not addressed** |
| Unauthorized contract modification | Contract digest pinned before the run and compared after; contract lives outside the producer's writable area | none issued, run void | **Not addressed** |
| Symlinked output pointing outside the artifact directory | Verifier resolves real paths and refuses escapes | rejected | Yes (R-002 and R-003) |
| Hash collision or weak digest | SHA-256 only; algorithm recorded with each digest in a future IR version | n/a | By choice of algorithm |

Because one mandatory requirement (R-008, re-execution) has no validator yet, the real baseline run currently gets the verdict **inconclusive**, and a test asserts exactly that. Nothing in this repository has been `accepted`.

## 6. Options for enforcing I-4 (decision needed, see the Phase 0 report)

| Option | How | Cost | Strength |
| --- | --- | --- | --- |
| A. Verify in CI | Producer works on a branch; collection and verification run in a CI job from the default branch's contract and verifier | Low; needs a hosted repository | Good. The producer cannot touch the runner. Pairs with signed attestations. |
| B. Separate OS user or container | Producer runs sandboxed with a read-only mount of contracts and no access to the verifier | Medium | Good locally; depends on sandbox quality |
| C. Backend sandbox and hooks | Rely on the harness's own sandbox and a `PreToolUse` hook that denies writes to contract paths | Low | Weak alone. The enforcement lives inside the thing being constrained, and differs per backend. |
| D. Digest pinning only | Record contract and verifier digests before the run, compare after | Very low | Detects tampering after the fact, if the comparison itself is trusted |

Recommendation: D immediately (cheap, catches accidents), A as the default for anything called "accepted".
