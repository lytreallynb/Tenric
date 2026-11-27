// Re-execution for the numeric-reproduction check (R-008).
//
// The verifier runs the task again itself, from a fresh git worktree of the
// recorded revision and with a scrubbed environment, and compares what that
// produces with what the artifact reports. It never reads a reproduction
// record from the run directory: a file there is a producer-side claim.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { readJson, sha256File } from "./spec.ts";

export interface Task {
  task_schema: "0.1.0";
  experiment_id: string;
  /** Command run with the worktree root as working directory. `{config}` and `{out}` are substituted. */
  collect: string[];
  timeout_seconds?: number;
}

export function loadTask(path: string): Task {
  const task = readJson(path) as Task;
  const valid = task !== null && typeof task === "object" && task.task_schema === "0.1.0" &&
    typeof task.experiment_id === "string" && Array.isArray(task.collect) && task.collect.length > 0 &&
    task.collect.every((part) => typeof part === "string") && task.collect.some((part) => part.includes("{out}")) &&
    (task.timeout_seconds === undefined || (typeof task.timeout_seconds === "number" && task.timeout_seconds > 0));
  if (!valid) throw new Error(`invalid task file ${path}`);
  return task;
}

// Everything else is dropped, in particular PYTHONPATH, PYTHONSTARTUP, VIRTUAL_ENV and
// UV_PROJECT_ENVIRONMENT: the re-execution builds its own environment from the lockfile.
const PASSED_THROUGH = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "LANG",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "UV_CACHE_DIR", "UV_NATIVE_TLS", "UV_SYSTEM_CERTS", "UV_PYTHON_INSTALL_DIR", "XDG_CACHE_HOME", "XDG_DATA_HOME",
]);
export function scrubbedEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => PASSED_THROUGH.has(entry[0].toUpperCase()) && entry[1] !== undefined),
  );
}

export interface ReExecution {
  /** Directory the re-execution wrote into. Removed when the process exits. */
  dir: string;
  artifact: any;
  task_sha256: string;
}
export class CannotReExecute extends Error {}
/** The recorded inputs do not allow the run to be repeated: a definite failure of the requirement, not an inability to check. */
export class NotReproducible extends Error {}

const cache = new Map<string, ReExecution>();
const scratch: string[] = [];
process.on("exit", () => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Runs the task's collect command in a fresh worktree of `revision`. One re-execution per
 * repository, revision, config and task within a process; several artifacts claiming the
 * same inputs are compared against the same re-execution.
 */
export function reExecute(repo: string, revision: string, config: { path: string; sha256: string }, taskPath: string): ReExecution {
  const task = loadTask(taskPath);
  const taskSha = sha256File(taskPath);
  const key = [realpathSync(repo), revision, config.path, config.sha256, taskSha].join("|");
  const cached = cache.get(key);
  if (cached) return cached;

  const base = mkdtempSync(join(tmpdir(), "tenric-reexec-"));
  scratch.push(base);
  const worktree = join(base, "src");
  const out = join(base, "run");
  try {
    git(repo, "worktree", "add", "--quiet", "--detach", worktree, revision);
  } catch (error) {
    throw new CannotReExecute(`cannot check out revision ${revision}: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`);
  }
  try {
    const configPath = join(worktree, config.path);
    if (!existsSync(configPath) || !realpathSync(configPath).startsWith(realpathSync(worktree) + sep)) {
      throw new NotReproducible(`config ${config.path} is not part of revision ${revision}`);
    }
    if (sha256File(configPath) !== config.sha256) {
      throw new NotReproducible(`config ${config.path} at revision ${revision} is not the config the artifact records`);
    }
    const [command, ...args] = task.collect.map((part) => part.replaceAll("{config}", configPath).replaceAll("{out}", out));
    const done = spawnSync(command!, args, {
      cwd: worktree, env: scrubbedEnvironment(), encoding: "utf8",
      timeout: (task.timeout_seconds ?? 600) * 1000, stdio: ["ignore", "pipe", "pipe"],
    });
    const artifactPath = join(out, "artifact.json");
    if (!existsSync(artifactPath)) {
      const why = done.error ? String(done.error) : `exit ${String(done.status)}: ${(done.stderr ?? "").trim().slice(-600)}`;
      throw new CannotReExecute(`re-execution produced no artifact (${why})`);
    }
    const result = { dir: out, artifact: readJson(artifactPath), task_sha256: taskSha };
    cache.set(key, result);
    return result;
  } finally {
    try { git(repo, "worktree", "remove", "--force", worktree); } catch { /* removed with the scratch directory; pruned below */ }
    rmSync(worktree, { recursive: true, force: true });
    try { git(repo, "worktree", "prune"); } catch { /* nothing to prune */ }
  }
}
