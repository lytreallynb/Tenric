// The only file in ui/ that imports the verifier. Everything the interface
// knows about contracts, checks and verdicts passes through here, so a change
// to the verifier's interface is a change to this file and nothing else.
//
// Nothing here decides anything. Every verdict is a VerdictRecord issued by
// `verify()` in src/verify.ts, the one entry point that binds a verdict to the
// contract's content, the artifact's content and the verifier's revision.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { IMPLEMENTED_CHECK_KINDS } from "../../src/checks.ts";
import { loadContract, loadRegisteredContract, readJson, REPO_ROOT, sha256File, type Contract, type Requirement } from "../../src/spec.ts";
import { exitCode, PreconditionError, verify as issueVerdict, type VerdictRecord } from "../../src/verify.ts";

export { exitCode, loadContract, PreconditionError, readJson, sha256File, REPO_ROOT };
export type { Contract, Requirement, VerdictRecord };

export interface Revision { revision: string | null; dirty: boolean | null }

export function repoRevision(): Revision {
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain") !== "" };
  } catch {
    return { revision: null, dirty: null };
  }
}

/**
 * The verifier's verdict for one run directory under one contract, without
 * re-execution. `repo` is the repository the artifact's source revision must
 * exist in: this checkout for baseline runs, the run's own workspace for
 * runs made by the runtime. Throws PreconditionError when no verdict may be issued
 * (unregistered, altered or invalid contract); the caller reports that as
 * "no verdict issued", never as a verdict.
 */
export function verify(dir: string, contractPath: string, repo: string = REPO_ROOT): VerdictRecord {
  return issueVerdict({ runDir: dir, contractPath, repo });
}

/**
 * The same, with the task re-executed so that numeric reproduction can be
 * decided. Re-execution takes seconds to minutes and the verifier does it
 * synchronously, so it runs in the verifier's own command line as a separate
 * process and the record is read from its output.
 */
export async function verifyWithReExecution(dir: string, contractPath: string, taskPath: string, repo: string = "."): Promise<VerdictRecord> {
  const args = ["src/cli.ts", "verify", dir, "--contract", contractPath, "--repo", repo, "--reproduce", "--task", taskPath, "--json"];
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(process.execPath, args, { cwd: REPO_ROOT, timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    // Exit 1 and 3 are verdicts (rejected, inconclusive) and still carry a record. Anything else is not a verdict.
    if (failure.code !== 1 && failure.code !== 3) {
      const reason = (failure.stderr ?? "").trim() || failure.message;
      if (failure.code === 2) throw new PreconditionError(reason.replace(/^no verdict issued: /, ""));
      throw new Error(`the verifier did not complete: ${reason}`);
    }
    stdout = failure.stdout ?? "";
  }
  const record = JSON.parse(stdout) as VerdictRecord;
  if (record.reproduction?.requested !== true) throw new Error("the verifier returned a record without re-execution");
  return record;
}

/** Whether the registry lists this exact file as the contract its id and version name. */
export function registration(contractPath: string): { registered: boolean; reason?: string } {
  try {
    loadRegisteredContract(contractPath);
    return { registered: true };
  } catch (error) {
    return { registered: false, reason: (error as Error).message };
  }
}

/** True when the verifier has a validator for this check kind. Some validators still need extra input to run (re-execution). */
export const hasValidator = (kind: string): boolean => IMPLEMENTED_CHECK_KINDS.includes(kind);
