// R-008: the verifier re-executes the task itself, from the recorded revision,
// and compares. Runs against the real executions scripts/verify.sh produces.
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scrubbedEnvironment } from "../src/reproduce.ts";
import { readJson, REPO_ROOT } from "../src/spec.ts";
import { PreconditionError, verify } from "../src/verify.ts";
import { runChecks } from "../src/checks.ts";
import { loadContract } from "../src/spec.ts";
import { CONTRACT, CONTRACT_010, CONTRACT_030, editArtifact, inflateAccuracy, rehash, RUN_A, SLOW, tamperedCopy, TASK, tempDir } from "./helpers.ts";

const reproduce = { taskPath: REPO_ROOT + TASK };
const judge = (runDir: string, contract = CONTRACT, task = reproduce) =>
  verify({ runDir, contractPath: REPO_ROOT + contract, repo: REPO_ROOT, reproduce: task });
const r008 = (record: ReturnType<typeof verify>) => record.results.find((r) => r.requirement === "R-008")!;

describe("re-execution: the baseline run", () => {
  it("is reproduced and accepted under contract 0.2.0", () => {
    const record = judge(RUN_A);
    expect(r008(record).status).toBe("pass");
    expect(r008(record).detail).toMatch(/^re-executed revision [0-9a-f]{40} in an equal environment: 3 metrics equal, 3 outputs byte-identical$/);
    expect(record.verdict).toBe("accepted");
    expect(record.statement).toBe(
      "accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human); collector not attested",
    );
    expect(record.reproduction.requested).toBe(true);
    expect(record.reproduction.task_sha256).toMatch(/^[0-9a-f]{64}$/);
  }, SLOW);

  it("is accepted under contract 0.1.0 as well", () => {
    expect(judge(RUN_A, CONTRACT_010).statement).toBe(
      "accepted under contract research.experiment-report version 0.1.0: 8 of 8 mandatory requirements passed (7 machine, 1 empirical, 0 human); collector not attested",
    );
  }, SLOW);

  it("is inconclusive, never accepted, when no re-execution is requested", () => {
    const record = verify({ runDir: RUN_A, contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT });
    expect(r008(record)).toMatchObject({ status: "not_run", detail: "re-execution was not requested" });
    expect(record.verdict).toBe("inconclusive");
  });
});

describe("re-execution: results that do not match what the source produces are rejected", () => {
  const rejectedBy = (dir: string) => {
    const record = judge(dir);
    expect(record.verdict).toBe("rejected");
    expect(record.results.filter((r) => r.status === "fail").map((r) => r.requirement)).toEqual(["R-008"]);
    return r008(record).detail!;
  };

  it("an inflated metric that is consistent everywhere in the artifact", () => {
    const detail = rejectedBy(tamperedCopy((dir) => inflateAccuracy(dir, 0.9999)));
    expect(detail).toContain("metric test_accuracy: artifact reports 0.9999, re-execution gives 0.96");
    expect(detail).toContain("metrics.json: bytes differ from the re-execution");
  }, SLOW);

  it("a metric the source does not produce, and a produced metric left out", () => {
    const detail = rejectedBy(tamperedCopy((dir) => editArtifact(dir, (a) => {
      a.metrics[1].name = "test_auc";
      a.findings[0].supported_by = ["metric:test_accuracy"];
    })));
    expect(detail).toContain("metric test_auc: reported by the artifact, not produced by the re-execution");
    expect(detail).toContain("metric test_macro_f1: produced by the re-execution, missing from the artifact");
  }, SLOW);

  it("a figure with other bytes, even when its declaration is downgraded to volatile to avoid the comparison", () => {
    const detail = rejectedBy(tamperedCopy((dir) => {
      const path = join(dir, "figures/confusion_matrix.png");
      const bytes = readFileSync(path);
      bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 0xff;
      writeFileSync(path, bytes);
      rehash(dir, "figures/confusion_matrix.png");
      editArtifact(dir, (a) => { a.outputs.find((o: any) => o.role === "figure").determinism = "volatile"; });
    }));
    expect(detail).toBe("figures/confusion_matrix.png: bytes differ from the re-execution");
  }, SLOW);

  it("a config digest that is not the config at the recorded revision", () => {
    const detail = rejectedBy(tamperedCopy((dir) => editArtifact(dir, (a) => { a.config.sha256 = "0".repeat(64); })));
    expect(detail).toMatch(/config experiments\/baseline\/config\.json at revision [0-9a-f]{40} is not the config the artifact records/);
  }, SLOW);

  it("a config that is not part of the recorded revision", () => {
    const detail = rejectedBy(tamperedCopy((dir) => editArtifact(dir, (a) => { a.config.path = "my-local-config.json"; })));
    expect(detail).toMatch(/config my-local-config\.json is not part of revision/);
  }, SLOW);
});

describe("re-execution: a validator that cannot decide reports error, never pass", () => {
  it("errors when the recorded execution did not succeed, and the verdict is rejected by R-005", () => {
    const record = judge(REPO_ROOT + "runs/verify-fail");
    expect(r008(record)).toMatchObject({ status: "error", detail: expect.stringContaining("nothing to reproduce") });
    expect(record.verdict).toBe("rejected");
  });

  it("errors when the source is not pinned (dirty tree, unknown revision), and the verdict is rejected by R-006", () => {
    for (const mutate of [(a: any) => { a.source.dirty = true; }, (a: any) => { a.source.revision = "0".repeat(40); }]) {
      const record = judge(tamperedCopy((dir) => editArtifact(dir, mutate)));
      expect(r008(record)).toMatchObject({ status: "error", detail: expect.stringContaining("nothing to re-execute from") });
      expect(record.results.find((r) => r.requirement === "R-006")?.status).toBe("fail");
      expect(record.verdict).toBe("rejected");
    }
  });

  it("errors when the task is for another experiment or its command cannot produce an artifact: inconclusive", () => {
    const task = readJson(REPO_ROOT + TASK) as any;
    const write = (mutate: (task: any) => void) => {
      const copy = structuredClone(task);
      mutate(copy);
      const path = join(tempDir("tenric-task-"), "task.json");
      writeFileSync(path, JSON.stringify(copy));
      return { taskPath: path };
    };
    const other = judge(RUN_A, CONTRACT, write((t) => { t.experiment_id = "another-experiment"; }));
    expect(r008(other)).toMatchObject({ status: "error", detail: expect.stringContaining("the task file is for another-experiment, the artifact is for baseline-digits-logreg") });
    expect(other.verdict).toBe("inconclusive");

    const broken = judge(RUN_A, CONTRACT, write((t) => { t.collect = ["git", "--version", "{out}"]; }));
    expect(r008(broken)).toMatchObject({ status: "error", detail: expect.stringContaining("re-execution produced no artifact") });
    expect(broken.verdict).toBe("inconclusive");
  }, SLOW);

  it("issues no verdict when the task file is missing, and errors when it is not a task file", () => {
    expect(() => judge(RUN_A, CONTRACT, { taskPath: "no-such-task.json" })).toThrow(PreconditionError);
    const notATask = judge(RUN_A, CONTRACT, { taskPath: REPO_ROOT + "package.json" });
    expect(r008(notATask)).toMatchObject({ status: "error", detail: expect.stringContaining("invalid task file") });
  });
});

describe("re-execution: per-metric tolerance is opt-in and declared in the contract (0.3.0)", () => {
  const r008With = (dir: string, rules: unknown) => {
    const contract = structuredClone(loadContract(REPO_ROOT + CONTRACT_030));
    contract.requirements.find((r) => r.id === "R-008")!.check.params!.metric_rules = rules;
    return runChecks(contract, dir, { repo: REPO_ROOT, reproduce }).find((r) => r.requirement === "R-008")!;
  };

  it("the baseline is accepted under 0.3.0, and none of its metrics is compared with a tolerance", () => {
    const record = judge(RUN_A, CONTRACT_030);
    expect(record.verdict).toBe("accepted");
    expect(r008(record).detail).not.toContain("tolerance");
  }, SLOW);

  it("0.3.0 still rejects an inflated accuracy: its rule covers only names ending in _seconds", () => {
    const record = judge(tamperedCopy((dir) => inflateAccuracy(dir, 0.9999)), CONTRACT_030);
    expect(r008(record).detail).toContain("metric test_accuracy: artifact reports 0.9999, re-execution gives 0.96");
    expect(record.verdict).toBe("rejected");
  }, SLOW);

  it("a rule lets a matching metric differ within its bound, says so in the result, and no further", () => {
    const run = tamperedCopy((dir) => inflateAccuracy(dir, 0.97));
    const loose = r008With(run, [{ pattern: "test_acc*", abs_tolerance: 0.01 }]);
    // The edited file is still caught by the byte comparison; only the metric comparison is relaxed.
    expect(loose.detail).toBe("metrics.json: bytes differ from the re-execution");
    const tight = r008With(run, [{ pattern: "test_acc*", abs_tolerance: 0.001 }]);
    expect(tight.detail).toContain('metric test_accuracy: artifact reports 0.97, re-execution gives 0.9644444444444444 (contract rule {"pattern":"test_acc*","abs_tolerance":0.001})');
    const relative = r008With(run, [{ pattern: "*", rel_tolerance: 0.001 }]);
    expect(relative.detail).toContain("metric test_accuracy: artifact reports 0.97");

    const named = r008With(RUN_A, [{ pattern: "test_*", rel_tolerance: 0.1 }]);
    expect(named).toMatchObject({ status: "pass" });
    expect(named.detail).toMatch(/; compared within a contract tolerance instead of exactly: test_accuracy, test_macro_f1$/);
  }, SLOW);

  it("errors on rules it cannot apply, rather than ignoring them", () => {
    for (const rules of ["*_seconds", [{ pattern: "*_seconds" }], [{ pattern: "x", abs_tolerance: 1, rel_tolerance: 1 }], [{ pattern: "x", abs_tolerance: -1 }], [{ pattern: "x", abs_tolerance: 1, skip: true }]]) {
      expect(r008With(RUN_A, rules), JSON.stringify(rules)).toMatchObject({ status: "error", detail: expect.stringContaining("unusable metric_rules") });
    }
  });
});

describe("re-execution: environment", () => {
  it("drops interpreter and virtual-environment variables and keeps what a process needs to start", () => {
    const env = scrubbedEnvironment({
      PATH: "/usr/bin", Path: "C:\\Windows", HOME: "/home/u", PYTHONPATH: "/tmp/evil", PYTHONSTARTUP: "/tmp/evil.py",
      VIRTUAL_ENV: "/tmp/venv", UV_PROJECT_ENVIRONMENT: "/tmp/venv", LD_PRELOAD: "/tmp/evil.so", GITHUB_TOKEN: "secret",
    });
    expect(env).toEqual({ PATH: "/usr/bin", Path: "C:\\Windows", HOME: "/home/u" });
  });
});
