// Thin wrapper over the local JSON API. Errors carry the server's message.
async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
const post = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const seg = encodeURIComponent;

export const api = {
  system: () => request("/api/system"),
  contracts: () => request("/api/contracts"),
  contract: (id, version) => request(`/api/contracts/${seg(id)}/${seg(version)}`),
  contractDiff: (id, from, to) => request(`/api/contracts/${seg(id)}/${seg(from)}/diff/${seg(to)}`),
  runs: () => request("/api/runs"),
  run: (id) => request(`/api/runs/${seg(id)}`),
  verify: (id, contract, version) => request(`/api/runs/${seg(id)}/verify?${q({ contract, version })}`),
  reverify: (id, body) => post(`/api/runs/${seg(id)}/verify`, body),
  compare: (a, b) => request(`/api/compare?${q({ a, b })}`),
  docs: () => request("/api/docs"),
  doc: (path) => request(`/api/doc?${q({ path })}`),
  jobs: () => request("/api/jobs"),
  job: (id) => request(`/api/jobs/${seg(id)}`),
  cancelJob: (id) => post(`/api/jobs/${seg(id)}/cancel`),
  runDefaults: () => request("/api/run-defaults"),
  startRun: (body) => post("/api/runs", body),
  compile: (body) => post("/api/compile", body),
  fileUrl: (id, path) => `/api/runs/${seg(id)}/files/${path.split("/").map(seg).join("/")}`,
  fileText: async (id, path) => (await fetch(api.fileUrl(id, path))).text(),
};
