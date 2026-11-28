// A data table on TanStack Table with the shadcn/ui table: sorting, paging and
// row selection. On a narrow screen each row becomes a card.
import * as React from "react";
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowSelectionState, type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsUpDownIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/lib/strings.js";

export type Meta = { className?: string; align?: "right"; hideOnMobile?: boolean; label?: string };

export function SortHeader({ column, children }: { column: any; children: React.ReactNode }) {
  const dir = column.getIsSorted();
  return (
    <Button variant="ghost" size="sm" className="-ml-3 h-8 data-[state=open]:bg-accent" onClick={() => column.toggleSorting(dir === "asc")}>
      {children}
      {dir === "asc" ? <ArrowUpIcon /> : dir === "desc" ? <ArrowDownIcon /> : <ChevronsUpDownIcon className="opacity-50" />}
    </Button>
  );
}

export function DataTable<T>({ columns, data, empty, onRowClick, pageSize = 20, getRowId, rowSelection, onRowSelectionChange, enableRowSelection, initialSorting, rowClassName }: {
  columns: ColumnDef<T, any>[]; data: T[]; empty?: React.ReactNode; onRowClick?: (row: T) => void; pageSize?: number;
  getRowId?: (row: T) => string; rowSelection?: RowSelectionState; onRowSelectionChange?: (s: RowSelectionState) => void;
  enableRowSelection?: (row: T) => boolean; initialSorting?: SortingState; rowClassName?: (row: T) => string | undefined;
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const table = useReactTable({
    data, columns, getRowId,
    state: { sorting, ...(rowSelection ? { rowSelection } : {}) },
    onSortingChange: setSorting,
    onRowSelectionChange: onRowSelectionChange ? (updater) => onRowSelectionChange(typeof updater === "function" ? updater(rowSelection ?? {}) : updater) : undefined,
    enableRowSelection: enableRowSelection ? (row) => enableRowSelection(row.original) : Boolean(onRowSelectionChange),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: false,
  });
  const rows = table.getRowModel().rows;
  const meta = (c: any): Meta => (c.columnDef.meta ?? {}) as Meta;
  const labelOf = (c: any) => meta(c).label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : "");

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border">
        <Table className="max-md:block">
          <TableHeader className="bg-muted/50 max-md:hidden">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead key={header.id} className={cn("first:pl-4 last:pr-4", meta(header.column).align === "right" && "text-right", meta(header.column).className)}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="max-md:block">
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent max-md:block"><TableCell colSpan={columns.length} className="p-4 max-md:block">{empty ?? <div className="text-muted-foreground py-6 text-center">{t("nothing_here")}</div>}</TableCell></TableRow>
            ) : rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn(onRowClick && "cursor-pointer", "max-md:grid max-md:grid-cols-[auto_1fr] max-md:gap-x-4 max-md:gap-y-1.5 max-md:p-4", rowClassName?.(row.original))}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const m = meta(cell.column);
                  const label = labelOf(cell.column);
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn("first:pl-4 last:pr-4", m.align === "right" && "text-right tabular-nums", m.className,
                        "max-md:contents", m.hideOnMobile && "max-md:hidden")}
                    >
                      {label ? <span className="text-muted-foreground text-xs md:hidden self-center">{label}</span> : <span className="md:hidden" />}
                      <span className="max-md:min-w-0 max-md:text-left max-md:whitespace-normal max-md:break-words">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground mr-2 tabular-nums">{table.getState().pagination.pageIndex + 1} / {table.getPageCount()}</span>
          <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="previous"><ChevronLeftIcon /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="next"><ChevronRightIcon /></Button>
        </div>
      ) : null}
    </div>
  );
}

/** A plain shadcn/ui table for small, fixed lists. Cells are given as rows of nodes. */
export function SimpleTable({ head, rows, empty, align }: { head: React.ReactNode[]; rows: React.ReactNode[][]; empty?: React.ReactNode; align?: ("right" | undefined)[] }) {
  if (rows.length === 0) return <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">{empty ?? t("nothing_here")}</div>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">{head.map((h, i) => <TableHead key={i} className={cn("first:pl-4 last:pr-4", align?.[i] === "right" && "text-right")}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={cn("first:pl-4 last:pr-4 whitespace-normal", align?.[j] === "right" && "text-right tabular-nums")}>{c}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
    </div>
  );
}
