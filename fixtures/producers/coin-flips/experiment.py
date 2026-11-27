"""DEMONSTRATION FIXTURE producer for runtime tests: seeded coin flips.

Standard library only, so the tests do not pay for importing numpy. It carries
no experimental meaning.
"""
import argparse
import json
import random
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--config", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()

config = json.loads(args.config.read_text())
rng = random.Random(config["seed"])
flips = [rng.random() < config["p_heads"] for _ in range(config["n_flips"])]

(args.out / "data").mkdir(parents=True, exist_ok=True)
(args.out / "data" / "flips.csv").write_text("flip\n" + "".join(f"{int(f)}\n" for f in flips), newline="\n")
metrics = {"n_flips": len(flips), "heads_fraction": sum(flips) / len(flips)}
(args.out / "metrics.json").write_text(json.dumps(metrics, sort_keys=True, indent=2) + "\n", newline="\n")
