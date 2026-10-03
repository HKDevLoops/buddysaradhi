// Implements: docs/design/overhaul-plan.md §6 — the non-component half of the
// desktop appearance store: context, storage keys, platform detection, hooks.
//
// Kept apart from appearance.tsx so that file exports exactly one component
// (react-refresh / oxlint `only-export-components`).
import { createContext, useContext } from "react";

import type { DesktopPlatform, NativeMaterialMapping } from "./native";
import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_PALETTE_ID,
  MATERIALS,
  PALETTES,
  isMaterialId,
  isPaletteId,
  resolveTheme,
} from "./tokens";
import type { MaterialId, PaletteId, Theme } from "./tokens";

export const PALETTE_STORAGE_KEY = "buddysaradhi.palette";
export const MATERIAL_STORAGE_KEY = "buddysaradhi.material";

export interface AppearanceValue {
  readonly paletteId: PaletteId;
  readonly materialId: MaterialId;
  readonly theme: Theme;
  readonly palettes: typeof PALETTES;
  readonly materials: typeof MATERIALS;
  readonly native: NativeMaterialMapping;
  readonly setPalette: (id: PaletteId) => void;
  readonly setMaterial: (id: MaterialId) => void;
}

export const AppearanceContext = createContext<AppearanceValue | null>(null);

/** Which Tauri target this build is for; the effect map is platform-keyed. */
export const DESKTOP_PLATFORM: DesktopPlatform = (() => {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "macos";
  return "linux";
})();

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // A webview with storage disabled is not a failure — the default stands.
    return null;
  }
}

export function initialPalette(): PaletteId {
  const stored = readStored(PALETTE_STORAGE_KEY);
  return stored !== null && isPaletteId(stored) ? stored : DEFAULT_PALETTE_ID;
}

export function initialMaterial(): MaterialId {
  const stored = readStored(MATERIAL_STORAGE_KEY);
  return stored !== null && isMaterialId(stored) ? stored : DEFAULT_MATERIAL_ID;
}

export function appearanceTheme(
  paletteId: PaletteId,
  materialId: MaterialId,
  forceSolidMaterial: boolean,
): Theme {
  return resolveTheme(paletteId, materialId, forceSolidMaterial);
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error(
      "useAppearance must be used inside <AppearanceProvider> (apps/desktop/src/main.tsx)",
    );
  }
  return value;
}

export function useThemeTokens(): Theme {
  return useAppearance().theme;
}