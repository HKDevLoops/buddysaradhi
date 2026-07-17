"use client";

// Implements: UI/web/03_Dashboard.md — Aurora Cosmic glass shell
// GlassShell — the persistent 5-screen layout wrapping all app pages.
// Sidebar + topbar + main + sticky-footer.

import React, { useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Wallet,
  Settings,
  Search,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellStore, ScreenId } from "@/stores/shell-store";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";
import { getPendingSyncCount } from "@/server/queries/sync";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/students", label: "Students", icon: Users },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/fees", label: "Fees & Payments", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function GlassShell({ children }: { children: React.ReactNode }) {
  const { activeScreen, setActiveScreen } = useShellStore();
  
  const { data: syncData } = useQuery({
    queryKey: ["pendingSyncCount"],
    queryFn: () => getPendingSyncCount(),
    refetchInterval: 10000, // Sync outbox query polling interval (10s)
  });
  
  const pendingSyncCount = syncData?.count ?? 0;
  const isOffline = false;

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });
  const instituteName = settingsData?.data?.instituteName || "Tuition Centre";

  const currentNavItem = NAV_ITEMS.find((item) => item.href === activeScreen);
  const activeLabel = currentNavItem ? currentNavItem.label : "Dashboard";

  useEffect(() => {
    if (typeof window !== "undefined") {
      document.title = `${instituteName} — BuddySaradhi`;
    }
  }, [instituteName]);

  return (
    <>
      {/* Liquid Glass Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" style={{ background: "var(--bg-canvas)" }}>
        {/* Animated Liquid Blobs */}
        <div className="absolute top-[10%] left-[10%] w-[45vw] h-[45vw] rounded-full filter blur-[65px] opacity-[0.12] animate-blob-1" style={{ background: "var(--accent-primary)" }} />
        <div className="absolute bottom-[10%] right-[10%] w-[50vw] h-[50vw] rounded-full filter blur-[75px] opacity-[0.12] animate-blob-2" style={{ background: "var(--accent-secondary)" }} />
        <div className="absolute top-[35%] right-[25%] w-[40vw] h-[40vw] rounded-full filter blur-[70px] opacity-[0.10] animate-blob-3" style={{ background: "var(--accent-tertiary, var(--accent-primary))" }} />
      </div>

      <div
        className="min-h-[100dvh] flex flex-col md:flex-row overflow-hidden selection:bg-emerald/30 relative z-10 w-full"
        style={{ background: "transparent", color: "var(--text-primary)" }}
      >
        {/* Sidebar — glass panel */}
        <aside
          className="hidden md:flex md:w-64 md:flex-col z-20 shrink-0"
          style={{
            background: "var(--surface-glass)",
            backdropFilter: "blur(20px)",
            borderRight: "1px solid var(--border-glass)",
          }}
        >
          {/* Logo */}
          <div
            className="h-16 flex items-center px-6 shrink-0"
            style={{ borderBottom: "1px solid var(--border-glass)" }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shadow-lg"
              style={{
                background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
                color: "var(--text-on-accent)",
                fontFamily: "var(--font-heading)",
              }}
            >
              T
            </div>
            <span
              className="ml-3 font-semibold tracking-wide text-sm truncate max-w-[150px]"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              {instituteName}
            </span>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-4 py-6 space-y-1" role="navigation" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = activeScreen === item.href;
              return (
                <button
                  key={item.href}
                  onClick={() => setActiveScreen(item.href as ScreenId)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group text-left",
                    "min-h-[44px]"
                  )}
                  style={
                    isActive
                      ? {
                          background: `color-mix(in srgb, var(--accent-primary) 12%, transparent)`,
                          color: "var(--accent-primary)",
                          border: `1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)`,
                        }
                      : {
                          color: "var(--text-secondary)",
                          border: "1px solid transparent",
                        }
                  }
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "var(--surface-glass)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  <item.icon
                    className="w-5 h-5 shrink-0"
                    style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-sm">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Sync + search bottom area */}
          <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--border-glass)" }}>
            <div
              className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer rounded-lg transition-all duration-150"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Sync
              </span>
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--accent-success)", boxShadow: "0 0 6px var(--accent-success)" }}
                title="Online"
              />
            </div>
            <div
              className="mt-2 flex items-center justify-between px-3 py-2 text-sm rounded-lg cursor-pointer transition-all duration-150"
              style={{ background: "var(--bg-surface-inset)", color: "var(--text-muted)" }}
            >
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4" aria-hidden="true" />
                Search...
              </span>
              <kbd
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--surface-glass)",
                  border: "1px solid var(--border-glass)",
                  color: "var(--text-muted)",
                }}
              >
                ⌘K
              </kbd>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-auto md:h-screen relative z-10 min-w-0 min-h-0">

          {/* Topbar */}
          <header
            className="h-16 flex items-center justify-between px-4 sm:px-6 md:px-8 shrink-0"
            style={{
              background: "var(--surface-glass)",
              backdropFilter: "blur(20px)",
              borderBottom: "1px solid var(--border-glass)",
            }}
          >
            <div className="flex items-center">
              <h2
                className="text-base font-semibold truncate max-w-[200px]"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                {activeLabel}
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-64 relative hidden md:block">
                <Search
                  className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--text-muted)" }}
                  aria-hidden="true"
                />
                <input
                  type="search"
                  placeholder="Find a student..."
                  aria-label="Search students"
                  className="w-full py-1.5 pl-9 pr-4 text-sm rounded-full transition-all focus:outline-none"
                  style={{
                    background: "var(--bg-surface-inset)",
                    border: "1px solid var(--border-glass)",
                    color: "var(--text-primary)",
                    minHeight: "36px",
                  }}
                />
              </div>
              {/* Avatar */}
              <div
                className="w-9 h-9 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-xs font-semibold cursor-pointer transition-all"
                style={{
                  background: `color-mix(in srgb, var(--accent-primary) 15%, var(--bg-surface-raised))`,
                  border: "2px solid var(--border-glass-strong)",
                  color: "var(--accent-primary)",
                  fontFamily: "var(--font-mono)",
                }}
                role="button"
                aria-label="User profile"
                tabIndex={0}
              >
                RS
              </div>
            </div>
          </header>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-auto flex flex-col no-scrollbar" role="main">
            <main className="flex-1 p-4 sm:p-6 md:p-8 pb-16 md:pb-8 relative">
              {children}
            </main>

            {/* Sticky Footer — always visible (desktop) */}
            <footer
              className="h-12 flex items-center justify-between px-4 sm:px-6 md:px-8 text-xs shrink-0 mt-auto"
              style={{
                background: "var(--surface-glass-faint)",
                backdropFilter: "blur(8px)",
                borderTop: "1px solid var(--border-glass)",
                color: "var(--text-muted)",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              <div className="flex gap-4 items-center">
                {isOffline
                  ? <><WifiOff className="w-3 h-3" aria-hidden="true" /> <span>Offline · {pendingSyncCount} pending</span></>
                  : <><Wifi className="w-3 h-3" style={{ color: "var(--accent-success)" }} aria-hidden="true" /> <span>Online · {pendingSyncCount} pending</span></>
                }
                <span style={{ fontFamily: "var(--font-mono)" }}>Local DB: 2.1 MB</span>
              </div>
              <div className="flex gap-4">
                <span style={{ fontFamily: "var(--font-mono)" }}>v1.0.0-rc</span>
                <span>© 2026 BuddySaradhi</span>
              </div>
            </footer>
          </div>
        </div>

        {/* Mobile bottom-tab navigation — visible only below md */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch justify-around"
          style={{
            background: "var(--surface-glass)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid var(--border-glass)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          aria-label="Primary"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeScreen === item.href;
            return (
              <button
                key={item.href}
                onClick={() => setActiveScreen(item.href as ScreenId)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]"
                style={
                  isActive
                    ? { color: "var(--accent-primary)" }
                    : { color: "var(--text-muted)" }
                }
              >
                <item.icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="text-[10px] font-medium leading-none">{item.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}
