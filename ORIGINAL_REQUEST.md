# Original User Request

## Initial Request — 2026-07-11T14:48:10Z

Implement the Buddysaradhi UI Design Master Plan into the Next.js web application. This includes establishing the 8 color palettes, the glass/neumorphic component library (via shadcn/ui), integrating Framer Motion microinteractions, and fully updating the 8 web pages to match the provided CSS tokens and visual HTML mockups in the `UI/` folder.

Working directory: d:/Projects/buddysaradhi/buddysaradhi
Integrity mode: demo

## Requirements

### R1. UI Foundation (Palettes & Globals)
Define the 8 color palettes in `src/app/globals.css` (or `palettes.ts`), handling both light and dark variants according to `UI/01_Color_Palettes.md`. Establish the `<PaletteProvider>` wrapper in the root layout to switch `data-palette` per page. 

### R2. Component Library Customization
Customize the existing `shadcn/ui` primitives to match the `UI/03_Component_Library.md` specifications, specifically implementing the glassmorphism effect and neumorphic dual-shadows. Incorporate Framer Motion for microinteractions defined in `UI/04_Motion_and_Microinteractions.md`.

### R3. Page Implementation
Update all 8 web pages (Landing, Auth, Dashboard, Students, Attendance, Fees & Payments, Reports, Settings) to strictly match the standalone HTML mockups provided in `UI/mockups/web/`. Each page must use its assigned palette and maintain responsive behavior.

## Acceptance Criteria

### Verification Standards
- [ ] Automated linting (`npm run lint`) passes with 0 violations of the `no-indigo-accent` rule.
- [ ] Running a basic accessibility scan (e.g., `npx axe-core`) over the primary routes yields 0 critical violations.
- [ ] All 8 primary web routes correctly inject their assigned `data-palette` into the DOM.
- [ ] The `npm run typecheck` and `npm run build` commands complete without errors.
