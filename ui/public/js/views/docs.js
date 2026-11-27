import { api } from "../api.js";
import { t } from "../i18n.js";
import { markdown } from "../md.js";
import { setCrumbs } from "../app.js";
import { empty, frag, h, pageHead } from "../ui.js";

const ORDER = ["rfcs", "reports", "adr", "docs", "repository"];

/** Resolves a relative link inside a document to another document in the viewer, when there is one. */
function resolver(current, known) {
  return (href) => {
    if (/^https?:\/\//.test(href)) return href;
    if (href.startsWith("#") || href.includes(":")) return null;
    const parts = current.split("/").slice(0, -1);
    for (const part of href.split("#")[0].split("/")) {
      if (part === "..") parts.pop(); else if (part !== "." && part !== "") parts.push(part);
    }
    const path = parts.join("/");
    return known.has(path) ? `#/docs/${path}` : null;
  };
}

export async function docs({ args: [path] }) {
  const list = await api.docs();
  const known = new Set(list.map((d) => d.path));
  const current = path && known.has(path) ? path : (list.find((d) => d.group === "rfcs") ?? list[0])?.path;
  const groups = [...new Set(list.map((d) => d.group))].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
  const doc = current ? await api.doc(current) : null;
  if (doc) setCrumbs([t("nav_docs"), "#/docs"], doc.path);
  return frag(
    pageHead(t("docs_title"), t("docs_sub")),
    h("div", { class: "doc-layout" },
      h("nav", { class: "doc-list panel" }, groups.map((group) => frag(h("h3", {}, group),
        list.filter((d) => d.group === group).map((d) => h("a", { href: `#/docs/${d.path}`, class: d.path === current ? "active" : "" }, d.title, d.status ? h("small", {}, d.status) : null))))),
      h("article", { class: "panel" }, doc ? markdown(doc.text, resolver(doc.path, known)) : empty(null, t("nothing_here")))),
  );
}
