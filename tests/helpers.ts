// Shared by the tests that run against the real executions scripts/verify.sh produces.
import { cpSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, REPO_ROOT, sha256File } from "../src/spec.ts";

export const CONTRACT_010 = "spec/contracts/research.experiment-report/0.1.0.contract.json";
export const CONTRACT = "spec/contracts/research.experiment-report/0.2.0.contract.json";
export const TASK = "experiments/baseline/task.json";
export const RUN_A = process.env.TENRIC_RUN_A ?? REPO_ROOT + "runs/verify-a";
export const RUN_B = process.env.TENRIC_RUN_B ?? REPO_ROOT + "runs/verify-b";
/** Re-execution builds an environment and runs the experiment; allow for a cold cache on a slow runner. */
export const SLOW = 900_000;

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function tamperedCopy(mutate: (dir: string) => void): string {
  const dir = tempDir("tenric-run-");
  cpSync(RUN_A, dir, { recursive: true });
  mutate(dir);
  return dir;
}

export function editArtifact(dir: string, mutate: (artifact: any) => void): void {
  const path = join(dir, "artifact.json");
  const artifact = readJson(path);
  mutate(artifact);
  writeFileSync(path, JSON.stringify(artifact));
}

/** What a producer does after changing an output: record the new size and digest, so R-002 passes again. */
export function rehash(dir: string, outputPath: string): void {
  editArtifact(dir, (a) => {
    const output = a.outputs.find((o: any) => o.path === outputPath);
    output.bytes = statSync(join(dir, outputPath)).size;
    output.sha256 = sha256File(join(dir, outputPath));
  });
}

/** Changes metrics.json and makes the artifact agree with it everywhere, as an inflated result would. */
export function inflateAccuracy(dir: string, value: number): void {
  const path = join(dir, "metrics.json");
  const metrics = JSON.parse(readFileSync(path, "utf8"));
  metrics.test.accuracy = value;
  writeFileSync(path, JSON.stringify(metrics, null, 2) + "\n");
  rehash(dir, "metrics.json");
  editArtifact(dir, (a) => {
    a.metrics.find((m: any) => m.name === "test_accuracy").value = value;
    a.findings[0].statement = `Logistic regression reaches ${value} test accuracy, a new state of the art.`;
  });
}

export function tenric(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const done = spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
  return { code: done.status, out: done.stdout, err: done.stderr };
}

export function git(...args: string[]): string {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
}
