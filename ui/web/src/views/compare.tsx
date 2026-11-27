import * as React from "react";
import { ArrowLeftRightIcon, ExternalLinkIcon, GitCompareArrowsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Code, Empty, Kv, NotAvailableBadge, Notice, PageHeader, Panel, Revision, Sha, Status, Tag, VerdictOf, When } from "@/components/app/bits";
import { SimpleTable } from "@/components/app/data-table";
import { Loaded } from "@/components/app/load";
import { api } from "@/lib/api.js";
import { num, show } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { enc, go } from "@/lib/router";
import { t } from "@/lib/strings.js";

function Side({ letter, value, other, runs, run, onPick }: { letter: string; value: string; other: string; runs: any[]; run: any; onPick: (v: string) => void }) {
  return (
    <Card className="min-w-0 flex-1 gap-4">
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-3">
        <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm font-semibold">{letter}</span>
        <Select value={value || undefined} onValueChange={onPick}>
          <SelectTrigger className="w-full min-w-0"><SelectValue placeholder={t("choose_run")} /></SelectTrigger>
          <SelectContent>{runs.map((r) => <SelectItem key={r.id} value={r.id} disabled={r.id === other}>{r.id}</SelectItem>)}</SelectContent>
        </Select>
        {value ? <Button variant="ghost" size="icon-sm" asChild title={t("open_run")}><a href={`#/runs/${enc(value)}`}><ExternalLinkIcon /></a></Button> : <span />}
      </CardHeader>
      <CardContent>
        {run ? <Kv rows={[
          [t("verdict"), <span className="flex items-center gap-2"><VerdictOf run={run} />{run.verification ? <span className="text-muted-foreground font-mono text-xs">{run.verification.passed} / {run.verification.total}</span> : null}</span>],
          [t("execution"), <span className="flex items-center gap-2">{run.status ? <Status word={run.status} /> : "—"}<span className="text-muted-foreground font-mono text-xs">{num(run.runtime_seconds)} s</span></span>],
          [t("started"), <When iso={run.started_at} />],
          [t("revision"), <Revision source={run.source} />],
          ["artifact sha256", <Sha value={run.artifact_sha256} />],
        ]} /> : <p className="text-muted-foreground text-sm">{t("choose_run")}</p>}
      </CardContent>
    </Card>
  );
}

function Same({ value, oneSide, volatile }: { value: boolean | null; oneSide?: boolean; volatile?: boolean }) {
  if (value === null || oneSide) return <NotAvailableBadge text={t("one_side_only")} />;
  return value ? <Status word="identical" /> : <Status word="differs" toneOverride={volatile ? "neutral" : "bad"} />;
}

export function Compare({ query }: { query: URLSearchParams }) {
  const a = query.get("a") ?? "";
  const b = query.get("b") ?? "";
  const state = useLoad(() => Promise.all([api.runs(), a && b ? api.compare(a, b) : Promise.resolve(null)]), [a, b]);
  const [showVolatile, setShowVolatile] = React.useState(false);
  const pick = (next: { a: string; b: string }) => go(`#/compare?a=${enc(next.a)}&b=${enc(next.b)}`);
  return (
    <Loaded state={state}>
      {([runs, data]: any) => {
        const find = (id: string) => (data?.comparable ? (id === a ? data.a : data.b) : runs.find((r: any) => r.id === id));
        const head = (
          <>
            <PageHeader title={t("compare_title")} description={t("compare_sub")} />
            <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
              <Side letter="A" value={a} other={b} runs={runs} run={a ? find(a) : null} onPick={(v) => pick({ a: v, b })} />
              <Button variant="outline" size="icon" className="self-center" disabled={!(a && b)} onClick={() => pick({ a: b, b: a })} title={t("swap")} aria-label={t("swap")}><ArrowLeftRightIcon /></Button>
              <Side letter="B" value={b} other={a} runs={runs} run={b ? find(b) : null} onPick={(v) => pick({ a, b: v })} />
            </div>
          </>
        );
        if (!data) return <>{head}<Empty icon={GitCompareArrowsIcon} title={t("choose_two")} body={t("pick_two")} action={<Button variant="outline" asChild><a href="#/runs">{t("nav_runs")}</a></Button>} /></>;
        if (!data.comparable) return <>{head}<Notice kind="bad" title={t("not_comparable")}>{t("not_comparable_body")}</Notice></>;
        const diffs = data.differences.filter((d: any) => showVolatile || !d.volatile);
        const sameOutputs = data.outputs.filter((o: any) => o.identical === true).length;
        return (
          <>
            {head}
            {data.counts.other === 0
              ? <Notice title={t("only_volatile_title")}>{data.counts.volatile} {t("only_volatile_body")}</Notice>
              : <Notice kind="warn" title={`${data.counts.other} ${t("nonvolatile_title")}`}>{t("nonvolatile_body")}</Notice>}
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title={t("metrics")} description={t("metrics_compare_hint")}>
                <SimpleTable align={[undefined, "right", "right", "right"]} head={[t("metric"), "A", "B", "B − A", ""]} empty={t("no_metrics")} rows={data.metrics.map((m: any) => [
                  <Code>{m.name}</Code>, <span className="font-mono">{num(m.a)}</span>, <span className="font-mono">{num(m.b)}</span>,
                  <span className="font-mono">{m.delta === null ? "—" : m.delta === 0 ? "0" : m.delta.toExponential(3)}</span>, <Same value={m.identical} />,
                ])} />
              </Panel>
              <Panel title={t("tab_outputs")} description={`${sameOutputs} / ${data.outputs.length} ${t("identical_l")}`}>
                <SimpleTable head={[t("file"), t("determinism"), "A", "B", ""]} empty={t("no_outputs")} rows={data.outputs.map((o: any) => [
                  <span className="font-mono text-xs break-all min-w-40">{o.path}</span>, o.determinism ? <Tag>{o.determinism}</Tag> : "—", <Sha value={o.a?.sha256} />, <Sha value={o.b?.sha256} />,
                  <Same value={o.identical} volatile={o.determinism === "volatile"} />,
                ])} />
              </Panel>
            </div>
            <Panel title={t("artifact_differences")} description={`${data.counts.other} + ${data.counts.volatile} volatile`}
              action={<div className="flex items-center gap-2"><Checkbox id="vol" checked={showVolatile} onCheckedChange={(v) => setShowVolatile(!!v)} /><Label htmlFor="vol" className="font-normal">{t("show_volatile")}</Label></div>}>
              <SimpleTable head={["JSON pointer", "A", "B", ""]} empty={t("no_differences")} rows={diffs.map((d: any) => [
                <span className="font-mono text-xs break-all min-w-40">{d.pointer}</span>,
                d.in_a ? <span className="font-mono text-xs break-all min-w-40">{show(d.a)}</span> : <span className="text-muted-foreground">{t("absent")}</span>,
                d.in_b ? <span className="font-mono text-xs break-all min-w-40">{show(d.b)}</span> : <span className="text-muted-foreground">{t("absent")}</span>,
                d.volatile ? <Tag>volatile</Tag> : "",
              ])} />
            </Panel>
          </>
        );
      }}
    </Loaded>
  );
}
