# ADR-0008: R-008 is decided by a re-execution the verifier performs itself

Status: implemented and tested; awaiting owner approval. Date: 2026-11-27.

**Context.** R-008 ("a re-execution reproduces the metrics") is mandatory and had no validator, so no run could be accepted. The review showed why the other checks cannot stand in for it: a result whose numbers were edited and re-hashed (A1), or produced in an environment that patches a library function (A6), is self-consistent. The review also warned that a re-execution in the producer's environment would repeat A6.

**Decision.**

- `tenric verify --reproduce --task <file>` re-executes during verification. There is no separate command and no reproduction file: a record in the run directory would be a producer-side claim.
- The verifier creates a fresh `git worktree` of the artifact's recorded revision, outside the working tree, and runs the task's `collect` command there. The environment is an allowlist (`PATH`, home and temp directories, proxy and certificate variables, uv's cache location); `PYTHONPATH`, `VIRTUAL_ENV` and everything else are dropped, so the command builds its environment from the lockfile at that revision.
- The command comes from a task file the verifier is given (`experiments/baseline/task.json`), not from the artifact. The artifact's `config.path` must exist at the recorded revision with the recorded digest.
- Comparison: metric names must match in both directions. In an equal environment (operating system, architecture, interpreter, tracked package versions, lockfile digest) values must be equal and every output that either the artifact or the re-execution declares `byte-identical` must have equal bytes. In a different environment values must agree within the contract's `cross_platform_abs_tolerance` and bytes are not compared.
- Statuses: `fail` when the re-execution disagrees or the recorded inputs cannot be found at the revision; `error` when the re-execution could not be carried out or there is nothing to repeat (execution failed, source not pinned); `not_run` when no re-execution was requested.
- The collector also stops passing `PYTHON*` variables to the experiment.

**What a pass means.** The recorded revision, run again by the verifier in a clean environment built from its lockfile, produced these metrics and these bytes. It does not mean the experiment computes the right thing: code at that revision that reports a wrong number reproduces the wrong number. That question stays with R-009 (human review).

**Known limits.** The re-execution runs the producer's code on the verifier's machine without a sandbox. An artifact that names a different revision with identical behaviour passes, which is harmless but means R-006 plus R-008 identify behaviour, not history. Files outside git and outside the lockfile that the interpreter reads from the home directory (user-level uv configuration) are not controlled. The cross-environment branch has unit-level coverage only; every run so far compared equal environments.

**Amendment, 2026-11-27: opt-in tolerance per metric (contract 0.3.0).** The first second task, a sort timing benchmark, was rejected by R-008 under 0.2.0: wall-clock metrics never repeat exactly. Contract 0.3.0 adds `metric_rules` to R-008's parameters: a list of `{ pattern, abs_tolerance | rel_tolerance }`, where `pattern` matches metric names and `*` is a wildcard. A metric that no rule matches is still compared exactly in an equal environment. The rules are part of the contract file, so they are covered by its digest, and the R-008 result lists every metric that was compared with a tolerance. 0.3.0 has one rule, names ending in `_seconds` within 50% of the larger value; the number is a placeholder (Q5). Contracts 0.1.0 and 0.2.0 are unchanged. Weakness: the rule keys on a name the producer chooses, so a metric can be named to fall under it; the listing in the result is what makes that visible. This was decided by default on the project coordinator's suggestion and is for the owner to confirm.

**Alternatives.** Trusting a second run by the producer or the runtime: cheaper, repeats A6. Recomputing metrics from saved predictions: independent of the experiment code, and task-specific; worth doing for a contract that needs it. Container isolation: stronger, and a new dependency without a demonstrated need yet (hard rule 6).

**Cost.** About 5 seconds on a warm cache for the baseline; a cold cache downloads the interpreter and packages.

**Reverse if** re-execution cost dominates for real tasks (then sample, or accept attested runs from a trusted runner), or a sandbox becomes necessary to run producer code at all.
