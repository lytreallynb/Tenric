import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, frag, h, json, kv, notice, pageHead, sha, show, table, tabs, tag, td, verdictCell } from "../ui.js";

const link = (c) => `#/contracts/${encodeURIComponent(c.id)}/${encodeURIComponent(c.version)}`;

function mix(r) {
  const bar = h("div", { class: "bar" });
  for (const kind of ["machine", "empirical", "human"]) {
    const part = h("i", { class: kind, title: `${kind}: ${r[kind]}` });
    part.style.width = `${(100 * r[kind]) / Math.max(r.total, 1)}%`;
    bar.append(part);
  }
  return bar;
}
const legend = () => h("div", { class: "legend" }, ["machine", "empirical", "human"].map((kind) => {
  const dot = h("i", { class: kind });
  dot.style.background = `var(--${kind === "machine" ? "collector" : kind === "empirical" ? "error" : "human"})`;
  return h("span", {}, dot, kind);
}));

export async function contractList() {
  const contracts = await api.contracts();
  return frag(
    pageHead(t("contracts_title"), t("contracts_sub")),
    table([t("contract"), t("version"), t("registry"), t("title"), t("requirements"), t("verifiability"), t("without_validator"), "sha256"],
      contracts.map((c) => h("tr", { class: "clickable", onclick: () => { location.hash = link(c); } },
        td(h("a", { href: link(c) }, h("code", {}, c.id))),
        td(h("code", {}, c.version)),
        td(c.registered ? badge("registered", "pass") : badge("not registered", "fail")),
        td(c.usable ? c.title : frag(badge("error"), " ", h("span", { class: "muted wrap-any" }, c.error))),
        td(c.usable ? `${c.requirements.mandatory} mandatory, ${c.requirements.advisory} advisory` : "—"),
        td(c.usable ? mix(c.requirements) : "—"),
        td(c.usable ? (c.requirements.without_validator > 0 ? h("span", { class: "badge partial plain" }, c.requirements.without_validator) : "0") : "—"),
        td(sha(c.sha256)))),
      { empty: t("no_contracts") }),
    h("div", { class: "spacer" }), legend(),
    h("div", { class: "spacer" }),
    notice("info", t("contract_rules_title"), t("contract_rules_body")),
  );
}

function requirementRows(requirements) {
  return requirements.map((r) => h("tr", {},
    td(h("code", {}, r.id)),
    td(frag(r.title, r.rationale ? h("div", { class: "hint" }, r.rationale) : null)),
    td(badge(r.level, r.level === "mandatory" ? "neutral" : "none")),
    td(tag(r.verifiability)),
    td(frag(h("code", {}, r.check?.kind ?? "—"), r.check?.params ? h("div", { class: "hint mono wrap-any" }, JSON.stringify(r.check.params)) : null)),
    td(r.validator_available === undefined ? "—" : badge(r.validator_available ? "available" : "not_available", "plain"))));
}

async function diffPanel(id, from, to) {
  const diff = await api.contractDiff(id, from, to);
  const change = (kind, list) => list.map((r) => h("tr", {}, td(badge(kind, kind === "added" ? "pass" : kind === "removed" ? "fail" : "partial")), td(h("code", {}, r.id)), td(r.title ?? ""),
    td(r.fields ? r.fields.map((f) => h("div", { class: "mono wrap-any" }, `${f.pointer}: ${show(f.a)} → ${show(f.b)}`)) : "")));
  return frag(
    h("p", { class: "hint" }, t("contract_diff_hint")),
    table([t("change"), "id", t("title"), t("detail")], [...change("added", diff.added), ...change("removed", diff.removed), ...change("changed", diff.changed)], { empty: t("no_requirement_changes") }),
    h("h3", {}, t("other_fields")),
    table(["JSON pointer", from, to], diff.other.map((d) => h("tr", {}, td(h("code", {}, d.pointer)), td(d.in_a ? h("code", { class: "wrap-any" }, show(d.a)) : "—"), td(d.in_b ? h("code", { class: "wrap-any" }, show(d.b)) : "—"))), { empty: t("no_differences") }));
}

export async function contractDetail({ args: [id, version] }) {
  const [data, runs] = await Promise.all([api.contract(id, version), api.runs()]);
  const { summary, contract } = data;
  const governed = runs.filter((r) => r.verification?.contract === summary.id && r.verification?.version === summary.version);
  const others = data.versions.filter((v) => v !== version);
  const diffBox = h("div", {});
  const picker = h("select", { onchange: async () => { diffBox.replaceChildren(picker.value ? await diffPanel(id, picker.value, version) : ""); } },
    h("option", { value: "" }, t("choose_version")), others.map((v) => h("option", { value: v }, v)));

  return frag(
    pageHead(summary.title ?? id, frag(h("code", {}, summary.id), " ", t("version"), " ", h("code", {}, summary.version)),
      data.versions.length > 1 ? frag(h("span", { class: "muted" }, t("version")), h("select", { onchange: (e) => { location.hash = link({ id, version: e.target.value }); } },
        data.versions.map((v) => h("option", { value: v, selected: v === version }, v)))) : null,
      frag(h("a", { href: "#/contracts" }, t("nav_contracts")), " / ", id)),
    summary.usable ? null : notice("bad", t("contract_unusable"), summary.error),
    summary.usable && !summary.registered ? notice("bad", t("contract_unregistered"), summary.registration_error) : null,
    h("div", { class: "panel" }, kv([
      [t("description"), contract.description],
      [t("file"), h("code", {}, summary.path)],
      ["sha256", frag(sha(summary.sha256, true), " ", summary.registered ? badge("matches registry", "pass") : badge("not registered", "fail"))],
      [t("artifact_type"), contract.artifact ? frag(h("code", {}, contract.artifact.type), " IR ", h("code", {}, contract.artifact.ir_version), " · ", h("code", {}, contract.artifact.schema), contract.artifact.schema_sha256 ? frag(" sha256 ", sha(contract.artifact.schema_sha256)) : null) : "—"],
      [t("applicability"), contract.applicability?.description],
      [t("requires_capabilities"), (contract.applicability?.requires_capabilities ?? []).map((c) => frag(tag(c), " "))],
      [t("acceptance_rule"), frag(h("code", {}, contract.acceptance?.rule ?? "—"), h("span", { class: "hint" }, ` ${t("acceptance_rule_hint")}`))],
    ])),
    tabs([
      { id: "requirements", label: `${t("requirements")} (${data.requirements.length})`, render: () => table(["id", t("requirement"), t("level"), t("verifiability"), t("check"), t("validator")], requirementRows(data.requirements)) },
      { id: "runs", label: `${t("runs_under_contract")} (${governed.length})`, render: () => table([t("run"), t("verdict"), t("mandatory_passed"), t("blocking")],
        governed.map((r) => h("tr", {}, td(h("a", { href: `#/runs/${encodeURIComponent(r.id)}` }, r.id)), td(verdictCell(r)), td(`${r.verification.passed} / ${r.verification.total}`), td(r.verification.blocking.map((b) => frag(h("code", {}, b), " "))))), { empty: t("no_runs") }) },
      { id: "diff", label: t("compare_versions"), render: () => (others.length === 0 ? notice("na", t("single_version"), t("single_version_body")) : frag(h("div", { class: "row" }, t("compare_with"), picker), h("div", { class: "spacer" }), diffBox)) },
      { id: "raw", label: t("raw_json"), render: () => json(data.text) },
    ], "requirements"),
  );
}
