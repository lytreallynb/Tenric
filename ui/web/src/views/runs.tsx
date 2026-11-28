import * as React from "react";
import { GitCompareArrowsIcon, PlayIcon, SearchIcon, SearchXIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable, SortHeader, type Meta } from "@/components/app/data-table";
import { Empty, Notice, PageHeader, Status, VerdictOf, When } from "@/components/app/bits";
import { Loaded } from "@/components/app/load";
import { Fingerprint, cellsOfSummary } from "@/components/app/fingerprint";
import { Figure } from "@/components/app/media";
import { api } from "@/lib/api.js";
import { num } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { enc, go } from "@/lib/router";
import { t } from "@/lib/strings.js";

const verdictOf = (run: any) => run.verification?.verdict ?? "none";
const accuracy = (run: any) => run.metrics?.find((m: any) => m.name === "test_accuracy")?.value;

function columns(selected: Record<string, boolean>): any[] {
  const full = Object.values(selected).filter(Boolean).length >= 2;
  return [
    {
      id: "select", enableSorting: false,
      header: () => <span className="sr-only">{t("compare")}</span>,
      cell: ({ row }: any) => (
        <div onClick={(e) => e.stopPropagation()} className="flex items-center">
          <Checkbox checked={row.getIsSelected()} disabled={!row.getIsSelected() && full} onCheckedChange={(v) => row.toggleSelected(!!v)} aria-label={`${t("compare")} ${row.original.id}`} />
        </div>
      ),
    },
    {
      accessorKey: "id", header: ({ column }: any) => <SortHeader column={column}>{t("run")}</SortHeader>, meta: { label: t("run") } as Meta,
      cell: ({ row }: any) => (
        <div className="flex min-w-0 items-center gap-3">
          {row.original.figures?.[0] ? <Figure size="xs" run={row.original.id} path={row.original.figures[0]} /> : <div className="bg-muted/50 size-9 shrink-0 rounded-[5px] border border-dashed" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <a href={`#/runs/${enc(row.original.id)}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] font-medium break-all hover:underline">{row.original.id}</a>
              {row.original.origin === "fixture" || row.original.data_class === "fixture" ? <Status word="fixture" /> : null}
              {row.original.readable ? null : <Status word="error" />}
            </div>
            <div className="text-muted-foreground max-w-[15rem] truncate text-xs">{row.original.title ?? "—"}</div>
          </div>
        </div>
      ),
    },
    { id: "verdict", accessorFn: verdictOf, header: ({ column }: any) => <SortHeader column={column}>{t("verdict")}</SortHeader>, meta: { label: t("verdict") } as Meta, cell: ({ row }: any) => (
        <span className="inline-flex items-center gap-2"><VerdictOf run={row.original} />{row.original.verification ? <span className="text-muted-foreground font-mono text-xs" title={`${t("mandatory_passed")} · ${row.original.verification.contract} ${row.original.verification.version}`}>{row.original.verification.passed}/{row.original.verification.total}</span> : null}</span>
      ) },
    {
      id: "blocking", header: t("requirements"),
      cell: ({ row }: any) => {
        const cells = cellsOfSummary(row.original);
        const b = row.original.verification?.blocking ?? [];
        if (cells.length === 0) return <span className="text-muted-foreground" title={row.original.no_verdict ?? ""}>—</span>;
        return (
          <div className="flex flex-col gap-1">
            <Fingerprint cells={cells} animate={false} />
            {b.length > 0 ? <span className="text-muted-foreground font-mono text-[11px]">{b.join(" ")}</span> : null}
          </div>
        );
      },
    },
    { id: "recorded", header: t("recorded_at_run"), meta: { hideOnMobile: true, className: "max-2xl:hidden" } as Meta, cell: ({ row }: any) => row.original.runtime?.recorded_verdict ? <Status word={row.original.runtime.recorded_verdict} /> : <span className="text-muted-foreground">—</span> },
    { id: "backend", accessorFn: (r: any) => r.runtime?.backend ?? "", header: ({ column }: any) => <SortHeader column={column}>{t("backend")}</SortHeader>, meta: { label: t("backend") } as Meta, cell: ({ row }: any) => row.original.origin === "fixture" ? <span className="text-muted-foreground">—</span> : <span className="font-mono text-xs">{row.original.runtime?.backend ?? "baseline-script"}</span> },
    {
      id: "status", header: t("execution"), meta: { hideOnMobile: true } as Meta,
      cell: ({ row }: any) => row.original.status ? <span className="inline-flex items-center gap-2"><Status word={row.original.status} /></span> : "—",
    },
    { id: "started", accessorFn: (r: any) => r.started_at ?? "", header: ({ column }: any) => <SortHeader column={column}>{t("started")}</SortHeader>, meta: { label: t("started") } as Meta, cell: ({ row }: any) => <span className="text-muted-foreground"><When iso={row.original.started_at} short /></span> },
    { id: "acc", accessorFn: (r: any) => accuracy(r) ?? -1, header: ({ column }: any) => <div className="text-right"><SortHeader column={column}>test_accuracy</SortHeader></div>, meta: { align: "right", hideOnMobile: true, label: "test_accuracy" } as Meta, cell: ({ row }: any) => <span className="figure-num">{num(accuracy(row.original))}</span> },
  ];
}

export function RunList() {
  const state = useLoad(() => api.runs(), []);
  const [text, setText] = React.useState("");
  const [verdict, setVerdict] = React.useState("all");
  const [origin, setOrigin] = React.useState("all");
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});

  return (
    <Loaded state={state}>
      {(runs: any[]) => {
        const count = (v: string) => runs.filter((r) => v === "all" || verdictOf(r) === v).length;
        const needle = text.trim().toLowerCase();
        const rows = runs.filter((r) => (origin === "all" || r.origin === origin) && (verdict === "all" || verdictOf(r) === verdict)
          && (needle === "" || r.id.toLowerCase().includes(needle) || (r.runtime?.backend ?? "").toLowerCase().includes(needle)));
        const picked = Object.keys(selected).filter((k) => selected[k]);
        return (
          <>
            <PageHeader title={t("runs_title")} description={t("runs_sub")} actions={<Button asChild><a href="#/new"><PlayIcon />{t("nav_new")}</a></Button>} />
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative lg:w-72">
                <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("search_runs")} aria-label={t("search_runs")} className="pl-8" />
              </div>
              <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0"><ToggleGroup type="single" variant="outline" value={verdict} onValueChange={(v) => setVerdict(v || "all")}>
                {[["all", t("filter_all")], ["accepted", "accepted"], ["rejected", "rejected"], ["inconclusive", "inconclusive"], ["none", t("no_verdict")]].map(([v, label]) => (
                  <ToggleGroupItem key={v} value={v!} className="flex-none px-3" aria-label={label}>
                    {label}<span className="text-muted-foreground text-xs tabular-nums">{count(v!)}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup></div>
              <Select value={origin} onValueChange={setOrigin}>
                <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("runs_and_fixtures")}</SelectItem>
                  <SelectItem value="run">{t("only_runs")}</SelectItem>
                  <SelectItem value="fixture">{t("only_fixtures")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground -mt-2 text-sm">{t("runs_live_hint")} {t("list_without_reexecution")}</p>
            <DataTable
              columns={columns(selected)} data={rows} getRowId={(r: any) => r.id}
              rowSelection={selected} onRowSelectionChange={setSelected}
              onRowClick={(r: any) => go(`#/runs/${enc(r.id)}`)}
              initialSorting={[{ id: "started", desc: true }]}
              empty={runs.length === 0
                ? <Empty title={t("empty_runs_title")} body={t("no_runs")} action={<Button asChild><a href="#/new"><PlayIcon />{t("nav_new")}</a></Button>} />
                : <Empty compact icon={SearchXIcon} title={t("no_match_title")} body={t("no_match_body")} />}
            />
            {picked.length > 0 ? (
              <div className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-4 sticky bottom-4 z-20 mx-auto flex w-fit max-w-full items-center gap-3 rounded-xl border p-2 pl-4 shadow-lg">
                <span className="text-sm tabular-nums">{picked.length} / 2 {t("selected_n")}</span>
                <Button variant="ghost" size="sm" onClick={() => setSelected({})}><XIcon />{t("clear")}</Button>
                <Button size="sm" disabled={picked.length !== 2} title={picked.length === 2 ? undefined : t("pick_two")} onClick={() => go(`#/compare?a=${enc(picked[0]!)}&b=${enc(picked[1]!)}`)}>
                  <GitCompareArrowsIcon />{t("compare_selected")}
                </Button>
              </div>
            ) : null}
            <Notice title={t("verdict_meaning_title")}>{t("verdict_meaning_body")}</Notice>
          </>
        );
      }}
    </Loaded>
  );
}
