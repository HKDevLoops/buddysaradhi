// Implements: 20_3D_Product_Page.md §2 (Poster fallback).
//
// WHAT THIS IS NOW, AND WHY IT IS EMPTY OF COPY. The Poster is only ever a
// BACKDROP: `ProductHero` renders it in the stage (line 165) whenever the canvas
// cannot mount, and again as the first-frame veil (line 182), and in both cases
// the DOM overlay panel (lines 191-213) is rendered on top of it carrying the
// audited proposition — the H1 "Five screens. Seven engines. One ledger. Zero
// servers to manage.", the beat body, and the Request access CTA.
//
// The Poster therefore used to put a SECOND panel in the same centred position,
// with the same background, under that overlay. Two changes came out of that:
//
//  1. It stated fabricated data. "₹0 owed. 0 students." / "1 ledger. 5 screens."
//     was invented demo text on the static path — the path taken by exactly the
//     budget phone and Save-Data visitor this product is for. A tutor with no
//     WebGL was told the app showed nothing owed to nobody.
//  2. It was duplicated. On the no-WebGL path `ready` never becomes true, so the
//     Poster rendered twice, stacked.
//
// A screenshot would have been the other honest option, but this repository has
// no product screenshot asset (only `/nim/og-image.jpg`), and shipping no
// screenshot is better than shipping one nobody has captured.
//
// So the Poster is the canvas-coloured backdrop and nothing else — pixel-for-
// pixel what the canvas itself renders, which is what FM-10's no-flash handoff
// requires. The proposition is already on screen, once, in the overlay, and it
// is the copy the claims audit verified. See
// docs/design/marketing-claims-audit.md row 39.

export function Poster() {
  return (
    <div
      aria-hidden="true"
      className="relative h-[100dvh] w-full"
      style={{ backgroundColor: "var(--canvas)" }}
    />
  );
}