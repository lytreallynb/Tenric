// The one entry point that issues a verdict. It binds the verdict to what it was
// computed from (RFC-0001 section 7.2 rule 5): the contract's content, the
// artifact's content and the verifier's own source revision.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ATTESTATION_PATH, checkAttestation, loadCollectors, type Collectors } from "./attestation.ts";
import { runChecks } from "./checks.ts";
import { DEFAULT_COLLECTORS_PATH, DEFAULT_REGISTRY_PATH, loadRegisteredContract, readJson, REPO_ROOT, sha256File, type Level, type Requirement } from "./spec.ts";
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
  /** Collector keys the operator trusts. Defaults to the verifier's own spec/collectors/registry.json, which lists none. */
  collectorsPath?: string;
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
  /** Trusted collector keys this verdict was computed with. */
  collectors: { path: string; sha256: string };
  /**
   * Who collected the evidence. attested is true only when tenric/attestation.json is signed by a
   * non-revoked key in the collectors file and names this artifact, its revision and this contract.
   */
  collector: { attested: boolean; id: string | null; key_id: string | null; custody: string | null; isolation: unknown; problems: string[] };
  /** Capabilities the contract requires, and those the attesting collector's entry in the collectors file establishes. */
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

  const collectorsPath = options.collectorsPath ?? DEFAULT_COLLECTORS_PATH;
  let collectors: Collectors;
  try {
    collectors = loadCollectors(collectorsPath);
  } catch (error) {
    throw new PreconditionError(`cannot use collectors file ${collectorsPath}: ${(error as Error).message}`);
  }

  const { contract } = bound;
  const checked = runChecks(contract, runDir, { repo: options.repo, reproduce: options.reproduce, collectors, contractSha256: bound.sha256 });
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
  const artifactSha = existsSync(artifactPath) ? sha256File(artifactPath) : null;
  // Reported under every contract, so that no verdict reads as if the evidence came from a trusted collector when it did not.
  let attestation: ReturnType<typeof checkAttestation> = { problems: ["artifact.json is missing"] };
  if (artifactSha) {
    let revision: string | undefined;
    try { revision = (readJson(artifactPath) as { source?: { revision?: string } }).source?.revision; } catch { /* reported by R-001 */ }
    attestation = checkAttestation(join(runDir, ATTESTATION_PATH), collectors, {
      artifactSha256: artifactSha, sourceRevision: revision,
      contract: { id: contract.id, version: contract.version, sha256: bound.sha256 },
    });
  }
  const attested = attestation.problems.length === 0 && attestation.collector !== undefined;
  const who = attested ? `; evidence collected by ${attestation.collector!.id} (attested)` : "; collector not attested";
  // Forward slashes in the record on every platform, like every other path a tool writes.
  const shownPath = artifactPath.replaceAll("\\", "/");
  return {
    record_schema: "0.1.0",
    verdict,
    statement:
      `${verdict} under contract ${contract.id} version ${contract.version}: ` +
      `${summary.passed} of ${summary.mandatory} mandatory requirements passed ` +
      `(${summary.machine} machine, ${summary.empirical} empirical, ${summary.human} human)` + who,
    issued_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    contract: { id: contract.id, version: contract.version, path: contractPath, sha256: bound.sha256, registered: true, registry_sha256: bound.registry.sha256 },
    artifact: { path: shownPath, sha256: artifactSha },
    verifier: verifierIdentity(),
    reproduction: options.reproduce ? { requested: true, task_sha256: taskSha! } : { requested: false },
    collectors: { path: collectorsPath.replaceAll("\\", "/"), sha256: sha256File(collectorsPath) },
    collector: {
      attested,
      id: attested ? attestation.collector!.id : null,
      key_id: attested ? attestation.collector!.key_id : null,
      custody: attested ? attestation.collector!.custody : null,
      isolation: attested ? (attestation.statement?.isolation ?? null) : null,
      problems: attestation.problems,
    },
    capabilities: { required: contract.applicability?.requires_capabilities ?? [], established: attested ? [...attestation.collector!.establishes] : [] },
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
  lines.push(record.collector.attested
    ? `collector: ${record.collector.id}, attested by key ${record.collector.key_id} (custody: ${record.collector.custody})`
    : `collector: not attested (${record.collector.problems.join("; ")})`);
  const missing = record.capabilities.required.filter((c) => !record.capabilities.established.includes(c));
  if (missing.length > 0) {
    lines.push(`note: the contract requires capabilities that are not established for this run: ${missing.join(", ")}`);
  }
  lines.push(`verdict: ${record.statement}`);
  return lines.join("\n") + "\n";
}
