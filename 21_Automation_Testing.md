# 21 — Automation Testing (Web · App · Desktop · Product)

> One sentence positioning: this file defines the **free, latest, automation-first** testing stack that lets the AI agent find bugs across all 4 surfaces (Website, Mobile App, Desktop, Product/Landing Page), **understand** them via structured reports + screenshots + VLM analysis, and **autonomously resolve** them via the `webDevReview` cron loop. It specialises `19_Concurrency_and_Testing.md` §5 (E2E golden path) and extends it with visual regression, a11y, performance, and the AI bug-resolution loop. The unit/property/concurrency/contract floors stay in `19_`; the automation + AI-resolution layer lives here. No paid SaaS, no expired trials — every tool below is OSS or has a permanent free tier with a license citation in §3.

---

## 0. What This File Adds (vs `19_Concurrency_and_Testing.md`)

`19_Concurrency_and_Testing.md` is the **spine**: it defines the test pyramid, the coverage floors, the concurrency harness, the contract tests, and **one** golden-path E2E per platform. This file is the **surface**: it expands that single E2E into a **36-flow automation suite** (12 web + 8 mobile + 6 desktop + 10 product), adds visual regression / a11y / performance automation, and — crucially — wires every failing assertion into the **AI bug-resolution loop** so the agent does not just *report* a bug, it *understands* and *fixes* it.

| Layer | Lives in | What it covers | Evidence it produces |
|---|---|---|---|
| **Spine** | `19_Concurrency_and_Testing.md` | Unit, property (fast-check), concurrency (autocannon/k6 + race tests), contract (provider + consumer), coverage floors, the "never mock the ledger" rule | Coverage %, race-test verdicts, contract-conformance matrices |
| **Surface (this file)** | `21_Automation_Testing.md` | E2E (36 flows), visual regression, a11y (axe-core + Pa11y), performance (Lighthouse CI + Flashlight + criterion), AI bug-finding + autonomous resolution | Per-flow pass/fail, screenshot diffs, a11y violation counts, Lighthouse scores, `fix(test):` commits, BLOCKED worklog entries |

The two files are **non-overlapping**. `19_` answers *"does the logic hold under concurrency and contract pressure?"* This file answers *"does the user-visible surface work, look right, stay accessible, stay fast, and can the agent fix it on its own?"* A regression caught by `19_` (e.g., a race) is a logic fix; a regression caught here (e.g., a sticky-footer break) is a UI/flow fix. Both feed the same `webDevReview` cron (§8).

---

## 1. The Four Surfaces & Their Automation Stacks

The "4 surfaces" = the three runtime platforms (Web, Mobile, Desktop) plus the **Product/Landing Page**, which is technically a subset of Web but has its own flows (marketing CTA, download hub OS detection, pricing FAQ accordion, SEO budgets) and its own visual-regression baseline (3 viewports × 10 sections). They share a build tool but **not** a test inventory.

| Surface | Stack | E2E Tool | Visual Reg Tool | A11y Tool | Perf Tool | AI Bug-Finder |
|---|---|---|---|---|---|---|
| **Website** | Next.js 16 (App Router, RSC, Turbopack) | Playwright 1.50 | Playwright `toHaveScreenshot()` + lost-pixel (OSS) | `@axe-core/playwright` 4.10 | Lighthouse CI 0.14 (`@lhci/cli`) | agent-browser + z-ai VLM |
| **Mobile App** | Expo SDK 52 · React Native 0.76 · Hermes | Maestro 1.40 (primary), Detox 20.x (fallback) | Maestro `--output` screenshots + pixelmatch | `@axe-core/react-native` 0.9 + manual VoiceOver/TalkBack checklist | Flashlight 0.10 + RN Perf Monitor | Maestro screenshot → z-ai VLM |
| **Desktop** | Tauri v2 · Rust + Vite static export | tauri-driver 2.x + WebDriverIO 9 | tauri-driver screenshots + pixelmatch | axe-core injected via tauri-driver | `cargo bench` (criterion 0.5) + Tauri devtools | tauri-driver screenshot → z-ai VLM |
| **Product Page** | Next.js 16 (same binary, marketing route group) | Playwright 1.50 (separate flow file) | Playwright `toHaveScreenshot()` × 3 viewports | axe-core + Pa11y 8.x CLI | Lighthouse CI (strict budgets) + `@next/bundle-analyzer` | agent-browser full-page screenshot → z-ai VLM |

All four columns of the AI Bug-Finder use the **same** z-ai vision (VLM) call shape — a structured JSON prompt that returns `{root_cause, affected_file, suggested_fix, confidence}`. The VLM is the only piece of "AI" in the loop; everything else is deterministic open-source tooling.

### 1.1 Website (Next.js 16)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  WEBSITE TOOLCHAIN (apps/web/, Next.js 16 App Router)             │
   ├──────────────────────────────────────────────────────────────────┤
   │                                                                  │
   │   Vitest 2 + RTL  ──▶ component/unit  (per 19_ §2.1)             │
   │          │                                                       │
   │          ▼                                                       │
   │   Playwright 1.50  ──▶ E2E (12 flows W-01..W-12)                 │
   │      ├── @axe-core/playwright 4.10 ──▶ a11y per flow             │
   │      ├── toHaveScreenshot() ──▶ visual regression (pixelmatch)   │
   │      └── trace + screenshot + HAR + console ──▶ VLM analyse      │
   │                                                                  │
   │   @lhci/cli 0.14  ──▶ Core Web Vitals + SEO on / and /dashboard  │
   │   @next/bundle-analyzer 16 ──▶ gzip diff per route               │
   │                                                                  │
   │   agent-browser ──▶ 16-section screenshot sweep (cron)           │
   │      └── z-ai VLM ──▶ design-ref evaluation ──▶ bug candidates   │
   └──────────────────────────────────────────────────────────────────┘
```

- **E2E — Playwright 1.50** (Apache-2.0). Chromium / Firefox / WebKit from one config. Auto-wait, trace viewer, `--update-snapshots`, `video: 'on-first-failure'`, `trace: 'retain-on-failure'`. The trace viewer is the single most valuable debugging surface — it replays the failing test as a filmstrip with DOM snapshot + network + console per millisecond. Free.
- **Component — Vitest 2 + `@testing-library/react` 16** (MIT). Same as `19_` §2.1. Component tests live in `apps/web/src/**/*.test.tsx`; they do not need Playwright because they don't need a browser.
- **Visual regression — Playwright `toHaveScreenshot()`** built-in (no extra dependency). The `@playwright/test` runner diffs against a PNG baseline in `tests/visual/__screenshots__/`. For team-scale baselines (cross-PR review, image gallery), `lost-pixel` 0.21 (OSS, MIT) is the drop-in self-hosted alternative to Percy/Applitools. Both are sufficient — §5 explains why the built-in is the default.
- **A11y — `@axe-core/playwright` 4.10** (MPL-2.0). `await expect(page).toPassAxe()` with WCAG 2.1 AA ruleset, runs in every E2E test. Zero critical violations gate merge.
- **Performance — Lighthouse CI 0.14 (`@lhci/cli`)** (Apache-2.0). Google-maintained, free, runs Lighthouse headless against the PR preview. Asserts Core Web Vitals against the budgets in §7.
- **AI bug-finder — agent-browser (already in this sandbox) + z-ai vision (VLM)**. The cron opens `http://localhost:3000/`, captures 16 section screenshots, and feeds each to the VLM with the design reference (§5). Mismatches become candidate bugs that the agent then verifies by running the matching Playwright flow.

### 1.2 Mobile App (Expo · React Native)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  MOBILE TOOLCHAIN (apps/mobile/, Expo SDK 52 · RN 0.76 · Hermes) │
   ├──────────────────────────────────────────────────────────────────┤
   │                                                                  │
   │   Jest 29.7 + RNTL 12 ──▶ component/unit (per 19_ §2.1 mobile)   │
   │          │                                                       │
   │          ▼                                                       │
   │   Maestro 1.40 (YAML flows)  ──▶ E2E (8 flows M-01..M-08)        │
   │      ├── maestro test --output ──▶ PNG per step                  │
   │      │       └── pixelmatch ──▶ visual regression                │
   │      └── maestro --format json ──▶ parseable report ──▶ VLM      │
   │                                                                  │
   │   @axe-core/react-native 0.9 ──▶ a11y (incomplete)               │
   │      + tests/mobile/a11y-checklist.md (manual VoiceOver/TalkBack)│
   │                                                                  │
   │   Flashlight 0.10 ──▶ cold-start + JS thread FPS                 │
   │   RN Perf Monitor (built-in) ──▶ bridge traffic                  │
   │                                                                  │
   │   [fallback] Detox 20.x ──▶ for native-module introspection      │
   │                                                                  │
   │   Maestro screenshot ──▶ z-ai VLM ──▶ bug candidates             │
   └──────────────────────────────────────────────────────────────────┘
```

- **E2E — Maestro 1.40** (Apache-2.0, mobile.dev). **YAML flows** (`flow.yaml`), not code. This is the deciding factor: YAML is AI-agent-friendly — the cron can write a Maestro flow, run it, parse the JSON report, and feed the screenshot to the VLM without writing a line of TS. Detox 20.x (MIT) is the **fallback** for cases where Maestro's command set is insufficient (e.g., deep native-module introspection); Detox is older, JS-configured, and slower to iterate on, but stable. **Recommend Maestro as primary, Detox as fallback.**
- **Component — Jest 29.7 + React Native Testing Library 12.x** (MIT). Same Vitest-equivalent role for RN components; RN Testing Library is the RN port of `@testing-library/react`. Per `19_` §2.1 mobile column.
- **Visual regression — Maestro `--output` screenshots + `pixelmatch` 6.x diff** (MIT). Maestro captures a PNG per `runFlow` step; a small Node script diffs against the baseline with `pixelmatch(threshold = 0.2)`. The Detox fallback uses `detox screenshots` (built-in).
- **A11y — `@axe-core/react-native` 0.9** (MPL-2.0, experimental) + a **manual VoiceOver (iOS) / TalkBack (Android) audit checklist** as a `tests/mobile/a11y-checklist.md`. The RN axe port is incomplete — the checklist catches what it misses (focus order, swipe gesture semantics, rotor navigation). The checklist is enforced by a `playwright`-style review gate: the agent must tick every checkbox in the PR description or CI fails.
- **Performance — Flashlight 0.10** (MIT, open-source RN-specific profiler) + React Native Performance Monitor (built-in). Flashlight measures cold-start, JS thread CPU, and bridge traffic — the three things that make a 2020 Redmi feel slow. Budget: cold start < 2.5s on a mid-tier Android (§7).
- **AI bug-finder — Maestro flow → screenshot → z-ai VLM**. Same loop as web, different driver.

### 1.3 Desktop (Tauri v2 · Rust)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  DESKTOP TOOLCHAIN (apps/desktop/, Tauri v2 + Vite static export) │
   ├──────────────────────────────────────────────────────────────────┤
   │                                                                  │
   │   cargo test (rustc 1.85) ──▶ Rust unit tests (src-tauri/)        │
   │   cargo bench (criterion 0.5) ──▶ ledger micro-benchmarks        │
   │          │                                                       │
   │          ▼                                                       │
   │   tauri-driver 2.x (WebDriver) ──▶ drives native webview         │
   │      + WebDriverIO 9 ──▶ client                                  │
   │          ├── saveScreenshot() ──▶ pixelmatch ──▶ visual reg      │
   │          ├── browser.execute(axeSource) ──▶ a11y                 │
   │          └── screenshot + console ──▶ VLM                        │
   │                                                                  │
   │   Tauri built-in devtools ──▶ webview inspector (perf + a11y)    │
   │                                                                  │
   │   tauri-driver screenshot ──▶ z-ai VLM ──▶ bug candidates        │
   └──────────────────────────────────────────────────────────────────┘
```

- **E2E — tauri-driver 2.x (Tauri's official WebDriver, MIT/Apache-2.0) + WebDriverIO 9 (MIT)**. `tauri-driver` exposes the Tauri webview as a WebDriver endpoint; WebDriverIO drives it with the same `browser.$(selector).click()` API you'd use for a browser. The same flow can be re-run against Chrome by swapping the WebDriver URL — useful for debugging.
- **Rust unit — `cargo test`** (built-in, MIT/Apache depending on crate). The ledger's Rust implementation (`desktop/02_Rust_Core.md`) is tested with `cargo test` + `cargo bench`; this is the only surface where the ledger engine's *binary* form is exercised (web/mobile use the TS port via the gateway).
- **Visual regression — tauri-driver screenshots + `pixelmatch`** (MIT). `browser.saveScreenshot('tests/visual/desktop/D-01.png')` per flow, diff against baseline.
- **A11y — axe-core injected into the webview via tauri-driver**. `browser.execute(axeSource)` then `browser.execute('axe.run()')`. Same axe-core, different injection vector.
- **Performance — `cargo bench` (criterion 0.5, MIT/Apache) for Rust core** + **Tauri's built-in devtools** (webview inspector) for the JS side. Budgets: installer < 15MB, cold-start < 1.5s (§7).
- **AI bug-finder — tauri-driver screenshot → z-ai VLM**.

### 1.4 Product / Landing Page (the marketing surface)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  PRODUCT TOOLCHAIN (apps/web/src/app/(marketing)/, Next.js 16)   │
   ├──────────────────────────────────────────────────────────────────┤
   │                                                                  │
   │   Playwright 1.50 (separate flow file: tests/product/*.spec.ts)  │
   │      ├── 10 flows P-01..P-10                                     │
   │      ├── 3 viewports × 10 baselines (375 / 768 / 1440)           │
   │      ├── @axe-core/playwright 4.10 ──▶ a11y per flow             │
   │      └── toHaveScreenshot() × 3 ──▶ visual regression per viewport│
   │                                                                  │
   │   Pa11y 8.x CLI ──▶ nightly full crawl (sitemap.xml)             │
   │   Lighthouse CI 0.14 ──▶ strict budgets (LCP<2.5s, CLS<0.1)      │
   │   Lighthouse SEO audit + next-sitemap 4.x ──▶ sitemap + OG tags  │
   │                                                                  │
   │   agent-browser full-page screenshot ──▶ z-ai VLM                │
   │      └── evaluate vs 20_3D_Product_Page.md (hero) + 13_UI (rest) │
   └──────────────────────────────────────────────────────────────────┘
```

- **E2E — Playwright** (same binary as web, **separate flow file**: `tests/product/*.spec.ts`). The product page is in `apps/web/src/app/(marketing)/page.tsx`; its flows do not share state with the `(app)` dashboard flows, so they get their own suite.
- **Visual regression — Playwright `toHaveScreenshot()` across 3 viewports** (mobile 375, tablet 768, desktop 1440). Each of the 10 flows has 3 baseline PNGs; a regression on any viewport fails the PR. Viewport matrix is the only meaningful difference from §1.1.
- **A11y — axe-core + Pa11y 8.x CLI** (MIT). Pa11y crawls the full marketing tree nightly (it's a CLI, perfect for cron); axe-core runs per-flow in the PR gate.
- **Performance — Lighthouse CI with **strict** budgets** (LCP < 2.5s, CLS < 0.1, TBT < 200ms, FCP < 1.8s). The product page is the conversion surface — its budgets are tighter than the dashboard's. A 10% regression fails the PR (§7).
- **SEO — Lighthouse SEO audit (built-in) + `next-sitemap` 4.x validation** (MIT). Sitemap XML, robots.txt, canonical, OG tags, structured data — all asserted by the SEO audit + a small `tests/product/sitemap.test.ts` that fetches `/sitemap.xml` and asserts every route is listed.
- **AI bug-finder — agent-browser full-page screenshot → z-ai VLM evaluation against the design reference** (`20_3D_Product_Page.md` for the hero, `13_UI_Guidelines.md` for the rest). The VLM is asked: "Does this section match the design reference? List deviations." Output is JSON; deviations become candidate bugs.

---

## 2. The AI Bug-Finding Loop (how the agent finds bugs autonomously)

This is the heart of the file. The five-step loop runs on every `webDevReview` cron tick (every 15 minutes, job_id 266790) and on every PR push. The agent does not just *run* the suite — it **understands** failures and **resolves** them.

```
                         ┌─────────────────────────────────────────┐
                         │  webDevReview tick (every 15 min)        │
                         │  OR PR push trigger                      │
                         └────────────────────┬────────────────────┘
                                              │
                                              ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │ 1. RUN  the automation suite                                       │
   │    Playwright (web+product) · Maestro (mobile) · tauri-driver (dt) │
   │    + axe-core + Lighthouse CI + visual-regression                 │
   └──────────────────────────────┬────────────────────────────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  │ all green?                    │
                  └───────┬───────────────┬───────┘
                       yes│            no │
                          │               ▼
                          │   ┌───────────────────────────────────────┐
                          │   │ 2. CAPTURE (per failing test)          │
                          │   │   (a) failing assertion text           │
                          │   │   (b) full-page screenshot (PNG)       │
                          │   │   (c) browser console log              │
                          │   │   (d) network waterfall (HAR)          │
                          │   │   (e) Playwright trace (zip)           │
                          │   └─────────────────┬─────────────────────┘
                          │                     ▼
                          │   ┌───────────────────────────────────────┐
                          │   │ 3. ANALYSE  (z-ai vision / VLM)        │
                          │   │   Input: screenshot + console + assert │
                          │   │   Prompt: "Identify the root cause.    │
                          │   │    Output JSON:                        │
                          │   │     { root_cause,                      │
                          │   │       affected_file,                   │
                          │   │       suggested_fix,                   │
                          │   │       confidence: 0..1 }"              │
                          │   └─────────────────┬─────────────────────┘
                          │                     ▼
                          │   ┌───────────────────────────────────────┐
                          │   │ 4. RESOLVE                             │
                          │   │   - read VLM JSON                      │
                          │   │   - open affected_file                 │
                          │   │   - apply suggested_fix                │
                          │   │   - re-run the failing test            │
                          │   │   - pass? → commit `fix(test): <id>`   │
                          │   │   - fail 3×? → BLOCKED → worklog       │
                          │   └─────────────────┬─────────────────────┘
                          │                     ▼
                          │   ┌───────────────────────────────────────┐
                          └──▶│ 5. VERIFY  re-run the FULL suite       │
                              │   (not just the fixed test)            │
                              │   - any new failure? → back to step 2  │
                              │   - all green? → update worklog, done  │
                              └─────────────────┬─────────────────────┘
                                                │
                                                ▼
                              ┌───────────────────────────────────────┐
                              │  next tick in 15 min                   │
                              └───────────────────────────────────────┘
```

The **five artefacts captured at step 2** are non-negotiable. A failing assertion without a screenshot is a bug the agent cannot see; a screenshot without the console log is a bug the agent cannot reason about (the console almost always contains the React error or the network failure that explains the visual break). The Playwright trace (`.zip`) is the *"show your work"* artefact — it's attached to the `fix(test):` commit so a future agent (or human) can replay the failure even after the fix lands.

The **3-tries cap at step 4** is the autonomy guardrail. If the agent applies three different fixes and the test still fails, the bug is beyond the agent's current reach (a missing spec, a contract break, an architectural issue). The agent logs a `BLOCKED` entry in `worklog.md` with the three attempted fixes, the VLM's analysis, and the trace zip — and moves on. This is the same "stop-and-ask" machinery as `AGENTS.md` §8; the difference is here it's automatic, not user-triggered.

The **verify step (5)** re-runs the full suite, not just the fixed test. This catches the regression case: a fix to `W-07` that breaks `W-03`. Without step 5, the agent would commit a fix that passes `W-07` and silently regress `W-03`; step 5 catches it and routes back to step 2 with the new failure. The loop only exits when **all 36 flows + a11y + perf + visual** are green.

---

## 3. Tooling Matrix (all FREE, all LATEST — with versions + license + why)

Every tool below is **open-source** (MIT / Apache-2.0 / MPL-2.0 / BSD) or has a **permanent free tier with no trial expiry**. No BrowserStack, no SauceLabs, no Percy, no Applitools — the free alternatives in this table cover the same surface and (for our use case) do it better, because they're scriptable and VLM-friendly where the paid SaaS are GUI-first.

| Tool | Version (mid-2025) | License | Surface | Purpose | Why this over paid alternatives |
|---|---|---|---|---|---|
| **Playwright** | 1.50.x | Apache-2.0 | Web, Product | E2E, visual regression, trace capture | Free vs BrowserStack ($39/mo+); trace viewer is best-in-class, beats SauceLabs's video; `toHaveScreenshot()` beats Percy for a single-repo project (Percy's value is cross-PR review at scale, which we don't need) |
| **Vitest** | 2.1.x | MIT | Web, Desktop | Component + unit runner | Free vs Jest+JSDOM (also free, but slower); native ESM, Turbopack-compatible, same `expect` API as Jest |
| **@testing-library/react** | 16.1.x | MIT | Web, Desktop | Component DOM queries | Free; the de-facto standard; no paid competitor |
| **@axe-core/playwright** | 4.10.x | MPL-2.0 | Web, Product, Desktop | A11y assertions in E2E | Free vs Deque's axe DevTools (paid dashboard); the engine is the same; we don't need the dashboard |
| **Lighthouse CI** (`@lhci/cli`) | 0.14.x | Apache-2.0 | Web, Product | Core Web Vitals + SEO + a11y budgets | Free vs Calibre / SpeedCurve ($100+/mo); Google-maintained; same Lighthouse engine; the CI wrapper gives us diff-on-PR which is the only thing Calibre adds |
| **Maestro** | 1.40.x | Apache-2.0 | Mobile | E2E flows (YAML) | Free vs BrowserStack App Live ($49/mo+); YAML flows are AI-agent-writable (no TS to maintain); faster cold-start than Detox |
| **Detox** | 20.x | MIT | Mobile | E2E fallback (JS-config) | Free; used as fallback for native-module introspection that Maestro's command set doesn't cover |
| **Jest** | 29.7 | MIT | Mobile | Component runner | Free; the RN ecosystem default (Vitest doesn't fully support RN) |
| **React Native Testing Library** | 12.x | MIT | Mobile | Component queries | Free; RNTL mirrors RTL API |
| **@axe-core/react-native** | 0.9.x | MPL-2.0 | Mobile | A11y assertions (experimental) | Free; the only OSS a11y tool for RN; incomplete, so paired with a manual checklist |
| **Flashlight** | 0.10.x | MIT | Mobile | RN performance profiler | Free vs Datadog RN ($15/host/mo); open-source, RN-specific, measures cold-start + JS thread + bridge traffic |
| **tauri-driver** | 2.x | Apache-2.0 / MIT | Desktop | WebDriver for Tauri webview | Free; official Tauri project; no paid competitor exists for Tauri |
| **WebDriverIO** | 9.x | MIT | Desktop | WebDriver client | Free vs SauceLabs / BrowserStack (paid runners); we only need the client, the runner is `tauri-driver` locally |
| **cargo test** | rustc 1.85+ | MIT/Apache (rust) | Desktop | Rust unit tests | Free; built into the Rust toolchain |
| **criterion** | 0.5.x | MIT/Apache | Desktop | Rust benchmarks (`cargo bench`) | Free; the de-facto Rust micro-benchmark crate; statistical comparison across runs |
| **Pa11y** | 8.x | MIT | Product | A11y CLI crawler | Free vs axe DevTools dashboard; runs as a CLI in cron; perfect for nightly full-crawl of the marketing tree |
| **agent-browser** | (in-sandbox) | (sandbox) | Web, Product | VLM-friendly browser automation | Free (already in this sandbox); the cron uses it to capture screenshots for VLM evaluation |
| **z-ai vision (VLM)** | (in-sandbox) | (sandbox) | All 4 | Screenshot analysis, root-cause extraction | Free (already in this sandbox); the only "AI" piece; no OpenAI Vision API cost |
| **fast-check** | 3.x | MIT | All 4 (spine) | Property-based testing | Free; already used by `19_` §3.3 for ledger races; reused here for flow invariants |
| **autocannon** | 7.x | MIT | Web (backend) | HTTP load testing | Free vs k6 Cloud ($99/mo); we use the OSS k6 CLI as alternative |
| **k6 (OSS CLI)** | 0.55.x | AGPL-3.0 | Web (backend) | Load + soak testing | Free vs k6 Cloud; AGPL-3.0 is fine for a tool we run, not link against; the OSS CLI has no trial, no quota |
| **pixelmatch** | 6.x | ISC | All 4 | PNG diff for visual regression | Free; tiny (200 lines), fast, the engine behind Playwright's `toHaveScreenshot` and `lost-pixel` |
| **lost-pixel** | 0.21.x | MIT | Web, Product (optional) | Visual regression gallery (self-hosted) | Free vs Percy ($99/mo+); self-hosted, OSS, integrates with Playwright; only added if the team needs cross-PR image review |
| **@next/bundle-analyzer** | 16.x (Next) | MIT | Web, Product | Bundle size diff on PR | Free; built into Next; no Bundlephobia paid tier needed |
| **next-sitemap** | 4.x | MIT | Product | Sitemap + robots.txt validation | Free; the only OSS sitemap generator with a test hook |

**Total annual tooling cost: $0.** Every tool is OSS or sandbox-provided. The only "infrastructure" cost is GitHub-hosted runners (free for public repos) for CI; for private repos, the 2,000 free minutes/month covers the suite at current cadence (§10).

### 3.1 Free-Tier Limits Audit (proving the $0 claim)

Three of the tools above have **free tiers with quotas** (not pure OSS). This subsection documents the quotas, the current usage, and the headroom — so the "free" claim is auditable, not aspirational.

| Tool | Free tier limit | Our projected usage | Headroom | If exceeded |
|---|---|---|---|---|
| **GitHub Actions** (public repo) | Unlimited minutes | ~4,500 min/month (web nightly + mobile nightly + 5 PRs/day) | ∞ | N/A — public repos are free |
| **GitHub Actions** (private repo) | 2,000 min/month | ~4,500 min/month projected at full 5-PR/day cadence | **DEFICIT at full cadence** | Self-host the macOS runner (mobile job, ~1,500 min/mo) on a Mac Mini; or move the repo to public; or throttle to 2 PRs/day (~1,800 min/mo, within free tier) |
| **k6 OSS CLI** | Unlimited (local runs) | ~5 runs/week (concurrency profiles from `19_` §3.2) | ∞ | N/A — local CLI has no quota |
| **Lighthouse CI** (with `--upload.target=filesystem`) | Unlimited | ~30 runs/day | ∞ | N/A — local FS storage |
| **Lighthouse CI** (with temporary Lighthouse CI Server) | Free, self-hosted | Not used (we use `filesystem`) | N/A | Skip — the server is for cross-PR trend, not needed at our scale |
| **z-ai vision (VLM)** (in-sandbox) | Sandbox quota | ~16 screenshots/tick × 96 ticks/day = ~1,500 VLM calls/day | Sandbox-managed | If sandbox quota hit, throttle cron to 30-min ticks (still < 1,000 calls/day) |

**The only real risk is GitHub Actions on a private repo.** The mitigation is structural: **the Buddysaradhi repo is public** (it's an open-source tutor OS, per `00_Vision.md`), so GitHub Actions minutes are unlimited. If the repo ever goes private (e.g., a forked enterprise variant), the mitigation is self-hosting the macOS runner for the mobile nightly job — a one-time Mac Mini purchase (~$700) eliminates the recurring cost forever.

**No tool above has an "expired trial."** Every free tier is permanent (GitHub Actions, Lighthouse CI filesystem) or replaced by pure OSS (k6 OSS CLI has no quota; the cloud tier is opt-in). The VLM is sandbox-provided, not a free-tier API — no expiry.

### 3.2 Why Not [Paid Tool]? (the explicit rejections)

| Paid tool | Rejected because | Free replacement (this file) |
|---|---|---|
| BrowserStack / SauceLabs | $39–$149/month; locks test runs behind a dashboard the VLM can't read; adds network latency | Playwright (web) + Maestro (mobile) + tauri-driver (desktop), all local |
| Percy / Applitools | $99+/month for visual regression; the value is cross-PR review at scale (we have one PR at a time) | Playwright `toHaveScreenshot()` + pixelmatch; lost-pixel if a human team joins |
| Datadog / New Relic | $15–$35/host/month; we have 1 host (the sandbox) | Lighthouse CI (web) + Flashlight (mobile) + criterion (desktop Rust) |
| Calibre / SpeedCurve | $100+/month for performance monitoring | Lighthouse CI with `--upload.target=filesystem` |
| axe DevTools (Deque) | $49/seat/month for the dashboard; the engine is free | `@axe-core/playwright` + Pa11y CLI (same engine, no dashboard) |
| k6 Cloud | $99/month for cloud execution + results storage | k6 OSS CLI runs locally; results saved as JSON to `.k6/` |
| TestRail / Zephyr | $37–$75/seat/month for test case management | The flow IDs (W-01..P-10) in §4 + the `fix(test):` commit trail is the test case manager |

The pattern: **paid SaaS tools sell dashboards and scale.** We have one agent and one repo. The dashboard is the worklog; the scale is one PR at a time. Every paid tool's value-add is downstream of a use case we don't have.

---

## 4. Test Inventory (what gets automated, per surface)

The inventory is **36 flows**: 12 web + 8 mobile + 6 desktop + 10 product. Each flow has a stable ID (`W-01`, `M-03`, `D-02`, `P-07`), a list of steps, an assertion, and a screenshot baseline. The ID is what the agent references in `fix(test):` commit messages and `BLOCKED` worklog entries. The IDs are **stable forever** — renumbering breaks the audit trail.

### 4.1 Website — 12 flows

| ID | Flow | Steps | Assertion | Screenshot baseline |
|---|---|---|---|---|
| W-01 | Signup OTP → dashboard land | `/signup` → enter email → submit → `/verify` → enter OTP → submit | URL is `/dashboard`; sidebar visible; no console errors | `tests/visual/web/W-01-signup-land.png` |
| W-02 | Create student → appears in roster | `/students` → "Add student" → fill form → save | New row visible in roster with correct initials avatar | `W-02-create-student.png` |
| W-03 | Mark attendance → save + lock | `/attendance` → select batch → mark 3 present → "Save & lock" → enter PIN | Lock icon appears; toast "Attendance saved" | `W-03-attendance-lock.png` |
| W-04 | Record fee → ledger entry | `/fees` → select student → "Record Payment" → ₹500 → submit | Ledger shows new entry; balance decreases by ₹500 (integer paise) | `W-04-record-fee.png` |
| W-05 | Void receipt → reversal entry | `/fees` → open entry → "Void" → confirm | New reversal entry with `void_of: <original>`; balance restored | `W-05-void.png` |
| W-06 | Settings → toggle theme | `/settings` → Appearance → toggle Theme | CSS `--bg-cosmic` switches value; no flash of unstyled content | `W-06-theme-toggle.png` |
| W-07 | Backup → export `.tutoros` file | `/settings` → Backup → "Create backup" → wait | `.tutoros` download triggered; toast "Backup created (encrypted)" | `W-07-backup-export.png` |
| W-08 | Restore → `.tutoros` import | `/settings` → Restore → upload `.tutoros` → enter PIN | "Restore complete" toast; ledger matches pre-backup | `W-08-backup-restore.png` |
| W-09 | Secure-erase → confirm PIN | `/settings` → Diagnostics → "Erase all data" → enter PIN | All tables empty; redirect to `/login` | `W-09-secure-erase.png` |
| W-10 | Search → student filter | `/students` → type "ar" in search | Roster shows only students with "ar" in name (case-insensitive) | `W-10-search-filter.png` |
| W-11 | 404 → custom not-found | Visit `/nonexistent` | Custom 404 page with "Back to dashboard" link; status 404 | `W-11-404.png` |
| W-12 | Sticky footer on short + long page | Visit `/` (long) and `/login` (short) | Footer at viewport bottom on long page; footer below fold (no gap) on short page | `W-12-sticky-footer-{short,long}.png` |

### 4.2 Mobile App — 8 flows

| ID | Flow | Steps | Assertion | Screenshot baseline |
|---|---|---|---|---|
| M-01 | Login (biometric) | Open app → tap "Use biometric" → FaceID/TouchID prompt → authenticate | Lands on Dashboard tab; haptic confirmation | `M-01-login.png` |
| M-02 | Dashboard → tap KPI → drill | Dashboard → tap "Due Today" KPI | Navigates to `/fees?filter=due-today` | `M-02-dashboard-drill.png` |
| M-03 | Create student | Students tab → "Add" → fill → save | New row in FlashList; toast "Student created" | `M-03-create-student.png` |
| M-04 | Mark attendance (haptic) | Attendance tab → select batch → tap 3 present → "Save" | Haptic on each tap; toast "Attendance saved"; lock icon | `M-04-attendance-haptic.png` |
| M-05 | Record fee | Fees tab → select student → "Record" → ₹500 → submit | Ledger entry visible; balance updates | `M-05-record-fee.png` |
| M-06 | Offline 30s → sync | Turn on airplane mode → mark attendance → wait 30s → turn off | Outbox drains; sync indicator turns green within 5s; ledger matches | `M-06-offline-sync.png` |
| M-07 | Ledger view | Fees tab → select student → "View ledger" | Full ledger list scrolls; void entry shows strikethrough | `M-07-ledger-view.png` |
| M-08 | Backup export | Settings → Backup → "Export" → confirm | `.tutoros` saved to file system; share sheet appears | `M-08-backup-export.png` |

### 4.3 Desktop — 6 flows

| ID | Flow | Steps | Assertion | Screenshot baseline |
|---|---|---|---|---|
| D-01 | Login (PIN) | Open app → enter 6-digit PIN | Lands on Dashboard; window title "Buddysaradhi — Dashboard" | `D-01-login.png` |
| D-02 | Dashboard → command palette | `Cmd+K` (macOS) / `Ctrl+K` (Win/Linux) → type "students" → Enter | Navigates to `/students` | `D-02-command-palette.png` |
| D-03 | Create student | Students → "Add student" → fill → save | New row visible; toast notification | `D-03-create-student.png` |
| D-04 | Record fee | Fees → select student → "Record Payment" → ₹500 → submit | Ledger entry; balance updates; toast | `D-04-record-fee.png` |
| D-05 | Secure-erase | Settings → Diagnostics → "Erase all data" → enter PIN | All tables empty; app closes; relaunch shows login | `D-05-secure-erase.png` |
| D-06 | Updater check | Help → "Check for updates" (with a v1.0.1 patch on the update server) | Update notification; "Install & restart" → app restarts on v1.0.1 | `D-06-updater.png` |

### 4.4 Product Page — 10 flows

| ID | Flow | Steps | Assertion | Screenshot baseline |
|---|---|---|---|---|
| P-01 | Hero CTA → signup | `/` → click hero "Start free" | Lands on `/signup`; no console errors; LCP < 2.5s | `P-01-hero-cta-{375,768,1440}.png` |
| P-02 | Features scroll | `/` → scroll to features section | All 6 feature cards visible; no layout shift on scroll | `P-02-features-{375,768,1440}.png` |
| P-03 | Download hub — Windows detection | `/download` from a Windows UA | "Download for Windows" button highlighted; .msi link | `P-03-download-windows.png` |
| P-04 | Download hub — macOS detection | `/download` from a macOS UA | "Download for macOS" button highlighted; .dmg link | `P-04-download-macos.png` |
| P-05 | Download hub — Linux detection | `/download` from a Linux UA | "Download for Linux" button highlighted; .AppImage link | `P-05-download-linux.png` |
| P-06 | Pricing FAQ accordion | `/` → scroll to FAQ → click each accordion | Each item expands; only one open at a time (or all-open, per design) | `P-06-faq-accordion.png` |
| P-07 | Pricing FAQ — first item expand | `/` → scroll to FAQ → click first item | **First item expands** (this is the bug-prone edge — onClick often missing on the first button) | `P-07-faq-first-item.png` |
| P-08 | Testimonials carousel | `/` → scroll to testimonials → click next/prev | Carousel advances; no layout shift; auto-advance every 5s | `P-08-testimonials.png` |
| P-09 | SEO meta tags | Fetch `/` HTML | `<title>`, `<meta name="description">`, `<meta property="og:*">`, `<link rel="canonical">` all present and non-empty | (no screenshot; HTML assertion) |
| P-10 | Sticky footer on long page | Visit `/` and scroll to bottom | Footer visible at bottom; no gap below footer (per `13_UI_Guidelines.md` sticky-footer rule) | `P-10-sticky-footer-{375,768,1440}.png` |

**Why 36 flows, not 360?** Per `19_` §7 ("E2E for every screen" is an anti-pattern): E2E is expensive and brittle. 36 flows cover the **golden path + the bug-prone edges** (sticky footer, FAQ first-item, OS detection, offline sync, secure-erase). Component + integration tests (in `19_`) cover the rest. If a flow flakes more than 3× in a week, it's a P1 — fix the UI, not the test (`19_` §7).

### 4.5 Sample Test Code (the canonical patterns)

The implementing agent should mirror these exact patterns. **P-07** is included because it's the bug used in the §13 console mockup — having the canonical spec prevents the agent from re-discovering the bug shape.

**P-07 — Playwright (web/product), FAQ accordion first-item expand:**

```ts
// tests/product/p-07-faq-first-item.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('P-07 — Pricing FAQ accordion, first item expand', () => {
  test('first item expands on click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: /frequently asked/i }).scrollIntoViewIfNeeded();

    const firstItem = page.locator('[data-testid="faq-item"]').first();
    const firstButton = firstItem.locator('button').first();
    const firstPanel = firstItem.locator('[data-testid="faq-panel"]').first();

    // before click: panel collapsed, button aria-expanded=false
    await expect(firstButton).toHaveAttribute('aria-expanded', 'false');
    await expect(firstPanel).not.toBeVisible();

    // the click that the §13 mockup caught missing
    await firstButton.click();

    // after click: panel visible, button aria-expanded=true
    await expect(firstButton).toHaveAttribute('aria-expanded', 'true');
    await expect(firstPanel).toBeVisible();
    await expect(firstPanel).toContainText(/.+/); // non-empty answer

    // visual regression — 3 viewports
    await expect(page).toHaveScreenshot('P-07-faq-first-item.png', {
      fullPage: false,
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // a11y — no new violations introduced by the expand
    const a11y = await new AxeBuilder({ page })
      .include('[data-testid="faq-section"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(a11y.violations.filter(v => v.impact === 'critical')).toHaveLength(0);
  });

  test('keyboard: Enter expands first item', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: /frequently asked/i }).scrollIntoViewIfNeeded();
    await page.keyboard.press('Tab'); // past the heading
    // Tab until focus is on the first FAQ button
    for (let i = 0; i < 10; i++) {
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (focused === 'faq-button') break;
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    const firstPanel = page.locator('[data-testid="faq-panel"]').first();
    await expect(firstPanel).toBeVisible();
  });
});
```

**M-04 — Maestro (mobile), attendance haptic:**

```yaml
# tests/mobile/flows/M-04-attendance-haptic.yaml
appId: com.buddysaradhi.app
---
- launchApp:
    clearState: true
- runFlow: ./M-01-login.yaml           # reuse the login flow
- tapOn:
    id: "tab-attendance"
- tapOn:
    id: "batch-selector"
- tapOn:
    text: "Batch A"
# mark 3 students present
- repeat:
    times: 3
    commands:
      - tapOn:
          id: "student-row-.*"
          index: 0
- assertVisible:
    text: "3 present"
# the haptic is asserted via the device log (Maestro can't feel haptics directly)
- assertVisible:
    id: "save-button"
- tapOn:
    id: "save-button"
# PIN entry (haptic confirmation pattern)
- inputText:
    id: "pin-input"
    text: "123456"
- tapOn:
    text: "Confirm"
# success toast
- assertVisible:
    text: "Attendance saved"
- assertVisible:
    id: "lock-icon"
# capture for visual regression (§5 baseline M-04-attendance-haptic.png)
- captureScreenshot: M-04-attendance-haptic
```

**W-04 — Playwright (web), record fee → ledger entry (the money path):**

```ts
// tests/web/w-04-record-fee.spec.ts
test('W-04 — Record ₹500 fee → ledger entry + balance decrement', async ({ page }) => {
  // setup: real in-memory SQLite, real migrations, real ledger (never mocked — 19_ §2.2)
  const tutor = await seedTestTutor({ students: [{ name: 'Ananya Rao', balancePaise: 50000 }] });
  await page.goto(`/dashboard?tutor=${tutor.id}`);

  await page.getByRole('link', { name: /fees/i }).click();
  await page.getByText('Ananya Rao').click();
  await page.getByRole('button', { name: /record payment/i }).click();

  await page.getByLabel(/amount/i).fill('500');
  await page.getByRole('button', { name: /submit/i }).click();

  // ledger entry visible
  const entry = page.locator('[data-testid="ledger-entry"]').first();
  await expect(entry).toContainText('500');
  await expect(entry).toContainText(tutor.students[0].id);

  // balance decremented by exactly ₹500 (integer paise — 12_Business_Rules §3)
  const balance = await page.locator('[data-testid="student-balance"]').textContent();
  expect(Number(balance!.replace(/[^0-9]/g, ''))).toBe(50000 - 50000); // was ₹500 owed, now ₹0

  // console clean (no React warnings, no fetch failures)
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.waitForTimeout(500); // drain
  expect(errors, errors.join('\n')).toEqual([]);
});
```

The three patterns above are the canonical shapes: **assertion + a11y + visual + keyboard** (P-07), **YAML flow + reuse + capture** (M-04), and **real-ledger + integer-paise + console-clean** (W-04). Every flow in §4 should be implementable by following these templates.

---

## 5. Visual Regression Baselines

Visual regression is the **highest-signal** test type for an AI agent. A failing assertion tells you *what* broke; a screenshot diff tells you *what it looks like*. The VLM turns the diff into a root-cause hypothesis (§2 step 3).

**Baseline location.** All baselines live in `tests/visual/__screenshots__/{web,mobile,desktop,product}/`. The directory is committed to the repo (not git-LFS — the PNGs are small, ~50KB each at viewport size; the full suite is ~2MB). The first run of a new flow establishes the baseline; subsequent runs diff against it.

**Diff engine.** `pixelmatch` 6.x (ISC, free) — the same engine Playwright uses internally. Threshold `0.2` (= 20% pixel diff per pixel triggers a mismatch). A flow fails if **>0.1% of total pixels** mismatch. This catches real visual regressions while tolerating anti-aliasing jitter across Chromium versions.

**Updating baselines on intentional UI change.** When the agent (or a human) intentionally changes the UI:

```
   bunx playwright test --update-snapshots
```

This regenerates the baseline PNGs. The agent then **commits the new baseline** with a `chore(visual): <flow-id> <reason>` message — e.g. `chore(visual): W-02 updated avatar style per 13_UI §4`. The commit message is the audit trail: every baseline change is a deliberate act, not a CI drift.

**VLM cross-check before acceptance.** A new baseline is not accepted just because the diff ran. The agent feeds the **new** baseline PNG to the z-ai VLM alongside the **design reference** (the professional glassmorphic dark dashboard defined in `13_UI_Guidelines.md` + the prototypes polished in Task 15-UI-OVERHAUL) and asks:

> "Does this screenshot match the design reference? List deviations as JSON: `[{element, deviation, severity: 0..1}]`. If no deviations, return `[]`."

If the VLM returns any deviation with `severity > 0.5`, the baseline is **rejected** — the agent logs a `BLOCKED` entry, reverts the UI change, and the prior baseline is restored. This is the structural answer to "what stops the agent from committing an ugly new baseline?" — the VLM is the design-system oracle.

**Why built-in `toHaveScreenshot()` over lost-pixel/Percy?** For a single-repo project with one developer (the agent), the built-in is sufficient: it diffs, it updates, it's free. `lost-pixel` adds a self-hosted web gallery for cross-PR review (useful for a human team); Percy adds cloud storage + Slack notifications (useful for a large team). We have neither. The built-in keeps the dependency surface at zero. **lost-pixel is named as the upgrade path** if a human team joins — the test files don't change, only the runner config.

---

## 6. Accessibility Automation (WCAG 2.1 AA, free)

A11y is not a separate phase — it's an assertion in every E2E test, plus a nightly crawl, plus a keyboard-only pass, plus a screen-reader text audit. Four layers:

| Layer | Tool | When | Gate |
|---|---|---|---|
| **Per-flow axe scan** | `@axe-core/playwright` 4.10 | Every E2E test, after page load | 0 `critical` violations → merge; `serious` → warn; `moderate/minor` → log only |
| **Nightly full crawl** | Pa11y 8.x CLI | Cron, 02:00 IST nightly, on the product page tree | 0 `critical` + 0 `serious` → green; else → Slack/email alert (free via GitHub Actions) |
| **Keyboard-only nav** | Playwright `keyboard.press` sequence | One test per screen, simulates Tab/Shift+Tab/Enter/Space/Esc through the page | Every interactive element receives focus in DOM order; no focus trap; Esc closes modals |
| **Screen-reader text audit** | Playwright DOM assertion | Every test that touches an icon-only button or image | Every `aria-label`, `.sr-only`, `alt` is asserted non-empty + meaningful (regex blocks "icon", "img", "button" as labels) |

**WCAG 2.1 AA scope.** We assert the AA ruleset, not AAA. AA is the legal floor (ADA / EU EAA / India RPwD Act compliance) and the practical ceiling (AAA's contrast 7:1 is impractical on the cosmic dark theme without breaking the design — `13_UI_Guidelines.md` §1.3 explicitly allows 4.5:1 for body text on glass surfaces).

**The keyboard-only test is the most-forgotten and most-valuable.** Mouse users can recover from almost any UI; keyboard users cannot. The test simulates a pure-keyboard user Tabbing through every screen and asserts (a) focus is visible at all times (the `:focus-visible` outline is present), (b) no focus trap (you can Tab out of every container), (c) modal dialogs trap focus correctly while open and restore it on close, (d) Esc closes every overlay. This catches the "I removed the focus ring because it was ugly" bug that ship-blocks a11y compliance.

**Screen-reader text audit.** `aria-label=""` and `alt=""` are common — the former is a copy-paste error, the latter is "decorative image" semantics. The audit asserts:

```ts
const iconButtons = await page.$$('button:has(svg):not(:has-text))');
for (const btn of iconButtons) {
  const label = await btn.getAttribute('aria-label');
  expect(label, 'icon-only button must have aria-label').toBeTruthy();
  expect(label, 'aria-label must be meaningful').not.toMatch(/^(icon|img|button|image)$/i);
}
```

This is the cheapest, highest-leverage a11y test in the suite — it catches the "screen reader announces 'icon' for every icon button" failure mode that axe-core misses (axe checks *presence* of `aria-label`, not *meaning*).

---

## 7. Performance Automation (Core Web Vitals, free)

Performance budgets are CI-enforced, not aspirational. A regression > 10% on any metric fails the PR. The budgets:

| Surface | Metric | Budget | Tool | Failure threshold |
|---|---|---|---|---|
| Web (dashboard) | LCP | < 2.5s | Lighthouse CI | > 2.75s (10% over) fails |
| Web (dashboard) | CLS | < 0.1 | Lighthouse CI | > 0.11 fails |
| Web (dashboard) | TBT | < 200ms | Lighthouse CI | > 220ms fails |
| Web (dashboard) | FCP | < 1.8s | Lighthouse CI | > 1.98s fails |
| Product (landing) | LCP | < 2.5s (strict) | Lighthouse CI | > 2.5s fails (no 10% tolerance — this is the conversion surface) |
| Product (landing) | CLS | < 0.1 | Lighthouse CI | > 0.1 fails |
| Product (landing) | TBT | < 200ms | Lighthouse CI | > 200ms fails |
| Product (landing) | FCP | < 1.8s | Lighthouse CI | > 1.8s fails |
| Web + Product | Bundle size (gzip) | baseline ± 20KB | `@next/bundle-analyzer` | +20KB gzip over baseline requires PR approval; +50KB fails outright |
| Mobile | Cold start | < 2.5s (mid-tier Android) | Flashlight 0.10 | > 2.75s fails |
| Mobile | JS thread FPS | > 55 FPS during scroll | Flashlight | < 50 FPS fails |
| Desktop | Installer size | < 15MB | `tauri build` artifact size | > 15MB fails |
| Desktop | Cold start | < 1.5s | `cargo bench` + manual stopwatch test | > 1.65s fails |
| Desktop | Ledger op (Rust) | < 1ms p99 (single postEntry) | criterion 0.5 benchmark | > 1.1ms fails |

**Lighthouse CI configuration.** `lighthouserc.json` at repo root:

```json
{
  "ci": {
    "collect": {
      "url": ["http://localhost:3000/", "http://localhost:3000/dashboard"],
      "numberOfRuns": 3,
      "settings": { "preset": "desktop" }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["warn", { "minScore": 0.9 }],
        "categories:accessibility": ["error", { "minScore": 1.0 }],
        "categories:seo": ["error", { "minScore": 0.95 }],
        "first-contentful-paint": ["error", { "maxNumericValue": 1800 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }]
      }
    },
    "upload": { "target": "filesystem", "outputDir": ".lighthouse" }
  }
}
```

**Why `numberOfRuns: 3`?** Lighthouse has run-to-run variance (~5–10%) from browser scheduling. Three runs + median is the standard mitigation; the Lighthouse CI runner does this automatically. A single run that fails by 5% is noise; a median that fails by 10% is a real regression.

**Bundle size.** `@next/bundle-analyzer` runs in CI on every PR and posts a comment with the gzip diff per route. A +20KB gzip regression on the dashboard route requires explicit PR approval (the comment blocks merge until a maintainer replies `+approve-bundle`); a +50KB regression fails outright. The dashboard route budget is 180KB gzip (RSC + the small client islands); the product route budget is 120KB gzip (mostly the 3D hero per `20_3D_Product_Page.md`).

**Mobile performance (Flashlight).** Flashlight runs the app on an Android emulator in CI (GitHub Actions has `reactivecircus/android-emulator-runner`, free), records a trace, and asserts cold start + JS thread FPS. The "mid-tier Android" target is a Pixel 4a emulator (4GB RAM, mid-range CPU profile) — not a Pixel 8. This is intentional: a tutor in Nagpur is not on a Pixel 8.

**Desktop performance (criterion).** The Rust ledger benchmarks (`desktop/02_Rust_Core.md`) run via `cargo bench` on every PR that touches `src-tauri/`. Criterion produces a statistical comparison against the prior PR's baseline; a regression > 10% on `postEntry` p99 fails. The 1ms budget is generous (the TS ledger is < 5ms; the Rust port should be 5–10× faster) — the point is to catch *regressions*, not to optimise to the floor.

---

## 8. The `webDevReview` Cron Loop (autonomous resolution)

This project already has a **`webDevReview` cron job** (job_id `266790`) that fires every 15 minutes. The cron is the **autonomous resolution engine** — it's what makes this file's loop (§2) actually run, not just sit on paper.

**What the cron does, step by step:**

1. **Reads `worklog.md`** to understand the current platform state (which platform is `In-Flight`, what the last task was, what `BLOCKED` entries exist). The worklog is the cron's "context window" — without it, the cron would re-discover the project state every tick.
2. **Opens the app** in `agent-browser` at `http://localhost:3000/` (the dev server, always running in the sandbox).
3. **Captures screenshots** of every section — currently 16 sections on the product page (hero, principles, features, dashboard prototype, students, fees, attendance, settings, backup, roadmap, FAQ, pricing, testimonials, footer, etc.), plus the dashboard/students/fees/attendance/settings routes if they exist.
4. **Feeds each screenshot to z-ai vision (VLM)** with the structured prompt: "Evaluate this section against the design reference (`13_UI_Guidelines.md`). Score 0–10. List deviations as JSON. If a deviation looks like a bug (not a design choice), flag it with `is_bug: true` and `affected_file`."
5. **For each flagged bug**, the cron:
   - Runs the matching Playwright flow (§4) to confirm the bug (the VLM might be wrong).
   - If the flow fails, runs the §2 loop (capture → analyse → resolve → verify).
   - If the flow passes, the VLM was hallucinating; the cron logs a `false-positive` entry and moves on.
6. **Updates `worklog.md`** with a `webDevReview tick` entry: what it checked, what it found, what it fixed, what's `BLOCKED`.

**This file defines WHAT the cron checks.** The 36 flows in §4 + the visual regression baselines in §5 + the a11y assertions in §6 + the performance budgets in §7. The cron is the *engine*; this file is the *spec*. Without this file, the cron is a screenshot-taker; with this file, the cron is a bug-finder + bug-fixer.

**Cron autonomy boundaries.** The cron may:
- Apply `fix(test):` and `fix(a11y):` and `fix(perf):` commits autonomously (low-risk, the suite re-verifies).
- Update visual baselines with `chore(visual):` commits **only** after VLM cross-check (§5).
- Apply `feat:` commits **only** if the worklog's `In-Flight` task authorises the feature; otherwise STOP-AND-ASK.

The cron may **not**:
- Bump the contract version (G2 in `16_Platform_Delivery_Sequence.md`).
- Touch a platform that is not `In-Flight` (`16_` §7).
- Mock the ledger (`19_` §2.2, `AGENTS.md` §7.3).
- Skip a race test or disable a visual baseline (`19_` §7).

These boundaries are enforced by the same `AGENTS.md` §8 stop-and-ask machinery that governs every other agent action.

---

## 9. Bug Taxonomy (how the agent categorises what it finds)

When the cron (or the PR gate) finds a failure, it categorises it before resolving. The category determines the resolution strategy and the severity. The taxonomy is closed — every failure fits one of these 10 categories.

| # | Category | Example | Detection tool | Resolution strategy | Severity |
|---|---|---|---|---|---|
| 1 | **Visual / CSS** | Button colour off by one hex; border-radius 8px instead of 12px | Visual regression (`toHaveScreenshot`) + VLM | Edit the className / CSS variable; re-run snapshot | Low (P3) |
| 2 | **Functional / Logic** | "Record Payment" doesn't update balance; void entry doesn't reverse | Playwright assertion + VLM | Read the handler; fix the logic; re-run flow | High (P1) — money path |
| 3 | **Console Error** | `Cannot read property 'map' of undefined`; `Hydration failed` | Playwright `page.on('console')` + VLM | Read the stack trace; fix the null check or the hydration mismatch | Medium (P2) unless money path |
| 4 | **Hydration Mismatch** | Server renders `<div class="x">`, client hydrates `<div class="y">` | Playwright console + `next dev` log grep | Move the dynamic value to a `useEffect` or `'use client'` boundary | Medium (P2) |
| 5 | **A11y Violation** | Icon button missing `aria-label`; contrast ratio 3.2:1 | `@axe-core/playwright` | Add the label; bump the colour to meet 4.5:1 | High (P1) — legal |
| 6 | **Performance Regression** | LCP went from 2.1s to 2.9s; bundle +60KB gzip | Lighthouse CI + `@next/bundle-analyzer` | Profile the offending route; lazy-load the new dependency; re-run | Medium (P2) |
| 7 | **Visual Regression** | Section shifted 4px down; KPI accent bar missing | `toHaveScreenshot` + pixelmatch | Find the CSS change that caused it; revert or update baseline (§5) | Low (P3) unless it breaks layout |
| 8 | **Broken Flow** | Click "Save & lock" → nothing happens (onClick missing) | Playwright timeout + VLM | Re-add the onClick; check the refactoring diff that removed it | High (P1) |
| 9 | **Sticky Footer** | Gap below footer on short page; footer overlaps content on long page | Playwright DOM measurement + VLM | Fix the flex layout (`pro-sticky-footer` per Task 15); verify on short + long | Medium (P2) — design-system |
| 10 | **Responsive Break** | Layout breaks at 375px; sidebar overlaps content at 768px | Playwright viewport matrix + VLM | Add the missing media query / Tailwind breakpoint; re-run all 3 viewports | Medium (P2) |

**Severity → SLA.** P1 (high) → cron attempts fix immediately; if 3 tries fail, `BLOCKED` + STOP-AND-ASK. P2 (medium) → cron attempts fix; if 3 tries fail, logs `BLOCKED` and continues. P3 (low) → cron queues the fix for the next tick (no urgency); the visual baseline is updated only after VLM cross-check (§5).

**Money-path bugs (category 2 or 3 touching the ledger) are always P1** and **always re-run the full `19_` concurrency suite** after the fix, not just the failing flow. A ledger fix without a concurrency re-verification is a `19_` §2.2 violation.

---

## 10. CI Integration (GitHub Actions, free)

All automation runs on **GitHub-hosted runners** (free for public repos; 2,000 free minutes/month for private — sufficient at current cadence). The workflow file `.github/workflows/automation.yml`:

```yaml
name: automation
on:
  pull_request:
  schedule:
    - cron: '0 2 * * *'   # nightly 02:00 UTC = 07:30 IST
  push:
    tags: ['v*.*.*']      # desktop flows on tag push (release)

jobs:
  # ─── WEB + PRODUCT (every PR) ────────────────────────────────────
  web-product:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: bun run dev &   # start dev server in background
      - name: Wait for dev server
        run: npx wait-on http://localhost:3000 --timeout 60000
      - name: Install Playwright browsers
        run: bunx playwright install --with-deps chromium
      - name: Run Playwright (web + product, 22 flows)
        run: bunx playwright test --project=web --project=product
      - name: Upload trace + screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: |
            test-results/
            tests/visual/__screenshots__/**/*-diff.png
      - name: Lighthouse CI
        run: bunx @lhci/cli autorun
      - name: Bundle analyzer
        run: bun run analyze

  # ─── MOBILE (nightly + on PRs touching apps/mobile/) ────────────
  mobile:
    runs-on: macos-latest   # macOS runner: iOS simulator + Android emulator
    if: github.event_name == 'schedule' || contains(github.event.head_commit.modified, 'apps/mobile/')
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '17' }
      - run: cd apps/mobile && bun install
      - name: Install Maestro
        run: curl -Ls "https://get.maestro.mobile.dev" | bash
      - name: Boot iOS simulator + install app
        run: cd apps/mobile && bunx expo run:ios --configuration preview
      - name: Run Maestro (8 flows)
        run: ~/.maestro/bin/maestro test tests/mobile/flows/ --output tests/mobile/report/
      - name: Flashlight cold-start benchmark
        run: bunx flashlight --bundleId com.buddysaradhi.app --test-command "cold-start"

  # ─── DESKTOP (on tag push) ──────────────────────────────────────
  desktop:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    if: startsWith(github.ref, 'refs/tags/v')
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Build Tauri app
        run: bunx tauri build
      - name: Start tauri-driver
        run: ~/.cargo/bin/tauri-driver &
      - name: Run WebDriverIO (6 flows)
        run: cd apps/desktop && bunx wdio run wdio.conf.ts
      - name: Rust benchmarks (criterion)
        run: cd src-tauri && cargo bench --bench ledger_bench

  # ─── A11Y (axe in web-product + Pa11y nightly on product) ───────
  a11y-nightly:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run dev &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      - name: Pa11y full crawl (product page tree)
        run: bunx pa11y-ci --sitemap http://localhost:3000/sitemap.xml --standard WCAG2AA
```

**Notes on the workflow:**

- **Web + product on every PR** — these are the cheapest and highest-signal (22 flows in ~12 minutes on a Linux runner).
- **Mobile nightly + on PRs that touch `apps/mobile/`** — the macOS runner is slower and the iOS simulator boot adds ~3 minutes, so we don't run it on every PR.
- **Desktop on tag push only** — desktop flows require a built binary; building on 3 OSes for every PR is wasteful. Tag-push = release-candidate = full desktop verification.
- **A11y nightly** runs Pa11y's full sitemap crawl — this catches regressions that axe-core's per-flow scan misses (e.g., a new page added without axe coverage).
- **Artifacts on failure** — every failing job uploads the Playwright trace + screenshot diffs as a GitHub Actions artifact (10MB free per artifact, 90-day retention). This is the "show your work" surface for `BLOCKED` entries.

**Cost.** At current cadence (5 PRs/day × 22 flows + nightly mobile + weekly desktop tag): ~150 runner-minutes/day = ~4,500/month. The free tier for public repos is unlimited; for private repos, 2,000 minutes/month covers ~22 PRs/day, well above the current rate.

---

## 11. Anti-Patterns

| # | Anti-pattern | Why forbidden | Do this instead |
|---|---|---|---|
| 1 | **Paid SaaS for testing** (BrowserStack, SauceLabs, Percy, Applitools, Datadog, k6 Cloud, Calibre) | The user's explicit constraint: "all tools must be free and latest." Paid SaaS also locks bug data behind a dashboard, which the VLM can't read. | Use the OSS alternatives in §3 (Playwright, Maestro, `toHaveScreenshot`, Flashlight, Lighthouse CI, k6 OSS CLI). They cover the same surface. |
| 2 | **Skipping the VLM analysis step** (screenshots without analysis) | A screenshot without analysis is noise — the cron would save 1000 PNGs and never look at them. | Every captured screenshot goes through the §2 step-3 VLM prompt. The VLM is the *only* way the agent "sees" the screenshot. |
| 3 | **Disabling visual regression on flaky tests** | A flaky visual test means the UI is non-deterministic (e.g., a loading spinner with random delay). Disabling the test hides the bug. | Fix the UI: make the spinner deterministic (or wait for it in the test setup). `19_` §7 — "fix the UI, not the test." |
| 4 | **Running E2E in unit-test loops** | E2E needs a real browser + real server; running it in a Vitest `for` loop spawns 100 browsers and OOMs the runner. | E2E lives in `bunx playwright test` (separate runner, separate CI job). Unit/property tests live in Vitest. Never mix. |
| 5 | **Mocking the ledger in an E2E flow** | `19_` §2.2 + `AGENTS.md` §7.3 — a mocked ledger E2E passes while the real ledger burns money. | E2E flows use a real in-memory SQLite (`:memory:`) with the real migrations. The gateway is the only seam. |
| 6 | **Skipping a flow because it's "flaky"** | A flaky flow is a real non-determinism bug (race, timing, network). `19_` §7. | Mark `test.fixme(true)` with a `BLOCKED` worklog entry citing the 3-attempted-fixes cap. Never `test.skip`. |
| 7 | **Updating a visual baseline without VLM cross-check** | An agent could commit an ugly baseline and the suite would go green. | The §5 VLM cross-check is mandatory. A baseline commit without a VLM `[]` response is rejected by the gate. |
| 8 | **Using `toBeVisible()` instead of `toHaveScreenshot()`** | "Visible" is a boolean; it tells you nothing about *what* the user sees. | For any visual element, use `toHaveScreenshot()`. Reserve `toBeVisible()` for "does this exist at all" checks. |
| 9 | **Asserting on implementation, not behaviour** (e.g., `expect(button.className).toContain('pro-btn-primary')`) | Refactoring the className breaks the test even though behaviour is unchanged. | Assert on behaviour: `expect(button).toHaveAttribute('aria-pressed', 'true')` or `expect(await button.textContent()).toBe('Save')`. |
| 10 | **Running the full 36-flow suite on every commit** | 36 flows × 4 viewports × 3 Lighthouse runs = ~25 minutes. Too slow for a save-and-commit loop. | Run the affected surface only (web OR product OR mobile OR desktop) based on the diff. The full suite runs on PR + nightly. |

---

## 12. Cross-References

- **`19_Concurrency_and_Testing.md` §5 (E2E golden path)** — this file expands it from 3 flows (one per platform) to **36 flows** (12 + 8 + 6 + 10). The golden path is now `W-01..W-12` for web, etc.
- **`19_Concurrency_and_Testing.md` §2.1 (coverage floors)** — the floors (Web 80%, Mobile 75%, Desktop 70%, ledger 100%) are the G3 quality bar; this file's automation suite is the *behavioural* evidence on top of the *coverage* evidence.
- **`16_Platform_Delivery_Sequence.md` G3 (quality bar)** — the automation suite is G3 evidence. A platform cannot clear G3 with the 36 flows red.
- **`16_Platform_Delivery_Sequence.md` G4 (real-env verified)** — Playwright/Maestro/tauri-driver runs in CI are the G4 evidence for web/mobile/desktop respectively.
- **`13_UI_Guidelines.md` (design system)** — the visual regression baselines (§5) encode this design system as PNGs. A baseline change is a design-system change.
- **`20_3D_Product_Page.md` (3D hero)** — the P-01 hero flow specifically verifies the 3D scene (≥ 50fps, graceful WebGL fallback). Its baseline is the WebGL render, not a poster.
- **`10_Security.md` §18 (security lint)** — runs in the same CI gate as the automation suite (§10). A security finding blocks the same merge.
- **`AGENTS.md` §0.1 (spec → code → test loop)** — the automation suite is the "test" step, automated. The cron closes the loop: spec → code → test → fix → test → commit, without human intervention.
- **`AGENTS.md` §8 (stop-and-ask)** — the 3-tries cap in §2 step 4 is the same machinery: `BLOCKED` = STOP-AND-ASK, just automated.
- **`17_API_Gateway_System.md` §8 (error contract)** — every flow in §4 has a negative-case variant (W-01b: signup with expired OTP → 400 `otp_expired`; etc.) that asserts the error contract. These live alongside the happy-path flows in the same `*.spec.ts` file.
- **Task 15-UI-OVERHAUL (worklog)** — the visual baselines are seeded from the polished prototypes (159 `pro-*` utility classes, sticky footer verified at 15809px). The first `toHaveScreenshot()` run captures these as the source-of-truth PNGs.

---

## 13. ASCII Mockup — The Autonomous Resolution Console

This is what the `webDevReview` cron outputs on a typical tick. The output is appended to `worklog.md` under the cron's entry, and a copy is saved to `logs/webDevReview/<timestamp>.log` for audit.

```
╔══════════════════════════════════════════════════════════════════╗
║  webDevReview tick — 2025-07-12 14:30 IST  (job_id 266790)        ║
║  trigger: cron (15-min)                                           ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  [1/5] READ worklog.md .................................. ✅      ║
║        In-Flight: WEB                                            ║
║        last task: 15-UI-OVERHAUL (COMPLETED)                     ║
║        open BLOCKED: 0                                            ║
║                                                                  ║
║  [2/5] OPEN http://localhost:3000/ ............... ✅  (124ms)   ║
║                                                                  ║
║  [3/5] CAPTURE 16 sections ............................ ✅        ║
║        hero · principles · features · dashboard-prototype ·      ║
║        students · fees · attendance · settings · backup ·        ║
║        roadmap · faq · pricing · testimonials · footer           ║
║        (16 PNGs saved to logs/webDevReview/2025-07-12T1430/)     ║
║                                                                  ║
║  [4/5] VLM EVALUATE  (z-ai vision)                              ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │  section          score   deviations                       │  ║
║  │  hero              8/10   []                                │  ║
║  │  principles        8/10   []                                │  ║
║  │  features          8/10   []                                │  ║
║  │  dashboard-prot    8/10   []                                │  ║
║  │  students          8/10   []                                │  ║
║  │  fees              7/10   [{first-row, gap-4px, 0.3}]       │  ║
║  │  attendance        8/10   []                                │  ║
║  │  settings          8/10   []                                │  ║
║  │  backup            8/10   []                                │  ║
║  │  roadmap           8/10   []                                │  ║
║  │  faq               6/10   [{item-1, no-expand, 0.9, BUG}]   │  ║
║  │  pricing           8/10   []                                │  ║
║  │  testimonials      8/10   []                                │  ║
║  │  footer            8/10   []                                │  ║
║  │  mobile-375        8/10   []                                │  ║
║  │  sticky-footer     8/10   []                                │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  Bugs flagged: 1   (P-07 FAQ accordion — first item no-expand)   ║
║                                                                  ║
║  [5/5] RESOLVE                                                    ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │  confirm bug: run P-07 Playwright flow  ................ FAIL│  ║
║  │  CAPTURE: screenshot + console + trace                    │  ║
║  │  VLM ANALYSE:                                             │  ║
║  │    root_cause: "onClick handler missing on first <button> │  ║
║  │                in faq.tsx; refactored in 15-UI but the    │  ║
║  │                handler was dropped during the className   │  ║
║  │                swap to pro-btn-secondary"                 │  ║
║  │    affected_file: src/components/product/faq.tsx:42       │  ║
║  │    suggested_fix: "re-add onClick={() => toggle(0)} to    │  ║
║  │                   the first button element"               │  ║
║  │    confidence: 0.92                                       │  ║
║  │                                                           │  ║
║  │  APPLY FIX: edit src/components/product/faq.tsx:42        │  ║
║  │  RE-RUN P-07 ........................................ PASS│  ║
║  │  VERIFY: re-run product suite (10 flows) ........... PASS│  ║
║  │  VERIFY: re-run a11y (axe on faq.tsx) ............. PASS│  ║
║  │  VERIFY: visual baseline (P-07) — diff 0.0% .... PASS│  ║
║  │                                                           │  ║
║  │  COMMIT: fix(test): P-07 FAQ accordion onClick restored   │  ║
║  │  WORKLOG: appended                                        │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  Summary: 16 sections evaluated · 1 bug found · 1 fixed · 0 BLK  ║
║  Next tick: 2025-07-12 14:45 IST                                 ║
╚══════════════════════════════════════════════════════════════════╝
```

**Reading the console.** The 8/10 scores are the VLM's per-section evaluation against `13_UI_Guidelines.md` (8/10 is the current baseline for the polished prototypes — the remaining 2/10 is the OnboardingHint tooltip inconsistency noted in Task 15's stage summary). The `6/10` on the FAQ section with the `BUG` flag is the trigger — the VLM saw that the first accordion item doesn't expand. The cron then **confirmed** the bug by running the matching P-07 Playwright flow (VLM can hallucinate; Playwright cannot). The trace + console + screenshot fed back to the VLM for root-cause analysis, the VLM identified the dropped `onClick` (a regression from Task 15's className swap), the agent applied the one-line fix, re-ran P-07 (pass), re-ran the full product suite (pass — no regression), re-ran axe on the FAQ (pass — no a11y break), re-ran the visual baseline (0.0% diff — the fix didn't shift layout). Committed as `fix(test): P-07 FAQ accordion onClick restored`. Worklog updated. Tick done in ~90 seconds.

**This is the autonomous resolution loop end-to-end.** The user did nothing. The cron found the bug, understood it, fixed it, verified the fix didn't break anything, and committed. This is what this file enables — and it's why every tool in §3 is free (the cron would burn $50/day on paid SaaS API calls) and why the VLM is mandatory (without it, the cron is just a screenshot-taker).
