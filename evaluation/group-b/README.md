# Comparison group B: the standard as instructions, no runtime

`docs/evaluation-plan.md` defines group B as an agent that is given the standard as instructions and does everything itself, including the reporting. This directory runs that group so it can be compared with group D (the same agent under the Tenric runtime) on the same tasks, models and verifier.

`run.ts` gives the agent the task's brief, the contract, the Artifact IR schema and the delivery rules in `prompt.md`, lets it work in an empty git repository, and then applies the unchanged verifier, with re-execution, to what it delivered. The agent writes `artifact.json` itself, so every `provenance` value in it is the agent's own word. A group B verdict of `accepted` therefore means "self-consistent and reproducible", and does **not** mean the evidence was observed independently: the verifier cannot tell (`docs/trust-model.md`).

```sh
node evaluation/group-b/run.ts --task tasks/digits-logreg.task.json --model claude-haiku-5-5 --out runs/group-b/digits-haiku-1
```

This is evaluation tooling. It is not part of the runtime and nothing in `src/` imports it.
