# Handoff Report: R1. UI Foundation (Palettes & Globals)

## 1. Observation

We directly observed the following components and structures:
- **Global CSS File**: `apps/web/src/app/globals.css` (Total Lines: 1111). It defines the 8 palettes via `[data-palette="..."][data-theme="..."]` selectors (Lines 105–740). Specifically:
  - Aurora Cosmic (dark default) is at line 105.
  - Saffron Marigold (light/dark) is at line 171.
  - Emerald Ledger (light/dark) is at line 260.
  - Cyan Lagoon (light/dark) is at line 349.
  - Rose Petal (light/dark) is at line 438.
  - Amber Sunrise (light/dark) is at line 527.
  - Violet Nebula (light/dark) is at line 610.
  - Midnight Slate (light default) is at line 698.
- **Palettes Mapping Manifest**: `apps/web/src/lib/palettes.ts` (Total Lines: 131) defines `ROUTE_PALETTE_MAP` (Lines 105–116) mapping routes like `/dashboard` to `aurora-cosmic` (dark), `/students` to `rose-petal` (light), etc.
- **Palette Provider**: `apps/web/src/lib/palette-provider.tsx` (Total Lines: 72) manages setting `data-palette` and `data-theme` on `document.documentElement` within a `useEffect` hook (Lines 54–64).
- **Settings Screen (Appearance)**: `apps/web/src/components/settings/appearance-section.tsx` (Total Lines: 134) renders the UI theme controls (Lines 35–71) and executes the `updateMutation` action (Lines 17–22).
- **Root Layout**: `apps/web/src/app/layout.tsx` (Total Lines: 84) hardcodes the HTML attributes (Lines 73–74):
  ```tsx
  data-palette="aurora-cosmic"
  data-theme="dark"
  ```

---

## 2. Logic Chain

1. **Routing and Mapping Alignment**:
   - *Observation*: The landing page rewritten pathway `/landing` is missing from `ROUTE_PALETTE_MAP`.
   - *Inference*: Add `"/landing": { palette: "saffron-marigold", theme: "light" }` to `ROUTE_PALETTE_MAP` in `palettes.ts` to ensure consistency.
2. **Dynamic Settings Integration**:
   - *Observation*: `palette-provider.tsx` currently only sets the route-default theme and does not integrate the user settings theme ('light', 'dark', 'system') from the database.
   - *Inference*: Implement a `useResolvedTheme` hook in `palette-provider.tsx` that fetches settings via React Query, fallback checks `localStorage`, and handles the `"system"` preference using media queries.
3. **Cosmic / Slate Pair Swap**:
   - *Observation*: `UI/01_Color_Palettes.md` states "Midnight Slate's dark variant is Aurora Cosmic... they are a pair: light = Midnight Slate, dark = Aurora Cosmic."
   - *Inference*: Inside `PaletteProvider`, dynamically swap the active palette value between `aurora-cosmic` and `midnight-slate` depending on whether the resolved theme is `dark` or `light`.
4. **Immediate Client Sync**:
   - *Observation*: The settings screen `AppearanceSection` updates the DB via mutation but does not write to `localStorage`.
   - *Inference*: Update `updateMutation` inside `appearance-section.tsx` to set `localStorage.setItem('buddysaradhi.theme', value)` during theme changes.
5. **Flash of Unstyled Content (FOUC)**:
   - *Observation*: The server-rendered root `layout.tsx` default is dark cosmic, causing a flash on light pages before React runs client-side `useEffect`s.
   - *Inference*: Inject a blocking inline `<script>` in the `<head>` of `layout.tsx` to read the pathname and `localStorage` to apply initial attributes immediately.

---

## 3. Caveats

1. **Hydration Warning**: Root attribute modifications by a script prior to React mounting can lead to React hydration warnings. We recommend adding `suppressHydrationWarning` to the `<html>` tag in `layout.tsx`.
2. **Subdomain Rewrites**: The middleware handles different subdomains (e.g., store vs app). Ensure that the route resolution handles both `/` and `/landing` as the landing page.
3. **No-Indigo Lint Constraint**: When implementing, verify that no prohibited indigo hex/colors (like `#6366F1`) are added to the codebase.

---

## 4. Conclusion

The global stylesheets (`globals.css`) and manifests (`palettes.ts`) are fully established. The implementer should refine `palette-provider.tsx`, `appearance-section.tsx`, and `layout.tsx` using the provided code patterns in `analysis.md` to complete the dynamic palette switching engine.

---

## 5. Verification Method

To verify the implementation once applied:
1. **Dynamic Swapping**: Navigate between `/dashboard` (Aurora Cosmic), `/students` (Rose Petal), and `/settings` (Violet Nebula). Inspect `document.documentElement` and verify that both `data-palette` and `data-theme` change correctly.
2. **Theme Overrides**: Go to settings, choose "Light (Beta)", and verify that the layout updates instantly. Reload the page and ensure the light theme is active immediately without any color flash (FOUC).
3. **System Match**: Change settings to "System Match". Change the host OS color scheme from light to dark and vice-versa, and verify that the app theme transitions instantly.
