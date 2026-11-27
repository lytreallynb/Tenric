import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, PageHeader } from "@/components/app/bits";
import { Loaded } from "@/components/app/load";
import { useCrumbs } from "@/components/app/shell";
import { api } from "@/lib/api.js";
import { useLoad } from "@/lib/hooks";
import { Markdown } from "@/lib/markdown";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";

const ORDER = ["rfcs", "reports", "adr", "docs", "repository"];

/** Resolves a relative link inside a document to another document in the viewer, when there is one. */
function resolver(current: string, known: Set<string>) {
  return (href: string) => {
    if (/^https?:\/\//.test(href)) return href;
    if (href.startsWith("#") || href.includes(":")) return null;
    const parts = current.split("/").slice(0, -1);
    for (const part of href.split("#")[0]!.split("/")) {
      if (part === "..") parts.pop(); else if (part !== "." && part !== "") parts.push(part);
    }
    const path = parts.join("/");
    return known.has(path) ? `#/docs/${path}` : null;
  };
}

export function Docs({ args: [path] }: { args: (string | undefined)[] }) {
  const state = useLoad(async () => {
    const list = await api.docs();
    const known = new Set<string>(list.map((d: any) => d.path));
    const current = path && known.has(path) ? path : (list.find((d: any) => d.group === "rfcs") ?? list[0])?.path;
    return { list, known, current, doc: current ? await api.doc(current) : null };
  }, [path]);
  return (
    <Loaded state={state}>
      {({ list, known, current, doc }: any) => <DocsView list={list} known={known} current={current} doc={doc} />}
    </Loaded>
  );
}

function DocsView({ list, known, current, doc }: any) {
  useCrumbs(doc ? [doc.path] : []);
  const groups = [...new Set<string>(list.map((d: any) => d.group))].sort((a, b) => ((ORDER.indexOf(a) + 99) % 99) - ((ORDER.indexOf(b) + 99) % 99));
  return (
    <>
      <PageHeader title={t("docs_title")} description={t("docs_sub")} />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav className="lg:sticky lg:top-20 lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto">
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group} className="flex flex-col gap-0.5">
                <div className="text-muted-foreground px-2 pb-1 text-xs font-medium uppercase tracking-wide">{group}</div>
                {list.filter((d: any) => d.group === group).map((d: any) => (
                  <a key={d.path} href={`#/docs/${d.path}`} className={cn("hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm", d.path === current && "bg-accent font-medium")}>
                    <span className="min-w-0 truncate">{d.title}</span>
                    {d.status ? <Badge variant="outline" className="shrink-0 text-[10px] font-normal">{d.status}</Badge> : null}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <Card className="min-w-0">
          <CardContent>{doc ? <Markdown source={doc.text} linkFor={resolver(doc.path, known)} /> : <Empty body={t("nothing_here")} />}</CardContent>
        </Card>
      </div>
    </>
  );
}
