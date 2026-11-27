# Contract compiler, runtime and agent backend: real runs, then a sandbox and a signed collector record

| | |
| --- | --- |
| Date | 2026-11-27 |
| Revisions quoted | Sections 3 to 7: runtime runs (group D) and the group C run at `d80939d`; group B runs at `d0629ed`, which differs from `d80939d` only by adding `evaluation/group-b/`; `npm run verify` at `c17ad74`. Section 10: all runs at `a3c62c5`; `npm run verify` as stated there |
| Status | **Tested**. Not independently verified by a second party, not approved |
| Author | An AI agent (Claude) |
| Decisions | `docs/adr/0009-backend-authors-runtime-executes.md`, `docs/adr/0010-claude-code-cli-as-first-agent-backend.md`, `docs/adr/0013-namespace-sandbox-for-producer-code.md`; ADR-0011 (collector attestation) is the verification branch's |
| Data | `docs/reports/data/runtime-runs.json`: one record per run quoted here. The run directories are not committed |

This covers the three components of RFC-0001 that were design only: the contract compiler, the execution runtime and the backend adapters. It reports what happened when real models were run through them, and what that says about the hypotheses in `docs/evaluation-plan.md`. Section 7 is the one the plan says the project depends on. Section 10 reports a second round, after the owner asked to continue: the agent and its experiment now run in a sandbox, the runtime signs what it collected, and contract 0.4.0 requires that signature. Sections 3 to 9 are left as they were written, so the first round can be compared with the second; where the second round changes a conclusion, section 10 says so.

Every model, cost and turn count below is what the backend said about itself (`provenance: producer`). Wall time, verdicts and digests were observed by the runtime or the verifier.

## 1. What exists now

| Component | State | Where |
| --- | --- | --- |
| Contract compiler | Implemented, tested. Resolves the contract through the registry, pins digests, partitions requirements by who supplies them, predicts the best reachable verdict, derives the producer's instructions. Calls no model. Schema lowering (RFC-0001 section 4 item 3) is not built | `src/runtime/compiler.ts` |
| Execution runtime | Implemented, tested. Workspace outside the repository, backend, integrity check, commit, execution, own re-execution, verdict from `verify()` | `src/runtime/runtime.ts`, `collector.ts` |
| Backend `script` | Implemented, tested | `src/runtime/backends.ts` |
| Backend `claude-code` | Implemented. Adapter logic tested against a fake CLI; behaviour with real models is section 3 | `src/runtime/backends.ts` |
| Second agent harness | Not implemented | Q25 |
| Sandbox | Not implemented. The runtime detects tampering and voids the run; it prevents nothing | Q20 |
| Evolution subsystem | Not started | |

The division of work (ADR-0009): the backend writes `experiment.py`, `config.json` and `claims.json`. The claims file has no field for a digest, a metric value, an environment or an exit code. The runtime commits the workspace, runs the experiment, hashes what it wrote, reads metric values out of the hashed files, fills the numbers into the findings, and assembles the artifact. The verifier then re-executes the committed workspace and compares.

Size: 1,557 lines of TypeScript and 36 of Python under `src/runtime/` and `src/tenric.ts`; 65 tests in `tests/runtime/`. The verifier, `scripts/verify.sh`, the published contracts and the artifact schema are unchanged by this work.

## 2. `npm run verify`

Linux x86_64, clean worktree at `c17ad74`. Output unedited except that a repeated uv deprecation warning, blank lines and the per-file test lines are removed:

```
== tenric verify
revision: c17ad74fcdb333d28b2d780388141b6b65d90187
node v22.23.5, Python 3.13.14, Linux x86_64
== 1/4 typecheck
== 2/4 baseline experiment, executed twice, then once with a broken config and once with a timeout it cannot meet
succeeded: wrote /home/claude/tenric-runs/runs/verify-a/artifact.json
succeeded: wrote /home/claude/tenric-runs/runs/verify-b/artifact.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-a/metrics.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-b/metrics.json
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-a/figures/confusion_matrix.png
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-b/figures/confusion_matrix.png
failed: wrote /home/claude/tenric-runs/runs/verify-fail/artifact.json
timeout: wrote /home/claude/tenric-runs/runs/verify-timeout/artifact.json
== 3/4 tests
 Test Files  9 passed (9)
      Tests  177 passed (177)
== 4/4 verdict for the baseline run, with re-execution
contract: research.experiment-report version 0.2.0 sha256 6f1d9eafe02d17746ed3e106722fe2ae0a7c1a010f074f688eb5ee3003651e11 (matches the registry)
artifact: runs/verify-a/artifact.json sha256 ca7872552f89b3b3e836e7d4db2e50824dff0f64355f18bd7b3f76f4c4342bdb
verifier: revision c17ad74fcdb333d28b2d780388141b6b65d90187
R-001  pass     Artifact conforms to the IR schema (mandatory, machine)
R-002  pass     Every listed output exists and matches its recorded size and SHA-256 (mandatory, machine)
R-003  pass     Every reported metric equals the value at its pointer in a hashed output (mandatory, machine)
R-004  pass     Source, environment, dataset, config, execution and output digests are marked as recorded by the collector (mandatory, machine)
R-005  pass     Execution completed successfully (mandatory, machine)
R-006  pass     Source is pinned to a clean revision or a hashed snapshot (mandatory, machine)
R-007  pass     Every finding references metrics, figures or outputs that exist in the artifact (mandatory, machine)
R-008  pass     A re-execution reproduces the metrics (mandatory, empirical)
       re-executed revision c17ad74fcdb333d28b2d780388141b6b65d90187 in an equal environment: 3 metrics equal, 3 outputs byte-identical
R-009  not_run  Findings and limitations are justified by the evidence (advisory, human)
       no validator for human-review yet
R-010  pass     The artifact is a measurement and contains metrics, a report and at least one finding (mandatory, machine)
R-011  pass     Names are unique and every figure points at listed outputs (mandatory, machine)
note: the contract requires capabilities this verifier cannot establish: independent-collector, content-hashing
verdict: accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human)
== verify: OK
exit 0
```

## 3. Real runs through the runtime (group D)

Three tasks, each a file under `tasks/`:

- `digits-logreg`: logistic regression on scikit-learn's digits data. The Phase 0 baseline, restated as a brief. Contract 0.2.0.
- `ridge-diabetes`: effect of ridge regularisation strength on the diabetes data. New; no hand-written producer exists. Contract 0.2.0.
- `sort-benchmark`: timing of a merge sort against the built-in sort. New, and chosen to differ: its metrics are wall-clock times, which do not repeat exactly. Contract 0.3.0 (section 5.2 says why).

Command, one per run, three at a time on a 4-core Linux container:

```sh
node src/tenric.ts run --task tasks/<task>.task.json --backend claude-code --model <id> --out runs/<name>
```

Three repetitions for each of three models and one with the CLI's default model, per task. Nothing was retried and no run is left out.

| Task | Model | Runs | Accepted | Rejected | No verdict | Median seconds | Median cost (USD) | Median turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| digits-logreg | default (claude-mythos-5-2) | 1 | 1 | 0 | 0 | 55 | 0.605 | 5 |
| digits-logreg | claude-haiku-5-5 | 3 | 3 | 0 | 0 | 68 | 0.016 | 9 |
| digits-logreg | claude-opus-5-5 | 3 | 3 | 0 | 0 | 84 | 0.388 | 10 |
| digits-logreg | claude-sonnet-5-5 | 3 | 3 | 0 | 0 | 20 | 0.090 | 3 |
| digits-logreg | script | 1 | 1 | 0 | 0 | 0 | 0 | - |
| ridge-diabetes | default (claude-mythos-5-2) | 1 | 1 | 0 | 0 | 83 | 0.841 | 11 |
| ridge-diabetes | claude-haiku-5-5 | 3 | 3 | 0 | 0 | 85 | 0.020 | 12 |
| ridge-diabetes | claude-opus-5-5 | 3 | 3 | 0 | 0 | 88 | 0.387 | 7 |
| ridge-diabetes | claude-sonnet-5-5 | 3 | 3 | 0 | 0 | 27 | 0.098 | 4 |
| sort-benchmark | default (claude-mythos-5-2) | 1 | 1 | 0 | 0 | 68 | 0.654 | 5 |
| sort-benchmark | claude-haiku-5-5 | 3 | 1 | 2 | 0 | 72 | 0.017 | 10 |
| sort-benchmark | claude-opus-5-5 | 3 | 3 | 0 | 0 | 74 | 0.342 | 8 |
| sort-benchmark | claude-sonnet-5-5 | 3 | 2 | 1 | 0 | 31 | 0.106 | 3 |
| sort-benchmark | script | 1 | 1 | 0 | 0 | 0 | 0 | - |

Group D: 30 agent runs, 27 accepted, 3 rejected, total backend-reported cost 6.44 USD.

All 30 runs completed and received a verdict. No run was voided, timed out or failed in the backend.

The three rejections are one failure. Contract 0.3.0 compares a metric within a tolerance only when its name matches `*_seconds`; any other metric must be exactly equal after re-execution. The task instructions compiled from the contract say so. The three runs named their timings `sorted_median_seconds_1000`, `median_sorted_seconds_n1000` and `builtin_seconds_n1000`, which end in a number, were compared exactly, and differed:

```
sort-benchmark--claude-code--claude-haiku-5-5--r2  completed  claude-code  measured  verdict: rejected under contract research.experiment-report version 0.3.0: 9 of 10 mandatory requirements passed (9 machine, 0 empirical, 0 human)
R-008  fail     A re-execution reproduces the metrics (mandatory, empirical)
       metric sorted_median_seconds_1000: artifact reports 0.00007696900001974427, re-execution gives 0.00008063699988269946; ...
```

The rejection is correct under the contract as written. Whether a naming convention is a reasonable thing for a contract to depend on is Q24.

What the runtime added to each run, median over the 30 (maximum in brackets): backend 70.5 s (89.9), first execution 2.2 s (3.2), the runtime's own re-execution 2.3 s (3.3), verification including the verifier's re-execution 2.6 s (3.4). Everything else is under 0.05 s.

Other observations:

- The three opus runs on `ridge-diabetes` typed decimal numbers into findings instead of using a slot. The runtime recorded review notes (five in total) and did not reject (Q22).
- scikit-learn's diabetes data is two files and the artifact schema has room for one. Agents hashed one of the two, or wrote a combined CSV and hashed that. Both pass (Q21).
- Two runs report one tool call refused by the permission settings. Both were accepted.
- An accepted verdict here says the ten mandatory requirements passed. Nobody has read the 27 accepted experiments to check that they compute what their brief asks. R-009, the requirement that a person review the findings, is advisory and was `not_run` in every run.

## 4. The same contract through a script (groups C and D)

`sort-benchmark` also has a hand-written producer, run through the `script` backend, and a conventional collector in the style of the Phase 0 baseline (`experiments/sort-benchmark/run_conventional.py`), which is group C. Both were accepted under contract 0.3.0:

```
$ node src/tenric.ts verify runs/conventional-sort-benchmark --contract spec/contracts/research.experiment-report/0.3.0.contract.json --reproduce --task experiments/sort-benchmark/task.json
R-008  pass     A re-execution reproduces the metrics (mandatory, empirical)
       re-executed revision d80939d37caf58c0df79bb55a842df2666796b29 in an equal environment: 3 metrics equal, 1 outputs byte-identical; compared within a contract tolerance instead of exactly: builtin_seconds, merge_sort_seconds
verdict: accepted under contract research.experiment-report version 0.3.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human)

$ node src/tenric.ts verify runs/sort-benchmark--script-----r1 --repo runs/sort-benchmark--script-----r1/workspace --contract spec/contracts/research.experiment-report/0.3.0.contract.json --reproduce --task runs/sort-benchmark--script-----r1/tenric/reproduce.task.json
R-008  pass     A re-execution reproduces the metrics (mandatory, empirical)
       re-executed revision 576ce1d12845533d4fa3c94a91a0ab9278c43592 in an equal environment: 4 metrics equal, 1 outputs byte-identical; compared within a contract tolerance instead of exactly: builtin_seconds, merge_sort_seconds
verdict: accepted under contract research.experiment-report version 0.3.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human)
```

(Other lines of the two outputs omitted; all other mandatory requirements are `pass`.) `digits-logreg` through the `script` backend was accepted under contract 0.2.0.

## 5. What went wrong on the way

Four defects were found by running, not by reading. The first two are in the runtime, the third is in the standard, the fourth is in the tests.

### 5.1 The host's environment reached the experiment

In the first batch every agent run with a figure was rejected:

```
digits-logreg--claude-code--claude-haiku-5-5--r1 completed rejected R-008 fail figures/confusion-matrix.png: bytes differ from the re-execution
ridge-diabetes--claude-code--claude-haiku-5-5--r1 completed rejected R-008 fail figures/cv-rmse-vs-alpha.png: bytes differ from the re-execution
```

The container sets `MATPLOTLIBRC=/etc/matplotlib`, which changes fonts and resolution. The runtime's execution inherited it; the verifier's re-execution removes it. The collector now builds the experiment's environment from the same allowlist as the verifier plus pinned values, and a test asserts that nothing else from the caller arrives. The Phase 0 baseline never showed this because its figure code sets every style value itself. These 9 runs are kept in the data file under `runtime_runs_before_environment_fix`. Two of them (sonnet) were cancelled when the batch was stopped and their artifacts say so.

### 5.2 Contract 0.2.0 does not fit a timing experiment

Under contract 0.2.0, R-008 requires every metric to be exactly equal after re-execution. A benchmark cannot do that, and it was rejected whether a script or an agent produced it:

```
sort-benchmark--script-----r1 completed rejected R-008 fail metric builtin_seconds: artifact reports 0.018463147000147728, re-execution gives 0.018860686999914833; metric merge_sort_seconds: artifact reports 0.24443637300009868, re-execution gives 0.2227767629999562; ...
```

The verification thread added contract 0.3.0 with a tolerance rule for metrics named `*_seconds`: about 190 lines across the contract, `src/checks.ts` and tests. That cost is paid once and is the same for a script and for the runtime. It is a result for the plan all the same: the second task did not fit the standard written for the first.

### 5.3 macOS and Windows

In CI the runtime's tests failed on both. On macOS the temporary directory is a symbolic link and the collector compared paths as strings. On Windows git converted line endings in the verifier's checkout of the workspace, which changed the config file's digest. Both are fixed (`b2eee59`) with a test that reproduces them on Linux. In CI run 45940109737 on `309e8f5` the macOS and Ubuntu jobs passed and all runtime tests passed on Windows.

### 5.4 A test of the verifier's command line timed out on Windows

In that same run `tests/cli.test.ts` "issues no verdict and exits 2 on a precondition failure" hit Vitest's 5-second default on `windows-2025`: it starts ten Node processes, and the runtime's tests now run beside it. `db49198` raises the default limit to 30 seconds. In CI run 45940573804 on `c17ad74` all six jobs passed, Windows included. One passing run does not show the limit is generous enough on every runner.

## 6. The same models without the runtime (group B)

`evaluation/group-b/` gives the same model, through the same CLI with the same permissions, the same brief plus the contract and the artifact schema, and tells it to deliver the artifact itself, including a `collect.py` the verifier can re-execute. The unchanged verifier then judges the result.

| Task | Model | Runs | Accepted | Rejected | No verdict | Median seconds | Median cost (USD) | Median turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| digits-logreg | claude-haiku-5-5 | 2 | 1 | 1 | 0 | 133 | 0.029 | 13 |
| digits-logreg | claude-opus-5-5 | 2 | 0 | 2 | 0 | 174 | 0.705 | 10 |
| digits-logreg | claude-sonnet-5-5 | 2 | 1 | 1 | 0 | 55 | 0.184 | 5 |
| ridge-diabetes | claude-haiku-5-5 | 2 | 1 | 1 | 0 | 185 | 0.038 | 13.5 |
| ridge-diabetes | claude-opus-5-5 | 2 | 1 | 1 | 0 | 188 | 0.788 | 12.5 |
| ridge-diabetes | claude-sonnet-5-5 | 2 | 1 | 1 | 0 | 65 | 0.190 | 5 |
| sort-benchmark | claude-haiku-5-5 | 2 | 2 | 0 | 0 | 183 | 0.040 | 15 |
| sort-benchmark | claude-opus-5-5 | 2 | 2 | 0 | 0 | 183 | 0.753 | 9.5 |
| sort-benchmark | claude-sonnet-5-5 | 2 | 2 | 0 | 0 | 76 | 0.225 | 5 |

Group B: 18 agent runs, 11 accepted, 7 rejected, total backend-reported cost 5.90 USD.

Seven of the 18 were rejected, all for the same reason: a figure whose bytes the re-execution did not reproduce. That is the defect of section 5.1 again, seen from the other side. The agent's session inherits the container's `MATPLOTLIBRC` and the verifier's re-execution does not. This was checked on one run (`digits-logreg--claude-sonnet-5-5--r1`): its `collect.py` reproduces the delivered figure byte for byte with the variable set and gives a different file with it unset. It is a property of this machine, and it makes the comparison unfair to group B, so nine more runs were made with the variable removed from the agent's environment, one per task and model:

| Task | Model | Runs | Accepted | Rejected | No verdict | Median seconds | Median cost (USD) | Median turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| digits-logreg | claude-haiku-5-5 | 1 | 1 | 0 | 0 | 142 | 0.029 | 9 |
| digits-logreg | claude-opus-5-5 | 1 | 1 | 0 | 0 | 168 | 0.772 | 10 |
| digits-logreg | claude-sonnet-5-5 | 1 | 1 | 0 | 0 | 63 | 0.179 | 5 |
| ridge-diabetes | claude-haiku-5-5 | 1 | 1 | 0 | 0 | 203 | 0.043 | 17 |
| ridge-diabetes | claude-opus-5-5 | 1 | 1 | 0 | 0 | 243 | 1.013 | 15 |
| ridge-diabetes | claude-sonnet-5-5 | 1 | 1 | 0 | 0 | 70 | 0.217 | 4 |
| sort-benchmark | claude-haiku-5-5 | 1 | 0 | 1 | 0 | 170 | 0.037 | 16 |
| sort-benchmark | claude-opus-5-5 | 1 | 0 | 1 | 0 | 234 | 0.941 | 13 |
| sort-benchmark | claude-sonnet-5-5 | 1 | 1 | 0 | 0 | 83 | 0.209 | 4 |

Group B, variable removed: 9 agent runs, 7 accepted, 2 rejected, total backend-reported cost 3.44 USD.

The two rejections in that batch are of the same kind as group D's three: a timing metric named `..._seconds_n1000`, and a ratio of two timings, which no tolerance rule covers.

What this shows:

1. **With the machine's quirk removed, group B was accepted about as often as group D**: 7 of 9 against 24 of 27 for the same three models. On the benchmark task the first group B batch did better than D (6 of 6 against 6 of 9). At these counts there is no difference to report. The models can follow the contract from its text.
2. **Group B costs about twice as much and takes about two and a half times as long.** Median per run, D against all 27 group B runs: haiku 72 s and 0.017 USD against 179 s and 0.037 USD; sonnet 27 s and 0.098 USD against 70 s and 0.192 USD; opus 77 s and 0.364 USD against 188 s and 0.772 USD. In group B the model writes and debugs a collector and the artifact each time.
3. **The verdict does not distinguish the two groups.** All 27 group B artifacts pass R-004, "digests are marked as recorded by the collector". In group B the collector is a file the agent wrote in the same session, and the label is the agent's own. An accepted group B verdict reads word for word like an accepted group D verdict. The verifier does print `the contract requires capabilities this verifier cannot establish: independent-collector, content-hashing`, and prints it for both. This is Q14 and Q19.
4. **The runtime removed one class of failure. The evidence for that comes from one machine.** Group D after the fix of 5.1 had no environment-caused rejection in 30 runs; group B had 7 in 18 until the variable was removed by hand. A producer cannot know what the verifier's environment will be. The runtime can, because it shares the code that builds it.

## 7. H3: is this less work than a script?

The plan's falsification condition: if C matches D on requirement completion, rejection of invalid artifacts and evidence integrity, and adapting C to a new task costs no more than adapting D, then the runtime adds nothing over a template repository.

What adapting to the second task (`sort-benchmark`) cost, beyond writing the experiment itself, which both need:

| | Group C: conventional collector | Group D: runtime, script backend | Group D: runtime, agent backend |
| --- | --- | --- | --- |
| New or changed code that must be trusted | `run_conventional.py`: a copy of the 264-line baseline collector with 36 lines added and 31 removed | none | none |
| New data | `task.json`, 16 lines | `claims.json`, 41 lines; task file, 8 lines | task file with a prose brief, 8 lines |
| Experiment code written by | a person | a person | the model |
| Verdict under 0.3.0 | accepted | accepted | 7 of 10 accepted |
| Built once beforehand | the 264-line collector | 1,593 lines of runtime, 65 tests | the same, plus the adapter |

Read against the falsification condition:

1. **For a task whose experiment a person writes, the condition is close to met, and that counts against the runtime.** C and D both reached acceptance. C needed about 67 changed lines; D needed about 49 lines of data. That difference is small next to the 1,593 lines the runtime cost to build. On two tasks, a template collector that is copied and edited is cheaper in total. The runtime's advantage is of a different kind: under C each task has its own copy of the collector, so each task adds roughly 270 lines that write `provenance: collector` and have to be trusted again. Under D that code exists once. This matters for review effort at many tasks. It was not measured here, and at two tasks it does not pay for itself.
2. **Evidence integrity is not distinguishable by the verdict.** C, D and (section 6) B all pass R-004, because R-004 reads a label that the collector writes about itself. The runtime's structural property, that the producer has no way to write evidence, is real in the code and tested, and the verdict record does not carry it (Q19). As long as that holds, H2 cannot be demonstrated to a third party from the deliverable.
3. **Where the runtime changes the result is the agent case.** The runtime did not make agents succeed more often (section 6, point 1). It made each run cost about half as much and take well under half as long (point 2), it removed the environment mismatch without anyone having to find it per task (point 4), and it is the only group in which the evidence was not written by the model, which today nobody outside can see (item 2 of this list).
4. **The cost that dominated was neither C nor D.** The second task needed a new contract version. A third task of a third kind will probably need another.

So H3 as written is **not supported for script-driven tasks at this scale**, and is **supported on cost and not on acceptance for agent-driven tasks**, with the limits in section 8. Group B being accepted as often as group D adds to the case against: an agent given the contract's text does not need the runtime to pass it. The honest reading of the plan's own rule is that the conventional-script path should stay supported and that the runtime has to earn its place on agent backends and on what the verdict can attest, and has not yet done the second.

Effort was counted in lines written by one author, an AI agent. No person's time or attention was measured, so the plan's "human attention" metric is empty.

## 8. Limits of this evidence

- Three repetitions per cell in group D; two per cell in the first group B batch and one in the second. The counts are descriptions of these runs, not rates.
- One agent harness, one vendor, one machine, one day.
- The verifier, the runtime, the tasks, the group B prompt and this report were written by the same author. The plan names this as a threat and its mitigation (publishing the verifier and fault set before running the other groups) was not done: group B's prompt was written after the runtime existed.
- Runs were made three at a time on four cores, and group B partly alongside other work, so wall times are rough. Costs are the backend's own figures.
- Group A (agent with no standard at all) was not run.
- The fault-injection set in the plan was applied to the runtime as tests (a backend that edits the contract, the schema, the plan or the task, plants an artifact, or writes one from the experiment). It was not applied to groups B and C.
- No sandbox in the first round. An experiment written by a model ran on the host as the runtime's user. Tampering that is undone before the runtime looks is not detected. (Section 10: there is one now, Linux only.)
- `tenric/reproduce.task.json` holds an absolute path, so a stored run can be judged again only on the machine that made it.
- Nobody has checked that the accepted experiments are correct.

## 9. Decisions for the owner

1. Whether to keep building the runtime given section 7, or cut back to the contract format, the verifier and a template collector, as the plan's rule suggests for script-driven work.
2. Q19: whether a verdict must state who collected the evidence. Section 10 builds this; the owner decides whether contract 0.4.0's R-012 should be the standard, and who may hold collector keys (Q26).
3. Q20: whether agent-written code may run without a sandbox. Section 10 refuses it by default on Linux and records it otherwise; whether the namespace sandbox is strong enough, or a VM per run is needed, is open.
4. Whether a naming convention (`*_seconds`) is an acceptable way for a contract to grant a tolerance (Q24).
5. Merging: this work is on `claude/project-thread-rh3xta`, based on the verification branch. Nothing is merged into `main`.

## 10. Second round: sandbox, signed collector record, contract 0.4.0

### 10.1 What changed

| Change | Where |
| --- | --- |
| The agent backend runs in a Linux namespace sandbox: only the workspace is writable; the repository, the Python environment and the CLI's installation are read-only; no other host file or process is visible. Network stays on for the model | `src/runtime/sandbox.ts`, `sandbox.sh`, `backends.ts`; ADR-0013 |
| The experiment runs in the same kind of sandbox with no network, the workspace read-only, and an empty directory of its own as the only writable path | `src/runtime/collector.ts` |
| The runtime holds an Ed25519 key outside anything a sandbox can see, and signs a record of the artifact it assembled (artifact digest, workspace revision, contract, plan, runtime revision, both isolation records), only when both processes were confined | `src/runtime/keys.ts`, `attest.ts`, `runtime.ts` |
| Contract 0.4.0 (the verification branch's) adds R-012: a collector the verifier's operator trusts signed a record of exactly this artifact, revision and contract | `spec/contracts/research.experiment-report/0.4.0.contract.json`, `src/attestation.ts` |
| The three tasks moved to 0.4.0. Group B's agent runs in the same sandbox and is judged with the same trusted key | `tasks/`, `evaluation/group-b/run.ts` |
| Where no sandbox exists the runtime refuses an agent backend unless overridden, and never signs | `runtime.ts`, `tests/runtime/sandbox.test.ts` |

What the tests show about the boundary (`tests/runtime/sandbox.test.ts`, 12 tests): a sandboxed process does not see an unlisted host path, cannot write a read-only one, cannot remount it writable or unmount it even from a nested namespace, sees fewer than five processes, and has only a loopback interface when network is off. A fake agent cannot read the key file, write the repository or the contract registry. A changed artifact, a record re-signed with the producer's own key, and a record copied from another run each fail R-012. These are tests against a fake agent and a fixture producer, not against a model trying to escape.

### 10.2 `npm run verify`

Linux x86_64, clean checkout at `9214d5b`. Output unedited except that a repeated uv deprecation warning, blank lines and the per-file test lines are removed. The 12 sandbox tests ran; none was skipped:

```
== tenric verify
revision: 9214d5b2c138ff7ce7070875b0a8433c9c27d636
node v22.23.5, Python 3.13.14, Linux x86_64
== 1/4 typecheck
== 2/4 baseline experiment, executed twice, then once with a broken config and once with a timeout it cannot meet
succeeded: wrote /home/claude/tenric-runs/runs/verify-a/artifact.json
succeeded: wrote /home/claude/tenric-runs/runs/verify-b/artifact.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-a/metrics.json
76111195e5f8432aef457bba6b858ab7434b98ab623c444956a85b8d213faf53  runs/verify-b/metrics.json
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-a/figures/confusion_matrix.png
3b005111cc142de6c3987a5ad13cb09b1fa907828e4ae249143006271724ff1e  runs/verify-b/figures/confusion_matrix.png
failed: wrote /home/claude/tenric-runs/runs/verify-fail/artifact.json
timeout: wrote /home/claude/tenric-runs/runs/verify-timeout/artifact.json
== 3/4 tests
 Test Files  11 passed (11)
      Tests  206 passed (206)
== 4/4 verdict for the baseline run, with re-execution
contract: research.experiment-report version 0.2.0 sha256 6f1d9eafe02d17746ed3e106722fe2ae0a7c1a010f074f688eb5ee3003651e11 (matches the registry)
artifact: runs/verify-a/artifact.json sha256 b2b47d3e77f47e36e50a5376fb90d0c26b95d3efc12c10bc4d8aee7f60620827
verifier: revision 9214d5b2c138ff7ce7070875b0a8433c9c27d636
R-001  pass     Artifact conforms to the IR schema (mandatory, machine)
R-002  pass     Every listed output exists and matches its recorded size and SHA-256 (mandatory, machine)
R-003  pass     Every reported metric equals the value at its pointer in a hashed output (mandatory, machine)
R-004  pass     Source, environment, dataset, config, execution and output digests are marked as recorded by the collector (mandatory, machine)
R-005  pass     Execution completed successfully (mandatory, machine)
R-006  pass     Source is pinned to a clean revision or a hashed snapshot (mandatory, machine)
R-007  pass     Every finding references metrics, figures or outputs that exist in the artifact (mandatory, machine)
R-008  pass     A re-execution reproduces the metrics (mandatory, empirical)
       re-executed revision 9214d5b2c138ff7ce7070875b0a8433c9c27d636 in an equal environment: 3 metrics equal, 3 outputs byte-identical
R-009  not_run  Findings and limitations are justified by the evidence (advisory, human)
       no validator for human-review yet
R-010  pass     The artifact is a measurement and contains metrics, a report and at least one finding (mandatory, machine)
R-011  pass     Names are unique and every figure points at listed outputs (mandatory, machine)
collector: not attested (no collector attestation at tenric/attestation.json: nothing shows who collected this evidence)
note: the contract requires capabilities that are not established for this run: independent-collector, content-hashing
verdict: accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human); collector not attested
== verify: OK
exit 0
```

### 10.3 The rerun

Both groups at `a3c62c5`, from a clean checkout, two runtime runs and two group B runs at a time on the same 4-core machine, with the host's `MATPLOTLIBRC` removed for both groups (section 6 explains why). Two repetitions per task and model, and one run per task with the CLI's default model for group D. Nothing was retried or left out.

Group D, through the runtime:

| Task | Model | Runs | Accepted | Rejected | No verdict | Median seconds | Median cost (USD) | Median turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| digits-logreg | claude-haiku-5-5 | 2 | 2 | 0 | 0 | 71 | 0.018 | 12.5 |
| digits-logreg | claude-opus-5-5 | 2 | 2 | 0 | 0 | 77 | 0.371 | 8 |
| digits-logreg | claude-sonnet-5-5 | 2 | 2 | 0 | 0 | 21 | 0.087 | 3 |
| digits-logreg | default (claude-mythos-5-2) | 1 | 1 | 0 | 0 | 65 | 0.693 | 5 |
| ridge-diabetes | claude-haiku-5-5 | 2 | 2 | 0 | 0 | 102 | 0.025 | 16 |
| ridge-diabetes | claude-opus-5-5 | 2 | 2 | 0 | 0 | 92 | 0.435 | 10 |
| ridge-diabetes | claude-sonnet-5-5 | 2 | 2 | 0 | 0 | 29 | 0.112 | 4.5 |
| ridge-diabetes | default (claude-mythos-5-2) | 1 | 1 | 0 | 0 | 85 | 0.846 | 11 |
| sort-benchmark | claude-haiku-5-5 | 2 | 2 | 0 | 0 | 86 | 0.019 | 9 |
| sort-benchmark | claude-opus-5-5 | 2 | 2 | 0 | 0 | 78 | 0.369 | 8.5 |
| sort-benchmark | claude-sonnet-5-5 | 2 | 0 | 2 | 0 | 31 | 0.108 | 3.5 |
| sort-benchmark | default (claude-mythos-5-2) | 1 | 1 | 0 | 0 | 66 | 0.599 | 4 |

D: 21 runs, 19 accepted, 2 rejected, 0 no verdict, cost 5.22 USD

Group B, the same models without the runtime:

| Task | Model | Runs | Accepted | Rejected | No verdict | Median seconds | Median cost (USD) | Median turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| digits-logreg | claude-haiku-5-5 | 2 | 0 | 2 | 0 | 179 | 0.065 | 20 |
| digits-logreg | claude-opus-5-5 | 2 | 0 | 2 | 0 | 179 | 0.826 | 19 |
| digits-logreg | claude-sonnet-5-5 | 2 | 0 | 2 | 0 | 64 | 0.197 | 6.5 |
| ridge-diabetes | claude-haiku-5-5 | 2 | 0 | 2 | 0 | 189 | 0.054 | 18 |
| ridge-diabetes | claude-opus-5-5 | 2 | 0 | 2 | 0 | 196 | 0.838 | 13.5 |
| ridge-diabetes | claude-sonnet-5-5 | 2 | 0 | 2 | 0 | 66 | 0.196 | 5.5 |
| sort-benchmark | claude-haiku-5-5 | 2 | 0 | 2 | 0 | 213 | 0.057 | 15.5 |
| sort-benchmark | claude-opus-5-5 | 2 | 0 | 2 | 0 | 179 | 0.773 | 12 |
| sort-benchmark | claude-sonnet-5-5 | 2 | 0 | 2 | 0 | 69 | 0.198 | 4.5 |

B: 18 runs, 0 accepted, 18 rejected, 0 no verdict, cost 6.40 USD

Every one of the 21 runtime runs was signed and its record verified (`collector.attested` true in all 21 verdict records). Both rejections are the naming problem of section 3 again: sonnet named timings `builtin_median_seconds_n1000` and `builtin_median_seconds_largest`, which do not match `*_seconds`.

All 18 group B runs were rejected, every one by R-012 (`no collector attestation at tenric/attestation.json: nothing shows who collected this evidence`). For 16 of them R-012 was the only failure: under contract 0.3.0 they would have been accepted. Of the other two, one also failed R-008 on the same naming problem, and one failed R-004 because the agent labelled its own records `producer`, which is the honest label. No group B agent wrote an attestation of its own, although the contract it was given names R-012.

Medians per model, runtime against group B: haiku 84 s and 0.020 USD against 199 s and 0.056 USD; sonnet 28 s and 0.099 USD against 65 s and 0.197 USD; opus 83 s and 0.389 USD against 183 s and 0.813 USD. The ratios are as in the first round: group B costs two to three times as much and takes more than twice as long.

What the sandbox cost: compared with the first round, the runtime's median backend phase went from 70.5 s to 73.5 s and the experiment's execution from 2.2 s to 2.6 s; backend costs per model are within a few percent of the first round. Runs were not interleaved the same way in the two rounds, so this is an upper bound on nothing; it shows no large overhead. Four runtime runs report one tool call refused by the CLI's permission settings, as in the first round; all four were accepted.

### 10.4 What the signature does not prove

A signature from a trusted key says that the holder of the key vouched for this artifact. It does not say which program collected it. To check this, the conventional collector's run from section 4 (group C, written and run by hand, no runtime) was signed with the runtime's own key using the verifier's `attest` command, and then verified:

```
$ node src/cli.ts attest <copy of runs/conventional-sort-benchmark> --contract spec/contracts/research.experiment-report/0.4.0.contract.json --key ~/.config/tenric/collector-key.pem --collector-id tenric-runtime@vm#6b428f2e6596
$ node src/tenric.ts verify <copy> --contract spec/contracts/research.experiment-report/0.4.0.contract.json --repo . --reproduce --task experiments/sort-benchmark/task.json --collectors ~/.config/tenric/collectors.json
R-012  pass     A collector the verifier's operator trusts signed a record of this artifact (mandatory, machine)
verdict: accepted under contract research.experiment-report version 0.4.0: 11 of 11 mandatory requirements passed (10 machine, 1 empirical, 0 human); evidence collected by tenric-runtime@vm#6b428f2e6596 (attested)
```

The verdict says the evidence was collected by the runtime. It was not. The operator broke the key's stated custody ("signs only runs whose backend and experiment ran in an enforced sandbox"), and nothing can detect that. So R-012 is exactly as trustworthy as the person holding the key and the custody they promise. Against an agent that never sees the key, it holds; against the operator, it is a promise.

The same experiment also shows the other side: a conventional collector can meet contract 0.4.0 with a key of its own and an honest custody statement. R-012 does not require the runtime; it requires a trusted signer.

### 10.5 What this does to the conclusions of section 7

1. **Evidence integrity is now distinguishable, for agents.** Section 7 point 2 said the verdict could not tell runtime-collected evidence from evidence an agent labelled itself. Under contract 0.4.0 it can: 21 of 21 runtime runs were attested, 0 of 18 group B runs were. That is the H2 claim made checkable by a third party who trusts the key.
2. **Group B now fails, but by construction.** The contract requires a signature only a confined collector holds, so an agent working alone cannot pass it. That was decided when the contract was written, not discovered by the runs. What the runs add is that the requirement costs the runtime nothing measurable, that no agent tried to forge the record, and that without R-012 group B would again have been accepted as often as the runtime (16 of 18 here).
3. **For script-driven tasks, H3 is unchanged: not supported.** A person running a conventional collector can sign with a key of their own, as 10.4 shows, so C still matches D on acceptance and still costs less to adapt for two tasks.
4. **For agent-driven tasks, H3 is now supported on cost and on attested acceptance**, with the qualification of point 2. The runtime's place is narrower and clearer than in the first round: running code a model wrote, confining it, and vouching for what came out, so that a verifier can accept it without trusting the model. Whether that is worth the 1,600 lines plus the sandbox, key and signing (about 300 more) is the owner's call, not a measurement.

### 10.6 Limits of the second round

- Two repetitions per cell. Same machine, same harness, same author as round one.
- The sandbox is Linux only and uses the runtime's own user on the host. It does not limit network, CPU, memory or disk. The agent's sandbox in this container can read `/home/claude/.claude` (the CLI needs it to authenticate; exposed with `TENRIC_SANDBOX_READONLY`), which may contain credentials and session data of the CLI.
- The verifier re-executes group B's agent-written `collect.py` directly, without a sandbox (Q17).
- The key is a file in the operator's home directory. There is no rotation beyond revocation, no timestamp and no transparency log (Q26).
- The boundary tests use a fake agent. No model was asked to escape the sandbox.
