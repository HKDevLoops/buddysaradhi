# Project: Buddysaradhi UI Design Master Plan Implementation

## Architecture
- Platform: Next.js 16 Web Application (App Router).
- Screen Switching: Client-side Zustand-driven screen state in `<GlassShell>` component.
- Theme System: `<PaletteProvider>` in `apps/web/src/app/layout.tsx` wraps the app, injecting `data-palette` and `data-theme` attribute to `<html>`.
- Styles: `apps/web/src/app/globals.css` declares all variables under the `[data-palette][data-theme]` selectors.
- Component System: Extended `shadcn/ui` components located in `apps/web/src/components/ui`.
- Motion System: Framer Motion variants defined in `apps/web/src/lib/motion.ts`.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | R1. UI Foundation (Palettes & Provider) | Implement `palettes.ts`, update `globals.css` with 8 palettes and their variables, implement `<PaletteProvider>` and wrap the root layout | none | PLANNED |
| 2 | R2. Component Library Customization | Create base glassmorphism, neumorphism classes, customize `<Button>`, `<Chip>`, `<GlassCard>` with CSS variables & Framer Motion transitions, add `src/lib/motion.ts` | M1 | PLANNED |
| 3 | R3. Page Implementation: Landing & Auth | Update Landing (`/landing`) and Auth (`/login` and `/signup`) to match HTML mockups | M2 | PLANNED |
| 4 | R3. Page Implementation: Dashboard & Settings | Update Dashboard and Settings client views to match HTML mockups | M2 | PLANNED |
| 5 | R3. Page Implementation: Students & Attendance | Update Students and Attendance client views to match HTML mockups | M2 | PLANNED |
| 6 | R3. Page Implementation: Fees & Reports | Update Fees and Reports (including layout additions if necessary) client views to match HTML mockups | M2 | PLANNED |
| 7 | Verification & Verification Gates | Run automated typechecks, builds, accessibility scans, and lint validation across all 8 routes | M3, M4, M5, M6 | PLANNED |

## Interface Contracts
### PaletteProvider ↔ Route Pages
- Every route component or view component relies on the `data-palette` and `data-theme` context or DOM attributes set by `<PaletteProvider>`.
- Sidebar components or setting views can invoke theme toggling or page switching, updating `PaletteProvider` inputs or activeScreen Zustand state.
