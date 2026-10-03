// Implements: docs/design/overhaul-plan.md §6 — Attendance on tokens.
import { Panel } from "../shell/Panel";
import { useThemeTokens } from "../theme/appearance-state";

export function Attendance() {
  const { colors } = useThemeTokens();

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: colors.textPrimary }}>
          Attendance
        </h1>
      </div>

      <Panel className="flex-1 p-6 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4" style={{ color: colors.success }} aria-hidden="true">
          ✓
        </div>
        <h2 className="text-xl font-medium mb-2" style={{ color: colors.textSecondary }}>
          Select a Batch
        </h2>
        <p style={{ color: colors.textMuted }}>Choose a batch from the sidebar to mark today's attendance.</p>
      </Panel>
    </div>
  );
}