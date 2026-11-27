// A small Markdown renderer for the repository's own documents and for
// report.md. It covers what those files use (headings, tables, lists, code,
// emphasis, links) and builds DOM nodes directly, so embedded HTML is shown as text.
import { h } from "./ui.js";

function inline(text, linkFor) {
  const out = [];
  const pattern = /(`+)(.+?)\1|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[2] !== undefined) out.push(h("code", {}, match[2]));
    else if (match[3] !== undefined) out.push(h("strong", {}, inline(match[3], linkFor)));
    else if (match[4] !== undefined) out.push(h("em", {}, inline(match[4], linkFor)));
    else {
      const href = linkFor(match[6]);
      out.push(href ? h("a", { href, ...(href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" }) }, inline(match[5], linkFor)) : inline(match[5], linkFor));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));

export function markdown(source, linkFor = () => null) {
  const root = h("div", { class: "md" });
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let i = 0;
  const isBlockStart = (line) => /^(#{1,6} |```|> |\s*[-*] |\s*\d+\. |\|)/.test(line) || /^(-{3,}|\*{3,})$/.test(line.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i += 1; continue; }
    const fence = /^```/.exec(line);
    if (fence) {
      const code = [];
      for (i += 1; i < lines.length && !lines[i].startsWith("```"); i += 1) code.push(lines[i]);
      i += 1;
      root.append(h("pre", {}, h("code", {}, code.join("\n"))));
      continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) { root.append(h(`h${Math.min(heading[1].length, 4)}`, {}, inline(heading[2], linkFor))); i += 1; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { root.append(h("hr")); i += 1; continue; }
    if (line.startsWith("|") && /^\|?[\s:|-]+\|?$/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const body = [];
      for (i += 2; i < lines.length && lines[i].startsWith("|"); i += 1) body.push(cells(lines[i]));
      root.append(h("table", {},
        head.some((c) => c !== "") ? h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, inline(c, linkFor))))) : null,
        h("tbody", {}, body.map((row) => h("tr", {}, row.map((c) => h("td", {}, inline(c, linkFor))))))));
      continue;
    }
    if (line.startsWith("> ")) {
      const quote = [];
      for (; i < lines.length && lines[i].startsWith(">"); i += 1) quote.push(lines[i].replace(/^> ?/, ""));
      root.append(h("blockquote", {}, inline(quote.join(" "), linkFor)));
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const list = h(ordered ? "ol" : "ul");
      let current = null;
      for (; i < lines.length; i += 1) {
        const next = /^(\s*)([-*]|\d+\.) (.*)$/.exec(lines[i]);
        if (next && next[1].length <= item[1].length + 1) { current = h("li", {}, inline(next[3], linkFor)); list.append(current); }
        else if (next && current) current.append(h("ul", {}, h("li", {}, inline(next[3], linkFor))));
        else if (lines[i].trim() !== "" && /^\s+/.test(lines[i]) && current) current.append(" ", ...inline(lines[i].trim(), linkFor));
        else break;
      }
      root.append(list);
      continue;
    }
    const paragraph = [];
    for (; i < lines.length && lines[i].trim() !== "" && !(paragraph.length > 0 && isBlockStart(lines[i])); i += 1) paragraph.push(lines[i].trim());
    root.append(h("p", {}, inline(paragraph.join(" "), linkFor)));
  }
  return root;
}
