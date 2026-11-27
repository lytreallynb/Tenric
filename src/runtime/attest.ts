// Builds and signs the runtime's collector record (tenric/attestation.json).
//
// The statement says which artifact this runtime assembled, from which workspace revision,
// under which contract, plan and runtime revision, and how the backend and the experiment were
// confined. The signature is made with the runtime's own key (src/runtime/keys.ts), which no
// sandboxed process can read. Checking it is the verifier's business (src/attestation.ts).
import { signStatement, type Attestation } from "../attestation.ts";
import type { IsolationRecord } from "./sandbox.ts";
import type { CollectorIdentity } from "./keys.ts";

export interface CollectorStatement {
  type: "tenric.collector-record";
  version: "0.1.0";
  collector_id: string;
  run_id: string;
  issued_at: string;
  subject: { artifact_path: string; artifact_sha256: string };
  source_revision: string;
  contract: { id: string; version: string; sha256: string };
  registry_sha256: string;
  task: { id: string; sha256: string };
  plan_sha256: string;
  runtime: { revision: string | null; dirty: boolean | null; trusted_base_sha256: string };
  backend: { name: string; kind: string };
  isolation: { backend: IsolationRecord | null; execution: IsolationRecord };
}

/** Signs with the verifier's own serialisation (src/attestation.ts), so there is one definition of the signed bytes. */
export function signRecord(statement: CollectorStatement, identity: CollectorIdentity): Attestation {
  const attestation = signStatement(statement as unknown as Record<string, unknown>, identity.private_key_pem);
  if (attestation.signature.key_id !== identity.key_id) throw new Error("the signing key is not the identity's key");
  return attestation;
}

/** Why a run may not be signed, or null when it may. The key must never vouch for a run whose code could have read it. */
export function refusalToSign(backendKind: string, backend: IsolationRecord | null, execution: IsolationRecord | null): string | null {
  if (!execution) return "the experiment was not executed";
  if (!execution.enforced) return `the experiment ran without a sandbox (${execution.detail ?? "no detail"})`;
  if (execution.network !== "none") return "the experiment had network access";
  if (backendKind !== "script" && !backend?.enforced) return `the backend ran without a sandbox (${backend?.detail ?? "no isolation record"})`;
  return null;
}
