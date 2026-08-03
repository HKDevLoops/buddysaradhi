# Desktop Platform — README

> Orientation index for the Buddysaradhi desktop app (Tauri v2 + Rust). This directory is the single source of truth for the next desktop agent or Tauri/Rust engineer picking up the build end-to-end. Read this file first, then jump to the file your task maps to via the decision tree in §4.

---

## 1. What This Is

Buddysaradhi: Omni-Core ships as one product across three surfaces — Web (Next.js 16, primary, ships first), Mobile (Expo, v1.x), and **Desktop (Tauri v2 + Rust, v1.x — this directory)**. The desktop app is *not* a thin wrapper around the web app; it is a native binary with a Rust backend, a static-export React frontend, OS-level biometric unlock, SQLCipher at rest, and an auto-updater backed by Vercel Blob. It opens from a 12 MB `.msi` on Windows, a 14 MB `.dmg` on macOS, and a 14 MB `.AppImage` on Linux. It runs the same five screens, the same seven engines, the same ledger grammar, and the same Vibrant Glass design system as the web app — only the runtime and the security envelope differ.

The desktop app exists because a tutor who runs a coaching institute from a laptop deserves a native window, OS biometric unlock, real window vibrancy behind their glass panels, and a binary they can install once and update silently. Electron gives them none of that at < 15 MB; Tauri v2 gives them all of it.

The landing page (`src/app/page.tsx`) advertises the desktop surface in its `ARCHITECTURE` constant as `"Tauri v2 · Rust"` with the headline `<15MB installer, native memory, Rust-level IPC security, SQLCipher at rest.` This directory is the spec that promise is held to.

---

## 2. Stack at a Glance

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2.x** | 12–14 MB installers; native WebView2 (Windows) / WebKit (macOS) / WebKitGTK (Linux); no Node runtime shipped. |
| Backend | **Rust 1.82+** | Memory safety, no GC pauses on the ledger path, mature SQLite + crypto crates. |
| Local DB | **rusqlite + SQLCipher** | At-rest encryption; the SQLCipher key is held in the OS keychain, never on disk. |
| Sync | **libsql HTTP client** | Same embedded-replica pattern as mobile (poll every 30s, append-only ledger, LWW for non-ledger rows per `BR-SYN-03`). |
| Frontend | **React + Vite (static export)** | NOT the Next.js server build — Tauri doesn't run a Node server. Shares the `@buddysaradhi/ui` workspace package with the web app. |
| Router | **react-router v6** (5 client-side routes) | Not Next.js App Router — there is no server. |
| State | **Zustand** | Same as the web app; same store shapes; reads/writes via Tauri `invoke` instead of server actions. |
| Forms | **react-hook-form + Zod** | Same Zod schemas as `packages/shared`; never submit before validation. |
| Updater | **tauri-plugin-updater** | Manifest served from Vercel at `https://buddysaradhi.app/api/releases/desktop/stable`; binaries hosted on Vercel Blob. |
| Secure storage | **tauri-plugin-store + keyring crate** | OS keychain for the SQLCipher key + Supabase refresh token + Turso `db_token`. |
| Window chrome | **dark title bar, vibrancy (macOS), mica (Windows 11)** | Real glass behind the `glass-strong` modal tier per `13_UI_Guidelines.md` §5.2. |
| Code signing | EV cert (Windows), Developer ID Application + notarization (macOS), GPG (Linux, optional) | See `04_Code_Signing.md`. |

Bundle targets: Windows `.msi` ≤ 12 MB · macOS `.dmg` (universal) ≤ 14 MB · Linux `.AppImage` ≤ 14 MB. These are non-negotiable; if a PR crosses the line it ships a `chore(deps): trim bundle` follow-up before the next release.

---

## 3. File Index (This Directory)

| File | Purpose | Target reader | Governs code in |
|---|---|---|---|
| `README.md` (this file) | Orientation index, stack snapshot, decision tree, where-to-start. | Any new desktop agent — read first. | n/a |
| `01_Architecture.md` | Tauri v2 architecture, project layout, static-export frontend, the 5-screen route map, command allowlist, window config, bundle-size targets. | Engineer scaffolding the workspace. | `apps/desktop/`, `tauri.conf.json`, `src-tauri/tauri.conf.json` |
| `02_Rust_Core.md` | Rust backend: `main.rs`, `AppState`, rusqlite + SQLCipher, libsql sync, migration runner, the 7 Tauri commands, the typed `Error` enum. | Rust engineer implementing commands. | `src-tauri/src/main.rs`, `src-tauri/src/commands/*.rs`, `src-tauri/migrations/` |
| `03_IPC_Security.md` | Tauri IPC + security model: command allowlist, CSP, origin validation, keychain, Argon2id backup params, audit log, no remote code, file scope. | Security reviewer + Rust engineer. | `src-tauri/capabilities/*.json`, `tauri.conf.json` `security` block. |
| `04_Code_Signing.md` | Windows EV + SignTool, macOS Developer ID + notarization + stapling, Linux GPG, GitHub Actions workflows, private-key handling. | Release engineer / DevOps. | `.github/workflows/desktop-*.yml`, `signing secrets`. |
| `05_Updater.md` | `tauri-plugin-updater`, Vercel-hosted manifest, Vercel Blob binary URLs, signature verification, channels, rollback, cadence, never-interrupt rule. | Release engineer + Rust engineer wiring the updater. | `tauri.conf.json` `plugins.updater`, `src-tauri/src/updater.rs`, `apps/web/app/api/releases/desktop/*`. |
| `06_Installers.md` | Per-OS installer formats: WiX `.msi`, universal `.dmg`, `.AppImage` + `.deb` (+ optional `.rpm`), file association, uninstall behaviour, auto-launch on login. | Release engineer + Tauri config owner. | `src-tauri/nsis-installer/Buddysaradhi.wxs`, `src-tauri/dmg/`, `src-tauri/tauri.conf.json` `bundle` block. |
| `AGENTS.md` | Handoff instructions for the next desktop agent: prime directive, where to start, file map, code style, testing protocol, stop-and-ask triggers, glossary, what "done" means. | The next AI agent or human engineer. | All of `apps/desktop/` and `src-tauri/`. |

---

## 4. Where to Start — Decision Tree

```
                ┌─────────────────────────────────────────────────────────┐
                │  What is your task on the desktop app?                  │
                └─────────────────────────────────────────────────────────┘
                                       │
   ┌──────────────┬───────────────────┼────────────────┬──────────────────┐
   ▼              ▼                   ▼                ▼                  ▼
"Scaffold the   "Add a Rust         "Wire up the     "Ship a signed     "Add a new
 workspace"     command / DB work"  updater"         release"           Tauri permission
   │              │                   │                │                  or native dep"
   ▼              ▼                   ▼                ▼                  ▼
 README →      README →             README →          README →            README →
 01_Arch        01_Arch →             05_Updater →     04_Code_Signing →   03_IPC_Security
                02_Rust_Core →        04_Code_Signing  06_Installers       (then STOP and
                03_IPC_Security                         05_Updater         ask per AGENTS §8)
```

**Every reader** also reads `AGENTS.md` last — it tells you when to stop and escalate (e.g. any new Tauri permission, any new native dependency, any change to the SQLCipher key derivation, any indigo/blue color, any 6th screen).

### 4.1 Reading Order

If you are starting fresh (no specific task yet), read in this order:

1. **`README.md`** (this file) — orientation, stack snapshot, decision tree.
2. **`01_Architecture.md`** — workspace, project layout, route map, allowlist. Skim §6 (command allowlist) and §9 (bundle-size targets); these set the constraints everything else works inside.
3. **`02_Rust_Core.md` §1–§5** — `AppState`, the SQLCipher init, the migration runner, and the seven Tauri commands. This is the bridge contract the frontend invokes.
4. **`03_IPC_Security.md` §1–§4** — capabilities, CSP, origin validation. Read this *before* you add any new command; the allowlist is the first line of defence.
5. **`05_Updater.md` §1–§3** — manifest format, channel switch, signature. Read this before you ship anything; the updater is what makes a release a *release* rather than a one-shot install.
6. **`04_Code_Signing.md` §1–§4** — EV cert, Developer ID, notarization, GPG. Read this before a release; an unsigned binary is a release blocker, not a release.
7. **`06_Installers.md` §1–§4** — WiX `.msi`, `.dmg`, `.AppImage`/`.deb`. Read this when you need to change install paths, file associations, or auto-launch.
8. **`AGENTS.md`** — the stop-and-ask triggers, the glossary, the "what done means" checklist. Read this last and keep it open while you work.

If your task is narrow ("add a Rust command", "fix a signing bug"), the decision tree points you at the two or three files you need; you do not need to read all eight in order.

---

## 5. The 5-Screen Route Map (Mirror of the Web App)

The desktop app has exactly five client-side routes, matching the web app's five screens (`02_Core_Logic.md` §1.1 + §5; top-level `AGENTS.md` §2 Rule 4). There is no sixth route; a sixth is a build error and an `AGENTS.md §2 Rule 4` violation.

| Route | Screen | Primary Rust commands invoked |
|---|---|---|
| `/dashboard` | Dashboard (KPIs, due today, weekly sparkline) | `get_kpis`, `get_recent_activity`, `get_reminders` |
| `/students` | Students (roster, detail drawer, ledger timeline) | `get_students`, `get_student`, `create_student`, `update_student`, `archive_student` |
| `/attendance` | Attendance (date picker, batch grid, 24h lock) | `get_attendance_session`, `mark_attendance`, `lock_attendance_session`, `unlock_attendance_session` |
| `/fees` | Fees & Payments (paid/unpaid/partial matrix, ledger, receipt) | `get_fee_matrix`, `record_payment`, `void_ledger_entry`, `get_receipt_pdf` |
| `/settings` | Settings (profile, security, backups, sync, rules, advanced) | `get_settings`, `update_settings`, `create_backup`, `restore_backup`, `get_audit_log` |

A global command palette (Ctrl+K) and `G+1..5` keyboard jumps (mirroring the web app's `G+key` shortcuts) live in a `GlassShell` component shared via `@buddysaradhi/ui`.

---

## 6. The 7 Tauri Commands (Bridge Contract)

The frontend may invoke exactly seven commands. Every other operation is composed from these. The full Rust signatures, error handling, and audit-logging rules are in `02_Rust_Core.md` §6–§8.

1. `get_students(filter)` → `Vec<Student>`
2. `create_student(input)` → `Result<Student, Error>`
3. `record_payment(input)` → `Result<LedgerEntry, Error>` (BR-LED-06, BR-FEE-04/15)
4. `void_ledger_entry(id)` → `Result<LedgerEntry, Error>` (BR-LED-04/05/07)
5. `mark_attendance(day, marks)` → `Result<AttendanceRow, Error>` (BR-ATT-01/03/07)
6. `create_backup(password)` → `Result<BackupFile, Error>` (BACKUP-1, BR-IMP-01)
7. `restore_backup(file, password)` → `Result<RestoreSummary, Error>` (BR-IMP-02/05)

Read-only helpers (`get_kpis`, `get_audit_log`, etc.) are listed in `02_Rust_Core.md` §6.2 — they share the same IPC channel but are not on the sensitive-mutation allowlist.

---

## 7. Cross-References to Top-Level Specs

The desktop docs cite the existing 19-file master spec (00–22, with 20–22 added in the automation-testing + redundancy-audit pass) by file name + section ID. The most-cited cross-references:

- `00_Vision.md` — product framing, sovereign-data doctrine.
- `01_Product_Principles.md` — P1..P15 + AP-1..AP-12. P2 (5 screens), P4 (immutable ledger), P5 (offline-first), P6 (integer paise), P11 (security is tactile), P15 (accessibility) are the load-bearing ones for desktop.
- `02_Core_Logic.md` §19 — the three-platform binding table; desktop column.
- `09_Backup_and_Import_Export.md` — `.buddysaradhi` envelope (BSR1 magic + salt(16) + nonce(12) + tag(16) + ciphertext; AES-256-GCM + Argon2id m=64 MiB / t=3 / p=2).
- `10_Security.md` §5 (data at rest, SQLCipher), §14 (desktop security posture), §15 (backup crypto).
- `11_Data_Model.md` — schema (UUID v7, integer paise, `tenant_id`, append-only ledger).
- `12_Business_Rules.md` — BR-LED-*, BR-SYN-*, BR-SEC-*, BR-IMP-*, BR-ATT-*, BR-FEE-*.
- `13_UI_Guidelines.md` §2 (palette), §5 (glass tiers), §14 (responsive breakpoints — desktop = `lg`/`xl`/`2xl`).
- `14_Edge_Cases.md` — EC-SY-*, EC-SEC-*, EC-AU-02 (silent failures).
- `15_Future_Roadmap.md` — v1.4 distribution milestone; v3.2 desktop widget (menu bar / tray).
- `AGENTS.md` (top-level) — the 10 non-negotiable rules; §3 file map (`apps/desktop`); §3.2 desktop stack snapshot.

---

## 8. Stop-and-Ask Triggers (Read Before Coding)

Per `AGENTS.md` §8, the desktop agent stops and asks a human reviewer before proceeding on any of:

1. Adding a new Tauri permission or broadening an existing one.
2. Adding a new native (Rust) dependency.
3. Changing the SQLCipher key derivation (params, keychain entry name, derivation flow).
4. Adding a 6th top-level route or a 6th window.
5. Any use of indigo/blue as a primary accent (`#4F46E5`, `blue-600`, etc.) — see `desktop/AGENTS.md` §6.
6. Any change to the ledger schema, the backup envelope, or the audit-log trigger.
7. Any new outbound network call (the CSP allowlist in `03_IPC_Security.md` §3 must be updated first).

The local `desktop/AGENTS.md` file expands these into a desktop-specific protocol.

---

## 9. What "Done" Means for the Desktop App

The desktop app is done when **all** of the following are true (mirror of top-level `AGENTS.md` §12, specialized for desktop):

- `cargo fmt --check` passes; `cargo clippy -D warnings` passes; `cargo test` passes.
- `bun run lint` and `bun run typecheck` pass on the shared `@buddysaradhi/ui` package and the desktop frontend.
- The app builds on all three OSes (Windows x86_64, macOS universal, Linux x86_64) in CI.
- The binary is EV-signed (Windows), Developer-ID-signed + notarized + stapled (macOS), GPG-signed (Linux, optional).
- The updater manifest on Vercel Blob matches the shipped version; a manual end-to-end update test passes on all three OSes.
- The 5-screen golden-path flow works in a fresh install + a restore-from-backup install.
- `worklog.md` is appended with a `---`-delimited entry per the top-level `AGENTS.md` §9.
- No `AGENTS.md` §2 non-negotiable is violated (the big three for desktop: append-only ledger, no new Tauri permission without review, no indigo/blue accent).

The rest of this directory tells you how to get there. Start at `01_Architecture.md`.

---

## 10. Platform Directory Cross-References

The desktop app is one surface of a five-surface product (Web, Mobile, Desktop, Deployment, Product). The four adjacent platform directories each own a slice of the desktop story; this section names the slices so you do not have to grep for them.

### 10.1 `product/04_Download_Hub.md` — Commercial Download Hub

The product spec for the user-facing download cards. The download hub at `buddysaradhi.app/#download` (and the mirror at `/download`) is what a tutor clicks before they ever run an installer. The Mac and Windows cards in that hub link directly to the Vercel Blob URLs for the `.dmg` and `.msi` produced by the build in `desktop/04_Code_Signing.md` and assembled by `desktop/06_Installers.md`. The card metadata (version, file size, OS minimum, SHA-256, changelog link) is read from the same Vercel Blob paths the updater polls — so the download hub and the updater agree on what "the latest stable" means.

- Read `product/04_Download_Hub.md §2` for the five-card layout (Web / macOS / Windows / Android / iOS).
- Read `product/04_Download_Hub.md §6` for the expandable install guides that ship on the cards.
- Read `product/04_Download_Hub.md §8` for the bandwidth-budget math that constrains installer size.

### 10.2 `deployment/02_Vercel_Blob_Build_Storage.md` — Blob Storage Layout

The canonical spec for the Vercel Blob bucket layout (`buddysaradhi-releases/desktop/{windows,macos,linux}/…`), the manifest schema (`manifests/desktop-stable.json`, `manifests/desktop-staging.json`), the upload workflow, the atomic update pattern, the staging→stable promotion, the retention policy, and the access-control model. `desktop/05_Updater.md` is the consumer-side contract; `deployment/02` is the producer-side contract. Together they define the full updater lifecycle.

- Read `deployment/02 §2` for the bucket layout (where each installer lives).
- Read `deployment/02 §4` for the full manifest schema — `version`, `pub_date`, `release_notes_url`, `minimum_auto_update_from`, `platforms` (per-platform `url` + `signature`), `sha256` (per-platform hash for the download hub's secondary check), `metadata` (build provenance).
- Read `deployment/02 §5` for the atomic-update pattern (upload-then-swap, never overwrite in place).
- Read `deployment/02 §6` for the staging→stable promotion (copy the staging manifest to the stable manifest — atomic, no rebuild).
- Read `deployment/02 §11` for the "what if Blob goes down" plan (CDN-cached manifests keep updates working through a Blob outage; new installs redirect to a GitHub Releases mirror).

### 10.3 `deployment/04_Release_Pipeline.md` — Release Flow

The release pipeline that ties everything together: the `bun run version:bump` script, the release types (PATCH / MINOR / MAJOR), the release cadence, the 15-item release checklist, the rollback playbook (web / mobile OTA / mobile native / **desktop manifest edit**), the hotfix branch strategy, and the "same version on the same day" coordination rule across all three surfaces.

- Read `deployment/04 §5` for the 15-item release checklist (desktop items are 4, 7, 9, 12).
- Read `deployment/04 §6.4` for the desktop rollback play (edit the stable manifest to point at an older installer URL — no rebuild, no re-sign).
- Read `deployment/04 §7` for the hotfix branch strategy (hotfix branch off the release tag, merge-back to `main`, never skip CI).
- Read `deployment/04 §8` for the "same version on the same day" rule and its exceptions.

### 10.4 The Tauri Updater Manifest — Served from Vercel Blob

The updater manifest is the keystone that locks desktop to the rest of the platform. The contract in one paragraph:

1. The Tauri updater polls `https://buddysaradhi.app/api/releases/desktop/stable` (the user-facing URL).
2. The web app's Next.js rewrite rule routes that URL to the canonical Blob object at `https://buddysaradhi-releases.vercel-storage.com/manifests/desktop-stable.json` (per `deployment/02 §2` + `§4`).
3. The manifest carries per-platform `{ url, signature }` pairs. Each `url` points to a Vercel Blob object at `https://buddysaradhi-releases.vercel-storage.com/desktop/<os>/Buddysaradhi-<version>-<arch>.<ext>`. The `signature` is a base64-encoded Ed25519 detached signature produced by `tauri signer sign` at build time.
4. The binary's signature is verified against the public key pinned in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The trust root is the pinned pubkey, not the manifest URL.
5. The staging channel follows the same flow with `manifests/desktop-staging.json` (per `deployment/02 §4.4` and `desktop/05_Updater.md §9`).
6. The download hub at `product/04_Download_Hub.md` reads the same Blob paths to render its cards — so the hub's "v1.4.0 · 14 MB" caption and the updater's "v1.4.0 available" prompt are guaranteed to agree, because they read the same bytes from the same object.

This means: a single manifest upload in CI (per `deployment/02 §3` and `desktop/04_Code_Signing.md` §6) atomically (a) updates the download hub cards, (b) prompts existing installs to auto-update, and (c) advances the `latest` symlink that the landing page's `<DownloadHub />` component renders. One upload, three surfaces, zero drift.

---

## 11. Cross-Platform Surface Coordination

The desktop app shares its five-screen route map, its ledger grammar, and its design system with the web and mobile surfaces. The three surfaces ship on the same day at the same version (`deployment/04_Release_Pipeline.md §8.1`); the desktop-specific coordination points are:

- **Web** (`web/01_Architecture.md`) owns the Next.js API routes the desktop updater polls (`/api/releases/desktop/<channel>`) and the landing page download hub. The desktop frontend shares the `@buddysaradhi/ui` workspace package with the web app — same React components, same Zustand store shapes, same Zod schemas, same Vibrant Glass design tokens. Only the runtime (Tauri WebView vs. browser) and the IPC bridge (`invoke` vs. server actions) differ.
- **Mobile** (`mobile/01_Architecture.md`) shares the libsql embedded-replica sync pattern, the SQLCipher-at-rest model, and the biometric-unlock flow. Desktop and mobile are siblings; web is the cousin.
- **Deployment** (`deployment/README.md`) owns the release pipeline, the Blob storage, the GitHub Actions workflows, and the rollback playbooks. The desktop release is item 4 of the 15-item release checklist (`deployment/04 §5`).
- **Product** (`product/README.md`) owns the commercial download hub (`product/04_Download_Hub.md`) and the user-facing install instructions. The desktop cards in that hub link to the same Vercel Blob URLs the updater polls.

---

*This README is the orientation index. If you find a contradiction between this file and a numbered spec (01–06), the numbered spec wins — and you amend this README to match. If you find a contradiction between a numbered spec and `deployment/02_Vercel_Blob_Build_Storage.md` on the manifest schema, `deployment/02` wins — and you amend the numbered spec to match. The order matters.*

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers the two orientation artefacts this README owns: the file-index decision tree (which spec to read first for a given task) and the platform cross-reference diagram (how desktop binds to the other four platform directories).

### 12.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** if it is a *control* the user manipulates, it is **neumorphic**; if it is a *surface* the user reads, it is **glass**. The desktop window chrome is the cosmic canvas (`#0f0c29 → #24243e → #0a0a1a` per §2.2) — the same canvas the web and mobile apps render against. Desktop-only visual primitive: real OS vibrancy (macOS `NSVisualEffectView`, Windows 11 Mica) augments the `glass-strong` tier (`13_UI_Guidelines.md` §5.5 — top header bar, sidebar, modals).

**Glass surfaces in the desktop UI (§5.5 coverage map excerpt):**

| Surface | Glass tier | Where specified |
|---|---|---|
| Window root (cosmic canvas) | (none — raw gradient) | `13_UI_Guidelines.md` §2.2 |
| Top header bar (sticky) | `.glass-strong` | `13_UI_Guidelines.md` §5.5, `desktop/01 §5.1` |
| Sidebar (5 routes + sync chip) | `.glass-strong` | `13_UI_Guidelines.md` §5.5, `desktop/01 §4` |
| KPI / list / feed cards | `.glass` + 2px accent left-border (§5.4) | `13_UI_Guidelines.md` §8.1, `04_Dashboard.md §4` |
| List rows (students, ledger entries) | `.glass-faint` | `13_UI_Guidelines.md` §8.4, `05_Students.md §5` |
| Modal / sheet (Record Payment, Add Student, Restore Backup) | `.glass-strong` + backdrop | `13_UI_Guidelines.md` §8.7 |
| Toast (update available, sync conflict) | `.glass-strong` + 4px accent left-bar | `13_UI_Guidelines.md` §8.8 |
| Footer (sync state · version · ©) | `.glass-faint` (sticky per §13) | `13_UI_Guidelines.md` §13 |

**Neumorphic controls in the desktop UI (§6.6 coverage map excerpt):**

| Control | Recipe | Where specified |
|---|---|---|
| Primary CTA (Record Payment, Add Student, Save) | `.neumo-raised` + emerald glow | §6.6, §8.2 |
| Toggle (auto-launch, biometric, density) | `.neumo-inset` well + raised knob | §6.4, §6.6, §8.16 |
| Input field (PIN, passphrase, search) | `.neumo-inset` + cyan focus ring | §6.6, §8.9 |
| Segmented control (status filter, period filter) | `.neumo-inset` well + raised active pill | §6.6, §8.5 |
| Stepper (± attendance counts) | `.neumo-inset` well + raised ± buttons | §6.6, §8.18 |

> **References.** Tauri 2 window/vibrancy docs (tauri.app); Apple Human Interface Guidelines — Materials (developer.apple.com); Microsoft Mica material docs (learn.microsoft.com); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "`backdrop-filter` Performance Case Study"; Nielsen Norman Group — "Wireframing for UX Design". The mockups below are the contract; the prose above is the rationale.

### 12.2 M1 — File-Index Decision Tree

```
┌────────────────────────────────────────────────────────────────────────────┐
│  What is your task on the desktop app?                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  ░░░ header (.glass-strong, sticky, 64px) ░░░                        │  │
│  │  ░  Buddysaradhi  Desktop Platform · README §4 decision tree        ✕  ░  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                                 │
   ┌──────────────┬──────────────┼──────────────┬──────────────┬─────────────┐
   ▼              ▼              ▼              ▼              ▼             ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ Scaffold   │ │ Add a Rust │ │ Wire the   │ │ Ship a     │ │ Add a new  │ │ Audit /    │
│ workspace │ │ command or │ │ updater    │ │ signed     │ │ Tauri      │ │ review     │
│            │ │ DB work    │ │            │ │ release    │ │ permission │ │ pass       │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      ▼              ▼              ▼              ▼              ▼              ▼
  README →      README →       README →       README →       README →       README →
  01_Arch       01_Arch →       05_Updater →   04_Code_       03_IPC_        01_Arch →
                02_Rust_Core →  04_Code_       Signing →      Security       03_IPC_   →
                03_IPC_Sec     Signing        06_Installers  (then STOP     04_Code_
                                                              and ask per   Signing →
                                                              AGENTS §8)     05_Updater →
                                                                                                                                             06_Installers →
                                                                                                                                             AGENTS
   ↑ every leaf is a .glass card (5% white, 24px blur) with a 2px accent left-border (§5.4)
   ↑ accent per branch: emerald = scaffold, cyan = wire, amber = release, flare = security stop
   ↑ the "STOP and ask" leaf carries a flare border — that path requires human review (§8)
   ↑ every reader also reads AGENTS.md last (the stop-and-ask triggers + glossary)
```

### 12.3 M2 — Platform Cross-Reference Diagram

```
                              ┌─────────────────────────────────────────┐
                              │  Buddysaradhi Omni-Core · 5 platform dirs    │
                              │  ░ root canvas: #0f0c29 → #24243e ░     │
                              └────────────────────┬────────────────────┘
                                                   │
              ┌────────────────┬───────────────────┼───────────────────┬────────────────┐
              ▼                ▼                   ▼                   ▼                ▼
        ┌──────────┐     ┌──────────┐       ┌──────────┐        ┌──────────┐     ┌──────────┐
        │  web/    │     │ mobile/  │       │ desktop/ │        │deployment│     │ product/ │
        │ Next.js  │     │  Expo    │       │ Tauri v2 │        │   /      │     │   /      │
        │  16 App  │     │  React   │       │  + Rust  │        │ Vercel + │     │ landing  │
        │ Router   │     │  Native  │       │  + Vite  │        │ GH Actions│     │ page hub │
        └────┬─────┘     └────┬─────┘       └────┬─────┘        └────┬─────┘     └────┬─────┘
             │                │                  │                   │                │
             │   shares       │   shares         │  THIS             │  hosts the     │  surfaces
             │   @buddysaradhi/ui  │   libsql         │  DIRECTORY        │  Vercel Blob   │  download
             │   + Zod        │   embedded       │  (8 specs)        │  bucket +      │  cards that
             │   schemas      │   replica +      │                   │  manifests +   │  link to the
             │                │   SQLCipher      │                   │  CI workflows  │  Blob URLs
             ▼                ▼                  ▼                   ▼                ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  ░ .glass-strong band (8% white, 24px blur) — the shared design-system layer ░│
        │  13_UI_Guidelines.md §2 palette · §5 glass tiers · §6 neumorphic recipes      │
        │  §8 component vocabulary · §10 accessibility (WCAG 2.1 AA · 44px · reduced-mo) │
        └──────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  desktop/ specific bindings (cross-refs from this README §10 + §11):          │
        │   • web/01_Architecture.md        →  /api/releases/desktop/* manifest endpoint│
        │   • mobile/01_Architecture.md     →  shares libsql + SQLCipher + biometric    │
        │   • deployment/02_Vercel_Blob_…   →  bucket layout + manifest schema          │
        │   • deployment/04_Release_Pipeline→  15-item checklist (desktop = items 4,7,9,12)│
        │   • product/04_Download_Hub.md    →  Mac + Windows cards → same Blob URLs     │
        └──────────────────────────────────────────────────────────────────────────────┘
   ↑ every platform dir is a sibling; cross-refs use canonical IDs only (BR-*, EC-*, P*, AP-*)
   ↑ the .glass-strong band is the visual metaphor for the shared design system
   ↑ desktop is "the native sibling" — web is the cousin, mobile is the twin (per README §11)
   ↑ ONE manifest upload in CI (deployment/02 §3) advances (a) download hub, (b) updater prompt,
     (c) latest symlink — three surfaces, zero drift (README §10.4)
```

### 12.4 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (architecture / pipeline) | M1 decision tree, M2 cross-reference diagram |
| Full-screen layout | (n/a — README is not a screen) |
| Component anatomy | (n/a — README has no UI components) |
| State matrix | (n/a — README has no interactive controls) |

> Both mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 78–84 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5; neumorphic recipes referenced in the design-system callout above. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.4`, `§6.6`, `§8`, `§8.1`–`§8.18`, `§10`, `§13`, `§14`, `BR-SYN-01`, `BR-LED-01`, `P5`, `P6`, `P11`).
