// Executable specification of the acceptance semantics in RFC-0001 section 7.
// Pure function, no I/O. If this file and the RFC disagree, that is a bug in one of them.
import type { Contract } from "./spec.ts";

/**
 * pass     the validator ran and the requirement holds
 * fail     the validator ran and the requirement does not hold
 * error    the validator was attempted and could not reach a decision
 * not_run  no validator has been executed for this requirement
 */
export type CheckStatus = "pass" | "fail" | "error" | "not_run";
export interface CheckResult {
  requirement: string;
  status: CheckStatus;
  detail?: string;
}

export type Verdict = "accepted" | "rejected" | "inconclusive";
export interface Decision {
  verdict: Verdict;
  blocking: CheckResult[];
  advisory: CheckResult[];
}

export function decide(contract: Contract, results: CheckResult[]): Decision {
  const known = new Set(contract.requirements.map((r) => r.id));
  const byId = new Map<string, CheckResult>();
  for (const result of results) {
    if (!known.has(result.requirement)) throw new Error(`result for unknown requirement ${result.requirement}`);
    if (byId.has(result.requirement)) throw new Error(`duplicate result for ${result.requirement}`);
    byId.set(result.requirement, result);
  }

  const blocking: CheckResult[] = [];
  const advisory: CheckResult[] = [];
  for (const requirement of contract.requirements) {
    // A requirement with no result has, by definition, not been run.
    const result = byId.get(requirement.id) ?? { requirement: requirement.id, status: "not_run" as const };
    if (result.status === "pass") continue;
    (requirement.level === "mandatory" ? blocking : advisory).push(result);
  }

  // Rejection dominates: one definite failure is enough, whatever else is unknown.
  const verdict: Verdict = blocking.some((r) => r.status === "fail")
    ? "rejected"
    : blocking.length > 0
      ? "inconclusive"
      : "accepted";
  return { verdict, blocking, advisory };
}
