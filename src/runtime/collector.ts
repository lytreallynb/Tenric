// The runtime's collector for artifact type research.experiment-report.
// It executes the producer's experiment as a child process and assembles the
// Artifact IR from what it observes. The producer's claims.json contributes
// names, pointers and prose; every digest, status, time and metric value in
// the artifact is read by this file from bytes on disk.
//
// It never imports or evaluates producer code, and it writes provenance
// "collector" only on records it observed itself.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubbedEnvironment } from "../reproduce.ts";
import { keyDir } from "./keys.ts";
import { renderReport } from "./report.ts";
import { pythonPaths, sandboxed, type IsolationRecord } from "./sandbox.ts";
import { validateClaims, type Claims, type Determinism, type Task } from "./schemas.ts";
import { git, runProcess, sha256File, stableJson, toPosix, utcNow } from "./util.ts";

const PROBE = fileURLToPath(new URL("./probe.py", import.meta.url));
export const PINNED_ENV: Record<string, string> = {
  PYTHONHASHSEED: "0",
  PYTHONDONTWRITEBYTECODE: "1",
  OMP_NUM_THREADS: "1",
  OPENBLAS_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  MPLBACKEND: "Agg",
  TZ: "UTC",
  LC_ALL: "C.UTF-8",
};
export const EXECUTION_COMMAND = ["python", "experiment.py", "--config", "config.json", "--out", "<out>"];
/** Names at the root of a run directory that are not experiment outputs. */
const RESERVED = new Set(["artifact.json", "report.md", "tenric", "workspace"]);
const MEDIA_TYPES: Record<string, string> = {
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".csv": "text/csv",
  ".md": "text/markdown", ".txt": "text/plain", ".log": "text/plain", ".npy": "application/octet-stream",
};

type Provenance = "collector" | "producer" | "template" | "human";
export interface OutputRecord { path: string; role: string; media_type: string; bytes: number; sha256: string; determinism: Determinism; provenance: Provenance }
export interface Artifact {
  ir_version: "0.1.0";
  artifact_type: "research.experiment-report";
  experiment_id: string;
  title: string;
  data_class: "measured" | "fixture";
  source: { kind: "git" | "none"; revision?: string; dirty?: boolean; provenance: Provenance };
  environment: {
    os: string; os_release?: string; arch: string; python: string; python_implementation?: string;
    packages: Record<string, string>; lockfile: { path: string; sha256: string }; pinned_env: Record<string, string>; provenance: Provenance;
  };
  dataset?: { name: string; version: string; file: string; sha256: string; producer_claims?: Record<string, unknown>; provenance: Provenance };
  config?: { path: string; sha256: string; values: Record<string, unknown>; seed?: number | null; provenance: Provenance };
  execution: { command: string[]; status: "succeeded" | "failed" | "timeout" | "cancelled"; exit_code: number | null; started_at: string; runtime_seconds: number; provenance: Provenance };
  metrics: { name: string; value: number; unit?: string; source_output: string; json_pointer: string; provenance: Provenance }[];
  outputs: OutputRecord[];
  figures: { id: string; spec_output: string; image_output: string; renderer: { name: string; version: string } }[];
  findings: { id: string; statement: string; supported_by: string[]; provenance: Provenance }[];
  limitations: string[];
  reproduction: { commands: string[]; expectation: string };
  volatile_fields: string[];
  failure?: { reason: string; stderr_tail?: string };
}

/** The collector itself could not do its job. Nothing can be concluded about the producer. */
export class CollectorError extends Error {}

export interface CollectOptions {
  workspace: string;
  /** Where the experiment writes and where artifact.json goes. */
  outDir: string;
  /** Where stdout and stderr of the experiment are kept. */
  recordDir: string;
  task: Pick<Task, "id" | "title" | "data_class">;
  repoRoot: string;
  executionTimeoutSeconds: number;
  signal?: AbortSignal;
  /** Set when the backend did not finish: the experiment is not executed and the artifact records why. */
  notExecuted?: { status: "failed" | "timeout" | "cancelled"; reason: string };
  /** Set to false for a comparison execution that should leave no report behind. */
  writeArtifact?: boolean;
  /** Paths the experiment must not be able to read. Default: the runtime's key directory. */
  hidden?: string[];
}
export interface CollectResult {
  artifact: Artifact;
  status: Artifact["execution"]["status"];
  detail: string | null;
  /** Things a human reviewer should look at. Not evidence and not part of the verdict. */
  review_notes: string[];
  /** How the experiment's process was confined. Null when it was not executed. */
  isolation: IsolationRecord | null;
}

function scrubbedEnv(): NodeJS.ProcessEnv {
  // The same allowlist the verifier's re-execution uses (src/reproduce.ts), so the execution for the record and
  // the re-execution see the same environment. Passing the caller's environment through let a host-wide
  // MATPLOTLIBRC change the figures of the first execution only; the verifier's re-execution caught that.
  return { ...scrubbedEnvironment(), ...PINNED_ENV };
}

function resolvePointer(document: unknown, pointer: string): unknown {
  let node = document;
  for (const token of pointer.split("/").slice(1)) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function inside(dir: string, path: string): boolean {
  return realpathSync(path).startsWith(realpathSync(dir) + sep);
}

/** Every regular file under the output directory, as sorted POSIX-style relative paths. Symlinks are reported, never followed. */
function walkOutputs(outDir: string): { files: string[]; symlinks: string[] } {
  const files: string[] = [];
  const symlinks: string[] = [];
  const visit = (dir: string, top: boolean) => {
    for (const name of readdirSync(dir).sort()) {
      if (top && RESERVED.has(name)) continue;
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) symlinks.push(toPosix(relative(outDir, path)));
      else if (stat.isDirectory()) visit(path, false);
      else if (stat.isFile()) files.push(toPosix(relative(outDir, path)));
    }
  };
  visit(outDir, true);
  return { files: files.sort(), symlinks };
}

const SLOT = /\{\{metric:([a-z][a-z0-9_]*)(?::(\d))?\}\}/g;

export async function collect(options: CollectOptions): Promise<CollectResult> {
  const { workspace, outDir, recordDir, task, repoRoot } = options;
  mkdirSync(outDir, { recursive: true });
  mkdirSync(recordDir, { recursive: true });
  const problems: string[] = [];
  const review_notes: string[] = [];

  // Source identity, before anything is executed.
  let revision: string;
  let dirty: boolean;
  try {
    revision = git(workspace, "rev-parse", "HEAD");
    dirty = git(workspace, "status", "--porcelain") !== "";
  } catch (error) {
    throw new CollectorError(`workspace ${workspace} is not a git repository with a commit: ${String(error)}`);
  }

  // What the producer claims. Parsed as data, validated against a schema that has no room for evidence fields.
  let claims: Claims | undefined;
  const claimsPath = join(workspace, "claims.json");
  if (!existsSync(claimsPath)) problems.push("claims.json is missing");
  else {
    try {
      const parsed: unknown = JSON.parse(readFileSync(claimsPath, "utf8"));
      if (validateClaims(parsed)) claims = parsed as Claims;
      else problems.push(`claims.json does not conform to the claims schema: ${JSON.stringify(validateClaims.errors)}`);
    } catch (error) {
      problems.push(`claims.json is not JSON: ${String(error)}`);
    }
  }
  let config: Artifact["config"];
  const configPath = join(workspace, "config.json");
  if (!existsSync(configPath)) problems.push("config.json is missing");
  else {
    let values: unknown;
    try {
      values = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
      problems.push(`config.json is not JSON: ${String(error)}`);
    }
    const isObject = values !== null && typeof values === "object" && !Array.isArray(values);
    if (values !== undefined && !isObject) problems.push("config.json is not a JSON object");
    const record = (isObject ? values : {}) as Record<string, unknown>;
    const seed = record.seed;
    config = {
      path: "config.json", sha256: sha256File(configPath), values: record,
      ...(seed === null || Number.isInteger(seed) ? { seed: seed as number | null } : {}),
      provenance: "collector",
    };
  }
  if (!existsSync(join(workspace, "experiment.py"))) problems.push("experiment.py is missing");

  // Environment, observed by a probe that imports nothing from the workspace.
  const packageFile = claims?.dataset.file.startsWith("package:") ? claims.dataset.file.slice("package:".length) : undefined;
  let probe: { os: string; os_release: string; arch: string; python: string; python_implementation: string; packages: Record<string, string>; located: { path: string; distribution: string | null; version: string | null } | null };
  try {
    probe = JSON.parse(execFileSync("uv", ["run", "--locked", "--project", repoRoot, "python", PROBE, ...(packageFile ? [packageFile] : [])],
      { cwd: repoRoot, env: scrubbedEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    throw new CollectorError(`environment probe failed: ${String(error)}`);
  }
  const { located, ...observed } = probe;
  const environment: Artifact["environment"] = {
    ...observed,
    lockfile: { path: "uv.lock", sha256: sha256File(join(repoRoot, "uv.lock")) },
    pinned_env: PINNED_ENV,
    provenance: "collector",
  };

  // Execution. The collector starts the process, so status, exit code and time are its own observations.
  let execution: Artifact["execution"];
  let stderrTail = "";
  const notExecuted = options.notExecuted ?? (problems.length > 0 ? { status: "failed" as const, reason: `producer interface not met: ${problems.join("; ")}` } : undefined);
  let failure: string | undefined = notExecuted?.reason;
  let isolation: IsolationRecord | null = null;
  const reservedWritten: string[] = [];
  const started_at = utcNow();
  if (notExecuted) {
    execution = { command: EXECUTION_COMMAND, status: notExecuted.status, exit_code: null, started_at, runtime_seconds: 0, provenance: "collector" };
  } else {
    const stderrPath = join(recordDir, "execution.stderr.txt");
    // The experiment writes into an empty directory of its own, in a sandbox where the workspace is read-only,
    // there is no network, and nothing of the run directory or the runtime's key is visible. Its files are
    // moved into outDir afterwards.
    const execDir = mkdtempSync(join(tmpdir(), "tenric-exec-"));
    const wrapped = sandboxed(["uv", "run", "--locked", "--project", repoRoot, "python", "experiment.py", "--config", "config.json", "--out", execDir], {
      readonly: [...pythonPaths(repoRoot), workspace], writable: [execDir], cwd: workspace, network: false, hidden: options.hidden ?? [keyDir()],
    });
    isolation = wrapped.isolation;
    const done = await runProcess(wrapped.command, wrapped.args, {
      cwd: workspace, env: scrubbedEnv(), timeoutSeconds: options.executionTimeoutSeconds, signal: options.signal,
      stdoutPath: join(recordDir, "execution.stdout.txt"), stderrPath,
    });
    for (const name of readdirSync(execDir)) {
      if (name === "tenric" || name === "workspace") reservedWritten.push(name);
      else cpSync(join(execDir, name), join(outDir, name), { recursive: true, verbatimSymlinks: true });
    }
    rmSync(execDir, { recursive: true, force: true });
    stderrTail = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8").slice(-2000) : "";
    const status = done.outcome === "timeout" ? "timeout" : done.outcome === "cancelled" ? "cancelled" : done.outcome === "exited" && done.exitCode === 0 ? "succeeded" : "failed";
    if (status === "timeout") failure = `experiment exceeded ${options.executionTimeoutSeconds} s and was killed`;
    else if (status === "cancelled") failure = "experiment was cancelled";
    else if (status === "failed") failure = done.outcome === "spawn_error" ? `experiment could not be started: ${done.error}` : `experiment exited with code ${done.exitCode}`;
    execution = { command: EXECUTION_COMMAND, status, exit_code: done.exitCode, started_at, runtime_seconds: done.seconds, provenance: "collector" };
  }
  // An experiment that edits its own source is no longer the revision that was recorded.
  dirty ||= git(workspace, "status", "--porcelain") !== "";

  // Outputs: every file found, whether the producer declared it or not.
  const { files, symlinks } = walkOutputs(outDir);
  const declared = new Map((claims?.outputs ?? []).map((o) => [o.path, o]));
  const figureSpecs = new Set((claims?.figures ?? []).map((f) => f.spec_output));
  const figureImages = new Set((claims?.figures ?? []).map((f) => f.image_output));
  const datasetOutput = claims?.dataset.file.startsWith("output:") ? claims.dataset.file.slice("output:".length) : undefined;
  const outputs: OutputRecord[] = files.map((path) => {
    const inferredRole = path === "metrics.json" ? "metrics" : figureSpecs.has(path) ? "figure-spec" : figureImages.has(path) ? "figure" : path === datasetOutput ? "data" : "other";
    const byDefault: Determinism = inferredRole === "metrics" || inferredRole === "figure" || inferredRole === "figure-spec" ? "byte-identical" : "volatile";
    return {
      path,
      role: declared.get(path)?.role ?? inferredRole,
      media_type: MEDIA_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      bytes: statSync(join(outDir, path)).size,
      sha256: sha256File(join(outDir, path)),
      determinism: declared.get(path)?.determinism ?? byDefault,
      provenance: "collector",
    };
  });
  const present = new Set(files);

  // Everything below reads the hashed bytes; nothing is taken from the producer's word.
  const late: string[] = [];
  const metrics: Artifact["metrics"] = [];
  const figures: Artifact["figures"] = [];
  const findings: Artifact["findings"] = [];
  let dataset: Artifact["dataset"];
  if (claims) {
    const producer_claims = { name: claims.dataset.name, version: claims.dataset.version, ...(claims.dataset.description ? { description: claims.dataset.description } : {}), provenance: "producer" };
    const [scheme, path] = [claims.dataset.file.slice(0, claims.dataset.file.indexOf(":")), claims.dataset.file.slice(claims.dataset.file.indexOf(":") + 1)];
    let file: string | undefined;
    let version = "";
    if (scheme === "workspace") {
      const candidate = join(workspace, path);
      if (existsSync(candidate) && statSync(candidate).isFile() && inside(workspace, candidate)) [file, version] = [candidate, `workspace revision ${revision.slice(0, 12)}`];
    } else if (scheme === "output") {
      if (present.has(path)) [file, version] = [join(outDir, path), "generated by this execution"];
    } else if (located) {
      [file, version] = [located.path, `${located.distribution ?? "unknown distribution"} ${located.version ?? ""}`.trim()];
    }
    if (file) dataset = { name: path, version, file: claims.dataset.file, sha256: sha256File(file), producer_claims, provenance: "collector" };
    else if (execution.status === "succeeded" || scheme !== "output") late.push(`dataset file ${claims.dataset.file} was not found`);
  }

  if (execution.status === "succeeded" && claims) {
    if (symlinks.length > 0) late.push(`outputs must be regular files, found symlinks: ${symlinks.join(", ")}`);
    for (const name of ["artifact.json", "report.md"]) if (existsSync(join(outDir, name))) late.push(`the experiment wrote ${name}, which only the runtime may write`);
    for (const name of reservedWritten) late.push(`the experiment wrote ${name}/, a name reserved for the runtime; it was not kept`);
    let produced: unknown;
    if (!present.has("metrics.json")) late.push("the experiment wrote no metrics.json");
    else {
      try {
        produced = JSON.parse(readFileSync(join(outDir, "metrics.json"), "utf8"));
      } catch (error) {
        late.push(`metrics.json is not JSON: ${String(error)}`);
      }
    }
    const values = new Map<string, number>();
    if (produced !== undefined) {
      for (const metric of claims.metrics) {
        const value = resolvePointer(produced, metric.json_pointer);
        if (typeof value !== "number" || !Number.isFinite(value)) late.push(`metric ${metric.name}: no finite number at ${metric.json_pointer} in metrics.json`);
        else if (values.has(metric.name)) late.push(`metric ${metric.name} is declared twice`);
        else {
          values.set(metric.name, value);
          // The pointer is the producer's claim about where the number is. The value is what the collector read there.
          metrics.push({ name: metric.name, value, ...(metric.unit ? { unit: metric.unit } : {}), source_output: "metrics.json", json_pointer: metric.json_pointer, provenance: "producer" });
        }
      }
    }
    for (const figure of claims.figures ?? []) {
      const missing = [figure.spec_output, figure.image_output].filter((path) => !present.has(path));
      if (missing.length > 0) late.push(`figure ${figure.id}: ${missing.join(", ")} not written`);
      else {
        const name = figure.renderer ?? "matplotlib";
        figures.push({ id: figure.id, spec_output: figure.spec_output, image_output: figure.image_output, renderer: { name, version: environment.packages[name.toLowerCase()] ?? "unknown" } });
      }
    }
    for (const path of declared.keys()) if (!present.has(path)) late.push(`declared output ${path} was not written`);
    for (const finding of claims.findings) {
      const statement = finding.statement.replace(SLOT, (slot, name: string, decimals: string | undefined) => {
        const value = values.get(name);
        if (value === undefined) {
          late.push(`finding ${finding.id}: slot ${slot} names no declared metric`);
          return slot;
        }
        return decimals === undefined ? String(value) : value.toFixed(Number(decimals));
      });
      if (/\d+\.\d+/.test(finding.statement.replace(SLOT, ""))) review_notes.push(`finding ${finding.id} contains a decimal number typed by the producer rather than filled from a metric`);
      findings.push({ id: finding.id, statement, supported_by: finding.supported_by, provenance: "producer" });
    }
    if (late.length > 0) {
      // The process exited 0 and still did not deliver what it declared. That is a failed execution, not a successful one with gaps.
      failure = `producer interface not met after execution: ${late.join("; ")}`;
      execution = { ...execution, status: "failed" };
    }
  } else if (late.length > 0 && failure !== undefined) {
    failure += `; ${late.join("; ")}`;
  }
  const succeeded = execution.status === "succeeded";

  const byteIdentical = outputs.filter((o) => o.determinism === "byte-identical").map((o) => o.path);
  const artifact: Artifact = {
    ir_version: "0.1.0",
    artifact_type: "research.experiment-report",
    experiment_id: task.id,
    title: task.title,
    data_class: task.data_class ?? "measured",
    source: { kind: "git", revision, dirty, provenance: "collector" },
    environment,
    ...(dataset ? { dataset } : {}),
    ...(config ? { config } : {}),
    execution,
    metrics: succeeded ? metrics : [],
    outputs,
    figures: succeeded ? figures : [],
    findings: succeeded ? findings : [],
    limitations: succeeded && claims ? claims.limitations : [],
    reproduction: {
      commands: ["npm ci", "uv sync --locked", `node src/tenric.ts collect --workspace <checkout of workspace revision ${revision}> --out <empty directory>`],
      expectation: byteIdentical.length > 0
        ? `In the locked environment on the same platform these outputs are declared byte-identical: ${byteIdentical.join(", ")}. Every other output may differ.`
        : "No output is declared byte-identical; only the structure of the outputs is expected to repeat.",
    },
    volatile_fields: ["/execution/started_at", "/execution/runtime_seconds"],
    ...(failure !== undefined ? { failure: { reason: failure, ...(stderrTail ? { stderr_tail: stderrTail } : {}) } } : {}),
  };

  if (options.writeArtifact !== false) {
    if (succeeded) {
      writeFileSync(join(outDir, "report.md"), renderReport(artifact));
      artifact.outputs.push({
        path: "report.md", role: "report", media_type: "text/markdown", bytes: statSync(join(outDir, "report.md")).size,
        sha256: sha256File(join(outDir, "report.md")), determinism: "volatile", provenance: "collector",
      });
      const index = artifact.outputs.length - 1;
      artifact.volatile_fields.push(`/outputs/${index}/sha256`, `/outputs/${index}/bytes`);
    }
    writeFileSync(join(outDir, "artifact.json"), stableJson(artifact));
  }
  return { artifact, status: execution.status, detail: failure ?? null, review_notes, isolation };
}

/** Directory of this file, for callers that need to name the runtime in a command. */
export const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
