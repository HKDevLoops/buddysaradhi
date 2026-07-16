
import { GlassPanel } from "@buddysaradhi/ui";

export function Attendance() {
  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Attendance</h1>
      </div>

      <GlassPanel tier="glass" className="flex-1 p-6 flex flex-col items-center justify-center text-white/50">
        <div className="text-6xl mb-4">✓</div>
        <h2 className="text-xl font-medium mb-2">Select a Batch</h2>
        <p>Choose a batch from the sidebar to mark today's attendance.</p>
      </GlassPanel>
    </div>
  );
}
