// Execution runtime (RFC-0001 section 3): compile, let a backend author a
// workspace, check that nothing the verdict depends on was touched, execute and
// collect, execute again and compare, verify, and record every step.
//
// The trust boundary it draws is detection, not prevention: the backend and
// the experiment run as the same OS user as the runtime (docs/trust-model.md).
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../spec.ts";
import { verify } from "../verify.ts";
import type { Backend, BackendResult } from "./backends.ts";
import { collect, CollectorError, type Artifact, type CollectOptions, type CollectResult } from "./collector.ts";
import { compile } from "./compiler.ts";
import { git, sha256File, stableJson, toPosix, utcNow, writeJson } from "./util.ts";

export type RunStatus = "completed" | "failed" | "timeout" | "cancelled" | "void";
export interface Phase { name: string; status: "ok" | "failed" | "skipped"; started_at: string; seconds: number; detail?: string }
export interface RunSummary {
  run_schema: "0.1.0";
  run_id: string;
  created_at: string;
  finished_at: string;
  status: RunStatus;
  status_detail: string | null;
  data_class: "measured" | "fixture";
  task: { id: string; title: string; path: string; sha256: string };
  contract: { id: string; version: string; path: string; sha256: string };
  backend: { name: string; kind: string; outcome: string | null; seconds: number | null; self_report: Record<string, unknown> };
  phases: Phase[];
  source: { revision: string } | null;
  trusted_base_sha256: string;
  artifact: { path: string; sha256: string } | null;
  verification: { verdict: string; mandatory_passed: number; mandatory_total: number; wording: string; path: string } | null;
  reexecution: { consistent_with_declared: boolean; path: string } | null;
  review_notes: string[];
  files: Record<string, string | null>;
}

export interface RunOptions {
  taskPath: string;
  backend: Backend;
  /** Must not exist yet, or be empty. */
  runDir: string;
  model?: string;
  signal?: AbortSignal;
  /** Execute the experiment a second time and compare. On by default. */
  reexecute?: boolean;
  repoRoot?: string;
}

/** Paths whose content decides what "accepted" means or how it is decided. */
const TRUSTED_BASE = ["spec", "src", "scripts", "uv.lock", "pyproject.toml", ".python-version", "package.json", "package-lock.json"];

/** One digest over the files a run's verdict depends on, so a change during the run cannot go unnoticed. */
export function trustedBaseDigest(repoRoot: string): string {
  const hash = createHash("sha256");
  const visit = (path: string, name: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) if (entry !== "__pycache__") visit(join(path, entry), `${name}/${entry}`);
    } else hash.update(`${name}\0${sha256File(path)}\n`);
  };
  for (const name of TRUSTED_BASE) visit(join(repoRoot, name), name);
  return hash.digest("hex");
}

export async function runTask(options: RunOptions): Promise<RunSummary> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const runDir = resolve(options.runDir);
  const created_at = utcNow();
  const phases: Phase[] = [];
  const phase = async <T>(name: string, body: () => Promise<T> | T): Promise<T> => {
    const started_at = utcNow();
    const start = performance.now();
    const record = (status: Phase["status"], detail?: string) =>
      phases.push({ name, status, started_at, seconds: Math.round(performance.now() - start) / 1000, ...(detail ? { detail } : {}) });
    try {
      const value = await body();
      record("ok");
      return value;
    } catch (error) {
      record("failed", String(error));
      throw error;
    }
  };

  // Compile first. A precondition failure throws out of here: no run directory, no verdict.
  const compileStart = performance.now();
  const { plan, task } = compile({ taskPath: options.taskPath, backend: options.backend.describe(), repoRoot });
  phases.push({ name: "compile", status: "ok", started_at: created_at, seconds: Math.round(performance.now() - compileStart) / 1000 });

  if (existsSync(runDir) && readdirSync(runDir).length > 0) throw new Error(`refusing to run: ${runDir} is not empty`);
  const recordDir = join(runDir, "tenric");
  mkdirSync(recordDir, { recursive: true });
  const eventsPath = join(recordDir, "events.jsonl");
  let seq = 0;
  const emit = (source: "runtime" | "collector" | "backend", type: string, fields: Record<string, unknown> = {}) =>
    appendFileSync(eventsPath, JSON.stringify({ seq: ++seq, ts: new Date().toISOString(), source, type, ...fields }) + "\n");

  writeJson(join(recordDir, "plan.json"), plan);
  const planSha = sha256File(join(recordDir, "plan.json"));
  const baseBefore = trustedBaseDigest(repoRoot);
  emit("runtime", "run.started", { task: task.id, backend: plan.backend.name, contract: `${plan.contract.id}@${plan.contract.version}`, plan_sha256: planSha, trusted_base_sha256: baseBefore });

  const workspace = join(runDir, "workspace");
  const taskCopy = stableJson(task);
  let backendResult: BackendResult | undefined;
  let collected: CollectResult | undefined;
  let status: RunStatus = "void";
  let status_detail: string | null = null;
  let revision: string | null = null;
  let verification: RunSummary["verification"] = null;
  let reexecution: RunSummary["reexecution"] = null;

  try {
    // The backend works in a directory outside the repository, so relative paths cannot reach the contract,
    // and no instruction file of this repository is picked up by an agent harness walking up from its cwd.
    const staging = mkdtempSync(join(tmpdir(), "tenric-workspace-"));
    await phase("workspace", () => {
      git(staging, "init", "-q");
      writeFileSync(join(staging, "TASK.md"), plan.instructions);
      writeFileSync(join(staging, "tenric.task.json"), taskCopy);
      cpSync(join(repoRoot, "spec/runtime/research.experiment-report.claims.schema.json"), join(staging, "claims.schema.json"));
      git(staging, "add", "-A");
      git(staging, "commit", "-q", "-m", "tenric: task handed to the backend");
    });
    emit("runtime", "workspace.prepared", {});

    emit("runtime", "backend.started", { backend: plan.backend.name, model: options.model ?? null });
    backendResult = await phase("backend", () => options.backend.run({
      task, instructions: plan.instructions, workspace: staging, recordDir: join(recordDir, "backend"), repoRoot,
      limits: { timeoutSeconds: plan.limits.backend_timeout_seconds, maxCostUsd: plan.limits.backend_max_cost_usd },
      model: options.model, signal: options.signal,
      onEvent: ({ type, ...fields }) => emit("backend", type, fields),
    }));
    emit("runtime", "backend.finished", { outcome: backendResult.outcome, seconds: backendResult.seconds, detail: backendResult.detail ?? null });

    cpSync(staging, workspace, { recursive: true, verbatimSymlinks: true });
    rmSync(staging, { recursive: true, force: true });

    // Integrity: the backend must not have touched what judges it. Any violation voids the run: no artifact, no verdict.
    const violations = await phase("integrity", () => {
      const found: string[] = [];
      if (sha256File(join(repoRoot, plan.contract.path)) !== plan.contract.sha256) found.push(`contract ${plan.contract.path} changed during the run`);
      if (sha256File(join(repoRoot, plan.contract.schema_path)) !== plan.contract.schema_sha256) found.push(`artifact schema ${plan.contract.schema_path} changed during the run`);
      if (sha256File(join(repoRoot, plan.contract.registry_path)) !== plan.contract.registry_sha256) found.push(`contract registry ${plan.contract.registry_path} changed during the run`);
      if (trustedBaseDigest(repoRoot) !== baseBefore) found.push("files under spec/, src/, scripts/ or the lockfiles changed during the run");
      if (sha256File(join(recordDir, "plan.json")) !== planSha) found.push("tenric/plan.json changed during the run");
      for (const name of ["tenric.task.json", "claims.schema.json"]) {
        const expected = name === "tenric.task.json" ? createHash("sha256").update(taskCopy).digest("hex") : sha256File(join(repoRoot, "spec/runtime/research.experiment-report.claims.schema.json"));
        if (!existsSync(join(workspace, name)) || sha256File(join(workspace, name)) !== expected) found.push(`the backend changed ${name}`);
      }
      const stray = readdirSync(runDir).filter((name) => name !== "tenric" && name !== "workspace");
      if (stray.length > 0) found.push(`unexpected files in the run directory before collection: ${stray.join(", ")}`);
      return found;
    });
    emit("runtime", "integrity.checked", { violations });
    if (violations.length > 0) {
      status_detail = `integrity violation: ${violations.join("; ")}`;
    } else {
      revision = await phase("commit", () => {
        git(workspace, "add", "-A");
        git(workspace, "commit", "-q", "--allow-empty", "-m", `tenric: workspace as left by backend ${plan.backend.name}`);
        return git(workspace, "rev-parse", "HEAD");
      });
      emit("runtime", "workspace.committed", { revision });

      const notExecuted = backendResult.outcome === "completed" ? undefined : {
        status: backendResult.outcome,
        reason: `backend ${plan.backend.name} did not complete (${backendResult.outcome}): ${backendResult.detail ?? "no detail"}`,
      };
      emit("collector", "execution.started", { executed: !notExecuted });
      collected = await phase("execute", () => collect({
        workspace, outDir: runDir, recordDir, task, repoRoot,
        executionTimeoutSeconds: plan.limits.execution_timeout_seconds, signal: options.signal, notExecuted,
      }));
      emit("collector", "execution.finished", { status: collected.status, detail: collected.detail, outputs: collected.artifact.outputs.length });
      emit("collector", "artifact.written", { sha256: sha256File(join(runDir, "artifact.json")) });
      status = collected.status === "succeeded" ? "completed" : collected.status;
      status_detail = collected.detail;

      if (collected.status === "succeeded" && options.reexecute !== false && !options.signal?.aborted) {
        const outcome = await phase("reexecute", () => reexecute(collected!.artifact, { workspace, recordDir, task, repoRoot, timeout: plan.limits.execution_timeout_seconds, signal: options.signal }));
        reexecution = { consistent_with_declared: outcome, path: "tenric/reexecution.json" };
        emit("runtime", "reexecution.finished", { consistent_with_declared: outcome });
      }

      // A second integrity check: the experiment ran as the same user and could have reached the same files.
      if (trustedBaseDigest(repoRoot) !== baseBefore || sha256File(join(repoRoot, plan.contract.path)) !== plan.contract.sha256) {
        status = "void";
        status_detail = "integrity violation: the contract or files under spec/, src/, scripts/ changed while the experiment was executing";
        emit("runtime", "integrity.checked", { violations: [status_detail] });
      } else {
        // What the verifier needs to execute this run again itself, from a checkout of the recorded revision.
        const reproduceTask = join(recordDir, "reproduce.task.json");
        writeJson(reproduceTask, {
          task_schema: "0.1.0",
          experiment_id: task.id,
          collect: ["node", toPosix(join(repoRoot, "src/tenric.ts")), "collect", "--workspace", ".", "--config", "{config}", "--out", "{out}"],
          timeout_seconds: plan.limits.execution_timeout_seconds + 120,
        });
        verification = await phase("verify", () => {
          // The verdict is the verifier's: this is the same entry point `tenric verify` uses, with the registry that was pinned at compile time.
          const record = verify({
            runDir, contractPath: join(repoRoot, plan.contract.path), repo: workspace,
            registryPath: join(repoRoot, plan.contract.registry_path), reproduce: { taskPath: reproduceTask },
          });
          if (record.contract.sha256 !== plan.contract.sha256 || record.contract.registry_sha256 !== plan.contract.registry_sha256) {
            throw new Error("the contract or its registry is not the one the plan was compiled against");
          }
          writeJson(join(recordDir, "verification.json"), record);
          return { verdict: record.verdict, mandatory_passed: record.summary.passed, mandatory_total: record.summary.mandatory, wording: record.statement, path: "tenric/verification.json" };
        });
        emit("runtime", "verification.finished", { verdict: verification.verdict });
      }
    }
  } catch (error) {
    // Fail closed: when the runtime or the collector itself breaks, nothing is concluded about the deliverable.
    status = "void";
    status_detail = `${error instanceof CollectorError ? "collector error" : "runtime error"}: ${(error as Error).message}`;
    verification = null;
    emit("runtime", "run.error", { detail: status_detail });
  }
  if (status === "void") {
    // A void run leaves no artifact to be mistaken for a deliverable.
    rmSync(join(runDir, "artifact.json"), { force: true });
    verification = null;
  }

  const has = (path: string) => (existsSync(join(runDir, path)) ? path : null);
  const summary: RunSummary = {
    run_schema: "0.1.0",
    run_id: toPosix(runDir).split("/").filter(Boolean).pop()!,
    created_at,
    finished_at: utcNow(),
    status,
    status_detail,
    data_class: plan.task.data_class,
    task: { id: task.id, title: task.title, path: toPosix(options.taskPath), sha256: plan.task.sha256 },
    contract: { id: plan.contract.id, version: plan.contract.version, path: plan.contract.path, sha256: plan.contract.sha256 },
    backend: { name: plan.backend.name, kind: plan.backend.kind, outcome: backendResult?.outcome ?? null, seconds: backendResult?.seconds ?? null, self_report: backendResult?.self_report ?? {} },
    phases,
    source: revision ? { revision } : null,
    trusted_base_sha256: baseBefore,
    artifact: has("artifact.json") ? { path: "artifact.json", sha256: sha256File(join(runDir, "artifact.json")) } : null,
    verification,
    reexecution,
    review_notes: [...(collected?.review_notes ?? []), ...plan.review_checklist.map((item) => `${item.requirement} needs a person: ${item.question}`)],
    files: {
      plan: "tenric/plan.json", events: "tenric/events.jsonl", verification: has("tenric/verification.json"),
      backend_dir: has("tenric/backend"), execution_stdout: has("tenric/execution.stdout.txt"), execution_stderr: has("tenric/execution.stderr.txt"),
      reexecution: has("tenric/reexecution.json"), reproduce_task: has("tenric/reproduce.task.json"), report: has("report.md"),
    },
  };
  emit("runtime", "run.finished", { status, verdict: verification?.verdict ?? null });
  writeJson(join(recordDir, "run.json"), summary);
  return summary;
}

/**
 * Executes the experiment a second time into a scratch directory and compares
 * it with the first, output by output. Returns whether every output held the
 * determinism class declared for it. This is the runtime's own observation and
 * an input for people; the verifier's re-execution requirement is decided by
 * the verifier, not by this record.
 */
async function reexecute(first: Artifact, context: { workspace: string; recordDir: string; task: CollectOptions["task"]; repoRoot: string; timeout: number; signal?: AbortSignal }): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), "tenric-reexec-"));
  try {
    const second = await collect({
      workspace: context.workspace, outDir: scratch, recordDir: join(scratch, "tenric"), task: context.task, repoRoot: context.repoRoot,
      executionTimeoutSeconds: context.timeout, signal: context.signal, writeArtifact: false,
    });
    const again = new Map(second.artifact.outputs.map((o) => [o.path, o]));
    const outputs = first.outputs.filter((o) => o.role !== "report").map((o) => {
      const other = again.get(o.path);
      const identical = other !== undefined && other.sha256 === o.sha256;
      return { path: o.path, determinism: o.determinism, identical, first_sha256: o.sha256, second_sha256: other?.sha256 ?? null, held: o.determinism === "byte-identical" ? identical : other !== undefined };
    });
    const secondMetrics = new Map(second.artifact.metrics.map((m) => [m.name, m.value]));
    const metrics = first.metrics.map((m) => {
      const value = secondMetrics.get(m.name);
      return { name: m.name, first: m.value, second: value ?? null, abs_diff: value === undefined ? null : Math.abs(value - m.value) };
    });
    const consistent_with_declared = second.status === "succeeded" && outputs.every((o) => o.held);
    writeJson(join(context.recordDir, "reexecution.json"), {
      note: "Second execution by the runtime in the same environment, compared with the first. Not the verifier's re-execution.",
      second_status: second.status, second_detail: second.detail, consistent_with_declared, outputs, metrics,
    });
    return consistent_with_declared;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
