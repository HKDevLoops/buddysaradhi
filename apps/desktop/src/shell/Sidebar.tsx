
import { Link, useLocation } from "react-router-dom";
import { GlassPanel } from "@buddysaradhi/ui";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: "◈" },
  { path: "/students", label: "Students", icon: "👥" },
  { path: "/attendance", label: "Attendance", icon: "✓" },
  { path: "/fees", label: "Fees", icon: "₹" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <GlassPanel tier="glass-strong" className="w-64 h-full flex flex-col pt-16 pb-4 px-4 sticky left-0 z-20 rounded-none border-r border-white/10">
      <div className="flex flex-col gap-2">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive
                  ? "bg-white/10 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.5)] border-l-2 border-[#00F0FF] text-[#00F0FF]"
                  : "hover:bg-white/5 text-white/70 hover:text-white"
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="mt-auto">
        {/* Sync Status Chip */}
        <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10 text-sm text-white/80">
          <div className="w-2 h-2 rounded-full bg-[#00FF9D] shadow-[0_0_8px_#00FF9D]" />
          <span>Synced just now</span>
        </div>
      </div>
    </GlassPanel>
  );
}
