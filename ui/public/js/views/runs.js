import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, dataClass, frag, h, notice, num, pageHead, revision, table, td, time, verdictCell } from "../ui.js";

export async function runList() {
  const runs = await api.runs();
  const selected = new Set();
  const state = { verdict: "", origin: "" };
  const body = h("div", {});
  const compareButton = h("button", { class: "btn", disabled: true, onclick: () => { const [a, b] = [...selected]; location.hash = `#/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`; } }, t("compare_selected"));

  const draw = () => {
    const rows = runs.filter((r) => (state.origin === "" || r.origin === state.origin)
      && (state.verdict === "" || (state.verdict === "none" ? !r.verification : r.verification?.verdict === state.verdict)));
    body.replaceChildren(table(["", t("run"), t("verdict"), t("mandatory_passed"), t("blocking"), t("recorded_at_run"), t("backend"), t("execution"), t("data_class"), t("started"), `${t("runtime_s")}#`, t("revision"), "test_accuracy#"],
      rows.map((run) => {
        const href = `#/runs/${encodeURIComponent(run.id)}`;
        const box = h("input", { type: "checkbox", checked: selected.has(run.id), "aria-label": `${t("compare")} ${run.id}`, onclick: (e) => e.stopPropagation(), onchange: () => {
          if (box.checked) selected.add(run.id); else selected.delete(run.id);
          compareButton.disabled = selected.size !== 2;
        } });
        return h("tr", { class: "clickable", onclick: () => { location.hash = href; } },
          td(box),
          td(frag(h("a", { href }, run.id), run.origin === "fixture" ? frag(" ", badge("fixture")) : null, run.readable ? null : frag(" ", badge("error")))),
          td(verdictCell(run)),
          td(run.verification ? `${run.verification.passed} / ${run.verification.total} · ${run.verification.version}` : "—"),
          td(run.verification ? run.verification.blocking.map((b) => frag(h("code", {}, b), " ")) : h("span", { class: "hint" }, run.no_verdict ?? "")),
          td(run.runtime?.recorded_verdict ? badge(run.runtime.recorded_verdict) : h("span", { class: "faint" }, "—")),
          td(h("code", {}, run.runtime?.backend ?? "baseline-script")),
          td(run.status ? badge(run.status) : "—"),
          td(dataClass(run.data_class)),
          td(time(run.started_at)),
          td(num(run.runtime_seconds), "num"),
          td(revision(run.source)),
          td(num(run.metrics?.find((m) => m.name === "test_accuracy")?.value), "num"));
      }), { empty: t("no_runs") }));
  };
  const filter = (key, options) => h("select", { onchange: (e) => { state[key] = e.target.value; draw(); } }, options.map(([value, label]) => h("option", { value }, label)));
  draw();

  return frag(
    pageHead(t("runs_title"), t("runs_sub"), frag(compareButton, h("a", { class: "btn primary", href: "#/new" }, t("nav_new")))),
    h("div", { class: "row" },
      filter("verdict", [["", t("all_verdicts")], ["accepted", "accepted"], ["rejected", "rejected"], ["inconclusive", "inconclusive"], ["none", t("no_verdict")]]),
      filter("origin", [["", t("runs_and_fixtures")], ["run", t("only_runs")], ["fixture", t("only_fixtures")]]),
      h("span", { class: "hint" }, t("runs_live_hint"), " ", t("list_without_reexecution"))),
    h("div", { class: "spacer" }),
    body,
    h("div", { class: "spacer" }),
    notice("info", t("verdict_meaning_title"), t("verdict_meaning_body")),
  );
}
