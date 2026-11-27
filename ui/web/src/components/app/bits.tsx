// Small pieces shared by every view, built from the shadcn/ui components.
// Words the verifier records (pass, fail, accepted, collector, ...) are shown verbatim.
import * as React from "react";
import {
  AlertTriangleIcon, BanIcon, CheckCircle2Icon, CircleDashedIcon, CircleHelpIcon, CircleMinusIcon, CopyIcon, InboxIcon, InfoIcon, Loader2Icon, XCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/lib/strings.js";
import { when, whenShort } from "@/lib/format";
import { toast } from "./toast";

const GOOD = new Set(["accepted", "pass", "match", "identical", "attested", "established", "enforced", "matches registry", "registered", "available", "ok", "completed", "succeeded", "signed", "no violations"]);
const BAD = new Set(["rejected", "fail", "error", "mismatch", "missing", "differs", "failed", "timeout", "void", "not registered", "escapes run dir"]);
const WARN = new Set(["inconclusive", "partial", "dirty", "fixture", "running", "stopping", "not_run"]);

export function tone(word: string) {
  if (GOOD.has(word)) return "good";
  if (BAD.has(word) || /^\d+ violations$/.test(word) || word.startsWith("exited ") && word !== "exited 0") return "bad";
  if (WARN.has(word)) return "warn";
  return "neutral";
}

const TONE_ICON = { good: CheckCircle2Icon, bad: XCircleIcon, warn: AlertTriangleIcon, neutral: CircleMinusIcon };
const TONE_TEXT = { good: "text-success", bad: "text-destructive", warn: "text-warning", neutral: "text-muted-foreground" };

/** A recorded word as an outline badge with a coloured status glyph. */
export function Status({ word, toneOverride, className, title }: { word: string; toneOverride?: keyof typeof TONE_ICON; className?: string; title?: string }) {
  const kind = toneOverride ?? tone(word);
  const Icon = word === "running" || word === "stopping" ? Loader2Icon : TONE_ICON[kind];
  return (
    <Badge variant="outline" className={cn("text-muted-foreground px-1.5 font-normal", className)} title={title}>
      <Icon className={cn(TONE_TEXT[kind], (word === "running" || word === "stopping") && "animate-spin")} />
      <span className="text-foreground">{word}</span>
    </Badge>
  );
}

export function NoVerdict({ title }: { title?: string }) {
  return (
    <Badge variant="outline" className="text-muted-foreground px-1.5 font-normal" title={title}>
      <CircleDashedIcon />
      {t("no_verdict")}
    </Badge>
  );
}

export function VerdictOf({ run }: { run: any }) {
  return run.verification ? <Status word={run.verification.verdict} /> : <NoVerdict title={run.no_verdict ?? ""} />;
}

export function Tag({ children, mono, className }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <Badge variant="secondary" className={cn("font-normal", mono && "font-mono", className)}>{children}</Badge>;
}

export function NotAvailableBadge({ text }: { text?: string }) {
  return <Badge variant="outline" className="text-muted-foreground border-dashed font-normal"><BanIcon />{text ?? t("not_yet_available")}</Badge>;
}

/** A digest: the first twelve characters, the whole value on hover, copied on click. */
export function Sha({ value, full }: { value?: string | null; full?: boolean }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn("hover:bg-muted inline-flex max-w-full items-center gap-1 rounded px-1 -mx-1 font-mono text-xs text-muted-foreground hover:text-foreground", full && "break-all text-left")}
          onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value).then(() => toast(t("copied")), () => {}); }}
        >
          {full ? value : value.slice(0, 12)}
          <CopyIcon className="size-3 shrink-0 opacity-60" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{value}</TooltipContent>
    </Tooltip>
  );
}

export function When({ iso, short }: { iso?: string | null; short?: boolean }) {
  return <span title={iso ?? ""} className="tabular-nums whitespace-nowrap">{short ? whenShort(iso) : when(iso)}</span>;
}

export function Revision({ source }: { source: any }) {
  if (!source || source.kind !== "git") return <span className="text-muted-foreground">{source?.kind ?? "—"}</span>;
  return <span className="inline-flex items-center gap-2"><Sha value={source.revision} />{source.dirty ? <Status word="dirty" /> : null}</span>;
}

export function DataClass({ value }: { value?: string }) {
  if (value === "fixture") return <Status word="fixture" />;
  return value ? <Tag>{value}</Tag> : <span className="text-muted-foreground">—</span>;
}

const NOTICE = {
  info: { Icon: InfoIcon, cls: "" },
  warn: { Icon: AlertTriangleIcon, cls: "border-warning/40 [&>svg]:text-warning" },
  bad: { Icon: XCircleIcon, cls: "" },
  na: { Icon: BanIcon, cls: "border-dashed" },
};
export function Notice({ kind = "info", title, children, className }: { kind?: keyof typeof NOTICE; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const { Icon, cls } = NOTICE[kind];
  return (
    <Alert variant={kind === "bad" ? "destructive" : "default"} className={cn(cls, className)}>
      <Icon />
      {title ? <AlertTitle className="line-clamp-none">{title}</AlertTitle> : null}
      {children ? <AlertDescription>{children}</AlertDescription> : null}
    </Alert>
  );
}

/** For anything a slice has not delivered yet. Never rendered with sample data. */
export function NotAvailable({ what, why, className }: { what: React.ReactNode; why?: React.ReactNode; className?: string }) {
  return <Notice kind="na" title={<>{t("not_yet_available")}: {what}</>} className={className}>{why}</Notice>;
}

export function Empty({ title, body, action, icon: Icon = InboxIcon, compact }: { title?: React.ReactNode; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ElementType; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center", compact ? "p-6" : "p-10")}>
      <div className="bg-muted flex size-10 items-center justify-center rounded-full"><Icon className="text-muted-foreground size-5" /></div>
      {title ? <div className="font-medium">{title}</div> : null}
      {body ? <p className="text-muted-foreground max-w-md text-sm text-balance">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
        {description ? <div className="text-muted-foreground text-sm">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A titled card. */
export function Panel({ title, description, action, children, className, contentClassName, id }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode; className?: string; contentClassName?: string; id?: string }) {
  return (
    <Card className={cn("gap-4", className)} id={id}>
      {title || description || action ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

/** A two-column list of facts. Rows that are null are left out. */
export function Kv({ rows, className }: { rows: ([React.ReactNode, React.ReactNode] | null | false | undefined)[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]", className)}>
      {rows.filter(Boolean).map((row, i) => {
        const [k, v] = row as [React.ReactNode, React.ReactNode];
        return (
          <React.Fragment key={i}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words -mt-2 sm:mt-0">{v ?? "—"}</dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("bg-muted rounded px-1.5 py-0.5 font-mono text-[0.8rem] break-words", className)}>{children}</code>;
}

export function Pre({ children, className }: { children: React.ReactNode; className?: string }) {
  return <pre className={cn("bg-muted/50 max-h-[32rem] overflow-auto rounded-lg border p-4 font-mono text-xs leading-5", className)}>{children}</pre>;
}

export function Json({ value }: { value: unknown }) {
  return <Pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</Pre>;
}

export function Unknown() {
  return <CircleHelpIcon className="text-muted-foreground size-4" />;
}
