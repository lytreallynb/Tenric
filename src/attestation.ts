// Collector attestations: a signed statement, written by a collector the verifier's
// operator trusts, that names the artifact it collected by digest.
//
// Why: `provenance: "collector"` is a field anyone can write. A producer that writes
// its own collector (comparison group B) gets the same label. A signature by a key
// the producer cannot read is the first thing in a run directory that it cannot
// produce itself. Which keys count is decided outside the run directory, in a
// collectors file the operator chooses (ADR-0011).
//
// Format: tenric/attestation.json =
//   { attestation_schema: "0.1.0", statement: {...},
//     signature: { alg: "ed25519", key_id, public_key, value } }
// The signed bytes are canonicalStatementBytes(statement). Ed25519 from node:crypto; no dependency.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify as verifySignature, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { readJson } from "./spec.ts";

export const ATTESTATION_PATH = "tenric/attestation.json";
export const STATEMENT_TYPE = "tenric.collector-record";

/**
 * Recursively sorted keys, no whitespace, JSON.stringify escaping. Only strings, integers,
 * booleans, null, arrays and objects: a float has no single text form across languages, so it is refused.
 */
export function canonicalStatementBytes(value: unknown): Buffer {
  const encode = (node: unknown, path: string): string => {
    if (node === null || typeof node === "string" || typeof node === "boolean") return JSON.stringify(node);
    if (typeof node === "number") {
      if (!Number.isSafeInteger(node)) throw new Error(`statement ${path || "/"}: only integers are allowed, got ${node}`);
      return JSON.stringify(node);
    }
    if (Array.isArray(node)) return `[${node.map((item, i) => encode(item, `${path}/${i}`)).join(",")}]`;
    if (typeof node === "object") {
      const entries = Object.keys(node).sort().map((key) => `${JSON.stringify(key)}:${encode((node as Record<string, unknown>)[key], `${path}/${key}`)}`);
      return `{${entries.join(",")}}`;
    }
    throw new Error(`statement ${path || "/"}: ${typeof node} is not allowed`);
  };
  return Buffer.from(encode(value, ""), "utf8");
}

export function keyIdOf(publicKey: KeyObject): string {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

export interface CollectorKey { privateKeyPem: string; entry: CollectorEntry }
/** A new Ed25519 key, and the collectors-file entry an operator would add to trust it. */
export function generateCollectorKey(id: string, custody: string, establishes: string[] = []): CollectorKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    entry: {
      id, custody, establishes,
      key_id: keyIdOf(publicKey),
      public_key: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    },
  };
}

export interface Attestation {
  attestation_schema: "0.1.0";
  statement: Record<string, unknown>;
  signature: { alg: "ed25519"; key_id: string; public_key: string; value: string };
}
export function signStatement(statement: Record<string, unknown>, privateKeyPem: string): Attestation {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("collector keys are Ed25519");
  const publicKey = createPublicKey(privateKey);
  return {
    attestation_schema: "0.1.0",
    statement,
    signature: {
      alg: "ed25519",
      key_id: keyIdOf(publicKey),
      public_key: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      value: sign(null, canonicalStatementBytes(statement), privateKey).toString("base64"),
    },
  };
}

export interface CollectorEntry { id: string; key_id: string; public_key: string; custody: string; establishes: string[]; revoked?: true }
export interface Collectors { collectors_schema: "0.1.0"; collectors: CollectorEntry[] }

export function loadCollectors(path: string): Collectors {
  const file = readJson(path) as Collectors;
  const valid = file !== null && typeof file === "object" && file.collectors_schema === "0.1.0" && Array.isArray(file.collectors) &&
    file.collectors.every((e) =>
      typeof e?.id === "string" && e.id.length > 0 && /^[0-9a-f]{64}$/.test(e.key_id) && typeof e.public_key === "string" &&
      typeof e.custody === "string" && Array.isArray(e.establishes) && e.establishes.every((c) => typeof c === "string") &&
      (e.revoked === undefined || e.revoked === true));
  if (!valid) throw new Error(`invalid collectors file ${path}`);
  for (const entry of file.collectors) {
    let key: KeyObject;
    try {
      key = createPublicKey({ key: Buffer.from(entry.public_key, "base64"), format: "der", type: "spki" });
    } catch {
      throw new Error(`invalid collectors file ${path}: ${entry.id} has an unreadable public key`);
    }
    if (key.asymmetricKeyType !== "ed25519" || keyIdOf(key) !== entry.key_id) {
      throw new Error(`invalid collectors file ${path}: ${entry.id} has a key_id that is not the digest of its Ed25519 key`);
    }
  }
  const ids = file.collectors.map((e) => e.key_id);
  if (new Set(ids).size !== ids.length) throw new Error(`invalid collectors file ${path}: a key is listed twice`);
  return file;
}

export interface Expected { artifactSha256: string; sourceRevision: string | undefined; contract: { id: string; version: string; sha256: string } }
export interface AttestationCheck { problems: string[]; collector?: CollectorEntry; statement?: Record<string, unknown> }

/** Returns the problems found. A run directory without an attestation, or signed by a key the operator does not trust, is a problem, not an inability to decide. */
export function checkAttestation(path: string, collectors: Collectors, expected: Expected): AttestationCheck {
  if (!existsSync(path)) return { problems: [`no collector attestation at ${ATTESTATION_PATH}: nothing shows who collected this evidence`] };
  let attestation: Attestation;
  try {
    attestation = readJson(path) as Attestation;
  } catch (error) {
    return { problems: [`${ATTESTATION_PATH} is not JSON: ${String(error)}`] };
  }
  const { statement, signature } = attestation ?? ({} as Attestation);
  if (attestation?.attestation_schema !== "0.1.0" || statement === null || typeof statement !== "object" || Array.isArray(statement) ||
      signature?.alg !== "ed25519" || typeof signature.key_id !== "string" || typeof signature.value !== "string") {
    return { problems: [`${ATTESTATION_PATH} is not an attestation of schema 0.1.0 signed with ed25519`] };
  }
  const entry = collectors.collectors.find((e) => e.key_id === signature.key_id);
  if (!entry) return { problems: [`signed by key ${signature.key_id}, which is not in the operator's collectors file`] };
  if (entry.revoked) return { problems: [`signed by key ${entry.key_id} of collector ${entry.id}, which is revoked`] };
  let bytes: Buffer;
  try {
    bytes = canonicalStatementBytes(statement);
  } catch (error) {
    return { problems: [String((error as Error).message)] };
  }
  const key = createPublicKey({ key: Buffer.from(entry.public_key, "base64"), format: "der", type: "spki" });
  if (!verifySignature(null, bytes, key, Buffer.from(signature.value, "base64"))) {
    return { problems: [`the signature does not verify with the registered key of collector ${entry.id}`] };
  }

  // The signature is good. Now: is this the statement about the artifact being judged?
  const s = statement as Record<string, any>;
  const problems: string[] = [];
  if (s.type !== STATEMENT_TYPE || s.version !== "0.1.0") problems.push(`statement is ${JSON.stringify(s.type)} ${JSON.stringify(s.version)}, not ${STATEMENT_TYPE} 0.1.0`);
  if (s.collector_id !== entry.id) problems.push(`statement names collector ${JSON.stringify(s.collector_id)}, the key belongs to ${entry.id}`);
  if (s.subject?.artifact_sha256 !== expected.artifactSha256) problems.push(`statement is about artifact ${s.subject?.artifact_sha256}, this artifact.json is ${expected.artifactSha256}`);
  if (s.source_revision !== expected.sourceRevision) problems.push(`statement names source revision ${s.source_revision}, the artifact names ${expected.sourceRevision}`);
  const c = expected.contract;
  if (s.contract?.id !== c.id || s.contract?.version !== c.version || s.contract?.sha256 !== c.sha256) {
    problems.push(`statement was collected for contract ${s.contract?.id} ${s.contract?.version} (${s.contract?.sha256}), this verdict is under ${c.id} ${c.version} (${c.sha256})`);
  }
  return { problems, collector: entry, statement: s };
}
