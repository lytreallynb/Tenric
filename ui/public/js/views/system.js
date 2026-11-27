import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, frag, h, json, notAvailable, notice, pageHead, section, table, tag, td } from "../ui.js";

/** What each backend says it can do, one row per capability. Hover or focus a cell for the backend's own wording. */
function capabilityMatrix(backends) {
  const withCaps = backends.filter((b) => b.capabilities && Object.keys(b.capabilities).length > 0);
  if (withCaps.length === 0) return null;
  const names = [...new Set(withCaps.flatMap((b) => Object.keys(b.capabilities)))].sort();
  return frag(h("div", { class: "spacer" }), h("h3", {}, t("capabilities_declared")), h("p", { class: "hint" }, t("capabilities_declared_hint")),
    table([t("capability"), ...withCaps.map((b) => b.name)], names.map((name) => h("tr", {},
      td(h("code", {}, name), "nowrap"),
      withCaps.map((b) => {
        const cap = b.capabilities[name];
        if (!cap) return td(h("span", { class: "faint" }, "—"));
        return td(h("div", { class: "cap" }, badge(cap.supported === false ? "not_available" : "available", "plain"), cap.guarantee ? h("div", { class: "hint" }, cap.guarantee) : null));
      })))));
}

export async function system() {
  const data = await api.system();
  const runtime = data.components.find((c) => c.id === "runtime");
  return frag(
    pageHead(t("system_title"), t("system_sub")),

    section(t("components"), null,
      table([t("component"), t("state"), t("found")], data.components.map((c) => h("tr", {},
        td(h("strong", {}, t(`component_${c.id}`)), "nowrap"), td(badge(c.state, "plain")), td(h("span", { class: "muted wrap-any" }, c.evidence)))))),

    section(t("backends"), t("backend_claims_body"), frag(
      runtime.state === "not_available" ? notAvailable(t("component_runtime"), t("runtime_missing")) : null,
      runtime.state === "partial" ? notice("bad", t("runtime_error"), runtime.evidence) : null,
      table([t("backend"), t("kind"), t("state"), t("notes")], data.backends.map((b) => h("tr", {},
        td(h("code", {}, b.name), "nowrap"), td(tag(b.kind)), td(badge(b.available ? "available" : "not_available", "plain")),
        td(h("span", { class: "muted" }, b.note ?? ""))))),
      capabilityMatrix(data.backends))),

    section(t("tasks"), null, data.tasks.length === 0
      ? notAvailable(t("tasks"), t("tasks_missing"))
      : table([t("task"), t("title"), t("file"), t("contract")], data.tasks.map((task) => h("tr", {},
        td(frag(h("code", {}, task.id), task.fixture ? frag(" ", badge("fixture")) : null)), td(task.error ? badge("error") : task.title ?? "—"), td(h("code", {}, task.path)),
        td(task.contract ? h("code", {}, typeof task.contract === "string" ? task.contract : `${task.contract.id} ${task.contract.version}`) : "—"))))),

    section(t("raw_status"), null, h("details", {}, h("summary", {}, "/api/system"), json(data))),
  );
}
