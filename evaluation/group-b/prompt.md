# Task: {{title}}

Task id `{{id}}`. You must deliver a research experiment report that will be accepted under contract `{{contract_id}}` version `{{contract_version}}`. Nobody will help you assemble it: you run the experiment, you collect the evidence, and you write the report record yourself.

## What to investigate

{{brief}}

## What to deliver

Your working directory is an empty git repository. When you finish it must contain, committed:

1. The experiment code and a JSON config file with every parameter, including the seed.
2. `collect.py`, runnable from the repository root as `python collect.py --config <path to the config file> --out <directory>`. It must execute the experiment and write into `<directory>` a complete `artifact.json` plus every output file the artifact lists. The verifier re-executes your work with exactly this command, in a fresh checkout of the revision your artifact records, and compares the result with what you delivered.
3. A directory `run/` holding one such execution: `run/artifact.json` and the outputs it lists, including a human-readable `report.md`. `run/` may be committed after the code or left untracked, but the revision recorded in `run/artifact.json` must be a commit that contains the code and the config, made from a clean working tree.

`artifact.json` must conform to the Artifact IR schema below, with `experiment_id` equal to `{{id}}` and `data_class` equal to `measured`. Every requirement of the contract below must hold. Read both carefully: a deliverable that violates any mandatory requirement is rejected.

## The contract

```json
{{contract}}
```

## The Artifact IR schema

```json
{{schema}}
```

## Environment

- Python with the standard library and these locked packages (plus their dependencies): {{packages}}. Nothing else can be installed and there is no network.
- CPU only. Keep one execution well under {{timeout}} seconds.
- `git` is available. Configure a commit identity locally if you need one.

When everything is committed and `run/` is in place, stop. A short final message is enough.
