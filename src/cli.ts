// tenric verify <run-dir> --contract <file> [--repo <dir>]
//
// Exit codes: 0 accepted, 1 rejected or inconclusive, 2 no verdict issued
// (bad usage, or a precondition failure under RFC-0001 section 7.2 rule 6).
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runChecks, sha256File } from "./checks.ts";
import { loadContract, type Contract } from "./spec.ts";
import { decide } from "./verdict.ts";

const USAGE = "usage: tenric verify <run-dir> --contract <file> [--repo <dir>]";

function noVerdict(message: string): never {
  console.error(`no verdict issued: ${message}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({ allowPositionals: true, options: { contract: { type: "string" }, repo: { type: "string" } } });
} catch (error) {
  noVerdict(`${(error as Error).message}\n${USAGE}`);
}
const [command, dir, ...extra] = args.positionals;
const contractPath = args.values.contract;
if (command !== "verify" || !dir || extra.length > 0 || !contractPath) noVerdict(USAGE);
if (!existsSync(dir) || !statSync(dir).isDirectory()) noVerdict(`${dir} is not a directory`);

let contract: Contract;
try {
  contract = loadContract(contractPath);
} catch (error) {
  noVerdict(`cannot use contract ${contractPath}: ${(error as Error).message}`);
}

const results = new Map(runChecks(contract, dir, { repo: args.values.repo }).map((r) => [r.requirement, r]));
const { verdict } = decide(contract, [...results.values()]);

const artifactPath = join(dir, "artifact.json");
console.log(`contract: ${contract.id} version ${contract.version}`);
console.log(`artifact: ${artifactPath} sha256 ${existsSync(artifactPath) ? sha256File(artifactPath) : "(missing)"}`);
for (const requirement of contract.requirements) {
  const result = results.get(requirement.id)!;
  const tags = `${requirement.level}, ${requirement.verifiability}`;
  console.log(`${requirement.id}  ${result.status.padEnd(7)}  ${requirement.title} (${tags})`);
  if (result.detail) console.log(`       ${result.detail}`);
}

const mandatory = contract.requirements.filter((r) => r.level === "mandatory");
const passed = mandatory.filter((r) => results.get(r.id)!.status === "pass");
const count = (kind: string) => passed.filter((r) => r.verifiability === kind).length;
// Wording fixed by RFC-0001 section 7.2 rule 8: a verdict is not a truth claim.
console.log(
  `verdict: ${verdict} under contract ${contract.id} version ${contract.version}: ` +
  `${passed.length} of ${mandatory.length} mandatory requirements passed ` +
  `(${count("machine")} machine, ${count("empirical")} empirical, ${count("human")} human)`,
);
process.exitCode = verdict === "accepted" ? 0 : 1;
