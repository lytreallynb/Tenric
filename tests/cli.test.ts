// Runs the command line as a separate process against the real runs that
// scripts/verify.sh produces, so exit codes and wording are tested as a user sees them.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, REPO_ROOT } from "../src/spec.ts";

const CONTRACT = "spec/contracts/research.experiment-report/0.1.0.contract.json";
function tenric(...args: string[]) {
  const done = spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: done.status, out: done.stdout, err: done.stderr };
}

describe("tenric verify", () => {
  it("reports the baseline as inconclusive, exits 1, and never says more than the contract checked", () => {
    const { code, out } = tenric("verify", "runs/verify-a", "--contract", CONTRACT);
    expect(code).toBe(1);
    expect(out).toMatch(/^R-007  pass /m);
    expect(out).toMatch(/^R-008  not_run  .*\n\s+no validator for numeric-reproduction yet$/m);
    expect(out).toMatch(/^R-009  not_run  .*\(advisory, human\)$/m);
    expect(out).toContain(
      "verdict: inconclusive under contract research.experiment-report version 0.1.0: " +
      "7 of 8 mandatory requirements passed (7 machine, 0 empirical, 0 human)",
    );
    expect(out).not.toMatch(/verified|correct/i);
  });

  it("reports the failed run as rejected and exits 1", () => {
    const { code, out } = tenric("verify", "runs/verify-fail", "--contract", CONTRACT);
    expect(code).toBe(1);
    expect(out).toMatch(/^R-005  fail /m);
    expect(out).toMatch(/^verdict: rejected under contract /m);
  });

  it("exits 0 only for accepted: a contract without the unverifiable requirement accepts the baseline", () => {
    // Test-only contract. It shows the exit code path; it is not the project's contract and accepts nothing on its behalf.
    const contract = readJson(REPO_ROOT + CONTRACT) as any;
    contract.requirements = contract.requirements.filter((r: any) => r.id !== "R-008");
    const path = join(mkdtempSync(join(tmpdir(), "tenric-contract-")), "contract.json");
    writeFileSync(path, JSON.stringify(contract));
    const { code, out } = tenric("verify", "runs/verify-a", "--contract", path);
    expect(out).toMatch(/^verdict: accepted under contract .*: 7 of 7 mandatory requirements passed \(7 machine, 0 empirical, 0 human\)$/m);
    expect(code).toBe(0);
  });

  it("issues no verdict and exits 2 on a precondition failure", () => {
    const unsupported = join(mkdtempSync(join(tmpdir(), "tenric-contract-")), "contract.json");
    writeFileSync(unsupported, JSON.stringify({ contract_schema: "9.0.0" }));
    const cases = [
      ["verify", "runs/verify-a"],
      ["verify", "runs/verify-a", "--contract", unsupported],
      ["verify", "runs/verify-a", "--contract", "no-such-contract.json"],
      ["verify", "runs/no-such-run", "--contract", CONTRACT],
      ["verify", "runs/verify-a", "--contract", CONTRACT, "--accept-anyway"],
      ["approve", "runs/verify-a", "--contract", CONTRACT],
      [],
    ];
    for (const args of cases) {
      const { code, out, err } = tenric(...args);
      expect(code, args.join(" ")).toBe(2);
      expect(out, args.join(" ")).toBe("");
      expect(err, args.join(" ")).toMatch(/^no verdict issued: /);
    }
  });
});
