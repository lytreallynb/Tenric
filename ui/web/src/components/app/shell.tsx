// The page frame: sidebar navigation, a top bar with the trail, the checkout's
// revision, language and theme, and the current view.
import * as React from "react";
import {
  BookOpenIcon, BoxesIcon, ChevronRightIcon, CpuIcon, FileTextIcon, GitCompareArrowsIcon, LanguagesIcon, LayoutDashboardIcon, ListChecksIcon, MenuIcon, MonitorIcon, MoonIcon, PlayIcon, ShieldCheckIcon, SunIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getLang, t } from "@/lib/strings.js";

export type Crumb = string | [string, string];
const CrumbContext = React.createContext<(trail: Crumb[]) => void>(() => {});
const pathNow = () => (location.hash.slice(1) || "/").split("?")[0]!.replace(/^(\/runs\/[^/]+)\/[a-z]+$/, "$1");
/** A view calls this with what follows the section name in the trail. */
export function useCrumbs(trail: Crumb[]) {
  const set = React.useContext(CrumbContext);
  const key = JSON.stringify(trail);
  React.useEffect(() => { set(trail); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const NAV: [string, [string, string, React.ElementType][]][] = [
  ["inspect", [["overview", "#/", LayoutDashboardIcon], ["runs", "#/runs", ListChecksIcon], ["compare", "#/compare", GitCompareArrowsIcon], ["contracts", "#/contracts", FileTextIcon]]],
  ["act", [["new", "#/new", PlayIcon]]],
  ["ref", [["system", "#/system", CpuIcon], ["docs", "#/docs", BookOpenIcon]]],
];

function Brand() {
  return (
    <a href="#/" className="flex items-center gap-2 px-2 py-1.5">
      <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg"><ShieldCheckIcon className="size-4" /></div>
      <div className="grid flex-1 text-left leading-tight">
        <span className="truncate text-sm font-semibold">Tenric</span>
        <span className="text-muted-foreground truncate text-xs">{t("brand_sub")}</span>
      </div>
    </a>
  );
}

function NavList({ active, counts, onNavigate }: { active?: string; counts: Record<string, number | undefined>; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-1">
          <div className="text-sidebar-foreground/70 px-2 text-xs font-medium">{t(`nav_group_${group}`)}</div>
          {items.map(([id, href, Icon]) => (
            <a
              key={id}
              href={href}
              onClick={onNavigate}
              aria-current={id === active ? "page" : undefined}
              className={cn(
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
                id === active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{t(`nav_${id}`)}</span>
              {counts[id] !== undefined ? <span className="text-muted-foreground text-xs tabular-nums">{counts[id]}</span> : null}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({ active, counts, onNavigate }: { active?: string; counts: Record<string, number | undefined>; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-2">
      <Brand />
      <div className="flex-1 overflow-y-auto"><NavList active={active} counts={counts} onNavigate={onNavigate} /></div>
      <div className="text-muted-foreground flex items-start gap-2 rounded-md border bg-background/60 p-3 text-xs leading-relaxed">
        <BoxesIcon className="mt-0.5 size-3.5 shrink-0" />{t("local_only")}
      </div>
    </div>
  );
}

export type Theme = "system" | "light" | "dark";

export function Shell({ active, section, counts, repository, theme, setTheme, setLang, children }: {
  active?: string; section: string; counts: Record<string, number | undefined>; repository?: any;
  theme: Theme; setTheme: (t: Theme) => void; setLang: (l: string) => void; children: React.ReactNode;
}) {
  // A trail belongs to the page that set it; another page shows only its section.
  const [set, setSet] = React.useState<{ path: string; trail: Crumb[] }>({ path: "", trail: [] });
  const setTrail = React.useCallback((trail: Crumb[]) => setSet({ path: pathNow(), trail }), []);
  const trail = set.path === pathNow() ? set.trail : [];
  const [open, setOpen] = React.useState(false);
  const lang = getLang();
  const ThemeIcon = theme === "dark" ? MoonIcon : theme === "light" ? SunIcon : MonitorIcon;
  const crumbs: Crumb[] = [trail.length > 0 ? [section, NAV.flatMap(([, items]) => items).find(([id]) => id === active)?.[1] ?? "#/"] : section, ...trail];

  return (
    <CrumbContext.Provider value={setTrail}>
      <div className="bg-sidebar flex min-h-svh">
        <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-svh w-64 shrink-0 md:block">
          <SidebarBody active={active} counts={counts} />
        </aside>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="bg-sidebar w-72 p-0">
            <SheetTitle className="sr-only">Tenric</SheetTitle>
            <SheetDescription className="sr-only">{t("nav_group_inspect")}</SheetDescription>
            <SidebarBody active={active} counts={counts} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="bg-background flex min-w-0 flex-1 flex-col md:m-2 md:ml-0 md:rounded-xl md:border md:shadow-sm">
          <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:rounded-t-xl">
            <Button variant="ghost" size="icon-sm" className="-ml-1 md:hidden" onClick={() => setOpen(true)} aria-label="Menu"><MenuIcon /></Button>
            <Separator orientation="vertical" className="mr-1 !h-4 md:hidden" />
            <nav aria-label="breadcrumb" className="min-w-0 flex-1">
              <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <React.Fragment key={i}>
                      {i > 0 ? <ChevronRightIcon className="size-3.5 shrink-0" /> : null}
                      <li className={cn("min-w-0 truncate", last && "text-foreground font-medium", !last && i > 0 && "hidden sm:block")}>
                        {Array.isArray(c) ? <a href={c[1]} className="hover:text-foreground transition-colors">{c[0]}</a> : c}
                      </li>
                    </React.Fragment>
                  );
                })}
              </ol>
            </nav>
            {repository?.revision ? (
              <Badge variant="outline" className="hidden gap-1.5 font-mono font-normal lg:inline-flex" title={repository.revision}>
                <span className={cn("size-1.5 rounded-full", repository.dirty ? "bg-warning" : "bg-success")} />
                {repository.revision.slice(0, 10)}{repository.dirty ? " · dirty" : ""}
              </Badge>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={t("language")}><LanguagesIcon />{lang === "zh" ? "中文" : "EN"}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={lang} onValueChange={setLang}>
                  <DropdownMenuRadioItem value="zh">中文</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("theme")}><ThemeIcon /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">{t("theme")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <DropdownMenuRadioItem value="system"><MonitorIcon />{t("theme_auto")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light"><SunIcon />{t("theme_light")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark"><MoonIcon />{t("theme_dark")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}

