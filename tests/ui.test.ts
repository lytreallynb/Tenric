// The web interface must show what the verifier decided and nothing more.
// These tests run its HTTP API against the real runs that scripts/verify.sh
// produces and compare it with the command line, then exercise the refusals.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { REPO_ROOT } from "../src/spec.ts";
import { PreconditionError, registration, verify } from "../ui/server/core.ts";
import { diffJson } from "../ui/server/data.ts";
import { startRun, getJob } from "../ui/server/jobs.ts";
import { createApp } from "../ui/server/server.ts";

const CONTRACT_ID = "research.experiment-report";
const SCRATCH = ["ui-test-runtime", "ui-test-html", "ui-test-broken", "ui-test-escape", "ui-test-stub", "ui-test-taken", "ui-test-cancel"];
let server: Server;
let port: number;

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; text: string; json: any }
function call(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { Host: `localhost:${port}`, ...options.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(options.body);
  });
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

function cleanScratch() {
  for (const id of SCRATCH) rmSync(join(REPO_ROOT, "runs", id), { recursive: true, force: true });
}

/** The contract the interface picks by default for a run, as a path for the command line. */
async function defaultContract(run: string): Promise<{ path: string; version: string }> {
  const contracts = (await call(`/api/runs/${run}`)).json.contracts as { path: string; version: string }[];
  return contracts.at(-1)!;
}
function cli(run: string, contractPath: string) {
  const done = spawnSync(process.execPath, ["src/cli.ts", "verify", `runs/${run}`, "--contract", contractPath], { cwd: REPO_ROOT, encoding: "utf8" });
  const rows = [...done.stdout.matchAll(/^(R-\d+)\s+(pass|fail|error|not_run)\b/gm)].map((m) => [m[1], m[2]]);
  return { code: done.status, verdictLine: /^verdict: (.*)$/m.exec(done.stdout)?.[1], rows };
}

beforeAll(async () => {
  cleanScratch();
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  cleanScratch();
});

describe("interface verdicts are the verifier's verdicts", () => {
  for (const run of ["verify-a", "verify-fail", "verify-timeout"]) {
    it(`${run}: same statement and same per-requirement statuses as the command line`, async () => {
      const contract = await defaultContract(run);
      const expected = cli(run, contract.path);
      const { json } = await call(`/api/runs/${run}/verify`);
      expect(json.issued).toBe(true);
      expect(json.record.statement).toBe(expected.verdictLine);
      expect(json.record.results.map((r: any) => [r.requirement, r.status])).toEqual(expected.rows);
      expect(json.record.verdict === "accepted").toBe(expected.code === 0);
      expect(json.record.contract.path).toBe(contract.path);
      expect(json.record.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  }

  it("the run list reports the same verdict as the single-run endpoint", async () => {
    const list = (await call("/api/runs")).json as any[];
    for (const id of ["verify-a", "verify-b", "verify-fail", "verify-timeout"]) {
      const single = (await call(`/api/runs/${id}/verify`)).json;
      expect(list.find((r) => r.id === id).verification.verdict).toBe(single.record.verdict);
    }
    expect(list.find((r) => r.id === "verify-fail").verification.verdict).toBe("rejected");
  });

  it("never words a verdict as verified or correct", async () => {
    const { text } = await call("/api/runs/verify-a/verify");
    expect(text).not.toMatch(/verified correct|\bproven\b|is correct/i);
  });
});

describe("no verdict is issued where none may be", () => {
  it("fixtures are labelled and never verified", async () => {
    const list = (await call("/api/runs")).json as any[];
    const fixture = list.find((r) => r.origin === "fixture");
    expect(fixture.data_class).toBe("fixture");
    expect(fixture.verification).toBeUndefined();
    const { json } = await call(`/api/runs/${encodeURIComponent(fixture.id)}/verify`);
    expect(json.issued).toBe(false);
    expect(json.record).toBeUndefined();
    const trust = (await call(`/api/runs/${encodeURIComponent(fixture.id)}`)).json.trust;
    expect(trust).toMatchObject({ made_by: "fixture", isolation: null, attestation: null, integrity: null, backend_sandbox: null });
  });

  it("an unknown contract version is a 404, not a default", async () => {
    expect((await call(`/api/runs/verify-a/verify?contract=${CONTRACT_ID}&version=99.0.0`)).status).toBe(404);
  });

  it("an unreadable artifact is not accepted", async () => {
    const dir = join(REPO_ROOT, "runs", "ui-test-broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "artifact.json"), "{ not json");
    const summary = ((await call("/api/runs")).json as any[]).find((r) => r.id === "ui-test-broken");
    expect(summary.readable).toBe(false);
    expect(summary.verification?.verdict).not.toBe("accepted");
    const contract = await defaultContract("verify-a");
    const { json } = await call(`/api/runs/ui-test-broken/verify?contract=${CONTRACT_ID}&version=${contract.version}`);
    if (json.issued) {
      expect(json.record.verdict).toBe("rejected");
      expect(json.record.results.some((r: any) => r.status === "pass")).toBe(false);
    }
  });
});

describe("run files", () => {
  it("serves a listed output with the digest the artifact recorded", async () => {
    const run = (await call("/api/runs/verify-a")).json;
    const metrics = run.files.find((f: any) => f.path === "metrics.json");
    expect(metrics).toMatchObject({ listed: true, present: true, matches: true });
    expect(metrics.sha256).toBe(metrics.recorded.sha256);
    const file = await call("/api/runs/verify-a/files/metrics.json");
    expect(file.status).toBe(200);
    expect(file.text).toBe(readFileSync(join(REPO_ROOT, "runs/verify-a/metrics.json"), "utf8"));
  });

  it("reports a modified output as a mismatch", async () => {
    const dir = join(REPO_ROOT, "runs", "ui-test-html");
    mkdirSync(dir, { recursive: true });
    const artifact = JSON.parse(readFileSync(join(REPO_ROOT, "runs/verify-a/artifact.json"), "utf8"));
    writeFileSync(join(dir, "artifact.json"), JSON.stringify(artifact));
    writeFileSync(join(dir, "metrics.json"), "{}");
    writeFileSync(join(dir, "page.html"), "<script>alert(1)</script>");
    const files = (await call("/api/runs/ui-test-html")).json.files as any[];
    expect(files.find((f) => f.path === "metrics.json").matches).toBe(false);
    expect(files.find((f) => f.path === "report.md")).toMatchObject({ listed: true, present: false, matches: false });
    expect(files.find((f) => f.path === "page.html").listed).toBe(false);
    expect((await call("/api/runs/ui-test-html/verify")).json.record.verdict).toBe("rejected");
  });

  it("never serves run output as HTML", async () => {
    const page = await call("/api/runs/ui-test-html/files/page.html");
    expect(page.headers["content-type"]).toBe("application/octet-stream");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("refuses paths that leave the run directory", async () => {
    const dir = join(REPO_ROOT, "runs", "ui-test-escape");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "artifact.json"), "{}");
    let linked = true;
    try {
      symlinkSync(join(REPO_ROOT, "package.json"), join(dir, "link.json"));
    } catch {
      linked = false; // Windows without the privilege to create symlinks: that one path cannot be exercised there.
    }
    if (linked) expect((await call("/api/runs/ui-test-escape/files/link.json")).status).toBe(400);
    // The URL parser collapses encoded dot segments before routing; either way nothing is served.
    expect([400, 404]).toContain((await call("/api/runs/verify-a/files/%2e%2e/%2e%2e/package.json")).status);
    expect((await call("/api/runs/verify-a/files/figures%2f..%2f..%2f..%2fpackage.json")).status).toBe(400);
    expect((await call("/api/runs/..%2f..%2fsrc/files/cli.ts")).status).toBe(404);
    expect((await call("/%2e%2e/server/server.ts")).status).toBe(404);
  });
});

describe("comparison", () => {
  it("two runs of the same source differ only in fields both declare volatile", async () => {
    const { json } = await call("/api/compare?a=verify-a&b=verify-b");
    expect(json.comparable).toBe(true);
    expect(json.counts.other).toBe(0);
    expect(json.counts.volatile).toBeGreaterThan(0);
    expect(json.metrics.every((m: any) => m.identical === true)).toBe(true);
    for (const output of json.outputs) expect(output.identical).toBe(output.determinism !== "volatile");
  });

  it("a succeeded and a failed run differ outside the volatile set", async () => {
    const { json } = await call("/api/compare?a=verify-a&b=verify-fail");
    expect(json.counts.other).toBeGreaterThan(0);
    expect(json.differences.some((d: any) => d.pointer === "/execution/status" && !d.volatile)).toBe(true);
  });

  it("diffJson reports additions, removals and changes by pointer", () => {
    expect(diffJson({ a: 1, b: [1, 2], c: { d: "x" } }, { a: 1, b: [1, 3, 4], c: {} }, ["/b/2"])).toEqual([
      { pointer: "/b/1", a: 2, b: 3, in_a: true, in_b: true, volatile: false },
      { pointer: "/b/2", a: undefined, b: 4, in_a: false, in_b: true, volatile: true },
      { pointer: "/c", a: undefined, b: {}, in_a: false, in_b: true, volatile: false },
      { pointer: "/c/d", a: "x", b: undefined, in_a: true, in_b: false, volatile: false },
    ]);
  });
});

describe("contracts and documents", () => {
  it("lists each contract file with the digest of the file on disk", async () => {
    const contracts = (await call("/api/contracts")).json as any[];
    expect(contracts.length).toBe(readdirSync(join(REPO_ROOT, "spec/contracts", CONTRACT_ID)).filter((n) => n.endsWith(".contract.json")).length);
    for (const c of contracts) {
      expect(c.usable).toBe(true);
      const detail = (await call(`/api/contracts/${c.id}/${c.version}`)).json;
      expect(detail.text).toBe(readFileSync(join(REPO_ROOT, c.path), "utf8"));
      expect(detail.requirements.length).toBe(c.requirements.total);
      // A requirement with no validator is one the verifier reports as not_run, and the count must agree.
      expect(detail.requirements.filter((r: any) => !r.validator_available).length).toBe(c.requirements.without_validator);
    }
  });

  it("serves only documents it listed", async () => {
    const docs = (await call("/api/docs")).json as any[];
    expect(docs.some((d) => d.path === "docs/rfcs/RFC-0001-minimal-contract-driven-runtime.md")).toBe(true);
    expect((await call("/api/doc?path=README.md")).json.text).toBe(readFileSync(join(REPO_ROOT, "README.md"), "utf8"));
    expect((await call("/api/doc?path=package.json")).status).toBe(404);
    expect((await call("/api/doc?path=../../etc/passwd")).status).toBe(404);
  });
});

describe("requests the interface refuses", () => {
  it("answers only on a loopback host name", async () => {
    expect((await call("/api/runs", { headers: { Host: "attacker.example" } })).status).toBe(400);
  });

  it("refuses a cross-origin request to start a run", async () => {
    const reply = await post("/api/runs", { run_id: "ui-test-stub" }, { Origin: "http://attacker.example" });
    expect(reply.status).toBe(400);
    expect(reply.json.error).toMatch(/cross-origin/);
  });

  it("refuses a form-encoded body, which a foreign page could send without a preflight", async () => {
    const reply = await call("/api/runs", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{\"run_id\":\"ui-test-stub\"}" });
    expect(reply.status).toBe(400);
  });

  it("refuses run ids that are not a single safe path segment, and directories that already hold files", async () => {
    for (const run_id of ["../escape", "a/b", "", ".hidden", "x".repeat(65), 7]) {
      expect((await post("/api/runs", { run_id })).status).toBe(400);
    }
    expect((await post("/api/runs", { run_id: "verify-a" })).json.error).toMatch(/already exists/);
    expect((await post("/api/runs", { run_id: "ui-test-stub", timeout_seconds: -1 })).status).toBe(400);
    expect((await post("/api/runs", { run_id: "ui-test-stub", config: [1] })).status).toBe(400);
    expect((await post("/api/runs", { run_id: "ui-test-stub", backend: "no-such-backend" })).status).toBe(400);
  });

  it("refuses a re-execution task that is not one of the repository's task files", async () => {
    expect((await post("/api/runs/verify-a/verify", { reproduce_task: "../../etc/passwd" })).status).toBe(400);
    expect((await post("/api/runs/verify-a/verify", { reproduce_task: "package.json" })).status).toBe(400);
  });
});

describe("contract registry and re-execution", () => {
  it("issues no verdict under a contract file the registry does not list", () => {
    // Same id and version as the registered contract, with the empirical requirement removed.
    const altered = JSON.parse(readFileSync(join(REPO_ROOT, "spec/contracts", CONTRACT_ID, "0.1.0.contract.json"), "utf8"));
    altered.requirements = altered.requirements.filter((r: any) => r.verifiability === "machine");
    const path = join(mkdtempSync(join(tmpdir(), "tenric-ui-contract-")), "0.1.0.contract.json");
    writeFileSync(path, JSON.stringify(altered));
    expect(registration(path)).toMatchObject({ registered: false });
    expect(registration(path).reason).toMatch(/does not match the registry/);
    expect(() => verify(join(REPO_ROOT, "runs/verify-a"), path)).toThrow(PreconditionError);
  });

  it("offers only registered contracts for a run", async () => {
    const offered = (await call("/api/runs/verify-a")).json.contracts as any[];
    const listed = (await call("/api/contracts")).json as any[];
    expect(offered.length).toBeGreaterThan(0);
    for (const c of offered) expect(listed.find((l) => l.id === c.id && l.version === c.version).registered).toBe(true);
  });

  it("with re-execution, returns the verifier's record with the reproduction requirement decided", async () => {
    const run = (await call("/api/runs/verify-a")).json;
    expect(run.reproduction_tasks.map((task: any) => task.path)).toContain("experiments/baseline/task.json");
    const contract = run.contracts.at(-1);
    const without = (await call("/api/runs/verify-a/verify")).json.record;
    const { json } = await post("/api/runs/verify-a/verify", { contract: contract.id, version: contract.version, reproduce_task: "experiments/baseline/task.json" });
    expect(json.issued).toBe(true);
    expect(json.record.reproduction.requested).toBe(true);
    expect(json.record.contract.sha256).toBe(without.contract.sha256);
    expect(json.record.artifact.sha256).toBe(without.artifact.sha256);
    const reproduction = (record: any) => record.results.find((r: any) => r.kind === "numeric-reproduction");
    expect(reproduction(without).status).toBe("not_run");
    expect(reproduction(json.record).status).not.toBe("not_run");
    expect(json.exit_code).toBe(json.record.verdict === "accepted" ? 0 : json.record.verdict === "rejected" ? 1 : 3);
    // The statement is assembled by the verifier; the interface must not have altered it.
    expect(json.record.statement.startsWith(`${json.record.verdict} under contract ${contract.id} version ${contract.version}: `)).toBe(true);
  }, 600_000);
});

describe("starting a run", () => {
  it("records the process's exit code and output, and reports a failed start as failed", async () => {
    // A stub in place of uv: this tests the job bookkeeping, not the collector (scripts/verify.sh runs the real one).
    const job = await startRun({ run_id: "ui-test-stub", timeout_seconds: 5 }, [process.execPath, "-e", "console.log('stub ran'); process.exit(3)"]);
    expect(job.command.slice(-4)).toEqual(["--out", "runs/ui-test-stub", "--timeout", "5"]);
    await expect(startRun({ run_id: "ui-test-taken" })).rejects.toThrow(/already in progress/);
    await expect.poll(() => getJob(job.id).state, { timeout: 10_000 }).toBe("exited");
    expect(getJob(job.id).exit_code).toBe(3);
    expect(getJob(job.id).log).toContain("stub ran");
    expect((await call(`/api/jobs/${job.id}`)).json.exit_code).toBe(3);

    const missing = await startRun({ run_id: "ui-test-taken" }, ["/nonexistent/tenric-ui-test-binary"]);
    await expect.poll(() => getJob(missing.id).state, { timeout: 10_000 }).toBe("spawn_failed");
    expect(getJob(missing.id).exit_code).toBeNull();
  });

  it("cancels a running job through the API, and refuses to cancel one that is not running", async () => {
    const job = await startRun({ run_id: "ui-test-cancel" }, [process.execPath, "-e", "console.log('waiting'); setTimeout(() => {}, 60_000)"]);
    await expect.poll(() => getJob(job.id).log, { timeout: 10_000 }).toContain("waiting");
    const cancel = await post(`/api/jobs/${job.id}/cancel`, {});
    expect(cancel.status).toBe(202);
    expect(cancel.json.cancel_requested_at).toEqual(expect.any(String));
    await expect.poll(() => getJob(job.id).state, { timeout: 10_000 }).toBe("cancelled");
    expect(getJob(job.id).log).toContain("cancel requested");
    expect((await post(`/api/jobs/${job.id}/cancel`, {})).status).toBe(400);
    expect((await post("/api/jobs/no-such-job/cancel", {})).status).toBe(404);
    expect((await post(`/api/jobs/${job.id}/cancel`, {}, { Origin: "http://evil.example" })).json.error).toMatch(/cross-origin/);
  });
});

describe("runs made by the runtime", () => {
  const FIXTURE_TASK = "fixtures/tasks/coin-flips.task.json";

  it("lists the runtime's backends and tasks, and labels fixture tasks", async () => {
    const system = (await call("/api/system")).json;
    const expected = JSON.parse(spawnSync(process.execPath, ["src/tenric.ts", "backends", "--json"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout) as any[];
    expect(system.backends.map((b: any) => b.name)).toEqual(["baseline-script", ...expected.map((b) => b.name)]);
    expect(system.tasks.find((t: any) => t.path === FIXTURE_TASK).fixture).toBe(true);
    expect(system.tasks.filter((t: any) => t.path.startsWith("tasks/")).every((t: any) => t.fixture === false)).toBe(true);
  });

  it("compiles without running, and reports a precondition failure as no plan", async () => {
    const ok = (await post("/api/compile", { task: FIXTURE_TASK, backend: "script" })).json;
    expect(ok.ok).toBe(true);
    expect(ok.plan.predicted).toBeDefined();
    expect((await post("/api/compile", { task: "package.json", backend: "script" })).json.ok).toBe(false);
    expect((await post("/api/compile", { task: FIXTURE_TASK, backend: "no-such-backend" })).json.ok).toBe(false);
  });

  it("starts a script-backend run, follows it, and agrees with the verdict the runtime recorded", async () => {
    const started = await post("/api/runs", { run_id: "ui-test-runtime", backend: "script", task: FIXTURE_TASK });
    expect(started.status).toBe(202);
    await expect.poll(async () => (await call(`/api/jobs/${started.json.id}`)).json.state, { timeout: 120_000, interval: 500 }).toBe("exited");
    const job = (await call(`/api/jobs/${started.json.id}`)).json;
    expect(job.events.at(-1).type).toBe("run.finished");
    expect(job.events.every((e: any) => ["runtime", "collector", "backend"].includes(e.source))).toBe(true);

    const run = (await call("/api/runs/ui-test-runtime")).json;
    const recorded = JSON.parse(readFileSync(join(REPO_ROOT, "runs/ui-test-runtime/tenric/run.json"), "utf8"));
    expect(run.summary.runtime).toMatchObject({ backend: "script", recorded_verdict: recorded.verification.verdict });
    expect(run.summary.data_class).toBe("fixture");
    expect(run.default_contract).toEqual({ id: recorded.contract.id, version: recorded.contract.version });
    expect(run.events.events.length).toBe(job.events.length);
    expect(run.runtime.plan.plan_schema).toBeDefined();
    expect(run.files.some((f: any) => f.path.includes(".git/"))).toBe(false);
    expect([0, 1, 3]).toContain(job.exit_code);
    // The trust boundary is read from the run's records as they stand: nothing the runtime did not write is filled in.
    expect(run.trust.made_by).toBe("runtime");
    expect(run.trust.backend_sandbox).toEqual(run.runtime.plan.backend.capabilities.sandbox);
    expect(run.trust.isolation).toBe(recorded.isolation ?? null);
    expect(run.trust.attestation).toBe(recorded.attestation ?? null);
    expect(run.trust.integrity.violations).toEqual(job.events.find((e: any) => e.type === "integrity.checked").violations);
    expect(run.trust.review_checklist).toEqual(run.runtime.plan.review_checklist);

    // Verified again now, with the run's own re-execution task: the verifier must reach what the runtime recorded.
    const again = (await post("/api/runs/ui-test-runtime/verify", { reproduce_task: run.reproduction_tasks[0].path })).json;
    expect(again.issued).toBe(true);
    expect(again.record.statement).toBe(recorded.verification.wording);
    expect(again.exit_code).toBe(job.exit_code);
    // Without re-execution the same run must not be reported as accepted when the contract requires reproduction.
    const live = (await call("/api/runs/ui-test-runtime/verify")).json.record;
    expect(live.results.find((r: any) => r.kind === "numeric-reproduction").status).toBe("not_run");
    expect(live.verdict).not.toBe("accepted");
  }, 300_000);

  it("refuses a task that is not a listed task file", async () => {
    expect((await post("/api/runs", { run_id: "ui-test-taken", backend: "script", task: "package.json" })).status).toBe(400);
  });
});

describe("interface text", () => {
  it("has every string in both languages and leaves the verifier's vocabulary untranslated", async () => {
    const { KEYS } = (await import("../ui/public/js/i18n.js" as string)) as { KEYS: { en: string[]; zh: string[] } };
    expect([...KEYS.zh].sort()).toEqual([...KEYS.en].sort());
    const source = readFileSync(join(REPO_ROOT, "ui/public/js/i18n.js"), "utf8");
    for (const word of ["已接受", "已拒绝", "已验证", "验证正确"]) expect(source).not.toContain(word);
  });
  it("serves every file the page loads, under a policy that allows no inline script or style", async () => {
    const page = await call("/");
    expect(page.status).toBe(200);
    expect(String(page.headers["content-security-policy"])).toContain("default-src 'self'");
    expect(page.text).not.toMatch(/<style|style=|<script(?![^>]*\bsrc=)/);
    const loaded = [...page.text.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]!);
    expect(loaded).toEqual(expect.arrayContaining(["/style.css", "/js/theme.js", "/js/app.js"]));
    for (const path of loaded) expect((await call(path)).status, path).toBe(200);
  });

  it("builds the page from text nodes: no front-end file parses a string as HTML", () => {
    const root = join(REPO_ROOT, "ui/public/js");
    const files = [...readdirSync(root), ...readdirSync(join(root, "views")).map((name) => `views/${name}`)].filter((name) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
