// Implements: docs/design/overhaul-plan.md §6 — the desktop shell on tokens.
import type { CSSProperties } from "react";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { Panel } from "./Panel";
import { useThemeTokens } from "../theme/appearance-state";

// SAFETY: `WebkitAppRegion` is a real Tauri/WebKit2 property that React's
// CSSProperties type does not declare. The cast adds exactly that one key and
// changes nothing else about the object.
const TITLE_BAR_DRAG_REGION = { WebkitAppRegion: "drag" } as CSSProperties;

export function GlassShell() {
  const { colors, material } = useThemeTokens();
  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: colors.canvas, color: colors.textPrimary }}>
      {/* Title-bar drag region. Transparent on purpose: with `transparent: true`
          on the window (tauri.windows.conf.json / tauri.macos.conf.json) this
          strip is the one place the native Mica / vibrancy backdrop is visible,
          because the document paints the opaque canvas everywhere else. */}
      <div
        className="h-10 w-full fixed top-0 left-0 z-40 flex items-center justify-center pointer-events-none"
        style={{ backgroundColor: "transparent", ...TITLE_BAR_DRAG_REGION }}
      />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 flex flex-col p-8 pt-12 overflow-y-auto min-h-screen relative">
          <Outlet />
        </main>
      </div>

      {/* Sticky Footer — 13_UI_Guidelines.md §13 */}
      <Panel
        tier="faint"
        className={`mat-nav mt-auto h-11 flex items-center justify-between px-6 sticky bottom-0 z-30 rounded-none border-t border-hairline`}
      >
        <div className="text-sm flex items-center gap-2" style={{ color: colors.textSecondary }}>
          <span>v1.4.2</span>
          <span>·</span>
          <span style={{ color: material.translucent ? colors.success : colors.accentPrimary }}>●</span>
          <span>synced 3m ago</span>
        </div>
        <div className="text-sm" style={{ color: colors.textSecondary }}>
          © Buddysaradhi
        </div>
      </Panel>
    </div>
  );
}
