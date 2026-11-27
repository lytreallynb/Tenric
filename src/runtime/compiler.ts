// Contract compiler (RFC-0001 section 4). Deterministic: the same task,
// contract, schema and backend description give the same plan, byte for byte.
// It resolves and pins the contract, checks applicability before anything is
// spent, partitions requirements by who can supply them, plans the validators
// and predicts the best reachable verdict, and derives the producer's
// instructions from that partition. It does not call a model.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPLEMENTED_CHECK_KINDS } from "../checks.ts";
import { loadRegisteredContract, REPO_ROOT, type Contract, type Requirement } from "../spec.ts";
import type { BackendDescription, Capability } from "./backends.ts";
import { TASK_SCHEMA_VERSION, validateTask, type Task } from "./schemas.ts";
import { readJson, sha256File } from "./util.ts";

/** Compilation could not start or finish. No run happens and no verdict is issued (RFC-0001 section 7.2 rule 6). */
export class PreconditionError extends Error {}

export type Supplier = "producer" | "collector" | "empirical" | "human" | "unclassified";
export interface PlannedRequirement {
  id: string;
  title: string;
  level: "mandatory" | "advisory";
  verifiability: string;
  kind: string;
  supplied_by: Supplier;
  producer_obligations: string[];
  validator: { available: boolean; order: number };
}
export interface Plan {
  plan_schema: "0.1.0";
  task: { id: string; title: string; sha256: string; data_class: "measured" | "fixture" };
  contract: {
    id: string; version: string; path: string; sha256: string; registry_path: string; registry_sha256: string;
    artifact_type: string; ir_version: string; schema_path: string; schema_sha256: string;
  };
  backend: { name: string; kind: string; capabilities: Record<string, Capability> };
  applicability: { required: string[]; provided: Record<string, "runtime" | "backend">; missing: string[] };
  requirements: PlannedRequirement[];
  /** What can be known before anything runs. known_failures are mandatory requirements this task cannot pass, whatever the backend does. */
  predicted: { best_verdict: "accepted" | "inconclusive" | "rejected"; blocking_unavailable: string[]; known_failures: string[] };
  review_checklist: { requirement: string; question: string }[];
  warnings: string[];
  instructions: string;
  limits: { backend_timeout_seconds: number; backend_max_cost_usd: number; execution_timeout_seconds: number };
}

/** What the runtime itself provides, whatever the backend is. */
const RUNTIME_CAPABILITIES = ["independent-collector", "content-hashing"];
const DEFAULT_LIMITS = { backend_timeout_seconds: 1200, backend_max_cost_usd: 10, execution_timeout_seconds: 300 };

/**
 * Who can supply what each check kind looks at, and what that asks of the
 * producer. The producer is told only about obligations it can act on; what
 * the collector observes is never requested from it.
 */
const KINDS: Record<string, { supplied_by: Supplier; obligations: string[] | ((params: Record<string, unknown>) => string[]) }> = {
  "artifact-schema": { supplied_by: "collector", obligations: [] },
  "required-content": {
    supplied_by: "producer",
    obligations: (params) => [
      `Declare at least ${String(params.min_metrics ?? 1)} metric(s) and at least ${String(params.min_findings ?? 1)} finding(s) in claims.json. A deliverable with nothing in it is refused.`,
    ],
  },
  "internal-consistency": {
    supplied_by: "producer",
    obligations: ["Metric names, figure ids and finding ids must each be unique, and every figure must name files the experiment really writes."],
  },
  "output-integrity": { supplied_by: "collector", obligations: [] },
  "collector-provenance": { supplied_by: "collector", obligations: [] },
  "source-pinned": {
    supplied_by: "collector",
    obligations: ["The experiment must not create, change or delete any file in the workspace when it runs. It writes only under the directory given by --out."],
  },
  "metric-traceability": {
    supplied_by: "producer",
    obligations: ["Every metric you declare in claims.json must be a number at the stated JSON Pointer in metrics.json. Do not write metric values anywhere else."],
  },
  "execution-succeeded": {
    supplied_by: "producer",
    obligations: ["experiment.py must exit with status 0 when it succeeds and non-zero when anything goes wrong. Do not catch an error and exit 0."],
  },
  "finding-references": {
    supplied_by: "producer",
    obligations: ["Every entry of supported_by in a finding must name something that exists: metric:<name> for a declared metric, figure:<id> for a declared figure, or output:<path> for a file the experiment writes."],
  },
  "numeric-reproduction": {
    supplied_by: "empirical",
    obligations: (params) => {
      const rules = Array.isArray(params.metric_rules) ? (params.metric_rules as { pattern?: unknown; abs_tolerance?: unknown; rel_tolerance?: unknown }[]) : [];
      const allowed = rules.map((rule) => rule.rel_tolerance !== undefined
        ? `a metric whose name matches \`${String(rule.pattern)}\` may differ by up to ${String(rule.rel_tolerance)} times the larger of the two values`
        : `a metric whose name matches \`${String(rule.pattern)}\` may differ by up to ${String(rule.abs_tolerance)}`);
      return [
        "The verifier executes the experiment again from the committed workspace and compares. Fix every source of randomness with the seed in config.json.",
        allowed.length > 0
          ? `In an equal environment every declared metric must come out exactly equal, with these exceptions: ${allowed.join("; ")}. A quantity that varies between executions must be declared under a name that matches one of these patterns and only if it is that kind of quantity; a varying quantity that fits no pattern (for example a ratio of two timings) must not be declared as a metric, though it may stay in metrics.json and in a figure.`
          : "In an equal environment every declared metric must come out exactly equal; this contract makes no exception. If the task asks for a quantity that varies between executions by nature, declare it anyway and say so under limitations: this requirement will then fail, which is the correct outcome under this contract and must not be hidden by leaving the quantity out.",
        "Declare in claims.json outputs[] any file that legitimately differs between two executions as numeric-tolerance or volatile. An undeclared metrics.json or figure is expected to be byte-identical, and so is every file you declare byte-identical.",
      ];
    },
  },
  "human-review": {
    supplied_by: "human",
    obligations: ["A person will read your findings and limitations against the evidence. State only what the metrics and figures support, and state at least one real limitation."],
  },
};

function resolveContract(task: Task, repoRoot: string): Plan["contract"] & { loaded: Contract; requires: string[] } {
  const path = `spec/contracts/${task.contract.id}/${task.contract.version}.contract.json`;
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(task.contract.id) || !existsSync(join(repoRoot, path))) {
    throw new PreconditionError(`no contract ${task.contract.id} version ${task.contract.version} (looked for ${path})`);
  }
  // The registry binds id and version to content: a file that keeps a contract's name and changes its requirements is refused here.
  const registry_path = "spec/contracts/registry.json";
  let loaded: Contract;
  let sha256: string;
  let registry_sha256: string;
  try {
    const bound = loadRegisteredContract(join(repoRoot, path), join(repoRoot, registry_path));
    [loaded, sha256, registry_sha256] = [bound.contract, bound.sha256, bound.registry.sha256];
  } catch (error) {
    throw new PreconditionError(`cannot use contract ${path}: ${(error as Error).message}`);
  }
  if (loaded.id !== task.contract.id || loaded.version !== task.contract.version) {
    throw new PreconditionError(`${path} declares ${loaded.id} version ${loaded.version}, not what its path says`);
  }
  const raw = readJson(join(repoRoot, path)) as {
    artifact: { type: string; ir_version: string; schema: string; schema_sha256?: string };
    applicability?: { requires_capabilities?: string[] };
  };
  if (raw.artifact.type !== "research.experiment-report") {
    throw new PreconditionError(`the runtime has no collector for artifact type ${raw.artifact.type}`);
  }
  const schemaFile = join(repoRoot, raw.artifact.schema);
  if (!existsSync(schemaFile)) throw new PreconditionError(`artifact schema ${raw.artifact.schema} does not exist`);
  const schema_sha256 = sha256File(schemaFile);
  if (raw.artifact.schema_sha256 !== undefined && raw.artifact.schema_sha256 !== schema_sha256) {
    throw new PreconditionError(`artifact schema ${raw.artifact.schema} does not match the digest pinned in the contract`);
  }
  return {
    id: loaded.id, version: loaded.version, path, sha256, registry_path, registry_sha256,
    artifact_type: raw.artifact.type, ir_version: raw.artifact.ir_version, schema_path: raw.artifact.schema, schema_sha256,
    loaded, requires: raw.applicability?.requires_capabilities ?? [],
  };
}

function lockedPackages(repoRoot: string): string[] {
  const text = readFileSync(join(repoRoot, "pyproject.toml"), "utf8");
  const block = /^dependencies\s*=\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? "";
  return [...block.matchAll(/"([A-Za-z0-9_.-]+)/g)].map((match) => match[1]!).sort();
}

function instructions(task: Task, contract: Plan["contract"], requirements: PlannedRequirement[], packages: string[], limits: Plan["limits"]): string {
  const obligations = requirements.flatMap((r) => r.producer_obligations.map((text) => `- ${text} (${r.id}, ${r.level})`));
  return [
    `# Task: ${task.title}`,
    "",
    `Task id \`${task.id}\`. To be delivered under contract \`${contract.id}\` version \`${contract.version}\`.`,
    "",
    "## What to investigate",
    "",
    task.brief ?? "(This task has no prose brief. It names a producer written in advance.)",
    "",
    "## How your work is judged",
    "",
    "You are the producer. You write an experiment program and a claims file. You do not write the report, and nothing you say about your own work counts as evidence.",
    "After you finish, the Tenric runtime commits this workspace, executes your experiment itself, hashes what it writes, reads the metric values out of the hashed files, assembles the report and has it verified against the contract. Runs you make yourself are for your own checking only.",
    "",
    "## Files to write in this directory",
    "",
    "1. `experiment.py`. It is executed as `python experiment.py --config config.json --out <directory>` with this directory as the working directory. It must write `<directory>/metrics.json` (a JSON object) and may write other files under `<directory>`, for example `figures/<id>.spec.json` (the data and settings of a figure) and `figures/<id>.png` (the figure rendered from that specification only).",
    "2. `config.json`. A JSON object with every parameter of the experiment, including an integer `seed` (or `\"seed\": null` if nothing is random). `experiment.py` must read its parameters from the file given by --config.",
    "3. `claims.json`. It must conform to `claims.schema.json` in this directory: the dataset and where its bytes are, the metrics as JSON Pointers into metrics.json, the figures, at least one finding and at least one limitation.",
    "",
    "## Rules that follow from the contract",
    "",
    ...obligations,
    "- In a finding, never type a number that comes from a metric. Write a slot instead: `{{metric:<name>}}`, or `{{metric:<name>:<decimals>}}` for fixed decimals. The runtime fills slots from the hashed metrics file.",
    "- Do not write `artifact.json` or `report.md`, and do not put provenance, digests, exit codes or metric values in claims.json. The schema has no place for them and extra fields are refused.",
    "- If the experiment generates its own data, it must write the data to a file under --out and claims.json must point to it with `output:<path>`.",
    "",
    "## Environment",
    "",
    `- Python with the standard library and these locked packages (plus their dependencies): ${packages.join(", ") || "none"}. Nothing else can be installed and there is no network.`,
    "- CPU only. The runtime pins PYTHONHASHSEED=0, single-threaded BLAS, MPLBACKEND=Agg, TZ=UTC.",
    `- The runtime stops the experiment after ${limits.execution_timeout_seconds} seconds. Keep it well under that.`,
    "",
    "When the three files are written and `experiment.py` runs cleanly, stop. A short final message is enough.",
    "",
  ].join("\n");
}

export interface CompileOptions {
  taskPath: string;
  backend: BackendDescription;
  /** Where spec/ and pyproject.toml are. Defaults to this repository. Tests point it at a copy. */
  repoRoot?: string;
}

export function compile(options: CompileOptions): { plan: Plan; task: Task; contract: Contract } {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  let raw: unknown;
  try {
    raw = readJson(options.taskPath);
  } catch (error) {
    throw new PreconditionError(`cannot read task ${options.taskPath}: ${(error as Error).message}`);
  }
  const version = (raw as { runtime_task_schema?: unknown } | null)?.runtime_task_schema;
  if (version !== TASK_SCHEMA_VERSION) throw new PreconditionError(`unsupported task schema version: ${JSON.stringify(version)}`);
  if (!validateTask(raw)) throw new PreconditionError(`invalid task: ${JSON.stringify(validateTask.errors)}`);
  const task = raw as Task;
  const data_class = task.data_class ?? "measured";
  if (data_class === "fixture" && !/fixture/i.test(task.title)) {
    throw new PreconditionError("a fixture task must say so in its title");
  }

  const { loaded, requires, ...contract } = resolveContract(task, repoRoot);
  const backend = options.backend;

  // Applicability: decided before the backend is started, so an unenforceable contract costs nothing.
  const provided: Record<string, "runtime" | "backend"> = {};
  for (const name of RUNTIME_CAPABILITIES) provided[name] = "runtime";
  for (const [name, capability] of Object.entries(backend.capabilities)) if (capability.supported) provided[name] ??= "backend";
  const required = [...new Set([...requires, "workspace-authoring"])].sort();
  const missing = required.filter((name) => !(name in provided));
  if (missing.length > 0) {
    throw new PreconditionError(`contract ${contract.id} ${contract.version} is not enforceable with backend ${backend.name}: missing ${missing.join(", ")}`);
  }
  if (backend.kind === "agent" && !task.brief) throw new PreconditionError(`backend ${backend.name} needs a task with a brief`);
  if (backend.kind === "agent" && !("task-brief" in provided)) throw new PreconditionError(`backend ${backend.name} cannot take a brief`);
  if (backend.kind === "script" && !task.script_producer) throw new PreconditionError(`backend ${backend.name} needs a task with a script_producer`);

  // Asked of the verifier, not kept as a second list that could drift. The runtime always requests a re-execution.
  const available = new Set(IMPLEMENTED_CHECK_KINDS);
  const known_failures: string[] = [];
  const warnings: string[] = [];
  // Structure first: every other validator reads the structure that artifact-schema establishes.
  const ordered = [...loaded.requirements].sort((a, b) => Number(b.check.kind === "artifact-schema") - Number(a.check.kind === "artifact-schema"));
  const order = new Map(ordered.map((requirement, index) => [requirement.id, index + 1]));
  const requirements = loaded.requirements.map((requirement): PlannedRequirement => {
    const kind = KINDS[requirement.check.kind];
    if (!kind) warnings.push(`${requirement.id}: the compiler does not know check kind ${requirement.check.kind}; the producer gets no instruction for it`);
    return {
      id: requirement.id, title: requirement.title, level: requirement.level, verifiability: requirement.verifiability,
      kind: requirement.check.kind,
      supplied_by: kind?.supplied_by ?? "unclassified",
      producer_obligations: typeof kind?.obligations === "function" ? kind.obligations(requirement.check.params ?? {}) : kind?.obligations ?? [],
      validator: { available: available.has(requirement.check.kind), order: order.get(requirement.id)! },
    };
  });
  for (const requirement of loaded.requirements as Requirement[]) {
    // Decidable from the task alone: a contract that demands a measurement cannot accept a fixture.
    const demanded = requirement.check.kind === "required-content" ? requirement.check.params?.data_class : undefined;
    if (requirement.level === "mandatory" && typeof demanded === "string" && demanded !== data_class) {
      known_failures.push(`${requirement.id}: the contract requires data_class ${demanded}, the task is ${data_class}`);
    }
  }
  const blocking_unavailable = requirements.filter((r) => r.level === "mandatory" && !r.validator.available).map((r) => r.id);
  const limits = { ...DEFAULT_LIMITS, ...task.limits };

  const plan: Plan = {
    plan_schema: "0.1.0",
    task: { id: task.id, title: task.title, sha256: sha256File(options.taskPath), data_class },
    contract,
    backend: { name: backend.name, kind: backend.kind, capabilities: backend.capabilities },
    applicability: { required, provided, missing },
    requirements,
    predicted: {
      best_verdict: known_failures.length > 0 ? "rejected" : blocking_unavailable.length === 0 ? "accepted" : "inconclusive",
      blocking_unavailable, known_failures,
    },
    review_checklist: requirements.filter((r) => r.supplied_by === "human").map((r) => ({ requirement: r.id, question: r.title })),
    warnings,
    instructions: instructions(task, contract, requirements, lockedPackages(repoRoot), limits),
    limits,
  };
  return { plan, task, contract: loaded };
}
