// Renders report.md from the Artifact IR. The IR is the deliverable; this is
// one rendering of it and adds nothing the IR does not contain.
import type { Artifact } from "./collector.ts";

export function renderReport(artifact: Artifact): string {
  const { source, environment, execution, dataset, config } = artifact;
  const lines = [
    `# ${artifact.title}`,
    "",
    `Experiment \`${artifact.experiment_id}\`. Data class: **${artifact.data_class}**. Rendered from the Tenric Artifact IR ${artifact.ir_version}; every row below is copied from \`artifact.json\`.`,
    "",
    "## Execution (observed by the collector)",
    "",
    "| | |",
    "| --- | --- |",
    `| Status | ${execution.status} (exit code ${String(execution.exit_code)}) |`,
    `| Started | ${execution.started_at} |`,
    `| Runtime | ${execution.runtime_seconds.toFixed(3)} s |`,
    `| Command | \`${execution.command.join(" ")}\` |`,
    `| Source | ${source.kind === "git" ? `workspace revision \`${source.revision}\`${source.dirty ? " (dirty)" : ""}` : source.kind} |`,
    `| Platform | ${environment.os} ${environment.arch}, ${environment.python_implementation ?? "Python"} ${environment.python} |`,
    `| Lockfile | \`${environment.lockfile.path}\` sha256 \`${environment.lockfile.sha256}\` |`,
    dataset ? `| Dataset bytes | \`${dataset.name}\` (${dataset.version}) sha256 \`${dataset.sha256}\` |` : "| Dataset bytes | not found |",
    config ? `| Config | \`${config.path}\` sha256 \`${config.sha256}\`, seed ${config.seed === undefined ? "not stated" : String(config.seed)} |` : "| Config | missing |",
    "",
  ];
  if (artifact.failure) lines.push("## Failure", "", artifact.failure.reason, "");
  if (dataset?.producer_claims) {
    const claims = dataset.producer_claims as { name?: string; version?: string; description?: string };
    lines.push("## Dataset as described by the producer (a claim)", "", `${claims.name ?? "?"}, ${claims.version ?? "?"}. ${claims.description ?? ""}`.trim(), "");
  }
  if (artifact.metrics.length > 0) {
    lines.push("## Metrics (values read by the collector from hashed outputs)", "", "| Metric | Value | Unit | Source |", "| --- | --- | --- | --- |");
    for (const m of artifact.metrics) lines.push(`| ${m.name} | ${String(m.value)} | ${m.unit ?? ""} | \`${m.source_output}\` at \`${m.json_pointer}\` |`);
    lines.push("");
  }
  if (artifact.figures.length > 0) {
    lines.push("## Figures", "");
    for (const f of artifact.figures) lines.push(`![${f.id}](${f.image_output})`, "", `\`${f.id}\`: specification \`${f.spec_output}\`, rendered by ${f.renderer.name} ${f.renderer.version}.`, "");
  }
  if (artifact.findings.length > 0) {
    lines.push("## Findings (written by the producer; numbers in slots were filled by the collector)", "");
    for (const f of artifact.findings) lines.push(`- **${f.id}** ${f.statement} (supported by: ${f.supported_by.join(", ")})`);
    lines.push("");
  }
  if (artifact.limitations.length > 0) lines.push("## Limitations (written by the producer)", "", ...artifact.limitations.map((text) => `- ${text}`), "");
  const hashed = artifact.outputs.filter((o) => o.role !== "report");
  if (hashed.length > 0) {
    lines.push("## Outputs", "", "| Path | Role | Determinism | SHA-256 |", "| --- | --- | --- | --- |");
    for (const o of hashed) lines.push(`| \`${o.path}\` | ${o.role} | ${o.determinism} | \`${o.sha256}\` |`);
    lines.push("");
  }
  lines.push("## Reproduction", "", "```", ...artifact.reproduction.commands, "```", "", artifact.reproduction.expectation, "");
  return lines.join("\n");
}
