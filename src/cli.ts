// tenric verify <run-dir> --contract <file> [--repo <dir>] [--reproduce --task <file>] [--json] [--record <file>]
//
// Exit codes: 0 accepted, 1 rejected, 3 inconclusive, 2 no verdict issued
// (bad usage, or a precondition failure under RFC-0001 section 7.2 rule 6).
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson } from "./spec.ts";
import { exitCode, formatRecord, PreconditionError, verify, type VerdictRecord } from "./verify.ts";

const USAGE = "usage: tenric verify <run-dir> --contract <file> [--repo <dir>] [--reproduce --task <file>] [--json] [--record <file>]";

function noVerdict(message: string): never {
  console.error(`no verdict issued: ${message}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      contract: { type: "string" }, repo: { type: "string" }, task: { type: "string" }, record: { type: "string" },
      reproduce: { type: "boolean" }, json: { type: "boolean" },
    },
  });
} catch (error) {
  noVerdict(`${(error as Error).message}\n${USAGE}`);
}
const [command, dir, ...extra] = args.positionals;
const { contract, repo, task, reproduce, json, record: recordPath } = args.values;
if (command !== "verify" || !dir || extra.length > 0 || !contract) noVerdict(USAGE);
if (Boolean(reproduce) !== Boolean(task)) noVerdict(`--reproduce and --task <file> go together\n${USAGE}`);

let record: VerdictRecord;
try {
  record = verify({ runDir: dir, contractPath: contract, repo, reproduce: task ? { taskPath: task } : undefined });
} catch (error) {
  if (error instanceof PreconditionError) noVerdict(error.message);
  throw error;
}
if (recordPath) writeFileSync(recordPath, canonicalJson(record));
process.stdout.write(json ? canonicalJson(record) : formatRecord(record));
process.exitCode = exitCode(record.verdict);
