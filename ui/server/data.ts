// Read-only views over the repository: contracts in spec/, runs in runs/,
// fixtures in fixtures/, documents in docs/. No state is kept (ADR-0004):
// every answer is recomputed from the files as they are now.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  exitCode, hasValidator, loadContract, PreconditionError, readJson, registration, REPO_ROOT, sha256File, verify, verifyWithReExecution,
  type VerdictRecord,
} from "./core.ts";

export const RUNS_DIR = join(REPO_ROOT, "runs");
const CONTRACTS_DIR = join(REPO_ROOT, "spec", "contracts");
const FIXTURES_DIR = join(REPO_ROOT, "fixtures");
const DOCS_DIR = join(REPO_ROOT, "docs");

/** Run ids are single path segments. Anything else is refused before it reaches the file system. */
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class NotFound extends Error {}
export class BadRequest extends Error {}

type Json = Record<string, any>;

function rel(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function dirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// ---------------------------------------------------------------- contracts

export interface ContractSummary {
  id: string;
  version: string;
  path: string;
  sha256: string;
  /** False when the verifier cannot load this file at all. The reason is in `error`. */
  usable: boolean;
  error?: string;
  /** False when the registry does not list this exact content under this id and version: no verdict can be issued under it. */
  registered: boolean;
  registration_error?: string;
  title?: string;
  artifact_type?: string;
  ir_version?: string;
  requirements?: { total: number; mandatory: number; advisory: number; machine: number; empirical: number; human: number; without_validator: number };
}

function byVersion(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if (x[i] === y[i]) continue;
    if (typeof x[i] === "number" && typeof y[i] === "number") return (x[i] as number) - (y[i] as number);
    return String(x[i] ?? "") < String(y[i] ?? "") ? -1 : 1;
  }
  return 0;
}

function contractFiles(): { id: string; version: string; path: string }[] {
  return dirs(CONTRACTS_DIR).flatMap((id) =>
    readdirSync(join(CONTRACTS_DIR, id))
      .filter((name) => name.endsWith(".contract.json"))
      .sort((a, b) => byVersion(a.slice(0, -".contract.json".length), b.slice(0, -".contract.json".length)))
      .map((name) => ({ id, version: name.slice(0, -".contract.json".length), path: join(CONTRACTS_DIR, id, name) })));
}

function summarise(file: { id: string; version: string; path: string }): ContractSummary {
  const base = { id: file.id, version: file.version, path: rel(file.path), sha256: sha256File(file.path) };
  try {
    const contract = loadContract(file.path);
    const raw = readJson(file.path) as Json;
    const registered = registration(file.path);
    const count = (test: (r: (typeof contract.requirements)[number]) => boolean) => contract.requirements.filter(test).length;
    return {
      ...base,
      id: contract.id,
      version: contract.version,
      usable: true,
      registered: registered.registered,
      registration_error: registered.reason,
      title: raw.title,
      artifact_type: raw.artifact?.type,
      ir_version: raw.artifact?.ir_version,
      requirements: {
        total: contract.requirements.length,
        mandatory: count((r) => r.level === "mandatory"),
        advisory: count((r) => r.level === "advisory"),
        machine: count((r) => r.verifiability === "machine"),
        empirical: count((r) => r.verifiability === "empirical"),
        human: count((r) => r.verifiability === "human"),
        without_validator: count((r) => !hasValidator(r.check.kind)),
      },
    };
  } catch (error) {
    return { ...base, usable: false, registered: false, error: (error as Error).message };
  }
}

export function listContracts(): ContractSummary[] {
  return contractFiles().map(summarise);
}

function findContract(id: string, version: string) {
  const file = contractFiles().find((f) => f.id === id && f.version === version);
  if (!file) throw new NotFound(`no contract ${id} version ${version}`);
  return file;
}

export function getContract(id: string, version: string) {
  const file = findContract(id, version);
  const summary = summarise(file);
  const raw = readJson(file.path) as Json;
  let requirements: Json[] = Array.isArray(raw.requirements) ? raw.requirements : [];
  requirements = requirements.map((r) => ({ ...r, validator_available: typeof r?.check?.kind === "string" && hasValidator(r.check.kind) }));
  return {
    summary,
    versions: contractFiles().filter((f) => f.id === file.id).map((f) => f.version),
    contract: raw,
    requirements,
    text: readFileSync(file.path, "utf8"),
  };
}

/** What changed between two versions of one contract: requirements added, removed and changed, then every other field. */
export function contractDiff(id: string, from: string, to: string) {
  const [a, b] = [readJson(findContract(id, from).path) as Json, readJson(findContract(id, to).path) as Json];
  const index = (c: Json) => new Map<string, Json>((Array.isArray(c.requirements) ? c.requirements : []).map((r: Json) => [String(r.id), r]));
  const [ra, rb] = [index(a), index(b)];
  const brief = (r: Json) => ({ id: r.id, title: r.title, level: r.level, verifiability: r.verifiability });
  const rest = (c: Json) => Object.fromEntries(Object.entries(c).filter(([key]) => key !== "requirements"));
  return {
    id, from, to,
    added: [...rb.values()].filter((r) => !ra.has(String(r.id))).map(brief),
    removed: [...ra.values()].filter((r) => !rb.has(String(r.id))).map(brief),
    changed: [...rb.values()].flatMap((r) => {
      const before = ra.get(String(r.id));
      const fields = before ? diffJson(before, r) : [];
      return fields.length > 0 ? [{ ...brief(r), fields }] : [];
    }),
    other: diffJson(rest(a), rest(b)),
  };
}

/** Contracts that govern this artifact type and IR version, newest version last. */
function applicableContracts(artifact: Json | null): ContractSummary[] {
  if (!artifact) return [];
  return listContracts().filter((c) => c.usable && c.registered && c.artifact_type === artifact.artifact_type && c.ir_version === artifact.ir_version);
}

// --------------------------------------------------------------------- runs

export interface RunSummary {
  id: string;
  /** "run": a directory under runs/. "fixture": hand-written demonstration data under fixtures/. */
  origin: "run" | "fixture";
  path: string;
  readable: boolean;
  error?: string;
  experiment_id?: string;
  title?: string;
  data_class?: string;
  status?: string;
  exit_code?: number | null;
  started_at?: string;
  runtime_seconds?: number;
  source?: { kind?: string; revision?: string; dirty?: boolean };
  artifact_sha256?: string;
  metrics?: { name: string; value: number }[];
  verification?: { exit_code: number; contract: string; version: string; verdict: string; passed: number; total: number; blocking: string[] };
  no_verdict?: string;
}

interface Located { id: string; origin: "run" | "fixture"; dir: string; artifactPath: string }

function locateAll(): Located[] {
  const runs = dirs(RUNS_DIR)
    .filter((id) => RUN_ID.test(id) && existsSync(join(RUNS_DIR, id, "artifact.json")))
    .map((id): Located => ({ id, origin: "run", dir: join(RUNS_DIR, id), artifactPath: join(RUNS_DIR, id, "artifact.json") }));
  const fixtures = dirs(FIXTURES_DIR).flatMap((group) =>
    readdirSync(join(FIXTURES_DIR, group))
      .filter((name) => name.endsWith(".artifact.json"))
      .sort()
      .map((name): Located => ({
        id: `fixture:${group}:${name.slice(0, -".artifact.json".length)}`,
        origin: "fixture",
        dir: join(FIXTURES_DIR, group),
        artifactPath: join(FIXTURES_DIR, group, name),
      })));
  return [...runs, ...fixtures];
}

function locate(id: string): Located {
  const found = locateAll().find((r) => r.id === id);
  if (!found) throw new NotFound(`no run ${id}`);
  return found;
}

function readArtifact(path: string): { artifact: Json | null; error?: string } {
  try {
    const artifact = readJson(path);
    if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) return { artifact: null, error: "artifact.json is not an object" };
    return { artifact: artifact as Json };
  } catch (error) {
    return { artifact: null, error: `artifact.json unreadable: ${(error as Error).message}` };
  }
}

/** Fixtures are a single file, not a run directory: there is nothing to check outputs against, so they are never verified here. */
function verifyLocated(run: Located, contractPath: string): VerdictRecord {
  return verify(run.dir, join(REPO_ROOT, contractPath));
}

function summariseRun(run: Located): RunSummary {
  const { artifact, error } = readArtifact(run.artifactPath);
  const summary: RunSummary = {
    id: run.id, origin: run.origin, path: rel(run.origin === "run" ? run.dir : run.artifactPath),
    readable: artifact !== null, error, artifact_sha256: sha256File(run.artifactPath),
  };
  if (artifact) {
    Object.assign(summary, {
      experiment_id: artifact.experiment_id,
      title: artifact.title,
      data_class: artifact.data_class,
      status: artifact.execution?.status,
      exit_code: artifact.execution?.exit_code,
      started_at: artifact.execution?.started_at,
      runtime_seconds: artifact.execution?.runtime_seconds,
      source: artifact.source && { kind: artifact.source.kind, revision: artifact.source.revision, dirty: artifact.source.dirty },
      metrics: Array.isArray(artifact.metrics) ? artifact.metrics.map((m: Json) => ({ name: m.name, value: m.value })) : [],
    });
  }
  if (run.origin === "fixture") {
    summary.no_verdict = "fixture: a single hand-written file with no run directory, so it is not verified";
    return summary;
  }
  const contract = applicableContracts(artifact).at(-1);
  if (!contract) {
    summary.no_verdict = artifact ? `no usable contract governs ${artifact.artifact_type} IR ${artifact.ir_version}` : "artifact unreadable and no contract selected";
    return summary;
  }
  try {
    const v = verifyLocated(run, contract.path);
    summary.verification = {
      exit_code: exitCode(v.verdict),
      contract: v.contract.id, version: v.contract.version, verdict: v.verdict,
      passed: v.summary.passed, total: v.summary.mandatory,
      blocking: v.results.filter((r) => r.level === "mandatory" && r.status !== "pass").map((r) => r.requirement),
    };
  } catch (error) {
    if (!(error instanceof PreconditionError)) throw error;
    summary.no_verdict = error.message;
  }
  return summary;
}

export function listRuns(): RunSummary[] {
  return locateAll().map(summariseRun).sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "run" ? -1 : 1;
    return (b.started_at ?? "").localeCompare(a.started_at ?? "") || a.id.localeCompare(b.id);
  });
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, base);
    return [relative(base, path).split(sep).join("/")];
  }).sort();
}

function inside(dir: string, path: string): boolean {
  try {
    return realpathSync(path).startsWith(realpathSync(dir) + sep);
  } catch {
    return false;
  }
}

export interface FileRow {
  path: string;
  /** Recorded in artifact.outputs. */
  listed: boolean;
  present: boolean;
  escapes: boolean;
  bytes?: number;
  sha256?: string;
  recorded?: { bytes?: number; sha256?: string; role?: string; media_type?: string; determinism?: string; provenance?: string };
  /** Size and digest on disk now, compared with what the artifact recorded. Null when not listed or not present. */
  matches: boolean | null;
}

function fileRows(run: Located, artifact: Json | null): FileRow[] {
  if (run.origin === "fixture") return [];
  const outputs: Json[] = Array.isArray(artifact?.outputs) ? artifact.outputs : [];
  const recorded = new Map(outputs.map((o) => [String(o.path), o]));
  const onDisk = walk(run.dir);
  const paths = [...new Set([...recorded.keys(), ...onDisk])].sort();
  return paths.map((path): FileRow => {
    const full = join(run.dir, path);
    const output = recorded.get(path);
    const present = existsSync(full);
    const escapes = present && !inside(run.dir, full);
    const row: FileRow = { path, listed: output !== undefined, present, escapes, matches: null };
    if (present && !escapes && statSync(full).isFile()) {
      row.bytes = statSync(full).size;
      row.sha256 = sha256File(full);
    }
    if (output) {
      row.recorded = {
        bytes: output.bytes, sha256: output.sha256, role: output.role,
        media_type: output.media_type, determinism: output.determinism, provenance: output.provenance,
      };
      row.matches = present && !escapes && row.bytes === output.bytes && row.sha256 === output.sha256;
    }
    return row;
  });
}

/** Lifecycle events, if a runtime wrote any. Read as-is; the interface assigns them no meaning beyond display. */
function readEvents(run: Located): { available: boolean; events: Json[]; malformed: number } {
  const path = join(run.dir, "tenric", "events.jsonl");
  if (run.origin === "fixture" || !existsSync(path)) return { available: false, events: [], malformed: 0 };
  let malformed = 0;
  const events = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").flatMap((line) => {
    try {
      const event = JSON.parse(line);
      if (event !== null && typeof event === "object") return [event as Json];
    } catch { /* counted below */ }
    malformed += 1;
    return [];
  });
  return { available: true, events, malformed };
}

/** Records the runtime writes under runs/<id>/tenric/. Absent for runs made by the baseline script alone. */
function readOptionalJson(run: Located, name: string): Json | null {
  const path = join(run.dir, "tenric", name);
  if (run.origin === "fixture" || !existsSync(path)) return null;
  try {
    return readJson(path) as Json;
  } catch (error) {
    return { unreadable: (error as Error).message };
  }
}

export function getRun(id: string) {
  const run = locate(id);
  const { artifact, error } = readArtifact(run.artifactPath);
  const reportPath = join(run.dir, "report.md");
  return {
    summary: summariseRun(run),
    artifact,
    artifact_error: error,
    artifact_text: readFileSync(run.artifactPath, "utf8"),
    files: fileRows(run, artifact),
    report: run.origin === "run" && existsSync(reportPath) && inside(run.dir, reportPath) ? readFileSync(reportPath, "utf8") : null,
    contracts: applicableContracts(artifact).map((c) => ({ id: c.id, version: c.version, path: c.path })),
    reproduction_tasks: run.origin === "run" ? reproductionTasks().filter((task) => task.experiment_id === artifact?.experiment_id) : [],
    events: readEvents(run),
    runtime: {
      run: readOptionalJson(run, "run.json"),
      plan: readOptionalJson(run, "plan.json"),
      verification: readOptionalJson(run, "verification.json"),
    },
  };
}

/** Task files the verifier can re-execute: experiments/<name>/task.json. */
export function reproductionTasks(): { path: string; experiment_id: string | null }[] {
  return dirs(join(REPO_ROOT, "experiments")).flatMap((name) => {
    const path = `experiments/${name}/task.json`;
    if (!existsSync(join(REPO_ROOT, path))) return [];
    try {
      const task = readJson(join(REPO_ROOT, path)) as Json;
      return [{ path, experiment_id: typeof task.experiment_id === "string" ? task.experiment_id : null }];
    } catch {
      return [{ path, experiment_id: null }];
    }
  });
}

export type VerifyOutcome =
  | { issued: true; record: VerdictRecord; exit_code: number; requirements: Json[] }
  | { issued: false; no_verdict: string };

export interface VerifyOptions { contractId?: string; contractVersion?: string; reproduceTask?: string }

export async function verifyRun(id: string, options: VerifyOptions = {}): Promise<VerifyOutcome> {
  const run = locate(id);
  if (run.origin === "fixture") {
    return { issued: false, no_verdict: "fixtures are single hand-written files with no run directory; there is nothing to verify outputs against" };
  }
  let path: string;
  if (options.contractId && options.contractVersion) {
    path = rel(findContract(options.contractId, options.contractVersion).path);
  } else {
    const fallback = applicableContracts(readArtifact(run.artifactPath).artifact).at(-1);
    if (!fallback) return { issued: false, no_verdict: "no usable, registered contract governs this artifact type and IR version" };
    path = fallback.path;
  }
  if (options.reproduceTask !== undefined && !reproductionTasks().some((task) => task.path === options.reproduceTask)) {
    throw new BadRequest("reproduce_task must be one of the task files under experiments/");
  }
  try {
    // Repository-relative paths, so the record reads the same as one made by the command line from the repository root.
    const record = options.reproduceTask === undefined
      ? verifyLocated(run, path)
      : await verifyWithReExecution(rel(run.dir), path, options.reproduceTask);
    const raw = readJson(join(REPO_ROOT, path)) as Json;
    return {
      issued: true,
      record: { ...record, contract: { ...record.contract, path }, artifact: { ...record.artifact, path: rel(join(run.dir, "artifact.json")) } },
      exit_code: exitCode(record.verdict),
      // Rationale and parameters come from the contract file, for display beside each result.
      requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    };
  } catch (error) {
    // RFC-0001 section 7.2 rule 6: a precondition failure produces no verdict. Any other error is a fault and is not disguised as one.
    if (error instanceof PreconditionError) return { issued: false, no_verdict: error.message };
    throw error;
  }
}

const MEDIA: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** A file from a run directory. Never served as HTML or SVG: run output is produced by untrusted code. */
export function runFile(id: string, path: string): { body: Buffer; type: string } {
  const run = locate(id);
  if (run.origin !== "run") throw new NotFound("fixtures have no files");
  if (path === "" || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new BadRequest("bad path");
  const full = join(run.dir, ...path.split("/"));
  if (!existsSync(full) || !statSync(full).isFile()) throw new NotFound(`no file ${path} in run ${id}`);
  if (!inside(run.dir, full)) throw new BadRequest(`${path} resolves outside the run directory`);
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return { body: readFileSync(full), type: MEDIA[extension] ?? "application/octet-stream" };
}

// ------------------------------------------------------------------ compare

function flatten(value: unknown, pointer: string, out: Map<string, unknown>): void {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    if (entries.length === 0) out.set(pointer, Array.isArray(value) ? [] : {});
    for (const [key, child] of entries) flatten(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, out);
  } else {
    out.set(pointer, value);
  }
}

export interface Difference { pointer: string; a?: unknown; b?: unknown; in_a: boolean; in_b: boolean; volatile: boolean }

/** Leaf-by-leaf differences between two JSON documents, by JSON pointer. */
export function diffJson(a: unknown, b: unknown, volatile: string[] = []): Difference[] {
  const left = new Map<string, unknown>();
  const right = new Map<string, unknown>();
  flatten(a, "", left);
  flatten(b, "", right);
  const isVolatile = (pointer: string) => volatile.some((v) => pointer === v || pointer.startsWith(v + "/"));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((pointer): Difference[] => {
    const inA = left.has(pointer), inB = right.has(pointer);
    if (inA && inB && JSON.stringify(left.get(pointer)) === JSON.stringify(right.get(pointer))) return [];
    return [{ pointer, a: left.get(pointer), b: right.get(pointer), in_a: inA, in_b: inB, volatile: isVolatile(pointer) }];
  });
}

export function compareRuns(idA: string, idB: string) {
  const [a, b] = [getRun(idA), getRun(idB)];
  // A field counts as volatile only if both artifacts declare it so.
  const declared = (run: typeof a): string[] => (Array.isArray(run.artifact?.volatile_fields) ? run.artifact.volatile_fields : []);
  const volatile = declared(a).filter((pointer) => declared(b).includes(pointer));
  const differences = a.artifact && b.artifact ? diffJson(a.artifact, b.artifact, volatile) : [];

  const outputsOf = (run: typeof a) => new Map<string, Json>((Array.isArray(run.artifact?.outputs) ? run.artifact.outputs : []).map((o: Json) => [String(o.path), o]));
  const [outA, outB] = [outputsOf(a), outputsOf(b)];
  const outputs = [...new Set([...outA.keys(), ...outB.keys()])].sort().map((path) => {
    const [x, y] = [outA.get(path), outB.get(path)];
    return {
      path,
      determinism: x?.determinism ?? y?.determinism ?? null,
      a: x ? { sha256: x.sha256, bytes: x.bytes } : null,
      b: y ? { sha256: y.sha256, bytes: y.bytes } : null,
      identical: x && y ? x.sha256 === y.sha256 && x.bytes === y.bytes : null,
    };
  });

  const metricsOf = (run: typeof a) => new Map<string, unknown>((Array.isArray(run.artifact?.metrics) ? run.artifact.metrics : []).map((m: Json) => [String(m.name), m.value]));
  const [metA, metB] = [metricsOf(a), metricsOf(b)];
  const metrics = [...new Set([...metA.keys(), ...metB.keys()])].sort().map((name) => {
    const [x, y] = [metA.get(name), metB.get(name)];
    const numeric = typeof x === "number" && typeof y === "number";
    return { name, a: x ?? null, b: y ?? null, delta: numeric ? (y as number) - (x as number) : null, identical: metA.has(name) && metB.has(name) ? x === y : null };
  });

  return {
    a: a.summary,
    b: b.summary,
    comparable: a.artifact !== null && b.artifact !== null,
    volatile_fields: volatile,
    differences,
    counts: {
      total: differences.length,
      volatile: differences.filter((d) => d.volatile).length,
      other: differences.filter((d) => !d.volatile).length,
    },
    outputs,
    metrics,
  };
}

// --------------------------------------------------------------------- docs

export interface DocSummary { path: string; group: string; title: string; status: string | null }

export function listDocs(): DocSummary[] {
  const files = [join(REPO_ROOT, "README.md"), join(REPO_ROOT, "AGENTS.md")]
    .concat(existsSync(DOCS_DIR) ? walk(DOCS_DIR).map((p) => join(DOCS_DIR, ...p.split("/"))) : [])
    .filter((path) => path.endsWith(".md") && existsSync(path));
  return files.map((path) => {
    const text = readFileSync(path, "utf8");
    const relative_ = rel(path);
    const parts = relative_.split("/");
    const top = text.split("\n").slice(0, 12).join("\n");
    const status = /^\|\s*Status\s*\|\s*(.+?)\s*\|\s*$/m.exec(top)?.[1] ?? /^Status:\s*(.+)$/m.exec(top)?.[1] ?? null;
    return {
      path: relative_,
      group: parts.length >= 3 ? parts[1]! : parts.length === 2 ? "docs" : "repository",
      title: /^#\s+(.+)$/m.exec(text)?.[1] ?? relative_,
      status: status ? status.replaceAll("**", "") : null,
    };
  });
}

export function getDoc(path: string): { path: string; text: string } {
  const doc = listDocs().find((d) => d.path === path);
  if (!doc) throw new NotFound(`no document ${path}`);
  return { path: doc.path, text: readFileSync(join(REPO_ROOT, ...doc.path.split("/")), "utf8") };
}
