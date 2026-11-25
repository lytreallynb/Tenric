// Validators for the seven machine-checkable requirement kinds in the first
// contract. numeric-reproduction (empirical) and human-review have no
// validator here and are reported as not_run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { readJson, validateArtifact, type Contract } from "./spec.ts";
import type { CheckResult } from "./verdict.ts";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface Output { path: string; bytes: number; sha256: string }
interface Metric { name: string; value: number; source_output: string; json_pointer: string }
interface Artifact {
  source: { kind: "git" | "snapshot" | "none"; revision?: string; dirty?: boolean };
  execution: { status: string; exit_code: number | null };
  outputs: Output[];
  metrics: Metric[];
  figures: { id: string }[];
  findings: { id: string; supported_by: string[] }[];
}

function resolvePointer(document: unknown, pointer: string): unknown {
  let node = document;
  for (const token of pointer.split("/").slice(1)) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object" || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** True when the path, with symlinks resolved, is still inside the run directory. */
function staysInside(dir: string, path: string): boolean {
  return realpathSync(path).startsWith(realpathSync(dir) + sep);
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface CheckOptions {
  /** Repository the artifact's source revision must exist in. Defaults to the one containing the run directory. */
  repo?: string;
}
interface Context { dir: string; repo: string; params: Record<string, unknown> }
/** Returns the problems found. Throws when it cannot decide, which is reported as error. */
type Check = (artifact: Artifact, context: Context) => string[];

const implemented: Record<string, Check> = {
  "output-integrity": (artifact, { dir }) => {
    const problems: string[] = [];
    for (const output of artifact.outputs) {
      const path = join(dir, output.path);
      if (!existsSync(path)) problems.push(`${output.path}: missing`);
      else if (!staysInside(dir, path)) problems.push(`${output.path}: resolves outside the run directory`);
      else if (statSync(path).size !== output.bytes) problems.push(`${output.path}: size differs`);
      else if (sha256File(path) !== output.sha256) problems.push(`${output.path}: sha256 differs`);
    }
    return problems;
  },
  "metric-traceability": (artifact, { dir }) => {
    const hashed = new Set(artifact.outputs.map((o) => o.path));
    const problems: string[] = [];
    for (const metric of artifact.metrics) {
      if (!hashed.has(metric.source_output)) {
        problems.push(`${metric.name}: source ${metric.source_output} is not a hashed output`);
        continue;
      }
      if (!staysInside(dir, join(dir, metric.source_output))) {
        problems.push(`${metric.name}: source ${metric.source_output} resolves outside the run directory`);
        continue;
      }
      const actual = resolvePointer(readJson(join(dir, metric.source_output)), metric.json_pointer);
      // Exact equality on purpose: the value must be copied, not re-derived or rounded.
      if (actual !== metric.value) problems.push(`${metric.name}: artifact says ${metric.value}, source says ${String(actual)}`);
    }
    return problems;
  },
  "collector-provenance": (artifact, { params }) => {
    const sections = params.sections;
    if (!Array.isArray(sections) || sections.length === 0) throw new Error("contract gives no sections to check");
    const problems: string[] = [];
    for (const section of sections as string[]) {
      const record = (artifact as unknown as Record<string, unknown>)[section];
      if (record === null || typeof record !== "object") throw new Error(`artifact has no section ${section}`);
      const entries = Array.isArray(record) ? record.map((entry, i) => [`${section}[${i}]`, entry] as const) : [[section, record] as const];
      for (const [label, entry] of entries) {
        const provenance = (entry as { provenance?: unknown } | null)?.provenance;
        if (provenance !== "collector") problems.push(`${label}: provenance is ${JSON.stringify(provenance)}, not "collector"`);
      }
    }
    return problems;
  },
  "execution-succeeded": ({ execution }) =>
    execution.status === "succeeded" && execution.exit_code === 0
      ? []
      : [`execution status is ${execution.status}, exit code ${String(execution.exit_code)}`],
  "source-pinned": ({ source }, { repo }) => {
    if (source.kind === "none") return ["source is not pinned to anything"];
    // IR 0.1.0 records a snapshot digest but not where the snapshot is, so it cannot be re-hashed.
    if (source.kind === "snapshot") throw new Error("snapshot sources cannot be checked yet");
    if (source.dirty !== false) return ["working tree was dirty when the run was collected"];
    git(repo, "rev-parse", "--git-dir"); // throws, hence error, when there is no repository to check against
    let type: string;
    try {
      type = git(repo, "cat-file", "-t", source.revision!);
    } catch {
      return [`revision ${source.revision} does not exist in the repository being verified`];
    }
    return type === "commit" ? [] : [`revision ${source.revision} is a ${type}, not a commit`];
  },
  "finding-references": (artifact) => {
    const known = new Set([
      ...artifact.metrics.map((m) => `metric:${m.name}`),
      ...artifact.figures.map((f) => `figure:${f.id}`),
      ...artifact.outputs.map((o) => `output:${o.path}`),
    ]);
    return artifact.findings.flatMap((finding) =>
      finding.supported_by.filter((ref) => !known.has(ref)).map((ref) => `${finding.id}: ${ref} is not in the artifact`));
  },
};

/** Runs every requirement of the contract; kinds without a validator are reported as not_run, never skipped. */
export function runChecks(contract: Contract, dir: string, options: CheckOptions = {}): CheckResult[] {
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
      const context = { dir, repo: options.repo ?? dir, params: requirement.check.params ?? {} };
      const problems = check(artifact as Artifact, context);
      return problems.length === 0
        ? { requirement: requirement.id, status: "pass" }
        : { requirement: requirement.id, status: "fail", detail: problems.join("; ") };
    } catch (error) {
      return { requirement: requirement.id, status: "error", detail: String(error) };
    }
  });
}
