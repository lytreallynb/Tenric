// End-to-end tests of the runtime with the script backend and fixture
// producers. Every run here really executes a (trivial) experiment, twice, and
// is verified by the repository's verifier. The producers are fixtures and the
// runs are labelled data_class "fixture": none of this is a result.
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT, validateArtifact } from "../../src/spec.ts";
import { ClaudeCodeBackend, ScriptBackend, type Backend, type BackendRunRequest } from "../../src/runtime/backends.ts";
import { PreconditionError } from "../../src/runtime/compiler.ts";
import { listRuns, readRun } from "../../src/runtime/runs.ts";
import { runTask, type RunSummary } from "../../src/runtime/runtime.ts";
import { sandboxAvailability } from "../../src/runtime/sandbox.ts";
import { readJson, sha256File } from "../../src/runtime/util.ts";

const TASK = REPO_ROOT + "fixtures/tasks/coin-flips.task.json";
const PRODUCER = REPO_ROOT + "fixtures/producers/coin-flips";
const CONTRACT = "spec/contracts/research.experiment-report/0.1.0.contract.json";
const LONG = 120_000;
const SANDBOX = sandboxAvailability().available;
// Tests sign with a throwaway key, never with the machine's own.
process.env.TENRIC_KEY_DIR = mkdtempSync(join(tmpdir(), "tenric-test-keys-"));

const scratch = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
function producer(mutate: (dir: string) => void): ScriptBackend {
  const dir = scratch("tenric-producer-");
  cpSync(PRODUCER, dir, { recursive: true });
  mutate(dir);
  return new ScriptBackend({ producerDir: dir });
}
function editJson(path: string, mutate: (value: any) => void): void {
  const value = readJson(path);
  mutate(value);
  writeFileSync(path, JSON.stringify(value, null, 2));
}
function taskWith(mutate: (task: any) => void): string {
  const path = join(scratch("tenric-task-"), "task.json");
  cpSync(TASK, path);
  editJson(path, mutate);
  return path;
}
interface Outcome { run: RunSummary; dir: string; artifact: any; results: Record<string, string>; events: any[] }
async function run(backend: Backend, options: { taskPath?: string; signal?: AbortSignal; repoRoot?: string } = {}): Promise<Outcome> {
  const dir = join(scratch("tenric-runs-"), "run");
  const summary = await runTask({ taskPath: options.taskPath ?? TASK, backend, runDir: dir, signal: options.signal, repoRoot: options.repoRoot });
  const read = (path: string) => (existsSync(join(dir, path)) ? readJson(join(dir, path)) : undefined) as any;
  return {
    run: summary, dir, artifact: read("artifact.json"),
    results: Object.fromEntries((read("tenric/verification.json")?.results ?? []).map((r: any) => [r.requirement, r.status])),
    events: readFileSync(join(dir, "tenric/events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)),
  };
}
const experiment = (dir: string, source: string) => writeFileSync(join(dir, "experiment.py"), source);
const PREAMBLE = `import argparse, json, pathlib, sys, time
p = argparse.ArgumentParser(); p.add_argument("--config"); p.add_argument("--out"); a = p.parse_args()
out = pathlib.Path(a.out); (out / "data").mkdir(parents=True, exist_ok=True)
def deliver(heads=0.5):
    (out / "data" / "flips.csv").write_text("flip\\n")
    (out / "metrics.json").write_text(json.dumps({"n_flips": 1, "heads_fraction": heads}))
`;

describe("a run with a well-behaved producer", () => {
  let good: Outcome;
  beforeAll(async () => { good = await run(new ScriptBackend()); }, LONG);

  it("completes, and every phase is recorded", () => {
    expect(good.run).toMatchObject({ run_schema: "0.1.0", status: "completed", status_detail: null, data_class: "fixture" });
    expect(good.run.phases.map((p) => [p.name, p.status])).toEqual([
      ["compile", "ok"], ["workspace", "ok"], ["backend", "ok"], ["integrity", "ok"], ["commit", "ok"], ["execute", "ok"], ["reexecute", "ok"],
      ...(SANDBOX ? [["attest", "ok"]] : []), ["verify", "ok"],
    ]);
    expect(good.events.map((e) => e.type)).toEqual([
      "run.started", "workspace.prepared", "backend.started", "backend.finished", "integrity.checked", "workspace.committed",
      "execution.started", "execution.finished", "artifact.written", "reexecution.finished",
      SANDBOX ? "attestation.signed" : "attestation.refused", "verification.finished", "run.finished",
    ]);
    expect(good.events.map((e) => e.seq)).toEqual(good.events.map((_, i) => i + 1));
    expect(new Set(good.events.map((e) => e.source))).toEqual(new Set(["runtime", "collector"]));
  });

  it("writes a structurally valid artifact whose evidence the collector observed", () => {
    expect(validateArtifact(good.artifact), JSON.stringify(validateArtifact.errors)).toBe(true);
    expect(good.artifact).toMatchObject({ experiment_id: "fixture-coin-flips", data_class: "fixture" });
    expect(good.artifact.title).toMatch(/FIXTURE/);
    expect(good.artifact.execution).toMatchObject({ status: "succeeded", exit_code: 0, provenance: "collector" });
    expect(good.artifact.source).toMatchObject({ kind: "git", dirty: false, revision: good.run.source!.revision });
    expect(good.artifact.dataset).toMatchObject({ name: "data/flips.csv", version: "generated by this execution", provenance: "collector" });
    expect(good.artifact.dataset.producer_claims.provenance).toBe("producer");
    expect(good.artifact.outputs.map((o: any) => o.path)).toEqual(["data/flips.csv", "metrics.json", "report.md"]);
  });

  it("reads metric values from the hashed file and fills finding slots from them", () => {
    const metrics = readJson(join(good.dir, "metrics.json")) as any;
    expect(good.artifact.metrics.map((m: any) => [m.name, m.value])).toEqual([["heads_fraction", metrics.heads_fraction], ["n_flips", metrics.n_flips]]);
    expect(good.artifact.findings[0]).toMatchObject({
      statement: `Fixture statement: ${metrics.heads_fraction.toFixed(3)} of ${metrics.n_flips} simulated flips came up heads.`,
      provenance: "producer",
    });
  });

  it("is judged by the repository's verifier, which re-executes the workspace revision itself", () => {
    expect(good.results).toEqual({
      "R-001": "pass", "R-002": "pass", "R-003": "pass", "R-004": "pass", "R-005": "pass", "R-006": "pass", "R-007": "pass", "R-008": "pass", "R-009": "not_run",
    });
    const record = readJson(join(good.dir, "tenric/verification.json")) as any;
    expect(record.contract).toMatchObject({ sha256: good.run.contract.sha256, registered: true });
    expect(record.artifact.sha256).toBe(good.run.artifact!.sha256);
    expect(record.reproduction.requested).toBe(true);
    expect(record.results.find((r: any) => r.requirement === "R-008").detail).toMatch(/re-executed revision [0-9a-f]{40} in an equal environment: 2 metrics equal, 2 outputs byte-identical/);
    expect(record.statement).not.toMatch(/verified|correct/i);
    // Accepted under contract 0.1.0, which does not look at data_class. The run is a fixture and says so; see the 0.2.0 test below.
    expect(good.run.verification).toMatchObject({ verdict: "accepted", mandatory_passed: 8, mandatory_total: 8, wording: record.statement });
  });

  it("gives the same verdict through the tenric verify command line", () => {
    const done = spawnSync(process.execPath, [
      "src/tenric.ts", "verify", good.dir, "--contract", CONTRACT, "--repo", join(good.dir, "workspace"),
      "--reproduce", "--task", join(good.dir, "tenric/reproduce.task.json"),
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(done.stdout).toContain(`verdict: ${good.run.verification!.wording}`);
    expect(done.status).toBe(0);
  }, LONG);

  it("is rejected under contract 0.2.0, because a fixture is not a measurement", async () => {
    const outcome = await run(new ScriptBackend(), { taskPath: taskWith((t) => { t.contract.version = "0.2.0"; }) });
    expect(outcome.results).toMatchObject({ "R-008": "pass", "R-010": "fail", "R-011": "pass" });
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);

  it("executes the experiment a second time and finds the declared byte-identical outputs identical", () => {
    const record = readJson(join(good.dir, "tenric/reexecution.json")) as any;
    expect(record.consistent_with_declared).toBe(true);
    expect(record.outputs.map((o: any) => [o.path, o.determinism, o.identical])).toEqual([["data/flips.csv", "byte-identical", true], ["metrics.json", "byte-identical", true]]);
    expect(record.metrics.every((m: any) => m.abs_diff === 0)).toBe(true);
  });

  it("keeps the backend's work as a commit in the workspace and writes what a verifier needs to run it again", () => {
    expect(readFileSync(join(good.dir, "workspace/TASK.md"), "utf8")).toContain("# Task: DEMONSTRATION FIXTURE");
    expect((readJson(join(good.dir, "tenric/reproduce.task.json")) as any).collect.slice(-7)).toEqual(["collect", "--workspace", ".", "--config", "{config}", "--out", "{out}"]);
  });

  it("is re-executed correctly when the workspace is reached through a symlink and git would rewrite line endings", () => {
    // What macOS (temporary directory behind a symlink) and Windows (core.autocrlf) do to the verifier's re-execution.
    const link = join(scratch("tenric-link-"), "ws");
    symlinkSync(join(good.dir, "workspace"), link, "junction");
    const out = join(scratch("tenric-collect-"), "out");
    const done = spawnSync(process.execPath, [REPO_ROOT + "src/tenric.ts", "collect", "--workspace", ".", "--config", join(link, "config.json"), "--out", out], { cwd: link, encoding: "utf8" });
    expect(done.status, done.stderr).toBe(0);
    expect(readFileSync(join(good.dir, "workspace/.gitattributes"), "utf8")).toBe("* -text\n");
    const checkout = join(scratch("tenric-crlf-"), "wt");
    execFileSync("git", ["-c", "core.autocrlf=true", "-C", join(good.dir, "workspace"), "worktree", "add", "--quiet", "--detach", checkout, good.artifact.source.revision]);
    expect(sha256File(join(checkout, "config.json"))).toBe(good.artifact.config.sha256);
    execFileSync("git", ["-C", join(good.dir, "workspace"), "worktree", "remove", "--force", checkout]);
  }, LONG);

  it("can be collected again from the workspace alone with tenric collect", () => {
    const out = join(scratch("tenric-collect-"), "out");
    const done = spawnSync(process.execPath, ["src/tenric.ts", "collect", "--workspace", join(good.dir, "workspace"), "--out", out], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(done.status, done.stderr).toBe(0);
    const again = readJson(join(out, "artifact.json")) as any;
    expect(again.metrics).toEqual(good.artifact.metrics);
    expect(again.source.revision).toBe(good.artifact.source.revision);
  }, LONG);

  it("is listed and readable through the read-side interface", () => {
    expect(readRun(good.dir)).toEqual(good.run);
    expect(listRuns(dirname(good.dir)).map((r) => r.run_id)).toEqual(["run"]);
    expect(readRun(REPO_ROOT + "fixtures")).toBeUndefined();
  });
});

describe("a producer cannot supply its own evidence", () => {
  const cases: Record<string, (claims: any) => void> = {
    "claims.json that carries a provenance field": (claims) => { claims.dataset.provenance = "collector"; },
    "claims.json that states a metric value": (claims) => { claims.metrics[0].value = 0.99; },
    "claims.json that declares its own execution status": (claims) => { claims.execution = { status: "succeeded", exit_code: 0 }; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`${name} is refused and the run is rejected without executing anything`, async () => {
      const outcome = await run(producer((dir) => editJson(join(dir, "claims.json"), mutate)));
      expect(outcome.run.status).toBe("failed");
      expect(outcome.artifact.failure.reason).toMatch(/claims\.json does not conform/);
      expect(outcome.artifact.execution).toMatchObject({ status: "failed", exit_code: null, runtime_seconds: 0 });
      expect(outcome.artifact.metrics).toEqual([]);
      expect(outcome.run.verification!.verdict).toBe("rejected");
    }, LONG);
  }

  it("an artifact.json written by the producer into its workspace is not the artifact", async () => {
    const outcome = await run(producer((dir) => writeFileSync(join(dir, "artifact.json"), JSON.stringify({ forged: true }))));
    expect(outcome.artifact.forged).toBeUndefined();
    expect(outcome.artifact.execution.provenance).toBe("collector");
  }, LONG);
});

describe("failures are recorded, never dropped, and never accepted", () => {
  const rejected: Record<string, { source: string; status: string; reason: RegExp; fails: string }> = {
    "an experiment that exits non-zero": { source: PREAMBLE + "deliver(); sys.exit(3)\n", status: "failed", reason: /exited with code 3/, fails: "R-005" },
    "an experiment that exits 0 without writing metrics.json": { source: PREAMBLE + `(out / "data" / "flips.csv").write_text("flip\\n")\n`, status: "failed", reason: /wrote no metrics\.json/, fails: "R-005" },
    "an experiment that exits 0 with a metric that is not a number": {
      source: PREAMBLE + `deliver(heads="about half")\n`, status: "failed", reason: /no finite number at \/heads_fraction/, fails: "R-005",
    },
    "an experiment that writes artifact.json itself": {
      source: PREAMBLE + `deliver(); (out / "artifact.json").write_text("{}")\n`, status: "failed", reason: /only the runtime may write/, fails: "R-005",
    },
    // In the sandbox the workspace is read-only, so the write fails and the experiment with it. Without the sandbox
    // the write succeeds and the dirty source is what gets the run rejected.
    "an experiment that edits its own workspace while running": SANDBOX
      ? { source: PREAMBLE + `deliver(); pathlib.Path("config.json").write_text('{"seed": 8, "n_flips": 1, "p_heads": 1}')\n`, status: "failed", reason: /exited with code/, fails: "R-005" }
      : { source: PREAMBLE + `deliver(); pathlib.Path("config.json").write_text('{"seed": 8, "n_flips": 1, "p_heads": 1}')\n`, status: "completed", reason: /^$/, fails: "R-006" },
  };
  for (const [name, expected] of Object.entries(rejected)) {
    it(`${name} is rejected`, async () => {
      const outcome = await run(producer((dir) => experiment(dir, expected.source)));
      expect(outcome.run.status).toBe(expected.status);
      expect(outcome.artifact.failure?.reason ?? "").toMatch(expected.reason);
      expect(outcome.results[expected.fails]).toBe("fail");
      expect(outcome.run.verification!.verdict).toBe("rejected");
    }, LONG);
  }

  it("a finding slot that names no declared metric fails the run instead of leaving the slot in the report", async () => {
    const outcome = await run(producer((dir) => editJson(join(dir, "claims.json"), (c) => { c.findings[0].statement = "Accuracy was {{metric:accuracy}}."; })));
    expect(outcome.artifact.failure.reason).toMatch(/slot \{\{metric:accuracy\}\} names no declared metric/);
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);

  it("an experiment that runs past its limit is killed and recorded as a timeout", async () => {
    const started = Date.now();
    const outcome = await run(producer((dir) => experiment(dir, PREAMBLE + "time.sleep(60)\n")), { taskPath: taskWith((t) => { t.limits.execution_timeout_seconds = 2; }) });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(outcome.run.status).toBe("timeout");
    expect(outcome.artifact.execution).toMatchObject({ status: "timeout", exit_code: null });
    expect(outcome.artifact.failure.reason).toMatch(/exceeded 2 s/);
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);

  it("a cancelled run still leaves an artifact that says it was cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2500);
    const outcome = await run(producer((dir) => experiment(dir, PREAMBLE + "time.sleep(60)\n")), { signal: controller.signal });
    expect(outcome.run.status).toBe("cancelled");
    expect(outcome.artifact.execution.status).toBe("cancelled");
    expect(outcome.artifact.failure.reason).toMatch(/cancelled/);
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);

  it("a backend that does not complete yields a failed artifact naming the backend, and nothing is executed", async () => {
    const failing: Backend = {
      describe: () => ({ ...new ScriptBackend().describe(), name: "failing-test-backend" }),
      run: async () => ({ outcome: "timeout", exit_code: null, seconds: 1, detail: "simulated", self_report: {}, isolation: null }),
    };
    const outcome = await run(failing);
    expect(outcome.run.status).toBe("timeout");
    expect(outcome.artifact.failure.reason).toMatch(/backend failing-test-backend did not complete \(timeout\): simulated/);
    expect(outcome.events.find((e) => e.type === "execution.started").executed).toBe(false);
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);
});

describe("the experiment's environment", () => {
  it("is an allowlist plus pinned variables: nothing else from the caller reaches the experiment", async () => {
    // A host-wide MATPLOTLIBRC once changed the figures of the first execution and not of the verifier's re-execution.
    const leaked = { MATPLOTLIBRC: "/nonexistent/matplotlibrc", TENRIC_TEST_LEAK: "1", PYTHONPATH: "/nonexistent" };
    const before = Object.fromEntries(Object.keys(leaked).map((name) => [name, process.env[name]]));
    Object.assign(process.env, leaked);
    try {
      const outcome = await run(producer((dir) => experiment(dir, PREAMBLE +
        `import os\nfound = sorted(k for k in ("MATPLOTLIBRC", "TENRIC_TEST_LEAK", "PYTHONPATH") if k in os.environ)\n` +
        `if found or os.environ.get("PYTHONHASHSEED") != "0": sys.exit("leaked: " + ",".join(found))\ndeliver()\n`)));
      expect(outcome.artifact.failure?.stderr_tail ?? "").toBe("");
      expect(outcome.run.status).toBe("completed");
      expect(outcome.results["R-008"]).toBe("pass");
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, LONG);
});

describe("determinism is observed, not taken on trust", () => {
  it("an output that changes between executions while declared byte-identical is reported by the runtime and rejected by the verifier", async () => {
    const outcome = await run(producer((dir) => experiment(dir, PREAMBLE + "deliver(heads=time.time() % 1)\n")));
    const record = readJson(join(outcome.dir, "tenric/reexecution.json")) as any;
    expect(record.consistent_with_declared).toBe(false);
    expect(record.outputs.find((o: any) => o.path === "metrics.json")).toMatchObject({ determinism: "byte-identical", identical: false, held: false });
    expect(outcome.run.reexecution).toEqual({ consistent_with_declared: false, path: "tenric/reexecution.json" });
    // The runtime's comparison informs people. The verdict comes from the verifier's own re-execution.
    expect(outcome.results["R-008"]).toBe("fail");
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);

  it("declaring the file volatile does not rescue a metric that differs: the contract compares metric values exactly", async () => {
    // This is the contract as written (R-008, same_environment: byte-identical), and it is what a timing benchmark runs into.
    const outcome = await run(producer((dir) => {
      experiment(dir, PREAMBLE + "deliver(heads=time.time() % 1)\n");
      editJson(join(dir, "claims.json"), (c) => { c.outputs.push({ path: "metrics.json", determinism: "volatile" }); });
    }));
    expect((readJson(join(outcome.dir, "tenric/reexecution.json")) as any).consistent_with_declared).toBe(true);
    expect(outcome.artifact.outputs.find((o: any) => o.path === "metrics.json").determinism).toBe("volatile");
    expect(outcome.results["R-008"]).toBe("fail");
    expect(outcome.run.verification!.verdict).toBe("rejected");
  }, LONG);
});

describe("a backend that touches what judges it voids the run: no artifact, no verdict", () => {
  const tampering = (act: (request: BackendRunRequest) => void): Backend => ({
    describe: () => ({ ...new ScriptBackend().describe(), name: "tampering-test-backend" }),
    run: async (request) => {
      cpSync(PRODUCER, request.workspace, { recursive: true });
      act(request);
      return { outcome: "completed", exit_code: 0, seconds: 0, self_report: {}, isolation: null };
    },
  });
  function repoCopy(): string {
    const root = scratch("tenric-repo-") + "/";
    for (const name of ["spec", "pyproject.toml", "uv.lock", ".python-version"]) cpSync(REPO_ROOT + name, root + name, { recursive: true });
    return root;
  }
  const expectVoid = (outcome: Outcome, reason: RegExp) => {
    expect(outcome.run.status).toBe("void");
    expect(outcome.run.status_detail).toMatch(reason);
    expect(outcome.run.artifact).toBeNull();
    expect(outcome.run.verification).toBeNull();
    expect(existsSync(join(outcome.dir, "artifact.json"))).toBe(false);
    expect(existsSync(join(outcome.dir, "tenric/verification.json"))).toBe(false);
  };

  it("weakening the contract during the run", async () => {
    const root = repoCopy();
    const outcome = await run(tampering(({ repoRoot }) => editJson(repoRoot + CONTRACT, (c) => { c.requirements = c.requirements.filter((r: any) => r.id !== "R-008"); })), { repoRoot: root });
    expectVoid(outcome, /contract .* changed during the run/);
  }, LONG);

  it("editing the artifact schema during the run", async () => {
    const root = repoCopy();
    const outcome = await run(tampering(({ repoRoot }) => editJson(repoRoot + "spec/research-report.artifact.schema.json", (s) => { s.required = []; })), { repoRoot: root });
    expectVoid(outcome, /artifact schema .* changed during the run/);
  }, LONG);

  it("re-registering a weakened contract so that its digest matches again", async () => {
    const root = repoCopy();
    const outcome = await run(tampering(({ repoRoot }) => {
      editJson(repoRoot + CONTRACT, (c) => { c.requirements = c.requirements.filter((r: any) => r.id !== "R-005"); });
      editJson(repoRoot + "spec/contracts/registry.json", (r) => { r.contracts[0].sha256 = sha256File(repoRoot + CONTRACT); });
    }), { repoRoot: root });
    expectVoid(outcome, /contract registry .* changed during the run/);
  }, LONG);

  it("planting a ready-made artifact.json in the run directory", async () => {
    const outcome = await run(tampering(({ recordDir }) => writeFileSync(join(recordDir, "..", "..", "artifact.json"), JSON.stringify({ forged: true }))));
    expectVoid(outcome, /unexpected files in the run directory/);
  }, LONG);

  it("rewriting the compiled plan", async () => {
    const outcome = await run(tampering(({ recordDir }) => editJson(join(recordDir, "..", "plan.json"), (p) => { p.predicted.best_verdict = "accepted"; })));
    expectVoid(outcome, /plan\.json changed during the run/);
  }, LONG);

  it("rewriting the task it was given", async () => {
    const outcome = await run(tampering(({ workspace }) => editJson(join(workspace, "tenric.task.json"), (t) => { t.data_class = "measured"; })));
    expectVoid(outcome, /the backend changed tenric\.task\.json/);
  }, LONG);
});

describe("preconditions", () => {
  it("a task that cannot be compiled starts nothing and leaves no run directory", async () => {
    const dir = join(scratch("tenric-runs-"), "run");
    await expect(runTask({ taskPath: taskWith((t) => { t.contract.version = "9.9.9"; }), backend: new ScriptBackend(), runDir: dir })).rejects.toThrow(PreconditionError);
    expect(existsSync(dir)).toBe(false);
  });

  it("the command line exits 2 and prints no verdict", () => {
    for (const args of [["run"], ["run", "--task", TASK, "--backend", "no-such-backend"], ["compile", "--task", "no-such-task.json", "--backend", "script"], ["frobnicate"], []]) {
      const done = spawnSync(process.execPath, ["src/tenric.ts", ...args], { cwd: REPO_ROOT, encoding: "utf8" });
      expect(done.status, args.join(" ")).toBe(2);
      expect(done.stdout, args.join(" ")).toBe("");
      expect(done.stderr, args.join(" ")).toMatch(/^nothing ran: /);
    }
  });

  it("refuses a run directory that already has content", async () => {
    const dir = scratch("tenric-runs-");
    writeFileSync(join(dir, "leftover.txt"), "x");
    await expect(runTask({ taskPath: TASK, backend: new ScriptBackend(), runDir: dir })).rejects.toThrow(/not empty/);
  });
});

// A fake CLI stands in for Claude Code. These tests cover the adapter's own
// logic. They are not runs of any model and say nothing about any model.
describe("claude-code adapter logic, against a fake CLI (not a model)", () => {
  const fake = (mode: string) => new ClaudeCodeBackend({ command: [process.execPath, REPO_ROOT + "tests/runtime/fake-claude.mjs", `--mode=${mode}`] });

  it("passes the compiled instructions, stores the stream as the backend's account, and reports cost as backend-reported", async () => {
    const outcome = await run(fake("ok"));
    expect(outcome.run.status).toBe("completed");
    expect(outcome.run.backend).toMatchObject({ name: "claude-code", kind: "agent", outcome: "completed" });
    expect(outcome.run.backend.self_report).toMatchObject({ model: "fake-model-not-a-model", cost_usd: 0.0123, turns: 3, unparsed_stream_lines: 1 });
    const backendEvents = outcome.events.filter((e) => e.source === "backend");
    expect(backendEvents.map((e) => e.type)).toEqual(["backend.message", "backend.tool_use"]);
    expect(backendEvents[1]).toMatchObject({ tool: "Write", summary: "experiment.py" });
    const prompt = readFileSync(join(outcome.dir, "tenric/backend/prompt.txt"), "utf8");
    expect(prompt).toContain("# Task: DEMONSTRATION FIXTURE");
    expect(backendEvents[0].text).toBe(`prompt had ${prompt.length} characters`);
    expect(existsSync(join(outcome.dir, "tenric/backend/events.jsonl"))).toBe(true);
    // Nothing the backend said about itself reached the artifact.
    expect(JSON.stringify(outcome.artifact)).not.toContain("fake-model");
  }, LONG);

  const incomplete: Record<string, [string, RegExp]> = {
    "exit-nonzero": ["failed", /CLI exited with code 7/],
    "no-result": ["failed", /exited 0 without a result event/],
    "error-result": ["failed", /CLI reported an error result/],
  };
  for (const [mode, [status, reason]] of Object.entries(incomplete)) {
    it(`fails closed when the CLI ends with ${mode}`, async () => {
      const outcome = await run(fake(mode));
      expect(outcome.run.status).toBe(status);
      expect(outcome.run.status_detail).toMatch(reason);
      expect(outcome.run.verification!.verdict).toBe("rejected");
    }, LONG);
  }

  it("kills a CLI that exceeds the backend time limit", async () => {
    const started = Date.now();
    const outcome = await run(fake("hang"), { taskPath: taskWith((t) => { t.limits.backend_timeout_seconds = 2; }) });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(outcome.run.status).toBe("timeout");
    expect(outcome.run.backend.outcome).toBe("timeout");
  }, LONG);

  it("reports a CLI that is not installed as a failed backend, not as a crash", async () => {
    const outcome = await run(new ClaudeCodeBackend({ command: ["tenric-no-such-cli"] }));
    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.status_detail).toMatch(/could not start tenric-no-such-cli/);
  }, LONG);
});
