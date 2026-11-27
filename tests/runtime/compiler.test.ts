import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/spec.ts";
import { ClaudeCodeBackend, ScriptBackend, listBackends, type BackendDescription } from "../../src/runtime/backends.ts";
import { compile, PreconditionError } from "../../src/runtime/compiler.ts";
import { readJson, sha256File, stableJson } from "../../src/runtime/util.ts";

const TASK = REPO_ROOT + "fixtures/tasks/coin-flips.task.json";
const script = new ScriptBackend().describe();
const agent = new ClaudeCodeBackend().describe();

function taskFile(mutate: (task: any) => void): string {
  const task = readJson(TASK) as any;
  mutate(task);
  const path = join(mkdtempSync(join(tmpdir(), "tenric-task-")), "task.json");
  writeFileSync(path, JSON.stringify(task));
  return path;
}
/** A copy of the parts of the repository the compiler reads, so a test can alter a contract without touching the real one. */
function repoCopy(mutateContract: (contract: any) => void, register = true): string {
  const root = mkdtempSync(join(tmpdir(), "tenric-repo-")) + "/";
  cpSync(REPO_ROOT + "spec", root + "spec", { recursive: true });
  cpSync(REPO_ROOT + "pyproject.toml", root + "pyproject.toml");
  const path = root + "spec/contracts/research.experiment-report/0.1.0.contract.json";
  const contract = readJson(path) as any;
  mutateContract(contract);
  writeFileSync(path, JSON.stringify(contract));
  // The owner registers the edited contract. Without this the compiler refuses it, which has its own test below.
  if (register) {
    const registry = readJson(root + "spec/contracts/registry.json") as any;
    registry.contracts.find((entry: any) => entry.version === "0.1.0").sha256 = sha256File(path);
    writeFileSync(root + "spec/contracts/registry.json", JSON.stringify(registry));
  }
  return root;
}

describe("compiler", () => {
  it("is deterministic: the same inputs give the same plan, byte for byte", () => {
    const a = stableJson(compile({ taskPath: TASK, backend: script }).plan);
    const b = stableJson(compile({ taskPath: TASK, backend: script }).plan);
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps
  });

  it("pins the contract, its registry and the artifact schema by digest", () => {
    const { plan } = compile({ taskPath: TASK, backend: script });
    expect(plan.contract.registry_sha256).toBe(sha256File(REPO_ROOT + "spec/contracts/registry.json"));
    expect(plan.contract).toMatchObject({ id: "research.experiment-report", version: "0.1.0", path: "spec/contracts/research.experiment-report/0.1.0.contract.json" });
    expect(plan.contract.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.contract.schema_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("partitions the first contract by who can supply each requirement", () => {
    const { plan } = compile({ taskPath: TASK, backend: script });
    expect(Object.fromEntries(plan.requirements.map((r) => [r.id, r.supplied_by]))).toEqual({
      "R-001": "collector", "R-002": "collector", "R-003": "producer", "R-004": "collector", "R-005": "producer",
      "R-006": "collector", "R-007": "producer", "R-008": "empirical", "R-009": "human",
    });
    expect(plan.review_checklist.map((item) => item.requirement)).toEqual(["R-009"]);
    expect(plan.requirements.find((r) => r.id === "R-001")!.validator.order).toBe(1);
  });

  it("asks the verifier which validators exist and predicts the best reachable verdict", () => {
    const { plan } = compile({ taskPath: TASK, backend: script });
    const mandatoryUnavailable = plan.requirements.filter((r) => r.level === "mandatory" && !r.validator.available).map((r) => r.id);
    expect(plan.predicted.blocking_unavailable).toEqual(mandatoryUnavailable);
    expect(plan.predicted.best_verdict).toBe(mandatoryUnavailable.length === 0 ? "accepted" : "inconclusive");
    expect(plan.requirements.filter((r) => !r.validator.available).map((r) => r.kind)).toEqual(["human-review"]);
  });

  it("knows before running that a fixture cannot be accepted under a contract that demands a measurement", () => {
    const { plan } = compile({ taskPath: taskFile((t) => { t.contract.version = "0.2.0"; }), backend: script });
    expect(plan.predicted).toMatchObject({ best_verdict: "rejected", known_failures: ["R-010: the contract requires data_class measured, the task is fixture"] });
    expect(plan.requirements.find((r) => r.id === "R-010")).toMatchObject({ supplied_by: "producer", kind: "required-content" });
    expect(plan.requirements.find((r) => r.id === "R-011")!.supplied_by).toBe("producer");
    expect(plan.warnings).toEqual([]);
    expect(plan.instructions).toContain("Declare at least 1 metric(s) and at least 1 finding(s)");
  });

  it("derives the producer's instructions from the partition and never asks it for evidence", () => {
    const { plan } = compile({ taskPath: TASK, backend: agent });
    expect(plan.instructions).toContain("(R-003, mandatory)");
    expect(plan.instructions).toContain("(R-009, advisory)");
    expect(plan.instructions).not.toMatch(/R-001|R-002|R-004/); // collector-supplied: nothing for the producer to do
    expect(plan.instructions).toContain("matplotlib, numpy, scikit-learn");

    // Drop a requirement from the contract and its instruction disappears: the text is derived, not pasted.
    const root = repoCopy((contract) => { contract.requirements = contract.requirements.filter((r: any) => r.id !== "R-007"); });
    expect(compile({ taskPath: TASK, backend: agent, repoRoot: root }).plan.instructions).not.toContain("supported_by in a finding must name");
  });

  it("knows every check kind of the first contract (an unknown kind would be reported as unclassified, with a warning)", () => {
    const { plan } = compile({ taskPath: TASK, backend: script });
    expect(plan.warnings).toEqual([]);
    expect(plan.requirements.every((r) => r.supplied_by !== "unclassified")).toBe(true);
  });

  describe("precondition failures: nothing runs and no verdict is issued", () => {
    const cases: Record<string, () => unknown> = {
      "a contract version that does not exist": () => compile({ taskPath: taskFile((t) => { t.contract.version = "9.9.9"; }), backend: script }),
      "a contract id that is a path": () => compile({ taskPath: taskFile((t) => { t.contract.id = "../../etc"; }), backend: script }),
      "an unsupported task schema version": () => compile({ taskPath: taskFile((t) => { t.runtime_task_schema = "9.0.0"; }), backend: script }),
      "an invalid task": () => compile({ taskPath: taskFile((t) => { t.unknown_field = true; }), backend: script }),
      "a task file that does not exist": () => compile({ taskPath: "no-such-task.json", backend: script }),
      "a fixture task whose title does not say so": () => compile({ taskPath: taskFile((t) => { t.title = "Coin flips"; }), backend: script }),
      "an agent backend and a task without a brief": () => compile({ taskPath: taskFile((t) => { delete t.brief; }), backend: agent }),
      "the script backend and a task without a producer": () => compile({ taskPath: taskFile((t) => { delete t.script_producer; }), backend: script }),
      "a backend that cannot author a workspace": () => {
        const mute: BackendDescription = { ...script, name: "mute", capabilities: { ...script.capabilities, "workspace-authoring": { supported: false, guarantee: "none" } } };
        return compile({ taskPath: TASK, backend: mute });
      },
      "a contract that needs a capability nobody provides": () =>
        compile({ taskPath: TASK, backend: script, repoRoot: repoCopy((c) => { c.applicability.requires_capabilities.push("hardware-attestation"); }) }),
      "an artifact schema that does not match the digest pinned in the contract": () =>
        compile({ taskPath: TASK, backend: script, repoRoot: repoCopy((c) => { c.artifact.schema_sha256 = "0".repeat(64); }) }),
      "a contract whose content is not what the registry records for its id and version": () =>
        compile({ taskPath: TASK, backend: script, repoRoot: repoCopy((c) => { c.requirements = c.requirements.filter((r: any) => r.id !== "R-008"); }, false) }),
      "a contract the verifier's loader refuses": () =>
        compile({ taskPath: TASK, backend: script, repoRoot: repoCopy((c) => { c.contract_schema = "9.0.0"; }) }),
      "a contract for an artifact type the runtime has no collector for": () =>
        compile({ taskPath: TASK, backend: script, repoRoot: repoCopy((c) => { c.artifact.type = "legal.memo"; }) }),
    };
    for (const [name, attempt] of Object.entries(cases)) {
      it(name, () => expect(attempt).toThrow(PreconditionError));
    }
  });
});

describe("backends", () => {
  it("lists every backend with a stated guarantee for every capability", () => {
    const backends = listBackends();
    expect(backends.map((b) => b.name)).toEqual(["script", "claude-code"]);
    for (const backend of backends) {
      for (const capability of Object.values(backend.capabilities)) expect(capability.guarantee.length).toBeGreaterThan(0);
      // No adapter claims a sandbox it does not enforce.
      expect(backend.capabilities.sandbox!.supported).toBe(false);
    }
  });
});
