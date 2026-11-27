// tenric verify <run-dir> --contract <file> [--repo <dir>] [--reproduce --task <file>] [--collectors <file>] [--json] [--record <file>]
//   Exit codes: 0 accepted, 1 rejected, 3 inconclusive, 2 no verdict issued
//   (bad usage, or a precondition failure under RFC-0001 section 7.2 rule 6).
// tenric attest <run-dir> --contract <file> --key <file> --collector-id <id>
//   Signs a collector attestation for a run this collector produced. Exit 0, or 2.
// tenric collector-key <dir> --collector-id <id> --custody <text> [--establishes <capability>]...
//   Writes a new key and the collectors-file entry that trusts it. Exit 0, or 2.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ATTESTATION_PATH, generateCollectorKey, signStatement, STATEMENT_TYPE } from "./attestation.ts";
import { canonicalJson, DEFAULT_REGISTRY_PATH, loadRegisteredContract, readJson, sha256File } from "./spec.ts";
import { exitCode, formatRecord, PreconditionError, verify, type VerdictRecord } from "./verify.ts";

const USAGE = [
  "usage: tenric verify <run-dir> --contract <file> [--repo <dir>] [--reproduce --task <file>] [--collectors <file>] [--json] [--record <file>]",
  "       tenric attest <run-dir> --contract <file> --key <file> --collector-id <id>",
  "       tenric collector-key <dir> --collector-id <id> --custody <text> [--establishes <capability>]...",
].join("\n");

function noVerdict(message: string): never {
  console.error(`no verdict issued: ${message}`);
  process.exit(2);
}
function refuse(message: string): never {
  console.error(`refused: ${message}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      contract: { type: "string" }, repo: { type: "string" }, task: { type: "string" }, record: { type: "string" },
      collectors: { type: "string" }, reproduce: { type: "boolean" }, json: { type: "boolean" },
      key: { type: "string" }, "collector-id": { type: "string" }, custody: { type: "string" }, establishes: { type: "string", multiple: true },
    },
  });
} catch (error) {
  noVerdict(`${(error as Error).message}\n${USAGE}`);
}
const [command, dir, ...extra] = args.positionals;
const v = args.values;

if (command === "collector-key") {
  if (!dir || extra.length > 0 || !v["collector-id"] || !v.custody || v.contract || v.key) refuse(USAGE);
  const keyPath = join(dir, "collector.key");
  const entryPath = join(dir, "collectors.json");
  if (existsSync(keyPath) || existsSync(entryPath)) refuse(`${keyPath} or ${entryPath} already exists; a key is never overwritten`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKeyPem, entry } = generateCollectorKey(v["collector-id"], v.custody, v.establishes ?? []);
  writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  writeFileSync(entryPath, canonicalJson({ collectors_schema: "0.1.0", collectors: [entry] }));
  console.log(`wrote ${keyPath} (private, mode 600) and ${entryPath}`);
  console.log(`key_id ${entry.key_id}`);
  console.log("A verifier trusts this collector only if its operator passes that collectors file, or copies the entry into its own.");
  process.exit(0);
}

if (command === "attest") {
  if (!dir || extra.length > 0 || !v.contract || !v.key || !v["collector-id"]) refuse(USAGE);
  const artifactPath = join(dir, "artifact.json");
  if (!existsSync(artifactPath)) refuse(`${artifactPath} does not exist`);
  let bound;
  try {
    bound = loadRegisteredContract(v.contract);
  } catch (error) {
    refuse(`cannot use contract ${v.contract}: ${(error as Error).message}`);
  }
  const artifact = readJson(artifactPath) as { source?: { revision?: string } };
  const statement = {
    type: STATEMENT_TYPE, version: "0.1.0", collector_id: v["collector-id"],
    issued_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    subject: { artifact_path: "artifact.json", artifact_sha256: sha256File(artifactPath) },
    source_revision: artifact.source?.revision ?? null,
    contract: { id: bound.contract.id, version: bound.contract.version, sha256: bound.sha256 },
    registry_sha256: sha256File(DEFAULT_REGISTRY_PATH),
  };
  let attestation;
  try {
    attestation = signStatement(statement, readFileSync(v.key, "utf8"));
  } catch (error) {
    refuse(`cannot sign with ${v.key}: ${(error as Error).message}`);
  }
  mkdirSync(join(dir, "tenric"), { recursive: true });
  writeFileSync(join(dir, ATTESTATION_PATH), canonicalJson(attestation));
  console.log(`wrote ${join(dir, ATTESTATION_PATH)}, key_id ${attestation.signature.key_id}`);
  process.exit(0);
}

const { contract, repo, task, reproduce, json, record: recordPath, collectors } = v;
if (command !== "verify" || !dir || extra.length > 0 || !contract || v.key || v["collector-id"] || v.custody || v.establishes) noVerdict(USAGE);
if (Boolean(reproduce) !== Boolean(task)) noVerdict(`--reproduce and --task <file> go together\n${USAGE}`);
if (!existsSync(dir) || !statSync(dir).isDirectory()) noVerdict(`${dir} is not a directory`);

let record: VerdictRecord;
try {
  record = verify({ runDir: dir, contractPath: contract, repo, reproduce: task ? { taskPath: task } : undefined, collectorsPath: collectors });
} catch (error) {
  if (error instanceof PreconditionError) noVerdict(error.message);
  throw error;
}
if (recordPath) writeFileSync(recordPath, canonicalJson(record));
process.stdout.write(json ? canonicalJson(record) : formatRecord(record));
process.exitCode = exitCode(record.verdict);
