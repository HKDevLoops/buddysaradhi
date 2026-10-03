// Implements: docs/design/overhaul-plan.md §6 — Students on tokens.
import { Panel } from "../shell/Panel";
import { Button } from "../shell/Button";
import { useThemeTokens } from "../theme/appearance-state";

export function Students() {
  const { colors } = useThemeTokens();

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: colors.textPrimary }}>
          Students
        </h1>
        <Button accent="success">Add Student</Button>
      </div>

      <Panel className="flex-1 p-6 flex flex-col">
        <div className="flex items-center gap-4 mb-6">
          <input
            type="text"
            placeholder="Search students..."
            aria-label="Search students"
            className="bg-surface-inset border border-hairline rounded-lg px-4 py-2 min-h-[44px] w-64 placeholder:text-fg-muted focus:border-focus-ring focus:outline-none transition-colors"
            style={{ color: colors.textPrimary }}
          />
        </div>

        {/* A dense data surface is OPAQUE (material-modes.md §1.1): no blur, no
            alpha, no per-row shadow — a hairline border carries the edge. */}
        <div className="flex-1 bg-surface-row rounded-lg border border-hairline overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-raised border-b border-hairline">
              <tr>
                <th className="p-4 font-medium" style={{ color: colors.textSecondary }}>
                  Name
                </th>
                <th className="p-4 font-medium" style={{ color: colors.textSecondary }}>
                  Batch
                </th>
                <th className="p-4 font-medium" style={{ color: colors.textSecondary }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hairline hover:bg-surface-raised transition-colors">
                <td className="p-4" style={{ color: colors.textPrimary }}>
                  Aarav Patel
                </td>
                <td className="p-4" style={{ color: colors.textPrimary }}>
                  Class 10 - Maths
                </td>
                <td className="p-4">
                  <span
                    className="text-sm flex items-center gap-2"
                    style={{ color: colors.success }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: colors.success }}
                    />
                    Active
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}