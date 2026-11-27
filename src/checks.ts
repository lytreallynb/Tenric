// Validators for the requirement kinds of the research.experiment-report
// contracts. human-review has no validator and is reported as not_run;
// numeric-reproduction runs only when a re-execution is requested.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { ATTESTATION_PATH, checkAttestation, type Collectors } from "./attestation.ts";
import { CannotReExecute, loadTask, NotReproducible, reExecute } from "./reproduce.ts";
import { readJson, sha256File, validateArtifact, type Contract } from "./spec.ts";
import type { CheckResult } from "./verdict.ts";

export { sha256File };

interface Output { path: string; role: string; bytes: number; sha256: string; determinism: string }
interface Metric { name: string; value: number; source_output: string; json_pointer: string }
interface Artifact {
  ir_version: string;
  artifact_type: string;
  experiment_id: string;
  data_class: string;
  environment: { os: string; arch: string; python: string; python_implementation?: string; packages: Record<string, string>; lockfile: { sha256: string } };
  config: { path: string; sha256: string };
  source: { kind: "git" | "snapshot" | "none"; revision?: string; dirty?: boolean };
  execution: { status: string; exit_code: number | null };
  outputs: Output[];
  metrics: Metric[];
  figures: { id: string; spec_output: string; image_output: string }[];
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
  /** Re-execute the task for numeric-reproduction. Without it that requirement is not_run. */
  reproduce?: { taskPath: string };
  /** The keys the operator trusts, for collector-attestation. Without them that requirement cannot be decided. */
  collectors?: Collectors;
  /** SHA-256 of the contract file being applied; an attestation must name it. */
  contractSha256?: string;
}
interface Context {
  dir: string; repo: string; params: Record<string, unknown>; reproduce?: { taskPath: string };
  collectors?: Collectors; contract: Contract; contractSha256?: string;
}
/** Returns the problems found, optionally with a note for the report. Throws when it cannot decide, which is reported as error. */
type Check = (artifact: Artifact, context: Context) => string[] | { problems: string[]; note: string };

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

interface MetricRule { pattern: string; abs_tolerance?: number; rel_tolerance?: number }

/** Opt-in tolerances for named metrics, declared in the contract. A metric no rule matches is compared exactly. */
function metricRules(params: Record<string, unknown>): MetricRule[] {
  const rules = params.metric_rules;
  if (rules === undefined) return [];
  const usable = Array.isArray(rules) && rules.every((rule) => {
    if (rule === null || typeof rule !== "object") return false;
    const { pattern, abs_tolerance, rel_tolerance, ...unknown } = rule as Record<string, unknown>;
    const bound = (value: unknown) => typeof value === "number" && value >= 0 && Number.isFinite(value);
    return typeof pattern === "string" && pattern.length > 0 && Object.keys(unknown).length === 0 &&
      (abs_tolerance === undefined) !== (rel_tolerance === undefined) && bound(abs_tolerance ?? rel_tolerance);
  });
  if (!usable) throw new Error("contract gives unusable metric_rules: each needs a pattern and exactly one of abs_tolerance, rel_tolerance");
  return rules as MetricRule[];
}
function matches(pattern: string, name: string): boolean {
  const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${escaped}$`).test(name);
}
function within(rule: MetricRule, a: number, b: number): boolean {
  const difference = Math.abs(a - b);
  return rule.abs_tolerance !== undefined ? difference <= rule.abs_tolerance : difference <= rule.rel_tolerance! * Math.max(Math.abs(a), Math.abs(b));
}

function sourcePinnedProblems({ source }: Artifact, repo: string): string[] {
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
}

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
  "source-pinned": (artifact, { repo }) => sourcePinnedProblems(artifact, repo),
  "finding-references": (artifact) => {
    const known = new Set([
      ...artifact.metrics.map((m) => `metric:${m.name}`),
      ...artifact.figures.map((f) => `figure:${f.id}`),
      ...artifact.outputs.map((o) => `output:${o.path}`),
    ]);
    return artifact.findings.flatMap((finding) =>
      finding.supported_by.filter((ref) => !known.has(ref)).map((ref) => `${finding.id}: ${ref} is not in the artifact`));
  },
  // Without this, "every listed X is fine" passes vacuously for an artifact that lists nothing.
  "required-content": (artifact, { params }) => {
    const { data_class, output_roles, min_metrics, min_findings } = params as {
      data_class?: unknown; output_roles?: unknown; min_metrics?: unknown; min_findings?: unknown;
    };
    if (typeof data_class !== "string" || !Array.isArray(output_roles) || typeof min_metrics !== "number" || typeof min_findings !== "number") {
      throw new Error("contract gives no usable data_class, output_roles, min_metrics and min_findings");
    }
    const problems: string[] = [];
    if (artifact.data_class !== data_class) problems.push(`data_class is ${JSON.stringify(artifact.data_class)}, the contract requires ${JSON.stringify(data_class)}`);
    for (const role of output_roles as string[]) {
      if (!artifact.outputs.some((o) => o.role === role)) problems.push(`no output with role ${role}`);
    }
    if (artifact.metrics.length < min_metrics) problems.push(`${artifact.metrics.length} metrics, at least ${min_metrics} required`);
    if (artifact.findings.length < min_findings) problems.push(`${artifact.findings.length} findings, at least ${min_findings} required`);
    return problems;
  },
  "collector-attestation": (artifact, { dir, collectors, contract, contractSha256 }) => {
    if (!collectors) throw new Error("no collectors file was given, so no key can be trusted");
    if (!contractSha256) throw new Error("the contract's digest was not given");
    const { problems, collector } = checkAttestation(join(dir, ATTESTATION_PATH), collectors, {
      artifactSha256: sha256File(join(dir, "artifact.json")),
      sourceRevision: artifact.source.revision,
      contract: { id: contract.id, version: contract.version, sha256: contractSha256 },
    });
    return problems.length > 0 ? problems : { problems, note: `attested by collector ${collector!.id} (key ${collector!.key_id.slice(0, 16)}…; custody: ${collector!.custody})` };
  },
  "internal-consistency": (artifact) => {
    const listed = new Set(artifact.outputs.map((o) => o.path));
    const problems = [
      ...duplicates(artifact.metrics.map((m) => m.name)).map((name) => `metric name ${name} is used more than once`),
      ...duplicates(artifact.outputs.map((o) => o.path)).map((path) => `output ${path} is listed more than once`),
      ...duplicates(artifact.figures.map((f) => f.id)).map((id) => `figure id ${id} is used more than once`),
      ...duplicates(artifact.findings.map((f) => f.id)).map((id) => `finding id ${id} is used more than once`),
    ];
    for (const figure of artifact.figures) {
      for (const path of [figure.spec_output, figure.image_output]) {
        if (!listed.has(path)) problems.push(`figure ${figure.id}: ${path} is not a listed output`);
      }
    }
    return problems;
  },
  "numeric-reproduction": (artifact, { dir, repo, params, reproduce }) => {
    const tolerance = params.cross_platform_abs_tolerance;
    if (typeof tolerance !== "number" || !(tolerance >= 0)) throw new Error("contract gives no cross_platform_abs_tolerance");
    const rules = metricRules(params);
    if (params.same_environment !== "byte-identical") throw new Error(`unsupported same_environment rule ${JSON.stringify(params.same_environment)}`);
    // Dependent validators do not guess (RFC-0001 section 7.2 rule 7): there is nothing to repeat
    // unless the run succeeded and names the source it ran from.
    if (artifact.execution.status !== "succeeded") throw new Error("nothing to reproduce: the recorded execution did not succeed");
    const unpinned = sourcePinnedProblems(artifact, repo);
    if (unpinned.length > 0) throw new Error(`nothing to re-execute from: ${unpinned.join("; ")}`);

    const task = loadTask(reproduce!.taskPath);
    if (task.experiment_id !== artifact.experiment_id) throw new Error(`the task file is for ${task.experiment_id}, the artifact is for ${artifact.experiment_id}`);
    let again;
    try {
      again = reExecute(repo, artifact.source.revision!, artifact.config, reproduce!.taskPath);
    } catch (error) {
      if (error instanceof NotReproducible) return [error.message];
      throw error;
    }
    const redone = again.artifact as Artifact;
    if (redone.experiment_id !== artifact.experiment_id) throw new Error(`the task re-executed ${redone.experiment_id}, the artifact is for ${artifact.experiment_id}`);
    if (redone.execution?.status !== "succeeded") return [`re-execution ended with status ${redone.execution?.status}`];

    const environment = (a: Artifact) => JSON.stringify([
      a.environment.os, a.environment.arch, a.environment.python, a.environment.python_implementation,
      Object.entries(a.environment.packages).sort(), a.environment.lockfile.sha256,
    ]);
    const sameEnvironment = environment(artifact) === environment(redone);
    const problems: string[] = [];

    const tolerated: string[] = [];
    const reported = new Map(artifact.metrics.map((m) => [m.name, m.value]));
    const reproduced = new Map(redone.metrics.map((m) => [m.name, m.value]));
    for (const name of new Set([...reported.keys(), ...reproduced.keys()])) {
      const a = reported.get(name);
      const b = reproduced.get(name);
      if (a === undefined) problems.push(`metric ${name}: produced by the re-execution, missing from the artifact`);
      else if (b === undefined) problems.push(`metric ${name}: reported by the artifact, not produced by the re-execution`);
      else {
        const rule = rules.find((r) => matches(r.pattern, name));
        if (rule) {
          tolerated.push(name);
          if (!within(rule, a, b)) problems.push(`metric ${name}: artifact reports ${a}, re-execution gives ${b} (contract rule ${JSON.stringify(rule)})`);
        } else if (sameEnvironment ? a !== b : !(Math.abs(a - b) <= tolerance)) {
          problems.push(`metric ${name}: artifact reports ${a}, re-execution gives ${b}` + (sameEnvironment ? "" : ` (tolerance ${tolerance})`));
        }
      }
    }

    let compared = 0;
    if (sameEnvironment) {
      // An output counts as byte-identical if either side declares it, so a declaration cannot be downgraded to dodge the comparison.
      const declared = new Set([...artifact.outputs, ...redone.outputs].filter((o) => o.determinism === "byte-identical").map((o) => o.path));
      for (const path of declared) {
        const mine = join(dir, path);
        const theirs = join(again.dir, path);
        if (!existsSync(theirs)) problems.push(`${path}: not produced by the re-execution`);
        else if (!existsSync(mine) || !staysInside(dir, mine)) problems.push(`${path}: not present in the run directory`);
        else if (sha256File(mine) !== sha256File(theirs)) problems.push(`${path}: bytes differ from the re-execution`);
        compared += 1;
      }
    }
    const note = sameEnvironment
      ? `re-executed revision ${artifact.source.revision} in an equal environment: ${reported.size} metrics equal, ${compared} outputs byte-identical`
      : `re-executed revision ${artifact.source.revision} in a different environment (${redone.environment.os} ${redone.environment.arch}, Python ${redone.environment.python}): ` +
        `${reported.size} metrics within ${tolerance}; byte identity not compared`;
    const byRule = tolerated.length > 0 ? `; compared within a contract tolerance instead of exactly: ${tolerated.sort().join(", ")}` : "";
    return { problems, note: note + byRule };
  },
};

/** The check kinds this verifier has a validator for. Any other kind in a contract is reported as not_run. */
export const IMPLEMENTED_CHECK_KINDS: readonly string[] = ["artifact-schema", ...Object.keys(implemented)];

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
  // The contract says which artifact type and IR version it governs; another kind of artifact is not what it asks for.
  const governed = contract.artifact;
  const actual = artifact as { artifact_type?: unknown; ir_version?: unknown } | undefined;
  if (schemaResult.status === "pass" && governed && (actual?.artifact_type !== governed.type || actual?.ir_version !== governed.ir_version)) {
    schemaResult = {
      requirement: "", status: "fail",
      detail: `artifact is ${String(actual?.artifact_type)} IR ${String(actual?.ir_version)}, the contract governs ${governed.type} IR ${governed.ir_version}`,
    };
  }
  const structurallyValid = schemaResult.status === "pass";

  return contract.requirements.map((requirement): CheckResult => {
    const { kind } = requirement.check;
    if (kind === "artifact-schema") return { ...schemaResult, requirement: requirement.id };
    const check = implemented[kind];
    if (!check) return { requirement: requirement.id, status: "not_run", detail: `no validator for ${kind} yet` };
    if (kind === "numeric-reproduction" && !options.reproduce) {
      return { requirement: requirement.id, status: "not_run", detail: "re-execution was not requested" };
    }
    // Other validators assume the structure they read; without it they cannot decide.
    if (!structurallyValid) return { requirement: requirement.id, status: "error", detail: "artifact is not structurally valid" };
    try {
      const context = {
        dir, repo: options.repo ?? dir, params: requirement.check.params ?? {}, reproduce: options.reproduce,
        collectors: options.collectors, contract, contractSha256: options.contractSha256,
      };
      const outcome = check(artifact as Artifact, context);
      const { problems, note } = Array.isArray(outcome) ? { problems: outcome, note: undefined } : outcome;
      if (problems.length > 0) return { requirement: requirement.id, status: "fail", detail: problems.join("; ") };
      return note ? { requirement: requirement.id, status: "pass", detail: note } : { requirement: requirement.id, status: "pass" };
    } catch (error) {
      return { requirement: requirement.id, status: "error", detail: error instanceof CannotReExecute ? error.message : String(error) };
    }
  });
}
