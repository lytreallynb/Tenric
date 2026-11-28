export const num = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, "")) : v === null || v === undefined ? "—" : String(v));
export const bytes = (n: unknown) => (typeof n !== "number" ? "—" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`);
export const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
export function when(iso?: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { hour12: false });
}
export function ago(iso?: string | null) {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (Number.isNaN(s)) return iso;
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: "auto" });
  if (s < 60) return rtf.format(-Math.round(s), "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
export function whenShort(iso?: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
