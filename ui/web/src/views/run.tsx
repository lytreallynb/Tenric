import * as React from "react";
import { ExternalLinkIcon, FileTextIcon, GitCompareArrowsIcon, PenLineIcon, ShieldCheckIcon, ImageIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Code, DataClass, Empty, Json, Kv, NotAvailable, NotAvailableBadge, NoVerdict, Notice, PageHeader, Panel, Pre, Revision, Sha, Status, Tag, When } from "@/components/app/bits";
import { SimpleTable } from "@/components/app/data-table";
import { ChartBox, ChartTip } from "@/components/app/chart";
import { Loaded } from "@/components/app/load";
import { useCrumbs } from "@/components/app/shell";
import { isolationEnforced, VerdictTab } from "./run-verdict";
import { api } from "@/lib/api.js";
import { bytes, num, show } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { Markdown } from "@/lib/markdown";
import { enc } from "@/lib/router";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";

// ------------------------------------------------------- evidence and claims

const CHECK_SCOPE: Record<string, string[]> = {
  "output-integrity": ["outputs"], "metric-traceability": ["metrics"], "finding-references": ["findings"], "human-review": ["findings", "limitations"],
  "execution-succeeded": ["execution"], "source-pinned": ["source"], "numeric-reproduction": ["metrics", "outputs"],
};

function records(artifact: any) {
  const out: { label: string; section: string; value: any; provenance?: string }[] = [];
  const push = (label: string, section: string, value: any) => out.push({ label, section, value, provenance: value && typeof value === "object" && !Array.isArray(value) ? value.provenance : undefined });
  for (const [key, value] of Object.entries<any>(artifact)) {
    if (["ir_version", "artifact_type", "volatile_fields"].includes(key)) continue;
    if (Array.isArray(value) && value.length > 0 && value.every((e) => e && typeof e === "object")) value.forEach((e, i) => push(`${key}[${i}]`, key, e));
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const { producer_claims: claims, ...rest } = value;
      push(key, key, rest);
      if (claims) push(`${key}.producer_claims`, key, claims);
    } else push(key, key, value);
  }
  return out;
}

function RecordCard({ record, touching }: { record: any; touching: any[] }) {
  const { provenance: _omit, ...fields } = record.value && typeof record.value === "object" && !Array.isArray(record.value) ? record.value : { value: record.value };
  return (
    <div className="bg-card grid gap-3 rounded-lg border p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium break-all">{record.label}</span>
        {record.provenance ? <Status word={record.provenance} toneOverride={record.provenance === "collector" ? "good" : "neutral"} /> : <NotAvailableBadge text={t("undeclared")} />}
      </div>
      <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
        {Object.entries<any>(fields).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("min-w-0 break-words", (typeof v === "object" && v !== null) || /sha256|revision/.test(k) ? "font-mono" : "")}>{typeof v === "object" && v !== null ? JSON.stringify(v) : show(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs">
        {touching.length > 0 ? <>{t("checked_by")}: {touching.map((r) => <Status key={r.requirement} word={r.status} className="font-mono" title={r.requirement} />)}</> : t("checked_by_nothing")}
      </div>
    </div>
  );
}

function EvidenceTab({ run, outcome }: { run: any; outcome: any }) {
  const artifact = run.artifact;
  if (!artifact) return <Notice kind="bad" title={t("artifact_unreadable")}>{run.artifact_error}</Notice>;
  const results = outcome.issued ? outcome.record.results : [];
  const params = new Map((outcome.issued ? outcome.requirements : []).map((r: any) => [r.id, r.check?.params]));
  const touching = (section: string) => results.filter((r: any) => (CHECK_SCOPE[r.kind] ?? []).includes(section)
    || (r.kind === "collector-provenance" && ((params.get(r.requirement) as any)?.sections ?? []).includes(section)));
  const all = records(artifact);
  const lanes = [
    { key: "evidence", Icon: ShieldCheckIcon, title: t("lane_evidence"), sub: t("lane_evidence_sub"), list: all.filter((r) => r.provenance === "collector") },
    { key: "claims", Icon: PenLineIcon, title: t("lane_claims"), sub: t("lane_claims_sub"), list: all.filter((r) => r.provenance !== "collector") },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Notice kind="warn" title={t("declared_provenance_title")}>{t("declared_provenance_body")}</Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        {lanes.map((lane) => (
          <Card key={lane.key} className={cn("gap-4", lane.key === "evidence" ? "bg-success/[0.03]" : "bg-muted/30")}>
            <CardHeader className="grid-cols-[auto_1fr_auto] items-center">
              <div className={cn("flex size-9 items-center justify-center rounded-lg border", lane.key === "evidence" ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground")}><lane.Icon className="size-4" /></div>
              <div><CardTitle>{lane.title}</CardTitle><CardDescription>{lane.sub}</CardDescription></div>
              <span className="text-2xl font-semibold tabular-nums">{lane.list.length}</span>
            </CardHeader>
            <CardContent className="grid gap-3">
              {/* A nested claims block is not what a section-level check reads, so it is not credited with that check. */}
              {lane.list.length === 0 ? <Empty compact body={t("nothing_here")} /> : lane.list.map((r) => <RecordCard key={r.label} record={r} touching={r.label.includes(".") ? [] : touching(r.section)} />)}
            </CardContent>
          </Card>
        ))}
      </div>
      {Array.isArray(artifact.volatile_fields) && artifact.volatile_fields.length > 0 ? (
        <Panel title={t("volatile_fields")} description={t("volatile_hint")}>
          <div className="flex flex-wrap gap-1.5">{artifact.volatile_fields.map((p: string) => <Code key={p}>{p}</Code>)}</div>
        </Panel>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ outputs

function FileState({ file }: { file: any }) {
  if (file.path === "artifact.json") return <Tag>artifact record</Tag>;
  if (file.path.startsWith("tenric/")) return <Tag>runtime record</Tag>;
  if (file.path.startsWith("workspace/")) return <Tag>workspace</Tag>;
  if (!file.listed) return <span title={t("unlisted_hint")}><NotAvailableBadge text={t("unlisted")} /></span>;
  if (!file.present) return <Status word="missing" />;
  if (file.escapes) return <Status word="escapes run dir" />;
  return <Status word={file.matches ? "match" : "mismatch"} />;
}

function OutputsTab({ run }: { run: any }) {
  const [preview, setPreview] = React.useState<{ file: any; text?: string } | null>(null);
  if (run.summary.origin === "fixture") return <Notice kind="na" title={t("fixture_no_files")}>{t("fixture_no_files_body")}</Notice>;
  const open = async (file: any) => {
    if (/\.(png|jpe?g)$/i.test(file.path) || (file.bytes ?? 0) > 512 * 1024) { setPreview({ file }); return; }
    setPreview({ file, text: await api.fileText(run.summary.id, file.path) });
  };
  const figures = run.files.filter((f: any) => f.present && !f.escapes && /\.(png|jpe?g)$/i.test(f.path));
  const url = preview ? api.fileUrl(run.summary.id, preview.file.path) : "";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("outputs_hint")}</p>
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-left">{[t("file"), t("role"), t("determinism"), t("declared_provenance"), t("size"), t("recorded_sha"), t("disk_sha"), t("integrity")].map((h, i) => <th key={i} className={cn("h-10 px-2 font-medium whitespace-nowrap first:pl-4 last:pr-4", i === 4 && "text-right")}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {run.files.map((file: any) => {
                const clickable = file.present && !file.escapes;
                return (
                  <tr key={file.path} onClick={clickable ? () => open(file) : undefined} className={cn("hover:bg-muted/50 border-b last:border-0", clickable && "cursor-pointer", preview?.file.path === file.path && "bg-muted")}>
                    <td className="p-2 pl-4 font-mono text-xs break-all min-w-40">{file.path}</td>
                    <td className="p-2">{file.recorded?.role ? <Tag>{file.recorded.role}</Tag> : "—"}</td>
                    <td className="p-2">{file.recorded?.determinism ? <Tag>{file.recorded.determinism}</Tag> : "—"}</td>
                    <td className="p-2">{file.recorded?.provenance ? <Status word={file.recorded.provenance} toneOverride={file.recorded.provenance === "collector" ? "good" : "neutral"} /> : "—"}</td>
                    <td className="p-2 text-right font-mono text-xs whitespace-nowrap">{bytes(file.bytes)}</td>
                    <td className="p-2"><Sha value={file.recorded?.sha256} /></td>
                    <td className="p-2"><Sha value={file.sha256} /></td>
                    <td className="p-2 pr-4"><FileState file={file} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {preview ? (
        <Panel title={<span className="font-mono text-sm">{preview.file.path}</span>} action={<Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noopener"><ExternalLinkIcon />{t("open_raw")}</a></Button>}>
          {/\.(png|jpe?g)$/i.test(preview.file.path) ? <img src={url} alt={preview.file.path} className="mx-auto max-h-[36rem] rounded-md border bg-white" />
            : preview.text === undefined ? <p className="text-muted-foreground text-sm">{t("too_large")}</p>
              : preview.file.path.endsWith(".md") ? <Markdown source={preview.text} /> : <Pre>{preview.text}</Pre>}
        </Panel>
      ) : null}
      {figures.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {figures.map((f: any) => (
            <Card key={f.path} className="gap-3 py-4">
              <CardContent className="px-4"><img src={api.fileUrl(run.summary.id, f.path)} alt={f.path} loading="lazy" className="w-full rounded-md border bg-white" /></CardContent>
              <div className="text-muted-foreground flex items-center gap-2 px-4 font-mono text-xs"><ImageIcon className="size-3.5" />{f.path}</div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ runtime

export function EventList({ events }: { events: any[] }) {
  return (
    <ol className="relative grid gap-0 border-l pl-5">
      {events.map((e, i) => {
        const { ts, type, source, seq: _seq, ...rest } = e;
        return (
          <li key={i} className="relative pb-4 last:pb-0">
            <span className={cn("ring-background absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4", source === "collector" ? "bg-success" : source === "runtime" ? "bg-primary" : "bg-muted-foreground")} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs tabular-nums" title={ts ?? ""}>{/T(\d\d:\d\d:\d\d(?:\.\d+)?)/.exec(ts ?? "")?.[1] ?? ts ?? ""}</span>
              <Tag>{source ?? "unknown"}</Tag>
              <code className="text-sm font-medium">{type ?? ""}</code>
            </div>
            {Object.keys(rest).length > 0 ? <div className="text-muted-foreground mt-1 font-mono text-xs break-all min-w-40">{JSON.stringify(rest)}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The runtime's recorded phases on one time axis. Durations are the runtime's own measurements. */
function PhaseChart({ phases }: { phases: any[] }) {
  const starts = phases.map((p) => Date.parse(p.started_at)).filter((n) => !Number.isNaN(n));
  const origin = Math.min(...starts);
  const data = phases.map((p) => {
    const start = Date.parse(p.started_at);
    const offset = Number.isNaN(start) ? 0 : (start - origin) / 1000;
    return { name: p.name, label: `${p.name} · ${p.status}`, offset, seconds: p.seconds ?? 0, status: p.status };
  });
  const total = Math.max(...data.map((d) => d.offset + d.seconds), 0);
  return (
    <Panel title={t("phase_timeline")} description={`${num(total)} s · ${t("phase_timeline_sub")}`}>
      <ChartBox className="w-full" >
        <div style={{ height: Math.max(120, data.length * 34 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} domain={[0, "dataMax"]} tickFormatter={(v) => `${num(Math.round(v * 10) / 10)} s`} />
              <YAxis type="category" dataKey="name" width={88} tickLine={false} axisLine={false} className="font-mono" />
              <Tooltip cursor={{ fill: "var(--muted)" }} content={({ active, payload }: any) => active && payload?.length ? <ChartTip active payload={[{ ...payload[payload.length - 1], name: payload[payload.length - 1].payload.label, color: "var(--chart-2)" }]} format={(v: number) => `${num(v)} s`} /> : null} />
              <Bar dataKey="offset" stackId="a" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="seconds" stackId="a" radius={4} isAnimationActive={false} minPointSize={3}>
                {data.map((d) => <Cell key={d.name} fill={d.status === "ok" ? "var(--chart-2)" : "var(--destructive)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartBox>
    </Panel>
  );
}

function Raw({ title, value }: { title: string; value: unknown }) {
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-2 px-4 py-2.5 text-left font-mono text-sm"><FileTextIcon className="text-muted-foreground size-4" />{title}</CollapsibleTrigger>
      <CollapsibleContent className="border-t p-3"><Json value={value} /></CollapsibleContent>
    </Collapsible>
  );
}

function RuntimeTab({ run }: { run: any }) {
  const { runtime, events } = run;
  if (!runtime.run && !runtime.plan && !events.available) return <NotAvailable what={t("runtime_records")} why={t("runtime_records_missing")} />;
  const r = runtime.run;
  const plan = runtime.plan;
  return (
    <div className="flex flex-col gap-4">
      {r ? (
        <Panel title={t("runtime_summary")}>
          <Kv rows={[
            [t("lifecycle_status"), <span className="flex flex-wrap items-center gap-2"><Status word={r.status ?? "unknown"} />{r.status_detail ? <span className="text-muted-foreground">{r.status_detail}</span> : null}</span>],
            [t("task"), r.task ? <span><Code>{r.task.id}</Code> {r.task.title ?? ""}</span> : "—"],
            [t("backend"), r.backend ? <span className="flex flex-wrap items-center gap-2"><Code>{r.backend.name}</Code><Tag>{r.backend.kind}</Tag>{r.backend.outcome ? <><Status word={r.backend.outcome} /><span className="text-muted-foreground font-mono text-xs">{num(r.backend.seconds)} s</span></> : null}</span> : "—"],
            [t("contract"), r.contract ? <span className="flex flex-wrap items-center gap-2"><Code>{`${r.contract.id} ${r.contract.version}`}</Code><Sha value={r.contract.sha256} /></span> : "—"],
            [t("backend_self_report"), r.backend?.self_report && Object.keys(r.backend.self_report).length > 0 ? (
              <div className="grid gap-1.5">
                <div className="flex flex-wrap gap-1.5"><Tag>backend</Tag>{Object.entries<any>(r.backend.self_report).map(([k, v]) => <Tag key={k} mono>{k}: {v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v)}</Tag>)}</div>
                <div className="text-muted-foreground text-xs">{t("self_report_hint")}</div>
              </div>
            ) : "—"],
            [t("created"), <When iso={r.created_at} />], [t("finished"), <When iso={r.finished_at} />],
          ]} />
        </Panel>
      ) : null}
      {Array.isArray(r?.phases) && r.phases.length > 0 ? <PhaseChart phases={r.phases} /> : null}

      {plan ? (
        <Panel title={t("compiled_plan")}>
          <div className="grid gap-4">
            {plan.predicted ? <Notice title={t("predicted")}><span className="flex flex-wrap items-center gap-2"><Status word={plan.predicted.best_verdict ?? "unknown"} />{(plan.predicted.blocking_unavailable ?? []).length > 0 ? `${t("blocking_unavailable")}: ${plan.predicted.blocking_unavailable.join(", ")}` : ""}</span></Notice> : null}
            {(plan.warnings ?? []).length > 0 ? <Notice kind="warn" title={t("plan_warnings")}><ul className="list-disc pl-4">{plan.warnings.map((w: any, i: number) => <li key={i}>{typeof w === "string" ? w : JSON.stringify(w)}</li>)}</ul></Notice> : null}
            {(plan.predicted?.known_failures ?? []).length > 0 ? <Notice kind="bad" title={t("known_failures")}><ul className="list-disc pl-4">{plan.predicted.known_failures.map((w: any, i: number) => <li key={i}>{typeof w === "string" ? w : JSON.stringify(w)}</li>)}</ul></Notice> : null}
            {plan.applicability ? <Kv rows={[
              [t("required_capabilities"), <span className="flex flex-wrap gap-1.5">{(plan.applicability.required ?? []).map((c: string) => <Tag key={c} mono>{c}</Tag>)}</span>],
              [t("provided_by"), <Code>{JSON.stringify(plan.applicability.provided ?? {})}</Code>],
              [t("missing_capabilities"), (plan.applicability.missing ?? []).length === 0 ? "—" : <span className="flex flex-wrap gap-1.5">{plan.applicability.missing.map((c: string) => <Status key={c} word={c} toneOverride="bad" />)}</span>],
            ]} /> : null}
            {Array.isArray(plan.requirements) ? <SimpleTable head={["id", t("requirement"), t("supplied_by"), t("producer_obligations"), t("validator")]} rows={plan.requirements.map((q: any) => [
              <Code>{q.id}</Code>, q.title, <Tag>{q.supplied_by ?? "unknown"}</Tag>,
              <div className="grid gap-1 text-xs">{(q.producer_obligations ?? []).map((o: string, i: number) => <div key={i}>{o}</div>)}</div>,
              q.validator ? <span className="inline-flex items-center gap-1"><Status word={q.validator.available ? "available" : "not_available"} /><span className="text-muted-foreground text-xs">#{q.validator.order ?? ""}</span></span> : "—",
            ])} /> : null}
            {plan.instructions ? <Collapsible className="rounded-lg border"><CollapsibleTrigger className="hover:bg-muted/50 w-full px-4 py-2.5 text-left text-sm">{t("instructions_sent")}</CollapsibleTrigger><CollapsibleContent className="border-t p-3"><Pre className="whitespace-pre-wrap">{plan.instructions}</Pre></CollapsibleContent></Collapsible> : null}
            <Raw title="tenric/plan.json" value={plan} />
          </div>
        </Panel>
      ) : null}

      {runtime.verification ? (
        <Panel title={t("recorded_verdict")}>
          <div className="grid gap-4">
            <Notice title={t("recorded_verdict_title")}>{t("recorded_verdict_body")}</Notice>
            <Kv rows={[
              [t("verdict"), runtime.verification.verdict ? <Status word={runtime.verification.verdict} /> : "—"],
              [t("statement"), <span className="text-sm">{runtime.verification.statement ?? "—"}</span>],
              [t("issued_at"), <When iso={runtime.verification.issued_at} />],
              [t("artifact_digest"), <Sha value={runtime.verification.artifact?.sha256} full />],
              [t("reproduction"), runtime.verification.reproduction?.requested ? t("reproduction_requested") : t("reproduction_not_requested")],
            ]} />
            <Raw title="tenric/verification.json" value={runtime.verification} />
          </div>
        </Panel>
      ) : null}

      {runtime.reexecution ? (
        <Panel title={t("reexecution_record")}>
          <div className="grid gap-4">
            {Array.isArray(runtime.reexecution.outputs) ? <SimpleTable head={[t("file"), t("determinism"), "first sha256", "second sha256", ""]} rows={runtime.reexecution.outputs.map((o: any) => [
              <span className="font-mono text-xs">{o.path}</span>, o.determinism ? <Tag>{o.determinism}</Tag> : "—", <Sha value={o.first_sha256} />, <Sha value={o.second_sha256} />,
              <Status word={o.identical ? "identical" : "differs"} toneOverride={o.identical ? "good" : o.determinism === "volatile" ? "neutral" : "bad"} />,
            ])} /> : null}
            {Array.isArray(runtime.reexecution.metrics) ? <SimpleTable align={[undefined, "right", "right", "right"]} head={[t("metric"), "first", "second", "|Δ|"]} rows={runtime.reexecution.metrics.map((m: any) => [
              <Code>{m.name}</Code>, <span className="font-mono">{num(m.first)}</span>, <span className="font-mono">{num(m.second)}</span>, <span className="font-mono">{num(m.abs_diff)}</span>,
            ])} /> : null}
          </div>
        </Panel>
      ) : null}

      {Array.isArray(r?.review_notes) && r.review_notes.length > 0 ? <Panel title={t("review_notes")}><ul className="list-disc space-y-1 pl-5 text-sm">{r.review_notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Panel> : null}

      <Panel title={t("event_log")} description={events.available ? t("event_log_hint") : undefined}>
        {events.available ? (
          <div className="grid gap-4">
            {events.malformed > 0 ? <Notice kind="warn" title={t("malformed_events")}>{String(events.malformed)}</Notice> : null}
            <EventList events={events.events} />
          </div>
        ) : <NotAvailable what={t("event_log")} why={t("event_log_missing")} />}
      </Panel>
    </div>
  );
}

// --------------------------------------------------------------------- page

function Fact({ label, children, sub, className }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-2 py-4", className)}>
      <CardContent className="grid gap-1.5 px-4">
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
        <div className="flex min-h-6 flex-wrap items-center gap-2">{children}</div>
        {sub ? <div className="text-muted-foreground text-xs break-words">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function TrustFact({ run, outcome, onOpen }: { run: any; outcome: any; onOpen: () => void }) {
  const trust = run.trust ?? {};
  const col = outcome?.issued ? outcome.record.collector : undefined;
  const isolation = trust.isolation
    ? <Status word={isolationEnforced(trust.isolation) ? "enforced" : "not enforced"} />
    : <NotAvailableBadge text={t("not_recorded")} />;
  const attestation = col ? <Status word={col.attested ? "attested" : "not attested"} /> : trust.attestation ? <Status word="signed" /> : <NotAvailableBadge text={t("unsigned")} />;
  return (
    <Fact className="col-span-2 xl:col-span-1" label={<button type="button" onClick={onOpen} className="hover:text-foreground underline-offset-4 hover:underline">{t("tb_title")}</button>}>
      <div className="grid w-full gap-1.5 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{t("tb_isolation")}</span>{isolation}</div>
        <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{t("tb_attestation")}</span>{attestation}</div>
      </div>
    </Fact>
  );
}

const TABS = ["verdict", "evidence", "outputs", "report", "runtime", "raw"];

export function RunDetail({ args: [id, initialTab] }: { args: (string | undefined)[] }) {
  const state = useLoad(() => Promise.all([api.run(id), api.verify(id)]), [id]);
  const [outcome, setOutcome] = React.useState<any>(null);
  const [tab, setTab] = React.useState(TABS.includes(initialTab ?? "") ? initialTab! : "verdict");
  useCrumbs([id!]);
  const changeTab = (next: string) => { setTab(next); history.replaceState(null, "", `#/runs/${enc(id!)}/${next}`); };

  return (
    <Loaded state={state}>
      {([run, first]: any) => {
        const current = outcome ?? first;
        const s = run.summary;
        const failure = run.artifact?.failure;
        const reverify = async (body: any) => {
          try { setOutcome(await api.reverify(id, body)); } catch (error: any) { setOutcome({ issued: false, no_verdict: `${t("verifier_fault")}: ${error.message}` }); }
        };
        const openTrust = () => { changeTab("verdict"); requestAnimationFrame(() => document.getElementById("tb")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
        return (
          <>
            <PageHeader
              title={s.title ?? id}
              description={<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><Code>{s.path}</Code>{s.experiment_id ? <span>{t("experiment")} <Code>{s.experiment_id}</Code></span> : null}{s.runtime ? <span>{t("backend")} <Code>{s.runtime.backend ?? "?"}</Code> · {t("task")} <Code>{s.runtime.task ?? "?"}</Code></span> : null}</span>}
              actions={<Button variant="outline" asChild><a href={`#/compare?a=${enc(id!)}`}><GitCompareArrowsIcon />{t("compare_with_another")}</a></Button>}
            />
            {s.origin === "fixture" ? <Notice kind="warn" title={t("fixture_title")}>{t("fixture_body")}</Notice>
              : s.data_class === "fixture" ? <Notice kind="warn" title={t("fixture_run_title")}>{t("fixture_run_body")}</Notice> : null}
            {s.readable ? null : <Notice kind="bad" title={t("artifact_unreadable")}>{s.error}</Notice>}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              <Fact label={t("verdict")} sub={current.issued ? `${current.record.summary.passed} / ${current.record.summary.mandatory} ${t("mandatory_passed_l")} · ${current.record.contract.version}` : "—"}>
                {current.issued ? <Status word={current.record.verdict} className="text-sm" /> : <NoVerdict />}
              </Fact>
              <Fact label={t("execution")} sub={<>{num(s.runtime_seconds)} s · <When iso={s.started_at} /></>}>
                {s.status ? <Status word={s.status} /> : "—"}{s.exit_code !== undefined ? <span className="text-muted-foreground font-mono text-xs">exit {s.exit_code}</span> : null}
              </Fact>
              <Fact label={t("source_revision")} sub={s.runtime ? `${t("lifecycle_status")} ${s.runtime.status ?? "unknown"}` : s.source?.kind ?? "—"}><Revision source={s.source} /></Fact>
              <Fact label={t("data_class")} sub={<span className="inline-flex flex-wrap items-center gap-1">artifact <Sha value={s.artifact_sha256} /></span>}><DataClass value={s.data_class} /></Fact>
              <TrustFact run={run} outcome={current} onOpen={openTrust} />
            </div>
            {failure ? <Notice kind="bad" title={`${t("failure_record")}: ${failure.reason}`}>{failure.stderr_tail ? <Pre className="mt-1 w-full whitespace-pre-wrap">{failure.stderr_tail}</Pre> : null}</Notice> : null}
            {(s.metrics ?? []).length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {s.metrics.map((m: any) => (
                  <div key={m.name} className="rounded-lg border px-4 py-3">
                    <div className="text-lg font-semibold tabular-nums">{num(m.value)}</div>
                    <div className="text-muted-foreground truncate font-mono text-xs" title={m.name}>{m.name}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <Tabs value={tab} onValueChange={changeTab} className="gap-4">
              <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
                <TabsList>
                  <TabsTrigger value="verdict">{t("tab_verdict")}</TabsTrigger>
                  <TabsTrigger value="evidence">{t("tab_evidence")}</TabsTrigger>
                  <TabsTrigger value="outputs">{t("tab_outputs")} <span className="text-muted-foreground tabular-nums">{run.files.length}</span></TabsTrigger>
                  <TabsTrigger value="report">{t("tab_report")}</TabsTrigger>
                  <TabsTrigger value="runtime">{t("tab_runtime")}</TabsTrigger>
                  <TabsTrigger value="raw" className="font-mono">artifact.json</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="verdict"><VerdictTab run={run} outcome={current} reverify={reverify} /></TabsContent>
              <TabsContent value="evidence"><EvidenceTab run={run} outcome={current} /></TabsContent>
              <TabsContent value="outputs"><OutputsTab run={run} /></TabsContent>
              <TabsContent value="report">
                {run.report === null ? <Empty icon={FileTextIcon} title={t("no_report")} body={t("no_report_body")} /> : (
                  <Panel description={t("report_hint")}><Markdown source={run.report} /></Panel>
                )}
              </TabsContent>
              <TabsContent value="runtime"><RuntimeTab run={run} /></TabsContent>
              <TabsContent value="raw"><Json value={run.artifact_text} /></TabsContent>
            </Tabs>
          </>
        );
      }}
    </Loaded>
  );
}
