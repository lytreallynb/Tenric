import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, dataClass, empty, frag, h, icon, notice, num, pageHead, revision, section, sha, table, td, time, verdictCell } from "../ui.js";

/** The RFC-0001 pipeline in two zones, each box coloured by what was found in this checkout. */
function architecture(components) {
  const state = Object.fromEntries(components.map((c) => [c.id, c]));
  const node = (id) => h("div", { class: `node ${state[id]?.state ?? "not_available"}`, title: state[id]?.evidence ?? "" },
    h("b", {}, t(`component_${id}`)), h("div", {}, badge(state[id]?.state ?? "not_available", "plain")));
  const steps = (...ids) => h("div", { class: "steps" }, ids.flatMap((id, index) => (index === 0 ? [node(id)] : [h("div", { class: "arrow" }, icon("chevron", 14)), node(id)])));
  return h("div", { class: "pipeline" },
    h("div", { class: "zone producer" }, h("div", { class: "label" }, icon("pen", 13), t("zone_producer")), steps("contract-spec", "compiler", "agent-backends")),
    h("div", { class: "boundary" }, h("span", {}, t("trust_boundary"))),
    h("div", { class: "zone verifier" }, h("div", { class: "label" }, icon("shield", 13), t("zone_verifier")), steps("collector", "artifact-ir", "verifier", "verdict-binding")));
}

/** How the runs divide by verdict. The counts come from the server, which got each verdict from the verifier. */
function distribution(counts) {
  const parts = [["accepted", counts.verdicts.accepted], ["rejected", counts.verdicts.rejected], ["inconclusive", counts.verdicts.inconclusive], ["none", counts.no_verdict]];
  const total = parts.reduce((sum, [, n]) => sum + n, 0);
  const bar = h("div", { class: "dist", role: "img", "aria-label": parts.map(([k, n]) => `${k} ${n}`).join(", ") });
  for (const [kind, n] of parts) {
    if (n === 0) continue;
    const part = h("i", { class: kind, title: `${kind}: ${n}` });
    part.style.flex = `${n} 0 0`;
    bar.append(part);
  }
  return h("a", { class: "stat", href: "#/runs" },
    h("div", { class: "label" }, t("verdict_distribution")),
    total === 0 ? h("div", { class: "l" }, t("empty_runs_title")) : bar,
    h("div", { class: "dist-legend" }, parts.map(([kind, n]) => h("div", {}, h("span", { class: "n" }, n), kind === "none" ? h("span", { class: "badge none plain" }, t("no_verdict")) : badge(kind)))),
    h("div", { class: "l" }, t("stat_verdicts")));
}

export async function overview() {
  const [system, runs] = await Promise.all([api.system(), api.runs()]);
  const { counts, repository } = system;
  const stat = (n, label, href, glyph) => h("a", { class: "stat", href }, h("div", { class: "label row" }, icon(glyph, 13), label), h("div", { class: "n" }, n));
  const recent = runs.filter((r) => r.origin === "run").slice(0, 8);

  return frag(
    pageHead(t("overview_title"), t("overview_sub"), h("a", { class: "btn primary", href: "#/new" }, icon("new", 13), t("nav_new"))),
    repository.dirty ? notice("warn", t("dirty_title"), t("dirty_body")) : null,
    h("div", { class: "grid hero" },
      distribution(counts),
      h("div", { class: "grid cols-2" },
        stat(counts.runs, t("stat_runs"), "#/runs", "runs"),
        stat(counts.contracts, t("stat_contracts"), "#/contracts", "contracts"),
        h("div", { class: "stat" }, h("div", { class: "label" }, t("revision")), h("div", { class: "v" }, sha(repository.revision), repository.dirty ? h("span", { class: "badge warn plain" }, "dirty") : null), h("div", { class: "l" }, t("repository"))),
        h("div", { class: "stat" }, h("div", { class: "label" }, "Node.js"), h("div", { class: "v mono" }, system.node), h("div", { class: "l" }, t("local_only_short"))))),

    section(t("architecture"), frag(t("architecture_hint"), " ", h("a", { href: "#/system" }, t("nav_system")), "."),
      h("div", { class: "panel" }, architecture(system.components))),

    section(t("recent_runs"), t("list_without_reexecution"),
      table([t("run"), t("verdict"), t("mandatory_passed"), t("execution"), t("data_class"), t("started"), t("revision"), "test_accuracy#"],
        recent.map((run) => h("tr", { class: "clickable", onclick: () => { location.hash = `#/runs/${encodeURIComponent(run.id)}`; } },
          td(h("a", { class: "primary-cell", href: `#/runs/${encodeURIComponent(run.id)}` }, run.id), "nowrap"),
          td(verdictCell(run)),
          td(run.verification ? frag(h("span", { class: "mono" }, `${run.verification.passed} / ${run.verification.total}`), h("span", { class: "faint" }, ` · ${run.verification.version}`)) : "—"),
          td(run.status ? badge(run.status) : "—"),
          td(dataClass(run.data_class)),
          td(time(run.started_at), "nowrap"),
          td(revision(run.source)),
          td(num(run.metrics?.find((m) => m.name === "test_accuracy")?.value), "num"))),
        { empty: empty(t("empty_runs_title"), t("no_runs"), h("a", { class: "btn primary", href: "#/new" }, icon("new", 13), t("nav_new"))) }),
      h("a", { class: "btn small ghost", href: "#/runs" }, t("view_all"), icon("arrow", 13))),
  );
}
