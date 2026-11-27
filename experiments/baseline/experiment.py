"""Baseline experiment (the *producer*).

Trains a logistic-regression classifier on the scikit-learn digits dataset and
writes metrics, a figure specification, and a rendered figure.

This file plays the role an agent backend will play later: everything it
writes is a *claim* until the collector (run_baseline.py) has observed and
hashed it. It deliberately knows nothing about the artifact IR.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import matplotlib

# Ignore any matplotlibrc on the host (one on the bootstrap machine silently
# switched the font to Inter) and use the font that ships inside matplotlib,
# so rendering depends on the pinned package and not on installed fonts.
matplotlib.rcdefaults()
matplotlib.use("Agg")
matplotlib.rcParams["font.family"] = "DejaVu Sans"
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.datasets import load_digits  # noqa: E402
from sklearn.dummy import DummyClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402


def write_json(path: Path, obj: object) -> None:
    # Sorted keys + fixed separators + trailing newline: stable bytes for equal values.
    # newline="\n" because text mode would otherwise write CRLF on Windows.
    path.write_text(json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=True) + "\n", encoding="utf-8", newline="\n")


def render_confusion_matrix(spec: dict, path: Path) -> None:
    """Render a figure purely from its specification (no hidden state)."""
    matrix = np.array(spec["data"]["matrix"])
    fig, ax = plt.subplots(figsize=tuple(spec["render"]["figsize_in"]), dpi=spec["render"]["dpi"])
    ax.imshow(matrix, cmap=spec["render"]["cmap"])
    ax.set_title(spec["title"])
    ax.set_xlabel(spec["x_label"])
    ax.set_ylabel(spec["y_label"])
    ticks = range(len(spec["data"]["labels"]))
    ax.set_xticks(ticks, spec["data"]["labels"])
    ax.set_yticks(ticks, spec["data"]["labels"])
    threshold = matrix.max() / 2
    for i in ticks:
        for j in ticks:
            ax.text(j, i, int(matrix[i, j]), ha="center", va="center", fontsize=7,
                    color="white" if matrix[i, j] < threshold else "black")
    fig.tight_layout()
    # "Software" metadata embeds the matplotlib version string; drop it so the
    # bytes depend only on the spec and the pinned renderer.
    fig.savefig(path, format="png", metadata={"Software": None})
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    seed = config["seed"]
    (args.out / "figures").mkdir(parents=True, exist_ok=True)

    digits = load_digits()
    X, y = digits.data, digits.target
    # Digest of the data as the experiment actually saw it (a producer claim;
    # the collector hashes the dataset file on disk independently).
    in_memory_sha256 = hashlib.sha256(
        np.ascontiguousarray(X, dtype="<f8").tobytes() + np.ascontiguousarray(y, dtype="<i8").tobytes()
    ).hexdigest()

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=config["test_fraction"], random_state=seed, stratify=y
    )

    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(C=config["model"]["C"], max_iter=config["model"]["max_iter"], random_state=seed),
    )
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    reference = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)
    reference_pred = reference.predict(X_test)

    metrics = {
        "dataset": {
            "n_samples": int(X.shape[0]),
            "n_features": int(X.shape[1]),
            "n_classes": int(len(np.unique(y))),
            "in_memory_sha256": in_memory_sha256,
        },
        "split": {"n_train": int(len(y_train)), "n_test": int(len(y_test))},
        "test": {
            "accuracy": float(accuracy_score(y_test, pred)),
            "macro_f1": float(f1_score(y_test, pred, average="macro")),
        },
        "reference_most_frequent": {
            "accuracy": float(accuracy_score(y_test, reference_pred)),
        },
    }
    write_json(args.out / "metrics.json", metrics)

    labels = [int(v) for v in np.unique(y)]
    spec = {
        "id": "confusion-matrix",
        "kind": "heatmap",
        "title": "Confusion matrix (test split)",
        "x_label": "Predicted digit",
        "y_label": "True digit",
        "data": {"labels": labels, "matrix": confusion_matrix(y_test, pred, labels=labels).tolist()},
        "render": {"figsize_in": [5.0, 5.0], "dpi": 120, "cmap": "viridis", "format": "png"},
    }
    write_json(args.out / "figures" / "confusion_matrix.spec.json", spec)
    render_confusion_matrix(spec, args.out / "figures" / "confusion_matrix.png")


if __name__ == "__main__":
    main()
