
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { GlassPanel } from "@buddysaradhi/ui";

export function GlassShell() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#0f0c29] via-[#24243e] to-[#0a0a1a] text-white selection:bg-[#00F0FF]/30 font-sans">
      
      {/* Title Bar Drag Region for Desktop App */}
      <div 
        className="h-10 w-full fixed top-0 left-0 z-40 bg-transparent flex items-center justify-center pointer-events-none" 
        style={{ WebkitAppRegion: 'drag' } as any}
      >
          {/* We hide the title in tauri.conf.json, so we can render our own or leave it empty for the mica effect to shine */}
      </div>

      <div className="flex flex-1">
        <Sidebar />
        
        <main className="flex-1 flex flex-col p-8 pt-12 overflow-y-auto min-h-screen relative">
          <Outlet />
        </main>
      </div>

      {/* Sticky Footer Rule 13_UI_Guidelines.md §13 */}
      <GlassPanel tier="glass-faint" className="mt-auto h-11 flex items-center justify-between px-6 sticky bottom-0 z-30 rounded-none border-t border-white/10 backdrop-blur-md">
        <div className="text-sm text-white/60 flex items-center gap-2">
          <span>v1.4.2</span>
          <span>·</span>
          <span className="text-[#00FF9D]">●</span>
          <span>synced 3m ago</span>
        </div>
        <div className="text-sm text-white/60">
          © Buddysaradhi
        </div>
      </GlassPanel>
    </div>
  );
}
