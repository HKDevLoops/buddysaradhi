import React from "react";
import { GlassShell } from "@/components/buddysaradhi/glass-shell";
import { AutoProvisionGuard } from "@/hooks/use-auto-provision";

// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 — the five screens are
// five routes, and this layout is the chrome they all share; 13_UI_Guidelines.md
// §13 (the sticky footer rule); AGENTS.md §2 Rule 9 (auto-heal a
// `DB_NOT_PROVISIONED` read rather than surfacing it as an error).
//
// WHAT THIS LAYOUT IS, NOW THAT THE SCREENS ARE ROUTES. `children` is the route's
// own Server Component, so the screen content is server-rendered into the HTML
// before this tree is even walked on the browser. What the layout contributes is
// the chrome that must be identical on all five: the PIN gate, the nav, the
// topbar, the sync pill and the sticky footer. That is why `GlassShell` stayed a
// client component — everything in it is browser-only work — and why nothing was
// extracted from it.
//
// It is one layout for five routes, so it mounts once per route change, not once
// per session. That is why the fee sheets are closed in `GlassShell`'s unmount
// cleanup: a layout that remounts on navigation would otherwise leave a payment
// sheet flagged open in a module store and re-present it over a different student.
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GlassShell>
      {/* Auto-heals DB_NOT_PROVISIONED errors silently — Rule 9 compliance */}
      <AutoProvisionGuard />
      {children}
    </GlassShell>
  );
}