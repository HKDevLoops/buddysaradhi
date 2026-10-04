// @ts-nocheck
// Implements: 20_3D_Product_Page.md §12 (the `/tour` canvas). The shared hero
// world - Journey, the five reveal screens, the ledger card - plus the two
// route-local set pieces, composed through ProductScene's `children` outlet so
// the hero stays untouched: composition, not a fork.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { ProductScene } from "@/components/product-3d/ProductScene";
import type { ProgressProxy } from "@/components/product-3d/Journey";
import type { SceneTokens } from "@/components/product-3d/hooks";
import { TourFovRig } from "./tour-fov-rig";
import { TourTube } from "./tour-tube";

interface TourCanvasProps {
  progressRef: ProgressProxy;
  tokens: SceneTokens;
  frozen?: boolean;
  lowEnd?: boolean;
  wide?: boolean;
  inView?: boolean;
  onReady?: () => void;
}

export function TourCanvas({
  progressRef,
  tokens,
  frozen = false,
  lowEnd = false,
  wide = false,
  inView = true,
  onReady,
}: TourCanvasProps) {
  return (
    <ProductScene
      progressRef={progressRef}
      tokens={tokens}
      frozen={frozen}
      lowEnd={lowEnd}
      wide={wide}
      inView={inView}
      onReady={onReady}
    >
      <TourTube tokens={tokens} frozen={frozen} />
      <TourFovRig progressRef={progressRef} frozen={frozen} />
    </ProductScene>
  );
}
