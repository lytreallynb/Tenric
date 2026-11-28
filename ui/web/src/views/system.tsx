import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Code, Json, NotAvailable, Notice, PageHeader, Panel, Status, Tag } from "@/components/app/bits";
import { SimpleTable } from "@/components/app/data-table";
import { Loaded } from "@/components/app/load";
import { api } from "@/lib/api.js";
import { useLoad } from "@/lib/hooks";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const DOT: Record<string, string> = { available: "bg-success", partial: "bg-warning", not_available: "bg-muted-foreground/40" };

/** What each backend says it can do. Hover a cell for the backend's own wording. */
function Capabilities({ backends }: { backends: any[] }) {
  const withCaps = backends.filter((b) => b.capabilities && Object.keys(b.capabilities).length > 0);
  if (withCaps.length === 0) return null;
  const names = [...new Set(withCaps.flatMap((b) => Object.keys(b.capabilities)))].sort();
  return (
    <Panel title={t("capabilities_declared")} description={t("capabilities_declared_hint")}>
      <SimpleTable head={[t("capability"), ...withCaps.map((b) => <span className="font-mono">{b.name}</span>)]} rows={names.map((name) => [
        <Code>{name}</Code>,
        ...withCaps.map((b) => {
          const cap = b.capabilities[name];
          if (!cap) return <span className="text-muted-foreground">—</span>;
          const badge = <Status word={cap.supported === false ? "not_available" : "available"} toneOverride={cap.supported === false ? "neutral" : "good"} />;
          return cap.guarantee ? <Tooltip><TooltipTrigger asChild><span className="inline-flex cursor-help">{badge}</span></TooltipTrigger><TooltipContent>{cap.guarantee}</TooltipContent></Tooltip> : badge;
        }),
      ])} />
    </Panel>
  );
}

export function System() {
  const state = useLoad(() => api.system(), []);
  return (
    <Loaded state={state}>
      {(data: any) => {
        const runtime = data.components.find((c: any) => c.id === "runtime");
        return (
          <>
            <PageHeader title={t("system_title")} description={t("system_sub")} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.components.map((c: any) => (
                <Card key={c.id} className={cn("gap-2 py-4", c.state === "not_available" && "border-dashed shadow-none")}>
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-center gap-2 text-sm"><span className={cn("size-2 rounded-full", DOT[c.state] ?? DOT.not_available)} />{t(`component_${c.id}`)}</CardTitle>
                    <CardDescription className="text-xs">{c.state}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-muted-foreground px-4 text-xs break-words">{c.evidence}</CardContent>
                </Card>
              ))}
            </div>
            <Panel title={t("backends")} description={t("backend_claims_body")}>
              <div className="grid gap-4">
                {runtime?.state === "not_available" ? <NotAvailable what={t("component_runtime")} why={t("runtime_missing")} /> : null}
                {runtime?.state === "partial" ? <Notice kind="bad" title={t("runtime_error")}>{runtime.evidence}</Notice> : null}
                <SimpleTable head={[t("backend"), t("kind"), t("state"), t("notes")]} rows={data.backends.map((b: any) => [
                  <Code>{b.name}</Code>, <Tag>{b.kind}</Tag>, <Status word={b.available ? "available" : "not_available"} toneOverride={b.available ? "good" : "neutral"} />, <span className="text-muted-foreground">{b.note ?? ""}</span>,
                ])} />
              </div>
            </Panel>
            <Capabilities backends={data.backends} />
            <Panel title={t("tasks")}>
              {data.tasks.length === 0 ? <NotAvailable what={t("tasks")} why={t("tasks_missing")} /> : (
                <SimpleTable head={[t("task"), t("title"), t("file"), t("contract")]} rows={data.tasks.map((task: any) => [
                  <span className="flex flex-wrap items-center gap-2"><Code>{task.id}</Code>{task.fixture ? <Status word="fixture" /> : null}</span>,
                  task.error ? <Status word="error" /> : task.title ?? "—",
                  <span className="font-mono text-xs">{task.path}</span>,
                  task.contract ? <Code>{typeof task.contract === "string" ? task.contract : `${task.contract.id} ${task.contract.version}`}</Code> : "—",
                ])} />
              )}
            </Panel>
            <Collapsible className="rounded-lg border">
              <CollapsibleTrigger className="hover:bg-muted/50 w-full px-4 py-3 text-left text-sm font-medium">{t("raw_status")} · <span className="font-mono">/api/system</span></CollapsibleTrigger>
              <CollapsibleContent className="border-t p-3"><Json value={data} /></CollapsibleContent>
            </Collapsible>
          </>
        );
      }}
    </Loaded>
  );
}
