// Implements: docs/design/overhaul-plan.md §6 — NativeWind/Expo token consumption.
//
// WHY THE COLOURS COME FROM JS, NOT FROM A CSS ATTRIBUTE
// `tokens.css` declares the same custom properties as
// `packages/design-system/tokens.css`, and it is what expo-web and the
// NativeWind class surface read. On native it is NOT the mechanism: RN has no
// `data-palette` attribute selector to switch a stylesheet block, and the values
// have to survive as literal colour strings that React Native's own parser
// accepts. So the runtime source of truth here is the generated
// `src/theme/tokens.ts`, read through `useThemeTokens()` and applied with
// `style` props. The names are identical on both paths — only the delivery
// differs, which is exactly the material-modes.md §4.2 rule ("the token names
// are identical; the values are shared; the mechanism is not").
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_PALETTE_ID,
  MATERIALS,
  PALETTES,
  resolveTheme,
} from "./tokens";
import type { MaterialId, PaletteId, Theme } from "./tokens";

/**
 * `AccessibilityInfo.isReduceTransparencyEnabled` is the native half of the
 * `prefers-reduced-transparency` fallback in material-modes.md §2.6. It is read
 * through a narrowed shape rather than called directly so a runtime without it
 * degrades to "no preference" instead of crashing the root layout.
 */
const reduceTransparencyProbe = AccessibilityInfo as unknown as {
  isReduceTransparencyEnabled?: () => Promise<boolean>;
};

export interface AppearanceValue {
  readonly paletteId: PaletteId;
  readonly materialId: MaterialId;
  readonly theme: Theme;
  readonly palettes: typeof PALETTES;
  readonly materials: typeof MATERIALS;
  readonly reduceTransparency: boolean;
  readonly setPalette: (id: PaletteId) => void;
  readonly setMaterial: (id: MaterialId) => void;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export interface AppearanceProviderProps {
  readonly children: ReactNode;
  readonly initialPaletteId?: PaletteId;
  readonly initialMaterialId?: MaterialId;
}

/**
 * Appearance state lives here for this wave only — it is intentionally NOT
 * persisted yet: `@react-native-async-storage/async-storage` is not a dependency
 * of apps/mobile, and inventing a storage key in the token wave would create a
 * second, un-audited place where a palette can be chosen. Settings → Appearance
 * persists both ids once the picker lands.
 */
export function AppearanceProvider({
  children,
  initialPaletteId = DEFAULT_PALETTE_ID,
  initialMaterialId = DEFAULT_MATERIAL_ID,
}: AppearanceProviderProps) {
  const [paletteId, setPaletteId] = useState<PaletteId>(initialPaletteId);
  const [materialId, setMaterialId] = useState<MaterialId>(initialMaterialId);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    const probe = reduceTransparencyProbe.isReduceTransparencyEnabled;
    if (!probe) return;
    let cancelled = false;
    probe()
      .then((value) => {
        if (!cancelled) setReduceTransparency(value);
      })
      // Rule 9: a failed preference read is not fatal — the app keeps the
      // material the user asked for, which is the state they can see.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setPalette = useCallback((id: PaletteId) => setPaletteId(id), []);
  const setMaterial = useCallback((id: MaterialId) => setMaterialId(id), []);

  const value = useMemo<AppearanceValue>(
    () => ({
      paletteId,
      materialId,
      theme: resolveTheme(paletteId, materialId, reduceTransparency),
      palettes: PALETTES,
      materials: MATERIALS,
      reduceTransparency,
      setPalette,
      setMaterial,
    }),
    [paletteId, materialId, reduceTransparency, setPalette, setMaterial],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside <AppearanceProvider> (apps/mobile/app/_layout.tsx)");
  }
  return value;
}

/** The resolved palette + material for the current tree. */
export function useThemeTokens(): Theme {
  return useAppearance().theme;
}