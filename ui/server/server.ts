// Local web interface for Tenric. Node's built-in http server, no framework,
// no build step (ADR-0002). Start with `npm run ui`.
//
// It listens on the loopback interface only and can start processes, so it
// refuses requests whose Host is not a loopback name (DNS rebinding) and
// state-changing requests that a foreign web page could have sent.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BadRequest, compareRuns, contractDiff, getContract, getDoc, getRun, listContracts, listDocs, listRuns, NotFound, runFile, verifyRun,
} from "./data.ts";
import { defaultConfig, getJob, listJobs, startRun } from "./jobs.ts";
import { compilePreview, systemStatus } from "./system.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};
const BODY_LIMIT = 256 * 1024;

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value, null, 2) + "\n", "application/json; charset=utf-8");
}

function loopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new BadRequest("Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new BadRequest("request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new BadRequest("request body is not valid JSON");
  }
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
  const full = join(PUBLIC_DIR, relative);
  if (relative.startsWith("..") || !full.startsWith(PUBLIC_DIR) || full.includes(`${sep}.`)) throw new NotFound("not found");
  if (!existsSync(full) || !statSync(full).isFile()) throw new NotFound("not found");
  send(res, 200, readFileSync(full), STATIC_TYPES[extname(full)] ?? "application/octet-stream");
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const parts = url.pathname.split("/").filter((p) => p !== "").map(decodeURIComponent);
  const query = url.searchParams;

  if (!loopbackHost(req.headers.host)) throw new BadRequest("this interface only answers on a loopback host name");
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) throw new BadRequest("cross-origin request refused");
  }

  if (parts[0] !== "api") {
    if (method !== "GET" && method !== "HEAD") throw new BadRequest("method not allowed");
    return serveStatic(res, url.pathname);
  }

  const [, resource, a, b, ...rest] = parts;
  if (method === "GET") {
    if (resource === "system" && !a) return sendJson(res, 200, await systemStatus());
    if (resource === "contracts" && !a) return sendJson(res, 200, listContracts());
    if (resource === "contracts" && a && b && rest.length === 0) return sendJson(res, 200, getContract(a, b));
    if (resource === "contracts" && a && b && rest.length === 2 && rest[0] === "diff") return sendJson(res, 200, contractDiff(a, b, rest[1]!));
    if (resource === "runs" && !a) return sendJson(res, 200, listRuns());
    if (resource === "runs" && a && !b) return sendJson(res, 200, getRun(a));
    if (resource === "runs" && a && b === "verify" && rest.length === 0) {
      return sendJson(res, 200, await verifyRun(a, { contractId: query.get("contract") ?? undefined, contractVersion: query.get("version") ?? undefined }));
    }
    if (resource === "runs" && a && b === "files" && rest.length > 0) {
      const file = runFile(a, rest.join("/"));
      return send(res, 200, file.body, file.type);
    }
    if (resource === "compare" && !a) {
      const [x, y] = [query.get("a"), query.get("b")];
      if (!x || !y) throw new BadRequest("compare needs ?a=<run>&b=<run>");
      return sendJson(res, 200, compareRuns(x, y));
    }
    if (resource === "docs" && !a) return sendJson(res, 200, listDocs());
    if (resource === "doc" && !a) return sendJson(res, 200, getDoc(query.get("path") ?? ""));
    if (resource === "jobs" && !a) return sendJson(res, 200, listJobs());
    if (resource === "jobs" && a && !b) return sendJson(res, 200, getJob(a));
    if (resource === "run-defaults" && !a) return sendJson(res, 200, { config: defaultConfig() });
  }
  if (method === "POST") {
    if (resource === "runs" && !a) return sendJson(res, 202, await startRun((await readBody(req)) as Record<string, unknown>));
    if (resource === "compile" && !a) {
      const body = (await readBody(req)) as Record<string, unknown>;
      return sendJson(res, 200, await compilePreview(body.task, body.backend));
    }
    if (resource === "runs" && a && b === "verify" && rest.length === 0) {
      const body = (await readBody(req)) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === "string" ? value : undefined);
      return sendJson(res, 200, await verifyRun(a, {
        contractId: text(body.contract), contractVersion: text(body.version), reproduceTask: text(body.reproduce_task),
      }));
    }
  }
  throw new NotFound(`no such endpoint: ${method} ${url.pathname}`);
}

export function createApp(): Server {
  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof NotFound ? 404 : error instanceof BadRequest ? 400 : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: (error as Error).message });
      else res.end();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TENRIC_UI_PORT ?? 4173);
  const host = process.env.TENRIC_UI_HOST ?? "127.0.0.1";
  createApp().listen(port, host, () => {
    console.log(`Tenric interface: http://${host === "127.0.0.1" ? "localhost" : host}:${port}`);
    console.log("Reads spec/, runs/, fixtures/ and docs/ from this checkout. Stores nothing. Stop with Ctrl-C.");
  });
}
