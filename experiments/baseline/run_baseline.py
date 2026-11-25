"""Baseline collector (comparison group C: conventional deterministic tooling).

Runs experiment.py as a subprocess and assembles a research Artifact IR
document (spec/research-report.artifact.schema.json) from what it *observes*:
exit status, wall time, source revision, environment, dataset file digest and
output digests. Values that only the experiment can assert are copied in and
marked provenance "producer".

Standard library only, on purpose: the collector must not depend on the code
it is observing. This is not the Tenric runtime; it is the conventional
baseline Tenric has to beat (docs/evaluation-plan.md).
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import string
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
IR_VERSION = "0.1.0"
PINNED_ENV = {
    "PYTHONHASHSEED": "0",
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "MPLBACKEND": "Agg",
    "TZ": "UTC",
    "LC_ALL": "C.UTF-8",
}
TRACKED_PACKAGES = ["numpy", "scipy", "scikit-learn", "matplotlib", "pillow", "fonttools"]
TIMEOUT_SECONDS = 300


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args: str) -> str | None:
    try:
        done = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return done.stdout.strip()


def collect_source() -> dict:
    revision = git("rev-parse", "HEAD")
    if revision is None:
        return {"kind": "none", "provenance": "collector"}
    status = git("status", "--porcelain")
    return {"kind": "git", "revision": revision, "dirty": bool(status), "provenance": "collector"}


def collect_environment() -> dict:
    return {
        "os": platform.system(),
        "os_release": platform.release(),
        "arch": platform.machine(),
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "packages": {name: importlib.metadata.version(name) for name in TRACKED_PACKAGES},
        "lockfile": {"path": "uv.lock", "sha256": sha256_file(REPO / "uv.lock")},
        "pinned_env": PINNED_ENV,
        "provenance": "collector",
    }


def collect_dataset() -> dict:
    # Hash the dataset file on disk without importing or running sklearn.
    spec = importlib.util.find_spec("sklearn")
    data_file = Path(list(spec.submodule_search_locations)[0]) / "datasets" / "data" / "digits.csv.gz"
    return {
        "name": "sklearn-digits",
        "description": "Optical recognition of handwritten digits (UCI ML repository test set), as bundled with scikit-learn.",
        "version": "scikit-learn " + importlib.metadata.version("scikit-learn"),
        "file": "sklearn/datasets/data/digits.csv.gz",
        "sha256": sha256_file(data_file),
        "provenance": "collector",
    }


def describe_output(out: Path, rel: str, role: str, media_type: str, determinism: str) -> dict:
    path = out / rel
    return {
        "path": rel,
        "role": role,
        "media_type": media_type,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "determinism": determinism,
        "provenance": "collector",
    }


def render_report(artifact: dict, out: Path) -> None:
    template = string.Template((HERE / "report.template.md").read_text())
    metrics = {m["name"]: m["value"] for m in artifact["metrics"]}
    src = artifact["source"]
    hashed = [o for o in artifact["outputs"] if o["role"] != "report"]
    (out / "report.md").write_text(template.substitute(
        title=artifact["title"],
        experiment_id=artifact["experiment_id"],
        data_class=artifact["data_class"],
        status=artifact["execution"]["status"],
        exit_code=artifact["execution"]["exit_code"],
        runtime=f'{artifact["execution"]["runtime_seconds"]:.3f}',
        started_at=artifact["execution"]["started_at"],
        revision=src.get("revision", "none") + (" (dirty working tree)" if src.get("dirty") else ""),
        python=artifact["environment"]["python"],
        platform=f'{artifact["environment"]["os"]} {artifact["environment"]["arch"]}',
        packages=", ".join(f"{k} {v}" for k, v in artifact["environment"]["packages"].items()),
        lock_sha=artifact["environment"]["lockfile"]["sha256"],
        dataset=f'{artifact["dataset"]["name"]} ({artifact["dataset"]["version"]})',
        dataset_sha=artifact["dataset"]["sha256"],
        config_json=json.dumps(artifact["config"]["values"], sort_keys=True, indent=2),
        seed=artifact["config"]["seed"],
        metric_rows="\n".join(f"| {name} | {value:.6f} |" for name, value in metrics.items()),
        output_rows="\n".join(f'| `{o["path"]}` | {o["role"]} | {o["determinism"]} | `{o["sha256"]}` |' for o in hashed),
        findings="\n".join(f'- **{f["id"]}** {f["statement"]} (supported by: {", ".join(f["supported_by"])})' for f in artifact["findings"]),
        limitations="\n".join(f"- {text}" for text in artifact["limitations"]),
        reproduction="\n".join(artifact["reproduction"]["commands"]),
    ))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "config.json")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    stale = [p for p in out.rglob("*") if p.is_file()]
    if stale:
        print(f"refusing to run: output directory {out} is not empty", file=sys.stderr)
        return 2

    config = json.loads(args.config.read_text())
    command = [sys.executable, str(HERE / "experiment.py"), "--config", str(args.config.resolve()), "--out", str(out)]
    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    start = time.monotonic()
    try:
        done = subprocess.run(command, env={**os.environ, **PINNED_ENV}, capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
        status, exit_code, stderr = ("succeeded" if done.returncode == 0 else "failed"), done.returncode, done.stderr
    except subprocess.TimeoutExpired as error:
        status, exit_code, stderr = "timeout", None, str(error)
    runtime = time.monotonic() - start

    artifact: dict = {
        "ir_version": IR_VERSION,
        "artifact_type": "research.experiment-report",
        "experiment_id": config["experiment_id"],
        "title": config["title"],
        "data_class": "measured",
        "source": collect_source(),
        "environment": collect_environment(),
        "dataset": collect_dataset(),
        "config": {
            "path": str(args.config.resolve().relative_to(REPO)),
            "sha256": sha256_file(args.config),
            "values": config,
            "seed": config["seed"],
            "provenance": "collector",
        },
        "execution": {
            "command": ["python", "experiments/baseline/experiment.py", "--config", "<config>", "--out", "<out>"],
            "status": status,
            "exit_code": exit_code,
            "started_at": started_at,
            "runtime_seconds": round(runtime, 3),
            "provenance": "collector",
        },
        "metrics": [],
        "outputs": [],
        "figures": [],
        "findings": [],
        "limitations": [],
        "reproduction": {
            "commands": ["npm ci", "uv sync --locked", "npm run baseline"],
            "expectation": "metrics.json, the figure spec and the PNG are byte-identical in the locked environment on the same platform; across platforms metrics agree within the contract tolerance.",
        },
        "volatile_fields": ["/execution/started_at", "/execution/runtime_seconds"],
    }

    if status == "succeeded":
        artifact["outputs"] = [
            describe_output(out, "metrics.json", "metrics", "application/json", "byte-identical"),
            describe_output(out, "figures/confusion_matrix.spec.json", "figure-spec", "application/json", "byte-identical"),
            describe_output(out, "figures/confusion_matrix.png", "figure", "image/png", "byte-identical"),
        ]
        produced = json.loads((out / "metrics.json").read_text())

        def metric(name: str, pointer: str) -> dict:
            value = produced
            for key in pointer.strip("/").split("/"):
                value = value[key]
            return {"name": name, "value": value, "source_output": "metrics.json", "json_pointer": pointer, "provenance": "producer"}

        artifact["metrics"] = [
            metric("test_accuracy", "/test/accuracy"),
            metric("test_macro_f1", "/test/macro_f1"),
            metric("reference_most_frequent_accuracy", "/reference_most_frequent/accuracy"),
        ]
        artifact["dataset"]["producer_claims"] = {**produced["dataset"], "provenance": "producer"}
        artifact["figures"] = [{
            "id": "confusion-matrix",
            "spec_output": "figures/confusion_matrix.spec.json",
            "image_output": "figures/confusion_matrix.png",
            "renderer": {"name": "matplotlib", "version": importlib.metadata.version("matplotlib"), "backend": "Agg"},
        }]
        acc, ref = produced["test"]["accuracy"], produced["reference_most_frequent"]["accuracy"]
        # Findings are generated by a fixed template from the metrics, not by a model.
        artifact["findings"] = [{
            "id": "F1",
            "statement": f"Logistic regression reaches {acc:.4f} test accuracy on the held-out split, against {ref:.4f} for a most-frequent-class reference.",
            "supported_by": ["metric:test_accuracy", "metric:reference_most_frequent_accuracy", "figure:confusion-matrix"],
            "provenance": "template",
        }]
        artifact["limitations"] = [
            "Single seed and a single train/test split: no variance estimate is reported.",
            "The digits dataset is small and saturated; the result says nothing about harder benchmarks.",
            "Metrics were computed by the experiment process itself; the collector verifies file integrity, not metric correctness.",
        ]
        render_report(artifact, out)
        artifact["outputs"].append(describe_output(out, "report.md", "report", "text/markdown", "volatile"))
        index = len(artifact["outputs"]) - 1
        artifact["volatile_fields"] += [f"/outputs/{index}/sha256", f"/outputs/{index}/bytes"]
    else:
        artifact["failure"] = {"reason": status, "stderr_tail": stderr[-2000:]}

    (out / "artifact.json").write_text(json.dumps(artifact, sort_keys=True, indent=2) + "\n")
    print(f"{status}: wrote {out / 'artifact.json'}")
    return 0 if status == "succeeded" else 1


if __name__ == "__main__":
    sys.exit(main())
