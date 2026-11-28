import * as React from "react";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "./bits";
import { PageSkeleton } from "@/App";
import { t } from "@/lib/strings.js";

/** Shows a skeleton while loading (after a short delay), the error with a retry, or the view. */
export function Loaded<T>({ state, children }: { state: { data?: T; error?: string; loading: boolean; reload: () => void }; children: (data: T) => React.ReactNode }) {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => { const id = setTimeout(() => setSlow(true), 140); return () => clearTimeout(id); }, []);
  if (state.error && state.data === undefined) {
    return <Empty icon={TriangleAlertIcon} title={t("load_failed")} body={state.error} action={<Button variant="outline" onClick={state.reload}><RefreshCwIcon />{t("retry")}</Button>} />;
  }
  if (state.data === undefined) return slow ? <PageSkeleton /> : null;
  // A page arrives with a short rise, once its data is in, so the motion marks real content arriving.
  return <div className="page-enter flex min-w-0 flex-col gap-6">{children(state.data)}</div>;
}
