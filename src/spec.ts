// Loads and compiles the specifications. Bootstrap tooling only:
// this is not the contract compiler described in RFC-0001.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SUPPORTED_CONTRACT_SCHEMA = "0.1.0";
export const ARTIFACT_SCHEMA_PATH = "spec/research-report.artifact.schema.json";
export const DEFAULT_REGISTRY_PATH = join(REPO_ROOT, "spec/contracts/registry.json");

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Sorted keys, two-space indent, trailing newline: the form every JSON file written by tools takes. */
export function canonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown =>
    Array.isArray(node)
      ? node.map(sort)
      : node !== null && typeof node === "object"
        ? Object.fromEntries(Object.keys(node).sort().map((key) => [key, sort((node as Record<string, unknown>)[key])]))
        : node;
  return JSON.stringify(sort(value), null, 2) + "\n";
}

function compile(relativePath: string): ValidateFunction {
  // strict: unknown keywords and ambiguous schemas are errors, not warnings.
  // strictRequired is off because if/then branches legitimately require
  // properties that are declared on the parent schema.
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  return ajv.compile(readJson(REPO_ROOT + relativePath) as object);
}

export const validateContract = compile("spec/contract.schema.json");
export const validateArtifact = compile(ARTIFACT_SCHEMA_PATH);

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
  artifact?: { type: string; ir_version: string; schema: string; schema_sha256?: string };
  applicability?: { description?: string; requires_capabilities?: string[] };
  requirements: Requirement[];
  acceptance: { rule: "all-mandatory-pass" };
}

/**
 * Structural loading only. Fails closed: an unknown contract schema version or an invalid
 * contract is an error, never a default. It does NOT establish that the file is the contract
 * its id and version name; `loadRegisteredContract` does that.
 */
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

export interface RegistryEntry { id: string; version: string; path: string; sha256: string }
export interface Registry { registry_schema: "0.1.0"; contracts: RegistryEntry[] }

/** The registry lists, for each published contract id and version, the SHA-256 of the one file that is that contract. */
export function loadRegistry(path: string = DEFAULT_REGISTRY_PATH): Registry {
  const registry = readJson(path) as Registry;
  const valid = registry !== null && typeof registry === "object" && registry.registry_schema === "0.1.0" &&
    Array.isArray(registry.contracts) && registry.contracts.every((entry) =>
      typeof entry?.id === "string" && typeof entry.version === "string" &&
      typeof entry.path === "string" && /^[0-9a-f]{64}$/.test(entry.sha256));
  if (!valid) throw new Error(`invalid contract registry ${path}`);
  const keys = registry.contracts.map((entry) => `${entry.id}@${entry.version}`);
  if (new Set(keys).size !== keys.length) throw new Error(`invalid contract registry ${path}: an id and version is listed twice`);
  return registry;
}

export interface BoundContract { contract: Contract; path: string; sha256: string; registry: { path: string; sha256: string } }

/**
 * Loads a contract and binds it to its content. Throws unless the file's SHA-256 equals the
 * digest the registry records for its id and version, so a file that keeps the name and
 * version of a contract but changes its requirements is refused before any check runs.
 */
export function loadRegisteredContract(path: string, registryPath: string = DEFAULT_REGISTRY_PATH): BoundContract {
  const contract = loadContract(path);
  const sha256 = sha256File(path);
  const registry = loadRegistry(registryPath);
  const entry = registry.contracts.find((e) => e.id === contract.id && e.version === contract.version);
  if (!entry) throw new Error(`contract ${contract.id} version ${contract.version} is not in the registry ${registryPath}`);
  if (entry.sha256 !== sha256) {
    throw new Error(
      `contract content does not match the registry: ${contract.id} version ${contract.version} is registered ` +
      `with sha256 ${entry.sha256}, this file has ${sha256}`,
    );
  }
  const declared = contract.artifact;
  if (declared) {
    // The only artifact schema this verifier can apply; a contract naming another one cannot be enforced by it.
    if (declared.schema !== ARTIFACT_SCHEMA_PATH) throw new Error(`contract names artifact schema ${declared.schema}, which this verifier does not implement`);
    const actual = sha256File(REPO_ROOT + ARTIFACT_SCHEMA_PATH);
    if (declared.schema_sha256 !== undefined && declared.schema_sha256 !== actual) {
      throw new Error(`artifact schema does not match the contract: contract pins sha256 ${declared.schema_sha256}, the verifier's schema has ${actual}`);
    }
  }
  return { contract, path, sha256, registry: { path: registryPath, sha256: sha256File(registryPath) } };
}

export function resolveFrom(base: string, path: string): string {
  return isAbsolute(path) ? path : resolve(base, path);
}
