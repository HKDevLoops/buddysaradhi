
import { GlassPanel, NeumoButton } from "@buddysaradhi/ui";

export function Settings() {
  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        <GlassPanel tier="glass" className="p-6">
          <h2 className="text-xl font-medium mb-4">Security</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-white/80">Require PIN on startup</span>
              <div className="w-12 h-6 bg-[#00FF9D]/20 rounded-full flex items-center p-1 border border-[#00FF9D]/50 cursor-pointer">
                <div className="w-4 h-4 bg-[#00FF9D] rounded-full shadow-[0_0_8px_#00FF9D] transform translate-x-6" />
              </div>
            </div>
            <NeumoButton glow="flare" variant="inset" className="w-full text-[#FF5E00]">Change PIN</NeumoButton>
          </div>
        </GlassPanel>

        <GlassPanel tier="glass" className="p-6">
          <h2 className="text-xl font-medium mb-4">Backup & Export</h2>
          <div className="space-y-4">
             <NeumoButton glow="emerald" className="w-full">Export Ledger Backup</NeumoButton>
             <NeumoButton glow="cyan" variant="inset" className="w-full">Restore from Backup</NeumoButton>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
