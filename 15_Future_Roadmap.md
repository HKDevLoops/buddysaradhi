# 15 — Future Roadmap

> What v1.x, v2, v3, and v4 unlock. **Every item here is *deliberately out of v1*** to protect the five-screen doctrine. An item graduates to v1 only when a principle amendment is ratified per `01_Product_Principles.md §Amendment Process`. The roadmap is not a wishlist — it is a *restraint document*: a public declaration of what we will hold back, even under user pressure, to ship v1 correctly.

---

## How to Read This Spec

This file is the **forward-looking counterpart** to `01_Product_Principles.md`. The principles file is the constitution (what we always do); this is the foreign policy (what we will do, when, and under what conditions).

> **Delivery-order note (read `16_Platform_Delivery_Sequence.md` first).** The version milestones below are delivered **serially across platforms**, not in parallel. Concretely: **v1.0 = the Web Production Gate clears** (web in production). **v1.x mobile/desktop = the P2 (Mobile) and P3 (Desktop) phases**, each with its own Production Gate — mobile begins only after `WEB-PROD-GATE`, desktop only after `MOBILE-PROD-GATE`. **v2.0 (multi-device sync) presumes all three gates have cleared.** A version milestone on this roadmap is not "done" until the corresponding platform gate in `16_*.md` is signed off in the worklog. The roadmap says *what* ships; `16_*.md` says *in what order, behind what gate*.

| If you are… | Read these sections |
|---|---|
| A user asking "when will X ship?" | §Roadmap Philosophy, §Graduation Criteria, the relevant vN.N section |
| An engineer planning v1.1 | §v1.x, §Technical Debt Roadmap |
| A security reviewer | §v2.0 (cross-ref `10_Security.md §19`), §Roadmap Risks |
| A product partner / investor | §The Long Arc (5-year), §Explicitly Never List |
| A contributor proposing a feature | §Graduation Criteria, §Roadmap Philosophy |

---

## Versioning Convention

- **v1.0** — the five-screen OS for a solo tutor. Locked scope. (See §v1.0.)
- **v1.x** — quarterly hardening releases that fit within the five screens or thicken a hidden engine. No new surfaces. No principle amendments.
- **v2.0** — **multi-device sync**, the flagship v2 release. Requires one principle amendment (P5, see §v2.0). No new screen.
- **v2.x** — ecosystem extensions (parent portal, tutor-to-tutor transfer, report-card engine, template marketplace).
- **v3.0** — the on-device intelligence layer. All on-device; no cloud LLM; no telemetry.
- **v3.x** — platform expansion (native mobile via Expo, desktop widget, CLI).
- **v4.0** — the federation option: multi-teacher shared ledger for single-centre tenants. The *only* path to multi-user. Stays self-hosted.

> **Numbering reset notice.** This file supersedes the prior v2/v3 numbering (which had v2.0 = multi-user, v3.0 = ecosystem). Multi-user is pushed to v4.0 to keep v2 focused on sync; ecosystem moves to v2.x; the intelligence layer is new at v3.0. The prior content is preserved where still valid (Technical Debt Roadmap, the Long View).

---

## Roadmap Philosophy

> **The deliberately-deferred doctrine.** *A feature on this roadmap is not a feature we are building — it is a feature we are protecting the v1 user from.* Holding back is the work; *not* shipping is the discipline.

### Why holding back protects v1

Buddysaradhi v1 is a five-screen, seven-engine, single-tenant, offline-first, ledger-backed OS. Every one of those adjectives is load-bearing. A v1 that ships with six screens, a backend dependency, a mutable ledger, or telemetry is a *different product* — one whose trust model, support burden, and cognitive surface area no longer match the solo tutor it was designed for. The temptation, once v1 is "almost done," is to keep stacking capabilities into the launch release — the classic second-system trap. Buddysaradhi refuses it: v1 ships with v1 scope.

### The three gates every roadmap item must respect

A feature lives on this roadmap — not in v1 — because at least one of the following is true:

1. **It tensions a principle.** (E.g., multi-device sync tensions P5 Offline-First by introducing a server dependency. It cannot ship without a ratified P5 amendment.)
2. **It would add a sixth screen.** (Per P2, never permitted for solo tutors. v4 federation surfaces are gated by their own amendment.)
3. **It serves a user v1 does not yet have.** (E.g., parent portal serves a parent-as-reader; v1's user is the tutor only — P1.)

An item graduates out of the roadmap into a v1.x point release only when **all three gates clear** — see §Graduation Criteria.

### The anti-pattern: feature-creep via "just one more"

> **Anti-pattern.** "While we're in there, let's also add…" — a feature surfaces during v1.x engineering, gets tacked onto the release, and the release balloons. The two-week cool-off on principle amendments is also a two-week cool-off on feature scope. If a capability was not in the release plan at the start of the cycle, it goes to the *next* cycle, not this one.

A CI check (`roadmap/scope-drift.test.ts`) fails a PR if a release tag's `RELEASE_PLAN.md` adds items not present in the plan frozen at cycle start. Scope changes require a new release tag, not a quiet merge.

### Why we publish the roadmap publicly

A roadmap that lives in the repo, beside the principles, is *answerable* — users can cite it ("you said sync is v2.0, not v1.1"); engineers can cite it ("this PR introduces a backend dependency; the roadmap says that requires a P5 amendment"). It is the third leg of the trust stool, alongside the principles and the audit log.

---

## v1.0 — The Launch Surface (recap)

> v1 is not a stepping stone; it is the foundation everything else builds on. Every later version assumes v1 is correct, stable, and trusted.

**What ships in v1.0:**

| Layer | Ships | Spec |
|---|---|---|
| Screens (5) | Dashboard, Students, Attendance, Fees & Payments, Settings | `04`–`08` |
| Engines (7) | Search, Reminder, Ledger, Report, Notification, Sync (local-only), Security | `02_Core_Logic.md` |
| Tenancy | Single-tenant, one Turso DB per tutor (or per centre, in federation) | `11_Data_Model.md §1` |
| Connectivity | Offline-first; Turso cloud DB is an encrypted replica the tutor owns | `10_Security.md §1`, P5 |
| Truth spine | Append-only `ledger_entries`; every balance is a derived view | `12_Business_Rules.md §3` |
| Backup | `.buddysaradhi` AES-256-GCM envelope, passphrase-derived key, tutor-controlled | `09_Backup_and_Import_Export.md`, `10_Security.md §15` |
| Auth | Supabase auth (email + OAuth); scoped Turso `db_token`; PIN/biometric lock | `10_Security.md §2–3` |
| Platforms | Web (Next.js 16), desktop (Tauri), mobile (Expo — webview in v1, native in v3.x) | `00_Vision.md §16` |
| Audit | Every sensitive mutation logged; tamper-evident chain | `10_Security.md §8` |

**What does NOT ship in v1.0** — and the principle that forbids it — is enumerated in §Explicitly Never List below. v1.0 is the *complete* product for a solo tutor.

**Ship gate.** v1.0 ships when: (a) all 15 user flows in `03_User_Flows.md` pass Playwright E2E; (b) all edge cases in `14_Edge_Cases.md` are triaged; (c) the Day One Smoke Test (`06_Attendance.md §Day One`) passes on a fresh device in under 90 seconds; (d) the security checklist in `10_Security.md §24` is green. No roadmap item blocks v1.0.

---

## v1.x — Hardening & Polish (quarterly)

v1.x releases are quarterly. Each has a single **theme**, three-to-five features that serve that theme, the **principle** it most respects, and the **user** it most serves. v1.x never introduces a new top-level screen and never amends a principle. Anything that would require either is bumped to v2.0 or later.

| Release | Theme | Headline features | Principle honoured | User served |
|---|---|---|---|---|
| **v1.1** | Performance | 200+ student roster virtualisation; ledger query index on `(student_id, created_at)`; cold-start < 800 ms on mid-range Android; Settings → Data & Privacy shows live DB size + vacuum button | P12 (Tutor's Time), P8 (Density) | The growing tutor (100–300 students) hitting scaling friction |
| **v1.2** | Accessibility+ | Full VoiceOver / TalkBack pass on all five screens; dynamic type (XS–XXL); high-contrast variant; reduced-motion respected throughout; keyboard-only navigation complete (incl. modals) | P3 (Two-Tap — for motor-impaired users), P7 (Motion) | Tutors with permanent or situational accessibility needs |
| **v1.3** | Data Tools | Bulk fee adjust (apply % delta to a cohort); attendance re-allocation (move a session's marks to a different batch); import templates v2 (CSV schema inference, dry-run preview, per-row error surfacing); export presets saved per-tutor | P12, P10 (Backups) | The power-user tutor running 5+ batches |
| **v1.4** | Distribution | Play Store (Android APK/AAB), App Store (iOS — via v3.x native shell, gated), Snap + Flatpak (Linux), MSI + DMG (desktop); auto-update with delta patches and signed manifest; rollback on first-launch crash | P13, P5 | The tutor who wants a one-tap install, not a `curl | bash` |

### v1.1 — Performance (deepening)

The 200-student roster threshold is where the initial virtualisation strategy (`05_Students.md §6`) starts to creak on mid-range Android. v1.1 introduces windowed rendering (50 rows visible, 200 in DOM, rest virtualised) and a covering index on `ledger_entries(student_id, created_at DESC)` taking the balance-recompute query from O(N) scan to O(log N + k). Cold-start target < 800 ms is measured on a Redmi Note 12 (deliberately mid-tier) from app icon tap to Dashboard first paint.

### v1.2 — Accessibility+ (deepening)

Accessibility is not a v2 feature; it is a v1 *debt*. v1.0 ships with semantic markup and reasonable contrast, but a full VoiceOver/TalkBack pass is a quarter of work v1.0 cannot afford without slipping the launch. v1.2 closes the gap. High-contrast variant replaces the cosmic Indigo canvas with a true-black panel + Bioluminescent Emerald accents (the only palette shift permitted — `13_UI_Guidelines.md §2`). Dynamic type respects OS-level text-size preferences and re-flows tables without horizontal scroll up to XXL.

### v1.3 — Data Tools (deepening)

Bulk fee adjust is a *cohort action*, not a per-row edit; it generates N new `FEE_CHARGE` ledger rows (one per student), each individually auditable and voidable. Attendance re-allocation is rare but vital: the tutor marks attendance for "Saturday Batch" then realises it was actually "Sunday Batch" — re-allocation moves the session and marks atomically, with a single `attendance_reallocation` audit entry. Import templates v2 brings dry-run preview ("23 rows valid, 2 errors") *before* committing. No silent partial imports.

### v1.4 — Distribution (deepening)

v1.0 ships as a web app + a manually-installed Tauri desktop binary. v1.4 takes the same v1 binaries through the platform stores. App Store review friction (see §Roadmap Risks) is the biggest schedule risk; we mitigate by submitting the *exact* v1.3 build (no behaviour changes) so the reviewer sees a stable, well-trodden product. Auto-update uses a signed manifest (Ed25519) and delta patches (bsdiff); the updater refuses any patch whose signature does not verify, and rolls back automatically if the post-patch first-launch crashes within 10 seconds.

---

## v2.0 — Multi-Device Sync

> v2.0 is the flagship v2 release. It does not add a screen. It does not add a user. It adds a *capability*: the tutor's data, on the tutor's terms, on the tutor's second device.

### The principle amendment required

**P5 (Offline-First, Always) Amendment 1**, ratified per `01_Product_Principles.md §Amendment Process`:

> **P5 (amended).** *Buddysaradhi works fully offline. A backend dependency is permitted only when the backend is a **dumb encrypted blob store** — it cannot process plaintext user data, cannot run content analytics, cannot surface "tutor engagement" dashboards to Buddysaradhi-the-company. The decryption key is derived from the tutor's passphrase; the server cannot derive it without the passphrase.*

This amendment refines what "no backend" means: not "no server at all," but "no server that can read your data." Offline-first still wins — sync is an *addition*, not a *requirement*. The anti-principle **AP-7 (no data hostage)** is preserved whole — the tutor can export their full data and walk away; sync is a convenience, not a cage. The amendment requires the full process: RFC in `rfc/`, 14-day cooling-off, ratification by project lead + author of `10_Security.md` + one unaffiliated reviewer. Until ratified, v2.0 cannot ship.

### How sync works

The architecture is fully specified in `10_Security.md §19` (Sync Security, Future — v2.0). Summary:

- **End-to-end encrypted.** The Turso cloud DB is wrapped in an application-layer AES-256-GCM envelope keyed to a passphrase-derived key (Argon2id KDF, same parameters as `.buddysaradhi` backups — `10_Security.md §15.3`). The cloud replica is ciphertext to Turso and to Buddysaradhi-the-company.
- **Server is a dumb blob store.** The sync server sees only encrypted bytes, per-tenant opaque blob writes/reads (gated by scoped JWT), and aggregate connection metadata (IP for abuse detection; no payload inspection). It cannot decrypt, run analytics, or surface tutor-engagement dashboards. **No business model depends on reading tutor data.** (Invariant `SYNC-E2E-1`.)
- **Vector clocks + Lamport counters.** Non-ledger rows carry a `{device_id, lamport}` vector clock; conflict resolution is Last-Write-Wins by Lamport, ties broken by `device_id` lexical order (`BR-SYN-01`).
- **CRDT-lite for the ledger.** Ledger rows are UUID-keyed and append-only (`BR-LED-02`); two devices posting different entries for the same student both land — there is no conflict on the ledger itself (`BR-SYN-02`). This is the *structural* reason the ledger is conflict-immune: the data model is designed so that conflicts cannot occur at the layer that matters.
- **Schema drift protection.** If a device's `app_state.schema_version` < server's, the device refuses to sync (`BR-SYN-04`). No silent migrations over the wire.

### Sync states (the UI surface)

Sync is **not a sixth screen**. It is a Settings sub-panel + a sync-status pill in the header (top-right, next to the command palette ⌘K pill). The pill has four states:

| State | Pill appearance | Meaning | User action |
|---|---|---|---|
| **Idle** | Static Bioluminescent Emerald dot, no label | Last sync < 5 min ago; no pending writes | None |
| **Syncing** | Pulsing Neon Cyan dot, "Syncing…" label | Outbox flushing; pulling remote changes | None (auto) |
| **Conflict** | Solid Solar Flare dot, "1 conflict" label | A non-ledger row conflict needs review | Tap → conflict drawer (shows both versions, tutor picks) |
| **Offline-queued** | Hollow Amber dot, "12 queued" label | Device is offline; outbox holding 12 writes | None (auto-flush on reconnect) |

The conflict drawer is the *only* place sync ever interrupts the tutor. The drawer shows: the row, the local version, the remote version, a diff, and a "keep local / keep remote / keep both" choice. Ledger conflicts never reach this drawer (they cannot exist by construction); only non-ledger rows (e.g., a student's nickname edited on two devices) can conflict.

### What does NOT ship in v2.0

- **No real-time collaboration.** Two tutors cannot edit the same student at the same instant and see each other's cursors. Sync is asynchronous; conflicts are resolved after the fact, not in real time.
- **No shared editing.** v2.0 sync is *between the same tutor's devices* — laptop + phone + desktop. Multi-tutor is v4.0 (federation).
- **No server-side computation.** No "smart" insights in the cloud. No server-side report generation or search. The server stores blobs; the client does everything else.
- **No account on a second device without the tutor's passphrase.** Adding a device requires entering the passphrase on the new device (derives the sync key). Lost passphrase = lost sync access = recover from `.buddysaradhi` backup. There is no "reset sync password" — that would require the server to see plaintext, which is exactly what the amendment forbids.

### Migration path from v1.x

The v2.0 upgrade is **opt-in**. The tutor opens Settings → Sync (new sub-panel), reads the one-screen explainer, enters the passphrase they already use for `.buddysaradhi` backups (no new secret), and confirms. Their existing local DB is wrapped in the sync envelope; the first sync uploads the encrypted blob. To add a second device: install Buddysaradhi, sign in with the same Supabase account, enter the passphrase — device 2 pulls the blob, decrypts locally, becomes a sync peer. If the tutor declines v2.0, nothing changes. v1.x continues to work exactly as before, indefinitely. v2.0 is additive, not migratory.

---

## v2.x — Ecosystem

v2.x builds on the sync foundation. Each release extends the *audience* that can read tutor data — but always read-only, always E2E encrypted, always revocable. The tutor remains the sole author.

### v2.1 — Parent portal (read-only web link)

The parent receives a **signed, expiring URL** — not an account. The URL renders a read-only web page showing their child's attendance, ledger, receipts, and next three upcoming dues. The page is server-rendered from the encrypted blob: the server decrypts *one student's slice* using a derived sub-key the URL carries, renders the HTML, discards the plaintext. The server never holds the full tenant plaintext.

- **TTL:** 7 days, refreshable by the tutor with one tap (re-issues a new signed URL; old one expires immediately).
- **E2E encrypted:** the URL carries an HMAC the parent cannot forge; the decryption sub-key is scoped to that one student only.
- **No parent account.** No login, no password, no Supabase auth row. The URL is the trust. (Honours P14.)
- **Revocation:** tutor can revoke at any time; next page load returns "link expired."

This is the prior roadmap's parent-portal idea re-scoped to v2.1, because v2.0's sync envelope is the *prerequisite*: without the dumb-blob-store amendment, the parent portal would require Buddysaradhi-the-company to hold plaintext, which is exactly what P5 forbids.

### v2.2 — Tutor-to-tutor transfer

For centres with multiple teachers who are *not* federated (see v4.0). A tutor leaving a centre can transfer their students — with full attendance and ledger history — to another tutor's tenant. The transfer is a one-shot encrypted export → import: tutor A generates a `.buddysaradhi-transfer` file (same crypto as backup, scoped to selected students), sends it to tutor B out-of-band (WhatsApp, email), tutor B imports. After import, the students live in tutor B's tenant; tutor A's copy is optionally archived or deleted. No server-side brokering — the file is opaque to Buddysaradhi-the-company. Audited on both sides (`transfer_out`/`transfer_in` with file hash) for chain-of-custody if a fee dispute arises.

### v2.3 — Report-card PDF generation engine

v1.x generates receipts (`BR-RC-02`). v2.3 generalises that engine to **report cards**: a templated PDF pulling attendance %, fee status, tutor remarks, customisable header/footer. Templates are JSON-defined (no code); the engine renders via the same React-PDF pipeline as receipts. No new screen — report cards are accessed via Students → [student] → "Generate report card" action, or via Dashboard → Reports widget (a panel, not a screen). Templates are stored in the tenant DB; a default ships; tutors can clone and edit.

### v2.4 — Template marketplace

Community-shared report-card templates (and later, reminder message templates, receipt layouts). Tutors publish; other tutors install with one tap. Templates are **vetted**: a published template is a JSON file reviewed for malicious script injection (React-PDF templates can include JS expressions; vetting blocks any expression that touches `eval`, `Function`, network, or file APIs). Vetted templates carry an Ed25519 signature; unsigned templates cannot be installed.

The marketplace is a static CDN of signed JSON files — no template-store backend that reads user data. Buddysaradhi-the-company takes no cut; templates are free. Premium-template sales happen out-of-band between tutors. (Avoids the marketplace feature-creep — see §Explicitly Never List.)

---

## v3.0 — The Intelligence Layer (on-device)

> v3.0 brings AI to Buddysaradhi — but the AI lives on the tutor's device, sees only the tutor's data, and never writes to the ledger without the tutor's explicit approval. This is the *only* shape AI can take inside our principles.

### What ships

- **Natural-language student queries.** "Show me students whose attendance dropped this month." "Who hasn't paid in 45 days?" The query is parsed on-device, translated to SQL against the local DB, results render in the relevant screen. The tutor sees the underlying query before it runs (transparent, not magic).
- **Smart fee reminders.** The system drafts the WhatsApp message: *"Hi Mrs. Sharma, Aarav's ₹4,500 fee is due on the 15th. Payment link: [buddysaradhi.app/p/…]. Thank you!"* The tutor reviews, edits, taps "Send" — which opens WhatsApp pre-filled (same as v1's `wa.me` deep link; no data leaves the device to Meta).
- **Attendance pattern detection.** "Aarav has missed 4 of the last 6 Saturdays. Possible weekend conflict?" Surfaced as a non-blocking Dashboard card. Dismiss / snooze / act.

### The principle constraints

- **All on-device.** The LLM is a quantised model (≤1.5 GB on disk, runnable on mid-range phone) loaded into the app's local context. No cloud API. No data egress. (Honours P5, AP-3, AP-10.)
- **No telemetry.** The model runs locally; queries and results never leave the device. Crash logs from the model are local-only.
- **The "AI never writes to the ledger without audit" rule** (restatement of AP-5). The AI can *suggest* a ledger entry — "Based on this WhatsApp confirmation, shall I record ₹4,500 received from Aarav Sharma?" — but the entry is not written until the tutor taps "Confirm." The audit log records `actor='tutor'`, `source='ai_suggested'`. The tutor is the author; the AI is the scribe.
- **No auto-billing.** The AI cannot, even with confirmation, *create* a fee charge the tutor did not authorise. It can suggest one was missed; the tutor must explicitly create it. (Honours P4.)

### Model selection and update

The model is shipped as part of the app binary (not downloaded at runtime). Model updates ship with app updates, on the v3.x cadence. The model is open-weight — we will not ship a proprietary closed model the tutor cannot audit.

---

## v3.x — Platform Expansion

v3.x takes the v3.0 product and stretches it across the platforms a tutor actually uses. v1.x already shipped to web, desktop (Tauri), and mobile (Expo webview). v3.x makes mobile *native* and adds two new surfaces that stay inside the five-screen doctrine.

### v3.1 — Expo React Native mobile (native shell)

v1.x mobile is a Tauri webview — performant enough, but the webview boundary blocks certain platform integrations. v3.1 ships a true React Native shell using Expo, sharing the v1.x TypeScript business logic (ledger, sync, reminder engines) and re-implementing only the view layer. This unlocks **camera** (scan QR/receipt to reconcile payment; scan student ID), **biometrics** (smoother Face ID / fingerprint unlock), **NFC** (tap an NFC student card to mark attendance, where hardware supports it), and **background sync**. The five-screen doctrine is preserved: native mobile uses the same five-tab bottom bar (`13_UI_Guidelines.md §8.6` — Tab Bar). No new screen.

### v3.2 — Desktop widget (menu bar / system tray)

A lightweight widget for macOS menu bar, Windows system tray, Linux indicator. From the widget, the tutor can mark attendance for today's next batch (compact picker; tap a name → marked present), see today's collection (running total, synced from the main app), and quick-record a payment (compact form; opens to full Fees screen if needed). The widget is *not* a sixth screen — it is a *projection* of the Attendance and Fees screens into a smaller surface. It cannot do anything the main app cannot do; it is a convenience for the most-frequent actions.

### v3.3 — CLI for power users

```bash
$ buddysaradhi mark --student s1 --present --batch "Saturday 9am"
✓ Marked Aarav Sharma present for Saturday 9am (session 2024-03-16)

$ buddysaradhi fees --record --student s1 --amount 4500 --method upi
✓ Recorded ₹4,500 UPI payment from Aarav Sharma (receipt RC-0124)

$ buddysaradhi report --overdue --gt 5000
Aarav Sharma    ₹9,000
Priya Patel     ₹5,500
2 students, ₹14,500 total overdue
```

The CLI talks to the same local SQLite cache as the desktop app (via a Unix socket / named pipe). It is a power-user surface for tutors who live in the terminal — and for automation (cron jobs that export weekly reports, shell scripts that bulk-import from a legacy system). Same audit log. Same ledger. Same five screens.

---

## v4.0 — The Federation Option

> v4.0 is the *only* path to multi-user in Buddysaradhi. It is opt-in. It stays self-hosted. It does not become SaaS. And the five-screen doctrine for the *tutor* is preserved — federation adds a sixth surface *only* for the centre owner (admin), never for an individual tutor.

### What federation is

A **federation** is a single tuition centre with multiple tutors who share a ledger. The centre owner is the admin; tutors are members. The federation runs on a single Turso DB (one tenant, not multi-tenant SaaS). Each tutor has their own credentials (PIN/biometric per device, plus a federation-scoped Supabase auth row). The owner can assign batches to tutors, see all batches/students/ledger entries, record payments across any tutor's batches, and generate centre-wide reports. Tutors see only their assigned batches (unless the owner grants cross-batch visibility). Each tutor's actions are audited with `actor = tutor_uuid`.

### What federation is NOT

- **Not SaaS.** The federation runs on the centre owner's Turso DB. Buddysaradhi-the-company hosts nothing but the dumb encrypted blob store (the same one v2.0 uses for sync). There is no "Buddysaradhi Cloud Plan" where we host your federation.
- **Not multi-tenant.** One centre = one Turso DB. Two centres = two Turso DBs, no shared infrastructure.
- **Not a sixth screen for tutors.** A tutor in a federation sees the *same five screens* as a solo tutor. Only the centre owner sees the sixth surface (a conditional "Team" panel — appears only when the owner role is active).

### The principle amendment

**P2 (Five Screens) Amendment 1**, ratified per the standard process:

> **P2 (amended).** *Five top-level screens for the tutor. A sixth "Team" surface is permitted **only** for the centre-owner role in a federation (v4.0+), and only when ≥2 tutors are enrolled. Solo tutors never see the sixth surface, in any version, ever.*

This amendment carves a narrow exception for the admin role in a federation. The solo-tutor product remains exactly five screens, forever.

**P1 (Tutor Is User) Amendment 1:**

> **P1 (amended).** *In a federation, the centre owner is an additional user. The owner's interests and the tutor's interests may diverge. The principle's protection of the tutor is unchanged: the tutor's workflow, time, and cognitive load remain the optimisation target. The owner is an administrator, not a co-author of the tutor's day-to-day experience.*

### Governance model

The centre owner is the admin. The owner can invite tutors (email-based; tutor accepts with their existing Supabase account), assign and reassign batches, set per-tutor permissions (own-batches-only, all-batches-read, all-batches-write, fees-only, reports-only), and remove tutors (removed tutors' historical actions remain in the audit log; their batch assignments revert to the owner).

Disputes (e.g., a tutor claims a payment the owner reassigned) are resolved via the audit log, not via Buddysaradhi-the-company. We do not arbitrate federation governance; we provide the ledger that makes arbitration possible. Federation is the highest-risk item on this roadmap — see §Roadmap Risks.

---

## Explicitly Never List

> These features will **never** ship, in any version. Each is forbidden by a specific principle. The list is exhaustive, not illustrative — a future capability that would violate any of these is out of scope, full stop. (See also `01_Product_Principles.md §Anti-Principles`.)

| Feature | Forbidden by | Why |
|---|---|---|
| **A tutor marketplace** (discover tutors, in-app booking, Buddysaradhi takes a cut) | P1, P5 | Buddysaradhi is the tutor's tool, not a lead-gen funnel. A marketplace would force us to take sides between tutor and student-as-customer. |
| **Content hosting** (worksheets, video lessons, mock tests on our servers) | P2, P5 | Content is a sixth screen waiting to happen; hosting it is a backend dependency we have refused. |
| **Engagement notifications** ("you haven't opened Buddysaradhi in 3 days!" push, streaks, badges) | AP-2, P12 | Buddysaradhi is a tool, not a slot machine. Engagement metrics are for ad-supported products; we are not. |
| **Ad network / ad monetisation** | AP-3, AP-10, P5 | Ads require telemetry and a backend that processes user data. Both are forbidden. |
| **Forced social feed** (leaderboards, public rankings, "share your attendance %") | AP-4, P1, P14 | The tutor is the only user; students are data. |
| **AI auto-billing without audit** (an LLM that posts `FEE_CHARGE` rows without explicit tutor confirmation) | AP-5, P4 | The ledger is the verbatim capture of the tutor's intent. An AI that writes to it without confirmation is a spine surgeon with no oversight. |
| **Indigo / blue as primary accent** | AP-6, `13_UI_Guidelines.md §2` | Indigo/blue read as "default tech app." The bioluminescent palette is Buddysaradhi's signature; the lint rule `no-indigo-accent` enforces this in CI. |
| **Vendor lock-in via data hostage** ("export is premium," proprietary backup format) | AP-7, P10 | The tutor stays because the product is better, not because the data is trapped. |
| **Student or parent accounts in the tutor app** | AP-8, P1, P14 | Parents are guests (signed URLs); students are data. Their accounts — when they exist — live in separate apps. |
| **A sixth top-level screen for solo tutors** | AP-9, P2 | Five is the spatial-memory ceiling. |
| **Telemetry that leaves the device** (Sentry, Mixpanel, PostHog cloud) | AP-10, P5 | The tutor's workflow is not our dataset. Crash logs stay local. |
| **Reusing a voided invoice or receipt number** | AP-11, P9 | Numbers are monotonic, gap-tolerant, never recycled. |
| **An unaudited mutation of a locked period** | AP-12, P4, P11 | Backdated entries require PIN + audit log entry; no exceptions, no "admin override." |

---

## Graduation Criteria

> A roadmap item moves from "planned" to "in-spec for vN.N" only when **all five gates** pass. No item ships without all five. This is what keeps Buddysaradhi coherent from v1 to v4.

### The 5-gate checklist

| Gate | What it means | Artifact |
|---|---|---|
| **1. Principle amendment ratified** | If the item tensions any principle (P1–P15, AP-1–AP-12), the amendment has gone through RFC → 14-day cooling-off → ratification per `01_Product_Principles.md §Amendment Process`. | The ratified RFC in `rfc/ratified/` with permanent ID; principle text updated in `01_Product_Principles.md`. |
| **2. 2-week RFC** | A Request-for-Comments document open for ≥14 calendar days, with at least one substantive comment from a non-author reviewer. | The RFC thread in `rfc/` (or `rfc/ratified/` post-merge). |
| **3. Prototype spec written** | The relevant sibling spec (`04`–`14`) has been updated: UI sketched (surface change), data model extended (schema change), business rules added (logic change), edge cases anticipated (behaviour change). | Updated sections in `04-08_*.md` / `11_Data_Model.md` / `12_Business_Rules.md` / `13_UI_Guidelines.md` / `14_Edge_Cases.md`. |
| **4. User demand signal ≥ threshold** | At least one of: (a) ≥50 distinct user requests in the feedback tracker, (b) a paying-customer interview citing the gap, (c) a documented loss of a prospect to a competitor citing this feature. "We think it'd be cool" is not a signal. | A linked issue / interview note / lost-deal log entry. |
| **5. Engineering capacity confirmed** | A team lead has signed off that the capacity exists in the target release cycle, with no higher-priority item displaced. Capacity is *reallocated*, not invented. | A `RELEASE_PLAN.md` entry for the target cycle, with sign-off. |

### Anti-pattern: railroading a gate

> **Anti-pattern.** "The user demand is clearly there, let's just ship it and write the RFC after." Each gate exists because a prior failure mode taught us. User demand without a principle amendment is a feature that breaks the doctrine; a principle amendment without a prototype spec is a rule with no enforcement; a prototype spec without engineering capacity is a plan that rots. The five gates are *conjunctive*, not disjunctive.

Graduation is also not a commitment to ship in the next release — an item can pass all five gates and still sit on the roadmap for two cycles while higher-priority work lands first. Graduation means *eligible to ship*.

---

## Roadmap Risks

Every phase carries non-trivial risk. The risks are named so they can be priced, mitigated, and revisited each cycle.

### Risk matrix

| Phase | Risk | L | I | Mitigation |
|---|---|---|---|---|
| **v2.0** | Sync crypto complexity — the E2E envelope is novel; a bug could corrupt sync state across devices | Med | Critical | (a) External cryptographer review before ratification; (b) round-trip test (`10_Security.md §15.5`) extended to sync envelopes; (c) v2.0 ships with a "sync is beta, keep your `.buddysaradhi` backups" warning for the first quarter. |
| **v2.0** | Lost passphrase = lost sync access (no server-side reset) | High | High | (a) Aggressive onboarding prompt to write down the passphrase; (b) `.buddysaradhi` backup is the recovery path — mandatory before sync is enabled; (c) documented "reset sync from backup" flow. |
| **v3.0** | On-device LLM size (≤1.5 GB target) exceeds mid-range phone capacity | Med | High | (a) Model is an *optional* v3.0 install — low-storage devices get the rule-based engine only; (b) aggressive 4-bit quantisation; (c) fallback ≤500 MB smaller model for low-end devices. |
| **v3.0** | Model hallucination suggests a wrong ledger entry; tutor trusts it | Med | Med | (a) AP-5 "AI never writes without audit" means the entry is tutor-authored; (b) suggestions are clearly marked, with the underlying query shown; (c) one-tap "this seems off — dismiss." |
| **v3.1** | App Store review friction (Apple's review of crypto, AI, signed-URL portals is unpredictable) | High | Med | (a) Submit the *exact* v1.4 build first to establish precedent; (b) documented appeal script for common rejections; (c) keep the web build always-shippable so App Store delay doesn't block the platform. |
| **v4.0** | Federation governance disputes generate support load we are not staffed for | High | High | (a) Federation is explicitly self-hosted; we do not arbitrate; (b) the audit log is the dispute-resolution artefact; (c) optional paid onboarding call. |
| **v4.0** | RBAC bugs leak data across tutors | Med | Critical | (a) Row-Level Security at the SQLite layer (`10_Security.md §7`) enforces scope regardless of app bugs; (b) federation ships behind a feature flag for two cycles of internal use before GA. |
| **Cross** | Feature-creep: a v1.x cycle absorbs a v2.0 item "because it's almost done" | High | Med | (a) `roadmap/scope-drift.test.ts` CI check; (b) two-week cool-off applies to scope, not just amendments; (c) release tags are immutable once frozen. |
| **Cross** | Principle amendment fatigue — too many amendments erode the doctrine | Low | High | (a) Amendment process is deliberately hard (14-day cooling-off, three sign-offs); (b) annual "doctrine health" report; (c) foundational-layer (P1, P4, P5) amendments require a v2.0+ release — never a patch. |

---

## Technical Debt Roadmap

Alongside feature work, technical debt is paid down on its own cadence. None block v1.0; all are tracked in `principle_debt.md` or the issue tracker.

| ID | Debt | Target | Rationale |
|---|---|---|---|
| TD-1 | WebAuthn for web biometric unlock (replaces PIN-only on web) | v1.x | Desktop/web users deserve the same biometric UX as mobile. |
| TD-2 | Replace TanStack Query invalidation with Turso live queries (WSS) — reduces polling overhead | v1.x | Polling is a battery drain on mobile. |
| TD-3 | Migrate FTS5 to a dedicated search index (TypeSense/Meilisearch) for >10k student tenants | v2 | FTS5 creaks past 10k rows; not needed until federation-scale. |
| TD-4 | Introduce a `student_balance_cache` table maintained by triggers for tenants >500 students | v1.1 | Balance-recompute query goes from O(N) to O(1) read. |
| TD-5 | Extract the Ledger Engine into a standalone Rust crate shared across web/mobile/desktop | v2 | Currently TypeScript on web, planned Rust on desktop; ends the duplication. |
| TD-6 | Audit log partitioning (per-year) for tenants with >5 years of history | v1.3 | Audit log grows unbounded; partitioning keeps queries fast. |
| TD-7 | Schema migration framework upgrade (drizzle-kit → custom migrator with dry-run) | v1.x | Needed for v2's multi-device schema drift rules. |
| TD-8 | Replace `wa.me` deep link with WhatsApp Business API integration (opt-in, paid) | v2.x | Eliminates the manual "tap Send" step. **Amends AP-10 carefully:** WhatsApp Cloud API uploads contacts to Meta; we require explicit opt-in and document the data flow. |

---

## The Long Arc (5-year)

> Where Buddysaradhi should be in 2029.

### The vision: "the tutor's lifelong OS"

In 2029, a tutor who started with Buddysaradhi in 2024 has five years of attendance, fees, receipts, and audit log — all in one tenant, all exportable, all auditable. They have moved from solo to federation (or not — both paths supported). They have on-device AI that knows their students' patterns better than they do. They have never had to migrate their data, never had to "upgrade to a new plan," never had to re-learn the product. Buddysaradhi is, for that tutor, **the operating system of their tuition business** — not an app they use, but the substrate their business runs on.

### Data portability guarantees

- **The `.buddysaradhi` export is forever.** The format is documented, versioned, and open. A tutor in 2029 can export their full data and read it with a tool we publish (open-source) — even if Buddysaradhi-the-company no longer exists.
- **No proprietary format, ever.** The backup is SQLite + JSON manifests inside an AES-256-GCM envelope. The envelope spec is published; a motivated user can decrypt with `openssl`.
- **No "premium export."** Export is free, forever. (AP-7.) If Buddysaradhi ever charges for export, the doctrine is dead and the project should be forked.

### The open-source trust model

The **core ledger engine** is open-sourced under a permissive license (MIT or Apache 2.0) by v3.0 — the *auditability* commitment: any tutor, researcher, or regulator can read the code that computes balances, voids entries, and writes the audit log. What stays proprietary: the UI, the sync envelope's transport layer, the cloud infrastructure. The *trust-critical* code is open; the *competitive* code is not. The on-device AI model (v3.0) is open-weight — the tutor can inspect what's running. We will not ship a closed model that makes decisions about a tutor's livelihood behind a curtain.

### The anti-acquisition commitment

> **Commitment.** Buddysaradhi will not be acquired by an ed-tech conglomerate that would violate the principles. This is not a legal commitment (companies can be sold); it is a *founder commitment* recorded here, in the constitution, so that any future acquisition is measured against it.

If an acquirer would require a student-facing account system (P1, AP-8), a cloud backend that processes plaintext (P5, AP-7), telemetry that leaves the device (AP-10), a sixth screen for solo tutors (P2, AP-9), or an ad network (AP-3), the acquisition is rejected. If the founders are forced to sell under such conditions, the principles file, the roadmap, and the open-source ledger engine are the seed from which the community can fork. The constitution survives the company. This is the long arc: not a product strategy, but a *trust strategy* — the tutor trusts Buddysaradhi with their livelihood, and Buddysaradhi commits, in writing and in code, that the trust is not for sale.

---

## ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Future Roadmap doc. The mockups here are **timeline Gantt charts, v2.0 sync architecture, and v3.x native-mobile architecture** — not UI layouts. Where a UI surface is mentioned (e.g., the v2.0 sync-status pill), the glass tier (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) or neumorphic recipe (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) is annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `BR-*`, `EC-*`, `P*`, `AP-*`).

### Design System Reference — Future Roadmap

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces referenced by future versions | Tier | Cross-ref |
|---|---|---|
| v2.0 sync-status pill (header, 4 states) | emerald/cyan/flare/amber dot in a `glass-strong` pill | §5.4, §5.5 |
| v2.0 conflict drawer (the only sync UI interrupt) | `glass-strong` drawer + backdrop | §5.5, §8.7 |
| v2.1 parent portal web page (signed URL) | (web — `glass` cards over cosmic canvas, rendered cloud-side) | §5.5 |
| v2.3 report-card PDF | (print — `glass` does not apply; §12.2) | §12.2 |
| v2.4 template marketplace modal | `glass-strong` + backdrop; install button = `neumo-raised` | §5.5, §8.7 |
| v3.0 NL-query bar (top of any screen) | `neumo-inset` tray (like ⌘K) | §6.6, §8.10 |
| v3.0 smart-reminder draft card | `glass` + cyan accent left-border | §5.4, §8.1 |
| v3.0 attendance-pattern card | `glass` + amber accent left-border (non-blocking) | §5.4, §8.1 |

| Neumorphic controls referenced by future versions | Recipe | Cross-ref |
|---|---|---|
| v2.0 "Add device" primary button (Settings → Sync) | `neumo-raised` (emerald glow) | §6.6, §8.2 |
| v2.0 conflict "keep local / remote / both" segmented | `neumo-inset` well; active = `neumo-raised` pill | §6.6, §8.5 |
| v2.0 sync passphrase input | `neumo-inset` well | §6.6, §8.9 |
| v2.4 template "Install" button | `neumo-raised` (emerald glow); disabled if unsigned | §6.6, §8.2 |
| v3.0 NL-query input | `neumo-inset` tray + `neumo-raised` "Ask" button | §6.6, §8.10 |
| v3.0 smart-reminder "Send" / "Edit" / "Discard" buttons | `neumo-raised` primary/secondary/secondary | §6.6, §8.2 |

> **References:** Martin Kleppmann — *Designing Data-Intensive Applications* (E2E sync, vector clocks); Pat Helland — *Life beyond Distributed Transactions* (the dumb-blob-store amendment rationale); Apple HIG — *Software Updates* (the signed-manifest + rollback pattern); Material Design 3 — *Sync states*; RFC 8439 (AES-GCM, used by v2.0 sync envelope); RFC 9100 (Argon2id, used by v2.0 sync key derivation); Nielsen Norman Group — *AI Disclosure* (the v3.0 "show the underlying query" pattern); Smashing Magazine — *Native vs. WebView* (the v3.x native-mobile graduation gate).

### Mockup F1 — v1.x → v2.0 → v3.x Timeline Gantt Chart

```
ROADMAP TIMELINE — v1.x → v2.0 → v2.x → v3.0 → v3.x → v4.0 (5-year horizon)
                   (each release is gated by a graduation criterion — see §Graduation Criteria)

   2025 Q3 ──────────────────────────────────────────────────────────────────────► 2030 Q3
   │                                                                              │
   │  v1.0 LAUNCH                                                                 │
   │  ●  ──────────────────────────────────────────────────────────────────────  │
   │  │ · 5 screens, 7 engines, 1 ledger                                          │
   │  │ · Supabase auth + Turso per-user DB                                       │
   │  │ · Web (PWA) + macOS + Windows + Android + iOS (webview)                   │
   │  │ · success gate: 7-min onboarding, 72h offline, <60s backup/restore        │
   │  ▼                                                                           │
   │                                                                              │
   │  v1.x HARDENING (quarterly; no principle amendments, no new screen)         │
   │  ●════════════════════════════════════════════════════════════════════════►  │
   │  │ · v1.1 Performance   (200+ roster virtualisation, cold-start <800ms)      │
   │  │ · v1.2 Accessibility+ (VoiceOver/TalkBack, dynamic type, high-contrast)   │
   │  │ · v1.3 Data Tools    (bulk fee adjust, import templates v2)               │
   │  │ · v1.4 Distribution  (Play Store, App Store, Snap/Flatpak, MSI/DMG)       │
   │  │                                                                           │
   │  │   ↑ each v1.x release: 1 theme · 3–5 features · 1 principle honoured      │
   │  │   ↑ graduation gate: day-7 retention ≥ 60%, MRR ≥ ₹299/mo per active     │
   │  │     (post-§1.6-trigger; pre-trigger MRR = ₹0/mo by design — "Free for   │
   │  │     everyone, for now" model per product/05_Pricing_and_Plans.md §1.6;   │
   │  │     the 250-student number is internal soft guidance, no paywall)        │
   │  │   ↑ amber hex stays #FFB300; no indigo/blue accents (AP-6)                │
   │  ▼                                                                           │
   │                                                                              │
   │  v2.0 MULTI-DEVICE SYNC (flagship v2; principle amendment P5-A1 required)   │
   │  ●════════════════════════════════════════════════════════════════════════►  │
   │  │ · E2E encrypted sync envelope (AES-256-GCM + argon2id)                    │
   │  │ · Turso cloud DB = ciphertext blob (SYNC-E2E-1)                           │
   │  │ · vector clocks + Lamport counters for non-ledger rows                    │
   │  │ · ledger conflict-immune by construction (BR-LED-02, BR-SYN-02)           │
   │  │ · sync-status pill (4 states: idle/syncing/conflict/offline-queued)       │
   │  │ · NO new screen; NO new user; NO real-time collaboration                  │
   │  │                                                                           │
   │  │   ↑ P5 Amendment 1 must ratify (RFC + 14-day + lead + security author    │
   │  │     + unaffiliated reviewer) before v2.0 ships                            │
   │  ▼                                                                           │
   │                                                                              │
   │  v2.x ECOSYSTEM (each release extends audience, read-only, E2E, revocable)  │
   │  ●════════════════════════════════════════════════════════════════════════►  │
   │  │ · v2.1 Parent portal (signed URL, 7-day TTL, no parent account — P14)     │
   │  │ · v2.2 Tutor-to-tutor transfer (.buddysaradhi-transfer encrypted file)         │
   │  │ · v2.3 Report-card PDF engine (templated, JSON-defined, no new screen)    │
   │  │ · v2.4 Template marketplace (signed JSON, no backend that reads user data)│
   │  │                                                                           │
   │  │   ↑ each v2.x release: read-only extensions, E2E, revocable              │
   │  ▼                                                                           │
   │                                                                              │
   │  v3.0 INTELLIGENCE LAYER (on-device; never writes to ledger without tutor)  │
   │  ●════════════════════════════════════════════════════════════════════════►  │
   │  │ · NL student queries (on-device parse → SQL; tutor sees the query)        │
   │  │ · Smart fee reminders (drafted message; tutor reviews + taps Send)        │
   │  │ · Attendance pattern detection (non-blocking Dashboard card)              │
   │  │                                                                           │
   │  │   ↑ AP-5 enforced: AI may suggest but never commit to ledger              │
   │  │   ↑ all AI runs on-device; no cloud LLM; AP-10 honoured                   │
   │  ▼                                                                           │
   │                                                                              │
   │  v3.x PLATFORM EXPANSION (native mobile shells; still 5 screens)            │
   │  ●════════════════════════════════════════════════════════════════════════►  │
   │  │ · v3.1 Native iOS shell (SwiftUI; replaces Expo webview)                 │
   │  │ · v3.2 Native Android shell (Jetpack Compose; replaces Expo webview)     │
   │  │ · v3.3 Parent app (read-only native; P14 graduate)                        │
   │  │ · v3.4 Tablet layouts (iPad / Android tablet; responsive breakpoints)    │
   │  │ · v3.5 Live class integration (Zoom/Meet link-sharing; never build)      │
   │  │ · v3.6 White-label (deferred; dilutes brand in v1)                        │
   │  │                                                                           │
   │  │   ↑ graduation gate: v3.x cannot ship until v3.0 on-device AI proves     │
   │  │     the architecture; native shells are a polish, not a rewrite           │
   │  ▼                                                                           │
   │                                                                              │
   │  v4.0 FEDERATION OPTION (the FIRST new screen since v1; gated to institutes)│
   │  ●════════════════════════════════════════════════════════════════════════►  │
   │  │ · "Team" surface (the 6th screen; multi-tutor institutes only)            │
   │  │ · role-based access (owner, co-tutor, viewer)                             │
   │  │ · per-tutor scoping within a shared tenant DB                              │
   │  │ · accountant-side fee entry                                               │
   │  │                                                                           │
   │  │   ↑ only "Team" has ever passed the §7.5 6th-screen decision matrix      │
   │  │   ↑ solo tutors NEVER see the Team surface; P2 honoured for them         │
   │  ▼                                                                           │
   │                                                                              │
   │  EXPLICITLY NEVER (the moat — see §Explicitly Never List)                    │
   │  ✕ live video classes / whiteboards            (integrate, never build)     │
   │  ✕ GST / tax filing automation                 (out of scope; export to CA) │
   │  ✕ email campaigns / marketing CRM             (violates no-telemetry)      │
   │  ✕ gamification for students                   (violates P1)                │
   │  ✕ content hosting (worksheets, videos)        (different business)         │
   │  ✕ a 6th screen for solo tutors                (violates P2)                │
   │  ✕ telemetry that leaves the device            (violates AP-10)             │
   │  ✕ indigo or blue as primary accent            (violates AP-6)              │
   │                                                                              │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ Every release is gated by a graduation criterion (§Graduation Criteria);
     a release that misses its gate is deferred, not rushed.
   ↑ The roadmap is a promise to NOT build the wrong things; the right things
     ship only when the doctrine permits (§The Long View).
   ↑ v4.0's "Team" surface is the only 6th screen in Buddysaradhi's history; solo
     tutors never see it. The 5-screen ceiling holds for the solo tutor forever.
```

- ↑ **v1.x is hardening, not new screens.** Every v1.x release deepens the existing 5 screens; nothing graduates to a 6th.
- ↑ **v2.0 requires a principle amendment (P5-A1).** The amendment refines "no backend" to "no backend that can read your data" — sync is permitted because the cloud DB is end-to-end encrypted ciphertext.
- ↑ **v3.0 is the only AI shape permitted by AP-5.** On-device, suggests-but-never-commits, transparent (the tutor sees the underlying SQL query before it runs).

### Mockup F2 — v2.0 Multi-Device Sync Architecture (E2E encrypted)

```
v2.0 MULTI-DEVICE SYNC ARCHITECTURE — Turso cloud DB = ciphertext blob
                                       (SYNC-E2E-1 invariant: server cannot read user data)

   ┌─ DEVICE 1 (Riya's laptop — macOS, Tauri) ──────────────────────────────────┐
   │  ┌─ App shell (5 screens + 7 engines) ──────────────────────────────────┐ │
   │  │  · mutations write to local SQLite (the source of truth, P5)          │ │
   │  │  · every mutation enqueues sync_outbox row (BR-SYN-02, AP-13)         │ │
   │  └────────────────────────────────────┬──────────────────────────────────┘ │
   │                                       │                                     │
   │  ┌─ sync_outbox (pending rows) ───────▼──────────────────────────────────┐ │
   │  │  idempotency_key (UUIDv7) · payload (JSON) · status='pending'         │ │
   │  └────────────────────────────────────┬──────────────────────────────────┘ │
   │                                       │                                     │
   │  ┌─ v2.0 SYNC CLIENT ────────────────▼──────────────────────────────────┐ │
   │  │  · derives AES-256 key from passphrase (argon2id, same params as     │ │
   │  │    .buddysaradhi backups — RFC 9100 m=64MiB t=3 p=4)                       │ │
   │  │  · encrypts each payload: AES-256-GCM(key, nonce, payload)             │ │
   │  │  · pushes ciphertext to Turso cloud DB                                 │ │
   │  │  · pulls remote ciphertext, decrypts locally                           │ │
   │  └────────────────────────────────────┬──────────────────────────────────┘ │
   └───────────────────────────────────────┼─────────────────────────────────────┘
                                           │ TLS 1.3 + mTLS
                                           │ JWT scoped to per-user Turso DB
                                           ▼
   ┌─ TURSO CLOUD DB (per-user namespace; ciphertext only) ────────────────────┐
   │  ┌─ rows are CIPHERTEXT to Turso and to Buddysaradhi-the-company ────────────┐ │
   │  │  · table: sync_outbox_remote (id, ciphertext, tag, nonce, ts)        │ │
   │  │  · Turso cannot decrypt; Buddysaradhi-the-company cannot decrypt          │ │
   │  │  · the only plaintext ever on the server is aggregate connection      │ │
   │  │    metadata (IP for abuse detection; no payload inspection — AP-10)   │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   └───────────────────────────────────────┬─────────────────────────────────────┘
                                           │ TLS 1.3 + mTLS
                                           │ JWT scoped to same per-user DB
                                           ▼
   ┌─ DEVICE 2 (Riya's phone — Android, Expo) ─────────────────────────────────┐
   │  ┌─ v2.0 SYNC CLIENT ────────────────────────────────────────────────────┐ │
   │  │  · pulls remote ciphertext                                            │ │
   │  │  · derives same AES-256 key from passphrase (entered on device add)   │ │
   │  │  · decrypts locally: AES-256-GCM-DECRYPT(key, nonce, ciphertext, tag) │ │
   │  │  · on tag failure → E_WRONG_PASSPHRASE (3 tries, then 60s lockout)    │ │
   │  └────────────────────────────────────┬──────────────────────────────────┘ │
   │                                       │                                     │
   │  ┌─ local SQLite (mirror of device 1) ▼─────────────────────────────────┐ │
   │  │  · UPSERT each decrypted row by id (idempotent — BR-SYN-02 style)     │ │
   │  │  · ledger_entries: INSERT-OR-IGNORE (never UPDATE — BR-LED-01)        │ │
   │  │  · non-ledger rows: vector-clock-aware LWW (BR-SYN-01)                │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   │  ┌─ App shell (5 screens — same UI, same data) ─────────────────────────┐ │
   │  │  · sync-status pill in header (4 states — see table below)            │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   └────────────────────────────────────────────────────────────────────────────┘

   SYNC-STATUS PILL (the only sync UI surface; in the header, .glass-strong):
   ┌────────────────────────────────────────────────────────────────────────────┐
   │  state          │ dot                  │ label            │ action          │
   ├────────────────────────────────────────────────────────────────────────────┤
   │  Idle           │ ● emerald (static)   │ (none)           │ none            │
   │  Syncing        │ ● cyan (pulsing)     │ "Syncing…"       │ none (auto)     │
   │  Conflict       │ ● flare (solid)      │ "1 conflict"     │ tap → drawer    │
   │  Offline-queued │ ○ amber (hollow)     │ "12 queued"      │ none (auto)     │
   └────────────────────────────────────────────────────────────────────────────┘
   ↑ the pill is the ONLY sync UI interrupt in normal operation.
   ↑ the conflict drawer is the ONLY place sync ever interrupts the tutor.
   ↑ ledger conflicts NEVER reach the drawer (UUID append-only = no conflict).

   ↑ The sync server is a DUMB BLOB STORE (P5-A1 amendment).
     · cannot decrypt payloads
     · cannot run analytics
     · cannot surface "tutor engagement" dashboards to Buddysaradhi-the-company
     · no business model depends on reading tutor data (SYNC-E2E-1)
   ↑ The decryption key is derived from the tutor's passphrase — the same one
     used for .buddysaradhi backups (no new secret to remember).
   ↑ Adding a device requires the passphrase on the new device. Lost passphrase
     = lost sync access = recover from .buddysaradhi backup. There is NO "reset sync
     password" — that would require the server to see plaintext.
```

- ↑ **The cloud DB is ciphertext, not plaintext.** Turso stores encrypted blobs; even a full Turso compromise reveals only ciphertext without the passphrase-derived key (BR-SYN-02, SYNC-E2E-1).
- **The sync-status pill is `glass-strong`** — persistent chrome, must read over any screen (§5.5).
- **The conflict drawer uses `neumo-inset` segmented control** for "keep local / remote / both" (§8.5) — the only sync interaction that requires a tutor decision.
- **AP-10 honoured.** The server sees IP for abuse detection (rate-limiting) but never inspects payload. The `no-unexpected-network.test.ts` integration test enforces the allowlist (`10_Security.md` §24.1).

### Mockup F3 — v3.x Native-Mobile Architecture (graduation from webview)

```
v3.x NATIVE-MOBILE ARCHITECTURE — webview v1 graduates to native shells
                                   (the SAME 5 screens, the SAME 7 engines, the SAME ledger)

   ┌─ v1.0 (LAUNCH) — webview everywhere ───────────────────────────────────────┐
   │                                                                            │
   │  ┌─ Next.js PWA ─────────────────────────────────────────────────────────┐ │
   │  │  · single codebase for web + mobile (Expo webview) + desktop (Tauri)  │ │
   │  │  · iOS/Android: Expo wraps the PWA in a webview                        │ │
   │  │  · pros: 1 codebase, fast to ship, no native review friction           │ │
   │  │  · cons: webview performance ceiling on 200+ rosters; no native APIs   │ │
   │  │           (FaceID/TouchID uses Expo's bridge; biometric enrolment      │ │
   │  │           detection is slower than native)                              │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   └────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ v1.x hardening (v1.1 perf, v1.2 a11y)
                                        │ v1.4 distribution (Play Store, App Store)
                                        │
                                        ▼
   ┌─ v3.0 PREREQUISITE — on-device AI must prove the architecture ─────────────┐
   │  · NL queries, smart reminders, attendance pattern detection                │
   │  · all on-device; no cloud LLM; AP-5, AP-10 honoured                        │
   │  · graduation gate: v3.0 ships BEFORE v3.x native shells begin              │
   └────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ v3.1 NATIVE iOS SHELL ────────────────────────────────────────────────────┐
   │  ┌─ SwiftUI app ─────────────────────────────────────────────────────────┐ │
   │  │  · shares TypeScript business logic via a JS bridge (the 7 engines)    │ │
   │  │  · native UI components (SwiftUI) for the 5 screens                    │ │
   │  │  · .glass surfaces → SwiftUI .ultraThinMaterial                        │ │
   │  │  · .neumo-raised controls → SwiftUI .bordered + custom shadow           │ │
   │  │  · biometric: native LocalAuthentication (faster enrolment detection)  │ │
   │  │  · local SQLite: SQLCipher via native binding (no webview SQL)         │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   │  · the 5 screens are 1:1 with the web version (P2 — five screens, forever) │
   │  · the 7 engines are the same TypeScript modules, bridged                   │
   │  · the ledger schema is identical (BR-LED-01..L06 unchanged)               │
   └────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ v3.2 NATIVE ANDROID SHELL ────────────────────────────────────────────────┐
   │  ┌─ Jetpack Compose app ────────────────────────────────────────────────┐ │
   │  │  · shares TypeScript business logic via a JS bridge (the 7 engines)    │ │
   │  │  · native UI components (Compose) for the 5 screens                    │ │
   │  │  · .glass surfaces → Compose .blurEffect + Material 3 surface tints    │ │
   │  │  · .neumo-raised controls → Compose .elevatedButton + custom shadow    │ │
   │  │  · biometric: BiometricPrompt (faster, native enrolment detection)    │ │
   │  │  · local SQLite: SQLCipher via native binding                          │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   │  · the 5 screens are 1:1 with the web version (P2 honoured)               │
   │  · the 7 engines are the same TypeScript modules, bridged                   │
   │  · the ledger schema is identical                                           │
   └────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ v3.3 PARENT APP (read-only native; P14 graduate) ─────────────────────────┐
   │  · the parent's signed URL experience, packaged as a native app            │
   │  · still no parent account (AP-8 honoured)                                 │
   │  · the app scans a QR or accepts a deep link from the tutor                │
   │  · renders the same read-only web view as v2.1, but in a native shell     │
   │  · push notifications: "New receipt from Riya Ma'am" (opt-in)              │
   └────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ v3.4–v3.6 (later) ────────────────────────────────────────────────────────┐
   │  · v3.4 Tablet layouts (iPad / Android tablet; responsive breakpoints)    │
   │  · v3.5 Live class integration (Zoom/Meet link-sharing; never build)      │
   │  · v3.6 White-label (deferred; dilutes brand in v1)                        │
   └────────────────────────────────────────────────────────────────────────────┘

   ↑ The native shells share the TypeScript business logic (7 engines + ledger
     schema + sync client) via a JS bridge. The UI is native; the brain is shared.
   ↑ P2 (five screens, forever) is preserved — the native shells have exactly
     the same 5 screens as the web version. No 6th screen appears.
   ↑ The .glass → SwiftUI .ultraThinMaterial / Compose .blurEffect mapping is
     documented in 13_UI_Guidelines.md §18 (Implementation Contracts). The
     neumorphic recipes map to native shadow + elevation tokens.
   ↑ v3.x cannot ship until v3.0 on-device AI proves the architecture. The
     graduation gate is explicit (§Graduation Criteria); a v3.x slip is a
     deferred release, not a rushed one.
```

- ↑ **The native shells are a polish, not a rewrite.** The TypeScript business logic (7 engines + ledger + sync) is shared via a JS bridge; only the UI is native. A v3.x bug in the ledger engine is the same bug as on web — fix once, ship to all surfaces.
- ↑ **The 5-screen ceiling holds.** v3.x native shells have exactly the same 5 screens as v1 web. P2 is preserved across the graduation.
- ↑ **Glass + neumorphic map to native tokens.** SwiftUI `.ultraThinMaterial` ≈ `.glass-strong`; Compose `.blurEffect` ≈ `.glass`. The neumorphic dual-shadow maps to SwiftUI/Compose elevation + custom shadow. The mapping is documented in `13_UI_Guidelines.md` §18.

---

## The Long View (closing)

> *"A tutor should be able to run their entire tuition business from five screens."*

That sentence is the constitution. v1.x densifies the five. v2 multiplies the *devices*, not the screens. v3 adds *intelligence*, still through the five. v4 adds *users*, with the sixth surface strictly gated to federation admins. If a future version ever ships a sixth screen for a solo tutor, we have failed the vision.

The roadmap is not a promise to build everything on it. It is a promise to *not* build the wrong things, and to build the right things only when the doctrine permits. The deliberately-deferred items are the load-bearing wall. The graduation gates are the inspection regime. The Explicitly Never List is the moat. Build it right. Build it secure. Then keep it to five screens — for the tutor, forever.
