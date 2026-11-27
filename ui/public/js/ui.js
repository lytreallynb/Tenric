// DOM helpers. Everything is built with createElement and textContent: run
// directories contain text written by untrusted code, and none of it is ever
// parsed as HTML.
import { t } from "./i18n.js";

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
export const frag = (...children) => { const f = document.createDocumentFragment(); append(f, children); return f; };

/** Status words from the verifier are shown verbatim; they are vocabulary, not prose. */
export const badge = (word, extra = "") => h("span", { class: `badge ${String(word).replaceAll(" ", "_")} ${extra}` }, String(word));
export const tag = (text) => h("span", { class: "tag" }, text);

export function sha(value, full = false) {
  if (!value) return h("span", { class: "faint" }, "—");
  return h("span", {
    class: `sha ${full ? "full" : ""}`, title: `${value}\n${t("click_to_copy")}`,
    onclick: (event) => { event.stopPropagation(); navigator.clipboard?.writeText(value); },
  }, full ? value : value.slice(0, 12));
}

export function time(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : h("span", { title: iso }, date.toLocaleString(undefined, { hour12: false }));
}
export const bytes = (n) => (typeof n !== "number" ? "—" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`);
export const num = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, "")) : v === null || v === undefined ? "—" : String(v));
export const show = (value) => (typeof value === "string" ? value : JSON.stringify(value));
export const json = (value) => h("pre", {}, typeof value === "string" ? value : JSON.stringify(value, null, 2));

export function notice(kind, title, ...body) {
  return h("div", { class: `notice ${kind}` }, title ? h("strong", {}, title) : null, body);
}
/** For anything a slice has not delivered yet. Never rendered with sample data. */
export const notAvailable = (what, why) => notice("na", `${t("not_yet_available")}: ${what}`, why);

export function table(headers, rows, options = {}) {
  if (rows.length === 0) return h("div", { class: "table-wrap" }, h("div", { class: "empty" }, options.empty ?? t("nothing_here")));
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, headers.map((head) => (head instanceof Node ? head : h("th", { class: head.endsWith("#") ? "num" : "" }, head.replace(/#$/, "")))))),
    h("tbody", {}, rows)));
}
export const td = (content, cls) => h("td", { class: cls ?? "" }, content);
export const kv = (pairs) => h("dl", { class: "kv" }, pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v ?? "—")]));

export function tabs(items, initial, onChange) {
  const bar = h("div", { class: "tabs", role: "tablist" });
  const body = h("div", {});
  const select = (id) => {
    for (const button of bar.children) button.classList.toggle("active", button.dataset.id === id);
    body.replaceChildren(items.find((item) => item.id === id).render());
    onChange?.(id);
  };
  for (const item of items) bar.append(h("button", { dataset: { id: item.id }, role: "tab", onclick: () => select(item.id) }, item.label));
  select(items.some((item) => item.id === initial) ? initial : items[0].id);
  return frag(bar, body);
}

export function pageHead(title, sub, actions, crumbs) {
  return h("div", {},
    crumbs ? h("div", { class: "crumbs" }, crumbs) : null,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub ? h("div", { class: "sub" }, sub) : null), actions ? h("div", { class: "actions" }, actions) : null));
}

export function verdictCell(run) {
  if (run.verification) return badge(run.verification.verdict);
  return h("span", { class: "badge none plain", title: run.no_verdict ?? "" }, t("no_verdict"));
}
export const dataClass = (value) => (value === "fixture" ? badge("fixture") : value ? tag(value) : "—");
export function revision(source) {
  if (!source || source.kind !== "git") return h("span", { class: "muted" }, source?.kind ?? "—");
  return frag(sha(source.revision), source.dirty ? frag(" ", h("span", { class: "badge warn plain" }, "dirty")) : null);
}
