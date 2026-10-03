// Implements: docs/design/overhaul-plan.md §6 — the nav rail is a floating
// surface, so it is one of the two roles allowed a material
// (material-modes.md §5.2 cap: at most two backdrop regions on screen).
import { Link, useLocation } from "react-router-dom";

import { Panel } from "./Panel";
import { useThemeTokens } from "../theme/appearance-state";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: "◈" },
  { path: "/students", label: "Students", icon: "◍" },
  { path: "/attendance", label: "Attendance", icon: "✓" },
  { path: "/fees", label: "Fees", icon: "₹" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const location = useLocation();
  const { colors } = useThemeTokens();

  return (
    <Panel
      tier="normal"
      className="mat-nav w-64 h-full flex flex-col pt-16 pb-4 px-4 sticky left-0 z-20 rounded-none border-r border-hairline"
    >
      <nav className="flex flex-col gap-2" aria-label="Primary">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors duration-200 min-h-[44px] ${
                isActive
                  ? "bg-surface-inset border-l-2 border-l-accent-text"
                  : "border-transparent hover:bg-surface-row"
              }`}
              style={{ color: isActive ? colors.accentText : colors.textSecondary }}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <div
          className="flex items-center gap-2 px-4 py-2 bg-surface-row rounded-full border border-hairline text-sm"
          style={{ color: colors.textSecondary }}
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.success }} />
          <span>Synced just now</span>
        </div>
      </div>
    </Panel>
  );
}