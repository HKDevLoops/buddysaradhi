
import { GlassPanel, NeumoButton } from "@buddysaradhi/ui";

export function Students() {
  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Students</h1>
        <NeumoButton glow="emerald" variant="raised">Add Student</NeumoButton>
      </div>

      <GlassPanel tier="glass" className="flex-1 p-6 flex flex-col">
        <div className="flex items-center gap-4 mb-6">
          <input 
            type="text" 
            placeholder="Search students..." 
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:border-[#00F0FF] transition-colors w-64"
          />
        </div>
        
        <div className="flex-1 bg-white/2 rounded-lg border border-white/5 overflow-hidden">
          {/* Mock Table */}
          <table className="w-full text-left">
            <thead className="bg-white/5 border-b border-white/5">
              <tr>
                <th className="p-4 font-medium text-white/70">Name</th>
                <th className="p-4 font-medium text-white/70">Batch</th>
                <th className="p-4 font-medium text-white/70">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="p-4">Aarav Patel</td>
                <td className="p-4">Class 10 - Maths</td>
                <td className="p-4">
                  <span className="text-[#00FF9D] text-sm flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#00FF9D]" /> Active
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
}
