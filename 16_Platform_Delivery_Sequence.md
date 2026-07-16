# 16 — Platform Delivery Sequence

> **The single most important process spec in this repo.** Buddysaradhi ships on three surfaces — Web, Mobile, Desktop. They are NOT built in parallel. They are built **serially, each to production, before the next begins.** This file is the hard gate that stops an agent from "doing all platforms at once" — the failure mode that produced hallucinations, orphaned code, and a plan nobody could execute.

---

## 0. Why This File Exists

The prior planning package let an agent read `web/`, `mobile/`, and `desktop/` specs in one session and attempt to scaffold all three simultaneously. The result: context bleed (mobile constraints applied to web code), half-built platforms, conflicting type definitions across `apps/`, and a dashboard demo that rendered on port 3000 while the mobile and desktop trees sat empty and broken. The agent "completed all platforms" in the sense that it touched all of them — and finished none of them.

This file replaces that failure mode with a **hard serial pipeline**. The rule is one sentence:

> **Exactly one platform is `In-Flight` at any time. A platform cannot enter `In-Flight` until the prior platform has cleared its Production Gate. There are no exceptions, no "quick parallel spikes," no "I'll just scaffold the desktop tree while web is in review."**

This is a process non-negotiable. It sits alongside the 10 product non-negotiables in `AGENTS.md` §2 and is enforced by the same "stop-and-ask" machinery in `AGENTS.md` §8.

---

## 1. The Three Platforms, In Order

| Seq | Platform | App path | Stack | Starts after | Ships to |
|---|---|---|---|---|---|
| **P1** | **Web** | `apps/web/` (the sandbox Next.js 16 app at repo root today) | Next.js 16 App Router, TS strict, Tailwind 4, shadcn/ui, Prisma + Turso/libSQL | — (the first platform; nothing precedes it) | `buddysaradhi.app/` (Vercel) |
| **P2** | **Mobile** | `apps/mobile/` | Expo SDK 52+, React Native 0.76, expo-sqlite, EAS Build/Submit | P1 clears the **Web Production Gate** (§4) | iOS App Store + Android Play Store |
| **P3** | **Desktop** | `apps/desktop/` + `src-tauri/` | Tauri v2 (Rust core) + Next.js static export | P2 clears the **Mobile Production Gate** (§5) | macOS (notarised .dmg), Windows (code-signed .msi), Linux (.AppImage) |

The order is **not** arbitrary. It is the cheapest-failure-first ordering:

1. **Web first** because the iteration loop is seconds (save → hot-reload → Agent Browser verify), the deploy is a `git push`, and every shared contract (`packages/shared` Zod schemas, `17_API_Gateway_System.md` OpenAPI, `18_Microservice_Architecture.md` service boundaries) is cheapest to validate on a single surface that already runs in this sandbox.
2. **Mobile second** because it consumes the **frozen** web contracts (API gateway, sync protocol, ledger engine) — once web is in production, mobile is "port the frozen contract to a smaller surface," not "invent the contract and the surface at once." Mobile also has the slowest feedback loop (EAS Build ≈ 12–20 min) and the harshest review (App Store), so it must inherit a proven contract.
3. **Desktop third** because it is the smallest audience (tutors on laptops, a minority) and the most optional surface (a tutor can run their whole business from web + mobile). Desktop inherits the same frozen contract plus a Rust native core; starting it before mobile is done would mean inventing the Rust/IPC layer against a moving contract — the textbook way to produce a security bug.

---

## 2. The Pipeline (ASCII)

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                    PLATFORM DELIVERY PIPELINE                            │
 │            exactly one platform In-Flight at any moment                  │
 └──────────────────────────────────────────────────────────────────────────┘

   TIME ──────────────────────────────────────────────────────────────────▶

   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │  P1: WEB    │──▶│  WEB PROD   │──▶│  P2: MOBILE │──▶│ MOBILE PROD │
   │  In-Flight  │   │  GATE  ✅   │   │  In-Flight  │   │  GATE  ✅   │
   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
                                              │                  │
                                              ▼                  ▼
                                     ┌─────────────┐   ┌─────────────┐
                                     │ P3: DESKTOP │──▶│ DESKTOP PROD│
                                     │  In-Flight  │   │  GATE  ✅   │
                                     └─────────────┘   └─────────────┘

   LEGEND:
     In-Flight  = the ONLY platform an agent may write code for right now
     GATE  ✅   = Production Gate (§3) signed off; next platform unlocks
     ──▶        = mandatory hand-off; NO skipping, NO reversing without RFC

   ANTI-PATTERN (forbidden):
     ┌─────────┐  ┌─────────┐  ┌─────────┐
     │  WEB    │  │ MOBILE  │  │ DESKTOP │   ← three In-Flight at once
     │ In-Flt  │  │ In-Flt  │  │ In-Flt  │     = hallucination factory
     └─────────┘  └─────────┘  └─────────┘
```

---

## 3. The Production Gate (Generic Definition)

Every platform clears the **same** five-part gate, specialised per platform in §4/§5/§6. A platform is "in production" only when **all five** are green. Four-out-of-five is **not** in production; it is `In-Flight (Gate Pending)` and the next platform stays locked.

| # | Gate part | What "green" means |
|---|---|---|
| G1 | **Spec-complete** | Every screen the platform ships has a spec section under `buddysaradhi_Planning/` (root or platform subdir) that the code maps to, sentence by sentence. No orphan code (`AGENTS.md` §0.2). |
| G2 | **Contract-frozen** | The platform consumes the shared contracts (`packages/shared` Zod schemas, `17_API_Gateway_System.md` OpenAPI, sync protocol from `mobile/04_Offline_Sync_and_Conflict_Resolution.md`) at a **pinned, tagged version**. The contract is not "latest" — it is `contracts/v1.0.0`. A platform that depends on `main` is not contract-frozen. |
| G3 | **Quality bar met** | `bun run lint` clean · `tsc --noEmit` clean · test coverage ≥ the platform's floor in `19_Concurrency_and_Testing.md` (Web 80%, Mobile 75%, Desktop 70%) · zero `high`/`critical` findings in the security lint (`10_Security.md` §18). |
| G4 | **Verified in the real environment** | Not "it compiles." Web: Agent Browser golden-path + Lighthouse ≥ 90 all categories on `/`. Mobile: EAS Build green on `preview` channel + run on a physical device (TestFlight internal + Play internal) for ≥ 24 h with zero crashes. Desktop: notarised build runs on a clean macOS + Windows VM with zero crashes. |
| G5 | **Worklog sign-off** | A `---`-delimited entry in `/home/z/my-project/worklog.md` titled `Task ID: <PLATFORM>-PROD-GATE` with `State: COMPLETED`, the five gate evidences (links/SHAs/screenshots), and an explicit line: `Next platform unlocked: <NEXT>.` This entry is the **only** signal the next platform may begin. |

### 3.1 Who Signs the Gate

In this autonomous-agent sandbox, the gate is self-signed by the agent that completed the platform, then **re-verified** by the next `webDevReview` cron cycle (which independently runs Agent Browser / build checks and fails the gate if any regression is found). In a human team, G5 additionally requires a human review approval on the gate PR. The point: a gate is an **auditable artefact**, not a feeling.

### 3.2 Gate Regression = Re-lock

If, after a platform clears its gate, a later change regresses any gate part (e.g., a web refactor drops Lighthouse below 90, or a contract change breaks mobile), the gate is **re-locked**: the regressed platform returns to `In-Flight (Gate Pending)`, and any platform that was depending on its frozen contract must reconcile. This is rare because contracts are pinned (G2) — a contract change is a versioned migration, not a silent break.

---

## 4. P1 — Web: Definition of Production-Done

The web platform (`apps/web/`, the Next.js 16 app at the repo root) is **In-Flight first**. It is "done" — and only then does mobile unlock — when all of the following hold:

- **W1.** The five product screens (`/dashboard`, `/students`, `/attendance`, `/fees`, `/settings`) plus the marketing surface (`/`) and auth (`/signup`, `/login`) render in Agent Browser on mobile + desktop widths with the sticky footer rule satisfied (`AGENTS.md` §6.3).
- **W2.** The API gateway from `17_API_Gateway_System.md` is live and **all** web data access flows through it — no direct Prisma calls from client components, no hardcoded service URLs. The gateway is the single network chokepoint.
- **W3.** The shared contracts (`packages/shared`, `packages/core` ledger engine) are tagged `contracts/v1.0.0` and web imports exactly that tag.
- **W4.** `bun run lint` clean, `tsc --noEmit` clean, Vitest suite green at ≥ 80% lines, Playwright smoke green on the golden path (login → create student → mark attendance → record fee → view ledger).
- **W5.** Deployed to Vercel production (`buddysaradhi.app/`) via the `05_CI_CD_GitHub_Actions.md` pipeline; Lighthouse ≥ 90 on Performance/Accessibility/Best-Practices/SEO for `/`.
- **W6.** The 3D product page (`20_3D_Product_Page.md`) is live on `/` with the hero R3F scene rendering at ≥ 50 fps on a mid-tier laptop and degrading gracefully (static poster) on no-WebGL devices.
- **W7.** Worklog entry `Task ID: WEB-PROD-GATE`, `State: COMPLETED`, with the Lighthouse URL, the Vitest coverage report link, the Agent Browser screenshot, and the contract tag. Ends with `Next platform unlocked: MOBILE.`

Until W1–W7 are all green, **no file under `apps/mobile/` or `apps/desktop/` may be created or edited** (see §7 Boundary Rule).

---

## 5. P2 — Mobile: Definition of Production-Done

Mobile begins only after the worklog carries `WEB-PROD-GATE … Next platform unlocked: MOBILE.` It is "done" when:

- **M1.** The five bottom-tab screens (Dashboard, Students, Attendance, Fees & Payments, Settings) render on iOS 16+ and Android 10+ physical devices, 44px touch targets, haptics on every neumorphic press (`mobile/AGENTS.md`).
- **M2.** All network access flows through the **same** API gateway (`17_API_Gateway_System.md`) at the **same** `contracts/v1.0.0` tag web uses — via the typed SDK generated from the gateway OpenAPI. No hardcoded endpoints, no per-platform fetch wrappers that drift.
- **M3.** Offline-first contract (`mobile/04_Offline_Sync_and_Conflict_Resolution.md`) verified: aeropone-mode test for 30 min of offline mutations, then reconnect → sync_outbox drains → zero conflicts, zero data loss, integer-paise ledger intact.
- **M4.** EAS Build green on `production` channel for both `ios` and `android`; submitted to App Store Connect + Play Console; TestFlight internal + Play internal distribution to ≥ 3 testers for ≥ 24 h with zero crashes (Crashlytics / Sentry clean).
- **M5.** App Store + Play Store review **passed** (or at "ready for release" with only metadata issues remaining). The store listings use the "Free for everyone, for now" copy from `product/` verbatim.
- **M6.** `bun run lint` (ESLint + `tsc` for the RN/Expo tree) clean; Detox e2e green on the golden path; coverage ≥ 75% lines per `19_Concurrency_and_Testing.md`.
- **M7.** Worklog entry `Task ID: MOBILE-PROD-GATE`, `State: COMPLETED`, with the EAS build URLs, the 24-h crash report, the store submission screenshots. Ends with `Next platform unlocked: DESKTOP.`

Until M1–M7 are green, **no file under `apps/desktop/` may be created or edited.**

---

## 6. P3 — Desktop: Definition of Production-Done

Desktop begins only after `MOBILE-PROD-GATE … Next platform unlocked: DESKTOP.` It is "done" when:

- **D1.** The five screens render inside the Tauri webview on macOS 12+, Windows 10+, Ubuntu 22.04+, window chrome matching `desktop/01_Architecture.md`.
- **D2.** All network access flows through the same API gateway at `contracts/v1.0.0`. The Rust core (`desktop/02_Rust_Core.md`) handles local SQLite (SQLCipher) and IPC; remote access is gateway-only.
- **D3.** Notarised macOS `.dmg`, code-signed Windows `.msi`, Linux `.AppImage` produced by `desktop/06_Installers.md` pipeline; auto-updater (`desktop/05_Updater.md`) verified end-to-end (ship a `v1.0.1` patch, confirm the installed `v1.0.0` updates itself).
- **D4.** IPC security lint (`desktop/03_IPC_Security.md`) clean — every IPC command validated by `serde`, capability allowlist unchanged from spec, no `shell` capability beyond the updater.
- **D5.** Runs 30 min on a clean macOS VM and a clean Windows VM with zero crashes; the secure-erase flow (`10_Security.md` §18) verified (LEDGER-4 invariant holds after erase).
- **D6.** Coverage ≥ 70% lines; Rust unit tests (`cargo test`) green; Tauri e2e smoke green.
- **D7.** Worklog entry `Task ID: DESKTOP-PROD-GATE`, `State: COMPLETED`. Ends with `All three platforms in production. v1.0 complete.`

---

## 7. The Boundary Rule (Hard Stop-and-Ask)

This is the rule that kills the "agent does all platforms at once" failure mode. It is short and absolute.

> **An agent In-Flight on platform P may create or edit files ONLY under:**
> - the platform's own app path (`apps/web/` · `apps/mobile/` · `apps/desktop/` + `src-tauri/`),
> - the platform's spec subdir (`buddysaradhi_Planning/web/` · `mobile/` · `desktop/`),
> - the shared contract surface (`packages/shared`, `packages/core`, `packages/ui`) **and only via a spec amendment RFC, not unilaterally**,
> - `worklog.md` (append-only).
>
> **It may NOT create or edit files under another platform's app path or spec subdir.** If the agent believes a change on platform P *requires* a change on platform Q, that is a **cross-platform contract change** → STOP → open an RFC (`docs/rfc/`) → do not touch Q's code. The RFC is reviewed; only then does a Q-scoped agent make the change.

### 7.1 The Single In-Flight Platform (mirrors `AGENTS.md` §9.2.1)

At any moment, **exactly one** platform is `In-Flight`. The platform state lives at the top of `/home/z/my-project/worklog.md` in a status block:

```markdown
## Current Platform State
- In-Flight: WEB          ← the ONLY platform an agent may write code for now
- WEB gate:    In-Flight (Gate Pending)   — W1✅ W2✅ W3⏳ W4⏳ W5⏳ W6⏳ W7⏳
- MOBILE gate: LOCKED (waits on WEB)
- DESKTOP gate: LOCKED (waits on MOBILE)
- Contracts tag: contracts/v1.0.0 (pinned)
```

An agent that begins work MUST read this block first (it is the first thing in `worklog.md`). If `In-Flight: WEB`, the agent works web only. If an agent finds `In-Flight: WEB` but is asked to do mobile work, it runs the close-out (`AGENTS.md` §9.2.2) on whatever web task is open, **then** must produce or find a `WEB-PROD-GATE` sign-off before flipping `In-Flight: MOBILE`. No sign-off → mobile stays locked → STOP-and-ASK.

### 7.2 What "Edit Another Platform" Looks Like (Anti-Pattern)

| Forbidden action | Why it's forbidden | Do this instead |
|---|---|---|
| Web agent adds a field to the mobile Zod schema to "keep them in sync" | The contract is frozen at a tag; unilateral drift breaks mobile's G2 | Open `docs/rfc/00XX-add-field.md`; version the contract to `v1.1.0`; web consumes `^1.1`, mobile stays on `1.0` until it upgrades |
| Web agent scaffolds `apps/mobile/App.tsx` "to save the mobile agent time" | Mobile isn't unlocked; the scaffold will be built against a moving web contract and rots | Don't. Mobile scaffolds itself once unlocked, against the frozen `v1.0.0` tag |
| Mobile agent edits `apps/web/app/dashboard/page.tsx` to "fix a bug it found" | Cross-platform boundary violation; the web agent owns web code | File a `BUG-WEB-*` issue; the next web-cycle agent fixes it |
| Desktop agent changes the API gateway to "add a field desktop needs" | The gateway is shared infrastructure; unilateral changes break web + mobile | RFC → contract `v1.x.0` → all platforms migrate on their own cycle |

---

## 8. State Machine (ASCII)

```
                    ┌─────────────────────────────────────────┐
                    │  a platform's life-cycle, one column     │
                    │  per platform; columns do NOT overlap     │
                    └─────────────────────────────────────────┘

   LOCKED ──(prior gate ✅)──▶ IN-FLIGHT ──(G1..G5 ✅)──▶ IN-PRODUCTION
                                  │                            │
                                  │  (regression found)        │
                                  ▼                            ▼
                              IN-FLIGHT ◀──── (re-lock) ─── IN-PRODUCTION
                              (Gate Pending)                 (regressed)


   WEB        : LOCKED ─▶ IN-FLIGHT ─▶ IN-PROD ─────────────────────────▶  ✓
   MOBILE     : LOCKED ──────────────────▶ IN-FLIGHT ─▶ IN-PROD ────────▶  ✓
   DESKTOP    : LOCKED ──────────────────────────────────▶ IN-FLIGHT ─▶ IN-PROD

   ^ the three columns are TIME-SHIFTED. They never stack vertically (parallel).
```

---

## 9. The Shift Protocol — Moving From Platform P to Platform Q

This extends `AGENTS.md` §9.2 (task-to-task) with a **platform-to-platform** transition. The two are related but distinct: §9.2 governs shifting between *tasks within a platform*; this governs shifting between *platforms*.

### 9.1 Pre-conditions (all must be true)

1. Platform P has a worklog entry `Task ID: <P>-PROD-GATE`, `State: COMPLETED`, ending with `Next platform unlocked: <Q>.`
2. All five gate parts (G1–G5) for P are evidenced in that entry.
3. The shared contracts are tagged and P imports the tag (not `main`).

### 9.2 The Shift (6 steps)

1. **Read** the `<P>-PROD-GATE` worklog entry. Confirm the `Next platform unlocked: <Q>.` line is present.
2. **Verify the gate** hasn't regressed since sign-off: re-run the cheapest gate checks (web: Agent Browser + lint; mobile: EAS build status; desktop: build status). If regressed, DO NOT shift — file `BLOCKED` and re-open P.
3. **Flip the status block** at the top of `worklog.md`: `In-Flight: <Q>`, `<P> gate: IN-PRODUCTION`, `<Q> gate: IN-FLIGHT (Gate Pending)`.
4. **Read** the Q spec subdir in order: `Q/README.md` → `Q/AGENTS.md` → `Q/01_Architecture.md` → the screen specs. Do not write Q code until Q's `AGENTS.md` reading order is complete.
5. **Pin the contract tag** for Q to the same `contracts/v1.0.0` P used. If Q legitimately needs a newer contract, that is an RFC (§7.2), not a unilateral bump.
6. **Append a worklog entry** `Task ID: <Q>-KICKOFF`, `State: IN-FLIGHT`, naming the first Q work item and its spec ref. The first Q work item is always `Q/01_Architecture.md` scaffolding, never a feature.

### 9.3 The Anti-Shift Lint — `no-parallel-platform.test.ts`

A CI lint (`tools/no-parallel-platform.test.ts`) enforces this at the repo level:

- **Fail** if a single PR diff touches files under two or more of `apps/web/`, `apps/mobile/`, `apps/desktop/` (the only exception: a contract-version bump PR that touches `packages/shared` + a migration note, reviewed by the RFC owner).
- **Fail** if the `worklog.md` status block's `In-Flight` platform does not match the platform path of the PR diff.
- **Fail** if a platform's app path is edited while that platform's gate is `LOCKED` in the status block.

This lint runs in the `webDevReview` cron and on every PR. It is the mechanical backstop for §7.

---

## 10. How This Maps Onto the Current Sandbox Project

The repo at `/home/z/my-project/` today is **P1 (Web) In-Flight**. Specifically:

- `apps/web/` is the Next.js 16 app served on port 3000 (the dashboard demo + landing page). This is the active surface.
- `apps/mobile/` and `apps/desktop/` do **not** exist yet — correctly, because the Web Production Gate (§4) has not cleared. Do not create them.
- `packages/shared`, `packages/core`, `packages/ui` are spec'd (`AGENTS.md` §3.1) but not yet materialised as tagged contracts. The Web In-Flight phase MUST produce and tag `contracts/v1.0.0` (this is W3) before mobile can begin.
- The API gateway (`17_API_Gateway_System.md`) is not yet live; W2 requires it. So a chunk of remaining Web In-Flight work is: stand up the gateway, route web through it, tag the contracts, then clear W4–W7.

### 10.1 Immediate Sequencing for the Web Phase

```
 WEB IN-FLIGHT remaining work (in order):

   1. 17_API_Gateway_System.md  → implement gateway (Caddy + BFF route handlers)
   2. Route all src/app/api/* through the gateway; remove direct DB calls from clients
   3. 18_Microservice_Architecture.md → extract the first service boundary (ledger-svc)
        behind the gateway; web calls gateway → gateway routes to ledger-svc
   4. Tag packages/shared + packages/core as contracts/v1.0.0
   5. 19_Concurrency_and_Testing.md → add the concurrency + coverage harness;
        hit Web coverage floor (80%) + concurrency test suite green
   6. 20_3D_Product_Page.md → ship the R3F hero on / (boneyard-js skeletons during load)
   7. 21_Automation_Testing.md → wire the 12 web flows (W-01..W-12) + 10 product flows
        (P-01..P-10) into Playwright; seed visual-regression baselines from the Task-15
        pro-* prototypes; wire the webDevReview cron to the 5-step AI bug-resolution loop
   8. Lighthouse ≥ 90, Playwright 22 flows green, axe-core 0 critical, Agent Browser verify
   9. Worklog: WEB-PROD-GATE, State: COMPLETED, "Next platform unlocked: MOBILE."
   ─── only now may apps/mobile/ be created ───
```

### 10.2 What the Autonomous `webDevReview` Cron Must Respect

The 15-minute `webDevReview` cron job (the autonomous development loop) is **bound by this file** and **powered by `21_Automation_Testing.md`**. Concretely:

- The cron reads the `worklog.md` status block first. It works **only** on the `In-Flight` platform.
- It may NOT create `apps/mobile/` or `apps/desktop/` until the status block says those gates are unlocked.
- If it finishes a work item, it appends a worklog entry and picks the next item **within the same platform's** §10.1-style list.
- It may NOT propose "scaffold the mobile app" as a new requirement while web is In-Flight. That proposal is a §8 STOP-and-ASK, not an autonomous action.
- **The cron's bug-finding + resolution behaviour is defined by `21_Automation_Testing.md` §2 (the 5-step AI loop) + §8 (the cron engine) + §9 (bug taxonomy).** When the cron reports a bug, it follows `21`'s Run→Capture→Analyse→Resolve→Verify loop, not an ad-hoc process.

---

## 11. Cross-References

- `AGENTS.md` §2 (10 non-negotiables) — this file adds an 11th process non-negotiable: serial platform delivery.
- `AGENTS.md` §8 (stop-and-ask) — §7 Boundary Rule is a stop-and-ask trigger.
- `AGENTS.md` §9.2 (task-to-task transition) — §9 here extends it platform-to-platform.
- `15_Future_Roadmap.md` — the v1.0 / v1.x / v2.0 roadmap is reinterpreted through this file: v1.0 = Web Production Gate; v1.x mobile/desktop = the P2/P3 phases; v2.0 multi-device sync presumes all three gates cleared.
- `17_API_Gateway_System.md` — the contract-freeze mechanism (G2) that makes serial delivery safe.
- `18_Microservice_Architecture.md` — service extraction happens **within** the Web phase (P1), not as a parallel refactor.
- `19_Concurrency_and_Testing.md` — the per-platform coverage + concurrency floors (G3).
- `20_3D_Product_Page.md` — a Web-phase deliverable (W6).

---

## 12. ASCII Mockup Suite (§20 Compliance)

### 12.1 Design System Reference — Platform Sequence

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  BUDDYSARADHI — PLATFORM DELIVERY SEQUENCE                              │
 │  tokens: see 13_UI_Guidelines.md §2.1 (no new tokens introduced)        │
 │  status colours: LOCKED=--text-muted | IN-FLIGHT=--accent-amber         │
 │                  IN-PRODUCTION=--accent-emerald | REGRESSED=--accent-flare│
 └─────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Mockup S1 — The Status Block (lives at top of worklog.md)

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  CURRENT PLATFORM STATE                              (read this FIRST)    ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  In-Flight : WEB  ◀── the ONLY platform an agent may write code for now  ║
║                                                                         ║
║  WEB     gate : IN-FLIGHT (Gate Pending)                                 ║
║               W1 ✅  W2 ✅  W3 ⏳  W4 ⏳  W5 ⏳  W6 ⏳  W7 ⏳            ║
║  MOBILE  gate : LOCKED  (unlocks on WEB-PROD-GATE)                       ║
║  DESKTOP gate : LOCKED  (unlocks on MOBILE-PROD-GATE)                    ║
║                                                                         ║
║  Contracts : contracts/v1.0.0 (pinned — do NOT import from main)         ║
║  Last gate : (none yet)                                                  ║
║  Updated   : <iso-timestamp> by <agent-type>                             ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### 12.3 Mockup S2 — The Gate Card (rendered per platform in the worklog)

```
┌──────────────────────────── WEB PRODUCTION GATE ───────────────────────────┐
│                                                                          │
│  G1  Spec-complete        ✅  every screen maps to a spec sentence        │
│  G2  Contract-frozen      ✅  imports contracts/v1.0.0 (tag, not main)    │
│  G3  Quality bar          ✅  lint ✱ tsc ✱ cov 82% ✱ sec-lint 0 high     │
│  G4  Real-env verified    ✅  Agent Browser ✱ Lighthouse 94/96/100/100    │
│  G5  Worklog sign-off     ✅  Task ID: WEB-PROD-GATE  State: COMPLETED    │
│                                                                          │
│  Next platform unlocked: MOBILE.                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 12.4 Mockup S3 — The Shift Flowchart (P → Q)

```
        ┌─ read <P>-PROD-GATE entry ─────────────────────┐
        │  has "Next platform unlocked: <Q>." ?           │
        └──────────────────────┬──────────────────────────┘
                          yes  │  no ──▶ STOP-AND-ASK (P not done)
                               ▼
        ┌─ re-verify P gate hasn't regressed ─┐
        │  cheapest checks green?              │
        └──────────────────────┬───────────────┘
                          yes  │  no ──▶ re-lock P, file BLOCKED
                               ▼
        ┌─ flip worklog status block ─────────┐
        │  In-Flight: <Q>                      │
        │  <P> gate: IN-PRODUCTION             │
        │  <Q> gate: IN-FLIGHT (Gate Pending)  │
        └──────────────────────┬───────────────┘
                               ▼
        ┌─ read Q/README → Q/AGENTS → Q/01_Architecture ┐
        │  (do NOT write Q code until reading done)      │
        └──────────────────────┬─────────────────────────┘
                               ▼
        ┌─ pin Q to contracts/v1.0.0 (same tag as P) ─┐
        │  (newer contract needs an RFC, §7.2)         │
        └──────────────────────┬─────────────────────────┘
                               ▼
        ┌─ append worklog: Task ID <Q>-KICKOFF ─┐
        │  first Q item = Q/01_Architecture scaffold │
        └───────────────────────────────────────────┘
```

### 12.5 Mockup S4 — The Boundary Rule (what an In-Flight agent may touch)

```
   agent In-Flight on WEB may edit:           may NOT edit:
   ┌─────────────────────────┐                ┌─────────────────────────┐
   │ apps/web/**             │                │ apps/mobile/**          │ ✗
   │ web/*.md (spec)         │                │ apps/desktop/**         │ ✗
   │ packages/shared (RFC)   │                │ src-tauri/**            │ ✗
   │ packages/core   (RFC)   │                │ mobile/*.md             │ ✗
   │ packages/ui     (RFC)   │                │ desktop/*.md            │ ✗
   │ worklog.md (append)     │                │ (shared contract change │
   │ 17/18/19/20 *.md        │                │  without RFC = ✗)       │
   └─────────────────────────┘                └─────────────────────────┘
        ✓ may                                            ✗ must not
```

---

## 13. Summary (the whole file in five lines)

1. **One platform In-Flight at a time.** Web → prod → Mobile → prod → Desktop → prod.
2. **A platform unlocks only on a signed Production Gate** (G1–G5) in the worklog.
3. **An In-Flight agent touches only its own platform's files.** Cross-platform needs are RFCs, not edits.
4. **Contracts are pinned to a tag**, never `main`, so a frozen gate stays frozen.
5. **The `no-parallel-platform` lint and the `webDevReview` cron enforce this mechanically** — it is not a gentleman's agreement.
