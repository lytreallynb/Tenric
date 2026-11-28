import * as React from "react";
import { ArrowRightIcon, ArrowUpRightIcon, PlusIcon, ShieldCheckIcon, PenLineIcon, ChevronRightIcon } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Meta } from "@/components/app/data-table";
import { Empty, Notice, PageHeader, Sha, Status, VerdictOf, When } from "@/components/app/bits";
import { ChartBox, ChartTip, VERDICT_COLOR } from "@/components/app/chart";
import { Fingerprint, cellsOfSummary } from "@/components/app/fingerprint";
import { Figure } from "@/components/app/media";
import { Loaded } from "@/components/app/load";
import { api } from "@/lib/api.js";
import { ago, num } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { enc, go } from "@/lib/router";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";

const accuracy = (run: any) => run.metrics?.find((m: any) => m.name === "test_accuracy")?.value;
const runHref = (id: string) => `#/runs/${enc(id)}`;

/** A titled block without a card around it: a rule, a heading, the content. */
function Section({ title, sub, action, children, className }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex items-end justify-between gap-3 border-b pb-2.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {sub ? <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Counts in one ruled strip, with the verdict split drawn underneath as one bar. */
function Ledger({ counts, runs, real, repository }: { counts: any; runs: any[]; real: any[]; repository: any }) {
  const parts = [
    ["accepted", counts.verdicts.accepted], ["rejected", counts.verdicts.rejected], ["inconclusive", counts.verdicts.inconclusive], ["none", counts.no_verdict],
  ] as [string, number][];
  const total = parts.reduce((n, [, v]) => n + v, 0);
  const latest = real.find((r) => typeof accuracy(r) === "number");
  const cells: [React.ReactNode, React.ReactNode, React.ReactNode, string?][] = [
    [t("nav_runs"), counts.runs, `${real.length} ${t("real_runs")} · ${runs.length - real.length} fixture`, "#/runs"],
    ["accepted", counts.verdicts.accepted, t("stat_verdicts"), "#/runs"],
    ["rejected", counts.verdicts.rejected, `${counts.verdicts.inconclusive} inconclusive · ${counts.no_verdict} ${t("no_verdict")}`, "#/runs"],
    [t("nav_contracts"), counts.contracts, t("stat_contracts"), "#/contracts"],
    [<span className="font-mono normal-case">test_accuracy</span>, latest ? num(accuracy(latest)) : "—", latest ? <a className="hover:text-foreground font-mono" href={runHref(latest.id)}>{latest.id}</a> : "—"],
  ];
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="stagger grid grid-cols-2 divide-y sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {cells.map(([label, value, sub, href], i) => {
          const body = (
            <div className={cn("flex h-full flex-col gap-1 px-4 py-3.5", href && "hover:bg-muted/40 transition-colors")}>
              <div className="eyebrow flex items-center gap-1.5">
                {typeof label === "string" && VERDICT_COLOR[label] ? <span className="size-1.5 rounded-full" style={{ background: VERDICT_COLOR[label] }} /> : null}
                <span className={cn(typeof label === "string" && VERDICT_COLOR[label] && "normal-case tracking-normal")}>{label}</span>
              </div>
              <div className="figure-num text-[28px] leading-none">{value}</div>
              <div className="text-muted-foreground truncate text-xs">{sub}</div>
            </div>
          );
          return <div key={i} style={{ "--i": i } as React.CSSProperties} className="min-w-0 max-sm:[&:nth-child(odd)]:border-r sm:[&:not(:first-child)]:border-l lg:border-l-0">{href ? <a href={href} className="block h-full">{body}</a> : body}</div>;
        })}
      </div>
      <div className="bg-muted/30 border-t px-4 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t("verdicts_strip")}</span>
          <span className="text-muted-foreground flex flex-wrap gap-3">
            {parts.map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: VERDICT_COLOR[k] }} />{k === "none" ? t("no_verdict") : k}<span className="text-foreground font-mono">{v}</span></span>)}
          </span>
        </div>
        <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
          {total > 0 ? parts.filter(([, v]) => v > 0).map(([k, v], i) => <div key={k} className="grow-x h-full" style={{ width: `${(v / total) * 100}%`, background: VERDICT_COLOR[k], "--i": i } as React.CSSProperties} />) : null}
        </div>
      </div>
    </div>
  );
}

/** The newest real run, shown with its own figure, its requirement cells and its numbers. */
function LatestRun({ run }: { run: any }) {
  if (!run) return <Empty compact body={t("latest_run_none")} action={<Button asChild size="sm"><a href="#/new"><PlusIcon />{t("nav_new")}</a></Button>} />;
  const cells = cellsOfSummary(run);
  const blockers = cells.filter((c) => c.level === "mandatory" && c.status !== "pass");
  const figure = run.figures?.[0];
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className={cn("grid", figure && "md:grid-cols-[minmax(0,15rem)_1fr]")}>
        {figure ? (
          <div className="bg-muted/30 border-b p-4 md:border-r md:border-b-0">
            <Figure run={run.id} path={figure} className="mx-auto max-w-[15rem]" />
            <div className="text-muted-foreground mt-2 truncate text-center font-mono text-[11px]">{figure}</div>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">{t("latest_run")} · {ago(run.started_at)}</div>
              <a href={runHref(run.id)} className="mt-1 block text-[17px] leading-snug font-semibold hover:underline">{run.title ?? run.id}</a>
              <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs">
                <span>{run.id}</span><span>·</span><span>{run.runtime?.backend ?? "baseline-script"}</span>
                {run.source?.revision ? <><span>·</span><Sha value={run.source.revision} /></> : null}
              </div>
            </div>
            <Button variant="outline" size="sm" asChild><a href={runHref(run.id)}>{t("open_run")}<ArrowUpRightIcon /></a></Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <VerdictOf run={run} />
            {run.verification ? <span className="text-muted-foreground text-xs"><span className="text-foreground figure-num text-sm">{run.verification.passed}</span> / {run.verification.total} {t("mandatory_passed_l")} · {run.verification.contract} {run.verification.version}</span> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="eyebrow">{t("requirements_strip")}</div>
            <Fingerprint cells={cells} size="lg" />
          </div>
          {blockers.length > 0 ? (
            <ul className="divide-y rounded-md border text-[13px]">
              {blockers.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-destructive font-mono text-xs font-medium">{c.id}</span>
                  <Status word={c.status} />
                  <span className="min-w-0 flex-1 truncate" title={c.title}>{c.title}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {(run.metrics ?? []).length > 0 ? (
            <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t pt-4">
              {run.metrics.slice(0, 4).map((m: any) => (
                <div key={m.name} className="min-w-0">
                  <dt className="text-muted-foreground truncate font-mono text-[11px]">{m.name}</dt>
                  <dd className="figure-num text-xl">{num(m.value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** Mandatory requirements that kept runs from acceptance, as ruled rows with a bar for the count. */
function Blockers({ runs }: { runs: any[] }) {
  const tally = new Map<string, { n: number; title?: string }>();
  for (const run of runs) for (const c of cellsOfSummary(run)) {
    if (c.level !== "mandatory" || c.status === "pass") continue;
    const entry = tally.get(c.id) ?? { n: 0, title: c.title };
    entry.n += 1; tally.set(c.id, entry);
  }
  const rows = [...tally].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const max = Math.max(1, ...rows.map(([, v]) => v.n));
  return (
    <Section title={t("top_blockers")} sub={t("top_blockers_sub")}>
      {rows.length === 0 ? <Empty compact body={t("no_blockers")} /> : (
        <ol className="flex flex-col gap-3">
          {rows.map(([id, { n, title }], i) => (
            <li key={id} className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs font-medium">{id}</span>
              <span className="text-muted-foreground truncate text-xs" title={title}>{title}</span>
              <span className="figure-num text-sm">{n}</span>
              <span />
              <div className="bg-muted col-span-2 h-1 overflow-hidden rounded-full">
                <div className="grow-x bg-destructive/80 h-full rounded-full" style={{ width: `${(n / max) * 100}%`, "--i": i } as React.CSSProperties} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** Every real run that lists a figure, as a contact sheet. */
function Gallery({ runs }: { runs: any[] }) {
  const withFigures = runs.filter((r) => (r.figures ?? []).length > 0).slice(0, 8);
  return (
    <Section title={t("produced_figures")} sub={t("produced_figures_sub")} action={<span className="text-muted-foreground text-xs tabular-nums">{withFigures.length} {t("runs_with_figures")}</span>}>
      {withFigures.length === 0 ? <Empty compact body={t("no_figures")} /> : (
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {withFigures.map((r, i) => (
            <div key={r.id} style={{ "--i": i } as React.CSSProperties} className="group/card flex min-w-0 flex-col gap-2">
              <Figure eager run={r.id} path={r.figures[0]} className="aspect-[4/3]" imgClassName="h-full" caption={<VerdictOf run={r} />} />
              <div className="flex min-w-0 flex-col gap-1 px-0.5">
                <div className="flex items-center justify-between gap-2">
                  <a href={runHref(r.id)} className="truncate font-mono text-xs font-medium hover:underline">{r.id}</a>
                  <span className="figure-num text-xs">{num(accuracy(r))}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Fingerprint cells={cellsOfSummary(r)} />
                  <span className="text-muted-foreground text-[11px]">{r.verification?.verdict ?? t("no_verdict")}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function AccuracyTrend({ runs }: { runs: any[] }) {
  const data = runs.filter((r) => typeof accuracy(r) === "number" && r.started_at).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    .map((r) => ({ id: r.id, label: r.id, value: accuracy(r), fill: VERDICT_COLOR[r.verification?.verdict ?? "none"] }));
  return (
    <Section title={<span className="font-mono">test_accuracy</span>} sub={t("accuracy_sub")}>
        {data.length === 0 ? <Empty compact body={t("no_metrics")} /> : (
          <ChartBox className="h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="fillAcc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="id" tick={false} tickLine={false} axisLine={false} height={8} />
                <YAxis domain={["auto", "auto"]} width={48} tickLine={false} axisLine={false} tickFormatter={(v) => num(v)} />
                <Tooltip content={<ChartTip format={num} />} />
                <Area dataKey="value" name="test_accuracy" type="linear" stroke="var(--chart-2)" fill="url(#fillAcc)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-2)" }} isAnimationActive animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartBox>
        )}
    </Section>
  );
}

const STATE_DOT: Record<string, string> = { available: "bg-success", partial: "bg-warning", not_available: "bg-muted-foreground/40" };
function Pipeline({ components }: { components: any[] }) {
  const state = Object.fromEntries(components.map((c) => [c.id, c]));
  const node = (id: string) => (
    <div key={id} title={state[id]?.evidence ?? ""} className={cn("bg-card flex min-w-0 flex-1 flex-col gap-1 rounded-lg border p-3 shadow-xs", (state[id]?.state ?? "not_available") === "not_available" && "border-dashed bg-transparent shadow-none")}>
      <div className="text-sm font-medium leading-tight">{t(`component_${id}`)}</div>
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs"><span className={cn("size-1.5 rounded-full", STATE_DOT[state[id]?.state ?? "not_available"])} />{state[id]?.state ?? "not_available"}</div>
    </div>
  );
  const row = (ids: string[]) => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      {ids.map((id, i) => <React.Fragment key={id}>{i > 0 ? <ChevronRightIcon className="text-muted-foreground hidden size-4 shrink-0 self-center sm:block" /> : null}{node(id)}</React.Fragment>)}
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_auto_4fr]">
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"><PenLineIcon className="size-3.5" />{t("zone_producer")}</div>
        {row(["contract-spec", "compiler", "agent-backends"])}
      </div>
      <div className="flex items-center gap-2 lg:flex-col">
        <div className="bg-border h-px flex-1 lg:h-auto lg:w-px" />
        <Badge variant="outline" className="text-muted-foreground font-normal">{t("trust_boundary")}</Badge>
        <div className="bg-border h-px flex-1 lg:h-auto lg:w-px" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"><ShieldCheckIcon className="size-3.5" />{t("zone_verifier")}</div>
        {row(["collector", "artifact-ir", "verifier", "verdict-binding"])}
      </div>
    </div>
  );
}

export function recentColumns(): any[] {
  return [
    {
      accessorKey: "id", header: t("run"),
      cell: ({ row }: any) => (
        <div className="flex min-w-0 items-center gap-3">
          {row.original.figures?.[0] ? <Figure size="xs" run={row.original.id} path={row.original.figures[0]} /> : <div className="bg-muted/50 size-9 shrink-0 rounded-[5px] border border-dashed" />}
          <div className="min-w-0">
            <a href={runHref(row.original.id)} className="block truncate font-mono text-[12.5px] font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.id}</a>
            <div className="text-muted-foreground max-w-[22rem] truncate text-xs">{row.original.title ?? "—"}</div>
          </div>
        </div>
      ),
    },
    { id: "verdict", header: t("verdict"), cell: ({ row }: any) => <VerdictOf run={row.original} /> },
    { id: "cells", header: t("requirements"), meta: { hideOnMobile: true } as Meta, cell: ({ row }: any) => <Fingerprint cells={cellsOfSummary(row.original)} animate={false} /> },
    { id: "backend", header: t("backend"), meta: { hideOnMobile: true } as Meta, cell: ({ row }: any) => <span className="text-muted-foreground font-mono text-xs">{row.original.runtime?.backend ?? "baseline-script"}</span> },
    { id: "started", header: t("started"), cell: ({ row }: any) => <span className="text-muted-foreground text-xs"><When iso={row.original.started_at} short /></span> },
    { id: "acc", header: "test_accuracy", meta: { align: "right", hideOnMobile: true } as Meta, cell: ({ row }: any) => <span className="figure-num">{num(accuracy(row.original))}</span> },
  ];
}

export function Overview() {
  const state = useLoad(() => Promise.all([api.system(), api.runs()]), []);
  return (
    <Loaded state={state}>
      {([system, runs]: any) => {
        const { counts, repository } = system;
        const real = runs.filter((r: any) => r.origin === "run");
        return (
          <>
            <PageHeader
              eyebrow={<span className="inline-flex items-center gap-1.5">{t("checkout")} <span className="font-mono normal-case">{repository.revision?.slice(0, 10) ?? "—"}</span>{repository.dirty ? <span className="text-warning normal-case">· dirty</span> : null}</span>}
              title={t("overview_title")} description={t("overview_sub")}
              actions={<Button asChild><a href="#/new"><PlusIcon />{t("nav_new")}</a></Button>}
            />
            {repository.dirty ? <Notice kind="warn" title={t("dirty_title")}>{t("dirty_body")}</Notice> : null}
            <Ledger counts={counts} runs={runs} real={real} repository={repository} />
            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <LatestRun run={real[0]} />
              <div className="flex flex-col gap-8">
                <Blockers runs={real} />
                <AccuracyTrend runs={real} />
              </div>
            </div>
            <Gallery runs={real} />
            <Section title={t("recent_runs")} sub={t("list_without_reexecution")} action={<Button variant="ghost" size="sm" asChild><a href="#/runs">{t("view_all")}<ArrowRightIcon /></a></Button>}>
              <DataTable columns={recentColumns()} data={real.slice(0, 8)} onRowClick={(r: any) => go(runHref(r.id))}
                empty={<Empty title={t("empty_runs_title")} body={t("no_runs")} action={<Button asChild><a href="#/new"><PlusIcon />{t("nav_new")}</a></Button>} />} />
            </Section>
            <Section title={t("architecture")} sub={<>{t("architecture_hint")} <a className="underline underline-offset-4" href="#/system">{t("nav_system")}</a>.</>}>
              <Pipeline components={system.components} />
            </Section>
          </>
        );
      }}
    </Loaded>
  );
}
