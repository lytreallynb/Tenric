import { api } from "./api.js";
import { getLang, setLang, t } from "./i18n.js";
import { empty, h, icon, segmented, skeleton } from "./ui.js";
import { overview } from "./views/overview.js";
import { contractList, contractDetail } from "./views/contracts.js";
import { runList } from "./views/runs.js";
import { runDetail } from "./views/run.js";
import { compare } from "./views/compare.js";
import { newRun } from "./views/newrun.js";
import { system } from "./views/system.js";
import { docs } from "./views/docs.js";

const routes = [
  { nav: "overview", pattern: /^\/$/, view: overview },
  { nav: "contracts", pattern: /^\/contracts$/, view: contractList },
  { nav: "contracts", pattern: /^\/contracts\/([^/]+)\/([^/]+)$/, view: contractDetail },
  { nav: "runs", pattern: /^\/runs$/, view: runList },
  { nav: "runs", pattern: /^\/runs\/([^/]+)(?:\/([a-z]+))?$/, view: runDetail },
  { nav: "compare", pattern: /^\/compare$/, view: compare },
  { nav: "new", pattern: /^\/new$/, view: newRun },
  { nav: "system", pattern: /^\/system$/, view: system },
  { nav: "docs", pattern: /^\/docs(?:\/(.+))?$/, view: docs },
];
const NAV = [
  ["inspect", [["overview", "#/"], ["runs", "#/runs"], ["compare", "#/compare"], ["contracts", "#/contracts"]]],
  ["act", [["new", "#/new"]]],
  ["ref", [["system", "#/system"], ["docs", "#/docs"]]],
];
const HREF = Object.fromEntries(NAV.flatMap(([, items]) => items));

const main = document.getElementById("main");
let generation = 0;
/** Views register timers here; they are cleared on every navigation. */
export const timers = new Set();

// What the sidebar and the top bar show about the checkout. Fetched in the
// background so that it never delays a page; absent until it arrives.
let facts = null;
function refreshFacts() {
  api.system().then((system) => { facts = system; renderChrome(currentNav); }, () => {});
}
let currentNav;

function theme() { try { return localStorage.getItem("tenric-ui-theme") ?? "auto"; } catch { return "auto"; } }
function setTheme(next) {
  try { localStorage.setItem("tenric-ui-theme", next); } catch { /* not persisted */ }
  if (next === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
}

/** The trail in the top bar: the section, then whatever the view adds with setCrumbs. */
export function setCrumbs(...trail) {
  const parts = [];
  trail.filter(Boolean).forEach((part, index, all) => {
    if (index > 0) parts.push(h("span", { class: "sep" }, "/"));
    const last = index === all.length - 1;
    parts.push(Array.isArray(part) ? h("a", { href: part[1] }, part[0]) : last ? h("b", {}, part) : h("span", {}, part));
  });
  document.getElementById("crumbs").replaceChildren(...parts);
}

function renderChrome(active) {
  const count = { runs: facts?.counts.runs, contracts: facts?.counts.contracts };
  document.getElementById("nav").replaceChildren(...NAV.flatMap(([group, items]) => [
    h("div", { class: "group" }, t(`nav_group_${group}`)),
    ...items.map(([id, href]) => h("a", { href, class: id === active ? "active" : "", "aria-current": id === active ? "page" : null },
      icon(id, 16), t(`nav_${id}`), count[id] === undefined ? null : h("span", { class: "count" }, count[id]))),
  ]));
  const lang = getLang();
  document.documentElement.lang = lang;
  document.getElementById("sidebar-foot").replaceChildren(h("div", {}, t("local_only")));
  const repository = facts?.repository;
  document.getElementById("topbar-right").replaceChildren(
    repository?.revision ? h("span", { class: `rev-chip ${repository.dirty ? "dirty" : ""}`, title: `${repository.revision}${repository.dirty ? " · dirty" : ""}` },
      h("span", { class: "dot" }), repository.revision.slice(0, 10), repository.dirty ? " · dirty" : null) : null,
    segmented([["zh", "中文"], ["en", "EN"]], lang, (next) => { setLang(next); navigate(); }),
    segmented([["auto", "auto"], ["light", "sun"], ["dark", "moon"]].map(([id, glyph]) => [id, icon(glyph, 14), undefined, t(`theme_${id}`)]), theme(), setTheme, "icons"));
}

async function navigate() {
  const mine = ++generation;
  for (const timer of timers) clearInterval(timer);
  timers.clear();
  const [path, search = ""] = (location.hash.slice(1) || "/").split("?");
  const route = routes.find((r) => r.pattern.test(path));
  currentNav = route?.nav;
  renderChrome(currentNav);
  if (!route) {
    setCrumbs(t("not_found"));
    main.replaceChildren(empty(t("not_found"), path, h("a", { class: "btn", href: "#/" }, t("nav_overview")), { icon: "question" }));
    return;
  }
  setCrumbs(t(`nav_${route.nav}`));
  // A page that answers quickly never shows its placeholder.
  const placeholder = setTimeout(() => { if (mine === generation) main.replaceChildren(skeleton()); }, 140);
  try {
    const args = route.pattern.exec(path).slice(1).map((part) => (part === undefined ? undefined : decodeURIComponent(part)));
    const node = await route.view({ args, query: new URLSearchParams(search) });
    clearTimeout(placeholder);
    if (mine !== generation) return;
    main.replaceChildren(node);
    main.style.animation = "none"; void main.offsetWidth; main.style.animation = "";
    window.scrollTo(0, 0);
  } catch (error) {
    clearTimeout(placeholder);
    if (mine === generation) main.replaceChildren(empty(t("load_failed"), error.message,
      h("button", { class: "btn", onclick: navigate }, icon("refresh", 14), t("retry")), { kind: "bad", icon: "warn" }));
  }
}

// g then a letter jumps between sections, as long as the reader is not typing.
let chord = 0;
window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (event.key === "g") { chord = Date.now(); return; }
  const jump = { o: "overview", r: "runs", c: "contracts", d: "docs", n: "new", s: "system", m: "compare" }[event.key];
  if (jump && Date.now() - chord < 900) { location.hash = HREF[jump]; chord = 0; }
});

window.addEventListener("hashchange", navigate);
navigate();
refreshFacts();
export { api, navigate, HREF };
