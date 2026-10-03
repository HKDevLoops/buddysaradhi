// Implements: docs/design/overhaul-plan.md §6 — desktop appearance state.
//
// One store, three consumers: the CSS (`data-palette` / `data-material` on
// <html>), the Tauri window (which native backdrop this platform can do), and
// Settings → Appearance (the picker seam). Token values are never held here —
// they come from the generated src/theme/tokens.ts, the projection of
// packages/design-system/tokens.json.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  AppearanceContext,
  DESKTOP_PLATFORM,
  MATERIAL_STORAGE_KEY,
  PALETTE_STORAGE_KEY,
  appearanceTheme,
  initialMaterial,
  initialPalette,
  type AppearanceValue,
} from "./appearance-state";
import { isMaterialId, isPaletteId } from "./tokens";
import { MATERIALS, PALETTES } from "./tokens";
import { nativeMaterialFor } from "./native";

/**
 * `prefers-reduced-transparency` has no reliable JS reflection across WebView2
 * and WKWebView, and the OS settings that drive it (Windows Transparency
 * effects, macOS Reduce transparency) can change without a page reload. The CSS
 * media query in index.css is therefore the primary path; this flag exists so an
 * in-app Materials control can force the solid layer without waiting for a
 * media-query change to propagate.
 */
export interface AppearanceProviderProps {
  readonly children: ReactNode;
  readonly forceSolidMaterial?: boolean;
}

export function AppearanceProvider({ children, forceSolidMaterial = false }: AppearanceProviderProps) {
  const [paletteId, setPaletteId] = useState(initialPalette);
  const [materialId, setMaterialId] = useState(initialMaterial);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", paletteId);
    document.documentElement.setAttribute("data-material", materialId);
  }, [paletteId, materialId]);

  const setPalette = useCallback((id: AppearanceValue["paletteId"]) => {
    if (!isPaletteId(id)) {
      throw new Error(`UNKNOWN_PALETTE: ${id} is not in tokens.json`);
    }
    window.localStorage.setItem(PALETTE_STORAGE_KEY, id);
    setPaletteId(id);
  }, []);

  const setMaterial = useCallback((id: AppearanceValue["materialId"]) => {
    if (!isMaterialId(id)) {
      throw new Error(`UNKNOWN_MATERIAL: ${id} is not in tokens.json`);
    }
    window.localStorage.setItem(MATERIAL_STORAGE_KEY, id);
    setMaterialId(id);
  }, []);

  const value = useMemo<AppearanceValue>(
    () => ({
      paletteId,
      materialId,
      theme: appearanceTheme(paletteId, materialId, forceSolidMaterial),
      palettes: PALETTES,
      materials: MATERIALS,
      native: nativeMaterialFor(materialId, DESKTOP_PLATFORM),
      setPalette,
      setMaterial,
    }),
    [paletteId, materialId, forceSolidMaterial, setPalette, setMaterial],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}