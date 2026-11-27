// Read side of the run directory layout (docs/runtime-interface.md). For UIs and scripts.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunSummary } from "./runtime.ts";
import { readJson } from "./util.ts";

/** The run's summary, or undefined for a directory the runtime did not write (for example a baseline-script run). */
export function readRun(dir: string): RunSummary | undefined {
  const path = join(dir, "tenric", "run.json");
  return existsSync(path) ? (readJson(path) as RunSummary) : undefined;
}

/** Runtime runs under a root, newest first. Directories without tenric/run.json are skipped, not reported as errors. */
export function listRuns(root: string): RunSummary[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .flatMap((name) => readRun(join(root, name)) ?? [])
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.run_id.localeCompare(b.run_id));
}
