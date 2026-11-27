// Starts runs. The only producer that exists today is the Phase 0 baseline
// collector, so that is the only thing this can start. Jobs live in memory:
// the durable record of a run is its directory, not this list.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, REPO_ROOT } from "./core.ts";
import { BadRequest, NotFound, RUN_ID, RUNS_DIR } from "./data.ts";
import { listBackends, listTasks, RUNTIME_CLI, runtimeAvailable } from "./system.ts";

const COLLECTOR = "experiments/baseline/run_baseline.py";
const DEFAULT_CONFIG = "experiments/baseline/config.json";
const CONFIG_DIR = join(RUNS_DIR, ".ui-configs");
const LOG_LIMIT = 64 * 1024;

export interface Job {
  id: string;
  run_id: string;
  backend: string;
  task?: string;
  command: string[];
  config_path: string;
  state: "running" | "exited" | "spawn_failed";
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  /** stdout and stderr of the collector, interleaved, truncated to the last 64 KiB. */
  log: string;
}

const jobs: Job[] = [];

export function listJobs(): Job[] {
  return [...jobs].reverse();
}

export function getJob(id: string): Job {
  const job = jobs.find((j) => j.id === id);
  if (!job) throw new NotFound(`no job ${id}`);
  return job;
}

export function defaultConfig(): unknown {
  return readJson(join(REPO_ROOT, DEFAULT_CONFIG));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export interface StartRequest {
  run_id?: unknown; backend?: unknown; timeout_seconds?: unknown; config?: unknown;
  /** Runtime backends only. */
  task?: unknown; model?: unknown;
}

function launch(job: Job): Job {
  const append = (chunk: Buffer) => { job.log = (job.log + chunk.toString("utf8")).slice(-LOG_LIMIT); };
  const child = spawn(job.command[0]!, job.command.slice(1), { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    job.state = "spawn_failed";
    job.finished_at = new Date().toISOString();
    job.log += `could not start the process: ${error.message}\n`;
  });
  child.on("close", (code) => {
    if (job.state !== "running") return;
    job.state = "exited";
    job.exit_code = code;
    job.finished_at = new Date().toISOString();
  });
  jobs.push(job);
  return job;
}

function newJob(fields: Pick<Job, "run_id" | "backend" | "command" | "config_path"> & { task?: string }): Job {
  return {
    id: `job-${Date.now().toString(36)}-${jobs.length + 1}`, ...fields,
    state: "running", exit_code: null, started_at: new Date().toISOString(), finished_at: null, log: "",
  };
}

/** Starts a run through the runtime command line (docs/runtime-interface.md). */
async function startRuntimeRun(request: StartRequest, runId: string, backend: string): Promise<Job> {
  if (!runtimeAvailable()) throw new BadRequest(`backend ${backend} needs the Tenric runtime (${RUNTIME_CLI}), which is not in this checkout`);
  const known = (await listBackends()).backends.find((b) => b.name === backend && b.name !== "baseline-script");
  if (!known) throw new BadRequest(`the runtime does not list a backend named ${backend}`);
  if (!known.available) throw new BadRequest(`backend ${backend} is listed and not available: ${known.note ?? "no reason given"}`);
  const task = listTasks().find((t) => t.id === request.task || t.path === request.task);
  if (!task) throw new BadRequest("task must name one of the files under tasks/");
  const command = [process.execPath, RUNTIME_CLI, "run", "--task", task.path, "--backend", backend, "--out", `runs/${runId}`];
  if (request.model !== undefined) {
    if (typeof request.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@\/\[\]-]{0,127}$/.test(request.model)) throw new BadRequest("model is not a plausible model identifier");
    command.push("--model", request.model);
  }
  command.push("--json");
  return launch(newJob({ run_id: runId, backend, task: task.path, command, config_path: task.path }));
}

/** `uvCommand` exists so tests can substitute a stub for uv; the interface never sets it from a request. */
export async function startRun(request: StartRequest, uvCommand: string[] = ["uv", "run", "--locked", "python"]): Promise<Job> {
  const runId = request.run_id;
  if (typeof runId !== "string" || !RUN_ID.test(runId)) {
    throw new BadRequest("run_id must be 1 to 64 characters: letters, digits, dot, underscore or hyphen, starting with a letter or digit");
  }
  const out = join(RUNS_DIR, runId);
  if (existsSync(out) && readdirSync(out).length > 0) throw new BadRequest(`runs/${runId} already exists and is not empty`);
  if (jobs.some((j) => j.state === "running")) throw new BadRequest("a run is already in progress; wait for it to finish");

  const backend = request.backend ?? "baseline-script";
  if (typeof backend !== "string") throw new BadRequest("backend must be a string");
  if (backend !== "baseline-script") return startRuntimeRun(request, runId, backend);

  const args = [COLLECTOR, "--out", `runs/${runId}`];
  let configPath = DEFAULT_CONFIG;
  if (request.config !== undefined) {
    if (request.config === null || typeof request.config !== "object" || Array.isArray(request.config)) throw new BadRequest("config must be a JSON object");
    mkdirSync(CONFIG_DIR, { recursive: true });
    configPath = `runs/.ui-configs/${runId}.json`;
    writeFileSync(join(REPO_ROOT, configPath), JSON.stringify(sortKeys(request.config), null, 2) + "\n");
    args.push("--config", configPath);
  }
  if (request.timeout_seconds !== undefined) {
    const timeout = request.timeout_seconds;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new BadRequest("timeout_seconds must be a number between 0 and 3600");
    args.push("--timeout", String(timeout));
  }

  return launch(newJob({ run_id: runId, backend, command: [...uvCommand, ...args], config_path: configPath }));
}
