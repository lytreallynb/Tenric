// Isolation for code the runtime did not write: the agent backend and the experiment.
//
// Linux only, with util-linux's `unshare` and `setpriv` and unprivileged user namespaces;
// no other dependency (docs/adr/0011-namespace-sandbox-and-collector-attestation.md).
// Elsewhere the sandbox is reported unavailable and callers decide: the experiment then
// runs without it and says so, and an agent backend is refused unless the operator
// overrides that explicitly.
//
// What it gives: a filesystem that contains only the system directories, the paths the
// caller lists (read-only unless listed writable) and private /tmp, /proc and /dev; a PID
// namespace in which no host process is visible; no network when network is off; an
// unprivileged user with no_new_privs and locked mounts. What it does not give: limits on
// CPU, memory or disk; any restriction on network when network is on (the agent needs it
// to reach its model); a different host user (the files it can see are owned by the
// runtime's user); protection against kernel vulnerabilities.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SANDBOX_SCRIPT = fileURLToPath(new URL("./sandbox.sh", import.meta.url));

export interface IsolationRecord {
  mechanism: "linux-userns" | "none";
  enforced: boolean;
  network: "host" | "none";
  writable_paths: string[];
  detail: string | null;
}

export interface SandboxSpec {
  readonly: string[];
  writable: string[];
  cwd: string;
  network: boolean;
}

let probed: { available: boolean; detail: string } | undefined;

/** Whether the sandbox can be built on this machine. Probed once per process by building one. */
export function sandboxAvailability(): { available: boolean; detail: string } {
  if (probed) return probed;
  if (process.env.TENRIC_SANDBOX === "off") return (probed = { available: false, detail: "disabled by TENRIC_SANDBOX=off" });
  if (process.platform !== "linux") return (probed = { available: false, detail: `no sandbox implementation for ${process.platform}` });
  const cwd = realpathSync(process.cwd());
  const { command, args } = buildCommand(["/bin/true"], { readonly: [], writable: [], cwd: "/", network: false });
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000 });
  probed = result.status === 0
    ? { available: true, detail: "linux user, mount, PID and network namespaces" }
    : { available: false, detail: `building a sandbox failed: ${(result.error ? String(result.error) : result.stderr || `exit ${result.status}`).trim().slice(0, 300)}` };
  return probed;
}

/** For tests: forget the probe result. */
export function resetSandboxProbe(): void {
  probed = undefined;
}

function real(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function buildCommand(command: string[], spec: SandboxSpec): { command: string; args: string[] } {
  const args = ["--user", "--map-root-user", "--mount", "--pid", "--fork", "--kill-child", ...(spec.network ? [] : ["--net"]), "--", "/bin/sh", SANDBOX_SCRIPT];
  for (const path of spec.readonly) args.push("--ro", real(path));
  for (const path of spec.writable) args.push("--rw", real(path));
  args.push("--cwd", real(spec.cwd), "--", ...command);
  return { command: "unshare", args };
}

/** Is `path` equal to or inside one of `roots`? Both are compared after resolving symbolic links. */
export function isInside(path: string, roots: string[]): boolean {
  const target = real(path);
  return roots.some((root) => {
    const rel = relative(real(root), target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/**
 * Wraps `command` so that it runs in a sandbox, or returns it unchanged with a record that
 * says it is not isolated. Paths that must stay secret (`hidden`) are checked against what the
 * sandbox would expose; a spec that would expose one is an error, never a silent exposure.
 */
export function sandboxed(command: string[], spec: SandboxSpec & { hidden?: string[] }): { command: string; args: string[]; isolation: IsolationRecord } {
  const writable = spec.writable.map(real);
  const availability = sandboxAvailability();
  if (!availability.available) {
    return {
      command: command[0]!, args: command.slice(1),
      isolation: { mechanism: "none", enforced: false, network: "host", writable_paths: [], detail: availability.detail },
    };
  }
  for (const secret of spec.hidden ?? []) {
    const exposed = [...spec.readonly, ...spec.writable].filter((p) => isInside(secret, [p]));
    if (exposed.length > 0) throw new Error(`sandbox would expose ${secret} through ${exposed.join(", ")}`);
  }
  const built = buildCommand(command, spec);
  return {
    ...built,
    isolation: {
      mechanism: "linux-userns", enforced: true, network: spec.network ? "host" : "none", writable_paths: writable,
      detail: `read-only: system directories and ${spec.readonly.length} listed path(s)`,
    },
  };
}

/** Certificate bundles named by the environment, which some tools refuse to start without even offline. */
export function certificatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = ["SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"];
  return [...new Set(names.map((n) => env[n]).filter((v): v is string => !!v && isAbsolute(v) && existsSync(v)))];
}

/** Read-only paths the experiment's Python needs: the repository (lockfile, .venv) and the interpreter the .venv points at. */
export function pythonPaths(repoRoot: string): string[] {
  const paths = [repoRoot, ...certificatePaths()];
  const venvPython = resolve(repoRoot, ".venv/bin/python");
  if (existsSync(venvPython)) paths.push(dirname(dirname(realpathSync(venvPython))));
  try {
    const uv = execFileSync("sh", ["-c", "command -v uv"], { encoding: "utf8" }).trim();
    if (uv) paths.push(realpathSync(uv));
  } catch {
    // uv not on PATH: the run will fail to start and say so.
  }
  return paths;
}
