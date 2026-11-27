import * as React from "react";
import { FileTextIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, SimpleTable, type Meta } from "@/components/app/data-table";
import { Code, Empty, Json, Kv, Notice, PageHeader, Panel, Sha, Status, Tag, VerdictOf } from "@/components/app/bits";
import { Loaded } from "@/components/app/load";
import { useCrumbs } from "@/components/app/shell";
import { api } from "@/lib/api.js";
import { show } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { enc, go } from "@/lib/router";
import { t } from "@/lib/strings.js";

const link = (c: { id: string; version: string }) => `#/contracts/${enc(c.id)}/${enc(c.version)}`;
const MIX: [string, string][] = [["machine", "var(--chart-2)"], ["empirical", "var(--chart-4)"], ["human", "var(--chart-1)"]];

function Mix({ r }: { r: any }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="bg-muted flex h-1.5 w-32 overflow-hidden rounded-full">
          {MIX.map(([kind, color]) => <div key={kind} style={{ width: `${(100 * r[kind]) / Math.max(r.total, 1)}%`, background: color }} />)}
        </div>
      </TooltipTrigger>
      <TooltipContent>{MIX.map(([kind]) => `${kind} ${r[kind]}`).join(" · ")}</TooltipContent>
    </Tooltip>
  );
}

export function ContractList() {
  const state = useLoad(() => api.contracts(), []);
  const columns: any[] = [
    { accessorKey: "id", header: t("contract"), cell: ({ row }: any) => <a href={link(row.original)} onClick={(e) => e.stopPropagation()} className="font-mono text-sm font-medium hover:underline">{row.original.id}</a> },
    { accessorKey: "version", header: t("version"), cell: ({ row }: any) => <Code>{row.original.version}</Code> },
    { id: "registry", header: t("registry"), cell: ({ row }: any) => <Status word={row.original.registered ? "registered" : "not registered"} /> },
    { id: "title", header: t("title"), meta: { className: "whitespace-normal" } as Meta, cell: ({ row }: any) => row.original.usable ? row.original.title : <span className="flex flex-wrap items-center gap-2"><Status word="error" /><span className="text-muted-foreground break-all">{row.original.error}</span></span> },
    { id: "reqs", header: t("requirements"), cell: ({ row }: any) => row.original.usable ? <div className="grid gap-1.5"><span className="font-mono text-xs">{row.original.requirements.mandatory} mandatory · {row.original.requirements.advisory} advisory</span><Mix r={row.original.requirements} /></div> : "—" },
    { id: "nov", header: t("without_validator"), meta: { align: "right", hideOnMobile: true } as Meta, cell: ({ row }: any) => row.original.usable ? (row.original.requirements.without_validator > 0 ? <Status word={String(row.original.requirements.without_validator)} toneOverride="warn" /> : "0") : "—" },
    { id: "sha", header: "sha256", meta: { hideOnMobile: true } as Meta, cell: ({ row }: any) => <Sha value={row.original.sha256} /> },
  ];
  return (
    <Loaded state={state}>
      {(contracts: any[]) => (
        <>
          <PageHeader title={t("contracts_title")} description={t("contracts_sub")} />
          <DataTable columns={columns} data={contracts} onRowClick={(c: any) => go(link(c))} empty={<Empty body={t("no_contracts")} />} />
          <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">{MIX.map(([kind, color]) => <span key={kind} className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: color }} />{kind}</span>)}</div>
          <Notice title={t("contract_rules_title")}>{t("contract_rules_body")}</Notice>
        </>
      )}
    </Loaded>
  );
}

function Diff({ id, from, to }: { id: string; from: string; to: string }) {
  const state = useLoad(() => api.contractDiff(id, from, to), [id, from, to]);
  return (
    <Loaded state={state}>
      {(diff: any) => {
        const change = (kind: string, list: any[]) => list.map((r) => [
          <Status word={kind} toneOverride={kind === "added" ? "good" : kind === "removed" ? "bad" : "warn"} />, <Code>{r.id}</Code>, r.title ?? "",
          r.fields ? <div className="grid gap-1">{r.fields.map((f: any, i: number) => <div key={i} className="font-mono text-xs break-all min-w-40">{f.pointer}: {show(f.a)} → {show(f.b)}</div>)}</div> : "",
        ]);
        return (
          <div className="grid gap-4">
            <p className="text-muted-foreground text-sm">{t("contract_diff_hint")}</p>
            <SimpleTable head={[t("change"), "id", t("title"), t("detail")]} empty={t("no_requirement_changes")} rows={[...change("added", diff.added), ...change("removed", diff.removed), ...change("changed", diff.changed)]} />
            <h3 className="font-medium">{t("other_fields")}</h3>
            <SimpleTable head={["JSON pointer", from, to]} empty={t("no_differences")} rows={diff.other.map((d: any) => [
              <span className="font-mono text-xs">{d.pointer}</span>,
              d.in_a ? <span className="font-mono text-xs break-all min-w-40">{show(d.a)}</span> : "—",
              d.in_b ? <span className="font-mono text-xs break-all min-w-40">{show(d.b)}</span> : "—",
            ])} />
          </div>
        );
      }}
    </Loaded>
  );
}

export function ContractDetail({ args: [id, version] }: { args: (string | undefined)[] }) {
  const state = useLoad(() => Promise.all([api.contract(id, version), api.runs()]), [id, version]);
  const [other, setOther] = React.useState<string>("");
  useCrumbs([id!, version!]);
  return (
    <Loaded state={state}>
      {([data, runs]: any) => {
        const { summary, contract } = data;
        const governed = runs.filter((r: any) => r.verification?.contract === summary.id && r.verification?.version === summary.version);
        const others = data.versions.filter((v: string) => v !== version);
        return (
          <>
            <PageHeader
              title={summary.title ?? id}
              description={<span className="flex flex-wrap items-center gap-2"><Code>{summary.id}</Code>{t("version")} <Code>{summary.version}</Code></span>}
              actions={data.versions.length > 1 ? (
                <Select value={version} onValueChange={(v) => go(link({ id: id!, version: v }))}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{data.versions.map((v: string) => <SelectItem key={v} value={v}>{t("version")} {v}</SelectItem>)}</SelectContent>
                </Select>
              ) : null}
            />
            {summary.usable ? null : <Notice kind="bad" title={t("contract_unusable")}>{summary.error}</Notice>}
            {summary.usable && !summary.registered ? <Notice kind="bad" title={t("contract_unregistered")}>{summary.registration_error}</Notice> : null}
            <Card>
              <CardContent>
                <Kv rows={[
                  [t("description"), contract.description],
                  [t("file"), <Code>{summary.path}</Code>],
                  ["sha256", <span className="flex flex-wrap items-center gap-2"><Sha value={summary.sha256} full /><Status word={summary.registered ? "matches registry" : "not registered"} /></span>],
                  [t("artifact_type"), contract.artifact ? <span className="flex flex-wrap items-center gap-2"><Code>{contract.artifact.type}</Code>IR <Code>{contract.artifact.ir_version}</Code><Code>{contract.artifact.schema}</Code>{contract.artifact.schema_sha256 ? <Sha value={contract.artifact.schema_sha256} /> : null}</span> : "—"],
                  [t("applicability"), contract.applicability?.description],
                  [t("requires_capabilities"), <span className="flex flex-wrap gap-1.5">{(contract.applicability?.requires_capabilities ?? []).map((c: string) => <Tag key={c} mono>{c}</Tag>)}</span>],
                  [t("acceptance_rule"), <span><Code>{contract.acceptance?.rule ?? "—"}</Code> <span className="text-muted-foreground text-xs">{t("acceptance_rule_hint")}</span></span>],
                ]} />
              </CardContent>
            </Card>
            <Tabs defaultValue="requirements" className="gap-4">
              <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
                <TabsList>
                  <TabsTrigger value="requirements">{t("requirements")} <span className="text-muted-foreground">{data.requirements.length}</span></TabsTrigger>
                  <TabsTrigger value="runs">{t("runs_under_contract")} <span className="text-muted-foreground">{governed.length}</span></TabsTrigger>
                  <TabsTrigger value="diff">{t("compare_versions")}</TabsTrigger>
                  <TabsTrigger value="raw">{t("raw_json")}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="requirements">
                <SimpleTable head={["id", t("requirement"), t("level"), t("verifiability"), t("check"), t("validator")]} rows={data.requirements.map((r: any) => [
                  <Code>{r.id}</Code>,
                  <div className="grid gap-1 min-w-48"><span>{r.title}</span>{r.rationale ? <span className="text-muted-foreground text-xs">{r.rationale}</span> : null}</div>,
                  <Tag className={r.level === "mandatory" ? "" : "bg-transparent border-border"}>{r.level}</Tag>,
                  <Tag>{r.verifiability}</Tag>,
                  <div className="grid gap-1.5"><Code className="w-fit">{r.check?.kind ?? "—"}</Code>{r.check?.params ? <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">{Object.entries<any>(r.check.params).map(([k, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-mono break-all">{typeof v === "string" ? v : JSON.stringify(v)}</dd></React.Fragment>)}</dl> : null}</div>,
                  r.validator_available === undefined ? "—" : <Status word={r.validator_available ? "available" : "not_available"} />,
                ])} />
              </TabsContent>
              <TabsContent value="runs">
                <SimpleTable head={[t("run"), t("verdict"), t("mandatory_passed"), t("blocking")]} empty={t("no_runs")} rows={governed.map((r: any) => [
                  <a href={`#/runs/${enc(r.id)}`} className="font-medium hover:underline">{r.id}</a>, <VerdictOf run={r} />,
                  <span className="font-mono text-xs">{r.verification.passed} / {r.verification.total}</span>,
                  <span className="flex flex-wrap gap-1">{r.verification.blocking.map((b: string) => <Tag key={b} mono>{b}</Tag>)}</span>,
                ])} />
              </TabsContent>
              <TabsContent value="diff">
                {others.length === 0 ? <Empty icon={FileTextIcon} title={t("single_version")} body={t("single_version_body")} /> : (
                  <Panel title={t("compare_versions")} action={
                    <Select value={other || undefined} onValueChange={setOther}>
                      <SelectTrigger className="w-44"><SelectValue placeholder={t("choose_version")} /></SelectTrigger>
                      <SelectContent>{others.map((v: string) => <SelectItem key={v} value={v}>{t("compare_with")} {v}</SelectItem>)}</SelectContent>
                    </Select>
                  }>
                    {other ? <Diff id={id!} from={other} to={version!} /> : <Empty compact body={t("choose_version")} />}
                  </Panel>
                )}
              </TabsContent>
              <TabsContent value="raw"><Json value={data.text} /></TabsContent>
            </Tabs>
          </>
        );
      }}
    </Loaded>
  );
}
