// Comparison group B (docs/evaluation-plan.md): the agent gets the standard as
// instructions and produces the artifact itself. The verifier is unchanged.
// See README.md in this directory for what a verdict means here.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../../src/spec.ts";
import { PreconditionError, verify } from "../../src/verify.ts";
import { ClaudeCodeBackend } from "../../src/runtime/backends.ts";
import type { Task } from "../../src/runtime/schemas.ts";
import { git, readJson, toPosix, utcNow, writeJson } from "../../src/runtime/util.ts";

const { values } = parseArgs({ options: { task: { type: "string" }, model: { type: "string" }, out: { type: "string" } } });
if (!values.task || !values.out) {
  console.error("usage: node evaluation/group-b/run.ts --task <file> --out <dir> [--model <id>]");
  process.exit(2);
}
const out = resolve(values.out);
if (existsSync(out)) {
  console.error(`refusing to run: ${out} exists`);
  process.exit(2);
}
const task = readJson(values.task) as Task;
const contractPath = `spec/contracts/${task.contract.id}/${task.contract.version}.contract.json`;
const packages = [...(/^dependencies\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(REPO_ROOT + "pyproject.toml", "utf8"))?.[1] ?? "").matchAll(/"([A-Za-z0-9_.-]+)/g)].map((m) => m[1]).sort();
const fill: Record<string, string> = {
  title: task.title, id: task.id, brief: task.brief ?? "", contract_id: task.contract.id, contract_version: task.contract.version,
  contract: readFileSync(REPO_ROOT + contractPath, "utf8").trim(),
  schema: readFileSync(REPO_ROOT + "spec/research-report.artifact.schema.json", "utf8").trim(),
  packages: packages.join(", "), timeout: String(task.limits?.execution_timeout_seconds ?? 300),
};
const instructions = readFileSync(new URL("./prompt.md", import.meta.url), "utf8").replace(/\{\{(\w+)\}\}/g, (_, key: string) => fill[key] ?? "");

const staging = mkdtempSync(join(tmpdir(), "tenric-group-b-"));
git(staging, "init", "-q");
mkdirSync(join(out, "record"), { recursive: true });
const started_at = utcNow();
const backend = await new ClaudeCodeBackend().run({
  task, instructions, workspace: staging, recordDir: join(out, "record", "backend"), repoRoot: REPO_ROOT,
  limits: { timeoutSeconds: task.limits?.backend_timeout_seconds ?? 1200, maxCostUsd: task.limits?.backend_max_cost_usd ?? 10 },
  model: values.model,
});
const workspace = join(out, "workspace");
cpSync(staging, workspace, { recursive: true, verbatimSymlinks: true });
rmSync(staging, { recursive: true, force: true });

// The same verifier and the same re-execution as for every other group, driven by the agent's own collect.py.
const reproduceTask = join(out, "record", "reproduce.task.json");
writeJson(reproduceTask, {
  task_schema: "0.1.0", experiment_id: task.id, timeout_seconds: 600,
  collect: ["uv", "run", "--locked", "--project", toPosix(REPO_ROOT), "python", "collect.py", "--config", "{config}", "--out", "{out}"],
});
let record: unknown = null;
let no_verdict: string | null = null;
const runDir = join(workspace, "run");
if (!existsSync(join(runDir, "artifact.json"))) no_verdict = "the agent delivered no run/artifact.json";
else {
  try {
    record = verify({ runDir, contractPath: REPO_ROOT + contractPath, repo: workspace, reproduce: { taskPath: reproduceTask } });
  } catch (error) {
    if (!(error instanceof PreconditionError)) throw error;
    no_verdict = error.message;
  }
}
writeJson(join(out, "record", "group-b.json"), {
  group: "B", task: task.id, contract: { id: task.contract.id, version: task.contract.version }, started_at, finished_at: utcNow(),
  backend: { name: "claude-code", outcome: backend.outcome, seconds: backend.seconds, detail: backend.detail ?? null, self_report: backend.self_report },
  no_verdict, verification: record,
});
const verdict = (record as { statement?: string } | null)?.statement;
console.log(verdict ? `verdict: ${verdict}` : `no verdict issued: ${no_verdict}`);
