# Handoff Report: UI Foundation (Palettes & Globals)

This report summarizes the read-only investigation and integration plan for R1. UI Foundation (Palettes & Globals) in `apps/web/src`.

---

## 1. Observation

During our investigation of the codebase, the following files and structural configurations were observed:

1. **`apps/web/src/app/globals.css`** contains the full implementation of the 8 palettes defined in `UI/01_Color_Palettes.md`.
   * Specifically, on lines 105–165:
     ```css
     [data-palette="aurora-cosmic"],
     :root {
       --bg-cosmic: #0f0c29;
       --bg-midnight: #24243e;
       --bg-abyss: #0a0a1a;
       ...
       --accent-emerald: #00FF9D;
       --accent-cyan: #00F0FF;
     }
     ```
   * Scopes other palettes like Saffron Marigold (lines 171–254), Emerald Ledger (lines 260–343), Cyan Lagoon (lines 349–432), Rose Petal (lines 438–521), Amber Sunrise (lines 527–604), Violet Nebula (lines 610–693), and Midnight Slate (lines 698–739).
   * Maps properties to Tailwind v4 theme utility properties on lines 7–51.

2. **`apps/web/src/lib/palettes.ts`** provides the TypeScript schema and page route-to-palette mapping:
   * Maps routes on lines 105–116:
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

3. **`apps/web/src/app/layout.tsx`** exposes default root configuration on lines 70–75:
   ```typescript
   <html
     lang="en-IN"
     className={`${sora.variable} ${onest.variable} ${jetbrainsMono.variable} scroll-smooth`}
     data-palette="aurora-cosmic"
     data-theme="dark"
   >
   ```

4. **`apps/web/src/lib/palette-provider.tsx`** updates DOM attributes on lines 54–64:
   ```typescript
   useEffect(() => {
     const html = document.documentElement;
     html.setAttribute("data-palette", palette);
     html.setAttribute("data-theme", theme);

     return () => {
       html.setAttribute("data-palette", "aurora-cosmic");
       html.setAttribute("data-theme", "dark");
     };
   }, [palette, theme]);
   ```

5. **`apps/web/src/app/landing/page.tsx`** does not contain any reference to `PaletteProvider` or custom page layouts.

6. **`apps/web/src/components/settings/appearance-section.tsx`** allows toggling themes on lines 36–70, but changes are only persisted to the database settings column and not updated on the frontend DOM/`localStorage`.

---

## 2. Logic Chain

Based on the observations:
1. **FOUC Mitigation:** Because Next.js server-renders the root layout with hardcoded `aurora-cosmic`/`dark` attributes, any page that uses a light palette or another dark palette (such as `/login` or `/students`) will initially be rendered using Cosmic Dark styles until hydration completes. To prevent this, we must inject a small script tag inside `<head>` in `app/layout.tsx` to set the correct attributes on `<html>` before DOM painting occurs.
2. **Dynamic Route Layouts:** To support the landing page theme (which is served under `/landing` via rewrite or direct hit), a layout file `app/landing/layout.tsx` must be added with the `PaletteProvider` wrapper.
3. **User Theme Override Persistence:** To support theme overrides, `PaletteProvider` must read from `localStorage` (`buddysaradhi.theme`) which will be updated by the settings page whenever the user updates their theme preference.
4. **Hydration Warning Bypass:** Because the inline script changes the document attributes on the fly, `suppressHydrationWarning` must be added to `<html>` to avoid hydration console warnings in the browser.

---

## 3. Caveats

* **Storage vs Server Session Out-Of-Sync:** Setting the theme override in `localStorage` works synchronously for the current browser session, but if the user logs in from another device/browser, they will experience a minor theme flash until the backend settings query returns and updates the local storage cache.

---

## 4. Conclusion

The core color styles, stylesheets, maps, and providers are already 95% complete. The remaining integration work involves adding the FOUC-prevention script in `app/layout.tsx`, adding the `/landing` route layout, and hooking up `localStorage.setItem` in the appearance settings component.

---

## 5. Verification Method

To verify the integration, perform the following steps:
1. **Hydration check:** Run the development server (`bun run dev`) and navigate across dashboard, settings, and student rosters. Verify that the browser console is free of hydration warning logs.
2. **Flash test:** Turn off JavaScript in the browser settings, refresh the page on `/login` or `/students`, and verify that the layout displays the correct background and color scheme instantly.
3. **Settings round-trip:** Switch themes in the Settings UI and verify that `localStorage` receives the theme string and changes are reflected instantly on the DOM tree.
