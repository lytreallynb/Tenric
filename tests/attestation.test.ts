// Collector attestation (contract 0.4.0, R-012). Until 0.4.0 a run directory could write
// provenance "collector" about itself and nothing tied that word to anyone. The control group
// of the runtime evaluation (group B: an agent writes its own run directory, with no runtime
// around it) did exactly that. These tests rebuild that case and assert that it is no longer
// accepted, and that a run signed by a collector the operator trusts is.
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTESTATION_PATH, canonicalStatementBytes, checkAttestation, generateCollectorKey, loadCollectors, signStatement, STATEMENT_TYPE,
} from "../src/attestation.ts";
import { canonicalJson, readJson, REPO_ROOT, sha256File } from "../src/spec.ts";
import { PreconditionError, verify } from "../src/verify.ts";
import { editArtifact, RUN_A, SLOW, tamperedCopy, TASK, tempDir, tenric } from "./helpers.ts";

const CONTRACT_040 = "spec/contracts/research.experiment-report/0.4.0.contract.json";
const CONTRACT_030 = "spec/contracts/research.experiment-report/0.3.0.contract.json";
const reproduce = { taskPath: REPO_ROOT + TASK };
const r012 = (record: ReturnType<typeof verify>) => record.results.find((r) => r.requirement === "R-012")!;

function contractRef(path: string) {
  const c = readJson(REPO_ROOT + path) as any;
  return { id: c.id, version: c.version, sha256: sha256File(REPO_ROOT + path) };
}

function statementFor(dir: string, collectorId: string, contractPath = CONTRACT_040, overrides: Record<string, unknown> = {}) {
  const artifact = readJson(join(dir, "artifact.json")) as any;
  return {
    type: STATEMENT_TYPE, version: "0.1.0", collector_id: collectorId, issued_at: "2026-11-27T00:00:00Z",
    subject: { artifact_path: "artifact.json", artifact_sha256: sha256File(join(dir, "artifact.json")) },
    source_revision: artifact.source.revision,
    contract: contractRef(contractPath),
    ...overrides,
  };
}

function writeAttestation(dir: string, attestation: unknown) {
  mkdirSync(join(dir, "tenric"), { recursive: true });
  writeFileSync(join(dir, ATTESTATION_PATH), canonicalJson(attestation));
}

function collectorsFile(...entries: unknown[]): string {
  const path = join(tempDir("tenric-collectors-"), "collectors.json");
  writeFileSync(path, canonicalJson({ collectors: entries, collectors_schema: "0.1.0" }));
  return path;
}

const trusted = generateCollectorKey("runtime@test", "test key generated in the test process", ["independent-collector", "content-hashing"]);
const TRUSTED = collectorsFile(trusted.entry);

/** A run signed by the trusted test collector, under 0.4.0. */
function signedRun(mutateBeforeSigning?: (dir: string) => void): string {
  return tamperedCopy((dir) => {
    mutateBeforeSigning?.(dir);
    writeAttestation(dir, signStatement(statementFor(dir, trusted.entry.id), trusted.privateKeyPem));
  });
}

describe("canonical statement bytes", () => {
  it("sort keys at every depth and carry no whitespace", () => {
    expect(canonicalStatementBytes({ b: 1, a: { d: [true, null], c: "x" } }).toString()).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
  });
  it("refuse floats, which have no single text form across languages", () => {
    expect(() => canonicalStatementBytes({ accuracy: 0.97 })).toThrow(/only integers/);
  });
});

describe("the collectors file", () => {
  it("ships empty: this repository trusts no collector until an operator adds one", () => {
    expect(loadCollectors(REPO_ROOT + "spec/collectors/registry.json").collectors).toEqual([]);
  });
  it("refuses an entry whose key_id is not the digest of its key", () => {
    const other = generateCollectorKey("other", "test");
    expect(() => loadCollectors(collectorsFile({ ...trusted.entry, key_id: other.entry.key_id }))).toThrow(/key_id/);
  });
  it("an invalid collectors file gives no verdict", () => {
    const bad = join(tempDir("tenric-collectors-"), "c.json");
    writeFileSync(bad, '{"collectors_schema":"0.1.0","collectors":[{"id":""}]}\n');
    expect(() => verify({ runDir: RUN_A, contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: bad })).toThrow(PreconditionError);
  });
});

describe("group B regression: evidence that calls itself collected", () => {
  // The run directory says provenance "collector" in every section, as group B's did. Nothing signs it.
  const selfClaimed = () => tamperedCopy(() => {});

  it("the run claims collector provenance everywhere", () => {
    const a = readJson(join(selfClaimed(), "artifact.json")) as any;
    for (const section of ["source", "environment", "dataset", "config", "execution"]) expect(a[section].provenance).toBe("collector");
  });

  it("is rejected under 0.4.0 even with a successful re-execution: R-012 fails", () => {
    const record = verify({ runDir: selfClaimed(), contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, reproduce, collectorsPath: TRUSTED });
    expect(r012(record).status).toBe("fail");
    expect(r012(record).detail).toMatch(/no collector attestation/);
    expect(record.verdict).toBe("rejected");
    expect(record.statement).toMatch(/; collector not attested$/);
    expect(record.collector.attested).toBe(false);
    expect(record.capabilities.established).toEqual([]);
  }, SLOW);

  it("is rejected when it signs itself with a key of its own that the operator never listed", () => {
    const dir = tamperedCopy((d) => {
      const own = generateCollectorKey("runtime@test", "made by the producer");
      writeAttestation(d, signStatement(statementFor(d, "runtime@test"), own.privateKeyPem));
    });
    const record = verify({ runDir: dir, contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: TRUSTED });
    expect(r012(record).detail).toMatch(/not in the operator's collectors file/);
    expect(record.verdict).toBe("rejected");
  });

  it("is rejected under the repository's own collectors file, which trusts nobody", () => {
    const record = verify({ runDir: signedRun(), contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT });
    expect(r012(record).status).toBe("fail");
    expect(record.verdict).toBe("rejected");
  });

  it("still shows under 0.3.0, which does not require attestation, that no collector was attested", () => {
    const record = verify({ runDir: selfClaimed(), contractPath: REPO_ROOT + CONTRACT_030, repo: REPO_ROOT, collectorsPath: TRUSTED });
    expect(record.results.some((r) => r.requirement === "R-012")).toBe(false);
    expect(record.statement).toMatch(/; collector not attested$/);
  });
});

describe("a signed run", () => {
  it("from a trusted collector is accepted with re-execution, names the collector and establishes what the operator says it establishes", () => {
    const record = verify({ runDir: signedRun(), contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, reproduce, collectorsPath: TRUSTED });
    expect(r012(record).status).toBe("pass");
    expect(record.verdict).toBe("accepted");
    expect(record.statement).toMatch(/; signed with the key of trusted collector runtime@test$/);
    expect(record.collector).toMatchObject({ attested: true, id: "runtime@test", key_id: trusted.entry.key_id });
    expect(record.capabilities.established).toEqual(["independent-collector", "content-hashing"]);
    expect(record.collectors.sha256).toBe(sha256File(TRUSTED));
  }, SLOW);

  it("is rejected when artifact.json changes after signing", () => {
    const dir = signedRun();
    editArtifact(dir, (a) => { a.title = a.title + " (edited)"; });
    const record = verify({ runDir: dir, contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: TRUSTED });
    expect(r012(record).detail).toMatch(/statement is about artifact/);
    expect(record.verdict).toBe("rejected");
  });

  it("is rejected when the statement is edited after signing", () => {
    const dir = signedRun();
    const path = join(dir, ATTESTATION_PATH);
    const a = JSON.parse(readFileSync(path, "utf8"));
    a.statement.collector_id = "someone-else";
    writeFileSync(path, canonicalJson(a));
    expect(r012(verify({ runDir: dir, contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: TRUSTED })).detail)
      .toMatch(/signature does not verify/);
  });

  it("is rejected when it was signed for another contract or another revision", () => {
    const forOther = tamperedCopy((d) => writeAttestation(d, signStatement(statementFor(d, trusted.entry.id, CONTRACT_030), trusted.privateKeyPem)));
    expect(r012(verify({ runDir: forOther, contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: TRUSTED })).detail)
      .toMatch(/collected for contract/);
    const otherRevision = tamperedCopy((d) => writeAttestation(d,
      signStatement(statementFor(d, trusted.entry.id, CONTRACT_040, { source_revision: "0".repeat(40) }), trusted.privateKeyPem)));
    expect(r012(verify({ runDir: otherRevision, contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: TRUSTED })).detail)
      .toMatch(/source revision/);
  });

  it("is rejected when the operator has revoked the key", () => {
    const revoked = collectorsFile({ ...trusted.entry, revoked: true });
    expect(r012(verify({ runDir: signedRun(), contractPath: REPO_ROOT + CONTRACT_040, repo: REPO_ROOT, collectorsPath: revoked })).detail)
      .toMatch(/revoked/);
  });

  it("checkAttestation returns the entry only with a good signature", () => {
    const dir = signedRun();
    const artifact = readJson(join(dir, "artifact.json")) as any;
    const check = checkAttestation(join(dir, ATTESTATION_PATH), loadCollectors(TRUSTED),
      { artifactSha256: sha256File(join(dir, "artifact.json")), sourceRevision: artifact.source.revision, contract: contractRef(CONTRACT_040) });
    expect(check.problems).toEqual([]);
    expect(check.collector?.id).toBe("runtime@test");
  });
});

describe("the CLI: collector-key, attest, verify --collectors", () => {
  it("an operator-made key signs a run and the run is accepted with exit 0", () => {
    const keys = tempDir("tenric-keys-");
    const made = tenric(["collector-key", keys, "--collector-id", "ci@test", "--custody", "test", "--establishes", "independent-collector"]);
    expect(made.code).toBe(0);
    expect(tenric(["collector-key", keys, "--collector-id", "ci@test", "--custody", "test"]).code).toBe(2);
    const dir = tamperedCopy(() => {});
    const signed = tenric(["attest", dir, "--contract", CONTRACT_040, "--key", join(keys, "collector.key"), "--collector-id", "ci@test"]);
    expect(signed.code).toBe(0);
    const out = tenric(["verify", dir, "--contract", CONTRACT_040, "--collectors", join(keys, "collectors.json"), "--repo", ".", "--reproduce", "--task", TASK]);
    expect(out.out).toMatch(/^verdict: accepted under contract research\.experiment-report version 0\.4\.0: .*; signed with the key of trusted collector ci@test$/m);
    expect(out.code).toBe(0);
    const unsigned = tenric(["verify", tamperedCopy(() => {}), "--contract", CONTRACT_040, "--collectors", join(keys, "collectors.json"), "--repo", "."]);
    expect(unsigned.code).toBe(1);
  }, SLOW);
});
