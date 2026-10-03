// Implements: docs/design/overhaul-plan.md §6 — Fees & Payments on tokens.
import { Panel } from "../shell/Panel";
import { useThemeTokens } from "../theme/appearance-state";

export function Fees() {
  const { colors } = useThemeTokens();

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: colors.textPrimary }}>
          Fees &amp; Payments
        </h1>
      </div>

      <Panel className="flex-1 p-6">
        <h2 className="text-xl font-medium mb-4" style={{ color: colors.textPrimary }}>
          Pending Dues
        </h2>
        <div className="bg-surface-inset border border-hairline rounded-lg p-4">
          <p style={{ color: colors.textSecondary }}>No pending dues for the current month.</p>
        </div>
      </Panel>
    </div>
  );
}