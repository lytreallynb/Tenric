// tenric <command>
//
//   backends [--json]                                  list backend adapters and what they guarantee
//   compile  --task <file> --backend <name> [--json]   compile only
//   run      --task <file> --backend <name> [--out <run-dir>] [--model <id>] [--no-reexecute] [--json]
//   collect  --workspace <dir> --out <dir> [--config <file>]   execute and collect a committed workspace
//   runs     [--root <dir>] [--json]                   list runtime runs
//   show     <run-dir> [--json]
//   verify   ...                                       passed through to src/cli.ts unchanged
//
// Exit codes for run, as for verify: 0 accepted, 1 rejected, 3 inconclusive,
// 2 no verdict issued (bad usage, a precondition failure, or a void run).
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "./spec.ts";
import type { Verdict } from "./verdict.ts";
import { exitCode } from "./verify.ts";
import { getBackend, listBackends } from "./runtime/backends.ts";
import { collect } from "./runtime/collector.ts";
import { compile, PreconditionError } from "./runtime/compiler.ts";
import { listRuns, readRun } from "./runtime/runs.ts";
import { runTask, type RunSummary } from "./runtime/runtime.ts";
import { readJson, stableJson } from "./runtime/util.ts";

const USAGE = "usage: tenric backends | compile | run | collect | runs | show | verify   (see the header of src/tenric.ts)";

function nothingRan(message: string): never {
  console.error(`nothing ran: ${message}`);
  process.exit(2);
}

function describeRun(run: RunSummary): string {
  const verdict = run.verification ? `verdict: ${run.verification.wording}` : "no verdict issued";
  return `${run.run_id}  ${run.status.padEnd(9)}  ${run.backend.name.padEnd(11)}  ${run.data_class.padEnd(8)}  ${verdict}`;
}

const command = process.argv[2];
if (command === "verify") {
  // The verifier's command line is not the runtime's to change. It reads process.argv itself.
  await import("./cli.ts");
} else {
  let args;
  try {
    args = parseArgs({
      args: process.argv.slice(3),
      allowPositionals: true,
      options: {
        task: { type: "string" }, backend: { type: "string" }, out: { type: "string" }, model: { type: "string" },
        root: { type: "string" }, workspace: { type: "string" }, config: { type: "string" },
        json: { type: "boolean" }, "no-reexecute": { type: "boolean" },
      },
    });
  } catch (error) {
    nothingRan(`${(error as Error).message}\n${USAGE}`);
  }
  const { values, positionals } = args;
  const backendFor = (name: string | undefined) => {
    const backend = name ? getBackend(name) : undefined;
    if (!backend) nothingRan(`unknown backend ${JSON.stringify(name)}; known: ${listBackends().map((b) => b.name).join(", ")}`);
    return backend;
  };

  if (command === "backends") {
    const backends = listBackends();
    if (values.json) process.stdout.write(stableJson(backends));
    else for (const backend of backends) {
      console.log(`${backend.name} (${backend.kind}): ${backend.summary}`);
      for (const [name, capability] of Object.entries(backend.capabilities)) console.log(`  ${capability.supported ? "yes" : "no "}  ${name}: ${capability.guarantee}`);
    }
  } else if (command === "compile") {
    if (!values.task) nothingRan(USAGE);
    try {
      const { plan } = compile({ taskPath: values.task, backend: backendFor(values.backend).describe() });
      if (values.json) process.stdout.write(stableJson(plan));
      else {
        console.log(`task ${plan.task.id} under contract ${plan.contract.id} version ${plan.contract.version} (sha256 ${plan.contract.sha256}) with backend ${plan.backend.name}`);
        for (const r of plan.requirements) console.log(`${r.id}  ${r.supplied_by.padEnd(9)}  validator ${r.validator.available ? "available  " : "unavailable"}  ${r.title} (${r.level}, ${r.verifiability})`);
        console.log(`best reachable verdict: ${plan.predicted.best_verdict}${plan.predicted.blocking_unavailable.length ? ` (no validator for ${plan.predicted.blocking_unavailable.join(", ")})` : ""}`);
        for (const failure of plan.predicted.known_failures) console.log(`known before running: ${failure}`);
        for (const warning of plan.warnings) console.log(`warning: ${warning}`);
      }
    } catch (error) {
      if (error instanceof PreconditionError) nothingRan(error.message);
      throw error;
    }
  } else if (command === "run") {
    if (!values.task) nothingRan(USAGE);
    const backend = backendFor(values.backend);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const taskId = (() => { try { return (readJson(values.task!) as { id?: string }).id ?? "task"; } catch { return "task"; } })();
    const runDir = values.out ?? join(REPO_ROOT, "runs", `${taskId}-${values.backend}-${stamp}`);
    const controller = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
    try {
      const summary = await runTask({ taskPath: values.task, backend, runDir, model: values.model, signal: controller.signal, reexecute: !values["no-reexecute"] });
      if (values.json) process.stdout.write(stableJson(summary));
      else {
        console.log(`run directory: ${runDir}`);
        console.log(`status: ${summary.status}${summary.status_detail ? ` (${summary.status_detail})` : ""}`);
        console.log(summary.verification ? `verdict: ${summary.verification.wording}` : "no verdict issued");
      }
      process.exitCode = summary.verification ? exitCode(summary.verification.verdict as Verdict) : 2;
    } catch (error) {
      if (error instanceof PreconditionError) nothingRan(error.message);
      throw error;
    }
  } else if (command === "collect") {
    if (!values.workspace || !values.out) nothingRan(USAGE);
    const workspace = resolve(values.workspace);
    // Compared as real paths: the caller may name the same file through a symlinked temporary directory (macOS does).
    const same = (a: string, b: string) => existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b);
    if (values.config && !same(values.config, join(workspace, "config.json"))) nothingRan("--config must be config.json of the workspace");
    const taskFile = join(workspace, "tenric.task.json");
    if (!existsSync(taskFile)) nothingRan(`${taskFile} is missing: not a workspace prepared by the runtime`);
    const task = readJson(taskFile) as { id: string; title: string; data_class?: "measured" | "fixture"; limits?: { execution_timeout_seconds?: number } };
    const out = resolve(values.out);
    const result = await collect({
      workspace, outDir: out, recordDir: join(out, "tenric"), task, repoRoot: REPO_ROOT,
      executionTimeoutSeconds: task.limits?.execution_timeout_seconds ?? 300,
    });
    console.log(`${result.status}: wrote ${join(out, "artifact.json")}`);
    process.exitCode = result.status === "succeeded" ? 0 : 1;
  } else if (command === "runs") {
    const runs = listRuns(values.root ?? join(REPO_ROOT, "runs"));
    if (values.json) process.stdout.write(stableJson(runs));
    else for (const run of runs) console.log(describeRun(run));
  } else if (command === "show") {
    const run = positionals[0] ? readRun(positionals[0]) : undefined;
    if (!run) nothingRan(`${positionals[0] ?? "(no directory)"} has no tenric/run.json`);
    if (values.json) process.stdout.write(stableJson(run));
    else {
      console.log(describeRun(run));
      for (const p of run.phases) console.log(`  ${p.name.padEnd(10)} ${p.status.padEnd(7)} ${p.seconds.toFixed(3)} s${p.detail ? `  ${p.detail}` : ""}`);
      for (const note of run.review_notes) console.log(`  review: ${note}`);
    }
  } else {
    nothingRan(USAGE);
  }
}
