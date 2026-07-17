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
  const [localTheme] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("buddysaradhi.theme");
    }
    return null;
  });

  const [localPalette] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("buddysaradhi.palette");
    }
    return null;
  });

  const [localDensity] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("buddysaradhi.density");
    }
    return null;
  });

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

  // Theme resolution: DB settings -> localStorage override -> route default prop
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

  // The user's explicit global choice (localStorage) always wins over any
  // fallback prop, so a single chosen palette applies to every page.
  // Every palette now ships both a light and a dark CSS variant, so the
  // chosen palette is honored regardless of the active Appearance Mode.
  const dbPalette = data?.data?.palette as PaletteId | undefined;
  const resolvedPalette = (localPalette || dbPalette || palette) as PaletteId;

  const dbDensity = data?.data?.density || "comfortable";
  const resolvedDensity = localDensity || dbDensity;

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-palette", resolvedPalette);
    html.setAttribute("data-theme", resolvedTheme);
    html.setAttribute("data-theme-preference", themePreference || "system");
    html.setAttribute("data-density", resolvedDensity);
  }, [resolvedPalette, resolvedTheme, themePreference, resolvedDensity]);

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
