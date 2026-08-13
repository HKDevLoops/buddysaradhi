# Handoff Report: R1. UI Foundation (Palettes & Globals)

## 1. Observation
We observed the following files and content within the `d:\Projects\buddysaradhi\buddysaradhi` codebase:

- **`apps/web/src/app/globals.css`** (Lines 105-165, 171-254):
  Contains declarations for the 8 palettes defined in `UI/01_Color_Palettes.md` matching their expected custom CSS properties. E.g.:
  ```css
  [data-palette="aurora-cosmic"],
  :root {
    --bg-cosmic: #0f0c29;
    --bg-midnight: #24243e;
    ...
  }
  [data-palette="saffron-marigold"][data-theme="light"] {
    --bg-canvas: #FFFBF5;
    ...
  }
  ```
- **`apps/web/src/lib/palettes.ts`** (Lines 105-116):
  Contains the `ROUTE_PALETTE_MAP` dictionary that matches pathnames to palette/theme configurations.
  ```typescript
  export const ROUTE_PALETTE_MAP: Record<string, { palette: PaletteId; theme: ThemeId }> = {
    "/":           { palette: "saffron-marigold", theme: "light" },
    "/auth":       { palette: "violet-nebula",    theme: "dark"  },
    ...
  };
  ```
- **`apps/web/src/lib/palette-provider.tsx`** (Lines 53-71):
  Implements the `<PaletteProvider>` Client Component which dynamically updates the HTML properties:
  ```typescript
  export function PaletteProvider({ palette, theme, children }: PaletteProviderProps) {
    useEffect(() => {
      const html = document.documentElement;
      html.setAttribute("data-palette", palette);
      html.setAttribute("data-theme", theme);
      ...
    }, [palette, theme]);
  ```
- **`apps/web/src/components/buddysaradhi/glass-shell.tsx`** (Lines 40-52):
  Wraps the layout in a `<PaletteProvider>` passing properties based on Zustand's `activeScreen` state.
- **`apps/web/src/components/attendance/attendance-grid.tsx`** (Line 81-82):
  Demonstrates hardcoded style constraints:
  ```typescript
  <div className="glass-strong p-4 rounded-xl flex items-center justify-between sticky top-0 z-20 shadow-sm border border-white/5">
    <h2 className="text-sm font-medium text-white/70">
  ```
- **`apps/web/src/components/fees/ledger-table.tsx`** (Line 100):
  Demonstrates hardcoded background colors:
  ```typescript
  <thead className="sticky top-0 z-10 backdrop-blur-md bg-[#0C081A]/90 shadow-sm">
  ```

---

## 2. Logic Chain
- **Step 1**: The CSS styles and palettes declared in `globals.css` are correctly structured, and the types/mappings in `palettes.ts` matches the `UI/01_Color_Palettes.md` specifications.
- **Step 2**: The `<PaletteProvider>` component works as expected on the client side, but since root `layout.tsx` defaults statically to `data-palette="aurora-cosmic"` and `data-theme="dark"`, client-side hydration causes a visual flicker (flash) on page load for light-themed routes (Rose Petal, Emerald Ledger, Cyan Lagoon).
- **Step 3**: To eliminate the hydration flash, an inline `<script>` must be injected into root `layout.tsx` to set the correct attributes synchronously before hydration occurs.
- **Step 4**: The landing page (`landing/page.tsx`) does not utilize `<PaletteProvider>`, which leads to incorrect layout styling. Wrap the landing page sections with `<PaletteProvider>` using `saffron-marigold` / `amber-sunrise` to style it correctly.
- **Step 5**: Components in the application shell (e.g. `attendance-grid.tsx` and `ledger-table.tsx`) contain hardcoded dark-mode classes (like `text-white/70` and `bg-[#0C081A]/90`) instead of CSS variables. When themed to a light palette, these elements become unreadable or render improperly. These components must be refactored to use standard variables (e.g. `text-[var(--text-secondary)]` and `bg-[var(--bg-surface)]`).

---

## 3. Caveats
- We did not test/audit every single component file in `apps/web/src/components` for hardcoded color values. While `attendance-grid.tsx` and `ledger-table.tsx` were confirmed to have hardcoded colors, other components (like `student-profile`, `timetable`, etc.) may also contain similar hardcoded Tailwind color styles that require refactoring.
- The `no-indigo-accent` custom linter rule has not been verified locally since we did not run the build pipeline (investigation is read-only).

---

## 4. Conclusion
The implementation of the palette foundation is mostly complete, but several integration steps are needed:
1. Wrap the landing page inside the `PaletteProvider` using `saffron-marigold` (hero) and `amber-sunrise` (features/pricing).
2. Inject an inline path-parsing script inside `<head>` in root `layout.tsx` to set `data-palette` and `data-theme` attributes on `<html>` before hydration, preventing visual flashes.
3. Refactor component files (e.g., `attendance-grid.tsx`, `ledger-table.tsx`, and others) to replace hardcoded colors with their respective CSS custom property variables.

---

## 5. Verification Method
To verify the implementation:
1. **Visual inspection of HTML element attributes**: Open the browser's developer tools, navigate through the app routes, and inspect the `<html>` element. Verify that `data-palette` and `data-theme` change to the correct configuration per screen.
2. **Preventing Flash**: Reload a light-themed page (e.g., `/students` or `/fees`) and ensure there is no black-to-white visual flash.
3. **Contrast Analysis**: Run an automated contrast checker tool (e.g., `axe-core` or Lighthouse) on all screens in the app under both light and dark variants. Verify that all elements maintain a contrast ratio of at least 4.5:1 (WCAG AA).
