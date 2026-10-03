"use client";

// Implements: docs/design/overhaul-plan.md W2 — writes `data-palette`,
// `data-material`, `data-theme` and `data-density` on <html> from ONE source of
// truth per attribute, and refuses to write a palette or material that does not
// exist.
//
// The rule this file exists to enforce (it was the F-2 bug class, twice, before):
// localStorage is the APPLIED value. A server echo from the settings query is a
// SEED for a device that has never chosen. An effect that prefers the server
// value clobbers the user's click on the next render, which is exactly the
// "palette flapped and never reached the selected one" defect recorded in
// tests/e2e/stress.spec.ts. So: applied-first everywhere, seed-only otherwise.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";
import {
  DENSITY_STORAGE_KEY,
  DEFAULT_MATERIAL_ID,
  DEFAULT_PALETTE_ID,
  MATERIAL_STORAGE_KEY,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  resolveMaterialId,
  resolvePaletteId,
  type MaterialId,
  type PaletteId,
  type ThemeId,
} from "@/lib/palettes";

interface PaletteContextValue {
  palette: PaletteId;
  theme: ThemeId;
  material: MaterialId;
}

const PaletteContext = createContext<PaletteContextValue>({
  palette: DEFAULT_PALETTE_ID,
  theme: "dark",
  material: DEFAULT_MATERIAL_ID,
});

export function usePalette(): PaletteContextValue {
  return useContext(PaletteContext);
}

interface PaletteProviderProps {
  /** Fallback only. The user's applied selection (localStorage, then the DB seed)
   *  always wins. */
  palette?: PaletteId;
  theme?: ThemeId;
  material?: MaterialId;
  children: ReactNode;
}

export function PaletteProvider({
  palette = DEFAULT_PALETTE_ID,
  theme = "dark",
  material = DEFAULT_MATERIAL_ID,
  children,
}: PaletteProviderProps) {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });

  const dbTheme = data?.data?.theme;
  const dbPalette = data?.data?.palette;
  const dbDensity = data?.data?.density || "comfortable";
  // Material is a device-local presentation preference: a phone in a bright room
  // and a desktop on a desk genuinely want different materials, so it is NOT part
  // of the server-synced settings payload.
  const dbMaterial = (data?.data as { material?: string } | undefined)?.material;


  const [applied, setApplied] = useState<{
    theme: string | null;
    palette: string | null;
    density: string | null;
    material: string | null;
  }>({ theme: null, palette: null, density: null, material: null });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = (): void => {
      setApplied({
        theme: localStorage.getItem(THEME_STORAGE_KEY),
        palette: localStorage.getItem(PALETTE_STORAGE_KEY),
        density: localStorage.getItem(DENSITY_STORAGE_KEY),
        material: localStorage.getItem(MATERIAL_STORAGE_KEY),
      });
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  const [systemTheme, setSystemTheme] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent): void => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  const themePreference = dbTheme || applied.theme || theme;
  const resolvedTheme: ThemeId =
    themePreference === "system" ? systemTheme : themePreference === "light" ? "light" : "dark";

  const resolvedMaterial = resolveMaterialId(applied.material || dbMaterial || material);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const html = document.documentElement;

    // Read localStorage FRESH inside the write effect rather than through the
    // `applied` state. The state is populated by a separate mount effect, so on
    // first paint it is still all-null — and a seed written from that null state
    // overwrites an applied value that localStorage already held. That is the
    // F-2 clobber class this file exists to prevent, reintroduced once already.
    const appliedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const appliedPalette = localStorage.getItem(PALETTE_STORAGE_KEY);
    const appliedDensity = localStorage.getItem(DENSITY_STORAGE_KEY);
    const appliedMaterial = localStorage.getItem(MATERIAL_STORAGE_KEY);

    html.setAttribute("data-palette", resolvePaletteId(appliedPalette || dbPalette || palette));
    // Material is written unconditionally: `--surface-overlay`, `--surface-nav`,
    // `--surface-sheet` and `--surface-palette` are declared ONLY inside
    // `[data-palette][data-material="…"]` in the generated token CSS, so an html
    // element without this attribute leaves every overlay surface unstyled. That
    // is why the attribute is set from the provider rather than only from the
    // Settings screen.
    html.setAttribute("data-material", resolveMaterialId(appliedMaterial || material));
    html.setAttribute(
      "data-theme",
      appliedTheme === "light" || appliedTheme === "dark"
        ? appliedTheme
        : themePreference === "system"
          ? systemTheme
          : themePreference === "light"
            ? "light"
            : "dark",
    );
    html.setAttribute("data-theme-preference", themePreference || "system");
    html.setAttribute("data-density", appliedDensity || dbDensity);

    // Seed only where this device has never chosen.
    if (dbPalette && !appliedPalette) localStorage.setItem(PALETTE_STORAGE_KEY, dbPalette);
    if (dbTheme && !appliedTheme) localStorage.setItem(THEME_STORAGE_KEY, dbTheme);
    if (dbDensity && !appliedDensity) localStorage.setItem(DENSITY_STORAGE_KEY, dbDensity);
  }, [
    applied.palette,
    applied.theme,
    applied.density,
    applied.material,
    systemTheme,
    themePreference,
    dbPalette,
    dbTheme,
    dbDensity,
    palette,
    material,
  ]);

  return (
    <PaletteContext.Provider
      value={{
        palette: resolvePaletteId(applied.palette || dbPalette || palette),
        theme: resolvedTheme,
        material: resolveMaterialId(applied.material || material),
      }}
    >
      {children}
    </PaletteContext.Provider>
  );
}
