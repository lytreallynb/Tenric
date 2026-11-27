// Runs the command line as a separate process against the real runs that
// scripts/verify.sh produces, so exit codes and wording are tested as a user sees them.
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, REPO_ROOT, sha256File } from "../src/spec.ts";
import { CONTRACT, CONTRACT_010, git, SLOW, TASK, tempDir, tenric } from "./helpers.ts";

describe("tenric verify", () => {
  it("reports the baseline as inconclusive without a re-execution, exits 3, and never says more than the contract checked", () => {
    const { code, out } = tenric(["verify", "runs/verify-a", "--contract", CONTRACT]);
    expect(code).toBe(3);
    expect(out).toMatch(/^R-007  pass /m);
    expect(out).toMatch(/^R-008  not_run  .*\n\s+re-execution was not requested$/m);
    expect(out).toMatch(/^R-009  not_run  .*\(advisory, human\)$/m);
    expect(out).toContain(
      "verdict: inconclusive under contract research.experiment-report version 0.2.0: " +
      "9 of 10 mandatory requirements passed (9 machine, 0 empirical, 0 human)",
    );
    expect(out).not.toMatch(/verified|correct/i);
  });

  it("names the contract by content, the artifact by content and its own revision", () => {
    const { out } = tenric(["verify", "runs/verify-a", "--contract", CONTRACT]);
    expect(out).toContain(`contract: research.experiment-report version 0.2.0 sha256 ${sha256File(REPO_ROOT + CONTRACT)} (matches the registry)`);
    expect(out).toContain(`sha256 ${sha256File(REPO_ROOT + "runs/verify-a/artifact.json")}`);
    expect(out).toContain(`verifier: revision ${git("rev-parse", "HEAD")}`);
    expect(out).toMatch(/^note: the contract requires capabilities that are not established for this run: independent-collector, content-hashing$/m);
  });

  it("reports the failed run as rejected and exits 1", () => {
    const { code, out } = tenric(["verify", "runs/verify-fail", "--contract", CONTRACT]);
    expect(code).toBe(1);
    expect(out).toMatch(/^R-005  fail /m);
    expect(out).toMatch(/^verdict: rejected under contract /m);
  });

  it("exits 0 only for accepted: with a re-execution the baseline is accepted under the registered contract", () => {
    const { code, out } = tenric(["verify", "runs/verify-a", "--contract", CONTRACT, "--repo", ".", "--reproduce", "--task", TASK]);
    expect(out).toMatch(/^R-008  pass  .*\n\s+re-executed revision [0-9a-f]{40} in an equal environment: 3 metrics equal, 3 outputs byte-identical$/m);
    expect(out).toMatch(/^verdict: accepted under contract research\.experiment-report version 0\.2\.0: 10 of 10 mandatory requirements passed \(9 machine, 1 empirical, 0 human\); collector not attested$/m);
    expect(out).not.toMatch(/verified|correct/i);
    expect(code).toBe(0);
  }, SLOW);

  it("--json prints the verdict record and --record writes the same record to a file", () => {
    const path = join(tempDir("tenric-record-"), "verdict.json");
    const { code, out } = tenric(["verify", "runs/verify-a", "--contract", CONTRACT_010, "--json", "--record", path]);
    expect(code).toBe(3);
    const record = JSON.parse(out);
    expect(record).toMatchObject({
      record_schema: "0.1.0",
      verdict: "inconclusive",
      contract: { id: "research.experiment-report", version: "0.1.0", sha256: sha256File(REPO_ROOT + CONTRACT_010), registered: true },
      reproduction: { requested: false },
    });
    // Written by a tool: sorted keys and a trailing newline, never CRLF.
    const written = readFileSync(path, "utf8");
    expect(written.endsWith("}\n")).toBe(true);
    expect(written).not.toContain("\r");
    const { issued_at: _a, ...printed } = record;
    const { issued_at: _b, ...saved } = readJson(path) as any;
    expect(saved).toEqual(printed);
    expect(Object.keys(record)).toEqual(Object.keys(record).sort());
  });

  it("issues no verdict and exits 2 on a precondition failure", () => {
    const unsupported = join(tempDir("tenric-contract-"), "contract.json");
    writeFileSync(unsupported, JSON.stringify({ contract_schema: "9.0.0" }));
    const cases = [
      ["verify", "runs/verify-a"],
      ["verify", "runs/verify-a", "--contract", unsupported],
      ["verify", "runs/verify-a", "--contract", "no-such-contract.json"],
      ["verify", "runs/no-such-run", "--contract", CONTRACT],
      ["verify", "runs/verify-a", "--contract", CONTRACT, "--accept-anyway"],
      ["verify", "runs/verify-a", "--contract", CONTRACT, "--reproduce"],
      ["verify", "runs/verify-a", "--contract", CONTRACT, "--task", TASK],
      ["verify", "runs/verify-a", "--contract", CONTRACT, "--reproduce", "--task", "no-such-task.json"],
      ["approve", "runs/verify-a", "--contract", CONTRACT],
      [],
    ];
    for (const args of cases) {
      const { code, out, err } = tenric(args);
      expect(code, args.join(" ")).toBe(2);
      expect(out, args.join(" ")).toBe("");
      expect(err, args.join(" ")).toMatch(/^no verdict issued: /);
    }
  });
});
