// Implements: 20_3D_Product_Page.md §2 (Poster fallback) + product/02 §2.1 copy.
// Static fallback: identical pixels, zero JS 3D. Also the no-WebGL/Save-Data path.
// R-02: no em dashes. R-17: no unverifiable numbers (KPI line is demo ledger copy).

const KPI_LINE_1 = "₹0 owed. 0 students.";
const KPI_LINE_2 = "1 ledger. 5 screens.";

export function Poster() {
  return (
    <div
      aria-label="Buddysaradhi product preview"
      className="glass relative flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden"
      role="img"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(480px 480px at 20% 15%, rgba(0,255,157,0.12), transparent 70%), radial-gradient(520px 520px at 80% 25%, rgba(0,240,255,0.10), transparent 70%), radial-gradient(440px 440px at 50% 90%, rgba(179,136,255,0.10), transparent 70%), linear-gradient(#0f0c29, #24243e 55%, #0a0a1a)",
        }}
      />
      <div className="glass-strong relative rounded-2xl p-6 text-center">
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.95)" }}>
          {KPI_LINE_1}
        </p>
        <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
          {KPI_LINE_2}
        </p>
      </div>
      <p className="relative mt-6 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
        Scroll for the product story
      </p>
    </div>
  );
}
