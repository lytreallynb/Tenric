import * as React from "react";
import { ArrowRightIcon, PlayIcon, ShieldCheckIcon, PenLineIcon, ChevronRightIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Meta } from "@/components/app/data-table";
import { DataClass, Empty, Notice, PageHeader, Revision, Status, VerdictOf, When, Sha } from "@/components/app/bits";
import { ChartBox, ChartTip, VERDICT_COLOR } from "@/components/app/chart";
import { Loaded } from "@/components/app/load";
import { api } from "@/lib/api.js";
import { num } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { enc, go } from "@/lib/router";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";

const accuracy = (run: any) => run.metrics?.find((m: any) => m.name === "test_accuracy")?.value;

function StatCard({ label, value, badge, foot, sub, href }: { label: string; value: React.ReactNode; badge?: React.ReactNode; foot: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const card = (
    <Card className="@container/card h-full gap-3 bg-gradient-to-t from-primary/5 to-card shadow-xs transition-colors hover:border-foreground/20 dark:bg-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {badge ? <CardAction>{badge}</CardAction> : null}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">{foot}</div>
        {sub ? <div className="text-muted-foreground">{sub}</div> : null}
      </CardFooter>
    </Card>
  );
  return href ? <a href={href} className="block">{card}</a> : card;
}

function VerdictDonut({ counts }: { counts: any }) {
  const data = [
    { key: "accepted", label: "accepted", value: counts.verdicts.accepted },
    { key: "rejected", label: "rejected", value: counts.verdicts.rejected },
    { key: "inconclusive", label: "inconclusive", value: counts.verdicts.inconclusive },
    { key: "none", label: t("no_verdict"), value: counts.no_verdict },
  ].map((d) => ({ ...d, fill: VERDICT_COLOR[d.key] }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{t("verdict_distribution")}</CardTitle>
        <CardDescription>{t("stat_verdicts")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center gap-4">
        {total === 0 ? <Empty compact body={t("empty_runs_title")} /> : (
          <ChartBox className="aspect-square w-full max-w-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip cursor={false} content={<ChartTip />} />
                <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="label" innerRadius="62%" strokeWidth={4} stroke="var(--card)" isAnimationActive={false}>
                  {data.filter((d) => d.value > 0).map((d) => <Cell key={d.key} fill={d.fill} />)}
                  <Label content={({ viewBox }: any) => (viewBox && "cx" in viewBox ? (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">{total}</tspan>
                      <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 22} className="fill-muted-foreground text-xs">{t("nav_runs")}</tspan>
                    </text>
                  ) : null)} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartBox>
        )}
        <div className="grid w-full grid-cols-2 gap-2 text-sm">
          {data.map((d) => (
            <div key={d.key} className="flex items-center gap-2">
              <span className="size-2.5 rounded-[2px]" style={{ background: d.fill }} />
              <span className="text-muted-foreground flex-1 truncate">{d.label}</span>
              <span className="font-mono tabular-nums">{d.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Blockers({ runs }: { runs: any[] }) {
  const tally = new Map<string, number>();
  for (const run of runs) for (const id of run.verification?.blocking ?? []) tally.set(id, (tally.get(id) ?? 0) + 1);
  const data = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n, fill: "var(--chart-1)" }));
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{t("top_blockers")}</CardTitle>
        <CardDescription>{t("top_blockers_sub")}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? <Empty compact body={t("no_blockers")} /> : (
          <ChartBox className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="id" width={56} tickLine={false} axisLine={false} className="font-mono" />
                <Tooltip cursor={{ fill: "var(--muted)" }} content={<ChartTip />} />
                <Bar dataKey="n" name={t("nav_runs")} radius={4} barSize={22} fill="var(--chart-1)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        )}
      </CardContent>
    </Card>
  );
}

function AccuracyTrend({ runs }: { runs: any[] }) {
  const data = runs.filter((r) => typeof accuracy(r) === "number" && r.started_at).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    .map((r) => ({ id: r.id, label: r.id, value: accuracy(r), fill: VERDICT_COLOR[r.verification?.verdict ?? "none"] }));
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>test_accuracy</CardTitle>
        <CardDescription>{t("accuracy_sub")}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? <Empty compact body={t("no_metrics")} /> : (
          <ChartBox className="h-[220px] w-full">
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
                <Area dataKey="value" name="test_accuracy" type="linear" stroke="var(--chart-2)" fill="url(#fillAcc)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-2)" }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartBox>
        )}
      </CardContent>
    </Card>
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
    { accessorKey: "id", header: t("run"), cell: ({ row }: any) => <a href={`#/runs/${enc(row.original.id)}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.id}</a> },
    { id: "verdict", header: t("verdict"), cell: ({ row }: any) => <VerdictOf run={row.original} /> },
    { id: "passed", header: t("mandatory_passed"), cell: ({ row }: any) => row.original.verification ? <span className="font-mono text-xs">{row.original.verification.passed} / {row.original.verification.total} <span className="text-muted-foreground">· {row.original.verification.version}</span></span> : "—" },
    { id: "status", header: t("execution"), meta: { hideOnMobile: true } as Meta, cell: ({ row }: any) => row.original.status ? <Status word={row.original.status} /> : "—" },
    { id: "data_class", header: t("data_class"), meta: { hideOnMobile: true } as Meta, cell: ({ row }: any) => <DataClass value={row.original.data_class} /> },
    { id: "started", header: t("started"), cell: ({ row }: any) => <span className="text-muted-foreground"><When iso={row.original.started_at} short /></span> },
    { id: "revision", header: t("revision"), meta: { hideOnMobile: true } as Meta, cell: ({ row }: any) => <Revision source={row.original.source} /> },
    { id: "acc", header: "test_accuracy", meta: { align: "right", hideOnMobile: true } as Meta, cell: ({ row }: any) => <span className="font-mono">{num(accuracy(row.original))}</span> },
  ];
}

export function Overview() {
  const state = useLoad(() => Promise.all([api.system(), api.runs()]), []);
  return (
    <Loaded state={state}>
      {([system, runs]: any) => {
        const { counts, repository } = system;
        const real = runs.filter((r: any) => r.origin === "run");
        const notAccepted = counts.verdicts.rejected + counts.verdicts.inconclusive;
        return (
          <>
            <PageHeader title={t("overview_title")} description={t("overview_sub")} actions={<Button asChild><a href="#/new"><PlayIcon />{t("nav_new")}</a></Button>} />
            {repository.dirty ? <Notice kind="warn" title={t("dirty_title")}>{t("dirty_body")}</Notice> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard href="#/runs" label={t("nav_runs")} value={counts.runs} foot={t("stat_runs")} sub={`${real.length} ${t("real_runs")} · ${runs.length - real.length} fixture`} />
              <StatCard href="#/runs" label={t("stat_accepted")} value={counts.verdicts.accepted} badge={<Status word="accepted" />} foot={t("stat_verdicts")} sub={undefined} />
              <StatCard href="#/runs" label={t("not_accepted")} value={notAccepted} badge={<Status word="rejected" />} foot={`${counts.verdicts.rejected} rejected · ${counts.verdicts.inconclusive} inconclusive`} sub={t("stat_not_accepted")} />
              <StatCard href="#/contracts" label={t("nav_contracts")} value={counts.contracts} foot={t("stat_contracts")} sub={<span className="inline-flex items-center gap-1">{t("revision")} <Sha value={repository.revision} /></span>} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <VerdictDonut counts={counts} />
              <Blockers runs={real} />
              <AccuracyTrend runs={real} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{t("architecture")}</CardTitle>
                <CardDescription>{t("architecture_hint")} <a className="underline underline-offset-4" href="#/system">{t("nav_system")}</a>.</CardDescription>
              </CardHeader>
              <CardContent><Pipeline components={system.components} /></CardContent>
            </Card>
            <div className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">{t("recent_runs")}</h2>
                  <p className="text-muted-foreground text-sm">{t("list_without_reexecution")}</p>
                </div>
                <Button variant="ghost" size="sm" asChild><a href="#/runs">{t("view_all")}<ArrowRightIcon /></a></Button>
              </div>
              <DataTable columns={recentColumns()} data={real.slice(0, 8)} onRowClick={(r: any) => go(`#/runs/${enc(r.id)}`)}
                empty={<Empty title={t("empty_runs_title")} body={t("no_runs")} action={<Button asChild><a href="#/new"><PlayIcon />{t("nav_new")}</a></Button>} />} />
            </div>
          </>
        );
      }}
    </Loaded>
  );
}
