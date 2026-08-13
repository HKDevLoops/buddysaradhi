# Analysis: R1. UI Foundation (Palettes & Globals)

This analysis outlines the current state and proposed integration plan for the Buddysaradhi UI Foundation, detailing the mapping and behavior of color palettes, global styles, dynamic providers, and hydration-safeguard scripts.

---

## 1. Observation (Current State)

We conducted a thorough investigation of the `apps/web/src` directory and the project specifications. Here are the files identified:

### 1.1 Color Palettes Specification
- **Path**: `UI/01_Color_Palettes.md`
- **Details**: Defines the 8 distinct palettes (Aurora Cosmic, Saffron Marigold, Emerald Ledger, Cyan Lagoon, Rose Petal, Amber Sunrise, Violet Nebula, Midnight Slate) mapped to specific pages and emotional intents. Specifies a light and dark theme for each, except Aurora Cosmic (dark-only, paired with Midnight Slate for light) and Midnight Slate (light-only, paired with Aurora Cosmic for dark).

### 1.2 Global CSS Stylesheet
- **Path**: `apps/web/src/app/globals.css`
- **Details**: Already fully implemented with all 8 palettes, including variables for light and dark variants. Exposes semantic mappings to Tailwind CSS and specifies global tokens (typography, motion, and spacing). Radially overlays background styles dynamically for the Aurora Cosmic canvas.
- **Prohibitions**: Includes the GREP-prohibited `#6366F1` marker to ensure the `no-indigo-accent` lint catches violations, using `#0E7490` (teal) as `--accent-info` for Cyan Lagoon instead.

### 1.3 Palettes Typed Manifest
- **Path**: `apps/web/src/lib/palettes.ts`
- **Details**: Defines `PaletteId` and `ThemeId` types. Holds the `PALETTES` metadata manifest, the `ROUTE_PALETTE_MAP` routing assignments, and a `getPaletteForRoute` utility helper that resolves routes via exact match or prefix match (e.g., `/students/123` resolves to `/students`).

### 1.4 Root Layout
- **Path**: `apps/web/src/app/layout.tsx`
- **Details**: Defines fonts (Sora, Onest, JetBrains Mono) and sets default attributes on `<html>` (`data-palette="aurora-cosmic"` and `data-theme="dark"`). Wraps components with React Query `<Providers>`.

### 1.5 Palette Provider
- **Path**: `apps/web/src/lib/palette-provider.tsx`
- **Details**: Context and Client wrapper that updates `data-palette` and `data-theme` on `<html>`. Currently has a gap: it updates attributes using static parameters but does not incorporate user-preference database settings, system prefers-color-scheme, or the `aurora-cosmic`/`midnight-slate` fallback pair.

---

## 2. Logic Chain & Proposed Implementation Plan

To fully integrate the UI foundation, we propose the following changes. No code is modified during this read-only phase.

### 2.1 Route Mapping Addition (`palettes.ts`)
Add `"/landing"` explicitly to the `ROUTE_PALETTE_MAP` to ensure that direct access to the landing page uses Saffron Marigold (light) instead of falling back to Aurora Cosmic (dark).
```typescript
// Proposed addition to ROUTE_PALETTE_MAP in src/lib/palettes.ts
"/landing":    { palette: "saffron-marigold", theme: "light" },
```

### 2.2 Pre-Hydration Blocker Script (`layout.tsx`)
To prevent a Flash of Unstyled Content (FOUC) when loading the app, we need to inject a blocking script in the `<head>` of the root `layout.tsx`. This script reads the path and any `localStorage` override to apply the theme instantly before React hydrates the page.
```tsx
// Proposed addition inside the <head> tag of apps/web/src/app/layout.tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      (function() {
        try {
          const path = window.location.pathname;
          let palette = "aurora-cosmic";
          let theme = "dark";
          
          if (path === "/" || path === "/landing") {
            palette = "saffron-marigold";
            theme = "light";
          } else if (path.startsWith("/auth") || path.startsWith("/login") || path.startsWith("/signup")) {
            palette = "violet-nebula";
            theme = "dark";
          } else if (path.startsWith("/students")) {
            palette = "rose-petal";
            theme = "light";
          } else if (path.startsWith("/attendance")) {
            palette = "cyan-lagoon";
            theme = "light";
          } else if (path.startsWith("/fees") || path.startsWith("/reports")) {
            palette = "emerald-ledger";
            theme = "light";
          } else if (path.startsWith("/settings")) {
            palette = "violet-nebula";
            theme = "light";
          }

          const localTheme = localStorage.getItem("buddysaradhi.theme");
          const preferredTheme = localTheme || "system";
          
          let resolvedTheme = theme;
          if (preferredTheme !== "system") {
            resolvedTheme = preferredTheme;
          } else {
            resolvedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          }

          let resolvedPalette = palette;
          if (palette === "aurora-cosmic" && resolvedTheme === "light") {
            resolvedPalette = "midnight-slate";
          } else if (palette === "midnight-slate" && resolvedTheme === "dark") {
            resolvedPalette = "aurora-cosmic";
          }

          document.documentElement.setAttribute("data-palette", resolvedPalette);
          document.documentElement.setAttribute("data-theme", resolvedTheme);
        } catch (e) {}
      })();
    `
  }}
/>
```

### 2.3 Settings Sync (`appearance-section.tsx`)
When a user updates their theme preference in Settings, we must write this preference to `localStorage` under `buddysaradhi.theme` so the change takes effect instantly and is accessible by the pre-hydration blocker script.
```typescript
// Proposed modification to updateMutation in apps/web/src/components/settings/appearance-section.tsx
const updateMutation = useMutation({
  mutationFn: async ({ field, value }: { field: string, value: unknown }) => {
    await updateSettingAction(field, value);
    if (field === 'theme') {
      localStorage.setItem('buddysaradhi.theme', value as string);
    }
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] })
});
```

### 2.4 Dynamic Theme & Palette Resolution (`palette-provider.tsx`)
Create a custom hook `useResolvedTheme` inside `palette-provider.tsx` that:
1. Queries the DB settings via TanStack Query.
2. Intercepts local storage and system media queries.
3. Dynamically resolves the theme.

Update `PaletteProvider` to use this hook and automatically swap between `aurora-cosmic` and `midnight-slate` based on the resolved theme.

```tsx
// Proposed update for apps/web/src/lib/palette-provider.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";
import { PaletteId, ThemeId } from "./palettes";

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

function useResolvedTheme(defaultTheme: ThemeId) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
    staleTime: 30_000,
  });

  const dbTheme = data?.data?.theme;
  const [resolvedTheme, setResolvedTheme] = useState<ThemeId>(defaultTheme);

  useEffect(() => {
    const localTheme = localStorage.getItem("buddysaradhi.theme") as ThemeId | null;
    const preferredTheme = dbTheme || localTheme || "system";

    if (preferredTheme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleSystemChange = (e: MediaQueryListEvent | MediaQueryList) => {
        setResolvedTheme(e.matches ? "dark" : "light");
      };
      handleSystemChange(mediaQuery);
      mediaQuery.addEventListener("change", handleSystemChange);
      return () => mediaQuery.removeEventListener("change", handleSystemChange);
    } else {
      setResolvedTheme(preferredTheme as ThemeId);
    }
  }, [dbTheme, defaultTheme]);

  return resolvedTheme;
}

interface PaletteProviderProps {
  palette: PaletteId;
  theme: ThemeId;
  children: ReactNode;
}

export function PaletteProvider({ palette, theme, children }: PaletteProviderProps) {
  const resolvedTheme = useResolvedTheme(theme);

  // Aurora Cosmic / Midnight Slate swap handling
  let resolvedPalette = palette;
  if (palette === "aurora-cosmic" && resolvedTheme === "light") {
    resolvedPalette = "midnight-slate";
  } else if (palette === "midnight-slate" && resolvedTheme === "dark") {
    resolvedPalette = "aurora-cosmic";
  }

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-palette", resolvedPalette);
    html.setAttribute("data-theme", resolvedTheme);
  }, [resolvedPalette, resolvedTheme]);

  return (
    <PaletteContext.Provider value={{ palette: resolvedPalette, theme: resolvedTheme }}>
      {children}
    </PaletteContext.Provider>
  );
}
```

---

## 3. Caveats & Edge Cases

1. **Hydration Warning**: Injecting a script that modifies HTML attributes before hydration may trigger Next.js hydration warnings if the server-rendered HTML attributes differ from the final client-rendered attributes. However, since Next.js doesn't strictly check root `<html>` attribute diffs during initial paint, this warning is minimized if using `suppressHydrationWarning` on the `<html>` tag in `layout.tsx`.
2. **A/B Testing Rewrite**: The middleware rewrites `/` to `/landing` on the store subdomain and redirects `/` to `/login` on the app subdomain. Since `/landing` is a rewritten page, its client-side path might read as `/` or `/landing`. It is essential that both `/` and `/landing` are mapped to Saffron Marigold (light) in the router and blocker scripts.
3. **No-Indigo Lint Rule**: The `no-indigo-accent` lint rules must pass. Double check that we do not introduce `#6366F1` or related shades (except in Cyan Lagoon's commented warning or Violet Nebula's permitted `#7C3AED` block).

---

## 4. Conclusion & Verification Method

The current foundation is extremely solid with CSS classes and mapping rules already structured. By implementing the custom hooks and sync logic above, we can seamlessly enable Indian tutors to experience a highly personalized, offline-first responsive UI.

### Verification Steps
1. **Visual Test**: Load the settings page, select "Cosmic Dark", "Light", and "System Match", and check that the correct data attributes are applied to the `<html>` node.
2. **Console Verification**: In browser DevTools, run:
   ```javascript
   document.documentElement.getAttribute('data-palette');
   document.documentElement.getAttribute('data-theme');
   ```
   Assert they correspond to the active section (e.g., `/students` -> `data-palette="rose-petal"` `data-theme="light"`).
3. **Reduced Motion**: Verify that the media query is respected (CSS animations disable when reduced motion is enabled).
