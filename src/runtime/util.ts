// Small helpers shared by the compiler, the runtime and the adapters.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

/** Sorted keys, two-space indent, one trailing "\n" on every platform. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, stableJson(value));
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Runs git with an identity of its own, so commits never depend on (or borrow) the user's configuration. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=tenric-runtime", "-c", "user.email=runtime@tenric.invalid", "-c", "commit.gpgsign=false",
      "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", "-C", cwd, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutSeconds: number;
  signal?: AbortSignal;
  stdin?: string;
  stdoutPath?: string;
  stderrPath?: string;
  onStdoutLine?: (line: string) => void;
}
export interface ProcessResult {
  /** exited: the process ended by itself. The other three mean it did not. */
  outcome: "exited" | "timeout" | "cancelled" | "spawn_error";
  exitCode: number | null;
  seconds: number;
  error?: string;
}

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** Runs one child process to completion, a timeout or a cancellation, and kills its whole process tree in the last two cases. */
export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const seconds = () => Math.round(performance.now() - started) / 1000;
    if (options.signal?.aborted) return resolve({ outcome: "cancelled", exitCode: null, seconds: 0 });

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stopped: "timeout" | "cancelled" | undefined;
    const stop = (reason: "timeout" | "cancelled") => {
      stopped ??= reason;
      if (child.pid !== undefined) killTree(child.pid);
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutSeconds * 1000);
    const onAbort = () => stop("cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const sinks = [options.stdoutPath, options.stderrPath].map((path) => (path ? createWriteStream(path) : undefined));
    let pending = "";
    child.stdout.on("data", (chunk: Buffer) => {
      sinks[0]?.write(chunk);
      if (!options.onStdoutLine) return;
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) options.onStdoutLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) => sinks[1]?.write(chunk));
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin ?? "");

    let settled = false;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (pending && options.onStdoutLine) options.onStdoutLine(pending);
      let open = sinks.filter(Boolean).length;
      if (open === 0) return resolve(result);
      for (const sink of sinks) sink?.end(() => { if (--open === 0) resolve(result); });
    };
    child.on("error", (error) => finish({ outcome: "spawn_error", exitCode: null, seconds: seconds(), error: String(error) }));
    child.on("close", (code) => finish({ outcome: stopped ?? "exited", exitCode: stopped ? null : code, seconds: seconds() }));
  });
}
