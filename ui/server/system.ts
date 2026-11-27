// What exists in this checkout, found by looking, not by assertion. A
// component is reported as available only when the file or command that
// provides it is present and answers; otherwise the interface says so.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { readJson, repoRevision, REPO_ROOT } from "./core.ts";
import { reproductionTasks } from "./data.ts";
import { listContracts, listRuns } from "./data.ts";

const run = promisify(execFile);

/** Entry point of the runtime command line, per docs/runtime-interface.md. Absent until that slice lands. */
export const RUNTIME_CLI = "src/tenric.ts";
export function runtimeAvailable(): boolean {
  return existsSync(join(REPO_ROOT, RUNTIME_CLI));
}

export async function runtimeJson(args: string[], timeoutMs = 20_000): Promise<unknown> {
  const { stdout } = await run(process.execPath, [RUNTIME_CLI, ...args, "--json"], { cwd: REPO_ROOT, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export interface Backend {
  name: string;
  kind: string;
  /** Can be started from this interface in this checkout. */
  available: boolean;
  note?: string;
  capabilities?: Record<string, unknown>;
}

export async function listBackends(): Promise<{ backends: Backend[]; runtime: boolean; error?: string }> {
  const builtin: Backend = {
    name: "baseline-script",
    kind: "script",
    available: existsSync(join(REPO_ROOT, "experiments/baseline/run_baseline.py")),
    note: "The Phase 0 baseline collector running its fixed experiment. Conventional tooling, not the Tenric runtime, and no model is involved.",
  };
  if (!runtimeAvailable()) return { backends: [builtin], runtime: false };
  try {
    const answer = await runtimeJson(["backends"]);
    const list = Array.isArray(answer) ? answer : ((answer as { backends?: unknown[] }).backends ?? []);
    const backends = list.map((entry): Backend => {
      const b = entry as Record<string, any>;
      return { name: String(b.name), kind: String(b.kind ?? "unknown"), available: b.available !== false, note: b.summary ?? b.note ?? b.description, capabilities: b.capabilities };
    });
    return { backends: [builtin, ...backends], runtime: true };
  } catch (error) {
    // The runtime is present and did not answer: report that, do not invent a list.
    return { backends: [builtin], runtime: true, error: `"${RUNTIME_CLI} backends --json" failed: ${(error as Error).message}` };
  }
}

export interface Task { id: string; path: string; title?: string; contract?: unknown; script_producer?: string; fixture: boolean; error?: string }

/** Runtime task files: tasks/*.task.json, and the demonstration tasks under fixtures/tasks/, which are labelled as fixtures. */
export function listTasks(): Task[] {
  return [["tasks", false], ["fixtures/tasks", true]].flatMap(([folder, fixture]) => {
    const dir = join(REPO_ROOT, folder as string);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.endsWith(".task.json")).sort().map((name): Task => {
      const path = `${folder}/${name}`;
      try {
        const task = readJson(join(dir, name)) as Record<string, any>;
        return { id: String(task.id ?? name.slice(0, -".task.json".length)), path, title: task.title, contract: task.contract, script_producer: task.script_producer, fixture: fixture as boolean };
      } catch (error) {
        return { id: name.slice(0, -".task.json".length), path, fixture: fixture as boolean, error: (error as Error).message };
      }
    });
  });
}

/** Compiles without running: the plan, or the precondition failure, before any model usage is spent. */
export async function compilePreview(taskRef: unknown, backend: unknown): Promise<{ ok: boolean; plan?: unknown; error?: string }> {
  if (!runtimeAvailable()) return { ok: false, error: `the compiler is not in this checkout (${RUNTIME_CLI} is absent)` };
  const task = listTasks().find((t) => t.path === taskRef);
  if (!task) return { ok: false, error: "task must name one of the listed task files" };
  if (typeof backend !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(backend)) return { ok: false, error: "backend name is not valid" };
  try {
    return { ok: true, plan: await runtimeJson(["compile", "--task", task.path, "--backend", backend]) };
  } catch (error) {
    const failure = error as Error & { stderr?: string; code?: number };
    return { ok: false, error: (failure.stderr || failure.message).trim() };
  }
}

interface Component { id: string; state: "available" | "partial" | "not_available" | "out_of_scope"; evidence: string }

export async function systemStatus() {
  const contracts = listContracts();
  const runs = listRuns();
  const { backends, runtime, error } = await listBackends();
  const requirements = contracts.filter((c) => c.usable).reduce((sum, c) => sum + (c.requirements?.total ?? 0), 0);
  const withoutValidator = contracts.filter((c) => c.usable).reduce((sum, c) => sum + (c.requirements?.without_validator ?? 0), 0);
  const has = (path: string) => existsSync(join(REPO_ROOT, path));
  const agentBackends = backends.filter((b) => b.kind === "agent" && b.available);

  const components: Component[] = [
    { id: "contract-spec", state: contracts.some((c) => c.usable) ? "available" : "not_available", evidence: `${contracts.filter((c) => c.usable).length} usable contract file(s) under spec/contracts/` },
    { id: "artifact-ir", state: has("spec/research-report.artifact.schema.json") ? "available" : "not_available", evidence: "spec/research-report.artifact.schema.json (one artifact type)" },
    { id: "collector", state: has("experiments/baseline/run_baseline.py") ? "available" : "not_available", evidence: "experiments/baseline/run_baseline.py (baseline script)" },
    {
      id: "verifier",
      state: requirements === 0 ? "not_available" : withoutValidator === 0 ? "available" : "partial",
      evidence: `${requirements - withoutValidator} of ${requirements} requirement(s) across usable contracts have a validator; the rest are reported as not_run`,
    },
    { id: "verdict-binding", state: has("src/verify.ts") ? "available" : "not_available", evidence: "src/verify.ts issues a verdict record bound to contract, artifact and verifier digests" },
    {
      id: "contract-registry",
      state: has("spec/contracts/registry.json") ? (contracts.every((c) => c.registered) ? "available" : "partial") : "not_available",
      evidence: `spec/contracts/registry.json: ${contracts.filter((c) => c.registered).length} of ${contracts.length} contract file(s) match it`,
    },
    {
      id: "re-execution",
      state: has("src/reproduce.ts") && reproductionTasks().length > 0 ? "available" : "not_available",
      evidence: `src/reproduce.ts and ${reproductionTasks().length} task file(s) under experiments/`,
    },
    {
      id: "capabilities",
      state: "not_available",
      evidence: "contracts require capabilities such as independent-collector; the verifier records them and cannot establish any (docs/trust-model.md)",
    },
    { id: "compiler", state: has("src/runtime/compiler.ts") ? "available" : "not_available", evidence: "src/runtime/compiler.ts" },
    { id: "runtime", state: runtime ? (error ? "partial" : "available") : "not_available", evidence: error ?? RUNTIME_CLI },
    {
      id: "agent-backends",
      state: agentBackends.length > 0 ? "available" : "not_available",
      evidence: agentBackends.length > 0 ? agentBackends.map((b) => b.name).join(", ") : "no agent backend is listed by the runtime",
    },
    { id: "human-review", state: "not_available", evidence: "no record format for a human decision exists (open question Q10)" },
    { id: "evolution", state: "out_of_scope", evidence: "RFC-0001 section 3: out of scope, not designed" },
  ];

  return {
    repository: repoRevision(),
    node: process.version,
    counts: {
      contracts: contracts.length,
      runs: runs.filter((r) => r.origin === "run").length,
      fixtures: runs.filter((r) => r.origin === "fixture").length,
      verdicts: Object.fromEntries(["accepted", "rejected", "inconclusive"].map((v) => [v, runs.filter((r) => r.verification?.verdict === v).length])),
      no_verdict: runs.filter((r) => r.origin === "run" && !r.verification).length,
    },
    components,
    backends,
    tasks: listTasks(),
  };
}
