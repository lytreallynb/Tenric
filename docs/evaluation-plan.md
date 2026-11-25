# Evaluation plan

Status: proposed. Nothing in this plan has been run. The only executed comparison point is group C on one task (the Phase 0 baseline).

## 1. Hypotheses

- **H1 (acceptance):** Tenric rejects or withholds acceptance from every deliverable that violates a mandatory machine-checkable requirement, and A and B let some through.
- **H2 (evidence):** Under Tenric, no report record marked as evidence was written by the producer. Under A and B some are.
- **H3 (increment over C):** Compared with conventional scripts, Tenric lowers the cost of applying the same standard to a *new* task or backend, without lowering H1 or H2.
- **H4 (cost):** The overhead in tokens, wall time and human attention is small relative to the task.

H3 is the one most likely to fail and the one the project depends on. H1 and H2 are close to true by construction, and are worth measuring mainly to quantify how often A and B fail.

**Falsification:** if C matches D on requirement completion, invalid-artifact rejection and evidence integrity, and adapting C to a new task costs no more than adapting D, then the runtime adds nothing over a template repository and the architecture in RFC-0001 should be cut back to a contract format and a validator library.

## 2. Groups

| Group | Description | Standard delivered as |
| --- | --- | --- |
| A | Agent given the task and the standard as a one-off prompt | Prompt text |
| B | Agent with AGENTS.md and a skill describing the standard, including helper scripts | Persistent instructions and skill |
| C | No agent in the reporting path: deterministic scripts, tracking, templates | Code |
| D | Agent or script as producer, under Tenric's collector and verifier | Contract |

C and D can share a producer. The honest comparison for an agent workflow is B against D with the same agent, model and task. The honest comparison for engineering value is C against D on the cost of a second and third task.

## 3. Tasks

At least three experiment tasks that share one contract and differ in content, for example a classifier benchmark, a small regression study, and a runtime benchmark of two algorithms. All CPU-only with public or synthetic data. Each task has a set of injected faults (section 5).

## 4. Metrics

| Metric | Definition | Measured by |
| --- | --- | --- |
| Mandatory requirement completion | Share of mandatory requirements satisfied per deliverable | The same verifier applied to all groups after the fact |
| Invalid artifact rejection | Share of fault-injected deliverables not accepted | Fault injection |
| False acceptance | Deliverables accepted by the group's own process that the verifier rejects | Verifier against each group's "done" signal |
| Evidence integrity | Share of evidence records traceable to collector observation | Provenance audit |
| Output consistency | Structural equality across repeated runs; share of byte-identical outputs | Repeat runs |
| Numerical reproducibility | Metric spread across reruns and across two platforms | Repeat runs |
| Human intervention | Count of human actions needed to reach a deliverable | Session logs |
| Execution cost | Tokens, wall time | Backend reports, labelled as backend-reported |
| Maintenance effort | Lines changed and time to support a new task; to support a new backend | Diff statistics; time is self-reported |
| Adaptability | Whether the unchanged contract works on a new task and backend | Yes or no per pair |

## 5. Fault injection

Applied identically to every group's output: delete a required record; edit a metric in the report only; edit an output after the run; replace a figure; report a stale source revision; mark a failed run as succeeded; cite a non-existent metric in a finding; run with a dirty tree; kill the run midway.

Seven of these were exercised against the Phase 0 baseline run, and all seven were rejected. That is a result about three validators and one script. It is not a result about Tenric against any other group.

## 6. Controls and threats

- Same task text, model, model version, temperature settings where exposed, and time limits across A, B and D.
- At least five repetitions per cell. Agents are non-deterministic; single runs are anecdotes.
- The verifier is written by the same people as group D, which favours D. Mitigation: publish the verifier and the fault set before running A and B, and count requirement completion by hand on a sample.
- Group B's quality depends on how well the skill is written. It gets a good-faith effort with a fixed time budget, and the skill is published.
- Model versions change. Record exact identifiers and dates; treat results as a snapshot.
- Mock adapters are for testing runtime logic and appear in no table of results.
- Small task count. Report per-task results and avoid aggregate claims.

## 7. Order of work

1. Finish the verifier so the baseline can reach a verdict at all (Phase 1).
2. Second and third task under C, recording the effort. This gives the denominator for H3.
3. D on the same tasks with the script producer.
4. One real backend for A, B and D. This is the first point at which paid usage is needed, and it requires approval.
