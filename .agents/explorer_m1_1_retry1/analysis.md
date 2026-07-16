# Analysis Report: R1. UI Foundation (Palettes & Globals)

## Summary of Findings
- **`src/lib/palettes.ts`**: Already exists and defines the typed palette definitions, including `PaletteId`, `ThemeId`, `PALETTES` metadata, and route mappings via `ROUTE_PALETTE_MAP`.
- **`src/app/globals.css`**: Already exists and contains CSS variables for all 8 palettes, including light and dark variants. It is integrated with Tailwind 4 via `@theme inline`.
- **`src/lib/palette-provider.tsx`**: Already exists and contains `<PaletteProvider>` which sets the `data-palette` and `data-theme` attributes on `document.documentElement` (`<html>`) on load or route change.
- **Critical Gaps & Issues**:
  1. The landing page (`src/app/landing/page.tsx`) does not utilize `<PaletteProvider>` yet, meaning it defaults to `aurora-cosmic`/`dark` from `layout.tsx` instead of `saffron-marigold` (light) and `amber-sunrise` (light).
  2. The actual screen components (e.g. `attendance-client.tsx`, `attendance-grid.tsx`, `ledger-table.tsx`) are currently hardcoded with dark-mode assumed classes (like `text-white`, `text-white/70`, `text-white/40`, `bg-[#0C081A]/90`, `bg-[#0C081A]/80`, `divide-white/5`, `border-white/5`, etc.) instead of utilizing the dynamic, palette-independent CSS custom properties.
  3. Hydration flashes are likely to occur because Next.js root layout compiles with static `data-palette="aurora-cosmic"` and `data-theme="dark"` on `<html>`, which is only updated on the client by `useEffect` inside `<PaletteProvider>`.

---

## 1. Observations
We investigated the following files to assess the current state of the UI Foundation:

### A. Root Layout Files
- **`apps/web/src/app/layout.tsx`**: Sets font pairings (Sora, Onest, JetBrains Mono) as CSS variables on the `<html>` element. It hardcodes `data-palette="aurora-cosmic"` and `data-theme="dark"` directly on `<html>`.
- **`apps/web/src/app/providers.tsx`**: Configures React Query (`QueryClientProvider`), but does not wrap children with `<PaletteProvider>` or other layout-level theme providers.
- **`apps/web/src/app/(app)/layout.tsx`**: Wraps dashboard route content in the `<GlassShell>` component.

### B. Navigation & Shell Layout
- **`apps/web/src/components/buddysaradhi/glass-shell.tsx`**: Wraps the sidebar, topbar, scrollable content area, and sticky footer in a `<PaletteProvider>`.
  - Inside the component, it maps Zustand's `activeScreen` state to the respective palette:
    ```typescript
    const SCREEN_PALETTES: Record<string, { palette: PaletteId; theme: ThemeId }> = {
      "/dashboard": { palette: "aurora-cosmic", theme: "dark" },
      "/students":  { palette: "rose-petal",    theme: "light" },
      "/attendance":{ palette: "cyan-lagoon",   theme: "light" },
      "/fees":      { palette: "emerald-ledger",theme: "light" },
      "/settings":  { palette: "violet-nebula", theme: "light" },
    };
    ```
  - Passed as props: `<PaletteProvider palette={currentPalette.palette} theme={currentPalette.theme}>`.

### C. Globals CSS
- **`apps/web/src/app/globals.css`**: Defines:
  - Tailwind 4 `@import` rules and theme variables (`@theme inline { ... }`), mapping standard utility names (like `color-emerald`) to palette variables (`var(--accent-emerald)`).
  - Palette-independent tokens: `:root` sets typographic variables, animation easing/speed, and space tokens.
  - Palette-specific custom property blocks for all 8 palettes corresponding to `UI/01_Color_Palettes.md`:
    - `[data-palette="aurora-cosmic"], :root` (Defaults)
    - `[data-palette="saffron-marigold"][data-theme="light"]` and `[data-palette="saffron-marigold"][data-theme="dark"]`
    - `[data-palette="emerald-ledger"][data-theme="light"]` and `[data-palette="emerald-ledger"][data-theme="dark"]`
    - `[data-palette="cyan-lagoon"][data-theme="light"]` and `[data-palette="cyan-lagoon"][data-theme="dark"]`
    - `[data-palette="rose-petal"][data-theme="light"]` and `[data-palette="rose-petal"][data-theme="dark"]`
    - `[data-palette="amber-sunrise"][data-theme="light"]` and `[data-palette="amber-sunrise"][data-theme="dark"]`
    - `[data-palette="violet-nebula"][data-theme="light"]` and `[data-palette="violet-nebula"][data-theme="dark"]`
    - `[data-palette="midnight-slate"][data-theme="light"]`
  - Utility classes: `@layer utilities` defines styles for `.glass`, `.glass-strong`, `.glass-card`, `.neumo-raised`, `.neumo-inset`, `.chip`, `.data-table`, etc., using CSS variables.

### D. Typed Palette Manifest
- **`apps/web/src/lib/palettes.ts`**: Contains the full typescript declaration for all 8 palettes, exporting `PaletteId`, `ThemeId`, `PaletteDefinition` interface, and the `PALETTES` configurations. It also contains:
  ```typescript
  export const ROUTE_PALETTE_MAP: Record<string, { palette: PaletteId; theme: ThemeId }> = {
    "/":           { palette: "saffron-marigold", theme: "light" },
    "/auth":       { palette: "violet-nebula",    theme: "dark"  },
    "/login":      { palette: "violet-nebula",    theme: "dark"  },
    "/signup":     { palette: "violet-nebula",    theme: "dark"  },
    "/dashboard":  { palette: "aurora-cosmic",    theme: "dark"  },
    "/students":   { palette: "rose-petal",       theme: "light" },
    "/attendance": { palette: "cyan-lagoon",      theme: "light" },
    "/fees":       { palette: "emerald-ledger",   theme: "light" },
    "/reports":    { palette: "emerald-ledger",   theme: "light" },
    "/settings":   { palette: "violet-nebula",    theme: "light" },
  };
  ```
  And a helper function `getPaletteForRoute(pathname: string)` for matching route prefixes.

### E. Palette Provider
- **`apps/web/src/lib/palette-provider.tsx`**: Sets `data-palette` and `data-theme` on the `html` node inside `useEffect`:
  ```typescript
  export function PaletteProvider({ palette, theme, children }: PaletteProviderProps) {
    useEffect(() => {
      const html = document.documentElement;
      html.setAttribute("data-palette", palette);
      html.setAttribute("data-theme", theme);

      return () => {
        // Restore default aurora-cosmic on unmount
        html.setAttribute("data-palette", "aurora-cosmic");
        html.setAttribute("data-theme", "dark");
      };
    }, [palette, theme]);
    ...
  }
  ```

---

## 2. Logic Chain & Implementation Plan

### A. Prevent Hydration Flash of Default Aurora Cosmic Dark Theme
- **Problem**: Next.js servers render `<html>` with the static attributes from `layout.tsx` (i.e. `data-palette="aurora-cosmic" data-theme="dark"`). When a page like `/students` or `/fees` loads, the user gets a dark cosmic layout for a fraction of a second before `useEffect` in `<PaletteProvider>` runs on the client.
- **Proposed Solution**: Inject an inline `<script>` tag inside the `<head>` of the root `layout.tsx` that executes immediately before hydration. This script checks the URL path or a cookie, and sets the attributes synchronously to avoid visual flickering.
- **Proposed Script (in `layout.tsx`):**
  ```html
  <script
    dangerouslySetInnerHTML={{
      __html: `
        (function() {
          try {
            var path = window.location.pathname;
            var theme = localStorage.getItem('buddysaradhi.theme');
            
            // Map routes to palettes
            var palette = 'aurora-cosmic';
            var defaultTheme = 'dark';
            
            if (path === '/') { palette = 'saffron-marigold'; defaultTheme = 'light'; }
            else if (path.startsWith('/login') || path.startsWith('/signup') || path.startsWith('/auth')) { palette = 'violet-nebula'; defaultTheme = 'dark'; }
            else if (path.startsWith('/students')) { palette = 'rose-petal'; defaultTheme = 'light'; }
            else if (path.startsWith('/attendance')) { palette = 'cyan-lagoon'; defaultTheme = 'light'; }
            else if (path.startsWith('/fees') || path.startsWith('/reports')) { palette = 'emerald-ledger'; defaultTheme = 'light'; }
            else if (path.startsWith('/settings')) { palette = 'violet-nebula'; defaultTheme = 'light'; }
            
            var finalTheme = theme === 'light' || theme === 'dark' ? theme : defaultTheme;
            
            document.documentElement.setAttribute('data-palette', palette);
            document.documentElement.setAttribute('data-theme', finalTheme);
          } catch (e) {}
        })();
      `
    }}
  />
  ```

### B. Integrate Landing Page with Palette Provider
- **Problem**: The landing page `landing/page.tsx` hardcodes some background properties and defaults to `aurora-cosmic`/`dark` because it doesn't wrap itself in `<PaletteProvider>`.
- **Proposed Solution**:
  1. Wrap the landing page sections in `<PaletteProvider palette="saffron-marigold" theme="light">` (for the hero) and `<PaletteProvider palette="amber-sunrise" theme="light">` (for features/pricing).
  2. Remove hardcoded Tailwind colors (such as `bg-[#0C081A]`, `text-white/50`, etc.) and replace them with standard theme variable references (like `bg-[var(--bg-canvas)]` and `text-[var(--text-primary)]`).

### C. Refactor Components to Use Dynamic Theme Custom Properties
- **Problem**: Roster, attendance grid, and ledger tables have hardcoded colors assuming a dark canvas (e.g. `text-white`, `text-white/70`, `bg-[#0C081A]/90`, `border-white/5`). Under light themes like Rose Petal or Emerald Ledger, these elements will be illegible or invisible.
- **Proposed Solution**:
  Replace hardcoded colors in screen components with semantic CSS properties:
  - `bg-[#0C081A]/90` or `bg-[#0C081A]/80` &rarr; `bg-[var(--bg-surface)]` or `bg-[var(--bg-surface-raised)]`
  - `text-white` &rarr; `text-[var(--text-primary)]`
  - `text-white/80` or `text-white/70` &rarr; `text-[var(--text-secondary)]`
  - `text-white/50` or `text-white/40` &rarr; `text-[var(--text-muted)]`
  - `border-white/5` or `divide-white/5` &rarr; `border-[var(--border-glass)]` or `divide-[var(--border-glass)]`
  - `hover:bg-white/[0.04]` &rarr; `hover:bg-[var(--surface-glass-faint)]`

### D. Connect User Theme Selection toggle
- **Problem**: There is currently no active toggle hook mapping to `localStorage.buddysaradhi.theme`.
- **Proposed Solution**:
  - Expose a `setTheme` method in the `PaletteContextValue` from `palette-provider.tsx` that updates the React state (which triggers the `useEffect` setting `data-theme`) and updates `localStorage.setItem('buddysaradhi.theme', newTheme)`.
  - Consume this context inside `SettingsClient` to render a theme toggle button.

---

## 3. Caveats & Potential Risks
1. **Contrast Compliance**: Although the CSS variables in `globals.css` are configured for AAA/AA contrast, if components reference hardcoded tailwind colors (like `text-white`) instead of variables (like `text-[var(--text-primary)]`), they will break readability under light-themed pages. Component audit is crucial.
2. **Dynamic Pairs (Midnight Slate & Aurora Cosmic)**: When swapping the theme to light under `aurora-cosmic`, it must swap the palette to `midnight-slate`. When swapping theme to dark under `midnight-slate`, it must swap the palette to `aurora-cosmic`. The `PaletteProvider` logic must explicitly handle this dynamic pair to prevent issues.

---

## 4. Conclusion & Verification Method
The core UI Foundation (Variables, Palettes, CSS configuration, Provider) is scaffolded. However, the implementation is not fully functional because:
1. The landing page lacks the provider wrapping.
2. The UI components are hardcoded to dark-mode styling variables.
3. Hydration flashes are not prevented.

### Verification Method (Once Implemented)
1. **Local Server Rendering Pass**: Start the app and navigate to `/dashboard` (dark), `/students` (light/rose), `/attendance` (light/cyan), `/fees` (light/emerald), and `/settings` (light/violet) to confirm that the `<html>` element receives the correct attributes (`data-palette` and `data-theme`) without a white-to-dark or dark-to-light flash.
2. **Linter Check**: Run the project linter to ensure that no prohibited indigo colors (`#6366F1`, etc.) are defined.
3. **Contrast Tests**: Run `axe-core` check inside the browser (using Developer Tools or Cypress) on each of the screens under their assigned theme to verify that text-to-background contrast ratios are WCAG 2.1 AA compliant.
