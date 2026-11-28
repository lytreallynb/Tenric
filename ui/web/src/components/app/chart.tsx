// Chart helpers in the style of shadcn/ui charts: Recharts underneath, colours
// from the theme tokens, a card-like tooltip.
import * as React from "react";

export const VERDICT_COLOR: Record<string, string> = {
  accepted: "var(--success)",
  rejected: "var(--destructive)",
  inconclusive: "var(--warning)",
  none: "var(--muted-foreground)",
};

export function ChartTip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background grid min-w-32 gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      {label !== undefined && label !== "" ? <div className="font-medium">{label}</div> : null}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: p.payload?.fill ?? p.color ?? p.fill }} />
          <span className="text-muted-foreground flex-1">{p.payload?.label ?? p.name}</span>
          <span className="font-mono font-medium tabular-nums">{format ? format(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartBox({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={"text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-surface]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted " + (className ?? "")}>{children}</div>;
}
