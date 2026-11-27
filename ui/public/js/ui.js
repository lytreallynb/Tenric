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

// Line icons, 24 by 24, drawn with the current text colour. Path data only: no markup is parsed.
const RING = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z";
const ICONS = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  runs: "M22 12h-4l-3 9L9 3l-3 9H2",
  contracts: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8",
  compare: "M12 3v18M4 7h5M4 12h5M4 17h5M15 7h5M15 12h5M15 17h5",
  new: "M6 4l14 8-14 8z",
  system: "M5 5h14v14H5zM9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4",
  docs: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  check: "M20 6L9 17l-5-5", x: "M18 6L6 18M6 6l12 12", minus: "M5 12h14",
  question: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01", bang: "M12 7v6M12 17h.01",
  accepted: `${RING}M16.5 9l-5.5 6-3-3`, rejected: `${RING}M15 9l-6 6M9 9l6 6`,
  inconclusive: `${RING}M9.3 9.2a2.8 2.8 0 0 1 5.4.9c0 1.9-2.7 2.6-2.7 2.6M12 16.8h.01`, none: `${RING}M8 12h8`,
  info: `${RING}M12 16v-4M12 8h.01`,
  warn: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z", auto: "M2 3h20v14H2zM8 21h8M12 17v4",
  arrow: "M5 12h14M13 6l6 6-6 6", chevron: "M9 6l6 6-6 6",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  swap: "M7 4L3 8l4 4M3 8h18M17 20l4-4-4-4M21 16H3",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
};
const SVG = "http://www.w3.org/2000/svg";
export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.minus);
  svg.append(path);
  return svg;
}
/** The glyph for a requirement status, as recorded by the verifier. */
export const statusIcon = (status, size = 13) => icon(status === "pass" ? "check" : status === "fail" ? "x" : status === "error" ? "bang" : "minus", size);

/** Status words from the verifier are shown verbatim; they are vocabulary, not prose. */
export const badge = (word, extra = "") => h("span", { class: `badge ${String(word).replaceAll(" ", "_")} ${extra}` }, String(word));
export const tag = (text, cls = "") => h("span", { class: `tag ${cls}` }, text);
export const spinner = () => h("span", { class: "spinner", role: "status" });

export function toast(text) {
  let host = document.getElementById("toasts");
  if (!host) { host = h("div", { id: "toasts", "aria-live": "polite" }); document.body.append(host); }
  const node = h("div", { class: "toast" }, icon("check", 13), text);
  host.append(node);
  setTimeout(() => node.remove(), 1900);
}

export function sha(value, full = false) {
  if (!value) return h("span", { class: "faint" }, "—");
  return h("span", {
    class: `sha ${full ? "full" : ""}`, title: `${value}\n${t("click_to_copy")}`,
    onclick: (event) => { event.stopPropagation(); navigator.clipboard?.writeText(value).then(() => toast(t("copied")), () => {}); },
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

const NOTICE_ICON = { info: "info", warn: "warn", bad: "rejected", na: "none" };
export function notice(kind, title, ...body) {
  return h("div", { class: `notice ${kind}`, role: kind === "bad" ? "alert" : null }, icon(NOTICE_ICON[kind] ?? "info", 17), h("div", {}, title ? h("strong", {}, title) : null, body));
}
/** For anything a slice has not delivered yet. Never rendered with sample data. */
export const notAvailable = (what, why) => notice("na", `${t("not_yet_available")}: ${what}`, why);

/** An empty or failed state: what is missing, why, and the one thing to do about it. */
export function empty(title, body, action, options = {}) {
  return h("div", { class: `empty ${options.kind ?? ""} ${options.compact ? "compact" : ""}` },
    h("div", { class: "glyph" }, icon(options.icon ?? "inbox", 20)), title ? h("b", {}, title) : null, body ? h("p", {}, body) : null, action ?? null);
}
export const skeleton = () => h("div", { class: "skeleton", "aria-busy": "true", "aria-label": t("loading") },
  h("i", { class: "title" }), h("i", { class: "line" }), h("div", { class: "cols" }, h("i"), h("i"), h("i"), h("i")), h("i", { class: "block" }), h("i", { class: "block" }));

export function table(headers, rows, options = {}) {
  if (rows.length === 0) return h("div", { class: "table-wrap" }, options.empty instanceof Node ? options.empty : empty(null, options.empty ?? t("nothing_here"), null, { compact: true }));
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, headers.map((head) => (head instanceof Node ? head : h("th", { class: head.endsWith("#") ? "num" : "" }, head.replace(/#$/, "")))))),
    h("tbody", {}, rows)));
}
export const td = (content, cls) => h("td", { class: cls ?? "" }, content);
export const kv = (pairs) => h("dl", { class: "kv" }, pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v ?? "—")]));

export function tabs(items, initial, onChange) {
  const bar = h("div", { class: "tabs", role: "tablist" });
  const body = h("div", { role: "tabpanel" });
  const select = (id) => {
    for (const button of bar.children) { const on = button.dataset.id === id; button.classList.toggle("active", on); button.setAttribute("aria-selected", String(on)); }
    body.replaceChildren(items.find((item) => item.id === id).render());
    onChange?.(id);
  };
  for (const item of items) bar.append(h("button", { dataset: { id: item.id }, role: "tab", onclick: () => select(item.id) }, item.label));
  select(items.some((item) => item.id === initial) ? initial : items[0].id);
  return frag(bar, body);
}

/** A row of mutually exclusive choices. `options` are [value, label, count?, title?]. */
export function segmented(options, value, onChange, cls = "") {
  const el = h("div", { class: `seg ${cls}`, role: "group" });
  const draw = (current) => el.replaceChildren(...options.map(([v, label, count, title]) => h("button", {
    class: v === current ? "active" : "", "aria-pressed": String(v === current), title: title ?? null, "aria-label": title ?? null,
    onclick: () => { draw(v); onChange(v); },
  }, label, count === undefined ? null : h("span", { class: "count" }, count))));
  draw(value);
  return el;
}

export function pageHead(title, sub, actions) {
  return h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, title), sub ? h("div", { class: "sub" }, sub) : null), actions ? h("div", { class: "actions" }, actions) : null);
}
export function section(title, hint, body, aside) {
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, title), hint ? h("div", { class: "hint" }, hint) : null), aside ? h("div", { class: "aside" }, aside) : null),
    body);
}
/** A labelled fact in a strip of facts. */
export const fact = (label, value, sub) => h("div", {}, h("div", { class: "label" }, label), h("div", { class: "v" }, value), sub ? h("div", { class: "l" }, sub) : null);

export function verdictCell(run) {
  if (run.verification) return badge(run.verification.verdict);
  return h("span", { class: "badge none plain", title: run.no_verdict ?? "" }, t("no_verdict"));
}
export const dataClass = (value) => (value === "fixture" ? badge("fixture") : value ? tag(value) : "—");
export function revision(source) {
  if (!source || source.kind !== "git") return h("span", { class: "muted" }, source?.kind ?? "—");
  return frag(sha(source.revision), source.dirty ? frag(" ", h("span", { class: "badge warn plain" }, "dirty")) : null);
}
