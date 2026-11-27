import { api } from "../api.js";
import { t } from "../i18n.js";
import { badge, frag, h, json, notAvailable, notice, pageHead, table, tag, td } from "../ui.js";

export async function system() {
  const data = await api.system();
  const runtime = data.components.find((c) => c.id === "runtime");
  return frag(
    pageHead(t("system_title"), t("system_sub")),

    h("h2", {}, t("components")),
    table([t("component"), t("state"), t("found")], data.components.map((c) => h("tr", {},
      td(h("strong", {}, t(`component_${c.id}`))), td(badge(c.state, "plain")), td(h("span", { class: "muted wrap-any" }, c.evidence))))),

    h("h2", {}, t("backends")),
    runtime.state === "not_available" ? notAvailable(t("component_runtime"), t("runtime_missing")) : null,
    runtime.state === "partial" ? notice("bad", t("runtime_error"), runtime.evidence) : null,
    table([t("backend"), t("kind"), t("state"), t("capabilities"), t("notes")], data.backends.map((b) => h("tr", {},
      td(h("code", {}, b.name)), td(tag(b.kind)), td(badge(b.available ? "available" : "not_available", "plain")),
      td(b.capabilities ? h("div", {}, Object.entries(b.capabilities).map(([name, cap]) => h("div", {},
        badge(cap && cap.supported === false ? "not_available" : "available", "plain"), " ", h("code", {}, name),
        cap && cap.guarantee ? h("span", { class: "muted" }, ` ${cap.guarantee}`) : null))) : h("span", { class: "muted" }, "—")),
      td(h("span", { class: "muted" }, b.note ?? ""))))),
    notice("info", t("backend_claims_title"), t("backend_claims_body")),

    h("h2", {}, t("tasks")),
    data.tasks.length === 0
      ? notAvailable(t("tasks"), t("tasks_missing"))
      : table([t("task"), t("title"), t("file"), t("contract")], data.tasks.map((task) => h("tr", {},
        td(h("code", {}, task.id)), td(task.error ? badge("error") : task.title ?? "—"), td(h("code", {}, task.path)),
        td(task.contract ? h("code", {}, typeof task.contract === "string" ? task.contract : JSON.stringify(task.contract)) : "—")))),

    h("h2", {}, t("raw_status")),
    h("details", {}, h("summary", {}, "/api/system"), json(data)),
  );
}
