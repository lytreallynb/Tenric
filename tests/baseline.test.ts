// Runs against two real executions of the baseline experiment. scripts/verify.sh
// produces them; if they are absent these tests fail rather than skip.
import { beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks, sha256File } from "../src/checks.ts";
import { loadContract, readJson, REPO_ROOT, validateArtifact } from "../src/spec.ts";
import { decide } from "../src/verdict.ts";

const RUN_A = process.env.TENRIC_RUN_A ?? REPO_ROOT + "runs/verify-a";
const RUN_B = process.env.TENRIC_RUN_B ?? REPO_ROOT + "runs/verify-b";
const contract = loadContract(REPO_ROOT + "spec/contracts/research.experiment-report/0.1.0.contract.json");
// Copies of a run live in a temporary directory, so the repository to check revisions against is named explicitly.
const check = (dir: string) => runChecks(contract, dir, { repo: REPO_ROOT });
const status = (dir: string) => Object.fromEntries(check(dir).map((r) => [r.requirement, r.status]));

function tamperedCopy(mutate: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "tenric-run-"));
  cpSync(RUN_A, dir, { recursive: true });
  mutate(dir);
  return dir;
}
function editArtifact(dir: string, mutate: (artifact: any) => void): void {
  const path = join(dir, "artifact.json");
  const artifact = readJson(path);
  mutate(artifact);
  writeFileSync(path, JSON.stringify(artifact));
}

beforeAll(() => {
  for (const dir of [RUN_A, RUN_B]) {
    if (!existsSync(join(dir, "artifact.json"))) {
      throw new Error(`no baseline run at ${dir}; run "npm run verify" (it executes the experiment twice)`);
    }
  }
});

describe("baseline run: evidence checks", () => {
  it("is a measured, successful, collector-observed execution", () => {
    const artifact = readJson(join(RUN_A, "artifact.json")) as any;
    expect(validateArtifact(artifact), JSON.stringify(validateArtifact.errors)).toBe(true);
    expect(artifact.data_class).toBe("measured");
    expect(artifact.execution).toMatchObject({ status: "succeeded", exit_code: 0, provenance: "collector" });
    expect(artifact.source.kind).toBe("git");
  });

  it("passes the seven machine validators", () => {
    expect(status(RUN_A)).toEqual({
      "R-001": "pass", "R-002": "pass", "R-003": "pass", "R-004": "pass",
      "R-005": "pass", "R-006": "pass", "R-007": "pass", "R-008": "not_run", "R-009": "not_run",
    });
  });

  it("is NOT accepted: the mandatory re-execution requirement has no validator, so the verdict is inconclusive", () => {
    const decision = decide(contract, check(RUN_A));
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.blocking.map((r) => r.requirement)).toEqual(["R-008"]);
    expect(decision.blocking.every((r) => r.status === "not_run")).toBe(true);
  });
});

describe("baseline run: invalid artifacts are rejected", () => {
  const cases: Record<string, { mutate: (dir: string) => void; fails: string; also?: string }> = {
    "a metrics file edited after hashing": {
      mutate: (dir) => writeFileSync(join(dir, "metrics.json"), readFileSync(join(dir, "metrics.json"), "utf8").replace("0.96", "0.99")),
      fails: "R-002",
      also: "R-003",
    },
    "a deleted figure": {
      mutate: (dir) => rmSync(join(dir, "figures/confusion_matrix.png")),
      fails: "R-002",
    },
    "a figure replaced by different bytes of the same length": {
      mutate: (dir) => {
        const path = join(dir, "figures/confusion_matrix.png");
        const bytes = readFileSync(path);
        bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 0xff;
        writeFileSync(path, bytes);
      },
      fails: "R-002",
    },
    "a metric inflated in the artifact only": {
      mutate: (dir) => editArtifact(dir, (a) => { a.metrics[0].value = 0.999; }),
      fails: "R-003",
    },
    "a metric that cites a file outside the hashed outputs": {
      mutate: (dir) => editArtifact(dir, (a) => { a.metrics[0].source_output = "notes.json"; }),
      fails: "R-003",
    },
    "required metadata removed": {
      mutate: (dir) => editArtifact(dir, (a) => { delete a.dataset; }),
      fails: "R-001",
    },
    "an artifact file that is not JSON": {
      mutate: (dir) => writeFileSync(join(dir, "artifact.json"), "not json"),
      fails: "R-001",
    },
    "an output replaced by a symlink to identical bytes outside the run directory": {
      mutate: (dir) => {
        const outside = join(mkdtempSync(join(tmpdir(), "tenric-outside-")), "metrics.json");
        cpSync(join(dir, "metrics.json"), outside);
        rmSync(join(dir, "metrics.json"));
        symlinkSync(outside, join(dir, "metrics.json"));
      },
      fails: "R-002",
      also: "R-003",
    },
    "an execution record asserted by the producer": {
      mutate: (dir) => editArtifact(dir, (a) => { a.execution.provenance = "producer"; }),
      fails: "R-004",
    },
    "one output digest asserted by the producer": {
      mutate: (dir) => editArtifact(dir, (a) => { a.outputs[1].provenance = "producer"; }),
      fails: "R-004",
    },
    "a run recorded as timed out": {
      mutate: (dir) => editArtifact(dir, (a) => {
        a.execution.status = "timeout"; a.execution.exit_code = null; a.failure = { reason: "timeout" };
      }),
      fails: "R-005",
    },
    "a run recorded as cancelled": {
      mutate: (dir) => editArtifact(dir, (a) => {
        a.execution.status = "cancelled"; a.execution.exit_code = null; a.failure = { reason: "cancelled" };
      }),
      fails: "R-005",
    },
    "a run collected from a dirty working tree": {
      mutate: (dir) => editArtifact(dir, (a) => { a.source.dirty = true; }),
      fails: "R-006",
    },
    "a revision that does not exist in the repository being verified": {
      mutate: (dir) => editArtifact(dir, (a) => { a.source.revision = "0".repeat(40); }),
      fails: "R-006",
    },
    "a revision that names a tree, not a commit": {
      mutate: (dir) => editArtifact(dir, (a) => {
        a.source.revision = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
      }),
      fails: "R-006",
    },
    "a run with no source identity": {
      mutate: (dir) => editArtifact(dir, (a) => { a.source = { kind: "none", provenance: "collector" }; }),
      fails: "R-006",
    },
    "a finding that cites a metric the artifact does not contain": {
      mutate: (dir) => editArtifact(dir, (a) => { a.findings[0].supported_by.push("metric:state_of_the_art_accuracy"); }),
      fails: "R-007",
    },
    "a finding that cites an unlisted output": {
      mutate: (dir) => editArtifact(dir, (a) => { a.findings[0].supported_by = ["output:notes.txt"]; }),
      fails: "R-007",
    },
  };
  for (const [name, { mutate, fails, also }] of Object.entries(cases)) {
    it(`rejects ${name} (${fails})`, () => {
      const dir = tamperedCopy(mutate);
      const results = check(dir);
      // Exactly the named requirement fails: the other validators must not misfire on the same tampering.
      expect(results.filter((r) => r.status === "fail").map((r) => r.requirement)).toEqual(also ? [fails, also] : [fails]);
      expect(decide(contract, results).verdict).toBe("rejected");
    });
  }

  it("rejects the demonstration fixture relabelled as a measurement (R-002, R-004, R-006)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tenric-fixture-"));
    cpSync(REPO_ROOT + "fixtures/research-report/valid.fixture.artifact.json", join(dir, "artifact.json"));
    editArtifact(dir, (a) => { a.data_class = "measured"; });
    const results = check(dir);
    expect(results.filter((r) => r.status === "fail").map((r) => r.requirement)).toEqual(["R-002", "R-004", "R-006"]);
    expect(decide(contract, results).verdict).toBe("rejected");
  });

  it("does not run content validators on a structurally invalid artifact", () => {
    const dir = tamperedCopy((d) => editArtifact(d, (a) => { delete a.outputs; }));
    expect(status(dir)).toEqual({
      "R-001": "fail", "R-002": "error", "R-003": "error", "R-004": "error",
      "R-005": "error", "R-006": "error", "R-007": "error", "R-008": "not_run", "R-009": "not_run",
    });
  });
});

describe("baseline run: a validator that cannot decide reports error, never pass", () => {
  const blockers = (dir: string, options = {}) => decide(contract, runChecks(contract, dir, options)).blocking;

  it("R-006 errors when there is no repository to check the revision against", () => {
    const dir = tamperedCopy(() => {});
    expect(blockers(dir, { repo: tmpdir() }).find((r) => r.requirement === "R-006")?.status).toBe("error");
    // With no repository named, the one containing the run directory is used; a temporary copy has none.
    expect(blockers(dir).find((r) => r.requirement === "R-006")?.status).toBe("error");
  });

  it("R-006 errors on a snapshot source, which this IR version gives no way to re-hash", () => {
    const dir = tamperedCopy((d) => editArtifact(d, (a) => {
      a.source = { kind: "snapshot", snapshot_sha256: "0".repeat(64), provenance: "collector" };
    }));
    expect(blockers(dir, { repo: REPO_ROOT }).find((r) => r.requirement === "R-006")?.status).toBe("error");
  });

  it("R-004 errors when the contract names no sections or a section the artifact lacks", () => {
    for (const sections of [undefined, [], ["source", "telemetry"]]) {
      const altered = structuredClone(contract);
      altered.requirements.find((r) => r.id === "R-004")!.check.params = { sections };
      const result = runChecks(altered, RUN_A, { repo: REPO_ROOT }).find((r) => r.requirement === "R-004");
      expect(result?.status, JSON.stringify(sections)).toBe("error");
    }
  });
});

describe("failed run: failure is explicit", () => {
  const dir = process.env.TENRIC_RUN_FAIL ?? REPO_ROOT + "runs/verify-fail";

  it("still yields a schema-valid artifact that records the failure and lists no outputs", () => {
    const artifact = readJson(join(dir, "artifact.json")) as any;
    expect(validateArtifact(artifact), JSON.stringify(validateArtifact.errors)).toBe(true);
    expect(artifact.execution.status).toBe("failed");
    expect(artifact.execution.exit_code).not.toBe(0);
    expect(artifact.failure.reason).toBe("failed");
    expect(artifact.failure.stderr_tail.length).toBeGreaterThan(0);
    expect(artifact.outputs).toEqual([]);
    expect(artifact.metrics).toEqual([]);
  });

  it("is rejected, because execution did not succeed (R-005)", () => {
    const results = check(dir);
    expect(results.filter((r) => r.status === "fail").map((r) => r.requirement)).toEqual(["R-005"]);
    expect(decide(contract, results).verdict).toBe("rejected");
  });
});

describe("timed-out run: the collector records the timeout", () => {
  const dir = process.env.TENRIC_RUN_TIMEOUT ?? REPO_ROOT + "runs/verify-timeout";

  it("yields a schema-valid artifact with status timeout, no exit code and no outputs", () => {
    const artifact = readJson(join(dir, "artifact.json")) as any;
    expect(validateArtifact(artifact), JSON.stringify(validateArtifact.errors)).toBe(true);
    expect(artifact.execution).toMatchObject({ status: "timeout", exit_code: null, provenance: "collector" });
    expect(artifact.failure.reason).toBe("timeout");
    expect(artifact.outputs).toEqual([]);
  });

  it("is rejected (R-005)", () => {
    const results = check(dir);
    expect(results.filter((r) => r.status === "fail").map((r) => r.requirement)).toEqual(["R-005"]);
    expect(decide(contract, results).verdict).toBe("rejected");
  });
});

describe("baseline run: reproducibility across two executions in the same environment", () => {
  const a = readJson(join(RUN_A, "artifact.json")) as any;
  const b = readJson(join(RUN_B, "artifact.json")) as any;

  it("outputs declared byte-identical have identical digests", () => {
    const declared = a.outputs.filter((o: any) => o.determinism === "byte-identical");
    expect(declared.map((o: any) => o.path)).toEqual(
      ["metrics.json", "figures/confusion_matrix.spec.json", "figures/confusion_matrix.png"],
    );
    for (const output of declared) {
      expect(sha256File(join(RUN_B, output.path)), output.path).toBe(sha256File(join(RUN_A, output.path)));
    }
  });

  it("artifacts are equal once the declared volatile fields are removed", () => {
    const strip = (artifact: any) => {
      const copy = structuredClone(artifact);
      for (const pointer of copy.volatile_fields as string[]) {
        const tokens = pointer.split("/").slice(1);
        const last = tokens.pop()!;
        const parent = tokens.reduce((node, token) => node[token], copy);
        expect(parent, pointer).toHaveProperty(last);
        delete parent[last];
      }
      return copy;
    };
    expect(a.volatile_fields).toEqual(b.volatile_fields);
    expect(strip(b)).toEqual(strip(a));
  });
});
