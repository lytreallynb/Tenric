// Bootstrap validators for three of the nine requirement kinds in the first
// contract. They exist to prove the specifications are checkable against a
// real run; the Verification Engine proper is Phase 1 work.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, validateArtifact, type Contract } from "./spec.ts";
import type { CheckResult } from "./verdict.ts";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface Output { path: string; bytes: number; sha256: string }
interface Metric { name: string; value: number; source_output: string; json_pointer: string }
interface Artifact { outputs: Output[]; metrics: Metric[] }

function resolvePointer(document: unknown, pointer: string): unknown {
  let node = document;
  for (const token of pointer.split("/").slice(1)) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object" || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

type Check = (artifact: Artifact, dir: string) => string[];

const implemented: Record<string, Check> = {
  "output-integrity": (artifact, dir) => {
    const problems: string[] = [];
    for (const output of artifact.outputs) {
      const path = join(dir, output.path);
      if (!existsSync(path)) problems.push(`${output.path}: missing`);
      else if (statSync(path).size !== output.bytes) problems.push(`${output.path}: size differs`);
      else if (sha256File(path) !== output.sha256) problems.push(`${output.path}: sha256 differs`);
    }
    return problems;
  },
  "metric-traceability": (artifact, dir) => {
    const hashed = new Set(artifact.outputs.map((o) => o.path));
    const problems: string[] = [];
    for (const metric of artifact.metrics) {
      if (!hashed.has(metric.source_output)) {
        problems.push(`${metric.name}: source ${metric.source_output} is not a hashed output`);
        continue;
      }
      const actual = resolvePointer(readJson(join(dir, metric.source_output)), metric.json_pointer);
      // Exact equality on purpose: the value must be copied, not re-derived or rounded.
      if (actual !== metric.value) problems.push(`${metric.name}: artifact says ${metric.value}, source says ${String(actual)}`);
    }
    return problems;
  },
};

/** Runs every requirement of the contract; kinds without a validator are reported as not_run, never skipped. */
export function runChecks(contract: Contract, dir: string): CheckResult[] {
  let artifact: unknown;
  let schemaResult: CheckResult;
  try {
    artifact = readJson(join(dir, "artifact.json"));
    schemaResult = validateArtifact(artifact)
      ? { requirement: "", status: "pass" }
      : { requirement: "", status: "fail", detail: JSON.stringify(validateArtifact.errors) };
  } catch (error) {
    schemaResult = { requirement: "", status: "fail", detail: `artifact.json unreadable: ${String(error)}` };
  }
  const structurallyValid = schemaResult.status === "pass";

  return contract.requirements.map((requirement): CheckResult => {
    const { kind } = requirement.check;
    if (kind === "artifact-schema") return { ...schemaResult, requirement: requirement.id };
    const check = implemented[kind];
    if (!check) return { requirement: requirement.id, status: "not_run", detail: `no validator for ${kind} yet` };
    // Other validators assume the structure they read; without it they cannot decide.
    if (!structurallyValid) return { requirement: requirement.id, status: "error", detail: "artifact is not structurally valid" };
    try {
      const problems = check(artifact as Artifact, dir);
      return problems.length === 0
        ? { requirement: requirement.id, status: "pass" }
        : { requirement: requirement.id, status: "fail", detail: problems.join("; ") };
    } catch (error) {
      return { requirement: requirement.id, status: "error", detail: String(error) };
    }
  });
}
