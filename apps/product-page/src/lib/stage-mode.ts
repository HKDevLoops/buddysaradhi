// Implements: 20_3D_Product_Page.md §3.1 (the degradation ladder: "no WebGL ->
// poster", "Save-Data -> poster") and §2.2 (the Poster veil), plus the fix
// for the "500vh of frozen content" defect.
//
// THE CONTRACT. One viewport (`100dvh`) on the poster path; the scroll runway
// on the canvas path. Both numbers come from the ONE pure function below, so
// the hero and the tour cannot drift.
//
// WHY IT IS DECIDED IN REACT. An earlier version decided in an inline probe in
// the document head, so the height would be right before the first paint. It
// was measured and it does not work: when the first script in `<body>` runs,
// the GPU process has not finished starting, so `getContext("webgl2")`
// returns null and the probe concludes "no WebGL" on EVERY device.
//
// The React decision is late but CORRECT, and the lateness is invisible: the
// server renders the poster height (so a no-JavaScript visitor gets one
// viewport and a still), the stage is `sticky top-0 h-[100dvh]` either way,
// and the content below the hero was never on screen because the hero fills
// the viewport. The ScrollTrigger is created in a LAYOUT effect, so it
// measures the runway it will actually scrub.
//
// Rule 2: no network call. Rule 5: no colour here. Rule 10: this changes
// LAYOUT, never motion.

export type StageMode = "poster" | "canvas";

/**
 * THE RULE, in one place. The poster path is taken when the device cannot draw
 * the scene (no WebGL) or when the visitor asked for less data (Save-Data).
 * Everything else - a small screen, a weak CPU - still gets the scene, in its
 * lighter form; that is `useLowEnd`, a different question.
 */
export function resolveStageMode(webglAvailable: boolean, saveData: boolean): StageMode {
  if (!webglAvailable) return "poster";
  if (saveData) return "poster";
  return "canvas";
}

/**
 * The stage height, as a CSS length.
 *
 * `poster` is ONE viewport: the visitor sees the still and the copy, and
 * scrolling moves on to the next section instead of through five screens of
 * the same frame. `canvas` is the scroll runway the pinned stage scrubs
 * against.
 */
export function storyHeightCss(mode: StageMode, runwayVh: number): string {
  if (mode === "poster") return "100dvh";
  const safe = Number.isFinite(runwayVh) && runwayVh > 0 ? Math.round(runwayVh) : 0;
  return `${safe}vh`;
}
