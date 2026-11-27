"""Sort benchmark (the *producer* of the second task).

Times the built-in sorted() against a pure-Python top-down merge sort on
seeded random integer lists. Written by hand as the script-backend producer of
tasks/sort-benchmark.task.json, and used unchanged by the conventional
collector next to it (run_conventional.py), so the two ways of applying the
standard can be compared on the same experiment.

Everything it writes is a claim until a collector has observed and hashed it.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import time
from pathlib import Path

import matplotlib

matplotlib.rcdefaults()
matplotlib.use("Agg")
matplotlib.rcParams["font.family"] = "DejaVu Sans"
import matplotlib.pyplot as plt  # noqa: E402


def merge_sort(values: list[int]) -> list[int]:
    if len(values) <= 1:
        return values
    middle = len(values) // 2
    left, right = merge_sort(values[:middle]), merge_sort(values[middle:])
    merged: list[int] = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
    merged.extend(left[i:])
    merged.extend(right[j:])
    return merged


def median_seconds(sort, values: list[int], repetitions: int) -> float:
    times = []
    for _ in range(repetitions):
        fresh = list(values)
        start = time.perf_counter()
        sort(fresh)
        times.append(time.perf_counter() - start)
    return statistics.median(times)


def write_json(path: Path, obj: object) -> None:
    path.write_text(json.dumps(obj, sort_keys=True, indent=2) + "\n", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())

    rng = random.Random(config["seed"])
    inputs = {str(n): [rng.randrange(config["max_value"]) for _ in range(n)] for n in config["sizes"]}
    (args.out / "data").mkdir(parents=True, exist_ok=True)
    (args.out / "figures").mkdir(parents=True, exist_ok=True)
    # The generated inputs are the dataset. They depend only on the seed, so this file is byte-identical across runs.
    write_json(args.out / "data" / "inputs.json", inputs)

    agree = all(merge_sort(list(values)) == sorted(values) for values in inputs.values())
    builtin = {n: median_seconds(sorted, values, config["repetitions"]) for n, values in inputs.items()}
    merge = {n: median_seconds(merge_sort, values, config["repetitions"]) for n, values in inputs.items()}
    largest = str(max(config["sizes"]))
    write_json(args.out / "metrics.json", {
        "results_agree": int(agree),
        "repetitions": config["repetitions"],
        "largest_size": int(largest),
        "median_seconds": {"builtin": builtin, "merge_sort": merge},
        "at_largest_size": {
            "builtin_seconds": builtin[largest],
            "merge_sort_seconds": merge[largest],
            "merge_over_builtin": merge[largest] / builtin[largest],
        },
    })

    spec = {
        "id": "time-vs-size",
        "kind": "line",
        "title": "Median sort time against input size",
        "x_label": "List length",
        "y_label": "Median wall-clock time (s)",
        "data": {"sizes": config["sizes"], "builtin": [builtin[str(n)] for n in config["sizes"]], "merge_sort": [merge[str(n)] for n in config["sizes"]]},
        "render": {"figsize_in": [5.0, 4.0], "dpi": 120, "format": "png", "scale": "log-log"},
    }
    write_json(args.out / "figures" / "time_vs_size.spec.json", spec)
    fig, ax = plt.subplots(figsize=tuple(spec["render"]["figsize_in"]), dpi=spec["render"]["dpi"])
    ax.loglog(spec["data"]["sizes"], spec["data"]["builtin"], marker="o", label="built-in sorted()")
    ax.loglog(spec["data"]["sizes"], spec["data"]["merge_sort"], marker="s", label="pure-Python merge sort")
    ax.set_title(spec["title"])
    ax.set_xlabel(spec["x_label"])
    ax.set_ylabel(spec["y_label"])
    ax.legend()
    fig.tight_layout()
    fig.savefig(args.out / "figures" / "time_vs_size.png", format="png", metadata={"Software": None})
    plt.close(fig)

    if not agree:
        raise SystemExit("merge sort and sorted() disagree")


if __name__ == "__main__":
    main()
