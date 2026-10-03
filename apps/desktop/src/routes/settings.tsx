// Implements: docs/design/overhaul-plan.md §6 — Settings on tokens.
//
// Appearance (palette + material) is the picker seam: `useAppearance()` already
// exposes all 20 palettes and 3 modes with swatches and the native-window
// fidelity note, so adding the control is a rendering task. It is deliberately
// not added here — this wave is token consumption only.
import { Panel } from "../shell/Panel";
import { Button } from "../shell/Button";
import { useAppearance, useThemeTokens } from "../theme/appearance-state";

export function Settings() {
  const { colors } = useThemeTokens();
  const { palettes, materials, native } = useAppearance();

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: colors.textPrimary }}>
          Settings
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        <Panel className="p-6">
          <h2 className="text-xl font-medium mb-4" style={{ color: colors.textPrimary }}>
            Security
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span style={{ color: colors.textSecondary }}>Require PIN on startup</span>
              <span
                className="w-12 h-6 rounded-full flex items-center justify-end p-1 border border-hairline"
                style={{ backgroundColor: colors.success }}
                aria-hidden="true"
              >
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: colors.accentOnPrimary }} />
              </span>
            </div>
            <Button variant="inset" accent="danger" className="w-full">
              Change PIN
            </Button>
          </div>
        </Panel>

        <Panel className="p-6">
          <h2 className="text-xl font-medium mb-4" style={{ color: colors.textPrimary }}>
            Backup &amp; Export
          </h2>
          <div className="space-y-4">
            <Button accent="success" className="w-full">
              Export Ledger Backup
            </Button>
            <Button variant="inset" accent="info" className="w-full">
              Restore from Backup
            </Button>
          </div>
        </Panel>

        {/* Read-only inventory so the picker has a place to grow into, and so the
            platform mapping in docs/design/platform-tokens.md is inspectable
            from the running app. */}
        <Panel className="p-6 md:col-span-2">
          <h2 className="text-xl font-medium mb-2" style={{ color: colors.textPrimary }}>
            Appearance
          </h2>
          <p className="text-sm mb-4" style={{ color: colors.textMuted }}>
            {palettes.length} palettes · {materials.length} material modes · native window material on this
            platform: {native.effects ? native.effects.join(", ") : "none (opaque fallback)"}
          </p>
          <div className="flex flex-wrap gap-2">
            {materials.map((material) => (
              <span
                key={material.id}
                className="px-2 py-1 rounded-full border border-hairline text-xs"
                style={{ backgroundColor: colors.surfaceInset, color: colors.textSecondary }}
              >
                {material.name} — {material.blurb}
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}