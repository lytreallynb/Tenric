import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, empty, frag, h, icon, kv, notice, num, pageHead, revision, section, sha, show, table, tag, td, time, verdictCell } from "../ui.js";

export async function compare({ query }) {
  const runs = await api.runs();
  const [a, b] = [query.get("a") ?? "", query.get("b") ?? ""];
  const go = (next) => { location.hash = `#/compare?a=${encodeURIComponent(next.a)}&b=${encodeURIComponent(next.b)}`; };
  const picker = (value, key) => h("select", { onchange: (e) => go({ a, b, [key]: e.target.value }) },
    h("option", { value: "" }, t("choose_run")), runs.map((r) => h("option", { value: r.id, selected: r.id === value }, `${r.id}${r.started_at ? ` · ${r.started_at}` : ""}`)));
  const data = a && b ? await api.compare(a, b) : null;
  const facts = (run) => (run ? kv([
    [t("verdict"), frag(verdictCell(run), run.verification ? h("span", { class: "mono muted" }, ` ${run.verification.passed} / ${run.verification.total}`) : "")],
    [t("execution"), frag(run.status ? badge(run.status) : "—", h("span", { class: "mono muted" }, ` ${num(run.runtime_seconds)} s`))],
    [t("started"), time(run.started_at)],
    [t("revision"), revision(run.source)],
    ["artifact sha256", sha(run.artifact_sha256)],
  ]) : h("div", { class: "hint" }, t("choose_run")));
  const side = (letter, value, key, run) => h("div", { class: "side" },
    h("div", { class: "slot" }, h("span", { class: "letter" }, letter), picker(value, key),
      value ? h("a", { class: "btn small ghost", href: `#/runs/${encodeURIComponent(value)}`, title: t("open_run") }, icon("external", 14)) : null),
    facts(run));
  const head = frag(
    pageHead(t("compare_title"), t("compare_sub")),
    h("div", { class: "versus" }, side("A", a, "a", data?.comparable ? data.a : runs.find((r) => r.id === a)),
      h("div", { class: "mid" }, h("button", { class: "btn small", disabled: !(a && b), title: t("swap"), "aria-label": t("swap"), onclick: () => go({ a: b, b: a }) }, icon("swap", 15))),
      side("B", b, "b", data?.comparable ? data.b : runs.find((r) => r.id === b))),
    h("div", { class: "spacer" }));
  if (!data) return frag(head, h("div", { class: "panel" }, empty(t("choose_two"), t("pick_two"), h("a", { class: "btn", href: "#/runs" }, t("nav_runs")), { icon: "compare" })));
  if (!data.comparable) return frag(head, notice("bad", t("not_comparable"), t("not_comparable_body")));

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
    data.counts.other === 0
      ? notice("info", t("only_volatile_title"), `${data.counts.volatile} ${t("only_volatile_body")}`)
      : notice("warn", `${data.counts.other} ${t("nonvolatile_title")}`, t("nonvolatile_body")),

    section(t("metrics"), t("metrics_compare_hint"),
      table([t("metric"), "A#", "B#", "B − A#", ""], data.metrics.map((m) => h("tr", {},
        td(h("code", {}, m.name)), td(num(m.a), "num"), td(num(m.b), "num"), td(m.delta === null ? "—" : m.delta === 0 ? "0" : m.delta.toExponential(3), "num"),
        td(m.identical === null ? h("span", { class: "badge none plain" }, t("one_side_only")) : badge(m.identical ? "identical" : "differs", m.identical ? "pass" : "fail")))), { empty: t("no_metrics") })),

    section(t("tab_outputs"), `${sameOutputs} / ${data.outputs.length} ${t("identical_l")}`,
      table([t("file"), t("determinism"), "A sha256", "B sha256", ""], data.outputs.map((o) => h("tr", {},
        td(h("code", {}, o.path)), td(o.determinism ? tag(o.determinism) : "—"), td(sha(o.a?.sha256)), td(sha(o.b?.sha256)),
        td(o.identical === null ? h("span", { class: "badge none plain" }, t("one_side_only"))
          : o.identical ? badge("identical", "pass")
            : badge("differs", o.determinism === "volatile" ? "neutral" : "fail")))), { empty: t("no_outputs") })),

    section(t("artifact_differences"), `${data.counts.other} + ${data.counts.volatile} volatile`, diffBox,
      h("label", { class: "row hint" }, h("input", { type: "checkbox", onchange: (e) => { showVolatile = e.target.checked; drawDiff(); } }), t("show_volatile"))),
  );
}
