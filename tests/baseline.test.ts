// Runs against two real executions of the baseline experiment. scripts/verify.sh
// produces them; if they are absent these tests fail rather than skip.
import { beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks, sha256File } from "../src/checks.ts";
import { loadContract, readJson, REPO_ROOT, validateArtifact } from "../src/spec.ts";
import { decide } from "../src/verdict.ts";

const RUN_A = process.env.TENRIC_RUN_A ?? REPO_ROOT + "runs/verify-a";
const RUN_B = process.env.TENRIC_RUN_B ?? REPO_ROOT + "runs/verify-b";
const contract = loadContract(REPO_ROOT + "spec/contracts/research.experiment-report/0.1.0.contract.json");
const status = (dir: string) => Object.fromEntries(runChecks(contract, dir).map((r) => [r.requirement, r.status]));

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

  it("passes the three implemented validators", () => {
    expect(status(RUN_A)).toMatchObject({ "R-001": "pass", "R-002": "pass", "R-003": "pass" });
  });

  it("is NOT accepted: mandatory requirements without a validator leave the verdict inconclusive", () => {
    const decision = decide(contract, runChecks(contract, RUN_A));
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.blocking.map((r) => r.requirement)).toEqual(["R-004", "R-005", "R-006", "R-007", "R-008"]);
    expect(decision.blocking.every((r) => r.status === "not_run")).toBe(true);
  });
});

describe("baseline run: invalid artifacts are rejected", () => {
  const cases: Record<string, { mutate: (dir: string) => void; fails: string }> = {
    "a metrics file edited after hashing": {
      mutate: (dir) => writeFileSync(join(dir, "metrics.json"), readFileSync(join(dir, "metrics.json"), "utf8").replace("0.96", "0.99")),
      fails: "R-002",
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
  };
  for (const [name, { mutate, fails }] of Object.entries(cases)) {
    it(`rejects ${name} (${fails})`, () => {
      const dir = tamperedCopy(mutate);
      const results = runChecks(contract, dir);
      expect(results.find((r) => r.requirement === fails)?.status).toBe("fail");
      expect(decide(contract, results).verdict).toBe("rejected");
    });
  }

  it("does not run content validators on a structurally invalid artifact", () => {
    const dir = tamperedCopy((d) => editArtifact(d, (a) => { delete a.outputs; }));
    expect(status(dir)).toMatchObject({ "R-001": "fail", "R-002": "error", "R-003": "error" });
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
