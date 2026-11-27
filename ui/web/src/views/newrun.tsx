import * as React from "react";
import { ArrowRightIcon, CheckIcon, FileCode2Icon, Loader2Icon, PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Code, Empty, Json, Kv, NotAvailable, NotAvailableBadge, Notice, PageHeader, Panel, Pre, Status, Tag, When } from "@/components/app/bits";
import { SimpleTable } from "@/components/app/data-table";
import { Loaded } from "@/components/app/load";
import { EventList } from "./run";
import { api } from "@/lib/api.js";
import { useInterval, useLoad } from "@/lib/hooks";
import { enc } from "@/lib/router";
import { t } from "@/lib/strings.js";
import { cn } from "@/lib/utils";

// Runtime command line exit codes (docs/runtime-interface.md); the baseline collector uses 0 and non-zero only.
const RUNTIME_EXIT: Record<number, string> = { 0: "accepted", 1: "rejected", 2: "no verdict", 3: "inconclusive" };
const jobState = (job: any) => (job.state === "running" && job.cancel_requested_at ? "stopping" : job.state === "exited" ? `exited ${job.exit_code}` : job.state);

function Choices({ items, value, onChange }: { items: { value: string; name: React.ReactNode; side?: React.ReactNode; desc?: React.ReactNode; disabled?: boolean }[]; value?: string; onChange: (v: string) => void }) {
  return (
    <RadioGroup value={value} onValueChange={onChange} className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Label key={item.value} htmlFor={`c-${item.value}`}
          className={cn("hover:bg-accent/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/[0.03] flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal transition-colors", item.disabled && "cursor-not-allowed opacity-60")}>
          <RadioGroupItem id={`c-${item.value}`} value={item.value} disabled={item.disabled} className="mt-0.5" />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <div className="flex flex-wrap items-center gap-2 font-medium"><span className="font-mono text-sm break-all">{item.name}</span>{item.side}</div>
            {item.desc ? <div className="text-muted-foreground text-sm leading-snug">{item.desc}</div> : null}
          </div>
        </Label>
      ))}
    </RadioGroup>
  );
}

function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
        <span className="bg-primary text-primary-foreground row-span-2 flex size-7 items-center justify-center rounded-full text-sm font-semibold">{n}</span>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function JobPanel({ job, onUpdate }: { job: any; onUpdate: (j: any) => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const running = job.state === "running";
  const seconds = Math.max(0, Math.round(((running ? Date.now() : Date.parse(job.finished_at ?? "") || Date.now()) - Date.parse(job.started_at)) / 1000));
  const cancel = async () => {
    setError(null);
    try { onUpdate(await api.cancelJob(job.id)); } catch (e: any) { setError(e.message); }
  };
  return (
    <Card id="job" className="scroll-mt-20 overflow-hidden">
      {running ? <div className="bg-primary/20 -mt-6 h-0.5 overflow-hidden"><div className="bg-primary h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite]" /></div> : null}
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          <Status word={jobState(job)} toneOverride={job.state === "cancelled" ? "neutral" : undefined} />
          <span className="font-mono text-base break-all">runs/{job.run_id}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {t("job")} <Code>{job.id}</Code>
          {running ? <span className="inline-flex items-center gap-1 tabular-nums"><Loader2Icon className="size-3.5 animate-spin" />{seconds} s {t("elapsed")}</span> : null}
          {job.backend !== "baseline-script" && job.state === "exited" ? <span className="inline-flex items-center gap-1">{t("runtime_exit_means")}: <Status word={RUNTIME_EXIT[job.exit_code] ?? "unknown"} /></span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Kv rows={[[t("command"), <Code>{job.command.join(" ")}</Code>], [t("started"), <When iso={job.started_at} />]]} />
        {(job.events ?? []).length > 0 ? <div className="grid gap-2"><div className="text-sm font-medium">{t("event_log")}</div><p className="text-muted-foreground text-xs">{t("event_log_hint")}</p><EventList events={job.events} /></div> : null}
        <div className="grid gap-2">
          <div className="text-sm font-medium">{t("process_output")}</div>
          <Pre className="max-h-80 bg-zinc-950 text-zinc-100 whitespace-pre-wrap dark:bg-zinc-950">{job.log || t("no_output_yet")}</Pre>
        </div>
        {job.cancel_requested_at ? <p className="text-muted-foreground text-sm">{t("cancel_hint")}</p> : null}
        {job.state === "exited" && job.exit_code !== 0 ? <p className="text-muted-foreground text-sm">{t("nonzero_hint")}</p> : null}
        {error ? <Notice kind="bad" title={t("could_not_cancel")}>{error}</Notice> : null}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t pt-6">
        {running ? <Button variant="destructive" disabled={Boolean(job.cancel_requested_at)} onClick={cancel}><SquareIcon className="fill-current" />{job.cancel_requested_at ? t("stopping") : t("cancel_run")}</Button>
          : <Button asChild><a href={`#/runs/${enc(job.run_id)}`}>{t("open_run")}<ArrowRightIcon /></a></Button>}
      </CardFooter>
    </Card>
  );
}

function Form({ system, defaults, initialJobs }: { system: any; defaults: any; initialJobs: any[] }) {
  const stamp = React.useMemo(() => new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15).replace("T", "-"), []);
  const [backend, setBackend] = React.useState<string | undefined>((system.backends.find((b: any) => b.available) ?? system.backends[0])?.name);
  const [task, setTask] = React.useState<string | undefined>(system.tasks[0]?.path);
  const [runId, setRunId] = React.useState(`ui-${stamp}`);
  const [timeout, setTimeoutValue] = React.useState("");
  const [customise, setCustomise] = React.useState(false);
  const [config, setConfig] = React.useState(JSON.stringify(defaults.config, null, 2));
  const [model, setModel] = React.useState("");
  const [plan, setPlan] = React.useState<any>(null);
  const [planning, setPlanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<any[]>(initialJobs);
  const [job, setJob] = React.useState<any>(() => initialJobs.find((j) => j.state === "running") ?? null);
  const [starting, setStarting] = React.useState(false);
  const selected = system.backends.find((b: any) => b.name === backend);
  const isScript = backend === "baseline-script";
  const running = job?.state === "running";

  useInterval(async () => {
    const next = await api.job(job.id).catch(() => null);
    if (!next) return;
    setJob(next);
    if (next.state !== "running") api.jobs().then(setJobs, () => {});
  }, running ? 1000 : null);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const body: any = { run_id: runId.trim(), backend };
      if (isScript) {
        if (timeout !== "") body.timeout_seconds = Number(timeout);
        if (customise) body.config = JSON.parse(config);
      } else {
        body.task = task;
        if (model.trim() !== "") body.model = model.trim();
      }
      const started = await api.startRun(body);
      setJob(started);
      api.jobs().then(setJobs, () => {});
      requestAnimationFrame(() => document.getElementById("job")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };
  const preview = async () => {
    setPlanning(true);
    setPlan(await api.compile({ task, backend }).catch((e: any) => ({ ok: false, error: e.message })));
    setPlanning(false);
  };

  return (
    <>
      <PageHeader title={t("new_title")} description={t("new_sub")} />
      {system.repository.dirty ? <Notice kind="warn" title={t("dirty_title")}>{t("dirty_body")}</Notice> : null}
      {system.backends.some((b: any) => b.kind === "agent") ? null : <NotAvailable what={t("component_agent-backends")} why={t("agent_missing")} />}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="grid gap-6">
          <Step n={1} title={t("step_backend")}>
            <Choices value={backend} onChange={(v) => { setBackend(v); setPlan(null); }} items={system.backends.map((b: any) => ({
              value: b.name, name: b.name, disabled: !b.available, side: <Tag>{b.kind}</Tag>,
              desc: b.available ? (b.note ?? "") : <span className="flex flex-wrap items-center gap-2"><NotAvailableBadge />{b.note ?? ""}</span>,
            }))} />
            {selected?.kind === "agent" ? <Notice kind="warn" title={t("agent_cost_title")}>{t("agent_cost_body")}</Notice> : null}
          </Step>
          <Step n={2} title={t("step_task")}>
            {isScript ? (
              <div className="grid gap-4">
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="timeout">{t("timeout_seconds")}</Label>
                  <Input id="timeout" type="number" min="0.01" max="3600" step="any" placeholder="300" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} />
                  <p className="text-muted-foreground text-xs">{t("timeout_hint")}</p>
                </div>
                <div className="flex items-center gap-2"><Checkbox id="custom" checked={customise} onCheckedChange={(v) => setCustomise(!!v)} /><Label htmlFor="custom" className="font-normal">{t("customise_config")}</Label></div>
                <Textarea value={config} onChange={(e) => setConfig(e.target.value)} disabled={!customise} spellCheck={false} className="min-h-48 font-mono text-xs" />
                <p className="text-muted-foreground text-xs">{t("config_hint")}</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {system.tasks.length === 0 ? <NotAvailable what={t("tasks")} why={t("tasks_missing")} /> : (
                  <Choices value={task} onChange={(v) => { setTask(v); setPlan(null); }} items={system.tasks.map((x: any) => ({ value: x.path, name: x.id, side: x.fixture ? <Status word="fixture" /> : null, desc: x.title ?? x.path }))} />
                )}
                <div className="grid gap-2 sm:max-w-md">
                  <Label htmlFor="model">{t("model")}</Label>
                  <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("model_placeholder")} spellCheck={false} />
                  <p className="text-muted-foreground text-xs">{t("model_hint")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={preview} disabled={planning || !task}>{planning ? <Loader2Icon className="animate-spin" /> : <FileCode2Icon />}{t("preview_plan")}</Button>
                  <span className="text-muted-foreground text-sm">{t("preview_plan_hint")}</span>
                </div>
                {plan ? (plan.ok ? <Panel title={t("compiled_plan")}><Json value={plan.plan} /></Panel> : <Notice kind="bad" title={t("no_plan")}><Pre className="w-full whitespace-pre-wrap">{plan.error}</Pre></Notice>) : null}
              </div>
            )}
          </Step>
        </div>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <Step n={3} title={t("step_start")}>
            <div className="grid gap-2">
              <Label htmlFor="runid">{t("run_id")}</Label>
              <Input id="runid" value={runId} onChange={(e) => setRunId(e.target.value)} spellCheck={false} className="font-mono" />
              <p className="text-muted-foreground text-xs">{t("run_id_hint")}</p>
            </div>
            <div className="bg-muted/50 grid gap-1.5 rounded-lg border p-3 text-sm">
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t("backend")}</span><span className="font-mono text-xs">{backend ?? "—"}</span></div>
              {!isScript ? <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t("task")}</span><span className="truncate font-mono text-xs">{system.tasks.find((x: any) => x.path === task)?.id ?? "—"}</span></div> : null}
            </div>
            <Button size="lg" className="w-full" onClick={start} disabled={starting || running || !backend}>{starting ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}{t("start_run")}</Button>
            {error ? <Notice kind="bad" title={t("could_not_start")}>{error}</Notice> : null}
          </Step>
        </div>
      </div>
      {job ? <JobPanel job={job} onUpdate={setJob} /> : null}
      <Panel title={t("jobs_this_session")} description={t("jobs_hint")}>
        {jobs.length === 0 ? <Empty compact body={t("no_jobs")} /> : (
          <SimpleTable head={[t("job"), t("run"), t("backend"), t("state"), t("started")]} rows={jobs.map((j) => [
            <Code>{j.id}</Code>, <a href={`#/runs/${enc(j.run_id)}`} className="font-medium hover:underline">{j.run_id}</a>, <span className="font-mono text-xs">{j.backend}</span>,
            <Status word={jobState(j)} toneOverride={j.state === "cancelled" ? "neutral" : undefined} />, <When iso={j.started_at} />,
          ])} />
        )}
      </Panel>
    </>
  );
}

export function NewRun() {
  const state = useLoad(() => Promise.all([api.system(), api.runDefaults(), api.jobs()]), []);
  return <Loaded state={state}>{([system, defaults, jobs]: any) => <Form system={system} defaults={defaults} initialJobs={jobs} />}</Loaded>;
}

