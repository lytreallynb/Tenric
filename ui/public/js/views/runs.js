import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, dataClass, empty, frag, h, icon, notice, num, pageHead, segmented, table, td, time, verdictCell } from "../ui.js";

const verdictOf = (run) => run.verification?.verdict ?? "none";

export async function runList() {
  const runs = await api.runs();
  const selected = new Set();
  const state = { verdict: "", origin: "", text: "" };
  const body = h("div", {});
  const bar = h("div", {});
  const count = (verdict) => runs.filter((r) => verdict === "" || verdictOf(r) === verdict).length;

  const drawBar = () => {
    if (selected.size === 0) { bar.replaceChildren(); return; }
    const [a, b] = [...selected];
    bar.replaceChildren(h("div", { class: "selbar" },
      h("span", {}, `${selected.size} / 2 ${t("selected_n")}`),
      h("button", { class: "btn ghost small", onclick: () => { selected.clear(); draw(); drawBar(); } }, t("clear")),
      h("button", { class: "btn primary small", disabled: selected.size !== 2, title: selected.size === 2 ? null : t("pick_two"),
        onclick: () => { location.hash = `#/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`; } }, icon("compare", 13), t("compare_selected"))));
  };

  const draw = () => {
    const needle = state.text.trim().toLowerCase();
    const rows = runs.filter((r) => (state.origin === "" || r.origin === state.origin)
      && (state.verdict === "" || verdictOf(r) === state.verdict)
      && (needle === "" || r.id.toLowerCase().includes(needle) || (r.runtime?.backend ?? "").toLowerCase().includes(needle)));
    body.replaceChildren(table(["", t("run"), t("verdict"), t("mandatory_passed"), t("blocking"), t("recorded_at_run"), t("backend"), t("execution"), t("started"), "test_accuracy#"],
      rows.map((run) => {
        const href = `#/runs/${encodeURIComponent(run.id)}`;
        const box = h("input", { type: "checkbox", checked: selected.has(run.id), disabled: !selected.has(run.id) && selected.size >= 2, "aria-label": `${t("compare")} ${run.id}`, onclick: (e) => e.stopPropagation(), onchange: () => {
          if (box.checked) selected.add(run.id); else selected.delete(run.id);
          draw(); drawBar();
        } });
        return h("tr", { class: `clickable ${selected.has(run.id) ? "selected" : ""}`, onclick: () => { location.hash = href; } },
          td(box),
          td(frag(h("a", { class: "primary-cell", href }, run.id), run.origin === "fixture" || run.data_class === "fixture" ? frag(" ", badge("fixture")) : null, run.readable ? null : frag(" ", badge("error"))), run.origin === "fixture" ? "wrap-any" : "nowrap"),
          td(verdictCell(run)),
          td(run.verification ? frag(h("span", { class: "mono" }, `${run.verification.passed} / ${run.verification.total}`), h("span", { class: "faint" }, ` · ${run.verification.version}`)) : "—", "nowrap"),
          td(run.verification ? (run.verification.blocking.length === 0 ? h("span", { class: "faint" }, "—") : h("div", { class: "tags" }, run.verification.blocking.map((b) => h("span", { class: "tag mono" }, b)))) : h("span", { class: "faint", title: run.no_verdict ?? "" }, "—")),
          td(run.runtime?.recorded_verdict ? badge(run.runtime.recorded_verdict) : h("span", { class: "faint" }, "—")),
          td(run.origin === "fixture" ? h("span", { class: "faint" }, "—") : h("code", {}, run.runtime?.backend ?? "baseline-script"), "nowrap"),
          td(run.status ? frag(badge(run.status), typeof run.runtime_seconds === "number" ? h("span", { class: "mono faint" }, ` ${num(run.runtime_seconds)} s`) : null) : "—", "nowrap"),
          td(time(run.started_at), "nowrap"),
          td(num(run.metrics?.find((m) => m.name === "test_accuracy")?.value), "num"));
      }), { empty: runs.length === 0
        ? empty(t("empty_runs_title"), t("no_runs"), h("a", { class: "btn primary", href: "#/new" }, icon("new", 13), t("nav_new")))
        : empty(t("no_match_title"), t("no_match_body"), null, { icon: "search", compact: true }) }));
  };
  draw();

  return frag(
    pageHead(t("runs_title"), t("runs_sub"), h("a", { class: "btn primary", href: "#/new" }, icon("new", 13), t("nav_new"))),
    h("div", { class: "toolbar" },
      h("label", { class: "search" }, icon("search", 15), h("input", { type: "search", placeholder: t("search_runs"), "aria-label": t("search_runs"), oninput: (e) => { state.text = e.target.value; draw(); } })),
      segmented([["", t("filter_all"), count("")], ["accepted", "accepted", count("accepted")], ["rejected", "rejected", count("rejected")], ["inconclusive", "inconclusive", count("inconclusive")], ["none", t("no_verdict"), count("none")]],
        "", (v) => { state.verdict = v; draw(); }),
      segmented([["", t("runs_and_fixtures")], ["run", t("only_runs")], ["fixture", t("only_fixtures")]], "", (v) => { state.origin = v; draw(); })),
    h("p", { class: "hint" }, t("runs_live_hint"), " ", t("list_without_reexecution")),
    body,
    bar,
    h("div", { class: "spacer" }),
    notice("info", t("verdict_meaning_title"), t("verdict_meaning_body")),
  );
}
