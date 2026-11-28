// The page frame: sidebar navigation, a top bar with the trail, the checkout's
// revision, language and theme, and the current view.
import * as React from "react";
import {
  BookOpenIcon, ChevronRightIcon, ChevronsUpDownIcon, CpuIcon, FileTextIcon, GitBranchIcon, GitCompareArrowsIcon, LanguagesIcon, LayoutDashboardIcon, ListChecksIcon, MonitorIcon, MoonIcon, PlusIcon, ShieldCheckIcon, SunIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
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
  ["ref", [["system", "#/system", CpuIcon], ["docs", "#/docs", BookOpenIcon]]],
];

export type Theme = "system" | "light" | "dark";

// The current page reads as a raised tab on the sidebar; other entries keep quieter icons.
const NAV_ITEM = "text-sidebar-foreground/80 [&>svg]:text-muted-foreground data-[active=true]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground data-[active=true]:bg-background data-[active=true]:shadow-xs data-[active=true]:ring-1 data-[active=true]:ring-sidebar-border dark:data-[active=true]:bg-sidebar-accent";

const HREF: Record<string, string> = { ...Object.fromEntries(NAV.flatMap(([, items]) => items).map(([id, href]) => [id, href])), new: "#/new" };

function AppSidebar({ active, counts, repository, theme, setTheme, setLang }: {
  active?: string; counts: Record<string, number | undefined>; repository?: any;
  theme: Theme; setTheme: (t: Theme) => void; setLang: (l: string) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => { if (isMobile) setOpenMobile(false); };
  const lang = getLang();
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Tenric">
              <a href="#/" onClick={close}>
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"><ShieldCheckIcon className="size-4" /></div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Tenric</span>
                  <span className="text-muted-foreground truncate text-xs">{t("brand_sub")}</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={t("nav_new")} isActive={active === "new"}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground min-w-8 duration-200 ease-linear">
                  <a href="#/new" onClick={close}><PlusIcon /><span>{t("nav_new")}</span></a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {NAV.map(([group, items]) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{t(`nav_group_${group}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map(([id, href, Icon]) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton asChild isActive={id === active} tooltip={t(`nav_${id}`)} className={NAV_ITEM}>
                      <a href={href} onClick={close} aria-current={id === active ? "page" : undefined}><Icon /><span>{t(`nav_${id}`)}</span></a>
                    </SidebarMenuButton>
                    {counts[id] !== undefined ? <SidebarMenuBadge>{counts[id]}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip={t("local_only")} className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <div className="bg-sidebar-accent text-sidebar-accent-foreground relative flex aspect-square size-8 items-center justify-center rounded-lg">
                    <GitBranchIcon className="size-4" />
                    {repository?.revision ? <span className={cn("ring-sidebar absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2", repository.dirty ? "bg-warning" : "bg-success")} /> : null}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-mono text-xs font-medium">{repository?.revision ? repository.revision.slice(0, 10) : "—"}{repository?.dirty ? " · dirty" : ""}</span>
                    <span className="text-muted-foreground truncate text-xs">{lang === "zh" ? "中文" : "English"} · {t(theme === "dark" ? "theme_dark" : theme === "light" ? "theme_light" : "theme_auto")}</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal leading-relaxed">{t("local_only")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-2 text-xs"><LanguagesIcon className="size-3.5" />{t("language")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={lang} onValueChange={setLang}>
                  <DropdownMenuRadioItem value="zh">中文</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-2 text-xs"><SunIcon className="size-3.5" />{t("theme")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <DropdownMenuRadioItem value="system"><MonitorIcon />{t("theme_auto")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light"><SunIcon />{t("theme_light")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark"><MoonIcon />{t("theme_dark")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function Shell({ active, section, counts, repository, theme, setTheme, setLang, children }: {
  active?: string; section: string; counts: Record<string, number | undefined>; repository?: any;
  theme: Theme; setTheme: (t: Theme) => void; setLang: (l: string) => void; children: React.ReactNode;
}) {
  // A trail belongs to the page that set it; another page shows only its section.
  const [set, setSet] = React.useState<{ path: string; trail: Crumb[] }>({ path: "", trail: [] });
  const setTrail = React.useCallback((trail: Crumb[]) => setSet({ path: pathNow(), trail }), []);
  const trail = set.path === pathNow() ? set.trail : [];
  const crumbs: Crumb[] = [trail.length > 0 ? [section, (active && HREF[active]) || "#/"] : section, ...trail];

  return (
    <CrumbContext.Provider value={setTrail}>
      <SidebarProvider>
        <AppSidebar active={active} counts={counts} repository={repository} theme={theme} setTheme={setTheme} setLang={setLang} />
        <SidebarInset>
          <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:rounded-t-xl">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 !h-4" />
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
          </header>
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </CrumbContext.Provider>
  );
}
