// Schemas owned by the runtime: the task file and the producer's claims file.
// The contract and artifact schemas stay in src/spec.ts.
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { REPO_ROOT } from "../spec.ts";
import { readJson } from "./util.ts";

function compile(relativePath: string): ValidateFunction {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  return ajv.compile(readJson(REPO_ROOT + relativePath) as object);
}

export const TASK_SCHEMA_VERSION = "0.1.0";
export const validateTask = compile("spec/runtime/task.schema.json");
export const validateClaims = compile("spec/runtime/research.experiment-report.claims.schema.json");

export interface Task {
  runtime_task_schema: "0.1.0";
  id: string;
  title: string;
  data_class?: "measured" | "fixture";
  contract: { id: string; version: string };
  brief?: string;
  script_producer?: string;
  limits?: { backend_timeout_seconds?: number; backend_max_cost_usd?: number; execution_timeout_seconds?: number };
}

export type Determinism = "byte-identical" | "numeric-tolerance" | "volatile";
export interface Claims {
  claims_schema: "0.1.0";
  dataset: { name: string; version: string; description?: string; file: string };
  metrics: { name: string; json_pointer: string; unit?: string }[];
  figures?: { id: string; spec_output: string; image_output: string; renderer?: string }[];
  outputs?: { path: string; role?: string; determinism: Determinism }[];
  findings: { id: string; statement: string; supported_by: string[] }[];
  limitations: string[];
}
