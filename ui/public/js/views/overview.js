import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, dataClass, frag, h, notice, num, pageHead, revision, sha, table, td, time, verdictCell } from "../ui.js";

/** One row of the RFC-0001 architecture, each box coloured by what was found in this checkout. */
function architecture(components) {
  const state = Object.fromEntries(components.map((c) => [c.id, c]));
  const node = (id) => h("div", { class: `node ${state[id]?.state ?? "not_available"}`, title: state[id]?.evidence ?? "" },
    h("b", {}, t(`component_${id}`)), badge(state[id]?.state ?? "not_available", "plain"));
  const arrow = () => h("div", { class: "arrow" }, "→");
  return h("div", { class: "arch" },
    node("contract-spec"), arrow(), node("compiler"), arrow(), node("agent-backends"),
    h("div", { class: "boundary" }, h("span", {}, t("trust_boundary"))),
    node("collector"), arrow(), node("artifact-ir"), arrow(), node("verifier"), arrow(), node("verdict-binding"));
}

export async function overview() {
  const [system, runs] = await Promise.all([api.system(), api.runs()]);
  const { counts, repository } = system;
  const stat = (n, label, href) => h("a", { class: "stat", href }, h("div", { class: "n" }, n), h("div", { class: "l" }, label));
  const recent = runs.filter((r) => r.origin === "run").slice(0, 8);

  return frag(
    pageHead(t("overview_title"), t("overview_sub")),
    repository.dirty ? notice("warn", t("dirty_title"), t("dirty_body")) : null,
    h("div", { class: "grid cols-4" },
      stat(counts.contracts, t("stat_contracts"), "#/contracts"),
      stat(counts.runs, t("stat_runs"), "#/runs"),
      h("a", { class: "stat", href: "#/runs" },
        h("div", { class: "row" }, ["accepted", "rejected", "inconclusive"].map((v) => h("span", {}, h("span", { class: "n" }, counts.verdicts[v]), " ", badge(v)))),
        h("div", { class: "l" }, t("stat_verdicts"))),
      stat(counts.no_verdict, t("stat_no_verdict"), "#/runs")),

    h("h2", {}, t("architecture")),
    h("div", { class: "panel" }, architecture(system.components),
      h("p", { class: "hint" }, t("architecture_hint"), " ", h("a", { href: "#/system" }, t("nav_system")), ".")),

    h("h2", {}, t("recent_runs")),
    h("p", { class: "hint" }, t("list_without_reexecution")),
    table([t("run"), t("verdict"), t("mandatory_passed"), t("execution"), t("data_class"), t("started"), t("revision"), "test_accuracy#"],
      recent.map((run) => h("tr", { class: "clickable", onclick: () => { location.hash = `#/runs/${encodeURIComponent(run.id)}`; } },
        td(h("a", { href: `#/runs/${encodeURIComponent(run.id)}` }, run.id)),
        td(verdictCell(run)),
        td(run.verification ? `${run.verification.passed} / ${run.verification.total} · ${run.verification.version}` : "—"),
        td(run.status ? badge(run.status) : "—"),
        td(dataClass(run.data_class)),
        td(time(run.started_at)),
        td(revision(run.source)),
        td(num(run.metrics?.find((m) => m.name === "test_accuracy")?.value), "num"))),
      { empty: t("no_runs") }),

    h("h2", {}, t("repository")),
    h("div", { class: "panel" }, h("dl", { class: "kv" },
      h("dt", {}, t("revision")), h("dd", {}, sha(repository.revision, true), repository.dirty ? frag(" ", h("span", { class: "badge warn plain" }, "dirty")) : null),
      h("dt", {}, "Node.js"), h("dd", {}, system.node))),
  );
}
