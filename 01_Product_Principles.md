# 01 — Product Principles

> **The constitution of Buddysaradhi.** Every PR, every design choice, every "should we add this?" is arbitrated by these principles. When two principles conflict, the lower-numbered principle wins by default; a higher-numbered principle prevails only if doing so does not violate a lower-numbered one. This is the **doctrine of enumerated restraint**: a thing is forbidden unless a principle permits it.

> **How to read this file.** Each principle carries a **Statement** (the rule), **Why** (pain prevented), **Consequences** (forced do/not-do), **Enforcement** (CI/review gate), **Tension & Resolution** (tie-break), and an **Example** (feature request evaluated). After the principles come the Decision Protocol, Amendment Process, Conflicts Matrix, Anti-Principles, six Case Studies, the Hierarchy Diagram, the Principle-to-Code Map, and a Glossary.

---

## Principle 1 — The Tutor Is the User, Not the Student

> **Statement:** Every UX decision optimises for the **tutor's** time and cognitive load, never the student's. Student- and parent-facing surfaces are read-only concessions, never the centre of gravity.

**Why.** A tutor pays for and operates Buddysaradhi; the student is data inside it. When a tool optimises for the student, the tutor becomes a data-entry clerk feeding somebody else's dashboard.

**Consequences.** No gamification for students. No "student dashboard." No student login in v1. The student exists as a row, a chip, a name on a receipt — never as a logged-in actor.

**Enforcement.** Design review: any screen proposal requiring a student-side account is rejected. Code review: no `students` table column named `password`, `last_login`, or `session_token`. Schema lint (`principles/no-student-auth.py`) fails CI if such a column is added.

**Tension & Resolution.** Tensions P14 (Parent Is a Guest) — both agree the trust boundary is tutor-side, so no real conflict. Tensions P2 (Five Screens) when a "student portal" is requested as a sixth screen — P2 wins.

**Example.** A coaching institute asks for a "student progress leaderboard" so students compete on attendance. P1 → reject. Attendance data is the tutor's instrument, not a student scoreboard. Routed to the Report Engine as a tutor-private "consistency view."

---

## Principle 2 — Five Screens, Forever

> **Statement:** There are five top-level screens. A sixth screen is a bug, not a feature. If a new capability cannot be absorbed into one of the five, it is rejected or deferred to `15_Future_Roadmap.md`.

**Why.** Top-level screens are the tutor's spatial memory. Five is the upper bound of muscle-recallable navigation. A sixth screen fractures that memory and forces re-learning on every release.

**Consequences.** "Courses," "Batches," "Calendar," "Reports," "Notifications," "Communications," "Library" are **not** screens. They are panels, modals, drawers, or hidden engines living inside the five. A new capability must first prove it cannot fit before `15_Future_Roadmap.md §v2.0` considers graduation.

**Enforcement.** Code review: `src/app/` has exactly five top-level routes plus `/settings`. A sixth top-level route fails CI via `principles/route-count.test.ts`. `SidebarNav.tsx` is hard-capped at five entries by a TypeScript literal type.

**Tension & Resolution.** Tensions P3 (Two-Tap Rule) when a feature wants its own screen — P2 wins; the feature becomes a panel and the Two-Tap Rule is satisfied via sidebar + primary button. Tensions P12 when consolidation adds clicks — P2 wins; the click cost is lower than the navigation cost of a sixth screen.

**Example.** Request: "Add a Communications screen for WhatsApp templates." P2 → reject as a screen. Reshape: Communications becomes a panel inside Students + an engine inside the Reminder Engine. Spec: `05_Students.md §13`, `02_Core_Logic.md §Reminder Engine`.

---

## Principle 3 — Two-Tap Rule

> **Statement:** Any primary action — mark attendance, record a payment, generate a receipt, search a student, export a month — must be reachable in **≤ 2 taps** from any screen, via the persistent sidebar or the global command palette (`Cmd/Ctrl + K`).

**Why.** Tutors operate Buddysaradhi between class transitions, in corridors, on a phone propped against a register. A third tap is the difference between recording a payment in the moment and forgetting it forever.

**Consequences.** No screen is more than one sidebar item + one primary button away from the goal. The command palette is mandatory on every surface. Deep flows (e.g. "void a receipt") may exceed two taps only for **irreversible** actions (P11 demands friction there).

**Enforcement.** E2E tests (`19_Testing_Requirements.md`): every primary action has a Playwright spec asserting ≤2 clicks from each of the five screens. Command palette coverage test lists every registered command.

**Tension & Resolution.** Tensions P11 when a primary action is also a sensitive mutation — the *entry* to the flow is two taps; the PIN prompt does not count against P3. Tensions P8 when surfacing two-tap shortcuts clutters the page — P3 wins; shortcuts move into the command palette.

**Example.** From Attendance, recording a cash payment: tap sidebar "Fees" (1) → tap the student row's "Record" button (2). Two taps. Spec: `03_User_Flows.md §Flow 07`.

---

## Principle 4 — The Ledger Is Immutable Truth

> **Statement:** Money is never edited by mutating a balance field. Every financial event — fee charged, payment received, discount applied, refund issued — is an **append-only ledger entry**. All balances, dues, and reports are derived views over the ledger.

**Why.** A balance field is a lie waiting to happen: one bad `db.<model>.update()` and a month's revenue disappears with no trace. An append-only ledger is the only data structure that survives an audit, a divorce, a tax notice, or a tutor's fat-finger mistake.

**Consequences.** "Edit a payment" is impossible; you post a reversing entry (`VOID`, `BR-LED-03`). "Delete a student" is impossible; you archive them (BR-STU-01). The `ledger_entries` table is INSERT-only — Prisma middleware (`packages/core/src/ledgerGuard.ts`) rejects `db.ledgerEntry.update()` / `db.ledgerEntry.delete()` before the SQL reaches the DB, and the SQLite trigger `trg_ledger_no_update` is the second line of defence (`11_Data_Model.md §10`). Balances are computed, never stored.

**Enforcement.** Prisma middleware + the SQLite trigger `trg_ledger_no_update` abort any UPDATE/DELETE on the table. CI test: `db.ledgerEntry.update({ where: { id }, data: { amount: 0 } })` throws `E_LEDGER_IMMUTABLE`. ESLint rule `no-ledger-update` blocks any `db.ledgerEntry.update()` / `db.ledgerEntry.delete()` / `db.ledgerEntry.deleteMany()` call.

**Tension & Resolution.** Tensions P1 when a tutor demands "just let me fix the number" — P4 wins; the ledger protects the tutor from their own mistake. This is the canonical P1↔P4 conflict, resolved in P4's favour because long-term correctness outweighs short-term convenience. Tensions P9 — aligned, not in conflict.

**Example.** A tutor enters ₹4,500 instead of ₹5,400. P4 → no "edit" button. Flow: void RCP-000042 (PIN, audit) → record ₹5,400 → new receipt RCP-000043. The void remains forever, transparently. Spec: `07_Fees_and_Payments.md §9`, `12_Business_Rules.md BR-LED-03`.

---

## Principle 5 — Offline-First, Always

> **Statement:** The app's happy path is **no network**. Marking attendance, recording a cash payment, viewing a student's ledger — all must work with the device in airplane mode. The network is a *replication transport*, not a request dependency.

**Why.** Indian tutors teach in basements with no signal, in apartments with patchy Wi-Fi, on Metro commutes. A cloud-dependent app is a register book that only opens when the cloud is in a good mood.

**Consequences.** No spinner that blocks on a remote call for primary data. No "Loading…" skeleton that never resolves. Local SQLite is the source of truth at interaction time; Turso Cloud is the replica. Every write goes to `sync_outbox` first; the cloud is informed when possible. Read paths never `await` a network call on the critical render.

**Enforcement.** E2E: Playwright `context.setOffline(true)` then exercises all five screens' primary flows; any `await fetch` to a Turso endpoint on the critical path fails the test. Code review: a React component rendering primary data may not call `useQuery` against a remote API; it must read from the local Drizzle mirror.

**Tension & Resolution.** Tensions P14 when a parent's signed URL must be served — the URL is generated locally; only the parent's *consumption* is cloud-side and out of Buddysaradhi's offline contract. Tensions P10 — aligned; backups are local files.

**Example.** Tutor on a train records 12 attendance marks + 3 UPI payments offline. P5 → all 15 writes land in local SQLite + `sync_outbox` immediately; UI shows "Offline · 15 pending". On reconnect, outbox flushes FIFO; ledger entries (UUID-keyed) merge without conflict. Spec: `02_Core_Logic.md §Sync Engine`, `14_Edge_Cases.md EC-SY-01`.

---

## Principle 6 — Defaults Are Sacred

> **Statement:** Every setting ships with the value a competent tutor would choose. A new user should be able to onboard with **zero settings changes** and have a working business. Settings are for *refinement*, never for *activation*.

**Why.** A settings page is a confession that the team could not decide. Every required setting is a tax on the 80% of tutors who would have chosen the same answer anyway.

**Consequences.** Default fee model = postpaid monthly. Default invoice prefix = `INV-`. Default receipt prefix = `RCP-`. Default attendance window = same-day, unlockable for 48h. Default currency = ₹ (INR), locale-detected. Default lock timeout = 5 min. No "configuration wizard" — the app boots into a working state.

**Enforcement.** Code review: every new setting in `08_Settings.md` must propose a default and justify why it is not a code constant. Test: a fresh install with zero settings mutations passes the "Day One Smoke Test" — add 1 student, mark 1 attendance, record 1 payment, generate 1 receipt.

**Tension & Resolution.** Tensions P1 when a tutor *wants* a different default — P6 does not prevent override; it only forbids *requiring* configuration. Tensions P12 — aligned.

**Example.** A new tutor in Pune signs up; locale auto-detects `INR` + `en-IN`. The first fee uses postpaid monthly, INR, INV- prefix. They never open Settings. P6 → success. Spec: `08_Settings.md §5`.

---

## Principle 7 — Motion Is Meaning, Not Decoration

> **Statement:** Animation in Buddysaradhi communicates state change. A payment lands and the balance card physically settles. Attendance locks and the toggle compresses with a tactile thunk. We do not animate to delight; we animate to **confirm**.

**Why.** Decorative animation is a tax on attention. A 400ms fade-in delays first paint and tells the user nothing. Meaningful animation is the closest a screen gets to physical feedback: the system *moved* in response, so the user knows the action landed.

**Consequences.** No carousel auto-rotation. No parallax on scroll. No enter-animation that delays first paint by more than 16ms. Count-up animations run only when the underlying value actually changed. Reduced-motion preference collapses all springs to 120ms fades (`14_Edge_Cases.md EC-UI-04`).

**Enforcement.** Lint: Framer Motion components without `layout` or `animate` keyed to a state change are flagged. Performance budget: FCP < 1.2s on mid-tier Android (Redmi Note 12). Playwright asserts no `transition` CSS on `body` or top-level layout containers.

**Tension & Resolution.** Tensions P8 when motion competes with dense data — motion is reserved for state-change moments, never ambient; dense tables stay still. Tensions P13 when an exotic animation library is proposed — P13 wins; Framer Motion only.

**Example.** A designer proposes an aurora-blob background on the Fees screen for "visual interest." P7 → reject; ambient motion is decoration. Aurora blobs are reserved for the marketing landing page (`/`), not the product. Spec: `13_UI_Guidelines.md §7` (Motion Principles — the `aurora-drift` token in §7.3 is the only ambient motion permitted, and only on the hero per the marketing-surface carve-out in §19).

---

## Principle 8 — Density Without Clutter

> **Statement.** Kite-density tables are welcome — 12 columns, 40 rows visible — **if and only if** every column earns its pixels. A column that 90% of tutors never sort or filter by is removed to a detail drawer.

**Why.** Tutors scan, they do not read. A 6-column table with the right six columns beats a 20-column table where the right six are buried. Density is a virtue only when every pixel is load-bearing.

**Consequences.** The default Student table shows 6 columns. The other 20+ fields live in a per-row expandable detail panel. Column visibility is configurable per tutor, but the default is curated, not maximalist. Empty columns (no data) are auto-hidden.

**Enforcement.** Design review: any new column added to a default table view must justify its presence against telemetry-free usage data (manual test cohorts). Code review: default column sets live in `defaultColumns.ts` with comments citing the spec section that permits each.

**Tension & Resolution.** Tensions P3 when removing a column to a drawer adds a tap — P3 wins for primary actions, P8 wins for ancillary fields; the drawer is one tap. Tensions P9 — receipts are dense artefacts by design, P8 yields.

**Example.** Proposal: "Show WhatsApp, parent, sibling count, fee plan, last payment, attendance %, balance, status, admission date, code, grade, batch." P8 → reject as default. Default shows: Code, Name, Batch, Balance Due, Status, Last Payment. The rest live in the drawer. Spec: `05_Students.md §6`.

---

## Principle 9 — Receipts Are Sacred Artefacts

> **Statement:** A receipt, once generated, is **immutable and numbered**. It can be voided (with a reversing ledger entry) but never silently edited. Parents will print, screenshot, and forward these for years. They must look professional and never contradict the ledger.

**Why.** A receipt is the only Buddysaradhi artefact that leaves the tutor's device and enters a parent's phone, a school's file, a tax filing. Its integrity is the tutor's professional reputation.

**Consequences.** Invoice numbers are monotonic, gap-tolerant, never reused (`BR-RC-01`). Receipts carry the tutor's name, address, contact, and a tamper-evident hash (`BR-FEE-05`). Voided receipts are stamped "VOID" but never deleted; their numbers are never recycled. Receipt PDFs are generated locally.

**Enforcement.** Schema: `receipts.number` has `UNIQUE(tenant_id, number)`. CI test: voiding receipt N and generating a new receipt yields N+1, never N. Tampering a receipt row triggers `receipt_tamper_detected` on next view (`14_Edge_Cases.md EC-SEC-03`).

**Tension & Resolution.** Tensions P4 — fully aligned. Tensions P5 when receipt PDF rendering wants a server — P5 wins; rendering is local via `pdf-lib`.

**Example.** A tutor asks: "Can I edit receipt RCP-000042 to change the method from cash to UPI?" P9 → no. Void it (PIN, audit), generate RCP-000043 with method=UPI. The voided RCP-000042 stays as a transparent reversal. Spec: `07_Fees_and_Payments.md §12`, `12_Business_Rules.md BR-RC`.

---

## Principle 10 — Backups Are the User's Property

> **Statement:** A tutor's data belongs to the tutor. A backup is a **single encrypted file** the user can download, email to themselves, put on a pendrive, and restore on any device. We never hold backups hostage to a subscription.

**Why.** Vendor lock-in via data hostage is the original sin of edtech SaaS. A tutor who cannot leave cannot negotiate, cannot migrate, cannot trust. Portable backups are how Buddysaradhi earns the right to be the *default* tool.

**Consequences.** No "export is premium" dark pattern. Excel export (3 worksheets per `BR-BAT-03`) is always one tap away. The backup file format (`.buddysaradhi`, gzipped tar + AES-256-GCM per `BR-BAT-01`) is documented and stable across versions. Backups are never uploaded to Buddysaradhi servers; the cloud copy is the user's own Turso DB.

**Enforcement.** Code review: no code path uploads `.buddysaradhi` files to a Buddysaradhi-controlled endpoint. CI: Excel export works on a fresh install with zero students (`EC-IE-04`). Test: a backup made on v1.0 restores on v1.3 without data loss.

**Tension & Resolution.** Tensions P11 when export wants a PIN — P11 wins; full backup export requires typed "EXPORT" confirm (`BR-SEC-04`), frictional by design. Tensions P12 — export is rare enough that friction is acceptable.

**Example.** A tutor on the free tier asks for an Excel export of all payments. P10 → always allowed, one tap (Fees → Export → Excel). The free-vs-paid distinction lives in engine scale (Reminder Engine volume, Report Engine depth), never in export. Spec: `09_Backup_and_Import_Export.md §4`.

---

## Principle 11 — Security Is Tactile, Not Theatrical

> **Statement:** We do not show padlock icons and trust badges. We make security *felt*: a fingerprint prompt to unlock attendance, a PIN to void a receipt, a 5-second haptic confirm on bulk delete. Security that the user physically performs is security they trust.

**Why.** "Are you sure?" dialogs are muscle-memoried to "Yes" inside a week. Tactile security — biometrics, PIN, typed confirmation — forces a moment of intent that no accidental click can satisfy. The friction *is* the protection.

**Consequences.** Biometrics are the default lock for sensitive mutations, with PIN as fallback. Void receipt, unlock attendance, backdated ledger entry, bulk delete, and full export all require PIN *even if the app is already unlocked* (defence-in-depth, `BR-SEC-02`). No triple-confirmation dialogs; one tactile step suffices.

**Enforcement.** Code review: every mutation in the sensitive-mutations list (`BR-SEC-02`) routes through `requirePin()` middleware. Test: attempting a sensitive mutation without PIN throws `PinRequiredError`. Biometric fallback: 3 FaceID fails auto-fallback to PIN (`EC-SEC-02`).

**Tension & Resolution.** Tensions P3 when tactile security adds taps — P11 wins for sensitive actions only; the two-tap count is measured to flow *entry*, not through the PIN prompt. Tensions P12 — tactile friction is intentional and bounded; it cannot grow without an amendment.

**Example.** A tutor voids a receipt. Flow: tap "Void" (1) → PIN prompt → audit log → receipt stamped VOID. The PIN is the security; no "Are you really sure?" follows. Spec: `10_Security.md §3`, `12_Business_Rules.md BR-SEC-02`.

---

## Principle 12 — The Tutor's Time Is the Metric

> **Statement:** Every feature is measured against the north-star: **minutes per day inside Buddysaradhi**. A feature that adds capability but raises this number is rejected. A feature that removes a manual step and lowers this number is accepted even if it is "boring."

**Why.** Buddysaradhi is a tool, not a destination. A tutor who spends 40 minutes a day inside it is a tutor who will eventually stop opening it. The product wins by becoming invisible.

**Consequences.** We ship "auto-remind unpaid students whose batch meets tomorrow" before "custom receipt logo upload," because the former lowers minutes-per-day and the latter raises it. Feature requests are scored on a minutes-per-day delta. Net-neutral-on-time / net-positive-on-delight features are deferred; net-negative-on-time features are rejected outright.

**Enforcement.** Design review: every feature proposal must include a minutes-per-day estimate (positive = saves time, negative = costs time). Negative estimates require an explicit P12 override citing which other principle justifies the cost. The Decision Protocol bakes this in as question #3.

**Tension & Resolution.** Tensions P1 — usually aligned. Tensions P2 when consolidation adds clicks — P2 wins; the click cost is bounded, the navigation cost of a sixth screen is unbounded. Tensions P11 — friction is intentional and P11 governs; P12 does not override security friction.

**Example.** Request: "Custom receipt logo upload." P12 → raises minutes-per-day for a delight gain. Rejected for v1; routed to `15_Future_Roadmap.md §v1.x`. Counter-example: "Auto-snooze reminders when a payment lands." P12 → lowers minutes-per-day. Accepted for v1. Spec: `02_Core_Logic.md §Reminder Engine`.

---

## Principle 13 — Boring Technology, Radical Polish

> **Statement:** The stack is deliberately unexotic: Next.js, Expo, Tauri, Turso, Supabase. We spend our innovation budget on **the seams** — the sync engine, the ledger integrity, the 120fps motion, the receipt typography — not on reinventing the framework.

**Why.** Every exotic dependency is a future maintenance tax. The competitive moat of Buddysaradhi is not a clever framework; it is the discipline of doing the boring things *perfectly*. Kite's moat was not React; it was the order book's pixel density. Ours is the ledger's integrity.

**Consequences.** No experimental database. No bespoke state library. No CSS-in-JS reinvention. Tailwind + shadcn + Framer Motion, end of story. New dependencies require a "boring justification" in the PR description. Innovation budget goes to: sync conflict resolution, ledger triggers, receipt PDF fidelity, offline search indexing.

**Enforcement.** CI: `bun audit` + a dependency-review action flagging any dependency with < 10k GitHub stars or < 1 year of maintenance. Code review: PRs introducing a new state library, ORM, or styling system are auto-rejected with a link to this section.

**Tension & Resolution.** Tensions P7 when a shinier animation library is tempting — P13 wins; Framer Motion is sufficient. Tensions P5 when an exotic CRDT library is proposed — P13 wins; UUID-keyed append-only ledger + LWW is sufficient (`BR-SYN-01`, `BR-SYN-02`).

**Example.** An engineer proposes adopting Yjs for "better conflict resolution." P13 → reject. The ledger is conflict-immune by UUID append-only design; non-ledger rows use LWW + vector clocks. Spec: `02_Core_Logic.md §Sync Engine`, `11_Data_Model.md §5`.

---

## Principle 14 — The Parent Is a Guest, Not a User

> **Statement:** A parent sees a **read-only receipt and statement**. They do not have an account in v1. The tutor shares a signed link. This keeps the trust boundary clean: the tutor owns the data; the parent consumes a derived artefact.

**Why.** Parent accounts mean parent auth, parent support tickets, parent password resets, parent data ownership disputes. A signed URL is a complete trust model: time-bounded read access to a single artefact without inviting the parent into the system.

**Consequences.** No parent auth flow in v1. No parent app. No parent login. A signed, time-limited URL (7-day TTL per `BR-RC-03`) is the entire parent surface. The URL carries a HMAC the parent cannot forge; the artefact is rendered cloud-side from the immutable ledger.

**Enforcement.** Schema lint: no `parents` table with an auth column. Code review: no parent-facing route under `src/app/parent/` requiring login. Test: signed URL with expired TTL returns 410 Gone; tampered HMAC returns 403.

**Tension & Resolution.** Tensions P1 — fully aligned; the tutor is the only user. Tensions P5 — the parent's URL is cloud-side by nature (parents do not have the tutor's local DB); this is an explicit, bounded exception documented in `10_Security.md §6`.

**Example.** A parent asks: "Can I log in and see all my child's receipts?" P14 → no. The tutor shares a signed URL for the latest receipt or a monthly statement PDF. A parent portal is on `15_Future_Roadmap.md §v2.x` and requires its own principle amendment. Spec: `10_Security.md §6`, `07_Fees_and_Payments.md §13`.

---

## Principle 15 — Honest Empty States

> **Statement:** An empty screen is a **teaching moment**, not a void. "No students yet — add your first in 20 seconds" with a single primary button beats a blank grid. Every empty state explains *why* it's empty and *what to do next*.

**Why.** A blank screen is a product failure: it tells the user the app is broken or indifferent. A teaching empty state converts confusion into action.

**Consequences.** Zero states are designed, not accidental. Each of the five screens has a dedicated empty-state composition: copy, primary CTA, and a one-line explanation of what the screen *will* do once populated. Empty states never show chrome that has no function (no empty filter bars inside an already-empty screen).

**Enforcement.** Design review: every screen ships its empty-state design in the same PR as the screen itself. Test: a fresh install with zero data renders the empty state, not a blank grid, on all five screens. Lint: list components must declare an `emptyState` prop or default.

**Tension & Resolution.** Tensions P8 — empty states are exempt from density rules; their job is to teach, not to scan. Tensions P12 — aligned; a teaching empty state saves future time.

**Example.** A new tutor opens the Fees screen for the first time. P15 → "No fees recorded yet. Add your first student, then record their first payment — it takes 20 seconds." Primary button: "Add Student". No blank table, no spinner. Spec: `07_Fees_and_Payments.md §11`, `13_UI_Guidelines.md §15` (Empty States, Loading, Toasts, Confirmations).

---

## Decision Protocol

When proposing a new feature or change, an engineer or agent must answer, in writing, in the PR description:

1. **Which principle does this serve?** (must name ≥ 1; e.g. "P12 — lowers minutes-per-day by auto-dismissing reminders on payment")
2. **Which principle does this tension?** (must name any it strains; "P11 — adds a tap for the PIN prompt")
3. **Does it lower minutes-per-day?** (yes/no, with reasoning)
4. **Does it fit in one of the five screens?** (name which; if not, defer to `15_Future_Roadmap.md`)
5. **Is it reversible?** (reversible = ship; irreversible = requires spec amendment per §Amendment Process below)

If the answer to #3 is "raises it" and #4 is "needs a sixth screen," the feature is **rejected by default** and routed to `15_Future_Roadmap.md`. A PR merged without all five answers is a process violation and is reverted.

---

## Principle Amendment Process

Principles are not immutable — but they are deliberately hard to change. The process prevents reactive amendments.

1. **RFC.** Any team member or agent opens an RFC in `Buddysaradhi_Planning/rfc/` proposing the amendment: principle text, motivation, principles it tensions, and at least one concrete scenario where the current principle produces a wrong outcome.
2. **Two-week cooling-off.** The RFC sits open for at least 14 calendar days. Anyone may comment, propose counter-amendments, or cite edge cases from `14_Edge_Cases.md`. No merge is permitted during cooling-off regardless of apparent consensus.
3. **Ratification.** After cooling-off, the RFC requires sign-off from (a) the project lead, (b) the author of the most-affected sibling spec, and (c) one reviewer who did not author the RFC. The principle text is updated in this file; the RFC moves to `rfc/ratified/` with a permanent ID.
4. **Principle debt.** A principle may be amended *with a debt clause*: "P4 applies fully to ledger entries created after 2025-06-01; legacy entries are grandfathered." Debt is tracked in `Buddysaradhi_Planning/principle_debt.md` with an expiry date. Expired debt becomes a P0 bug.
5. **Rejection.** An amendment is rejected if (a) it weakens a lower-numbered principle, (b) it cannot cite a real scenario from production or `14_Edge_Cases.md`, or (c) cooling-off surfaced a counter-example the RFC cannot answer. Rejected RFCs are archived in `rfc/rejected/` with the reason, so future proposers can see prior art.

> **Anti-pattern.** "Let's just amend P2 to add a sixth screen for this one feature." P2 amendments require a graduation-criteria review per `15_Future_Roadmap.md §v2.0`.

---

## Principle Conflicts Matrix

The most common tensions and their default resolutions. When a conflict is not listed here, the **lower-numbered principle wins**.

| Conflict | Default Resolution | Rationale |
|---|---|---|
| P1 (Tutor Is User) vs P4 (Ledger Immutable) | **P4 wins.** | Ledger protects tutor from their own mistakes. |
| P2 (Five Screens) vs P1 (Tutor Is User) | **P2 wins.** | A sixth-screen ask is a feature ask; feature fits inside existing screen. |
| P2 (Five Screens) vs P3 (Two-Tap) | **P2 wins.** | Two-tap satisfied via sidebar + panel; sixth screen never the answer. |
| P3 (Two-Tap) vs P11 (Tactile Security) | **P11 wins for sensitive mutations.** | Two-tap count measured to flow entry; PIN is intentional friction. |
| P3 (Two-Tap) vs P8 (Density) | **P3 for actions; P8 for fields.** | Primary actions stay two taps; ancillary fields move to a one-tap drawer. |
| P5 (Offline-First) vs P14 (Parent Guest) | **P5 wins for tutor surfaces.** | Parents have no local DB; their artefact is cloud-rendered by necessity. |
| P6 (Defaults Sacred) vs P1 (Tutor Is User) | **P6 wins; override always available.** | Defaults are curated, not mandatory. |
| P7 (Motion) vs P8 (Density) | **P8 for tables; P7 for state-change only.** | Dense tables stay still; motion reserved for confirmation. |
| P7 (Motion) vs P13 (Boring Tech) | **P13 wins.** | Framer Motion only. |
| P10 (Backups) vs P11 (Tactile Security) | **P11 wins for full backups.** | Full export requires typed "EXPORT" confirm; Excel export does not. |
| P11 (Tactile Security) vs P12 (Tutor's Time) | **P11 wins.** | Friction is the protection. |
| P12 (Tutor's Time) vs P2 (Five Screens) | **P2 wins.** | Navigation cost of a sixth screen is unbounded. |
| P13 (Boring Tech) vs P5 (Offline-First) | **P13 wins.** | UUID append-only ledger + LWW beats exotic CRDT libraries. |

---

## Anti-Principles — What Buddysaradhi Will Never Do

Each anti-principle is forbidden by a specific product principle. The list is exhaustive: a future capability that would violate any of these is out of scope.

| # | Anti-Principle | Forbidden By | Why |
|---|---|---|---|
| AP-1 | **Dark patterns** — no "cancel subscription" guilt screens, no pre-checked upsells. | P1, P12 | The tutor's time and trust are the product. |
| AP-2 | **Engagement-maximising notifications** — no "you haven't opened Buddysaradhi in 3 days!" push, no streaks. | P12, P7 | Buddysaradhi is a tool, not a slot machine. |
| AP-3 | **Data selling or sharing** — no resale, no ad SDKs, no analytics that leave the device. | P5, `00_Vision.md §11` | The tutor's data is the tutor's. |
| AP-4 | **Forced social features** — no leaderboards, no public rankings, no "share your attendance %" prompts. | P1, P14 | The tutor is the only user. |
| AP-5 | **AI that writes itself into the ledger without audit** — AI may *suggest* but never *commit*. | P4, `BR-LED-02` | Unaudited AI writing to the ledger is a spine surgeon with no oversight. |
| AP-6 | **Indigo or blue as primary accent.** The cosmic Indigo → Midnight Violet canvas is the neutral night sky, not a brand accent. Accents: Bioluminescent Emerald `#00FF9D`, Neon Cyan `#00F0FF`, Solar Flare `#FF5E00`, Amber `#FFB300`, Violet `#B388FF`. Lint rule `no-indigo-accent` blocks Tailwind `indigo-*`/`blue-*` on accent roles. | P7, `13_UI_Guidelines.md §2` | Indigo/blue read as "default tech app"; the bioluminescent palette is Buddysaradhi's signature. |
| AP-7 | **Vendor lock-in via data hostage** — no "export is premium," no proprietary backup format. | P10 | The tutor stays because the product is better, not because the data is trapped. |
| AP-8 | **Student or parent accounts in v1.** | P1, P14 | Trust boundary is tutor-side; guests consume signed artefacts. |
| AP-9 | **A sixth top-level screen.** | P2 | Five is the spatial-memory ceiling. |
| AP-10 | **Telemetry that leaves the device.** No Sentry, no Mixpanel, no PostHog cloud. Crash logs stay local. | P5, `00_Vision.md §11` | The tutor's workflow is not our dataset. |
| AP-11 | **Reusing a voided invoice or receipt number.** | P9, `BR-RC-01` | Numbers are monotonic, gap-tolerant, never recycled. |
| AP-12 | **An unaudited mutation of a locked period.** | P4, P11, `BR-LED-05` | Backdated entries require PIN + audit log; no exceptions. |
| AP-13 | **A mutation that skips the `sync_outbox` + `audit_log` write.** Every INSERT/UPDATE/DELETE on a business table must, in the same transaction, append a `sync_outbox` row and an `audit_log` row. | P4, Rule 7, `BR-SYN-02`, `BR-SEC-06` | An unaudited mutation is a silent ledger break. The outbox is the replication contract; the audit log is the trust contract. |
| AP-14 | **Color as the only status signal.** Status (paid/unpaid, present/absent, synced/stale) must carry a text label, icon, or shape in addition to colour. | P7, Rule 10, WCAG 2.1 AA | 8% of male tutors have some colour-vision deficiency. A red badge that says "OVERDUE" works; a red badge alone fails. |
| AP-15 | **A modal stack deeper than 2 levels.** | P2, `13_UI_Guidelines.md §8.7` | Nested modals lose the user's spatial context. The 5-screen doctrine implies flat navigation; a modal-within-a-modal is a 6th screen in disguise. |
| AP-16 | **A settings option without a sensible default.** Every toggle, dropdown, and input must ship with a default that works for 80% of tutors. | P12, P15 | A settings page that demands configuration before first use is a 6th screen. Honest empty states (P15) start with working defaults. |
| AP-17 | **A number input that accepts float paise.** Money fields parse to `INTEGER` paise. The UI may show ₹ with decimals; the data layer never stores a float. | Rule 6, `BR-FEE-01`, `BR-M-01` | Float math on money produces rounding drift. ₹1,24,500.00 stored as `124500.00` will eventually become `124499.99999`. |
| AP-18 | **A "Loading…" spinner with no timeout or progress.** Async operations must show either a progress bar (if duration is known) or a timeout-and-retry affordance (if unknown). | P12, `14_Edge_Cases.md` EC-UI-01 | A spinner that never resolves is a deadlock the user cannot escape. |
| AP-19 | **A feature flag left on in production.** Feature flags must have a sunset date and an owner. A flag still on 30 days after launch is either permanent (delete the flag) or forgotten (delete the feature). | P12, `15_Future_Roadmap.md` | Dead flags are dead weight. They make the codebase harder to reason about and create invisible behavior forks. |
| AP-20 | **Motion that ignores `prefers-reduced-motion`.** Every animation, transition, and micro-interaction must check `prefers-reduced-motion: reduce` and degrade to an instant state change. | Rule 10, P7, WCAG 2.1 AA | Vestibular disorders make non-essential motion physically painful. The user's OS setting is the contract. |

---

## Principles in Practice — Case Studies

Six worked examples of a feature request evaluated against the principles. Each follows the Decision Protocol.

### Case Study 1 — "Add a WhatsApp auto-messenger that sends reminders to parents"

**Serves:** P12 (no manual WhatsApp drafting). **Tensions:** P2 (wants a sixth "Communications" screen), P14 (parent contact handling), AP-10 (WhatsApp Cloud API uploads contacts to Meta).
**Resolution: Reshape, not reject.** No sixth screen, no parent accounts. The request becomes: (a) a Reminder Engine template system (`02_Core_Logic.md §Reminder Engine`) that generates message *text* the tutor copies, (b) a per-student `wa.me/<phone>?text=<encoded>` deep link on the Students screen, (c) the tutor taps "Send" in WhatsApp themselves. No data leaves the device to Meta. P12 honoured; P2, P14, AP-4, AP-10 intact.

### Case Study 2 — "Cloud AI that auto-categorises expenses by merchant"

**Serves:** P12. **Tensions:** AP-3 (data leaves device to a cloud LLM), AP-10 (telemetry), P5 (would fail offline).
**Resolution: Reject as proposed; reshape to on-device rule engine.** The tutor defines rules ("if description contains 'stationery' → category 'Materials'"). Rules run locally, offline, no data egress. The UI is a panel inside the Fees screen. Spec: `07_Fees_and_Payments.md §15`.

### Case Study 3 — "Let me edit a payment amount in place if it's within 5 minutes of creation"

**Serves:** P12 (saves void-and-re-record friction). **Tensions:** P4 (directly violated), P9 (receipt already generated).
**Resolution: Reject.** P4 is non-negotiable; the "5-minute window" is a slippery slope to "always editable." The void flow (P11 PIN + audit + new receipt) is the correct path. The friction is *intentional*. Spec: `12_Business_Rules.md BR-LED-03`.

### Case Study 4 — "Add a parent portal where parents can log in and see all their child's history"

**Serves:** P12 (reduces "share this receipt" requests). **Tensions:** P14 (directly violated), P1 (parent becomes a user), AP-8.
**Resolution: Reject for v1; defer to `15_Future_Roadmap.md §v2.x`.** A parent portal requires its own P14 amendment and is a v2 consideration with multi-tutor institutes. v1 honours P14 with signed URLs.

### Case Study 5 — "Auto-lock attendance after 48 hours, even if the tutor hasn't marked it"

**Serves:** P11 (prevents backdated fabrication), P4 (audit integrity). **Tensions:** P1 (overrides tutor intent), P12 (forces re-marking via unlock flow).
**Resolution: Accept, with carve-out.** Auto-lock at 48h is the default (`BR-ATT-03`); the unlock flow (PIN + audit) preserves tutor sovereignty. P1 honoured because the tutor *can* unlock; P11/P4 honoured because every unlock is audited.

### Case Study 6 — "Replace the sidebar with a bottom tab bar on mobile"

**Serves:** P3 (bottom bar is thumb-reachable). **Tensions:** P2 (wants a "+" central tab = sixth surface), P13 (bespoke mobile nav).
**Resolution: Accept the bottom bar; reject the central "+".** Five tabs for five screens; the global "+" lives in the command palette and per-screen primary buttons. P3 honoured; P2, P13 intact. Spec: `13_UI_Guidelines.md §8.6` (Tab Bar).

---

## The Principle Hierarchy Diagram

Principles are not flat — some are load-bearing walls, others are interior partitions. The diagram shows the dependency graph: principles in upper layers depend on the ones below.

```
                    [OPERATIONAL LAYER]
        ┌──────────────────────────────────────────┐
        │  P10 Backups   P11 Tactile   P12 Time    │
        │  P13 Boring Tech                          │
        └──────────────────────────────────────────┘
                              │ depends on
                              ▼
                     [SURFACE LAYER]
        ┌──────────────────────────────────────────┐
        │  P7 Motion   P8 Density   P9 Receipts    │
        │  P15 Honest Empty States                 │
        └──────────────────────────────────────────┘
                              │ depends on
                              ▼
                    [STRUCTURAL LAYER]
        ┌──────────────────────────────────────────┐
        │  P2 Five Screens   P3 Two-Tap            │
        │  P6 Defaults       P14 Parent Guest      │
        └──────────────────────────────────────────┘
                              │ depends on
                              ▼
                    [FOUNDATIONAL LAYER]
        ┌──────────────────────────────────────────┐
        │  P1 Tutor Is User   P4 Immutable Ledger  │
        │  P5 Offline-First                        │
        └──────────────────────────────────────────┘
```

**Reading the diagram.** The foundational layer (P1, P4, P5) is the load-bearing wall. If P4 falls — if the ledger becomes mutable — every principle above it is hypocrisy: receipts cannot be sacred (P9) if the ledger is editable, audit is theatre (P11), and the tutor's time (P12) is spent chasing phantom balances. Amendments to surface or operational layers are low-risk; structural layers require full RFC; foundational layers require a v2.0 release.

---

## How Principles Map to Code

Every principle has a concrete enforcement point. If a principle cannot be mapped to a file, it is unenforceable and must be amended or removed.

| Principle | Enforcement File / Module / Spec |
|---|---|
| **P1** Tutor Is User | `05_Students.md §2`; schema lint `principles/no-student-auth.py`. |
| **P2** Five Screens | `src/app/` route table (5 routes); `SidebarNav.tsx` literal-typed to 5; CI `principles/route-count.test.ts`. |
| **P3** Two-Tap Rule | `src/components/CommandPalette.tsx` (global ⌘K); `03_User_Flows.md §Flow 1-15`; Playwright E2E. |
| **P4** Immutable Ledger | `db/schema.ts` `ledger_entries`; trigger `ledger_immutable_guard` (`11_Data_Model.md §5`); ESLint `no-ledger-update`; `BR-LED-01/L02`. |
| **P5** Offline-First | `src/lib/sync/outbox.ts`; `02_Core_Logic.md §Sync Engine`; Drizzle local mirror; Playwright offline E2E. |
| **P6** Defaults Sacred | `src/lib/config/defaults.ts`; `08_Settings.md §5`; Day One Smoke Test. |
| **P7** Motion Is Meaning | `src/components/primitives/CountUp.tsx`; `13_UI_Guidelines.md §7`; Framer Motion lint; `globals.css` `prefers-reduced-motion`. |
| **P8** Density Without Clutter | `src/components/students/StudentsTable.tsx` (6-column default); `defaultColumns.ts`; `05_Students.md §6`. |
| **P9** Receipts Sacred | `db/schema.ts` `receipts` (UNIQUE number); `BR-RC-01/RC02/RC03`; `07_Fees_and_Payments.md §12`; `src/lib/receipts/hash.ts`. |
| **P10** Backups Property | `src/lib/backup/export.ts`; `09_Backup_and_Import_Export.md §4`; `BR-BAT-01/B02/B03`; no-upload lint. |
| **P11** Tactile Security | `src/middleware/requirePin.ts`; `10_Security.md §3`; `BR-SEC-02`; sensitive-mutations list. |
| **P12** Tutor's Time | Decision Protocol Q3 (PR template); `02_Core_Logic.md §Reminder Engine`; minutes-per-day estimate. |
| **P13** Boring Tech | `package.json`; `bun audit`; dependency-review CI; PR template "boring justification" field. |
| **P14** Parent Guest | `src/app/share/[token]/route.ts`; `10_Security.md §6`; `BR-RC-03`; schema lint (no parents auth table). |
| **P15** Honest Empty States | `src/components/EmptyState.tsx`; per-screen empty-state designs in `04-08_*.md`; list-component `emptyState` lint. |

---

## How Principles Reach the Market

The principles in this file are the **WHAT** and the **WHY** of Buddysaradhi. The commercial front door — the landing page at `buddysaradhi.in` — is the **HOW** those principles meet a tutor who has never heard of Buddysaradhi yet. Every sentence of copy, every section heading, every pricing tier, and every FAQ on the marketing surface is downstream of a principle here.

The mapping is explicit and audited:

| Principle | How it shows up on the marketing surface |
|-----------|------------------------------------------|
| **P1** Tutor Is User | Copy addresses the tutor directly — "your students, your ledger, your receipt" — never the student or the parent. |
| **P4** Immutable Ledger | The features showcase leads with "an append-only ledger you can audit" — not "easy fee tracking." |
| **P5** Offline-First | The hero names "works offline" as a primary claim, not a footnote. |
| **P10** Backups Are Property | The pricing table states "Excel export is free, forever" — not "premium." |
| **AP-2** No Engagement Push | The FAQ answers "Will you nag me to open the app?" with a direct "No." |
| **AP-6** No Indigo/Blue | The landing page itself uses the bioluminescent palette, not the SaaS-blue default. |
| **AP-10** No Telemetry | The privacy FAQ cites TELE-1 by name; the tour video is self-hosted on Vercel Blob, not YouTube. |

The full commercial spec lives in [`product/01_Product_Positioning.md`](product/01_Product_Positioning.md) — eleven files covering positioning, hero, features, the download hub, pricing, FAQ, CTA, testimonials, SEO, and the agent hand-off. Any marketing copy that cannot trace back to a principle in this file is a bug, not a campaign. The Decision Protocol (Q1–Q5) applies to marketing decisions the same way it applies to features: name the principle served, name the principle tensioned, and ship only when the tension is bounded.

---

## ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Principles doc. Principles are not screens — its mockups are **conflict matrices, mapping trees, and trust-boundary diagrams**, not UI layouts. Where a UI surface is mentioned, the glass tier (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) or neumorphic recipe (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) is annotated in the notes. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `BR-*`, `P*`, `AP-*`).

### Design System Reference — Principles

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces referenced by this doc | Tier | Cross-ref |
|---|---|---|
| Marketing hero card (principles → market) | `glass` with aurora behind | §5.5, `product/02 §2` |
| Marketing feature card (one per principle family) | `glass` + accent left-border | §5.4, `product/03 §3` |
| Marketing FAQ accordion row (anti-principles) | `glass-faint` band | §5.5, `product/06 §4` |
| Receipt PDF surface (P9 case study) | (print — `glass` does not apply; see §12.2 print stylesheet) | §12.2 |
| Modal dialog (typed-EXPORT confirm, AP-13) | `glass-strong` + backdrop `bg-black/60 + backdrop-blur-sm` | §5.5, §8.7 |

| Neumorphic controls referenced by this doc | Recipe | Cross-ref |
|---|---|---|
| Primary buttons on the marketing surface | `neumo-raised`; pressed = `neumo-pressed` | §6.6, §8.2 |
| Toggle for quiet-hours (P12, `08_Settings.md §5`) | `neumo-inset` well + raised knob | §6.4, §8.16 |
| Typed-confirmation input ("EXPORT", "VOID") | `neumo-inset` well + raised submit | §6.6, §8.9 |
| Command palette list row (decision-tree Q1–Q5) | flat `bg-cyan/10` (NOT neumorphic — list rows are glass-faint per §8.4) | §8.11 |

> **References:** Nielsen Norman Group — *Dark Patterns: Deception vs. Honesty in UI* (AP-1 lineage); Smashing Magazine — *Design Systems With Sketches And Wireframes*; Apple HIG — *Designing Across Platforms*; Material Design 3 — *Color Roles*; WCAG 2.1 AA §1.4.1 / §1.4.11 (AP-14 colour-not-only-signal); A List Apart — *Principles of Beautiful Typography* (P9 receipt typography).

### Mockup P1 — Principle-Conflict Resolution Matrix

```
PRINCIPLE-CONFLICT MATRIX — when two principles strain, which wins?
                              (from §Principle Conflicts Matrix above)
   ╔══════════════════════════════════════════════════════════════════════════════════╗
   ║  TENSION (P_x vs P_y)         │  WINNER            │  RATIONALE                     ║
   ╠══════════════════════════════════════════════════════════════════════════════════╣
   ║  P1 vs P4  (tutor vs ledger)  │  ● P4 wins         │  Ledger protects the tutor     ║
   ║                               │    (emerald)        │  from their own mistake         ║
   ║  P2 vs P1  (5-scrn vs tutor)  │  ● P2 wins         │  A 6th-screen ask is a feature  ║
   ║  P2 vs P3  (5-scrn vs 2-tap)  │  ● P2 wins         │  Sidebar + panel satisfies P3   ║
   ║  P3 vs P11 (2-tap vs tactile) │  ◐ P11 wins*       │  * sensitive mutations only     ║
   ║  P3 vs P8  (2-tap vs density) │  ◐ P3 actions /    │  Ancillary fields → 1-tap drawer ║
   ║                               │    P8 fields        │                                 ║
   ║  P5 vs P14 (offline vs parent)│  ● P5 wins (tutor)  │  Parent artefact is cloud-side  ║
   ║  P6 vs P1  (defaults vs tutor)│  ● P6 wins; override│  Defaults curated, not mandatory ║
   ║  P7 vs P8  (motion vs density)│  ◐ P8 tables /     │  Motion reserved for state      ║
   ║                               │    P7 state-change  │  confirmation                   ║
   ║  P7 vs P13 (motion vs boring) │  ● P13 wins        │  Framer Motion only (no exotic) ║
   ║  P10 vs P11 (backup vs tactile)│ ● P11 wins (full)  │  Excel export does NOT need PIN ║
   ║  P11 vs P12 (tactile vs time) │  ● P11 wins        │  Friction is the protection     ║
   ║  P12 vs P2  (time vs 5-scrn)  │  ● P2 wins         │  Nav cost of a 6th screen is    ║
   ║                               │                     │  unbounded                      ║
   ║  P13 vs P5  (boring vs offln) │  ● P13 wins        │  UUID append-only + LWW > CRDT  ║
   ╚══════════════════════════════════════════════════════════════════════════════════╝
        Legend:  ● P_x wins outright   ◐ winner is context-dependent (rule states when)
   ↑ accent dots are illustrative; the colour is NOT the only signal (AP-14) — every
     row's "WINNER" column also carries the principle ID as text + a shape (●/◐).
```

- ↑ **Foundational layer is unbreakable.** Conflicts touching P1, P4, or P5 always resolve in favour of the foundational layer (see Principle Hierarchy Diagram above) — these require a v2.0 release to amend.
- ↑ **Tactile friction is bounded (P11).** It cannot grow without an amendment; PIN adds at most one prompt, typed-confirm adds at most one keystroke sequence (AP-13).
- ↑ **AP-14 honoured in the legend.** Status is communicated by colour *and* shape *and* text — never colour alone (WCAG 2.1 AA §1.4.1).

### Mockup P2 — P1–P15 → AP-1–AP-20 Mapping Tree

```
PRINCIPLE → ANTI-PRINCIPLE MAPPING (prohibitions that enforce each principle)

   FOUNDATIONAL LAYER                       ← amendments require v2.0
   ┌────────────────────────────────────────────────────────────────────────────┐
   │  P1 Tutor Is User      ──┬── AP-1  dark patterns                          │
   │                          ├── AP-3  data selling                           │
   │                          ├── AP-4  forced social                          │
   │                          └── AP-8  student/parent accounts                │
   │                                                                            │
   │  P4 Immutable Ledger   ──┬── AP-5  unaudited AI ledger writes             │
   │                          ├── AP-11 reused receipt numbers                 │
   │                          ├── AP-12 unaudited locked-period mutation       │
   │                          ├── AP-13 mutation skipping sync_outbox/audit_log│
   │                          └── AP-17 float paise on money                   │
   │                                                                            │
   │  P5 Offline-First      ──┬── AP-3  data selling (cloud-side exfil)        │
   │                          └── AP-10 telemetry that leaves the device       │
   └────────────────────────────────────────────────────────────────────────────┘
                                   │
   STRUCTURAL LAYER                 ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │  P2 Five Screens       ──┬── AP-9  sixth top-level screen                  │
   │                          └── AP-15 modal stack deeper than 2              │
   │  P3 Two-Tap            ──── (no direct AP; bounded by P11 friction)        │
   │  P6 Defaults Sacred    ──┬── AP-16 settings option without sensible deflt │
   │  P14 Parent Guest      ──┬── AP-4  forced social                          │
   │                          └── AP-8  parent accounts in v1                  │
   └────────────────────────────────────────────────────────────────────────────┘
                                   │
   SURFACE LAYER                    ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │  P7 Motion Is Meaning  ──┬── AP-6  indigo/blue accent (signature)         │
   │                          ├── AP-14 colour-only status signal              │
   │                          └── AP-20 motion ignores reduced-motion         │
   │  P8 Density            ──── (no direct AP; bounded by P2/P3)              │
   │  P9 Receipts Sacred    ──┬── AP-11 reused receipt numbers                 │
   │  P15 Honest Empty State──┬── AP-16 no-default settings                    │
   │                          └── AP-18 spinner without timeout/retry          │
   └────────────────────────────────────────────────────────────────────────────┘
                                   │
   OPERATIONAL LAYER                ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │  P10 Backups Property  ──┬── AP-7  vendor lock-in via data hostage        │
   │  P11 Tactile Security  ──── (no direct AP; bounded by AP-12/AP-13)        │
   │  P12 Tutor's Time      ──┬── AP-2  engagement-maximising notifications    │
   │                          ├── AP-18 spinner without timeout/retry          │
   │                          └── AP-19 feature flag left on in production     │
   │  P13 Boring Tech       ──── (no direct AP; bounded by AP-6/P7)            │
   └────────────────────────────────────────────────────────────────────────────┘

   ↑ Foundational-layer P_x reach the most APs — the load-bearing wall has the most
     buttresses. Surface/operational P_x are bounded by their layer's discipline.
   ↑ Every AP has at least one parent P (verified by §How Principles Map to Code);
     orphan APs are a spec defect — file them.
```

- ↑ **Read top-down.** Foundational P1/P4/P5 produce the most anti-principles — that is the load-bearing wall being buttressed most heavily.
- ↑ **No orphan APs.** Every AP-1 through AP-20 must trace to ≥ 1 P; the table above is the canonical audit. A new AP without a parent P is a spec defect (§How Principles Map to Code).
- ↑ **AP-6 (no indigo/blue)** maps to P7 (motion is meaning) and to the §2 token system (`13_UI_Guidelines.md §2` — the `--accent-*` namespace contains no indigo/blue entry).

### Mockup P3 — "The Tutor Is the User" Trust-Boundary Diagram (P1)

```
TRUST BOUNDARY (P1) — who can read what, who can write what, who pays what cost

   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  TRUSTED PRINCIPAL: THE TUTOR  (Supabase auth user; 1 = 1 Turso DB)          │
   │                                                                              │
   │   · Reads: everything (5 screens + 7 engines)                                │
   │   · Writes: every business table (gated by PIN/biometric for sensitive ones) │
   │   · Pays the cost: time-in-app (the north-star, §14 — minimised)            │
   │   · Owns: the ledger, the receipts, the backup, the audit_log               │
   │                                                                              │
   │   ↑ sensitive mutations (AP-12, BR-LED-05)                                   │
   │     → biometric/PIN challenge (10_Security.md §3)                            │
   │     → typed "EXPORT"/"VOID" confirm (.neumo-inset input, §8.9)               │
   │                                                                              │
   │   ↑ non-sensitive reads                                                      │
   │     → no friction (Dashboard, Students list, Attendance grid)                │
   │     → two-tap rule (P3) measured to flow entry, not to PIN                   │
   └──────────────────────────────────┬───────────────────────────────────────────┘
                                      │ boundary 1: row ownership (no tenant_id
                                      │ in v1; one DB per tutor — §10.1 of 00_Vision)
                                      │ boundary 2: sync_outbox + audit_log
                                      │   (AP-13 — same transaction as the mutation)
                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  RECORD (not a principal): THE STUDENT                                       │
   │                                                                              │
   │   · Read by tutor only                                                       │
   │   · Never authenticates (AP-8 — no student accounts in v1)                   │
   │   · Has no opinion; the tutor's data model expresses the student's lifecycle │
   │   · Modifications go through the tutor's UI; every write is audit-logged     │
   └──────────────────────────────────┬───────────────────────────────────────────┘
                                      │ boundary 3: signed URL only (P14)
                                      │ HMAC, 7-day TTL, per-receipt
                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  GUEST (not a principal): THE PARENT                                         │
   │                                                                              │
   │   · Reads: ONE receipt/monthly statement via signed URL                      │
   │   · Writes: nothing                                                          │
   │   · Never logs in (AP-8)                                                     │
   │   · Cloud-rendered artefact (the only cloud-side read path in v1 — bounded   │
   │     exception documented in 10_Security.md §6)                               │
   │   · The tutor can revoke the URL from the Students screen at any time        │
   └──────────────────────────────────────────────────────────────────────────────┘

   ✕ The student is NOT a user (P1).
   ✕ The parent is NOT a user (P14).
   ✕ The vendor is NOT a principal (no telemetry, AP-10; no data hostage, AP-7).
   ↑ Only the tutor has an auth row in Supabase. The data model has no
     `student_user_id` or `parent_user_id` column in v1 (11_Data_Model.md §1).
```

- ↑ **P1 ↔ P14 boundary is the auth table.** Supabase auth has tutor rows only; student/parent are expressed as data, not as principals (`11_Data_Model.md` §1 — no `student_user_id` column).
- ↑ **AP-8 enforcement.** Lint rule `principles/no-student-auth.py` blocks any `student.auth_id` column from entering the schema (§How Principles Map to Code, P1 row).
- ↑ **The vendor's absence is a feature.** No telemetry, no analytics SDK, no remote feature flags exfiltrating user state (§11.3 of `00_Vision.md`).

### Mockup P4 — Decision Protocol Flowchart (Q1–Q5)

```
DECISION PROTOCOL — "Should I build feature X?" (§Decision Protocol above)

   START: feature X proposed
          │
          ▼
   ┌─ Q1. Which principle does this serve? ─────────────────────┐
   │   Must name ≥ 1 P_x (e.g. "P12 — lowers minutes-per-day") │
   └─────────────────────┬───────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        names ≥ 1 P              names 0 P
              │                     │
              │                     ▼
              │             ✕ REJECT — "no principle served"
              │               (re-write the proposal or park)
              ▼
   ┌─ Q2. Which principle does this tension? ──────────────────┐
   │   Must name any P_y it strains (e.g. "P11 — adds PIN tap")│
   └─────────────────────┬───────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        tension bounded         tension unbounded
        (per conflict matrix)   (no rule covers it)
              │                     │
              │                     ▼
              │             ✕ STOP — file an RFC to amend the
              │               conflict matrix first
              ▼
   ┌─ Q3. Does X lower minutes-per-day (the north-star)? ──────┐
   │   Run the feature through §14.2 of 00_Vision.md            │
   └─────────────────────┬───────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
            lowers                 raises
              │                     │
              │                     ▼
              │             ⚠ DEFER to vX.Y — only ship if a
              │               higher principle forces it (rare)
              ▼
   ┌─ Q4. Does X fit one of the 5 screens, or graduate? ───────┐
   │   Run §7.5 of 00_Vision.md (6th-screen decision matrix)    │
   └─────────────────────┬───────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
          fits a screen         passes all 4 criteria
              │                     │
              │                     ▼
              │             ⚠ AMEND — only "Team" has ever passed
              │               (v2.1, 15_Future_Roadmap.md)
              ▼
   ┌─ Q5. Is the boring-tech cost acceptable? ─────────────────┐
   │   No new framework; no new dependency; no new SaaS         │
   │   (P13 — boring technology, radical polish)                │
   └─────────────────────┬───────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
            yes                     no
              │                     │
              ▼                     ▼
        ✓ SHIP              ✕ REWRITE — boring-tech cost
        (file the BR/EC         must fall before shipping
         amendments in the
         same PR — AP-13)
   ↑ every ✓ SHIP must update 12_Business_Rules.md AND 14_Edge_Cases.md in the
     same PR (the spec contract — see closing note of 02_Core_Logic.md).
```

- ↑ **Q1 is a gate, not a filter.** Naming zero principles is a hard reject — even "delight" features must trace to P7 or P15.
- ↑ **Q3 is the north-star gate.** Features that raise minutes-per-day defer unless a higher principle forces them; this is unusual and must be documented in the PR.
- ↑ **Q5 is P13.** Boring tech is the floor; new dependencies require an RFC. The current boring stack: Next.js 16, Expo, Tauri 2, libSQL/Turso, Supabase auth, Drizzle ORM, Framer Motion, pdf-lib.

---

## Glossary of Principle Terms

- **Sovereign (P1).** The tutor is the sole authority over their data and workflow. No student, parent, or vendor overrides the tutor's intent — except where the ledger's immutability overrides the tutor's *mistake* (P4).
- **Ledger (P4).** The append-only `ledger_entries` table; the single source of financial truth. Every balance, due, and report is a derived view. The spine of the system.
- **Immutable (P4, P9).** A row, once written, cannot be UPDATEd or DELETEd. Correction is via a new row that *reverses* the original (`VOID`, `BR-LED-03`). Enforced at the SQLite trigger level.
- **Single-tenant (P5).** One Turso database per tutor (or per institute). No shared multi-tenant DB where one tenant's query can slow another.
- **Doctrine (this file).** The principles, decision protocol, amendment process, and anti-principles that govern Buddysaradhi. The doctrine is the constitution; the specs are the statutes.
- **Engine (`02_Core_Logic.md`).** A hidden subsystem that powers a surface the tutor sees. The seven engines: Search, Reminder, Ledger, Report, Notification, Sync, Security. No top-level screen (P2).
- **Tactile (P11).** Security performed by the user's body: fingerprint, PIN, typed confirmation. The friction *is* the protection. Contrast with *theatrical* security (padlock icons) which the user does not perform.
- **Two-tap (P3).** A primary action is reachable in ≤2 taps from any screen. Taps are counted to the *entry* of the flow; PIN prompts (P11) do not count against the rule.
- **Five screens (P2).** Dashboard, Students, Attendance, Fees & Payments, Settings. No sixth screen exists.
- **Defaults (P6).** The values a competent tutor would choose, shipped pre-configured. Defaults are for refinement, never for activation.
- **Honest empty state (P15).** A zero-data screen that teaches: explains why it's empty and what to do next. Never a blank grid.
- **Principle debt.** An amendment that grandfathers existing data out of a principle's full force (e.g. "P4 applies to entries created after 2025-06-01"). Tracked in `principle_debt.md` with an expiry; expired debt becomes a P0 bug.
- **Cooling-off.** The mandatory 14-day window between an RFC and its ratification. Prevents reactive amendments.
- **Anti-principle.** A thing Buddysaradhi will never do, forbidden by a specific principle. Exhaustive, not illustrative.
- **Bioluminescent palette.** Buddysaradhi's accent system: Bioluminescent Emerald `#00FF9D`, Neon Cyan `#00F0FF`, Solar Flare `#FF5E00`, Amber `#FFB300`, Violet `#B388FF`. The cosmic Indigo → Midnight Violet canvas is a neutral background (the night sky), not an accent. Indigo and blue are forbidden as accent roles (AP-6).
- **Signed URL (P14).** A time-limited (7-day TTL) URL carrying an HMAC the parent cannot forge. The entire parent surface in v1. Rendered cloud-side from the immutable ledger.

---

## What These Principles Forbid (Examples)

A non-exhaustive list of concrete violations, each cross-referenced to the principle that forbids it.

- A "Courses" top-level screen. *(Violates P2.)*
- Editing a payment amount in place. *(Violates P4.)*
- A "Loading fees…" full-screen blocker when offline. *(Violates P5.)*
- Forcing theme selection before first use. *(Violates P6.)*
- A 400ms fade-in on the dashboard. *(Violates P7.)*
- A 15-column student table by default. *(Violates P8.)*
- Reusing a voided invoice number. *(Violates P9.)*
- Putting Excel export behind a paywall. *(Violates P10.)*
- A triple "Are you really sure?" dialog. *(Violates P11.)*
- A custom receipt logo uploader shipped before auto-reminders. *(Violates P12.)*
- A new ORM mid-project. *(Violates P13.)*
- A full parent mobile app in v1. *(Violates P14.)*
- A blank "No data" screen with no CTA. *(Violates P15.)*
- A Sentry integration that ships crash logs to a third party. *(Violates AP-10, P5.)*
- An `indigo-500` accent button. *(Violates AP-6.)*
- An LLM that posts `PAYMENT_RECEIVED` rows without tutor review. *(Violates AP-5, P4.)*
- A "streak" badge for daily Buddysaradhi use. *(Violates AP-2, P12.)*

---

> **Closing doctrine.** Buddysaradhi is not a feature factory; it is a tool a tutor trusts with their livelihood. Every shortcut that violates a principle is a shortcut that costs a tutor — later, in a way they cannot predict, in a moment they cannot afford. The constitution is the promise that we will not take that shortcut. Amend rarely. Enforce always. Ship boring.
