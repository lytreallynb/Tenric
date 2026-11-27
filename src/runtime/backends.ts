// Backend adapters (RFC-0001 section 8). A backend authors a workspace; it
// never executes the experiment for the record and never writes the artifact.
// Nothing an adapter returns is evidence: exit status and files are observed
// by the runtime, and self_report is the backend's account of itself.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import { certificatePaths, pythonPaths, sandboxAvailability, sandboxed, type IsolationRecord } from "./sandbox.ts";
import type { Task } from "./schemas.ts";
import { runProcess, writeJson } from "./util.ts";

export interface Capability {
  supported: boolean;
  /** What is actually guaranteed, in words. "Supported" without a stated guarantee means nothing. */
  guarantee: string;
}
export interface BackendDescription {
  name: string;
  kind: "script" | "agent";
  summary: string;
  capabilities: Record<string, Capability>;
}
export interface BackendEvent { type: string; [key: string]: unknown }
export interface BackendRunRequest {
  task: Task;
  instructions: string;
  /** Directory the backend may write to. Outside the Tenric repository while the backend runs. */
  workspace: string;
  /** Where the adapter stores the backend's own account of the run. */
  recordDir: string;
  repoRoot: string;
  limits: { timeoutSeconds: number; maxCostUsd: number };
  model?: string;
  signal?: AbortSignal;
  onEvent?: (event: BackendEvent) => void;
  /** Paths the backend must not be able to read, such as the runtime's signing key. */
  hidden: string[];
  /** Refuse to run code-executing backends without an enforced sandbox. */
  requireSandbox: boolean;
}
export interface BackendResult {
  outcome: "completed" | "failed" | "timeout" | "cancelled";
  exit_code: number | null;
  seconds: number;
  detail?: string;
  /** Backend-reported. Never evidence. */
  self_report: Record<string, unknown>;
  /** How the backend's process was confined, as set up by the runtime. Null when no process ran. */
  isolation: IsolationRecord | null;
}
export interface Backend {
  describe(): BackendDescription;
  run(request: BackendRunRequest): Promise<BackendResult>;
}

const no = (guarantee: string): Capability => ({ supported: false, guarantee });
const yes = (guarantee: string): Capability => ({ supported: true, guarantee });

/** A plain script is a valid backend: it copies a pre-written producer directory into the workspace. */
export class ScriptBackend implements Backend {
  /** Overrides task.script_producer with an absolute directory. For tests. */
  readonly producerDir: string | undefined;
  constructor(options: { producerDir?: string } = {}) {
    this.producerDir = options.producerDir;
  }

  describe(): BackendDescription {
    return {
      name: "script",
      kind: "script",
      summary: "Copies a producer written in advance (task.script_producer). No model is involved.",
      capabilities: {
        "workspace-authoring": yes("Copies the producer directory byte for byte."),
        "task-brief": no("Cannot read prose. The task must name a script_producer."),
        "event-stream": no("None."),
        "cancellation": yes("The copy is synchronous and short; cancellation takes effect after it."),
        "cost-reporting": no("No cost."),
        "sandbox": no("Runs no code: the copy is done by the runtime's own process. The experiment it copies is executed by the runtime, in the runtime's sandbox."),
      },
    };
  }

  async run(request: BackendRunRequest): Promise<BackendResult> {
    const started = performance.now();
    const done = (outcome: BackendResult["outcome"], detail?: string): BackendResult => ({
      outcome, exit_code: null, seconds: Math.round(performance.now() - started) / 1000,
      ...(detail ? { detail } : {}), self_report: {}, isolation: null,
    });
    let source = this.producerDir;
    if (!source) {
      if (!request.task.script_producer) return done("failed", "task names no script_producer");
      source = join(request.repoRoot, request.task.script_producer);
      if (!existsSync(source) || !statSync(source).isDirectory()) return done("failed", `${request.task.script_producer} is not a directory`);
      if (!realpathSync(source).startsWith(realpathSync(request.repoRoot) + sep)) return done("failed", "script_producer resolves outside the repository");
    }
    const skipped = new Set(["__pycache__", ".git", ".gitattributes", "TASK.md", "tenric.task.json", "claims.schema.json"]);
    for (const name of readdirSync(source)) {
      if (skipped.has(name)) continue;
      cpSync(join(source, name), join(request.workspace, name), { recursive: true });
    }
    return done(request.signal?.aborted ? "cancelled" : "completed");
  }
}

function clip(value: unknown, length: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length > length ? text.slice(0, length) + "…" : text;
}

/**
 * Claude Code in headless mode (`claude -p`). The adapter passes the compiled
 * instructions on stdin, lets the agent work in the workspace, and stores the
 * CLI's stream as the backend's own account.
 */
export class ClaudeCodeBackend implements Backend {
  readonly command: string[];
  /** command replaces the executable (and any leading arguments). Tests pass a fake CLI here. */
  constructor(options: { command?: string[] } = {}) {
    this.command = options.command ?? ["claude"];
  }

  /** What the CLI needs to start inside the sandbox: its installation, any file named in the command, its configuration, certificates, and paths the operator adds in TENRIC_SANDBOX_READONLY. */
  readonlyPaths(): string[] {
    const [executable, ...leading] = this.command;
    const paths = [installRoot(executable!), ...leading.filter((a) => isAbsolute(a) && existsSync(a)), ...certificatePaths()];
    // The CLI starts with an empty home directory inside the sandbox. Configuration it must see is the operator's
    // choice: CLAUDE_CONFIG_DIR when set, and anything listed in TENRIC_SANDBOX_READONLY.
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    if (configDir && existsSync(configDir)) paths.push(configDir);
    for (const extra of (process.env.TENRIC_SANDBOX_READONLY ?? "").split(":")) if (extra && isAbsolute(extra)) paths.push(extra);
    return [...new Set(paths.filter((p): p is string => !!p))];
  }

  describe(): BackendDescription {
    return {
      name: "claude-code",
      kind: "agent",
      summary: "Claude Code CLI in headless mode. The model is whatever the CLI is configured for unless --model is given.",
      capabilities: {
        "workspace-authoring": yes("The agent has Read, Write, Edit, Glob, Grep and Bash with the workspace as its working directory. Whether it writes the required files is not guaranteed; the runtime checks."),
        "task-brief": yes("The compiled instructions are passed as the prompt."),
        "event-stream": yes("stream-json lines from the CLI, stored verbatim. This is the backend's account of itself, not evidence."),
        "cancellation": yes("The runtime kills the CLI's process tree. Work already written stays in the workspace."),
        "cost-reporting": yes("total_cost_usd in the CLI's result event. Backend-reported and not checked."),
        "structured-output": no("The CLI has --json-schema; this adapter does not use it, because the deliverable is files in a workspace."),
        "sandbox": { supported: sandboxAvailability().available, guarantee: "On Linux the CLI and everything it starts run in the runtime's namespace sandbox: the workspace is the only writable host path; the Tenric repository, the Python environment, the CLI's own installation and configuration are read-only; nothing else of the host's filesystem or processes is visible. Network is not restricted, because the CLI needs it to reach its model. Without a sandbox the runtime refuses this backend unless the operator overrides it, and then signs nothing. supported is true only where the sandbox can be built on this machine." },
      },
    };
  }

  async run(request: BackendRunRequest): Promise<BackendResult> {
    mkdirSync(request.recordDir, { recursive: true });
    const prompt = [
      request.instructions,
      "## Notes from the backend adapter",
      "",
      `- Your working directory is the workspace. Write every file there and nowhere else.`,
      `- To run Python with the locked packages, use exactly: uv run --locked --project ${JSON.stringify(request.repoRoot)} python <script> <arguments>`,
      `- ${request.repoRoot} is read-only and not part of the task. Do not try to change it.`,
      "- You cannot ask questions. Make reasonable choices, state them under limitations, and finish.",
      "",
    ].join("\n");
    writeFileSync(join(request.recordDir, "prompt.txt"), prompt);

    const [executable, ...leading] = this.command;
    const args = [
      ...leading, "-p", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash",
      "--disallowedTools", "WebFetch,WebSearch,Agent,Task,NotebookEdit",
      "--strict-mcp-config", "--no-session-persistence",
      "--max-budget-usd", String(request.limits.maxCostUsd),
      ...(request.model ? ["--model", request.model] : []),
    ];

    let result: Record<string, unknown> | undefined;
    let init: Record<string, unknown> | undefined;
    let unparsed = 0;
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        unparsed += 1;
        return;
      }
      if (event.type === "result") result = event;
      if (event.type === "system" && event.subtype === "init") init = event;
      if (event.type !== "assistant") return;
      const content = (event.message as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          request.onEvent?.({ type: "backend.tool_use", tool: block.name, summary: clip(input.command ?? input.file_path ?? input.pattern ?? input, 200) });
        } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          request.onEvent?.({ type: "backend.message", text: clip(block.text, 300) });
        }
      }
    };

    // Inside the sandbox a missing executable would surface as an exit code; find it here so the failure says what it is.
    // The sandbox mounts the real installation, not the symbolic link on PATH that may point at it.
    const resolved = resolveExecutable(executable!);
    if (!resolved) {
      writeJson(join(request.recordDir, "result.json"), { process: null, error: "not found" });
      return { outcome: "failed", exit_code: null, seconds: 0, detail: `could not start ${executable}: not found`, self_report: {}, isolation: null };
    }
    const wrapped = sandboxed([resolved, ...args], {
      readonly: [...this.readonlyPaths(), ...pythonPaths(request.repoRoot)],
      writable: [request.workspace], cwd: request.workspace, network: true, hidden: request.hidden,
    });
    if (!wrapped.isolation.enforced && request.requireSandbox) {
      writeJson(join(request.recordDir, "result.json"), { process: null, refused: wrapped.isolation.detail });
      return { outcome: "failed", exit_code: null, seconds: 0, detail: `refused to run without a sandbox (${wrapped.isolation.detail})`, self_report: {}, isolation: wrapped.isolation };
    }
    const done = await runProcess(wrapped.command, wrapped.args, {
      cwd: request.workspace,
      timeoutSeconds: request.limits.timeoutSeconds,
      signal: request.signal,
      stdin: prompt,
      stdoutPath: join(request.recordDir, "events.jsonl"),
      stderrPath: join(request.recordDir, "stderr.txt"),
      onStdoutLine: onLine,
    });

    const usage = result?.modelUsage;
    const self_report: Record<string, unknown> = {
      model: usage !== null && typeof usage === "object" ? Object.keys(usage).sort().join(", ") || null : (init?.model ?? null),
      requested_model: request.model ?? null,
      cli_version: init?.claude_code_version ?? null,
      cost_usd: result?.total_cost_usd ?? null,
      turns: result?.num_turns ?? null,
      duration_api_ms: result?.duration_api_ms ?? null,
      terminal_reason: result?.terminal_reason ?? result?.subtype ?? null,
      permission_denials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null,
      unparsed_stream_lines: unparsed,
    };
    writeFileSync(join(request.recordDir, "final_message.txt"), typeof result?.result === "string" ? result.result + "\n" : "");
    writeJson(join(request.recordDir, "result.json"), { process: done, self_report });

    const base = { exit_code: done.exitCode, seconds: done.seconds, self_report, isolation: wrapped.isolation };
    if (done.outcome === "timeout") return { ...base, outcome: "timeout", detail: `no result after ${request.limits.timeoutSeconds} s; process tree killed` };
    if (done.outcome === "cancelled") return { ...base, outcome: "cancelled", detail: "cancelled by the runtime" };
    if (done.outcome === "spawn_error") return { ...base, outcome: "failed", detail: `could not start ${executable}: ${done.error}` };
    if (done.exitCode !== 0) return { ...base, outcome: "failed", detail: `CLI exited with code ${done.exitCode}` };
    // Fail closed: an exit code of 0 without a result event, or with an error result, is not a completed run.
    if (!result) return { ...base, outcome: "failed", detail: "CLI exited 0 without a result event" };
    if (result.is_error === true) return { ...base, outcome: "failed", detail: `CLI reported an error result: ${clip(result.result ?? result.subtype, 200)}` };
    return { ...base, outcome: "completed" };
  }
}

/** The installation directory of an executable on PATH or given by path: its real location, two levels up from the binary. */
/** The real path of an executable given by name or path, after following symbolic links. */
function resolveExecutable(executable: string): string | undefined {
  try {
    const found = isAbsolute(executable) ? executable : execFileSync("sh", ["-c", 'command -v "$1"', "sh", executable], { encoding: "utf8" }).trim();
    return found && existsSync(found) ? realpathSync(found) : undefined;
  } catch {
    return undefined;
  }
}

/** The installation directory of an executable: two levels up from its real binary. */
function installRoot(executable: string): string | undefined {
  const found = resolveExecutable(executable);
  return found ? dirname(dirname(found)) : undefined;
}

const registry: Record<string, () => Backend> = {
  "script": () => new ScriptBackend(),
  "claude-code": () => new ClaudeCodeBackend(),
};

export function getBackend(name: string): Backend | undefined {
  return registry[name]?.();
}

export function listBackends(): BackendDescription[] {
  return Object.values(registry).map((create) => create().describe());
}
