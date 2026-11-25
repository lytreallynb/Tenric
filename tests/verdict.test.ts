import { describe, expect, it } from "vitest";
import type { Contract } from "../src/spec.ts";
import { decide, type CheckStatus } from "../src/verdict.ts";

const contract: Contract = {
  contract_schema: "0.1.0",
  id: "test",
  version: "0.0.1",
  acceptance: { rule: "all-mandatory-pass" },
  requirements: [
    { id: "R-001", title: "m1", level: "mandatory", verifiability: "machine", check: { kind: "artifact-schema" } },
    { id: "R-002", title: "m2", level: "mandatory", verifiability: "machine", check: { kind: "output-integrity" } },
    { id: "R-003", title: "a1", level: "advisory", verifiability: "human", check: { kind: "human-review" } },
  ],
};
const results = (m1: CheckStatus, m2: CheckStatus, a1: CheckStatus) => [
  { requirement: "R-001", status: m1 },
  { requirement: "R-002", status: m2 },
  { requirement: "R-003", status: a1 },
];

describe("acceptance semantics (RFC-0001 section 7)", () => {
  it("accepts only when every mandatory requirement passed", () => {
    expect(decide(contract, results("pass", "pass", "pass")).verdict).toBe("accepted");
  });

  it("an advisory failure is reported but does not block", () => {
    const decision = decide(contract, results("pass", "pass", "fail"));
    expect(decision.verdict).toBe("accepted");
    expect(decision.advisory.map((r) => r.requirement)).toEqual(["R-003"]);
  });

  it("rejects on any mandatory failure", () => {
    expect(decide(contract, results("pass", "fail", "pass")).verdict).toBe("rejected");
  });

  it("is inconclusive, not accepted, when a mandatory validator errored or was not run", () => {
    expect(decide(contract, results("pass", "error", "pass")).verdict).toBe("inconclusive");
    expect(decide(contract, results("pass", "not_run", "pass")).verdict).toBe("inconclusive");
  });

  it("treats a missing result as not_run", () => {
    const decision = decide(contract, [{ requirement: "R-001", status: "pass" }]);
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.blocking).toEqual([{ requirement: "R-002", status: "not_run" }]);
  });

  it("a definite failure dominates unknowns", () => {
    expect(decide(contract, results("not_run", "fail", "pass")).verdict).toBe("rejected");
  });

  it("no combination containing a non-passing mandatory requirement is accepted", () => {
    const statuses: CheckStatus[] = ["pass", "fail", "error", "not_run"];
    for (const m1 of statuses) for (const m2 of statuses) for (const a1 of statuses) {
      const accepted = decide(contract, results(m1, m2, a1)).verdict === "accepted";
      expect(accepted).toBe(m1 === "pass" && m2 === "pass");
    }
  });

  it("refuses results for unknown requirements and duplicate results", () => {
    expect(() => decide(contract, [{ requirement: "R-999", status: "pass" }])).toThrow(/unknown requirement/);
    expect(() => decide(contract, [...results("pass", "pass", "pass"), { requirement: "R-001", status: "pass" }])).toThrow(/duplicate/);
  });
});
