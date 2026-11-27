import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, frag, h, notice, num, pageHead, revision, sha, show, table, tag, td, time, verdictCell } from "../ui.js";

export async function compare({ query }) {
  const runs = await api.runs();
  const [a, b] = [query.get("a") ?? "", query.get("b") ?? ""];
  const go = (next) => { location.hash = `#/compare?a=${encodeURIComponent(next.a)}&b=${encodeURIComponent(next.b)}`; };
  const picker = (value, key) => h("select", { onchange: (e) => go({ a, b, [key]: e.target.value }) },
    h("option", { value: "" }, t("choose_run")), runs.map((r) => h("option", { value: r.id, selected: r.id === value }, `${r.id}${r.started_at ? ` · ${r.started_at}` : ""}`)));
  const head = frag(
    pageHead(t("compare_title"), t("compare_sub")),
    h("div", { class: "row" }, h("strong", {}, "A"), picker(a, "a"), h("strong", {}, "B"), picker(b, "b"),
      a && b ? h("button", { class: "btn", onclick: () => go({ a: b, b: a }) }, t("swap")) : null),
    h("div", { class: "spacer" }));
  if (!a || !b) return frag(head, h("div", { class: "empty" }, t("choose_two")));

  const data = await api.compare(a, b);
  if (!data.comparable) return frag(head, notice("bad", t("not_comparable"), t("not_comparable_body")));
  const col = (run) => h("div", { class: "panel" }, h("h3", {}, h("a", { href: `#/runs/${encodeURIComponent(run.id)}` }, run.id)), h("dl", { class: "kv" },
    h("dt", {}, t("verdict")), h("dd", {}, verdictCell(run), run.verification ? ` ${run.verification.passed} / ${run.verification.total}` : ""),
    h("dt", {}, t("execution")), h("dd", {}, run.status ? badge(run.status) : "—", ` ${num(run.runtime_seconds)} s`),
    h("dt", {}, t("started")), h("dd", {}, time(run.started_at)),
    h("dt", {}, t("revision")), h("dd", {}, revision(run.source)),
    h("dt", {}, "artifact sha256"), h("dd", {}, sha(run.artifact_sha256))));

  let showVolatile = false;
  const diffBox = h("div", {});
  const drawDiff = () => {
    const rows = data.differences.filter((d) => showVolatile || !d.volatile);
    diffBox.replaceChildren(table(["JSON pointer", "A", "B", ""], rows.map((d) => h("tr", { class: d.volatile ? "dim" : "" },
      td(h("code", { class: "wrap-any" }, d.pointer)),
      td(d.in_a ? h("code", { class: "wrap-any" }, show(d.a)) : h("span", { class: "faint" }, t("absent"))),
      td(d.in_b ? h("code", { class: "wrap-any" }, show(d.b)) : h("span", { class: "faint" }, t("absent"))),
      td(d.volatile ? tag("volatile") : ""))), { empty: t("no_differences") }));
  };
  drawDiff();
  const sameOutputs = data.outputs.filter((o) => o.identical === true).length;

  return frag(head,
    h("div", { class: "grid cols-2" }, col(data.a), col(data.b)),
    data.counts.other === 0
      ? notice("info", t("only_volatile_title"), `${data.counts.volatile} ${t("only_volatile_body")}`)
      : notice("warn", `${data.counts.other} ${t("nonvolatile_title")}`, t("nonvolatile_body")),

    h("h2", {}, t("metrics")),
    table([t("metric"), "A#", "B#", "B − A#", ""], data.metrics.map((m) => h("tr", {},
      td(h("code", {}, m.name)), td(num(m.a), "num"), td(num(m.b), "num"), td(m.delta === null ? "—" : m.delta === 0 ? "0" : m.delta.toExponential(3), "num"),
      td(m.identical === null ? h("span", { class: "badge none plain" }, t("one_side_only")) : badge(m.identical ? "identical" : "differs", m.identical ? "pass" : "fail")))), { empty: t("no_metrics") }),
    h("p", { class: "hint" }, t("metrics_compare_hint")),

    h("h2", {}, `${t("tab_outputs")} (${sameOutputs} / ${data.outputs.length} ${t("identical_l")})`),
    table([t("file"), t("determinism"), "A sha256", "B sha256", ""], data.outputs.map((o) => h("tr", {},
      td(h("code", {}, o.path)), td(o.determinism ? tag(o.determinism) : "—"), td(sha(o.a?.sha256)), td(sha(o.b?.sha256)),
      td(o.identical === null ? h("span", { class: "badge none plain" }, t("one_side_only"))
        : o.identical ? badge("identical", "pass")
          : badge("differs", o.determinism === "volatile" ? "neutral" : "fail")))), { empty: t("no_outputs") }),

    h("h2", {}, `${t("artifact_differences")} (${data.counts.other} + ${data.counts.volatile} volatile)`),
    h("label", { class: "row hint" }, h("input", { type: "checkbox", onchange: (e) => { showVolatile = e.target.checked; drawDiff(); } }), t("show_volatile")),
    h("div", { class: "spacer" }),
    diffBox,
  );
}
