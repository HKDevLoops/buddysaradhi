## 2026-07-11T10:13:30Z
You are teamwork_preview_worker. Your working directory is d:\Projects\buddysaradhi\buddysaradhi\.agents\worker_m1.
Your task is to implement the M1 UI Foundation (Palettes & Globals) requirements in the Next.js web application as specified by the following instructions and findings.

### Integrity Warning (DO NOT VIOLATE)
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

### Objective
1. Mitigate FOUC (Flash of Unstyled Content) by adding a synchronous, head-blocking script tag inside `<head>` in `apps/web/src/app/layout.tsx`. This script should:
   - Check `window.location.pathname`.
   - Resolve the correct palette and theme based on route mapping (matching getPaletteForRoute logic).
   - Check `localStorage.getItem("buddysaradhi.theme")` to override theme if present.
   - If the theme matches light/dark, map `aurora-cosmic` <-> `midnight-slate` where appropriate.
   - Set attributes `data-palette` and `data-theme` on `document.documentElement` immediately.
2. Add `suppressHydrationWarning` on the `<html>` element in `apps/web/src/app/layout.tsx`.
3. Update `apps/web/src/lib/palettes.ts` to include `"/landing"` in `ROUTE_PALETTE_MAP` mapping to `saffron-marigold` / `light`.
4. Create `apps/web/src/app/landing/layout.tsx` to wrap the landing page in a `<PaletteProvider palette="saffron-marigold" theme="light">`.
5. Update `apps/web/src/lib/palette-provider.tsx` to:
   - Use React Query via `useQuery` on key `['settings']` to reactively get the database settings for theme.
   - Respect theme overrides (light, dark, or system matching via media query).
   - Update `localStorage.setItem('buddysaradhi.theme', resolvedTheme)` when theme changes.
   - Handle the `aurora-cosmic` <-> `midnight-slate` pairing updates dynamically.
6. Update `apps/web/src/components/settings/appearance-section.tsx` theme modification logic to also set `localStorage.setItem('buddysaradhi.theme', value)` synchronously upon toggle.

### Verification
Once implemented, compile the web application by running:
- `bun run typecheck` inside `apps/web`
- `bun run build` inside `apps/web`
Document the command output and result in your handoff report (`handoff.md`).

Keep progress.md updated. Deliver your handoff.md report inside your folder when done.
