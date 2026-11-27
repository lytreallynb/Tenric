// The verdict is bound to what it was computed from: contract content, artifact content, verifier revision.
import { describe, expect, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, loadRegistry, loadRegisteredContract, readJson, REPO_ROOT, sha256File } from "../src/spec.ts";
import { IMPLEMENTED_CHECK_KINDS } from "../src/checks.ts";
import { exitCode, PreconditionError, verify } from "../src/verify.ts";
import { CONTRACT, CONTRACT_010, git, RUN_A, tempDir } from "./helpers.ts";

function writeContract(mutate: (contract: any) => void, base = CONTRACT): string {
  const contract = readJson(REPO_ROOT + base) as any;
  mutate(contract);
  const path = join(tempDir("tenric-contract-"), "contract.json");
  writeFileSync(path, JSON.stringify(contract, null, 2));
  return path;
}
function writeRegistry(contractPath: string): string {
  const contract = readJson(contractPath) as any;
  const path = join(tempDir("tenric-registry-"), "registry.json");
  writeFileSync(path, canonicalJson({
    registry_schema: "0.1.0",
    contracts: [{ id: contract.id, version: contract.version, path: contractPath, sha256: sha256File(contractPath) }],
  }));
  return path;
}

describe("contract registry", () => {
  it("lists every contract file in the repository with the digest of its current bytes", () => {
    const registry = loadRegistry();
    expect(registry.contracts.map((c) => `${c.id}@${c.version}`)).toEqual(
      ["research.experiment-report@0.1.0", "research.experiment-report@0.2.0", "research.experiment-report@0.3.0", "research.experiment-report@0.4.0"],
    );
    for (const entry of registry.contracts) {
      expect(existsSync(REPO_ROOT + entry.path), entry.path).toBe(true);
      expect(sha256File(REPO_ROOT + entry.path), entry.path).toBe(entry.sha256);
      const { contract } = loadRegisteredContract(REPO_ROOT + entry.path);
      expect([contract.id, contract.version]).toEqual([entry.id, entry.version]);
    }
  });

  it("keeps contract 0.1.0 exactly as first published", () => {
    // The digest of the file committed in f0d4ec7. A published version is never edited; a change is a new version.
    expect(sha256File(REPO_ROOT + CONTRACT_010)).toBe("55473beee661ad0e793f18872d52a633b67654fa02e21795a4d29a963b20a203");
  });

  it("every check kind in the registered contracts has a validator, except human review", () => {
    for (const entry of loadRegistry().contracts) {
      const { contract } = loadRegisteredContract(REPO_ROOT + entry.path);
      const missing = contract.requirements.map((r) => r.check.kind).filter((kind) => !IMPLEMENTED_CHECK_KINDS.includes(kind));
      expect(missing, entry.version).toEqual(["human-review"]);
    }
  });
});

describe("verify: no verdict without a contract bound to its content", () => {
  const refused = (contractPath: string, registryPath?: string) => {
    try {
      verify({ runDir: RUN_A, contractPath, repo: REPO_ROOT, registryPath });
    } catch (error) {
      expect(error).toBeInstanceOf(PreconditionError);
      return (error as Error).message;
    }
    throw new Error("a verdict was issued");
  };

  it("refuses a contract that keeps a registered id and version and changes anything else", () => {
    const changes: Record<string, (contract: any) => void> = {
      "a requirement removed": (c) => { c.requirements = c.requirements.filter((r: any) => r.id !== "R-008"); },
      "a mandatory requirement made advisory": (c) => { c.requirements.find((r: any) => r.id === "R-008").level = "advisory"; },
      "a tolerance loosened": (c) => { c.requirements.find((r: any) => r.id === "R-008").check.params.cross_platform_abs_tolerance = 1; },
      "only whitespace changed": () => {},
    };
    for (const [name, mutate] of Object.entries(changes)) {
      expect(refused(writeContract(mutate)), name).toMatch(/contract content does not match the registry/);
    }
  });

  it("refuses a contract whose id and version are not registered", () => {
    expect(refused(writeContract((c) => { c.version = "9.9.9"; }))).toMatch(/is not in the registry/);
    expect(refused(writeContract((c) => { c.id = "research.anything-goes"; }))).toMatch(/is not in the registry/);
  });

  it("refuses a contract that pins another artifact schema than the verifier has", () => {
    const wrongDigest = writeContract((c) => { c.artifact.schema_sha256 = "0".repeat(64); });
    expect(refused(wrongDigest, writeRegistry(wrongDigest))).toMatch(/artifact schema does not match the contract/);
    const otherSchema = writeContract((c) => { c.artifact.schema = "spec/other.schema.json"; });
    expect(refused(otherSchema, writeRegistry(otherSchema))).toMatch(/does not implement/);
  });

  it("refuses a missing run directory and an unreadable registry", () => {
    expect(() => verify({ runDir: RUN_A + "-missing", contractPath: REPO_ROOT + CONTRACT })).toThrow(PreconditionError);
    expect(() => verify({ runDir: RUN_A, contractPath: REPO_ROOT + CONTRACT, registryPath: "no-such-registry.json" })).toThrow(PreconditionError);
  });
});

describe("verify: the verdict record", () => {
  const record = verify({ runDir: RUN_A, contractPath: REPO_ROOT + CONTRACT, repo: REPO_ROOT });

  it("binds the verdict to the contract bytes, the artifact bytes and the verifier revision", () => {
    expect(record.contract).toMatchObject({
      id: "research.experiment-report", version: "0.2.0", registered: true,
      sha256: sha256File(REPO_ROOT + CONTRACT),
      registry_sha256: sha256File(REPO_ROOT + "spec/contracts/registry.json"),
    });
    expect(record.artifact.sha256).toBe(sha256File(join(RUN_A, "artifact.json")));
    expect(record.verifier.revision).toBe(git("rev-parse", "HEAD"));
    expect(record.verifier.dirty).toBe(git("status", "--porcelain") !== "");
  });

  it("reports every requirement once, with the fixed statement and no claim to capabilities it cannot establish", () => {
    expect(record.results.map((r) => r.requirement)).toEqual(
      ["R-001", "R-002", "R-003", "R-004", "R-005", "R-006", "R-007", "R-008", "R-009", "R-010", "R-011"],
    );
    expect(record.verdict).toBe("inconclusive");
    expect(record.statement).toBe(
      "inconclusive under contract research.experiment-report version 0.2.0: 9 of 10 mandatory requirements passed (9 machine, 0 empirical, 0 human); collector not attested",
    );
    expect(record.summary).toEqual({ mandatory: 10, passed: 9, machine: 9, empirical: 0, human: 0 });
    expect(record.capabilities).toEqual({ required: ["independent-collector", "content-hashing"], established: [] });
    expect(record.reproduction).toEqual({ requested: false });
    expect(record.collector.attested).toBe(false);
    expect(record.collector.problems.join("\n")).toMatch(/attestation/);
  });

  it("a test-only contract can be judged against its own registry, and the record shows it is not the published one", () => {
    const path = writeContract((c) => { c.requirements = c.requirements.filter((r: any) => r.id !== "R-008"); });
    const other = verify({ runDir: RUN_A, contractPath: path, repo: REPO_ROOT, registryPath: writeRegistry(path) });
    expect(other.verdict).toBe("accepted");
    expect(other.contract.sha256).not.toBe(record.contract.sha256);
    expect(other.contract.registry_sha256).not.toBe(record.contract.registry_sha256);
  });

  it("maps verdicts to distinct exit codes, none of them 2", () => {
    expect([exitCode("accepted"), exitCode("rejected"), exitCode("inconclusive")]).toEqual([0, 1, 3]);
  });
});
