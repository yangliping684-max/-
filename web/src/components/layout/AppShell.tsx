import { AnimatePresence, motion } from "framer-motion";
import {
  Bell, History, LayoutDashboard, Monitor, Moon, MoreHorizontal, Newspaper, RefreshCw, Radar, Search, Settings,
  SlidersHorizontal, Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { Kbd } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import { applyTheme, setPrefs, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

export const NAV = [
  { to: "/", label: "总览", en: "Dashboard", icon: LayoutDashboard },
  { to: "/feed", label: "情报中心", en: "Feed", icon: Newspaper },
  { to: "/sources", label: "我的监控", en: "Sources", icon: Radar },
  { to: "/rules", label: "情报规则", en: "Rules", icon: SlidersHorizontal },
  { to: "/history", label: "历史记录", en: "History", icon: History },
  { to: "/notifications", label: "通知中心", en: "Notifications", icon: Bell },
  { to: "/settings", label: "系统设置", en: "Settings", icon: Settings },
] as const;

function useUnreadNotifications(): number {
  const { data } = useData();
  const { notificationsSeenAt } = usePrefs();
  return useMemo(
    () => data.notifications.filter((n) => Date.parse(n.created_at) > notificationsSeenAt).length,
    [data.notifications, notificationsSeenAt],
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-7 rounded-lg" />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">知更</div>
          <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground">ChangeRadar</div>
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const unread = useUnreadNotifications();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[68px] shrink-0 flex-col border-r border-border bg-surface md:flex lg:w-60">
      <div className="flex h-14 items-center px-4 lg:px-5">
        <span className="lg:hidden"><Logo compact /></span>
        <span className="hidden lg:block"><Logo /></span>
      </div>
      <nav className="flex-1 space-y-0.5 px-2.5 py-3 lg:px-3" aria-label="主导航">
        {NAV.map(({ to, label, en, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) => cn(
              "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "justify-center lg:justify-start",
              isActive && "bg-card text-foreground shadow-card ring-1 ring-border",
            )}
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("size-[18px] shrink-0", isActive && "text-accent")} />
                <span className="hidden lg:inline">{label}</span>
                <span className="ml-auto hidden text-[10.5px] font-normal text-muted-foreground/60 lg:group-hover:inline">{en}</span>
                {to === "/notifications" && unread > 0 && (
                  <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground lg:static lg:ml-auto">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="hidden border-t border-border px-5 py-4 text-[11.5px] leading-relaxed text-muted-foreground lg:block">
        <div className="font-medium text-foreground/80">Stay Informed. Stay Ahead.</div>
        重要的变化，值得被看见。
      </div>
    </aside>
  );
}

function MobileTabBar() {
  const navigate = useNavigate();
  const primary = NAV.slice(0, 4);
  const rest = NAV.slice(4);
  const unread = useUnreadNotifications();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="主导航">
      <div className="grid grid-cols-5">
        {primary.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground", isActive && "text-accent")}
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
        <DropdownMenu>
          <DropdownTrigger className="relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground outline-none">
            <MoreHorizontal className="size-5" />
            更多
            {unread > 0 && <span className="absolute right-[30%] top-1.5 size-2 rounded-full bg-accent" />}
          </DropdownTrigger>
          <DropdownContent>
            {rest.map(({ to, label, icon: Icon }) => (
              <DropdownItem key={to} onSelect={() => navigate(to)}>
                <Icon /> {label}
                {to === "/notifications" && unread > 0 && <span className="ml-auto text-xs text-accent">{unread}</span>}
              </DropdownItem>
            ))}
          </DropdownContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!location.pathname.startsWith("/feed")) setQ("");
  }, [location.pathname]);

  return (
    <form
      role="search"
      className="relative w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        const params = new URLSearchParams({ q: q.trim(), view: "all" });
        navigate(`/feed?${params.toString()}`);
        ref.current?.blur();
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索情报标题、摘要、来源、关键词…"
        aria-label="全局搜索"
        className="h-10 w-full rounded-xl border border-border bg-muted/60 pl-9 pr-16 text-sm outline-none transition-all placeholder:text-muted-foreground/80 focus:border-accent/50 focus:bg-card focus:ring-4 focus:ring-accent/10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>⌘K</Kbd></span>
    </form>
  );
}

function ThemeMenu() {
  const { theme } = usePrefs();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const set = (t: typeof theme) => {
    setPrefs({ theme: t });
    applyTheme(t);
  };
  return (
    <DropdownMenu>
      <Tooltip content="外观">
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="切换外观"><Icon /></Button>
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent>
        <DropdownItem onSelect={() => set("light")}><Sun /> 浅色</DropdownItem>
        <DropdownItem onSelect={() => set("dark")}><Moon /> 深色</DropdownItem>
        <DropdownItem onSelect={() => set("system")}><Monitor /> 跟随系统</DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

function Topbar() {
  const { data, loading, reload } = useData();
  const navigate = useNavigate();
  const unread = useUnreadNotifications();
  const lastRun = data.status?.last_run?.finished_at ?? null;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <span className="md:hidden"><Logo compact /></span>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-1">
          <Tooltip content={lastRun ? `数据来自 ${relativeTime(lastRun)} 的监控运行。点击重新载入已发布的数据文件（不会触发新的监控）。` : "重新载入已发布的数据文件"}>
            <Button variant="ghost" size="icon" aria-label="重新载入数据" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
          </Tooltip>
          <ThemeMenu />
          <Tooltip content="通知中心">
            <Button variant="ghost" size="icon" className="relative hidden md:inline-flex" aria-label="通知中心" onClick={() => navigate("/notifications")}>
              <Bell />
              {unread > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-background" />}
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { theme } = usePrefs();
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
  useEffect(() => window.scrollTo(0, 0), [location.pathname]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
