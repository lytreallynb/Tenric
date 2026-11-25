import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract, readJson, REPO_ROOT, validateArtifact } from "../src/spec.ts";

const CONTRACT = REPO_ROOT + "spec/contracts/research.experiment-report/0.1.0.contract.json";
const fixture = () => structuredClone(readJson(REPO_ROOT + "fixtures/research-report/valid.fixture.artifact.json")) as any;

function writeTemp(value: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "tenric-")), "contract.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("contract specification", () => {
  it("loads the first contract", () => {
    const contract = loadContract(CONTRACT);
    expect(contract.id).toBe("research.experiment-report");
    expect(contract.requirements.map((r) => r.id)).toEqual(
      ["R-001", "R-002", "R-003", "R-004", "R-005", "R-006", "R-007", "R-008", "R-009"],
    );
  });

  it("refuses an unsupported contract schema version", () => {
    const contract = readJson(CONTRACT) as any;
    contract.contract_schema = "9.0.0";
    expect(() => loadContract(writeTemp(contract))).toThrow(/unsupported contract schema version/);
  });

  it("refuses an unknown check kind, an unknown field, and duplicate requirement ids", () => {
    const unknownKind = readJson(CONTRACT) as any;
    unknownKind.requirements[0].check.kind = "ask-the-model";
    expect(() => loadContract(writeTemp(unknownKind))).toThrow(/invalid contract/);

    const unknownField = readJson(CONTRACT) as any;
    unknownField.requirements[0].skip_if_inconvenient = true;
    expect(() => loadContract(writeTemp(unknownField))).toThrow(/invalid contract/);

    const duplicate = readJson(CONTRACT) as any;
    duplicate.requirements[1].id = "R-001";
    expect(() => loadContract(writeTemp(duplicate))).toThrow(/duplicate requirement ids/);
  });
});

describe("research artifact IR schema", () => {
  it("accepts the demonstration fixture, which is labelled as a fixture", () => {
    const artifact = fixture();
    expect(validateArtifact(artifact), JSON.stringify(validateArtifact.errors)).toBe(true);
    expect(artifact.data_class).toBe("fixture");
  });

  const mutations: Record<string, (a: any) => void> = {
    "missing dataset identity": (a) => { delete a.dataset; },
    "missing source revision for a git source": (a) => { delete a.source.revision; },
    "missing provenance on evidence": (a) => { delete a.execution.provenance; },
    "unsupported IR version": (a) => { a.ir_version = "0.2.0"; },
    "malformed digest": (a) => { a.outputs[0].sha256 = "abc"; },
    "absolute output path": (a) => { a.outputs[0].path = "/etc/passwd"; },
    "output path escaping the artifact directory": (a) => { a.outputs[0].path = "figures/../../secret"; },
    "unknown top-level field": (a) => { a.verified = true; },
    "finding without cited support": (a) => { a.findings[0].supported_by = []; },
    "failed execution without a failure record": (a) => { a.execution.status = "failed"; a.execution.exit_code = 1; },
    "success with a non-zero exit code": (a) => { a.execution.exit_code = 3; },
    "metric given as a string": (a) => { a.metrics[0].value = "0.99"; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    it(`rejects: ${name}`, () => {
      const artifact = fixture();
      mutate(artifact);
      expect(validateArtifact(artifact)).toBe(false);
    });
  }
});
