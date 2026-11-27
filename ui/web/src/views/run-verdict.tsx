// The verdict tab of a run: the verifier's answer, each requirement's result,
// what the verdict is bound to, the place for human review, and the trust boundary.
import * as React from "react";
import {
  BanIcon, CheckCircle2Icon, CircleDashedIcon, FileSignatureIcon, FingerprintIcon, HelpCircleIcon, Loader2Icon, PenLineIcon, PlayIcon, RefreshCwIcon, ShieldCheckIcon, ShieldIcon, XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Code, Empty, Kv, NotAvailableBadge, Notice, Panel, Sha, Status, Tag, When } from "@/components/app/bits";
import { enc } from "@/lib/router";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";

const VERDICT_STYLE: Record<string, { Icon: React.ElementType; text: string; ring: string }> = {
  accepted: { Icon: CheckCircle2Icon, text: "text-success", ring: "bg-success/10" },
  rejected: { Icon: XCircleIcon, text: "text-destructive", ring: "bg-destructive/10" },
  inconclusive: { Icon: HelpCircleIcon, text: "text-warning", ring: "bg-warning/10" },
  none: { Icon: CircleDashedIcon, text: "text-muted-foreground", ring: "bg-muted" },
};
const CELL: Record<string, string> = { pass: "bg-success/15 text-success border-success/30", fail: "bg-destructive/15 text-destructive border-destructive/30", error: "bg-destructive/15 text-destructive border-destructive/30", not_run: "bg-muted text-muted-foreground border-border" };

function jump(id: string) {
  document.getElementById(`req-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function Requirements({ record, extra, open, setOpen }: { record: any; extra: Map<string, any>; open: string[]; setOpen: (v: string[]) => void }) {
  const [filter, setFilter] = React.useState("all");
  const rows = record.results.filter((r: any) => filter === "all" || r.status !== "pass");
  const notPassed = record.results.filter((r: any) => r.status !== "pass").length;
  return (
    <Panel
      title={t("requirement_results")}
      description={record.results.some((r: any) => r.level === "advisory") ? t("advisory_note") : undefined}
      action={
        <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => setFilter(v || "all")}>
          <ToggleGroupItem value="all" className="px-3">{t("filter_all")} <span className="text-muted-foreground tabular-nums">{record.results.length}</span></ToggleGroupItem>
          <ToggleGroupItem value="open" className="px-3">{t("filter_not_passed")} <span className="text-muted-foreground tabular-nums">{notPassed}</span></ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {rows.length === 0 ? <Empty compact icon={CheckCircle2Icon} body={t("all_passed")} /> : (
        <Accordion type="multiple" value={open} onValueChange={setOpen} className="-my-2">
          {rows.map((r: any) => {
            const blocking = r.level === "mandatory" && r.status !== "pass";
            const rationale = extra.get(r.requirement)?.rationale;
            return (
              <AccordionItem key={r.requirement} value={r.requirement} id={`req-${r.requirement}`} className="scroll-mt-24">
                <AccordionTrigger className="items-center py-3 hover:no-underline">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[10px]", CELL[r.status] ?? CELL.not_run)}>
                        {r.status === "pass" ? "✓" : r.status === "fail" ? "✕" : r.status === "error" ? "!" : "–"}
                      </span>
                      <Code className="shrink-0">{r.requirement}</Code>
                      <span className={cn("min-w-0 font-normal", blocking && "font-medium")}>{r.title}</span>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-9 sm:pl-0">
                      <Tag>{r.level}</Tag><Tag>{r.verifiability}</Tag><Status word={r.status} />
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pl-9">
                  <div className="grid gap-3">
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs font-medium">{t("verifier_detail")}</div>
                      {r.detail ? <div className="bg-muted/50 rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap">{r.detail}</div> : <div className="text-muted-foreground">{t("no_detail")}</div>}
                    </div>
                    {rationale ? <div><div className="text-muted-foreground mb-1 text-xs font-medium">{t("rationale")}</div><p className="text-muted-foreground">{rationale}</p></div> : null}
                    <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">{t("check")}</span><Code>{r.kind}</Code></div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </Panel>
  );
}

/** The place where a person's judgement belongs. Recording one is not built: its format is open question Q10. */
function Review({ run, record }: { run: any; record: any }) {
  const human = record.results.filter((r: any) => r.verifiability === "human" || r.kind === "human-review");
  if (human.length === 0) return null;
  const checklist = run.trust?.review_checklist ?? [];
  const questions = checklist.length > 0 ? checklist : human.map((r: any) => ({ requirement: r.requirement, question: r.title }));
  return (
    <Panel title={<span className="flex items-center gap-2"><PenLineIcon className="size-4" />{t("review_title")}</span>} description={t("review_sub")}>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <ol className="grid gap-3">
          {questions.map((q: any, i: number) => {
            const result = record.results.find((r: any) => r.requirement === q.requirement);
            return (
              <li key={i} className="flex gap-3 rounded-lg border p-3">
                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums">{i + 1}</span>
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5"><Code>{q.requirement}</Code>{result ? <Status word={result.status} /> : null}{result ? <Tag>{result.level}</Tag> : null}</div>
                  <div className="text-sm">{q.question}</div>
                  <div className="text-muted-foreground text-xs">{result?.level === "advisory" ? t("review_advisory") : t("review_mandatory")}</div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
          <div className="flex items-center gap-2"><NotAvailableBadge /></div>
          <div className="font-medium">{t("review_record")}</div>
          <p className="text-muted-foreground text-sm">{t("review_record_body")}</p>
          <Button variant="outline" size="sm" className="w-fit" asChild><a href="#/docs/docs/open-questions.md">{t("open_question")} Q10</a></Button>
        </div>
      </div>
    </Panel>
  );
}

function BoundaryRow({ icon: Icon, title, state, tone, children }: { icon: React.ElementType; title: React.ReactNode; state?: React.ReactNode; tone: "ok" | "bad" | "neutral"; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", tone === "ok" ? "bg-success/10 text-success border-success/20" : tone === "bad" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-muted text-muted-foreground")}>
        <Icon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{title}</span>{state}</div>
        {children ? <div className="text-muted-foreground grid gap-2 text-sm">{children}</div> : null}
      </div>
    </div>
  );
}

function IsolationPart({ label, part }: { label: string; part: any }) {
  if (!part || typeof part !== "object") return <div className="flex flex-wrap items-center gap-2"><span className="w-24 shrink-0">{label}</span><span className="text-muted-foreground/70">{t("not_recorded")}</span></div>;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0">{label}</span>
        <Code>{part.mechanism ?? "?"}</Code>
        <Status word={part.enforced === true ? "enforced" : "not enforced"} />
        {part.network ? <Tag mono>network: {part.network}</Tag> : null}
        {Array.isArray(part.writable_paths) && part.writable_paths.length > 0 ? <Tag mono>writable: {part.writable_paths.join(", ")}</Tag> : null}
      </div>
      {part.detail ? <div className="pl-26 text-xs">{part.detail}</div> : null}
    </div>
  );
}

/**
 * The boundary between the producer and the evidence, as the run's records
 * state it. Nothing here is inferred; a missing record says so.
 */
export function TrustBoundary({ run, record }: { run: any; record?: any }) {
  const trust = run.trust ?? {};
  const required = record?.capabilities?.required ?? [];
  const established = new Set(record?.capabilities?.established ?? []);
  const sandbox = trust.backend_sandbox;
  const col = record?.collector;
  const att = trust.attestation;
  return (
    <Panel id="tb" className="scroll-mt-20" title={<span className="flex items-center gap-2"><ShieldIcon className="size-4" />{t("tb_title")}</span>} description={t("tb_sub")}>
      <div className="divide-y">
        {col ? (
          <BoundaryRow icon={ShieldCheckIcon} title={t("tb_verifier_attestation")} tone={col.attested ? "ok" : "neutral"} state={<Status word={col.attested ? "attested" : "not attested"} />}>
            <p>{col.attested ? t("tb_attested_body") : t("tb_not_attested_body")}</p>
            {col.attested ? <Kv className="text-foreground" rows={[[t("tb_collector"), <Code>{col.id ?? "—"}</Code>], ["key id", <Sha value={col.key_id} />], [t("tb_custody"), col.custody ?? "—"], [t("tb_isolation"), col.isolation == null ? "—" : <Code>{typeof col.isolation === "string" ? col.isolation : JSON.stringify(col.isolation)}</Code>]]} /> : null}
            {(col.problems ?? []).length > 0 ? <ul className="grid gap-1">{col.problems.map((p: string, i: number) => <li key={i} className="bg-muted/50 rounded border px-2 py-1 font-mono text-xs break-words">{p}</li>)}</ul> : null}
            {record.collectors ? <div className="flex flex-wrap items-center gap-2 text-xs">{t("tb_collectors_file")} <Code>{record.collectors.path}</Code><Sha value={record.collectors.sha256} /></div> : null}
          </BoundaryRow>
        ) : null}
        <BoundaryRow icon={ShieldIcon} title={t("tb_capabilities")} tone={required.length > 0 && established.size < required.length ? "neutral" : "ok"}
          state={required.length === 0 ? <span className="text-muted-foreground">—</span> : <span className="flex flex-wrap gap-2">{required.map((c: string) => <span key={c} className="inline-flex items-center gap-1"><Code>{c}</Code><Status word={established.has(c) ? "established" : "not established"} /></span>)}</span>}>
          {required.length > 0 ? <p>{t("capabilities_note_body")}</p> : null}
        </BoundaryRow>
        {trust.isolation ? (
          <BoundaryRow icon={BanIcon} title={t("tb_isolation")} tone={trust.isolation.execution?.enforced && trust.isolation.backend?.enforced ? "ok" : "neutral"}>
            <IsolationPart label={t("tb_isolation_backend")} part={trust.isolation.backend} />
            <IsolationPart label={t("tb_isolation_execution")} part={trust.isolation.execution} />
          </BoundaryRow>
        ) : (
          <BoundaryRow icon={BanIcon} title={t("tb_isolation")} tone="neutral" state={<NotAvailableBadge />}>
            <p>{t("tb_isolation_missing")}</p>
            {sandbox ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2"><Tag>backend</Tag><span>{trust.backend} sandbox</span><Status word={sandbox.supported ? "supported" : "not supported"} toneOverride={sandbox.supported ? "good" : "neutral"} /></div>
                {sandbox.guarantee ? <blockquote className="border-l-2 pl-3 italic">{sandbox.guarantee}</blockquote> : null}
              </div>
            ) : null}
          </BoundaryRow>
        )}
        {att ? (
          <BoundaryRow icon={FileSignatureIcon} title={t("tb_attestation_runtime")} tone={col?.attested ? "ok" : "neutral"}
            state={<span className="flex flex-wrap items-center gap-2"><Code>{att.format ?? "?"}</Code><Status word="signed" />{col ? <Status word={col.attested ? "accepted by the verifier" : "not accepted by the verifier"} toneOverride={col.attested ? "good" : "bad"} /> : null}</span>}>
            <Kv className="text-foreground" rows={[
              [t("tb_signer"), att.signer ?? "—"],
              att.collector_id ? [t("tb_collector"), <Code>{att.collector_id}</Code>] : null,
              ["subject sha256", <span className="flex flex-wrap items-center gap-2"><Sha value={att.subject_sha256} />{att.subject_sha256 && run.summary.artifact_sha256 ? <Status word={att.subject_sha256 === run.summary.artifact_sha256 ? "matches artifact.json" : "differs from artifact.json"} toneOverride={att.subject_sha256 === run.summary.artifact_sha256 ? "good" : "bad"} /> : null}</span>],
              ["key id", <Sha value={att.key_id} />],
              [t("file"), att.path ? <Code>{att.path}</Code> : "—"],
            ]} />
          </BoundaryRow>
        ) : (
          <BoundaryRow icon={FileSignatureIcon} title={t("tb_attestation_runtime")} tone={trust.attestation_refused ? "bad" : "neutral"} state={trust.attestation_refused ? <Status word="not signed" toneOverride="bad" /> : <NotAvailableBadge />}>
            <p>{trust.attestation_refused ? t("tb_attestation_refused") : t("tb_attestation_missing")}</p>
            {trust.attestation_refused ? <div className="bg-muted/50 rounded border px-2 py-1 font-mono text-xs break-words">{trust.attestation_refused}</div> : null}
          </BoundaryRow>
        )}
        {trust.integrity ? (
          <BoundaryRow icon={FingerprintIcon} title={t("tb_integrity")} tone={trust.integrity.violations?.length === 0 ? "ok" : "bad"}
            state={<Status word={trust.integrity.violations?.length === 0 ? "no violations" : `${trust.integrity.violations?.length ?? "?"} violations`} />}>
            <p>{t("tb_integrity_body")} {trust.trusted_base_sha256 ? <span className="inline-flex items-center gap-1">trusted base <Sha value={trust.trusted_base_sha256} /></span> : null}</p>
            {trust.integrity.violations?.length > 0 ? <ul className="grid gap-1">{trust.integrity.violations.map((v: any, i: number) => <li key={i} className="font-mono text-xs">{typeof v === "string" ? v : JSON.stringify(v)}</li>)}</ul> : null}
          </BoundaryRow>
        ) : (
          <BoundaryRow icon={FingerprintIcon} title={t("tb_integrity")} tone="neutral" state={<NotAvailableBadge text={trust.made_by === "runtime" ? t("not_recorded") : t("not_applicable")} />}>
            {trust.made_by === "runtime" ? null : <p>{t("tb_integrity_baseline")}</p>}
          </BoundaryRow>
        )}
      </div>
    </Panel>
  );
}

export function VerdictTab({ run, outcome, reverify }: { run: any; outcome: any; reverify: (body: any, label?: string) => Promise<void> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const act = async (body: any, label: string) => { setBusy(label); try { await reverify(body); } finally { setBusy(null); } };
  if (!outcome.issued) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="bg-muted flex size-14 shrink-0 items-center justify-center rounded-full"><CircleDashedIcon className="text-muted-foreground size-7" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-semibold">{t("no_verdict_issued")}</div>
              <div className="text-muted-foreground font-mono text-sm break-words">{outcome.no_verdict}</div>
            </div>
            <Button variant="outline" disabled={busy !== null} onClick={() => act({}, t("checking"))}>{busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}{t("verify_again")}</Button>
          </CardContent>
        </Card>
        <Notice title={t("no_verdict_title")}>{t("no_verdict_body")}</Notice>
        <TrustBoundary run={run} />
      </div>
    );
  }
  return <Issued run={run} outcome={outcome} busy={busy} act={act} />;
}

function Issued({ run, outcome, busy, act }: { run: any; outcome: any; busy: string | null; act: (body: any, label: string) => Promise<void> }) {
  const { record, requirements } = outcome;
  const extra = new Map<string, any>(requirements.map((r: any) => [r.id, r]));
  const blocking = record.results.filter((r: any) => r.level === "mandatory" && r.status !== "pass");
  const [open, setOpen] = React.useState<string[]>(() => blocking.map((r: any) => r.requirement));
  const style = VERDICT_STYLE[record.verdict] ?? VERDICT_STYLE.none!;
  const contractKey = `${record.contract.id}@${record.contract.version}`;
  const contractOf = (key = contractKey) => { const [contract, version] = key.split("@"); return { contract, version }; };
  const task = run.reproduction_tasks[0]?.path;
  const repoFlag = run.summary.runtime ? `${run.summary.path}/workspace` : ".";
  const flags = record.reproduction?.requested ? ` --reproduce --task ${task ?? "<task>"}` : "";
  const focus = (id: string) => { setOpen((o) => (o.includes(id) ? o : [...o, id])); requestAnimationFrame(() => jump(id)); };
  const pct = record.summary.mandatory > 0 ? Math.round((100 * record.summary.passed) / record.summary.mandatory) : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card className={cn("relative gap-0 overflow-hidden py-0")}>
        {busy ? <div className="bg-primary/20 absolute inset-x-0 top-0 h-0.5 overflow-hidden"><div className="bg-primary h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite]" /></div> : null}
        <CardHeader className="gap-4 border-b py-6 sm:grid-cols-[auto_1fr_auto]">
          <div className="flex items-center gap-4 sm:contents">
            <div className={cn("flex size-14 shrink-0 items-center justify-center rounded-full", style.ring)}><style.Icon className={cn("size-8", style.text)} /></div>
            <div className="min-w-0 self-center">
              <div className={cn("text-2xl font-semibold tracking-tight", style.text)}>{record.verdict}</div>
              <div className="text-muted-foreground text-sm">{t(`verdict_means_${record.verdict}`)}</div>
            </div>
          </div>
          <div className="flex items-baseline gap-1 self-center sm:flex-col sm:items-end sm:gap-0">
            <div className="text-3xl font-semibold tabular-nums">{record.summary.passed}<span className="text-muted-foreground text-lg font-normal"> / {record.summary.mandatory}</span></div>
            <div className="text-muted-foreground text-xs">{t("mandatory_passed_l")} · {pct}%</div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 py-5">
          <div className="flex flex-wrap gap-1.5">
            {record.results.map((r: any) => (
              <Tooltip key={r.requirement}>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => focus(r.requirement)}
                    className={cn("h-7 min-w-12 rounded-md border px-1.5 font-mono text-[11px] transition-transform hover:-translate-y-0.5", CELL[r.status] ?? CELL.not_run, r.level === "advisory" && "border-dashed opacity-80", r.level === "mandatory" && r.status !== "pass" && "ring-destructive/40 ring-2")}>
                    {r.requirement}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{r.requirement} · {r.status} · {r.level}<br />{r.title}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <p className="text-sm leading-relaxed">{record.statement}</p>
        </CardContent>
        <CardFooter className="bg-muted/40 flex flex-wrap gap-2 border-t py-3">
          {run.contracts.length > 1 ? (
            <Select value={contractKey} disabled={busy !== null} onValueChange={(v) => act(contractOf(v), t("checking"))}>
              <SelectTrigger size="sm" className="bg-background" aria-label={t("contract")}><SelectValue /></SelectTrigger>
              <SelectContent>{run.contracts.map((c: any) => <SelectItem key={`${c.id}@${c.version}`} value={`${c.id}@${c.version}`}>{c.id} {c.version}</SelectItem>)}</SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" size="sm" className="bg-background" disabled={busy !== null} onClick={() => act(contractOf(), t("checking"))}><RefreshCwIcon className={cn(busy === t("checking") && "animate-spin")} />{t("verify_again")}</Button>
          {task ? <Button size="sm" disabled={busy !== null} onClick={() => act({ ...contractOf(), reproduce_task: task }, t("reexecuting"))}>{busy === t("reexecuting") ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}{t("verify_reexecute")}</Button> : null}
          {busy ? <span className="text-muted-foreground text-sm">{busy}</span> : null}
          <span className="text-muted-foreground ml-auto text-xs">{t("issued_at")} <When iso={record.issued_at} /></span>
        </CardFooter>
      </Card>
      {task ? null : <p className="text-muted-foreground -mt-2 text-xs">{t("no_reproduction_task")}</p>}

      {blocking.length > 0 ? (
        <Notice kind={record.verdict === "rejected" ? "bad" : "warn"} title={t("why_not_accepted")}>
          <ul className="grid w-full gap-1.5">
            {blocking.map((r: any) => (
              <li key={r.requirement} className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => focus(r.requirement)} className="hover:underline"><Code>{r.requirement}</Code></button>
                <Status word={r.status} />
                <span className="text-foreground">{r.title}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Requirements record={record} extra={extra} open={open} setOpen={setOpen} />

      <Panel title={t("verdict_binding")}>
        <Kv rows={[
          [t("contract"), <span className="flex flex-wrap items-center gap-2"><a className="font-medium underline-offset-4 hover:underline" href={`#/contracts/${enc(record.contract.id)}/${enc(record.contract.version)}`}>{record.contract.id} {record.contract.version}</a><Code>{record.contract.path}</Code></span>],
          [t("contract_digest"), <span className="flex flex-wrap items-center gap-2"><Sha value={record.contract.sha256} full /><Status word={record.contract.registered ? "matches registry" : "not registered"} /></span>],
          [t("registry_digest"), <Sha value={record.contract.registry_sha256} full />],
          [t("artifact_digest"), record.artifact.sha256 ? <Sha value={record.artifact.sha256} full /> : <Status word="missing" />],
          [t("verifier_revision"), <span className="flex flex-wrap items-center gap-2"><Sha value={record.verifier.revision} full />{record.verifier.dirty ? <Status word="dirty" /> : null}</span>],
          [t("reproduction"), record.reproduction?.requested ? <span className="flex flex-wrap items-center gap-2">{t("reproduction_requested")} · task <Sha value={record.reproduction.task_sha256} /></span> : t("reproduction_not_requested")],
          [t("exit_code_equiv"), <Code>{String(outcome.exit_code)}</Code>],
          [t("record_schema"), <Code>{record.record_schema ?? "—"}</Code>],
          record.collectors ? [t("tb_collectors_file"), <span className="flex flex-wrap items-center gap-2"><Code>{record.collectors.path}</Code><Sha value={record.collectors.sha256} /></span>] : null,
          [t("cli_equivalent"), <Code>{`node src/cli.ts verify ${run.summary.path} --contract ${record.contract.path} --repo ${repoFlag}${flags}`}</Code>],
        ]} />
        {record.verifier.dirty ? <Notice kind="warn" className="mt-4" title={t("verifier_dirty_title")}>{t("verifier_dirty_body")}</Notice> : null}
      </Panel>

      <Review run={run} record={record} />
      <TrustBoundary run={run} record={record} />
    </div>
  );
}

