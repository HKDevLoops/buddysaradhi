"use client";

// Implements: UI/README.md §Implementation Bridge — PaletteProvider
// Switches data-palette and data-theme on <html> based on the current route/context

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";

export type PaletteId =
  | "aurora-cosmic"
  | "saffron-marigold"
  | "emerald-ledger"
  | "cyan-lagoon"
  | "rose-petal"
  | "amber-sunrise"
  | "violet-nebula"
  | "midnight-slate";

export type ThemeId = "light" | "dark";

interface PaletteContextValue {
  palette: PaletteId;
  theme: ThemeId;
}

const PaletteContext = createContext<PaletteContextValue>({
  palette: "aurora-cosmic",
  theme: "dark",
});

export function usePalette() {
  return useContext(PaletteContext);
}

interface PaletteProviderProps {
  /** Optional fallback only. The user's global selection (localStorage, then DB) always wins. */
  palette?: PaletteId;
  theme?: ThemeId;
  children: ReactNode;
}

/**
 * Wraps the whole app at the root and sets data-palette + data-theme on <html>
 * ONCE from the single global source of truth (localStorage, then DB settings).
 * It never clears the attribute on unmount so the selection persists app-wide.
 */
export function PaletteProvider({ palette = "aurora-cosmic", theme = "dark", children }: PaletteProviderProps) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  const dbTheme = data?.data?.theme; // 'light', 'dark', 'system', or undefined
  const dbPalette = data?.data?.palette as PaletteId | undefined;
  const dbDensity = data?.data?.density || "comfortable";

  const [localTheme, setLocalTheme] = useState<string | null>(null);
  const [localPalette, setLocalPalette] = useState<string | null>(null);
  const [localDensity, setLocalDensity] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLocalTheme(localStorage.getItem("buddysaradhi.theme"));
      setLocalPalette(localStorage.getItem("buddysaradhi.palette"));
      setLocalDensity(localStorage.getItem("buddysaradhi.density"));

      const handleStorage = () => {
        setLocalTheme(localStorage.getItem("buddysaradhi.theme"));
        setLocalPalette(localStorage.getItem("buddysaradhi.palette"));
        setLocalDensity(localStorage.getItem("buddysaradhi.density"));
      };

      window.addEventListener("storage", handleStorage);
      return () => window.removeEventListener("storage", handleStorage);
    }
  }, []);

  // Track system preference matching via media query
  const [systemTheme, setSystemTheme] = useState<ThemeId>(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const listener = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  // Theme resolution: DB settings (user's saved settings on login) -> localStorage override -> fallback theme prop
  const themePreference = dbTheme || localTheme || theme;

  const isCustomDarkTheme = ["onedark", "nord", "gruvbox", "tokyonight", "monochrome"].includes(themePreference);
  const isCustomLightTheme = ["onelight", "gruvboxlight", "tokyoday", "monochromelight"].includes(themePreference);

  const resolvedTheme: ThemeId =
    themePreference === "system"
      ? systemTheme
      : themePreference === "light" || isCustomLightTheme
      ? "light"
      : themePreference === "dark" || isCustomDarkTheme
      ? "dark"
      : theme;

  // Palette resolution: DB settings (user's saved settings on login) -> localStorage -> fallback palette prop
  const resolvedPalette = (dbPalette || localPalette || palette) as PaletteId;
  const resolvedDensity = dbDensity || localDensity || "comfortable";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const html = document.documentElement;
    // APPLIED-first for data-palette (103036f density-fix class): the swatch
    // click in appearance-section applyPalette() writes this attribute AND
    // localStorage in the same tick, so localStorage IS the applied value —
    // read it fresh here. A stale server echo (dbPalette from the last
    // settings response) or its absence (failed/empty getSettings → dbPalette
    // undefined → the aurora-cosmic fallback prop) must NEVER clobber
    // html[data-palette] after the user chose one. e2e F-2:
    // tests/e2e/stress.spec.ts:176 — the attribute flapped violet-nebula →
    // aurora-cosmic and never reached the selected emerald-ledger.
    const applied = localStorage.getItem("buddysaradhi.palette");
    html.setAttribute("data-palette", applied || resolvedPalette);
    html.setAttribute("data-theme", resolvedTheme);
    html.setAttribute("data-theme-preference", themePreference || "system");
    html.setAttribute("data-density", resolvedDensity);

    // Sync localStorage with DB settings when logged in — SEED only when this
    // device has no applied value (first visit / cross-device restore).
    // Unconditionally writing dbPalette here is what let a stale echo undo the
    // user's click on the next effect run.
    if (dbPalette && !applied) localStorage.setItem("buddysaradhi.palette", dbPalette);
    if (dbTheme) localStorage.setItem("buddysaradhi.theme", dbTheme);
    if (dbDensity) localStorage.setItem("buddysaradhi.density", dbDensity);
  }, [resolvedPalette, resolvedTheme, themePreference, resolvedDensity, dbPalette, dbTheme, dbDensity]);

  // Update localStorage when resolvedTheme changes
  useEffect(() => {
    if (resolvedTheme) {
      localStorage.setItem("buddysaradhi.theme", resolvedTheme);
    }
  }, [resolvedTheme]);

  // Update localStorage when resolvedDensity changes
  useEffect(() => {
    if (resolvedDensity) {
      localStorage.setItem("buddysaradhi.density", resolvedDensity);
    }
  }, [resolvedDensity]);

  return (
    <PaletteContext.Provider value={{ palette: resolvedPalette, theme: resolvedTheme }}>
      {children}
    </PaletteContext.Provider>
  );
}
