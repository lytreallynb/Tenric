import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, frag, h, json, notAvailable, notice, pageHead, section, table, tag, td } from "../ui.js";

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
      table([t("backend"), t("kind"), t("state"), t("capabilities"), t("notes")], data.backends.map((b) => h("tr", {},
        td(h("code", {}, b.name)), td(tag(b.kind)), td(badge(b.available ? "available" : "not_available", "plain")),
        td(b.capabilities ? h("div", { class: "stack caps" }, Object.entries(b.capabilities).map(([name, cap]) => h("div", {},
          badge(cap && cap.supported === false ? "not_available" : "available", "plain"), " ", h("code", {}, name),
          cap && cap.guarantee ? h("div", { class: "hint" }, cap.guarantee) : null))) : h("span", { class: "muted" }, "—")),
        td(h("span", { class: "muted" }, b.note ?? ""))))))),

    section(t("tasks"), null, data.tasks.length === 0
      ? notAvailable(t("tasks"), t("tasks_missing"))
      : table([t("task"), t("title"), t("file"), t("contract")], data.tasks.map((task) => h("tr", {},
        td(frag(h("code", {}, task.id), task.fixture ? frag(" ", badge("fixture")) : null)), td(task.error ? badge("error") : task.title ?? "—"), td(h("code", {}, task.path)),
        td(task.contract ? h("code", {}, typeof task.contract === "string" ? task.contract : `${task.contract.id} ${task.contract.version}`) : "—"))))),

    section(t("raw_status"), null, h("details", {}, h("summary", {}, "/api/system"), json(data))),
  );
}
