
import { GlassPanel } from "@buddysaradhi/ui";

export function Fees() {
  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Fees & Payments</h1>
      </div>

      <GlassPanel tier="glass" className="flex-1 p-6">
        <h2 className="text-xl font-medium mb-4">Pending Dues</h2>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-white/60">No pending dues for the current month.</p>
        </div>
      </GlassPanel>
    </div>
  );
}
