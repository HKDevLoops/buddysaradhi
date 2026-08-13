# Plan: Align UI With Realistic Product Craft

## Goal

Replace AI-default visual patterns in `apps/web` and `apps/product-page` with a deliberate, realistic product UI while preserving Buddysaradhi's committed Vibrant Glass identity, dark-default mode, five-screen model, and bioluminescent accent palette.

## Source Context

- Design doctrine: `https://impeccable.style/docs/` and `/slop` catalog.
- Incumbent authority: `13_UI_Guidelines.md` (Vibrant Glass, cosmic indigo-to-violet canvas, emerald/cyan/flare/amber/violet accents).
- Impeccable context detected no `PRODUCT.md` or `DESIGN.md`; both are required before a redesign-level implementation.
- Static reconnaissance found approximately 100 slop signatures across 29 UI files.

## Locked Decisions

1. **Preserve the visual world; change its discipline.** Cosmic canvas and bioluminescent accents remain. Glass is reserved for actual layering needs: modal, sheet, popover, floating navigation. It must not be nested as generic decoration.
2. **Operate vs persuade.** `apps/web` is an operate surface: density, scanability, clear state and task completion take priority. `apps/product-page` is a persuade surface: editorial hierarchy and credible product proof take priority.
3. **No generic replacement aesthetic.** Do not replace glass slop with cream minimalism, purple gradients, neon-on-dark, oversized serif italics, generic card grids, or a one-font SaaS template.
4. **No new top-level routes or screens.** Keep the five-screen product model.
5. **Accessibility remains non-negotiable.** Preserve WCAG AA minimum contrast, 44px targets, keyboard parity, reduced-motion behavior, and readable type scale.

## Findings To Address

- Global `.eyebrow` utility in `apps/web/src/app/globals.css` normalizes tracked uppercase kickers throughout the product.
- Product-page uses repeated eyebrow labels at `apps/product-page/src/app/page.tsx` and platform-label eyebrows in `apps/product-page/src/content/marketing/download.ts`.
- Marketing content declares repeated eyebrow strings in `apps/web/src/content/marketing/features.ts`.
- `apps/web/src/components/students/add-student-sheet.tsx` uses a thick flare `border-l-4` side-tab accent.
- Settings and fees UI contain nested glass surfaces that create card-inside-card depth.
- `apps/web/src/app/(auth)/signup/provision/page.tsx` contains decorative pulse/scale motion that needs a state-based justification.
- Current design context is undocumented, allowing future agents to reintroduce inconsistent visual choices.

## Implementation Sequence

### 1. Establish Agent Governance

1. Update `AGENTS.md` in the implementation session with a **Five-Agent Swarm Protocol** section matching this plan's operating model.
2. Require this execution order for substantial UI, backend, or deployment work:
   - Architecture authority ratifies scope and file ownership.
   - Reviewer/test client, full-stack developer, and deployment agent perform independent discovery in parallel.
   - Production coder implements only ratified work.
   - Reviewer independently verifies the resulting diff.
   - Deployment agent validates exact CI and production deployment.
   - Architecture authority closes the release.
3. Record that agent reports flow through the lead/session memory rather than assuming peer-to-peer messaging.
4. Add the anti-slop rule as a durable design constraint: UI must not use generic gradients, decorative glass/glows, side-tab borders, nested card stacks, giant icon tiles, identical card grids, redundant UX copy, or decorative motion unless a documented `DESIGN.md` exception explains why.
5. Add the fresh-session rule: after a plan is finalized in `.kilo/plans/`, start its implementation through the Kilo session-handoff command rather than continuing in the planning session.

### 2. Capture Product And Design Context

1. Create `apps/web/PRODUCT.md` through the Impeccable init flow.
2. Create `apps/web/DESIGN.md` through the document flow, derived from `13_UI_Guidelines.md` and current tokens.
3. Record these design constraints in `DESIGN.md`:
   - Dark-default cosmic canvas is a backdrop, not a primary accent.
   - Semantic accents: emerald primary/success, cyan information, amber warning, flare destructive, violet limited emphasis.
   - Surface hierarchy: plain/inset content rows, glass overlays, no nested glass cards.
   - Type scale, approved fonts, radius scale, elevation rules, contrast targets, and motion rules.
4. Add a surface brief for the app shell (Operate) and product page (Persuade) before any visual replacement.

### 3. Establish A Realistic Surface System

1. Update `apps/web/src/app/globals.css` tokens and utility patterns:
   - Retire the global `.eyebrow` utility as a default layout primitive.
   - Define a small semantic surface scale: canvas, raised panel, inset field, overlay.
   - Define one elevation approach per surface: border or shadow, never hairline border plus diffuse shadow together.
   - Cap small-card radii at 12-16px; reserve pills for compact controls.
   - Ensure body text uses readable line height and text measures remain around 65-75ch where prose appears.
2. Replace decorative glow with semantic focus/active/critical-state treatments.
3. Keep glass only where it clarifies z-order, background continuity, or interruption hierarchy.

### 4. Rework Product Page (Persuade)

Files include `apps/product-page/src/app/page.tsx`, `apps/product-page/src/content/marketing/download.ts`, and `apps/product-page/src/components/marketing/download-hub.tsx`.

1. Fold generic eyebrow copy into meaningful headings, breadcrumbs, or direct labels.
   - Remove repeated tracked-uppercase labels such as "Built for the way you actually tutor", "Pricing", and platform-prefixed labels where they add no information.
2. Replace platform eyebrow strings (`WEB APP`, `MACOS`, `WINDOWS`, `ANDROID`) with compact platform metadata placed beside the relevant product/action, not above a heading.
3. Remove hero-metric, repeated icon-tile, and identical-card-grid structures where present. Use real product screenshots, product-specific flows, or asymmetric content composition instead.
4. Rewrite marketing copy to concrete tutor outcomes. Remove generic SaaS buzzwords, repeated contrast aphorisms, and AI-cadence em-dash patterns.
5. Ensure typography distinguishes display hierarchy from body/interface text without using oversized long headlines, gradient text, or generic Inter-only treatment.
6. Verify long-form text, pricing content, and download cards at phone, tablet, laptop, full-HD, and ultrawide widths.

### 5. Rework Application UI (Operate)

Prioritize `apps/web/src/components/settings/**`, `apps/web/src/components/fees/**`, `apps/web/src/components/students/**`, `apps/web/src/components/attendance/**`, and `apps/web/src/components/buddysaradhi/**`.

1. Flatten nested glass containers:
   - Keep one outer panel for a page section, drawer, or sheet.
   - Render internal settings items, ledger rows, and form groups as flat rows/inset fields with spacing and dividers instead of another glass card.
2. Replace the thick flare left border in `add-student-sheet.tsx` with a clear destructive/error state using icon, title, action copy, and a restrained semantic foreground/background treatment.
3. Audit all sheets and dialogs:
   - Keep only interruptive, protected-focus, or short-form tasks in a modal/sheet.
   - Move complex multi-column/scroll-heavy configuration to the existing Settings screen sections instead of adding modal complexity.
4. Remove decorative loading/status motion. Motion must represent a real state transition, must start from visible content, use transform/opacity only where possible, and honor reduced-motion.
5. Normalize dense data UI:
   - Functional text must be readable at high density.
   - Status must not rely on color alone.
   - No duplicate label/helper/hint copy within a single container.
   - Tables and mobile stacks must preserve data hierarchy without card proliferation.

### 6. Build Anti-Slop Guardrails

1. Add an Impeccable detector command for `apps/web` and `apps/product-page` changed targets.
2. Run the detector manually after the first implementation pass:
   ```powershell
   node .agents/skills/impeccable/scripts/detect.mjs --json apps/web/src apps/product-page/src
   ```
3. Triage every finding:
   - Fix default/generated patterns.
   - Allowlist only choices explicitly required by `DESIGN.md` or `13_UI_Guidelines.md`, with a justification.
4. Add detector execution to the web production gate only after the first baseline is triaged, so existing unreviewed findings do not create an opaque CI failure.

### 7. Validate The Completed Redesign

1. Run existing project gates:
   - `pnpm run lint`
   - `pnpm run typecheck`
   - `pnpm run test:unit`
   - `pnpm run test:integration`
   - `pnpm run test:a11y`
2. Run Impeccable detector over changed UI files with zero untriaged slop findings.
3. Browser-review all five app screens and the product page at:
   - 390x844
   - 768x1024
   - 1440x900
   - 1920x1080
   - 2560x1440
4. Verify: no overflow, no clipped popovers, contrast remains compliant, keyboard navigation works, reduced motion is honored, and the sticky footer behavior remains correct.
5. Capture before/after screenshots and record detector/a11y findings in the worklog.

## Five-Agent Swarm Operating Model

The implementation session uses a lead-orchestrated, memory-as-bus swarm. Agents do not assume peer messaging; each writes its findings to the lead in its final report. Only the architecture agent can ratify a deviation from this plan, `13_UI_Guidelines.md`, or the five-screen constraint.

### 1. Production Coder

- Implements only architecture-ratified work in small, surface-scoped changes.
- Maintains strict TypeScript, accessible React, responsive behavior, and the existing offline-first/data-boundary rules.
- Optimizes for readable components, shallow surface hierarchy, stable render behavior, and no unnecessary dependencies.
- Does not add speculative features, routes, analytics, remote calls, or visual decoration not required by the brief.
- Runs lint, typecheck, targeted tests, and the Impeccable detector before handing work to review.

### 2. Reviewer And Test Client

- Reviews each diff for behavior regressions, accessibility, performance, security boundaries, and plan/spec compliance.
- Uses the current documentation for Next.js 16, React, Tailwind, TypeScript 7, Deno 2, ESLint flat config, and Impeccable before making framework-specific claims.
- Runs the application and browser checks at every required viewport; verifies keyboard, loading, error, empty, long-content, and reduced-motion states.
- Produces findings ordered by severity with exact file/line references and a concrete remediation plan. It does not silently edit implementation code.

### 3. Deployment And CI/CD Agent

- Recalls non-secret deployment commands and environment conventions from Kilo project memory; never stores or exposes tokens, keys, or credentials.
- Treats warnings as deployment blockers: Node/runtime compatibility, package-manager lockfile parity, lint warnings, Deno config warnings, build warnings, and workflow syntax must all be resolved or explicitly accepted by architecture.
- Validates the exact CI commands, then verifies GitHub Actions before production deployment.
- Deploys web and `@apps/gateway` only after reviewer and architecture sign-off. It validates health after deployment and reports the deployed revision and result.

### 4. Full-Stack Product Developer

- Reviews UI/UX and backend-to-UI data contracts together: loading, error, empty, mutation, authorization, and cache states must produce understandable surfaces.
- Owns credible tutor-specific marketing copy and operational information hierarchy.
- Enforces the Impeccable anti-slop doctrine: no generic gradients, decorative glass/glows, side-tab borders, nested card stacks, oversized icon tiles, generic card grids, redundant copy, or decorative motion.
- Proposes improvements as plan-aligned change sets; does not replace the committed Vibrant Glass world with an unrelated trend.

### 5. Architecture And System Design Authority

- Validates `PRODUCT.md`, `DESIGN.md`, surface briefs, component boundaries, route constraints, and the reconciliation of Vibrant Glass with anti-slop guidance before implementation starts.
- Audits every agent report for contradictions, hallucinated framework behavior, scope drift, and violations of `AGENTS.md` non-negotiables.
- Stops and re-plans any change that adds a new route, changes data/ledger semantics, introduces a network boundary, weakens accessibility, or conflicts with the design system.
- Gives the final structural sign-off only after review findings are resolved and the deployment agent reports a zero-warning CI/CD result.

## Agent Phases And Handoffs

1. **Architecture gate:** Architecture agent reads the plan, specs, current design tokens, and audit findings. It ratifies the design-context artifacts and assigns file ownership.
2. **Parallel discovery:** Reviewer/test client validates existing behavior and docs; full-stack developer audits UI/copy/data-state clarity; deployment agent validates local and remote CI/deploy prerequisites. These agents report only and do not edit overlapping implementation files.
3. **Implementation:** Production coder applies the ratified work in the order in this plan. The architecture agent resolves any conflict before the next surface starts.
4. **Independent verification:** Reviewer/test client reruns detector, a11y, responsive browser, and functional checks. Full-stack developer confirms the result does not regress the product language or create slop patterns.
5. **Release gate:** Deployment agent runs exact CI commands, confirms GitHub Actions are green with no compatibility warnings, deploys the approved revision, then performs post-deploy health checks. Architecture agent closes the release.

## Fresh-Session Rule

After this plan is finalized, implementation begins in a new Kilo session through the session-handoff command. That new session receives this plan path, the five-agent charter, the design audit findings, and the current validation state; the planning session does not edit production source files.

## Risks And Mitigations

- **Risk:** Removing all glass violates the committed product identity.
  - **Mitigation:** Keep glass as a material for overlays and intentional hierarchy; remove only decorative/nested use.
- **Risk:** Detector flags intentional cosmic/violet canvas usage.
  - **Mitigation:** Document the approved palette and material decisions in `DESIGN.md`; triage exceptions explicitly.
- **Risk:** Visual cleanup lowers information density for tutors.
  - **Mitigation:** Treat `apps/web` as Operate mode; flatten containers while retaining scanable rows, tables, and fast actions.
- **Risk:** Broad CSS changes regress screens outside the immediate audit.
  - **Mitigation:** Stage token changes first, visually validate all five screens after each component cluster, and keep commits surface-scoped.

## Out Of Scope

- New product features, routes, data models, or payment/ledger behavior.
- Mobile and desktop UI implementation; only shared token/spec implications are documented through an RFC if needed.
- Replacing the committed dark-default Vibrant Glass identity with an unrelated visual brand.
