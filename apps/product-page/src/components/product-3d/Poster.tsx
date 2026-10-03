// Implements: 20_3D_Product_Page.md §2 (Poster fallback).
// Static fallback: identical pixels to the canvas first frame, zero JS 3D, and
// the no-WebGL / Save-Data path. Docs/design/overhaul-plan.md §4.1: the
// background is the palette canvas (the canvas renders the same colour, so the
// handoff has no flash) and the one card is an opaque panel, not decorative
// glass. Copy: no em dashes, no unverifiable numbers.

const KPI_LINE_1 = "₹0 owed. 0 students.";
const KPI_LINE_2 = "1 ledger. 5 screens.";

export function Poster() {
  return (
    <div
      aria-label="Buddysaradhi product preview"
      className="relative flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden"
      role="img"
      style={{ backgroundColor: "var(--canvas)" }}
    >
      <div className="panel relative p-6 text-center">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {KPI_LINE_1}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {KPI_LINE_2}
        </p>
      </div>
      <p className="relative mt-6 text-sm" style={{ color: "var(--text-secondary)" }}>
        Scroll for the product story
      </p>
    </div>
  );
}