// Loads and compiles the Phase 0 specifications. Bootstrap tooling only:
// this is not the contract compiler described in RFC-0001.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SUPPORTED_CONTRACT_SCHEMA = "0.1.0";

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compile(relativePath: string): ValidateFunction {
  // strict: unknown keywords and ambiguous schemas are errors, not warnings.
  // strictRequired is off because if/then branches legitimately require
  // properties that are declared on the parent schema.
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  return ajv.compile(readJson(REPO_ROOT + relativePath) as object);
}

export const validateContract = compile("spec/contract.schema.json");
export const validateArtifact = compile("spec/research-report.artifact.schema.json");

export type Level = "mandatory" | "advisory";
export interface Requirement {
  id: string;
  title: string;
  level: Level;
  verifiability: "machine" | "empirical" | "human";
  check: { kind: string; params?: Record<string, unknown> };
}
export interface Contract {
  contract_schema: string;
  id: string;
  version: string;
  requirements: Requirement[];
  acceptance: { rule: "all-mandatory-pass" };
}

/** Fails closed: an unknown contract schema version or an invalid contract is an error, never a default. */
export function loadContract(path: string): Contract {
  const raw = readJson(path) as { contract_schema?: unknown };
  if (raw.contract_schema !== SUPPORTED_CONTRACT_SCHEMA) {
    throw new Error(`unsupported contract schema version: ${JSON.stringify(raw.contract_schema)}`);
  }
  if (!validateContract(raw)) {
    throw new Error(`invalid contract: ${JSON.stringify(validateContract.errors)}`);
  }
  const contract = raw as Contract;
  const ids = contract.requirements.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new Error("invalid contract: duplicate requirement ids");
  return contract;
}
