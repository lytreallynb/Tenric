// `npm run ui`: installs the front end's locked dependencies and builds it when
// its sources changed since the last build, then starts the local server.
// The front end lives in ui/web with its own lockfile (ADR-0012), so the
// repository's own dependencies and `npm run verify` are unaffected.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("./web/", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))));
}

function run(args: string[], what: string): void {
  console.log(`[ui] ${what}: npm ${args.join(" ")}`);
  const result = spawnSync(npm, args, { cwd: WEB, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`[ui] ${what} failed (exit ${result.status ?? result.signal}). The interface was not started.`);
    process.exit(1);
  }
}

const lock = join(WEB, "package-lock.json");
const installed = join(WEB, "node_modules", ".package-lock.json");
if (!existsSync(installed) || newest(lock) > newest(installed)) run(["ci", "--no-audit", "--no-fund"], "installing the front end's locked dependencies");

const built = join(WEB, "dist", "index.html");
const sources = Math.max(...["src", "public", "index.html", "vite.config.js", "package-lock.json"].map((p) => newest(join(WEB, p))));
if (!existsSync(built) || sources > newest(built)) run(["run", "build"], "building the front end");

await import("./server/server.ts").then(({ listen }) => listen());
