"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { dashboardHealth, notifications as notificationsClient } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

const TABS = [
  { href: "/",          label: "Home",      icon: "Home" as const },
  { href: "/wiki",      label: "Wiki",      icon: "BookOpen" as const },
  { href: "/sessions",  label: "Sessions",  icon: "Terminal" as const },
  { href: "/projects",  label: "Projects",  icon: "FolderGit2" as const },
  { href: "/system",    label: "System",    icon: "Cpu" as const },
  { href: "/reminders", label: "Reminders", icon: "BellRing" as const },
  { href: "/orb",       label: "Orb",       icon: "Orbit" as const },
];

export function TopBar({ activeTab }: { activeTab: string }) {
  const health = useQuery({
    queryKey: ["dashboard-health"],
    queryFn: dashboardHealth,
    refetchInterval: 5_000,
  });
  const notifs = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => notificationsClient(20),
    refetchInterval: 10_000,
  });

  const unread = health.data?.unread_notifications ?? 0;
  const rollup = health.data?.rollup ?? "ok";
  const rollupLabel =
    rollup === "ok" ? "all systems online" : rollup === "warn" ? "degraded" : "failure";

  return (
    <header className="flex flex-col">
      <div className="flex items-center h-14 px-5 hairline-soft">
        <div className="flex items-center gap-2 relative brand-glow">
          <div className="w-8 h-8 rounded-card bg-brand/10 ring-1 ring-brand/30 grid place-items-center">
            <Icon name="Brain" className="text-brandSoft" size={20} />
          </div>
          <div className="font-display font-semibold tracking-tight text-[15px] text-txt1">
            DevNeural
          </div>
          <div className="text-txt3 text-[11px] uppercase tracking-[0.14em] font-medium ml-1 mt-0.5">
            Hub
          </div>
        </div>

        <div className="flex-1 max-w-2xl mx-4">
          <div className="group flex items-center gap-2.5 h-9 px-3 rounded-card bg-surface1 hairline focus-within:ring-1 focus-within:ring-brand/60 transition">
            <Icon name="Search" className="text-txt3" size={16} />
            <label htmlFor="global-search" className="sr-only">
              Search wiki, sessions, projects, reference docs
            </label>
            <input
              id="global-search"
              name="global-search"
              type="search"
              placeholder="Search wiki, sessions, projects, reference docs..."
              className="bg-transparent flex-1 text-sm placeholder:text-txt3 outline-none text-txt1"
            />
            <kbd className="hidden md:inline-flex items-center gap-1 px-1.5 h-5 rounded border border-border1 bg-surface2 text-[11px] font-mono text-txt2">
              ⌘ K
            </kbd>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            aria-label={`Notifications (${unread} unread)`}
            className="lift relative w-9 h-9 rounded-card hairline grid place-items-center text-txt2 hover:text-txt1"
          >
            <Icon name="Bell" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-pill bg-brand text-[9px] font-mono text-base grid place-items-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button
            aria-label="Settings"
            className="lift w-9 h-9 rounded-card hairline grid place-items-center text-txt2 hover:text-txt1"
          >
            <Icon name="Settings" />
          </button>
          <div
            className={`flex items-center gap-1.5 h-9 px-3 rounded-pill hairline shimmer-pill text-[11px] font-mono ${
              rollup === "ok" ? "text-ok" : rollup === "warn" ? "text-warn" : "text-err"
            }`}
          >
            <StatusDot status={rollup === "fail" ? "fail" : rollup} pulse={rollup === "ok"} />
            {rollupLabel}
          </div>
          {notifs.data ? null : null /* keep query alive for badge prefetch */}
        </div>
      </div>

      <nav className="flex items-center h-11 px-5 hairline-soft border-t border-border2">
        <div className="flex gap-6 -mb-px">
          {TABS.map((t) => {
            const isActive = t.href === activeTab;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`relative py-3 text-sm font-medium flex items-center gap-2 ${
                  isActive ? "text-txt1 tab-active" : "text-txt2 hover:text-txt1"
                }`}
              >
                <Icon name={t.icon} size={16} /> {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
