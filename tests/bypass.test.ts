// Regression tests for the six bypass experiments of the engineering review of
// 2026-11-25 (A1 to A6). Each one passed every machine check of the verifier as
// it stood in pull request 2. Each test first rebuilds the forgery, then asserts
// what the verifier does with it now. Where a forgery is still invisible to the
// checks that read only the artifact, the test says so and shows what catches it.
import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { runChecks } from "../src/checks.ts";
import { loadContract, readJson, REPO_ROOT } from "../src/spec.ts";
import { verify } from "../src/verify.ts";
import { CONTRACT, CONTRACT_010, editArtifact, git, inflateAccuracy, rehash, RUN_A, SLOW, tamperedCopy, TASK, tempDir, tenric } from "./helpers.ts";

const reproduce = { taskPath: REPO_ROOT + TASK };
const failed = (record: ReturnType<typeof verify>) => record.results.filter((r) => r.status === "fail").map((r) => r.requirement);
const original = readJson(join(RUN_A, "artifact.json")) as any;

/** A2: an artifact typed by hand. Nothing was executed; every list is empty; it still says it is a fixture. */
function handWrittenArtifact(): string {
  const dir = tempDir("tenric-handwritten-");
  const artifact = readJson(REPO_ROOT + "fixtures/research-report/valid.fixture.artifact.json") as any;
  Object.assign(artifact, { outputs: [], metrics: [], figures: [], findings: [], volatile_fields: [] });
  artifact.source = { kind: "git", revision: original.source.revision, dirty: false, provenance: "collector" };
  for (const section of ["environment", "dataset", "config", "execution"]) artifact[section].provenance = "collector";
  delete artifact.dataset.producer_claims;
  writeFileSync(join(dir, "artifact.json"), JSON.stringify(artifact));
  return dir;
}

function alteredContract(mutate: (contract: any) => void): string {
  const contract = readJson(REPO_ROOT + CONTRACT) as any;
  mutate(contract);
  const path = join(tempDir("tenric-contract-"), "contract.json");
  writeFileSync(path, JSON.stringify(contract, null, 2));
  return path;
}

/** A commit, reachable from no branch, whose experiment splits the data differently from the one that produced the run. */
function commitWithOtherExperiment(): string {
  const env = { ...process.env, GIT_INDEX_FILE: join(tempDir("tenric-index-"), "index") };
  const run = (args: string[], input?: string) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", env, input }).trim();
  const path = "experiments/baseline/experiment.py";
  const source = run(["show", `${original.source.revision}:${path}`]);
  const changed = source.replace('test_size=config["test_fraction"]', "test_size=0.5");
  expect(changed).not.toBe(source);
  run(["read-tree", original.source.revision]);
  const blob = run(["hash-object", "-w", "--stdin"], changed + "\n");
  run(["update-index", "--cacheinfo", `100644,${blob},${path}`]);
  return run(["-c", "user.name=tenric-test", "-c", "user.email=tenric-test@invalid", "commit-tree", run(["write-tree"]),
    "-p", original.source.revision, "-m", "Test only: another experiment at the same paths"]);
}

describe("A1: metrics.json edited to 0.9999, digests recomputed, finding rewritten", () => {
  const forge = () => tamperedCopy((dir) => inflateAccuracy(dir, 0.9999));

  it("still passes every check that reads only the artifact, which is why those checks alone never accept", () => {
    const record = verify({ runDir: forge(), contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT });
    expect(failed(record)).toEqual([]);
    expect(record.verdict).toBe("inconclusive");
  });

  it("is rejected once the verifier re-executes the source (R-008)", () => {
    const record = verify({ runDir: forge(), contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT, reproduce });
    expect(failed(record)).toEqual(["R-008"]);
    expect(record.verdict).toBe("rejected");
  }, SLOW);
});

describe("A2: a hand-written artifact that was never executed and lists nothing", () => {
  it("passed the seven checks of contract 0.1.0 vacuously, and still does", () => {
    const first = loadContract(REPO_ROOT + CONTRACT_010);
    expect(runChecks(first, handWrittenArtifact(), { repo: REPO_ROOT }).filter((r) => r.status === "fail")).toEqual([]);
  });

  it("is rejected under contract 0.2.0: it is a fixture and reports nothing (R-010)", () => {
    const record = verify({ runDir: handWrittenArtifact(), contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT });
    expect(failed(record)).toEqual(["R-010"]);
    expect(record.results.find((r) => r.requirement === "R-010")?.detail).toBe(
      'data_class is "fixture", the contract requires "measured"; no output with role metrics; no output with role report; ' +
      "0 metrics, at least 1 required; 0 findings, at least 1 required",
    );
    expect(record.verdict).toBe("rejected");
  });

  it("is rejected when relabelled as a measurement too, and cannot be re-executed into acceptance", () => {
    const dir = handWrittenArtifact();
    editArtifact(dir, (a) => { a.data_class = "measured"; });
    const record = verify({ runDir: dir, contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT, reproduce });
    expect(failed(record)).toContain("R-010");
    expect(record.verdict).toBe("rejected");
  }, SLOW);
});

describe("A3: a real run with another revision, a figure that points nowhere and a duplicated metric name", () => {
  it("the figure and the duplicate are rejected (R-011)", () => {
    const dir = tamperedCopy((d) => editArtifact(d, (a) => {
      a.figures[0].image_output = "figures/does_not_exist.png";
      a.metrics.push({ ...a.metrics[0] });
    }));
    const record = verify({ runDir: dir, contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT });
    expect(failed(record)).toEqual(["R-011"]);
    expect(record.results.find((r) => r.requirement === "R-011")?.detail).toBe(
      "metric name test_accuracy is used more than once; figure confusion-matrix: figures/does_not_exist.png is not a listed output",
    );
    expect(record.verdict).toBe("rejected");
  });

  it("a revision whose code does not produce these results passes R-006, which only asks that the commit exists, and is rejected by re-execution (R-008)", () => {
    const other = commitWithOtherExperiment();
    const dir = tamperedCopy((d) => editArtifact(d, (a) => { a.source.revision = other; }));
    const record = verify({ runDir: dir, contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT, reproduce });
    expect(record.results.find((r) => r.requirement === "R-006")?.status).toBe("pass");
    expect(failed(record)).toEqual(["R-008"]);
    expect(record.results.find((r) => r.requirement === "R-008")?.detail).toContain("metric test_accuracy: artifact reports");
    expect(record.verdict).toBe("rejected");
  }, SLOW);
});

describe("A4 and A5: a contract with the same id and version and fewer obligations", () => {
  const refusedAtTheCommandLine = (runDir: string, contractPath: string) => {
    const { code, out, err } = tenric(["verify", runDir, "--contract", contractPath, "--repo", "."]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toMatch(/^no verdict issued: cannot use contract .*: contract content does not match the registry: research\.experiment-report version 0\.2\.0 is registered with sha256 [0-9a-f]{64}, this file has [0-9a-f]{64}$/m);
    expect(err).not.toMatch(/accepted/);
  };

  it("A4: the hand-written artifact with a contract cut down to R-001 gets no verdict (was: accepted, exit 0)", () => {
    refusedAtTheCommandLine(handWrittenArtifact(), alteredContract((c) => { c.requirements = c.requirements.slice(0, 1); }));
  });

  it("A5: the inflated result with a contract that makes R-008 advisory gets no verdict (was: accepted, exit 0)", () => {
    const run = tamperedCopy((dir) => inflateAccuracy(dir, 0.9999));
    refusedAtTheCommandLine(run, alteredContract((c) => { c.requirements.find((r: any) => r.id === "R-008").level = "advisory"; }));
  });
});

describe("A6: nothing forged; a sitecustomize.py on PYTHONPATH makes accuracy_score return 1.0", () => {
  const poison = tempDir("tenric-pythonpath-");
  writeFileSync(join(poison, "sitecustomize.py"), [
    "import sklearn.metrics",
    "import sklearn.metrics._classification",
    "sklearn.metrics.accuracy_score = lambda *args, **kwargs: 1.0",
    "sklearn.metrics._classification.accuracy_score = sklearn.metrics.accuracy_score",
    "",
  ].join("\n"));
  const poisoned = { ...process.env, PYTHONPATH: poison };
  const uv = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync("uv", ["run", "--locked", "python", ...args], { cwd: REPO_ROOT, env, encoding: "utf8" });
  const accuracy = (dir: string) => (readJson(join(dir, "metrics.json")) as any).test.accuracy;
  const real = accuracy(RUN_A);

  /** The outputs the experiment writes when it is started directly in the poisoned environment. */
  function poisonedRun(): string {
    const out = tempDir("tenric-poisoned-");
    mkdirSync(join(out, "figures"), { recursive: true });
    const done = uv(["experiments/baseline/experiment.py", "--config", "experiments/baseline/config.json", "--out", out], poisoned);
    expect(done.status, done.stderr).toBe(0);
    return out;
  }

  it("the attack works on the experiment itself: it reports 1.0", () => {
    expect(real).toBeLessThan(1);
    expect(accuracy(poisonedRun())).toBe(1);
  }, SLOW);

  it("the collector no longer hands PYTHONPATH to the experiment: a collected run reports the real accuracy", () => {
    const out = join(tempDir("tenric-collected-"), "run");
    const done = uv(["experiments/baseline/run_baseline.py", "--out", out], poisoned);
    expect(done.status, done.stderr).toBe(0);
    expect(accuracy(out)).toBe(real);
  }, SLOW);

  it("an artifact built from the poisoned outputs is rejected, with the verifier itself running in the poisoned environment (R-008)", () => {
    const outputs = poisonedRun();
    const run = tamperedCopy((dir) => {
      cpSync(join(outputs, "metrics.json"), join(dir, "metrics.json"));
      rehash(dir, "metrics.json");
      // The patched function also scores the most-frequent-class reference, so both accuracies read 1.0.
      editArtifact(dir, (a) => {
        for (const metric of a.metrics) if (metric.name.endsWith("accuracy")) metric.value = 1;
      });
    });
    expect(failed(verify({ runDir: run, contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT }))).toEqual([]);

    const { code, out } = tenric(["verify", run, "--contract", CONTRACT, "--repo", ".", "--reproduce", "--task", TASK], poisoned);
    expect(out).toMatch(new RegExp(`metric test_accuracy: artifact reports 1, re-execution gives ${String(real).replace(".", "\\.")}`));
    expect(out).toMatch(/^verdict: rejected under contract /m);
    expect(code).toBe(1);
  }, SLOW);

  it("the real run is still accepted when the verifier runs in the poisoned environment", () => {
    const { code, out } = tenric(["verify", "runs/verify-a", "--contract", CONTRACT, "--repo", ".", "--reproduce", "--task", TASK], poisoned);
    expect(out).toMatch(/^verdict: accepted under contract /m);
    expect(code).toBe(0);
  }, SLOW);
});
