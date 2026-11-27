// Backend adapters (RFC-0001 section 8). A backend authors a workspace; it
// never executes the experiment for the record and never writes the artifact.
// Nothing an adapter returns is evidence: exit status and files are observed
// by the runtime, and self_report is the backend's account of itself.
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
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
}
export interface BackendResult {
  outcome: "completed" | "failed" | "timeout" | "cancelled";
  exit_code: number | null;
  seconds: number;
  detail?: string;
  /** Backend-reported. Never evidence. */
  self_report: Record<string, unknown>;
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
        "sandbox": no("The copy runs in the runtime's own process."),
      },
    };
  }

  async run(request: BackendRunRequest): Promise<BackendResult> {
    const started = performance.now();
    const done = (outcome: BackendResult["outcome"], detail?: string): BackendResult => ({
      outcome, exit_code: null, seconds: Math.round(performance.now() - started) / 1000,
      ...(detail ? { detail } : {}), self_report: {},
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
        "sandbox": no("None enforced by this adapter. Bash can reach anything the runtime's user can. The runtime detects changes to the contract, the schema and the Tenric working tree after the fact; it does not prevent them."),
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
      `- Do not read or change anything under ${request.repoRoot}; it is not part of the task.`,
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

    const done = await runProcess(executable!, args, {
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

    const base = { exit_code: done.exitCode, seconds: done.seconds, self_report };
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
