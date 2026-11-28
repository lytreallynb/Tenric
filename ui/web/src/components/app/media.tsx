// Figures a run produced, shown as what they are: images from the run directory, served
// byte for byte by the interface's file endpoint. Nothing here draws or alters a figure.
import * as React from "react";
import { ExpandIcon, ImageOffIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api.js";
import { cn } from "@/lib/utils";

/** A run's figure as a thumbnail that opens full size. */
export function Figure({ run, path, caption, className, imgClassName, size = "md", eager }: {
  run: string; path: string; caption?: React.ReactNode; className?: string; imgClassName?: string; size?: "xs" | "md" | "lg"; eager?: boolean;
}) {
  const [broken, setBroken] = React.useState(false);
  const url = api.fileUrl(run, path);
  if (broken) {
    return (
      <div className={cn("text-muted-foreground bg-muted/40 flex aspect-square items-center justify-center rounded-md border border-dashed", className)} title={path}>
        <ImageOffIcon className={size === "xs" ? "size-3.5" : "size-5"} />
      </div>
    );
  }
  const img = <img src={url} alt={path} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(true)} className={cn("block h-full w-full object-contain", imgClassName)} />;
  if (size === "xs") {
    return <div className={cn("size-9 shrink-0 overflow-hidden rounded-[5px] border bg-white p-0.5", className)} title={path}>{img}</div>;
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={cn("group/figure relative block w-full overflow-hidden rounded-md border bg-white text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}>
          <div className={cn("h-full transition-transform duration-500 ease-out group-hover/figure:scale-[1.03]", size === "lg" ? "p-3" : "p-2")}>{img}</div>
          <span className="pointer-events-none absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/figure:opacity-100 group-focus-visible/figure:opacity-100">
            <ExpandIcon className="size-3.5" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-3 p-3 sm:max-w-4xl">
        <DialogTitle className="sr-only">{path}</DialogTitle>
        <DialogDescription className="sr-only">{run}</DialogDescription>
        <div className="overflow-auto rounded-md bg-white"><img src={url} alt={path} className="mx-auto max-h-[78svh] w-auto" /></div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
          <span className="font-mono">runs/{run}/{path}</span>
          {caption}
        </div>
      </DialogContent>
    </Dialog>
  );
}
