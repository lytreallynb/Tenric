// A run's verdict as the verifier reported it, one cell per requirement in contract order.
// The colours only restate each requirement's status; the verdict itself is shown elsewhere
// in the verifier's own words.
import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Cell = { id: string; title?: string; level?: string; status: string };

const FILL: Record<string, string> = {
  pass: "bg-success",
  fail: "bg-destructive",
  error: "bg-destructive/60 bg-[repeating-linear-gradient(135deg,transparent_0_2px,rgb(0_0_0/0.18)_2px_4px)]",
  not_run: "bg-warning",
};

/** Cells for one run. `size="sm"` fits a table row; `"lg"` carries the requirement ids. */
export function Fingerprint({ cells, size = "sm", animate = true, className }: { cells: Cell[]; size?: "sm" | "lg"; animate?: boolean; className?: string }) {
  if (cells.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className={cn("flex flex-wrap items-center", size === "sm" ? "gap-[3px]" : "gap-1.5", className)} role="list">
      {cells.map((c, i) => {
        const advisory = c.level === "advisory";
        const cell = (
          <div
            role="listitem"
            aria-label={`${c.id} ${c.status}`}
            style={{ "--i": i } as React.CSSProperties}
            className={cn(
              animate && "cell-in",
              size === "sm" ? "h-3.5 w-2 rounded-[2px]" : "flex h-6 items-center justify-center rounded-[4px] px-1.5 font-mono text-[11px] font-medium text-white/95",
              FILL[c.status] ?? "bg-muted-foreground/30",
              advisory && "opacity-45",
            )}
          >
            {size === "lg" ? c.id : null}
          </div>
        );
        return (
          <Tooltip key={c.id}>
            <TooltipTrigger asChild>{cell}</TooltipTrigger>
            <TooltipContent className="max-w-72">
              <div className="font-mono text-[11px] opacity-80">{c.id} · {c.level ?? "mandatory"} · {c.status}</div>
              {c.title ? <div className="mt-0.5">{c.title}</div> : null}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** The cells of a run summary from the list endpoint, or of a full verdict record. */
export const cellsOfSummary = (run: any): Cell[] => run?.verification?.requirements ?? [];
export const cellsOfRecord = (record: any): Cell[] =>
  (record?.results ?? []).map((r: any) => ({ id: r.requirement, title: r.title, level: r.level, status: r.status }));
