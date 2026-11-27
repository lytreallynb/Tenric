// A small Markdown renderer for the repository's own documents and report.md.
// It covers what those files use (headings, tables, lists, code, emphasis,
// links) and builds React elements, so any HTML inside a document is shown as text.
import * as React from "react";

type LinkFor = (href: string) => string | null;

function inline(text: string, linkFor: LinkFor, key = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(`+)(.+?)\1|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    const k = `${key}.${n++}`;
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[2] !== undefined) out.push(<code key={k}>{match[2]}</code>);
    else if (match[3] !== undefined) out.push(<strong key={k}>{inline(match[3], linkFor, k)}</strong>);
    else if (match[4] !== undefined) out.push(<em key={k}>{inline(match[4], linkFor, k)}</em>);
    else {
      const href = linkFor(match[6]!);
      out.push(href
        ? <a key={k} href={href} {...(href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{inline(match[5]!, linkFor, k)}</a>
        : <React.Fragment key={k}>{inline(match[5]!, linkFor, k)}</React.Fragment>);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));

export function Markdown({ source, linkFor = () => null }: { source: string; linkFor?: LinkFor }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let i = 0;
  const isBlockStart = (line: string) => /^(#{1,6} |```|> |\s*[-*] |\s*\d+\. |\|)/.test(line) || /^(-{3,}|\*{3,})$/.test(line.trim());
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${i}`;
    if (line.trim() === "") { i += 1; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      for (i += 1; i < lines.length && !lines[i]!.startsWith("```"); i += 1) code.push(lines[i]!);
      i += 1;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(heading[1]!.length, 4)}` as "h1";
      blocks.push(<Tag key={key}>{inline(heading[2]!, linkFor)}</Tag>);
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={key} />); i += 1; continue; }
    if (line.startsWith("|") && /^\|?[\s:|-]+\|?$/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const body: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.startsWith("|"); i += 1) body.push(cells(lines[i]!));
      blocks.push(
        <table key={key}>
          {head.some((c) => c !== "") ? <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, linkFor)}</th>)}</tr></thead> : null}
          <tbody>{body.map((row, r) => <tr key={r}>{row.map((c, j) => <td key={j}>{inline(c, linkFor)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (line.startsWith("> ")) {
      const quote: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i += 1) quote.push(lines[i]!.replace(/^> ?/, ""));
      blocks.push(<blockquote key={key}>{inline(quote.join(" "), linkFor)}</blockquote>);
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]!);
      const items: { text: React.ReactNode[]; children: React.ReactNode[] }[] = [];
      for (; i < lines.length; i += 1) {
        const next = /^(\s*)([-*]|\d+\.) (.*)$/.exec(lines[i]!);
        const current = items[items.length - 1];
        if (next && next[1]!.length <= item[1]!.length + 1) items.push({ text: inline(next[3]!, linkFor, `l${i}`), children: [] });
        else if (next && current) current.children.push(<li key={i}>{inline(next[3]!, linkFor, `l${i}`)}</li>);
        else if (lines[i]!.trim() !== "" && /^\s+/.test(lines[i]!) && current) current.text.push(" ", ...inline(lines[i]!.trim(), linkFor, `c${i}`));
        else break;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key}>{items.map((it, j) => <li key={j}>{it.text}{it.children.length > 0 ? <ul>{it.children}</ul> : null}</li>)}</List>);
      continue;
    }
    const paragraph: string[] = [];
    for (; i < lines.length && lines[i]!.trim() !== "" && !(paragraph.length > 0 && isBlockStart(lines[i]!)); i += 1) paragraph.push(lines[i]!.trim());
    blocks.push(<p key={key}>{inline(paragraph.join(" "), linkFor)}</p>);
  }
  return <div className="prose-doc">{blocks}</div>;
}
