# UI Design Master Plan Implementation Plan

## Overview
This plan coordinates the execution of the Buddysaradhi UI Design Master Plan as described in `ORIGINAL_REQUEST.md` and the `UI/` folder specifications.

## Milestone Breakdown

### Milestone 1: R1. UI Foundation (Palettes & Provider)
- **Goal**: Establish the 8 color palettes in `globals.css` and a `<PaletteProvider>` wrapper that maps routes to their assigned palettes and handles theme switching.
- **Tasks**:
  1. Define CSS variables for each palette (light/dark variants) under matching selectors like `[data-palette="..."][data-theme="..."]` in `apps/web/src/app/globals.css`.
  2. Implement `src/lib/palettes.ts` exporting details about the palettes and page mapping.
  3. Create `src/components/buddysaradhi/palette-provider.tsx` or similar component.
  4. Wrap the root `layout.tsx` with `<PaletteProvider>`.

### Milestone 2: R2. Component Library Customization
- **Goal**: Customize shadow/border styling for glass/neumorphic primitives, update `<Button>`, `<Chip>`, and `<GlassCard>` components. Create standard animation helper.
- **Tasks**:
  1. Add utility CSS classes (`.glass-card`, `.neumo-raised`, `.neumo-inset`) in `globals.css`.
  2. Implement `src/lib/motion.ts` containing Framer Motion variants.
  3. Implement/update `<Button>`, `<Chip>`, and `<GlassCard>` components to use the tokens and variants.

### Milestone 3: R3. Page Implementation: Landing & Auth
- **Goal**: Fully rewrite the Landing (`/landing`) and Auth (`/login` and `/signup`) pages/views to strictly match the standalone HTML mockups (`01_landing.html` and `02_auth.html`).
- **Tasks**:
  1. Implement HTML mockups structures in TSX, using Tailwind CSS and the custom components.
  2. Set theme defaults: Saffron Marigold/Amber Sunrise for Landing (default: light), Violet Nebula for Auth (default: dark).

### Milestone 4: R3. Page Implementation: Dashboard & Settings
- **Goal**: Rewrite the Dashboard client view (`DashboardClient`) and Settings client view (`SettingsClient`) to match `03_dashboard.html` and `08_settings.html`.
- **Tasks**:
  1. Update `DashboardClient` to use Aurora Cosmic (default: dark) with premium glass panels and correct KPI cards.
  2. Update `SettingsClient` to use Violet Nebula (default: light) with appearance settings, notification sliders, and database maintenance settings.

### Milestone 5: R3. Page Implementation: Students & Attendance
- **Goal**: Rewrite `StudentsClient` and `AttendanceClient` to match `04_students.html` and `05_attendance.html`.
- **Tasks**:
  1. Update `StudentsClient` with Rose Petal (default: light) theme, student list layout, and profile drawer.
  2. Update `AttendanceClient` with Cyan Lagoon (default: light) theme, calendar grid, present/absent segmented control.

### Milestone 6: R3. Page Implementation: Fees & Reports
- **Goal**: Rewrite `FeesClient` and add a new `ReportsClient` to match `06_fees.html` and `07_reports.html`.
- **Tasks**:
  1. Update `FeesClient` with Emerald Ledger (default: light) theme, ledger table, payment record sheet, invoice generator sheet.
  2. Implement `ReportsClient` using Emerald Ledger (default: light) with charts and financial status cards, and expose it in `<GlassShell>` navigation.

### Milestone 7: Verification and Gates
- **Goal**: Perform all automated and manual quality checks.
- **Tasks**:
  1. Run `npm run typecheck` to verify TypeScript builds.
  2. Run `npm run build` to verify Vercel output compilation.
  3. Verify accessibility with `npx axe-core`.
  4. Ensure 0 violations of `no-indigo-accent` rule.

## Agent Coordination Strategy
For each milestone, the Orchestrator will:
1. Spawn a `teamwork_preview_explorer` to study the target components, route structures, and relevant mockups.
2. Spawn a `teamwork_preview_worker` to write the required code, customize the components, and compile/test the local changes.
3. Spawn a `teamwork_preview_reviewer` to check the changes against the specifications.
4. Spawn a `teamwork_preview_challenger` to write and run any necessary test scripts/validations.
5. Spawn a `teamwork_preview_auditor` to verify integrity and compile tests.
