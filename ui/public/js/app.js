import { api } from "./api.js";
import { getLang, setLang, t } from "./i18n.js";
import { h, notice } from "./ui.js";
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
const NAV = [["overview", "#/"], ["contracts", "#/contracts"], ["runs", "#/runs"], ["compare", "#/compare"], ["new", "#/new"], ["system", "#/system"], ["docs", "#/docs"]];

const main = document.getElementById("main");
let generation = 0;
/** Views register timers here; they are cleared on every navigation. */
export const timers = new Set();

function renderNav(active) {
  document.getElementById("nav").replaceChildren(...NAV.map(([id, href]) => h("a", { href, class: id === active ? "active" : "" }, t(`nav_${id}`))));
  const lang = getLang();
  document.documentElement.lang = lang;
  document.getElementById("sidebar-foot").replaceChildren(
    h("div", {}, t("local_only")),
    h("div", { class: "row" },
      h("button", { class: "btn small", disabled: lang === "zh", onclick: () => { setLang("zh"); navigate(); } }, "中文"),
      h("button", { class: "btn small", disabled: lang === "en", onclick: () => { setLang("en"); navigate(); } }, "English")));
}

async function navigate() {
  const mine = ++generation;
  for (const timer of timers) clearInterval(timer);
  timers.clear();
  const [path, search = ""] = (location.hash.slice(1) || "/").split("?");
  const route = routes.find((r) => r.pattern.test(path));
  renderNav(route?.nav);
  if (!route) { main.replaceChildren(notice("bad", t("not_found"), path)); return; }
  main.replaceChildren(h("div", { class: "loading" }, t("loading")));
  try {
    const args = route.pattern.exec(path).slice(1).map((part) => (part === undefined ? undefined : decodeURIComponent(part)));
    const node = await route.view({ args, query: new URLSearchParams(search) });
    if (mine === generation) { main.replaceChildren(node); main.scrollTo?.(0, 0); window.scrollTo(0, 0); }
  } catch (error) {
    if (mine === generation) main.replaceChildren(notice("bad", t("load_failed"), error.message));
  }
}

window.addEventListener("hashchange", navigate);
navigate();
export { api, navigate };
