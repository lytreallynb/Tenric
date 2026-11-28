import * as React from "react";
import { RefreshCwIcon, TriangleAlertIcon, CircleHelpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell, type Theme } from "@/components/app/shell";
import { Empty } from "@/components/app/bits";
import { Toaster } from "@/components/app/toast";
import { api } from "@/lib/api.js";
import { setLang as storeLang, t } from "@/lib/strings.js";
import { useHashRoute } from "@/lib/router";
import { Overview } from "@/views/overview";
import { RunList } from "@/views/runs";
import { RunDetail } from "@/views/run";
import { Compare } from "@/views/compare";
import { ContractList, ContractDetail } from "@/views/contracts";
import { NewRun } from "@/views/newrun";
import { System } from "@/views/system";
import { Docs } from "@/views/docs";

type View = React.ComponentType<{ args: (string | undefined)[]; query: URLSearchParams }>;
const routes: { nav: string; pattern: RegExp; view: View }[] = [
  { nav: "overview", pattern: /^\/$/, view: Overview },
  { nav: "contracts", pattern: /^\/contracts$/, view: ContractList },
  { nav: "contracts", pattern: /^\/contracts\/([^/]+)\/([^/]+)$/, view: ContractDetail },
  { nav: "runs", pattern: /^\/runs$/, view: RunList },
  { nav: "runs", pattern: /^\/runs\/([^/]+)(?:\/([a-z]+))?$/, view: RunDetail },
  { nav: "compare", pattern: /^\/compare$/, view: Compare },
  { nav: "new", pattern: /^\/new$/, view: NewRun },
  { nav: "system", pattern: /^\/system$/, view: System },
  { nav: "docs", pattern: /^\/docs(?:\/(.+))?$/, view: Docs },
];

function readTheme(): Theme {
  try { return (localStorage.getItem("tenric-ui-theme") as Theme) ?? "system"; } catch { return "system"; }
}
function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Catches a view that throws while rendering, so the frame stays usable. */
class Boundary extends React.Component<{ children: React.ReactNode; resetKey: string }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined }); }
  render() {
    if (this.state.error) return <Empty icon={TriangleAlertIcon} title={t("load_failed")} body={this.state.error.message} action={<Button variant="outline" onClick={() => location.reload()}><RefreshCwIcon />{t("retry")}</Button>} />;
    return this.props.children;
  }
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t("loading")}>
      <div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}

export default function App() {
  const { path, query } = useHashRoute();
  const [lang, setLangState] = React.useState(() => document.documentElement.lang);
  const [theme, setThemeState] = React.useState<Theme>(readTheme);
  const [facts, setFacts] = React.useState<any>(null);

  React.useEffect(() => { api.system().then(setFacts, () => {}); }, [path]);
  React.useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, [theme]);
  React.useEffect(() => { window.scrollTo(0, 0); }, [path]);

  const setTheme = (next: Theme) => { try { localStorage.setItem("tenric-ui-theme", next); } catch { /* not persisted */ } setThemeState(next); };
  const setLang = (next: string) => { storeLang(next); document.documentElement.lang = next; setLangState(next); };

  const route = routes.find((r) => r.pattern.test(path));
  const args = route ? route.pattern.exec(path)!.slice(1).map((p) => (p === undefined ? undefined : decodeURIComponent(p))) : [];
  const View = route?.view;
  return (
    <TooltipProvider delayDuration={200}>
      <Shell
        key={lang}
        active={route?.nav}
        section={route ? t(`nav_${route.nav}`) : t("not_found")}
        counts={{ runs: facts?.counts.runs, contracts: facts?.counts.contracts }}
        repository={facts?.repository}
        theme={theme}
        setTheme={setTheme}
        setLang={setLang}
      >
        <Boundary resetKey={path}>
          {View ? <View key={path} args={args} query={query} /> : <Empty icon={CircleHelpIcon} title={t("not_found")} body={path} action={<Button variant="outline" asChild><a href="#/">{t("nav_overview")}</a></Button>} />}
        </Boundary>
      </Shell>
      <Toaster />
    </TooltipProvider>
  );
}
