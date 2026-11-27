// The sandbox and the collector record, tested against what a misbehaving
// producer would try. On a machine where no sandbox can be built, the
// boundary tests are skipped and the fallback tests run instead; the test
// output says which.
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCollectorKey, signStatement } from "../../src/attestation.ts";
import { REPO_ROOT } from "../../src/spec.ts";
import { verify } from "../../src/verify.ts";
import { ClaudeCodeBackend, ScriptBackend } from "../../src/runtime/backends.ts";
import { loadOrCreateIdentity } from "../../src/runtime/keys.ts";
import { runTask } from "../../src/runtime/runtime.ts";
import { resetSandboxProbe, sandboxAvailability, sandboxed } from "../../src/runtime/sandbox.ts";
import { readJson, sha256File, stableJson } from "../../src/runtime/util.ts";

const TASK = REPO_ROOT + "fixtures/tasks/coin-flips.task.json";
// The same fixture under contract 0.4.0, which requires the collector record (R-012). Its R-010 fails, because a fixture is not a measurement.
const TASK_040 = REPO_ROOT + "fixtures/tasks/coin-flips-0.4.0.task.json";
const CONTRACT_040 = REPO_ROOT + "spec/contracts/research.experiment-report/0.4.0.contract.json";
const LONG = 120_000;
const SANDBOX = sandboxAvailability().available;
const scratch = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
const KEYS = scratch("tenric-test-keys-");
process.env.TENRIC_KEY_DIR = KEYS;

function inSandbox(command: string[], spec: { readonly?: string[]; writable?: string[]; network?: boolean; hidden?: string[] } = {}) {
  const cwd = spec.writable?.[0] ?? "/";
  const wrapped = sandboxed(command, { readonly: spec.readonly ?? [], writable: spec.writable ?? [], cwd, network: spec.network ?? false, hidden: spec.hidden });
  return spawnSync(wrapped.command, wrapped.args, { encoding: "utf8", timeout: 30_000 });
}

describe.runIf(SANDBOX)("the sandbox boundary", () => {
  const secretDir = scratch("tenric-secret-");
  writeFileSync(join(secretDir, "collector-key.pem"), "secret");
  const work = scratch("tenric-work-");
  const ro = scratch("tenric-ro-");
  writeFileSync(join(ro, "file"), "read me");

  it("shows the listed paths and nothing else of the host", () => {
    const r = inSandbox(["/bin/sh", "-c", `cat ${ro}/file; cat ${secretDir}/collector-key.pem; ls /root /home 2>&1; true`], { readonly: [ro], writable: [work] });
    expect(r.stdout).toContain("read me");
    expect(r.stdout).not.toContain("secret");
    expect(r.stderr + r.stdout).toMatch(/No such file|cannot access/);
  });

  it("refuses a spec that would expose a hidden path, instead of exposing it", () => {
    expect(() => sandboxed(["/bin/true"], { readonly: [tmpdir()], writable: [], cwd: "/", network: false, hidden: [secretDir] })).toThrow(/would expose/);
  });

  it("enforces read-only and writable as listed", () => {
    const r = inSandbox(["/bin/sh", "-c", `echo x > ${ro}/new 2>/dev/null && echo RO-WRITTEN; echo y > ${work}/new && echo RW-WRITTEN`], { readonly: [ro], writable: [work] });
    expect(r.stdout).not.toContain("RO-WRITTEN");
    expect(r.stdout).toContain("RW-WRITTEN");
    expect(existsSync(join(ro, "new"))).toBe(false);
  });

  it("cannot remount a read-only path writable or unmount it, even from a nested namespace", () => {
    const r = inSandbox(["/bin/sh", "-c", [
      `mount -o remount,rw,bind ${ro} 2>/dev/null && echo REMOUNTED`,
      `unshare -rm sh -c "mount -o remount,rw,bind ${ro} && echo NESTED-REMOUNTED; umount ${ro} && echo NESTED-UNMOUNTED" 2>/dev/null`,
      `echo z > ${ro}/escaped 2>/dev/null && echo ESCAPED`, "true",
    ].join("; ")], { readonly: [ro], writable: [work] });
    expect(r.stdout).not.toMatch(/REMOUNTED|UNMOUNTED|ESCAPED/);
  });

  it("hides every host process", () => {
    const r = inSandbox(["/bin/sh", "-c", "ls /proc | grep -c '^[0-9]'"], { writable: [work] });
    expect(Number(r.stdout.trim())).toBeLessThan(5);
  });

  it("has no network when network is off", () => {
    const r = inSandbox(["/bin/sh", "-c", "cat /proc/net/dev | tail -n +3 | cut -d: -f1 | tr -d ' '"], { writable: [work] });
    expect(r.stdout.trim().split("\n").filter(Boolean)).toEqual(["lo"]);
  });
});

describe("the collector record", () => {
  it("a run whose code ran in the sandbox is signed, and the signature binds the artifact", async () => {
    const dir = join(scratch("tenric-runs-"), "run");
    const summary = await runTask({ taskPath: TASK_040, backend: new ScriptBackend(), runDir: dir });
    if (!SANDBOX) {
      expect(summary.attestation).toBeNull();
      expect(summary.attestation_refused).toMatch(/without a sandbox/);
      expect(existsSync(join(dir, "tenric/attestation.json"))).toBe(false);
      return;
    }
    expect(summary.isolation.execution).toMatchObject({ mechanism: "linux-userns", enforced: true, network: "none" });
    expect(summary.attestation).toMatchObject({ path: "tenric/attestation.json", subject_sha256: sha256File(join(dir, "artifact.json")), signer: "runtime" });
    const statement = (readJson(join(dir, "tenric/attestation.json")) as any).statement;
    expect(statement).toMatchObject({ type: "tenric.collector-record", version: "0.1.0", source_revision: summary.source!.revision, subject: { artifact_sha256: summary.attestation!.subject_sha256 } });

    // The runtime judged it with its own key trusted. Judge it again, once trusting that key and once not.
    expect((readJson(join(dir, "tenric/verification.json")) as any).results.find((r: any) => r.kind === "collector-attestation").status).toBe("pass");
    const identity = loadOrCreateIdentity(KEYS);
    const r012 = (collectorsPath?: string) => verify({ runDir: dir, contractPath: CONTRACT_040, repo: join(dir, "workspace"), ...(collectorsPath ? { collectorsPath } : {}) })
      .results.find((r) => r.kind === "collector-attestation")!;
    expect(r012(identity.collectors_path).status).toBe("pass");
    expect(r012().status).toBe("fail"); // the repository's registry ships empty: nobody is trusted by default

    // Change one byte of the artifact: the signature no longer covers it.
    const tampered = join(scratch("tenric-tampered-"), "run");
    cpSync(dir, tampered, { recursive: true });
    const artifact = readJson(join(tampered, "artifact.json")) as any;
    artifact.title += " ";
    writeFileSync(join(tampered, "artifact.json"), stableJson(artifact));
    const t = verify({ runDir: tampered, contractPath: CONTRACT_040, repo: join(tampered, "workspace"), collectorsPath: identity.collectors_path });
    expect(t.results.find((r) => r.kind === "collector-attestation")!.status).toBe("fail");
  }, LONG);

  it.runIf(SANDBOX)("a producer that signs its own record with its own key is not trusted (the group B case)", async () => {
    const dir = join(scratch("tenric-runs-"), "run");
    await runTask({ taskPath: TASK_040, backend: new ScriptBackend(), runDir: dir });
    const identity = loadOrCreateIdentity(KEYS);
    const genuine = readJson(join(dir, "tenric/attestation.json")) as any;
    const forger = generateCollectorKey(identity.id, "the producer's own key", ["independent-collector"]);
    writeFileSync(join(dir, "tenric/attestation.json"), stableJson(signStatement(genuine.statement, forger.privateKeyPem)));
    const record = verify({ runDir: dir, contractPath: CONTRACT_040, repo: join(dir, "workspace"), collectorsPath: identity.collectors_path });
    expect(record.results.find((r) => r.kind === "collector-attestation")!.status).toBe("fail");
    expect(record.capabilities.established).toEqual([]);
  }, LONG);

  it.runIf(SANDBOX)("an agent inside the sandbox cannot read the key, write the repository or see the runtime", async () => {
    loadOrCreateIdentity(KEYS); // the key exists on disk before the agent starts
    const dir = join(scratch("tenric-runs-"), "run");
    const summary = await runTask({ taskPath: TASK_040, backend: new ClaudeCodeBackend({ command: [process.execPath, REPO_ROOT + "tests/runtime/fake-claude.mjs", "--mode=snoop"] }), runDir: dir });
    const snoop = readJson(join(dir, "workspace/snoop.json")) as any;
    expect(snoop.read_key).toMatch(/^failed/);
    expect(snoop.write_repo).toMatch(/^failed/);
    expect(snoop.write_contract).toMatch(/^failed/);
    expect(snoop.visible_processes).toBeLessThan(5);
    expect(existsSync(REPO_ROOT + "snoop-was-here")).toBe(false);
    expect(summary.isolation.backend).toMatchObject({ mechanism: "linux-userns", enforced: true, network: "host" });
    expect(summary.attestation).not.toBeNull();
    expect((readJson(join(dir, "tenric/verification.json")) as any).results.find((r: any) => r.kind === "collector-attestation").status).toBe("pass");
  }, LONG);

  it.runIf(SANDBOX)("a record copied from another run does not vouch for this one", async () => {
    const [a, b] = [join(scratch("tenric-runs-"), "run"), join(scratch("tenric-runs-"), "run")];
    await runTask({ taskPath: TASK_040, backend: new ScriptBackend(), runDir: a });
    await runTask({ taskPath: TASK_040, backend: new ScriptBackend(), runDir: b });
    cpSync(join(a, "tenric/attestation.json"), join(b, "tenric/attestation.json"));
    const record = verify({ runDir: b, contractPath: CONTRACT_040, repo: join(b, "workspace"), collectorsPath: loadOrCreateIdentity(KEYS).collectors_path });
    expect(record.results.find((r) => r.kind === "collector-attestation")!.status).toBe("fail");
  }, LONG);
});

describe("without a sandbox", () => {
  afterEach(() => {
    delete process.env.TENRIC_SANDBOX;
    resetSandboxProbe();
  });
  const fake = () => new ClaudeCodeBackend({ command: [process.execPath, REPO_ROOT + "tests/runtime/fake-claude.mjs", "--mode=ok"] });

  it("an agent backend is refused, and nothing is signed", async () => {
    process.env.TENRIC_SANDBOX = "off";
    resetSandboxProbe();
    const dir = join(scratch("tenric-runs-"), "run");
    const summary = await runTask({ taskPath: TASK, backend: fake(), runDir: dir });
    expect(summary.status).toBe("failed");
    expect(summary.status_detail).toMatch(/refused to run without a sandbox/);
    expect(summary.attestation).toBeNull();
  }, LONG);

  it("an operator can override the refusal; the run is then recorded as unconfined and never signed", async () => {
    process.env.TENRIC_SANDBOX = "off";
    resetSandboxProbe();
    const dir = join(scratch("tenric-runs-"), "run");
    const summary = await runTask({ taskPath: TASK, backend: fake(), runDir: dir, allowUnsandboxed: true });
    expect(summary.status).toBe("completed");
    expect(summary.isolation.backend).toMatchObject({ mechanism: "none", enforced: false });
    expect(summary.attestation).toBeNull();
    expect(summary.attestation_refused).toMatch(/without a sandbox/);
    expect(existsSync(join(dir, "tenric/attestation.json"))).toBe(false);
  }, LONG);
});
