// The one entry point that issues a verdict. It binds the verdict to what it was
// computed from (RFC-0001 section 7.2 rule 5): the contract's content, the
// artifact's content and the verifier's own source revision.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { runChecks } from "./checks.ts";
import { DEFAULT_REGISTRY_PATH, loadRegisteredContract, REPO_ROOT, sha256File, type Level, type Requirement } from "./spec.ts";
import { decide, type CheckStatus, type Verdict } from "./verdict.ts";

/** Verification could not start (RFC-0001 section 7.2 rule 6). No verdict exists; this is the caller's failure, not the producer's. */
export class PreconditionError extends Error {}

export interface VerifyOptions {
  runDir: string;
  contractPath: string;
  /** Repository the artifact's source revision must exist in. Defaults to the one containing the run directory. */
  repo?: string;
  /** Re-execute the task so that numeric-reproduction can be decided. */
  reproduce?: { taskPath: string };
  /** Registry the contract must be listed in. Defaults to the verifier's own spec/contracts/registry.json. */
  registryPath?: string;
}

export interface RequirementResult {
  requirement: string;
  title: string;
  level: Level;
  verifiability: Requirement["verifiability"];
  kind: string;
  status: CheckStatus;
  detail?: string;
}

export interface VerdictRecord {
  record_schema: "0.1.0";
  verdict: Verdict;
  /** The only sentence to quote. Wording fixed by RFC-0001 section 7.2 rule 8: a verdict is not a truth claim. */
  statement: string;
  issued_at: string;
  contract: { id: string; version: string; path: string; sha256: string; registered: true; registry_sha256: string };
  artifact: { path: string; sha256: string | null };
  /** null when the verifier is not running from a git checkout. dirty means the verifier's own code had uncommitted changes. */
  verifier: { revision: string | null; dirty: boolean | null };
  reproduction: { requested: boolean; task_sha256?: string };
  /** Capabilities the contract requires of the environment. This verifier cannot establish any of them (docs/trust-model.md). */
  capabilities: { required: string[]; established: string[] };
  results: RequirementResult[];
  summary: { mandatory: number; passed: number; machine: number; empirical: number; human: number };
}

function verifierIdentity(): VerdictRecord["verifier"] {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    // Only meaningful when the verifier's files are the root of their own checkout.
    if (git("rev-parse", "--show-prefix") !== "") return { revision: null, dirty: null };
    return { revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain") !== "" };
  } catch {
    return { revision: null, dirty: null };
  }
}

export function verify(options: VerifyOptions): VerdictRecord {
  const { runDir, contractPath } = options;
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) throw new PreconditionError(`${runDir} is not a directory`);
  let bound;
  try {
    bound = loadRegisteredContract(contractPath, options.registryPath ?? DEFAULT_REGISTRY_PATH);
  } catch (error) {
    throw new PreconditionError(`cannot use contract ${contractPath}: ${(error as Error).message}`);
  }
  let taskSha: string | undefined;
  if (options.reproduce) {
    try {
      taskSha = sha256File(options.reproduce.taskPath);
    } catch (error) {
      throw new PreconditionError(`cannot read task file ${options.reproduce.taskPath}: ${(error as Error).message}`);
    }
  }

  const { contract } = bound;
  const checked = runChecks(contract, runDir, { repo: options.repo, reproduce: options.reproduce });
  const { verdict } = decide(contract, checked);
  const byId = new Map(checked.map((result) => [result.requirement, result]));
  const results = contract.requirements.map((requirement): RequirementResult => {
    const result = byId.get(requirement.id)!;
    return {
      requirement: requirement.id, title: requirement.title, level: requirement.level,
      verifiability: requirement.verifiability, kind: requirement.check.kind, status: result.status,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  });

  const mandatory = results.filter((r) => r.level === "mandatory");
  const passed = mandatory.filter((r) => r.status === "pass");
  const count = (kind: string) => passed.filter((r) => r.verifiability === kind).length;
  const summary = { mandatory: mandatory.length, passed: passed.length, machine: count("machine"), empirical: count("empirical"), human: count("human") };
  const artifactPath = join(runDir, "artifact.json");
  return {
    record_schema: "0.1.0",
    verdict,
    statement:
      `${verdict} under contract ${contract.id} version ${contract.version}: ` +
      `${summary.passed} of ${summary.mandatory} mandatory requirements passed ` +
      `(${summary.machine} machine, ${summary.empirical} empirical, ${summary.human} human)`,
    issued_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    contract: { id: contract.id, version: contract.version, path: contractPath, sha256: bound.sha256, registered: true, registry_sha256: bound.registry.sha256 },
    artifact: { path: artifactPath, sha256: existsSync(artifactPath) ? sha256File(artifactPath) : null },
    verifier: verifierIdentity(),
    reproduction: options.reproduce ? { requested: true, task_sha256: taskSha! } : { requested: false },
    capabilities: { required: contract.applicability?.requires_capabilities ?? [], established: [] },
    results,
    summary,
  };
}

/** Exit status for tooling: 0 accepted, 1 rejected, 3 inconclusive. 2 is reserved for "no verdict issued". */
export function exitCode(verdict: Verdict): number {
  return verdict === "accepted" ? 0 : verdict === "rejected" ? 1 : 3;
}

export function formatRecord(record: VerdictRecord): string {
  const lines = [
    `contract: ${record.contract.id} version ${record.contract.version} sha256 ${record.contract.sha256} (matches the registry)`,
    `artifact: ${record.artifact.path} sha256 ${record.artifact.sha256 ?? "(missing)"}`,
    `verifier: revision ${record.verifier.revision ?? "(unknown)"}${record.verifier.dirty ? " with uncommitted changes" : ""}`,
  ];
  for (const result of record.results) {
    lines.push(`${result.requirement}  ${result.status.padEnd(7)}  ${result.title} (${result.level}, ${result.verifiability})`);
    if (result.detail) lines.push(`       ${result.detail}`);
  }
  if (record.capabilities.required.length > 0) {
    lines.push(`note: the contract requires capabilities this verifier cannot establish: ${record.capabilities.required.join(", ")}`);
  }
  lines.push(`verdict: ${record.statement}`);
  return lines.join("\n") + "\n";
}
