"use client";

// Implements: UI/web/03_Dashboard.md — Aurora Cosmic glass shell
// GlassShell — the persistent 5-screen layout wrapping all app pages.
// Sidebar + topbar + main + sticky-footer.

import React, { useEffect, useRef, useState } from "react";
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
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellStore, ScreenId } from "@/stores/shell-store";
import { useStudentsStore } from "@/stores/students-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";
import { getPendingSyncCount } from "@/server/queries/sync";
import { signOutAction } from "@/server/actions/signout";
import { StudentSearchBox } from "@/components/search/student-search-box";
import { useSearchCandidates } from "@/components/search/use-search-candidates";
import { clearAllQueues } from "@/lib/offline-queue";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/students", label: "Students", icon: Users },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/fees", label: "Fees & Payments", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function GlassShell({ children }: { children: React.ReactNode }) {
  const { activeScreen, setActiveScreen } = useShellStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const queryClient = useQueryClient();

  const onSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setMenuOpen(false);
    queryClient.clear();
    // RFC-004 C3: queued intents are per-tenant; a shared-device sign-out
    // must not leave another tenant's intents to replay after logout.
    clearAllQueues();
    try {
      await signOutAction();
    } catch (err) {
      setIsSigningOut(false);
      window.location.assign("/login");
    }
  };

  const { data: syncData, refetch: refetchSync } = useQuery({
    queryKey: ["pendingSyncCount"],
    queryFn: () => getPendingSyncCount(),
    // RFC-003 §0 + RFC-004 C6: no polling on metered tiers. Refresh on
    // network transitions, visibility, and focus instead of a 10s interval.
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });

  // Re-check the outbox count when connectivity or visibility changes —
  // the event-driven replacement for the old 10s poll.
  useEffect(() => {
    const refresh = () => { void refetchSync(); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refetchSync]);

  const pendingSyncCount = syncData?.count ?? 0;
  // Real connectivity state (was hardcoded `false`): drives the offline badge
  // and gates queue-vs-direct mutation paths (RFC-004 C3).
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const isOffline = !isOnline;

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });
  const instituteName = settingsData?.data?.instituteName || "Tuition Centre";

  const currentNavItem = NAV_ITEMS.find((item) => item.href === activeScreen);
  const activeLabel = currentNavItem ? currentNavItem.label : "Dashboard";

  // docs/design/overhaul-plan.md §3 — one engine, one candidate source, one keyboard path.
  // The topbar field IS the ⌘K palette: the shortcut and the sidebar row both focus this
  // same instance, so there is no second command surface to keep in sync.
  const { candidates, error: searchError } = useSearchCandidates();
  const openStudent = useStudentsStore((s) => s.openDrawer);
  const searchInputRef = useRef<HTMLDivElement>(null);
  const [paletteQuery, setPaletteQuery] = useState("");

  const focusPalette = () => {
    const field = searchInputRef.current?.querySelector("input");
    field?.focus();
    field?.select();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      focusPalette();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onPickStudent = (studentId: string) => {
    openStudent(studentId);
    setActiveScreen("/students");
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      document.title = `${instituteName} — BuddySaradhi`;
    }
  }, [instituteName]);

  return (
    <>
      {/* Liquid Glass Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" style={{ background: "var(--canvas)" }}>
        {/* Animated Liquid Blobs */}
        <div className="absolute top-[10%] left-[10%] w-[45vw] h-[45vw] rounded-full filter blur-[65px] opacity-[0.12] animate-blob-1" style={{ background: "var(--accent-primary)" }} />
        <div className="absolute bottom-[10%] right-[10%] w-[50vw] h-[50vw] rounded-full filter blur-[75px] opacity-[0.12] animate-blob-2" style={{ background: "var(--accent-text)" }} />
        <div className="absolute top-[35%] right-[25%] w-[40vw] h-[40vw] rounded-full filter blur-[70px] opacity-[0.10] animate-blob-3" style={{ background: "var(--accent-text)" }} />
      </div>

      <div
        className="min-h-[100dvh] flex flex-col md:flex-row overflow-hidden selection:bg-success/30 relative z-10 w-full"
        style={{ background: "transparent", color: "var(--text-primary)" }}
      >
        {/* Sidebar — glass panel */}
        <aside
          className="hidden md:flex md:w-64 md:flex-col z-20 shrink-0"
          style={{
            background: "var(--surface-raised)",
            backdropFilter: "blur(20px)",
            borderRight: "1px solid var(--border-default)",
          }}
        >
          {/* Logo */}
          <div
            className="h-16 flex items-center px-6 shrink-0"
            style={{ borderBottom: "1px solid var(--border-default)" }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shadow-lg"
              style={{
                background: "linear-gradient(135deg, var(--accent-primary), var(--accent-text))",
                color: "var(--accent-on-primary)",
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
                      e.currentTarget.style.background = "var(--surface-raised)";
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
          <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--border-default)" }}>
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
                style={{ background: "var(--success)", boxShadow: "0 0 6px var(--success)" }}
                title="Online"
              />
            </div>
            <button
              type="button"
              onClick={focusPalette}
              className="mt-2 w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer"
              style={{ background: "var(--surface-inset)", color: "var(--text-muted)" }}
            >
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4" aria-hidden="true" />
                Find a student…
              </span>
              <kbd
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-muted)",
                }}
              >
                ⌘K
              </kbd>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-auto md:h-screen relative z-10 min-w-0 min-h-0">

          {/* Topbar */}
          <header
            className="h-16 flex items-center justify-between px-4 sm:px-6 md:px-8 shrink-0"
            style={{
              background: "var(--surface-raised)",
              backdropFilter: "blur(20px)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <div className="flex items-center gap-2 sm:gap-4">
              {/* The screen label is redundant with the mobile bottom nav, which already
                  names the active screen — so the search field owns the small widths. */}
              <h2
                className="hidden sm:block text-base font-semibold truncate max-w-[200px]"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                {activeLabel}
              </h2>
              <div ref={searchInputRef} className="flex-1 min-w-0 max-w-xs">
                <StudentSearchBox
                  label="Find a student"
                  value={paletteQuery}
                  onValueChange={setPaletteQuery}
                  onSelect={onPickStudent}
                  candidates={candidates}
                  placeholder="Find a student…"
                  emptyLabel="No student matches that search"
                  error={searchError}
                />
              </div>
              {/* Avatar with profile dropdown */}
              <div className="relative">
                <div
                  className="w-9 h-9 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-xs font-semibold cursor-pointer transition-all"
                  style={{
                    background: `color-mix(in srgb, var(--accent-primary) 15%, var(--surface-raised))`,
                    border: "2px solid var(--border-strong)",
                    color: "var(--accent-primary)",
                    fontFamily: "var(--font-mono)",
                  }}
                  role="button"
                  aria-label="User profile"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  tabIndex={0}
                  onClick={() => setMenuOpen(!menuOpen)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setMenuOpen(!menuOpen);
                    }
                  }}
                >
                  RS
                </div>

                {menuOpen && (
                  <>
                    {/* Backdrop to close dropdown on click outside */}
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    
                    {/* Dropdown Menu */}
                    <div
                      className="absolute right-0 mt-2 w-48 rounded-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150 border border-[var(--border-default)] overflow-hidden shadow-2xl"
                      style={{
                        background: "var(--surface-overlay)",
                        backdropFilter: "blur(24px)",
                      }}
                      role="menu"
                      aria-label="User menu"
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setActiveScreen("/settings");
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-raised)] text-left min-h-[44px] cursor-pointer"
                      >
                        <User className="w-4 h-4 text-[var(--text-muted)]" />
                        Settings Profile
                      </button>
                      <div className="h-px bg-[var(--border-default)] w-full" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={onSignOut}
                        disabled={isSigningOut}
                        aria-busy={isSigningOut}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 text-left min-h-[44px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <LogOut className="w-4 h-4" />
                        {isSigningOut ? "Signing out…" : "Log Out"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-auto flex flex-col no-scrollbar" role="main">
            <main className="flex-1 p-4 sm:p-6 md:p-8 pb-16 md:pb-8 relative max-w-7xl mx-auto w-full">
              {children}
            </main>

            {/* Sticky Footer — always visible (desktop) */}
            <footer
              className="h-12 flex items-center justify-between px-4 sm:px-6 md:px-8 text-xs shrink-0 mt-auto max-w-7xl mx-auto w-full"
              style={{
                background: "var(--surface-inset)",
                backdropFilter: "blur(8px)",
                borderTop: "1px solid var(--border-default)",
                color: "var(--text-muted)",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              <div className="flex gap-4 items-center">
                {isOffline
                  ? <><WifiOff className="w-3 h-3" aria-hidden="true" /> <span>Offline · {pendingSyncCount} pending</span></>
                  : <><Wifi className="w-3 h-3" style={{ color: "var(--success)" }} aria-hidden="true" /> <span>Online · {pendingSyncCount} pending</span></>
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
            background: "var(--surface-raised)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid var(--border-default)",
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
