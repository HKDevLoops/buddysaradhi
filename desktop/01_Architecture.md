# 01 — Architecture (Tauri v2 + Rust)

> The desktop app is a Tauri v2 binary: a Rust backend + a static-export React frontend, running in the OS's native WebView. This file is the architecture contract — project layout, why Tauri (not Electron), the static-export rule, the five-screen route map, the command allowlist, window configuration, bundle-size targets, and the cross-references into the master spec that govern each decision.

Cross-references: `00_Vision.md` (Omni-Core, three surfaces), `02_Core_Logic.md` §19 (three-platform binding table), `10_Security.md` §14 (desktop security posture), `11_Data_Model.md` (schema), `13_UI_Guidelines.md` §2/§5/§14 (palette, glass tiers, breakpoints), `15_Future_Roadmap.md` v1.4 (distribution milestone). The 10 non-negotiable rules in top-level `AGENTS.md` §2 apply unchanged.

---

## 1. Why Tauri v2 (Not Electron)

The landing page (`src/app/page.tsx`) advertises the desktop surface as `"Tauri v2 · Rust"` with the headline `<15MB installer, native memory, Rust-level IPC security, SQLCipher at rest`. Every architectural decision in this file is downstream of that promise. Tauri v2 wins on four axes that matter for Buddysaradhi:

**1. Installer size.** A minimal Electron app — an empty BrowserWindow — ships a 90–150 MB installer because it bundles a full Chromium content module + Node runtime. Tauri v2 ships a 12–14 MB installer because it uses the OS's native WebView (WebView2 on Windows 10+, WebKit on macOS, WebKitGTK on Linux) and ships zero Node. For a tutor in Nagpur on a 4G connection paying per MB, the difference between a 12 MB download and a 150 MB download is the difference between "I'll install it now" and "I'll install it at the office." Bundle-size targets in §9 are non-negotiable for this reason.

**2. Memory footprint.** Electron's baseline RSS is ~200 MB (Chromium + Node + V8 + the app). Tauri's baseline is ~45–80 MB (the Rust process + the OS WebView process, which the OS already has running for other apps). On a tutor's 8 GB laptop running Zoom + a browser + Buddysaradhi, that 120 MB delta is the difference between "the app feels snappy" and "the app feels like a small planet."

**3. Rust backend = memory safety + zero Node runtime.** The ledger path is the financial spine (`12_Business_Rules.md` BR-LED-01..10). Running it in Rust means: no GC pauses mid-INSERT, no `undefined is not a function` on the money path, no prototype-pollution surface in the DB layer, and `unsafe` is opt-in and reviewable. The Rust type system catches the `number` vs `bigint` money bug at compile time — the bug that ships as float-paise in JS-only stacks (`AGENTS.md` §2 Rule 6).

**4. IPC security by allowlist.** Tauri v2's capability system (`03_IPC_Security.md`) requires every frontend→Rust call to be explicitly named in `tauri.conf.json`. Wildcards are rejected. There is no `require('child_process')` from the renderer — the renderer cannot spawn a process, ever. This is the structural answer to "could a malicious script exfiltrate the ledger?" — no, because the renderer has no path to the filesystem that isn't on the allowlist, and the allowlist has three entries total (`fs:allow-read-dir`, `shell:allow-open`, `dialog:allow-save`).

**What we lose.** Tauri cannot use Chrome-only Web APIs (no native FileSystem Access API; no PWA install prompt; no WebUSB). None of these are on the Buddysaradhi roadmap. Tauri also requires per-OS WebView quirks handling (§5) — a small cost relative to the size and memory wins.

---

## 2. Project Layout

The desktop app lives at `apps/desktop/` in the monorepo (per top-level `AGENTS.md` §3 file map). The layout below is the contract — every file is named, every directory has a single purpose.

```
apps/desktop/
├── src/                           # Frontend (static export of a Vite + React app)
│   ├── main.tsx                   # React entry; mounts <App/> into #root
│   ├── App.tsx                    # <RouterProvider> with 5 routes
│   ├── routes/                    # The 5 client-side routes (react-router v6)
│   │   ├── dashboard.tsx
│   │   ├── students.tsx
│   │   ├── attendance.tsx
│   │   ├── fees.tsx
│   │   └── settings.tsx
│   ├── shell/                     # GlassShell, sidebar, command palette, toasts
│   │   ├── GlassShell.tsx         # Shared with web via @buddysaradhi/ui
│   │   ├── sidebar.tsx
│   │   └── command-palette.tsx
│   ├── lib/                       # invoke wrappers, formatters, hooks
│   │   ├── invoke.ts              # Typed wrappers around @tauri-apps/api/core invoke()
│   │   ├── formatINR.ts           # Paise → ₹ display (mirror of web)
│   │   └── useToast.ts
│   └── styles/globals.css         # Cosmic Indigo canvas, glass tiers, bioluminescent accents
├── public/                        # Static assets bundled into the binary
│   ├── icon.png                   # 1024×1024 app icon (source of truth)
│   ├── icon.ico                   # Windows .ico (generated from icon.png)
│   └── sounds/                    # tactile press sounds (≤ 8 KB each)
├── index.html                     # Vite HTML entry
├── vite.config.ts                 # Vite config: static export, base: './'
├── tsconfig.json                  # TS strict + noUncheckedIndexedAccess (mirror of web)
├── package.json                   # "@buddysaradhi/ui" workspace dep, react-router-dom, @tauri-apps/api
└── README.md                      # one-page dev setup

src-tauri/                         # The Rust binary (sibling to src/)
├── Cargo.toml                     # crate manifest: tauri 2.x, rusqlite, libsql, argon2, aes-gcm, zeroize, keyring, thiserror, tokio, serde
├── tauri.conf.json                # THE config: bundle, security, plugins, capabilities
├── build.rs                       # Tauri build script
├── capabilities/                  # Per-window capability files (allowlist)
│   ├── main.json                  # main window: fs:allow-read-dir, shell:allow-open, dialog:allow-save
│   └── updater.json               # updater window: updater:allow-check-and-download
├── migrations/                    # Forward-only SQL migrations (mirror of top-level /migrations/)
│   ├── 0001_init.sql
│   ├── 0002_ledger_triggers.sql
│   └── ...
├── icons/                         # Generated icons (ico, icns, png) from src-tauri/icons source
└── src/
    ├── main.rs                    # tauri::Builder, app.manage(AppState), invoke_handler
    ├── lib.rs                     # re-exports for testability
    ├── state.rs                   # AppState struct
    ├── error.rs                   # thiserror::Error enum (Db, Sync, Auth, Validation, Io)
    ├── commands/                  # One file per Tauri command (the 7 + read helpers)
    │   ├── students.rs            # get_students, create_student, update_student, archive_student
    │   ├── attendance.rs          # mark_attendance, lock_attendance_session, unlock_attendance_session
    │   ├── ledger.rs              # record_payment, void_ledger_entry
    │   ├── backup.rs              # create_backup, restore_backup
    │   ├── settings.rs            # get_settings, update_settings, get_audit_log
    │   └── dashboard.rs           # get_kpis, get_recent_activity, get_reminders
    ├── db/                        # rusqlite + SQLCipher open + migrations
    │   ├── mod.rs
    │   ├── connection.rs          # open_encrypted(path, key) -> Connection
    │   └── migrator.rs            # refinery or sqlx migration runner
    ├── sync/                      # libsql HTTP client + outbox flusher
    │   ├── mod.rs
    │   ├── client.rs              # libsql::Client wrapper
    │   └── outbox.rs              # flush loop, every 30s
    ├── crypto/                    # AES-256-GCM, Argon2id, SecureBuffer (zeroize)
    │   ├── mod.rs
    │   ├── envelope.rs            # .buddysaradhi read/write (mirror of web crypto/backup.ts)
    │   └── keychain.rs            # keyring crate: SQLCipher key + Turso db_token
    ├── security/                  # PIN verify, biometric prompt, audit_log writer
    │   ├── mod.rs
    │   ├── pin.rs                 # argon2id verify against settings.pin_hash
    │   ├── biometric.rs           # tauri-plugin-biometric prompt
    │   └── audit.rs               # audit_log INSERT in same txn as mutation
    ├── updater.rs                 # tauri-plugin-updater wrapper + 3-fail rollback
    └── window.rs                  # window config: 1440×900, min 1024×600, vibrancy/mica
```

Two non-obvious rules govern this layout:

1. **`src/` (frontend) and `src-tauri/` (Rust) are siblings.** Tauri's default scaffold puts them side-by-side; the desktop app keeps that convention. The frontend is built by Vite into `dist/`, and Tauri's bundler pulls `dist/` into the binary at build time.
2. **The frontend is a static export.** It is NOT a Next.js server build. Tauri doesn't run a Node server, so SSR / Server Components / API routes are off the table. The frontend imports React, react-router, Zustand, and `@buddysaradhi/ui` — nothing else from the web app's stack.

---

## 3. The Static-Export Frontend (Critical)

The web app is a Next.js 16 App Router project with Server Components, server actions, and API routes. The desktop app cannot reuse any of that runtime — Tauri doesn't ship Node. Instead, the desktop frontend is a Vite + React app that **statically exports** to HTML/JS/CSS and is bundled into the binary.

### 3.1 What Is Shared with the Web App

The shared surface is the `@buddysaradhi/ui` workspace package — the cross-platform glass component primitives (`GlassPanel`, `NeumoToggle`, `Chip`, `BarChart`, `CommandPalette`, `Toast`, `Sheet`, `GlassShell`) defined in `13_UI_Guidelines.md` §8. The web app's `src/components/buddysaradhi/primitives.tsx` is the current reference implementation; the desktop app imports these primitives from `@buddysaradhi/ui` rather than re-implementing them.

Shared Zod schemas live in `packages/shared` (`StudentInputSchema`, `LedgerEntrySchema`, `BackupPassphraseSchema`, etc.). The desktop frontend parses every Tauri command's input through the same Zod schema the web app's server action uses — there is exactly one schema per shape, in exactly one package. (Top-level `AGENTS.md` §6.1: "Zod for all input validation. Every server action, every API route, every import row, every form submission. Types are inferred from Zod, never hand-written." Desktop adds: every Tauri `invoke` call.)

The calculation utilities (`formatINR`, `paiseAdd`, `paiseMul`, `attendancePct`) also live in `packages/shared`. The desktop app calls these directly — they are pure functions over paise integers.

### 3.2 What Is NOT Shared

- **Server Components / server actions.** The desktop app has no server. Every "server action" in the web app becomes a Tauri command invocation in the desktop app. The bridge contract is in §6 below and in `02_Rust_Core.md` §6.
- **Next.js App Router.** The desktop app uses react-router v6 with 5 client-side routes (§4). No `app/` directory, no `layout.tsx`, no RSC.
- **API routes (`/api/*`).** The desktop app has no API routes. The only outbound network calls are: libsql sync to `*.turso.io`, Supabase auth to `*.supabase.co`, and the updater check to `buddysaradhi.app/api/releases/desktop/*`. Everything else is local Rust + SQLite.
- **`z-ai-web-dev-sdk`.** The desktop app does not import the AI SDK. If a future feature needs LLM, it goes through a Tauri command that the orchestrator must approve per top-level `AGENTS.md` §8 stop-and-ask #2.

### 3.3 The Vite Build

```ts
// apps/desktop/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",                       // Tauri loads via tauri://localhost, relative base
  build: {
    outDir: "dist",
    target: "es2022",               // WebView2/WebKit 2022+ supports it
    sourcemap: false,               // ship without sourcemaps; dev uses vite dev server
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          ui: ["@buddysaradhi/ui"],
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,                     // Tauri's conventional dev port
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"], // don't reload on Rust changes
    },
  },
});
```

The `base: "./"` is critical — Tauri serves the frontend via `tauri://localhost` (or `http://localhost:1420` in dev), and absolute paths (`/assets/foo.js`) break under that scheme.

---

## 4. The 5 Client-Side Routes

The desktop app has exactly five routes — the same five screens as the web app (`AGENTS.md` §2 Rule 4; `02_Core_Logic.md` §1.1). A sixth route is a build error and a `Rule 4` violation.

```
┌─────────────────────────────────────────────────────────────────┐
│                       GlassShell (root)                         │
│  ┌──────────┐  ┌─────────────────────────────────────────────┐  │
│  │ Sidebar  │  │  <Outlet /> (one of the 5 routes)          │  │
│  │ 5 icons  │  │                                              │  │
│  │ + sync   │  │   /dashboard    KPIs, due today, sparkline  │  │
│  │   chip   │  │   /students     Roster + detail drawer      │  │
│  │          │  │   /attendance   Date picker + batch grid    │  │
│  │ ⌘K       │  │   /fees         Paid/Unpaid matrix + ledger │  │
│  │ palette  │  │   /settings     Profile, security, backups  │  │
│  └──────────┘  └─────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Footer: sync state · offline chip · version · update?  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 Route Table

| Path | Screen | Primary Tauri commands | Spec ref |
|---|---|---|---|
| `/dashboard` | Dashboard | `get_kpis`, `get_recent_activity`, `get_reminders` | `04_Dashboard.md` |
| `/students` | Students | `get_students`, `get_student`, `create_student`, `update_student`, `archive_student` | `05_Students.md` |
| `/attendance` | Attendance | `get_attendance_session`, `mark_attendance`, `lock_attendance_session`, `unlock_attendance_session` | `06_Attendance.md` |
| `/fees` | Fees & Payments | `get_fee_matrix`, `record_payment`, `void_ledger_entry`, `get_receipt_pdf` | `07_Fees_and_Payments.md` |
| `/settings` | Settings | `get_settings`, `update_settings`, `create_backup`, `restore_backup`, `get_audit_log` | `08_Settings.md` |

### 4.2 Router Configuration

```tsx
// apps/desktop/src/App.tsx
import { createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
// (or react-router v6 — the choice is left to the implementer; both work)
// The 5 routes are mounted under a single GlassShell layout.

const rootRoute = createRootRoute({ component: GlassShell });
const dashboardRoute = createRoute({ getParentRoute: rootRoute, path: "/dashboard", component: Dashboard });
const studentsRoute = createRoute({ getParentRoute: rootRoute, path: "/students", component: Students });
const attendanceRoute = createRoute({ getParentRoute: rootRoute, path: "/attendance", component: Attendance });
const feesRoute = createRoute({ getParentRoute: rootRoute, path: "/fees", component: Fees });
const settingsRoute = createRoute({ getParentRoute: rootRoute, path: "/settings", component: Settings });

const routeTree = rootRoute.addChildren([
  dashboardRoute, studentsRoute, attendanceRoute, feesRoute, settingsRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });
```

There is **no** `/` index route — the app redirects `/` → `/dashboard` on launch. The default route is persisted to `localStorage` and restored on next launch (mirror of the web app's Zustand-persisted active screen — `02_Core_Logic.md` §5).

### 4.3 Keyboard Parity with Web

The web app's `G+1..5`, `G+B`, `G+D`, `G+R`, `G+S` shortcuts (`13_UI_Guidelines.md` §10.7) work identically on desktop — same handler, same `GlassShell` component, just imported from `@buddysaradhi/ui`. The desktop app adds Ctrl+K (command palette), Ctrl+N (new student), Ctrl+, (settings), and Ctrl+Q (quit with confirmation if there are pending sync_outbox rows).

---

## 5. The Native WebView

Tauri v2 uses the OS's native WebView. The desktop app targets three:

| OS | WebView | Min version | Quirks handled |
|---|---|---|---|
| Windows 10/11 | **WebView2** (Chromium-based, installed by Edge) | WebView2 Runtime 110+ (Chromium 110+) | Bundle the Evergreen Bootstrapper in the .msi (≤ 2 MB) so first-run installs the runtime if missing. |
| macOS 11+ | **WebKit** (system WKWebView) | macOS 11 Big Sur | Vibrancy API for true glass behind `.glass-strong` panels. |
| Linux | **WebKitGTK** 2.42+ | Ubuntu 22.04 / Fedora 38 / Debian 12 | AppImage bundles the WebKitGTK runtime; .deb declares `libwebkit2gtk-4.1-0` as a dependency. |

### 5.1 The Glass Tier on Desktop = Real Window Vibrancy

On the web app, the glass tiers (`glass`, `glass-strong`, `glass-faint` per `13_UI_Guidelines.md` §5.2) are CSS-only: `rgba()` + `backdrop-filter: blur()`. On the desktop app, the `glass-strong` tier is *augmented* by real OS window vibrancy — the OS blurs the desktop wallpaper behind the window, and the React `glass-strong` panel sits on top of that blurred background. The visual effect is materially better than the web app's pure-CSS blur.

```json
// src-tauri/tauri.conf.json (excerpt)
{
  "app": {
    "windows": [{
      "title": "Buddysaradhi",
      "width": 1440,
      "height": 900,
      "minWidth": 1024,
      "minHeight": 600,
      "decorations": true,
      "transparent": false,
      "resizable": true,
      "fullscreen": false,
      "center": true,
      "theme": "Dark",
      "titleBarStyle": "Overlay",
      "hiddenTitle": true,
      "windowEffects": {
        "effects": ["mica", "sidebar"],         // Windows 11 mica
        "state": "active",
        "radius": 12,
        "color": [10, 10, 26, 255]              // #0a0a1a (Cosmic Indigo)
      }
    }]
  }
}
```

On macOS, Tauri translates `windowEffects` to `NSVisualEffectView` with `.hudWindow` material. On Linux, WebKitGTK does not support native vibrancy — the app falls back to the same `backdrop-filter` blur as the web app. This is documented in `13_UI_Guidelines.md` §5 (glass tier table) and is the only place where desktop differs from web on a visual primitive.

### 5.2 WebView quirks catalogue

- **WebView2 install on Windows**: the .msi bundles the Evergreen Bootstrapper; on first run, if `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` is missing, the bootstrapper silently installs the runtime. Adds ~2 MB to the installer.
- **macOS universal binary**: `tauri build --target universal-apple-darwin` produces a single `.dmg` that runs natively on both Apple Silicon and Intel. Required — shipping two .dmgs doubles the Vercel Blob storage and halves the user's first-run delight.
- **WebKitGTK version drift**: Ubuntu 22.04 ships WebKitGTK 2.36, Fedora 38 ships 2.42. The desktop app's manifest declares `libwebkit2gtk-4.1-0 >= 2.36` as the .deb dependency. The AppImage bundles 2.42 to avoid the distro's older version.

---

## 6. The Command Allowlist (Tauri Capabilities)

Tauri v2 uses a capability-based permission system. Every frontend→Rust call must be:

1. Defined as a Rust function with the `#[tauri::command]` attribute.
2. Listed in a `*.json` capability file under `src-tauri/capabilities/`.
3. Matched by the window's `permissions` array in `tauri.conf.json`.

Wildcards are rejected at build time. There is no `*` permission anywhere in the desktop app. The full allowlist is in `03_IPC_Security.md` §2; the three Tauri built-in permissions the desktop app uses are:

| Permission | Purpose | Scope |
|---|---|---|
| `fs:allow-read-dir` | Reading the backup directory for the "Recent backups" list in Settings | Restricted to `${APP_CONFIG_DIR}/backups/` only |
| `shell:allow-open` | Opening a generated receipt PDF in the OS's default viewer | Restricted to `*.pdf` files in `${APP_CONFIG_DIR}/receipts/` only |
| `dialog:allow-save` | The native Save dialog for backup destination picker | Single-shot, no path persistence |

Everything else — DB access, sync, crypto, biometric — is a custom Tauri command (`#[tauri::command]`), not a built-in permission. Custom commands are listed in `02_Rust_Core.md` §6.

```json
// src-tauri/capabilities/main.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Allowlist for the main Buddysaradhi window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "fs:allow-read-dir",
    "shell:allow-open",
    "dialog:allow-save",
    "biometric:allow-authenticate",
    "updater:allow-check",
    "updater:allow-download",
    "store:allow-get",
    "store:allow-set"
  ]
}
```

The `core:default` permission set is Tauri's safe default (event listeners, window metadata). Adding any permission not in the list above requires a stop-and-ask per `desktop/AGENTS.md` §8.

---

## 7. Window Configuration

```jsonc
// src-tauri/tauri.conf.json — windows block (excerpt)
{
  "app": {
    "windows": [{
      "label": "main",
      "title": "Buddysaradhi",
      "width": 1440,           // default
      "height": 900,           // default
      "minWidth": 1024,
      "minHeight": 600,
      "maxWidth": null,        // user can maximize
      "maxHeight": null,
      "resizable": true,
      "fullscreen": false,
      "center": true,
      "theme": "Dark",         // dark-only per 13_UI_Guidelines.md §2 (dark is the only mode)
      "titleBarStyle": "Overlay",
      "hiddenTitle": true,     // hide the default title; we render a glass title bar
      "decorations": true,
      "transparent": false,
      "alwaysOnTop": false,
      "skipTaskbar": false,
      "focus": true,
      "windowEffects": {
        "effects": ["mica", "sidebar"],
        "state": "active",
        "radius": 12,
        "color": [10, 10, 26, 255]
      },
      "tabbingIdentifier": null
    }]
  }
}
```

### 7.1 Why 1440×900 Default, 1024×600 Min

- **1440×900** is the MacBook Air 13" native (pre-Retina) and a comfortable window size on a 1080p Windows laptop. The web app's content max-width is 1440px (`13_UI_Guidelines.md` §14), so the desktop app's default window exactly fits the web app's max-width layout — no responsive breakpoint surprises.
- **1024×600** is the smallest netbook / iPad-landscape-equivalent. Below this, the sidebar collapses to icons-only and the KPI grid stacks to 2 columns. The app refuses to render below 1024×600 — Tauri's `minWidth`/`minHeight` enforce this at the OS level.

### 7.2 Dark Title Bar, Hidden Title

The default macOS / Windows title bar is bright and visually fights the cosmic-indigo canvas. We set `theme: "Dark"` (dark title bar on Windows, dark traffic-light background on macOS) and `hiddenTitle: true` (the default "Buddysaradhi" text title is hidden; we render a glass title bar in React that includes the sync state chip + the command palette button).

### 7.3 Vibrancy / Mica

`windowEffects.effects: ["mica", "sidebar"]` enables Windows 11's Mica material (a subtle blurred tint of the desktop wallpaper behind the window). On macOS, Tauri translates this to `NSVisualEffectView` with the `.hudWindow` material. On Linux, this is ignored — the app falls back to a solid cosmic-indigo background. The visual delta is documented in `13_UI_Guidelines.md` §5 footnote.

### 7.4 Window Persistence

The user's last window position, size, and the active route are persisted to `tauri-plugin-store` under the key `window.state` and restored on next launch. If the restored geometry is off-screen (multi-monitor disconnect), the app falls back to centered 1440×900.

---

## 8. Application State (`AppState`)

The Rust-side `AppState` (full definition in `02_Rust_Core.md` §3) is a single struct managed by `app.manage(AppState)`. Every Tauri command receives it via `State<'_, AppState>`.

```rust
// src-tauri/src/state.rs (excerpt — full version in 02_Rust_Core.md §3)
pub struct AppState {
    pub db: Mutex<Connection>,             // rusqlite + SQLCipher
    pub libsql: OnceCell<Client>,          // libsql HTTP client for sync
    pub keyring: keyring::Entry,           // OS keychain handle for SQLCipher key
    pub sync_outbox: Mutex<SyncOutbox>,    // pending mutations to flush
    pub session: Mutex<Session>,           // locked/unlocked state + fail count
    pub settings: RwLock<Settings>,        // cached settings table
}
```

The `Mutex<Connection>` is the single database handle — every Tauri command acquires the lock, runs its SQL in a transaction, and releases. SQLCipher is opened with `PRAGMA key = '...'` at startup; the key is fetched from the OS keychain (never on disk). Full details in `02_Rust_Core.md` §4 and `03_IPC_Security.md` §4.

---

## 9. Bundle-Size Targets (Non-Negotiable)

| OS | Format | Target | Hard ceiling | Current (v1.4.2) |
|---|---|---|---|---|
| Windows | `.msi` (WiX) | ≤ 12 MB | 14 MB | 11.2 MB |
| macOS | `.dmg` (universal) | ≤ 14 MB | 16 MB | 12.8 MB |
| Linux | `.AppImage` | ≤ 14 MB | 16 MB | 13.1 MB |
| Linux | `.deb` | ≤ 14 MB | 16 MB | 12.4 MB |

A PR that crosses the target ships a `chore(deps): trim bundle` follow-up before the next release. A PR that crosses the hard ceiling is blocked by CI (`bundle-size-check` job in `.github/workflows/desktop-release.yml`).

### 9.1 What's in the 12 MB Windows .msi

- Rust binary (~6 MB, stripped, LTO-enabled, panic=abort).
- Frontend bundle (~1.5 MB, gzip-compressed JS + CSS + fonts).
- WebView2 Evergreen Bootstrapper (~2 MB, downloaded-and-installed on first run if missing).
- App icons (~0.5 MB).
- WiX installer scaffolding (~2 MB).

Total: ~12 MB. The Rust binary dominates; the frontend is the second-largest chunk. Keeping the frontend bundle under 2 MB requires tree-shaking `@buddysaradhi/ui` (don't import every primitive into every route — use route-level code splitting via react-router's `lazy()`).

### 9.2 Why macOS Is Slightly Larger

The macOS `.dmg` ships a universal binary (Apple Silicon + Intel), which is ~2 MB larger than a single-arch build. We accept this — shipping two .dmgs is worse UX than a 14 MB universal.

---

## 10. The Build Pipeline (High-Level)

```
┌─────────────────────────────────────────────────────────────────┐
│  Developer pushes to main branch (tag: v1.4.2)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions matrix (3 jobs in parallel):                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ windows-latest  │  │ macos-latest    │  │ ubuntu-22.04    │  │
│  │ 1. bun install  │  │ 1. bun install  │  │ 1. bun install  │  │
│  │ 2. bun lint     │  │ 2. bun lint     │  │ 2. bun lint     │  │
│  │ 3. bun build    │  │ 3. bun build    │  │ 3. bun build    │  │
│  │ 4. cargo build  │  │ 4. cargo build  │  │ 4. cargo build  │  │
│  │    --release    │  │    --release    │  │    --release    │  │
│  │    --target     │  │    --target     │  │ 5. tauri build  │  │
│  │    x86_64-pc-   │  │    universal-   │  │    --target     │  │
│  │    windows-msvc │  │    apple-darwin │  │    x86_64-      │  │
│  │ 5. tauri build  │  │ 5. tauri build  │  │    unknown-linux│  │
│  │ 6. SignTool .msi│  │ 6. codesign .app│  │    -gnu         │  │
│  │    (EV cert)    │  │ 7. notarytool   │  │ 7. gpg --detach │  │
│  │                 │  │ 8. stapler      │  │    (optional)   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│         │                     │                     │            │
│         ▼                     ▼                     ▼            │
│  Buddysaradhi-1.4.2-x64.msi  Buddysaradhi-1.4.2.dmg   Buddysaradhi-1.4.2.AppImage │
│         │                     │                     │            │
│         └─────────────────────┴─────────────────────┘            │
│                              │                                    │
│                              ▼                                    │
│  Upload to Vercel Blob (signed URLs)                             │
│  Generate manifest at /api/releases/desktop/stable               │
│  (signature: minisign or Tauri updater signature)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Web app's download hub (vercel-hosted) links to the latest     │
│  signed binary. Desktop apps auto-update from the same manifest.│
└─────────────────────────────────────────────────────────────────┘
```

The full signing workflow is in `04_Code_Signing.md`; the updater manifest format is in `05_Updater.md`; the per-OS installer internals are in `06_Installers.md`. The producer-side Blob storage layout (where the signed binaries and the manifest live) is in `deployment/02_Vercel_Blob_Build_Storage.md` §2; the commercial download hub that surfaces these artifacts to tutors is `product/04_Download_Hub.md` §2.

---

## 11. Cross-Reference Summary

| Topic in this file | Master spec cross-ref |
|---|---|
| 5-screen route map | `02_Core_Logic.md` §1.1, `02_Core_Logic.md` §5 |
| Glass tiers + vibrancy | `13_UI_Guidelines.md` §5.2 |
| SQLCipher at rest | `10_Security.md` §5, §14.2 |
| Argon2id backup params | `10_Security.md` §15.3, `09_Backup_and_Import_Export.md` §15.2 |
| Sync (libsql, 30s poll, LWW) | `02_Core_Logic.md` §3.6, `12_Business_Rules.md` BR-SYN-01..07 |
| Append-only ledger | `12_Business_Rules.md` BR-LED-01..10, `10_Security.md` §9 |
| Integer paise | `11_Data_Model.md` §1, `12_Business_Rules.md` BR-FEE-01 |
| No telemetry | `10_Security.md` §17, TELE-1 |
| Five screens only | top-level `AGENTS.md` §2 Rule 4 |
| No indigo/blue accents | top-level `AGENTS.md` §2 Rule 5, `13_UI_Guidelines.md` §2 |
| Stop-and-ask triggers | `desktop/AGENTS.md` §8, top-level `AGENTS.md` §8 |
| Build pipeline → Blob storage layout | `deployment/02_Vercel_Blob_Build_Storage.md` §2, §3 |
| Build pipeline → commercial download hub | `product/04_Download_Hub.md` §2 |
| Build pipeline → release flow | `deployment/04_Release_Pipeline.md` §5 |

---

## 12. What This File Does NOT Cover

- **Rust command implementations** → `02_Rust_Core.md`.
- **Tauri capability JSON, CSP, origin validation, file scope** → `03_IPC_Security.md`.
- **Code signing (EV cert, notarization, GPG)** → `04_Code_Signing.md`.
- **Updater manifest, channels, rollback** → `05_Updater.md`.
- **WiX .msi, .dmg layout, .AppImage, file association, auto-launch** → `06_Installers.md`.
- **Handoff instructions, code style, glossary, what "done" means** → `desktop/AGENTS.md`.

---

*This file is the architecture contract. If the implementation diverges, this file wins — unless this file is wrong, in which case you amend this file first, then the code, then `worklog.md`. The order matters.*

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers three desktop-specific artefacts: the Tauri v2 window shell tree (the GlassShell root + sidebar + content + footer), the IPC command flow (frontend `invoke` → Rust command → SQLCipher TX → audit_log + sync_outbox → return), and the Next.js static-export embed diagram (Vite build → static dist → bundled into the Tauri binary → served via `tauri://localhost`).

### 13.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The desktop window chrome is the cosmic canvas (`#0f0c29 → #24243e → #0a0a1a` per §2.2) — the same canvas the web app renders against. Desktop-only visual primitive: real OS vibrancy (macOS `NSVisualEffectView` `.hudWindow`, Windows 11 Mica) augments the `glass-strong` tier so the top header bar + sidebar + modals read as **real glass** over the OS-blurred wallpaper, not just CSS `backdrop-filter: blur()`.

**Glass surfaces in the desktop window (§5.5 coverage map excerpt):**

| Surface | Glass tier | Where specified |
|---|---|---|
| Window root (cosmic canvas) | (none — raw gradient) | §2.2 Root Background Recipe |
| Top header bar (sticky, 64px) | `.glass-strong` + OS vibrancy | §5.5, `01 §5.1`, `01 §7.2` |
| Sidebar (5 routes + sync chip) | `.glass-strong` | §5.5, `01 §4` |
| Content cards (KPIs, roster, fee matrix) | `.glass` + 2px accent left-border (§5.4) | §5.4, §8.1 |
| List rows (students, ledger entries) | `.glass-faint` | §5.5, §8.4 |
| Modal / sheet (PIN prompt, record payment) | `.glass-strong` + `bg-black/60` backdrop | §5.5, §8.7 |
| Footer (sync state · version · ©) | `.glass-faint` (sticky per §13) | §13 |

**Neumorphic controls in the desktop window (§6.6 coverage map excerpt):**

| Control | Recipe | Where specified |
|---|---|---|
| Primary CTA (Add Student, Record Payment) | `.neumo-raised` + emerald glow | §6.6, §8.2 |
| Sidebar nav item (active) | `.neumo-pressed` + cyan glow | §6.3, §6.6 |
| Toggle (auto-launch, biometric, density) | `.neumo-inset` well + raised knob | §6.4, §8.16 |
| Input field (search, PIN) | `.neumo-inset` + cyan focus ring | §6.6, §8.9 |

> **References.** Tauri 2 windowing + vibrancy docs (tauri.app); Apple Human Interface Guidelines — Materials (developer.apple.com/design/human-interface-guidelines/materials); Microsoft Mica material docs (learn.microsoft.com/windows/apps/design/style/mica); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "`backdrop-filter` Performance Case Study"; Nielsen Norman Group — "Wireframing for UX Design". The mockups below are the architecture contract; the prose above is the rationale.

### 13.2 M1 — Tauri v2 Window Shell Tree

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│  ░░ Tauri v2 window (1440×900 default, 1024×600 min, dark title, hiddenTitle)  ░░│
│  ░░ windowEffects: mica (Win11) / NSVisualEffectView.hudWindow (macOS)         ░░│
│  ░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)                          ░░│
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│  ┌─ Header (.glass-strong, sticky top-0, z-30, 64px) ──────────────────────────┐ │
│  │  ◈ Buddysaradhi   Dashboard   Students   Attendance   Fees   Settings    🔍 ⌘K  │ │
│  │                            ═════════                                            │ │
│  │                            ↑ cyan 2px underline, tab-underline-slide (§7.3) │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│  ┌─ Sidebar ─┐  ┌─ <Outlet /> (one of 5 routes) ──────────────────────────────┐ │
│  │ .glass-   │  │                                                          │ │
│  │  strong   │  │  ┌─ KPI Row (3 × .glass cards, 2px accent left-border) ─┐│ │
│  │  248px,   │  │  │▌Collected ▌Due Today ▌Present                       ││ │
│  │  sticky   │  │  │▌₹2,45,500 ▌₹48,000  ▌92%                          ││ │
│  │  left-0,  │  │  └──────────────────────────────────────────────────────┘│ │
│  │  z-20     │  │  ┌─ Heatmap (.glass) ─┐ ┌─ Feed (.glass) ─────────────┐  │ │
│  │           │  │  │ ██░██▓░░██        │ │ ● Payment  ₹4,500 (emerald)│  │ │
│  │  ◈ Dash   │  │  │ ██▓░░░██░░        │ │ ● Aarav present 9:02 AM    │  │ │
│  │  👥 Stud   │  │  └───────────────────┘ └─────────────────────────────┘  │ │
│  │  ✓ Attend │  │                                                          │ │
│  │  ₹ Fees   │  │  list rows = .glass-faint band (§8.4)                    │ │
│  │  ⚙ Setngs │  │                                                          │ │
│  │           │  │                                                          │ │
│  │  ─────    │  │                                                          │ │
│  │  ● synced │  │                                                          │ │
│  │  3m ago   │  │                                                          │ │
│  │           │  │                                                          │ │
│  └───────────┘  └──────────────────────────────────────────────────────────┘ │
│  ┌─ Footer (.glass-faint, sticky bottom, h-11) ───────────────────────────────┐ │
│  │  v1.4.2 · ● synced 3m ago · 38 students · ₹2,45,500 MTD  ·  © Buddysaradhi     │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ window root = cosmic canvas (raw gradient, NOT glass) per §2.2
   ↑ header + sidebar = .glass-strong (8% white, 24px blur) per §5.5 — persistent chrome
   ↑ KPI cards = .glass + 2px accent left-border per §5.4 (emerald=collected, amber=due, cyan=present)
   ↑ heatmap + feed cards = .glass (workhorse tier)
   ↑ list rows inside feed = .glass-faint (recede so data reads)
   ↑ footer = .glass-faint (recede), sticky per §13 (MANDATORY footer rule)
   ↑ active sidebar item = .neumo-pressed (inset 2px + translateY(1px)) + cyan glow per §6.3
   ↑ ⌘K = kbd chip (flat tinted per §2.3) — opens command palette (.glass-strong + backdrop per §8.11)
   ↑ 1440×900 default fits the web app's 1440px content max-width per §14 — no breakpoint surprises
```

### 13.3 M2 — IPC Command Flow (Frontend invoke → Rust → SQLCipher TX → Return)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (WebView: tauri://localhost, React + Vite static export)                  │
│  ┌─ .glass-strong modal (Record Payment) ──────────────────────────────────────┐    │
│  │  Student:  Aarav Sharma    ›           ← input = .neumo-inset (§8.9)        │    │
│  │  Amount:   ₹ [4_500]                   ← input = .neumo-inset + cyan focus │    │
│  │  Method:   [Cash ▼]                    ← segmented = .neumo-inset (§8.5)   │    │
│  │  ┌────────────┐  ┌──────────────────┐                                          │    │
│  │  │  Cancel    │  │ ▌ Save Payment   │  ← primary CTA = .neumo-raised + emerald│    │
│  │  └────────────┘  └──────────────────┘     (ghost = transparent, §8.2)        │    │
│  └────────────────────────────────────────────────────────────────────────────┘    │
│                                  │ user clicks Save                                  │
└──────────────────────────────────┼───────────────────────────────────────────────────┘
                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  apps/desktop/src/lib/invoke.ts  (typed wrapper — no raw tauriInvoke)               │
│  invoke('record_payment', { input, pin })  →  Zod parse → tauriInvoke               │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   ▼  (Tauri IPC bridge, origin-validated per §4)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  RUST BACKEND  (src-tauri/src/commands/ledger.rs)                                  │
│  #[tauri::command] record_payment(input, pin, state)                              │
│   1. input.validate()?                          ← serde + validator (§7 of 03)    │
│   2. security::require_unlocked(&state)?        ← LockState::Unlocked check       │
│   3. security::require_fresh_pin(&state, pin)?  ← BR-SEC-04, ≤30s window          │
│   4. BEGIN TRANSACTION                          ← single SQLCipher TX             │
│      ├─ INSERT INTO ledger_entries (...)        ← BR-LED-01 append-only           │
│      ├─ INSERT INTO receipts (...)              ← BR-RC-01 number                 │
│      ├─ UPDATE invoices SET status=...          ← BR-CALC-02 derived             │
│      ├─ INSERT INTO audit_log (...)             ← BR-SEC-08 same TX               │
│      └─ INSERT INTO sync_outbox (...)           ← BR-SYN-02 same TX (Rule 7)     │
│   5. COMMIT                                                                      │
│   6. return Ok(LedgerEntry)                                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   ▼  (Result<T, Error> serialized via serde)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND  (resolve path)                                                           │
│  • on Ok  → close modal, push entry to Zustand store, emerald toast (4s)            │
│  • on Err → DesktopError(code, message) → flare toast (persistent) + audit row       │
│  • sync_outbox row → async push to libsql → next 30s flusher tick (§5 of 02)         │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the modal = .glass-strong (8% white, 24px blur) + bg-black/60 backdrop per §8.7
   ↑ inputs = .neumo-inset (inset 4px 4px 8px #0a0a1a) per §6.6, §8.9
   ↑ primary CTA = .neumo-raised (4px 4px 8px dual-shadow) + emerald glow per §6.1, §8.2
   ↑ the BR-SYN-02 box is the load-bearing row — it is in the SAME TX as the mutation (Rule 7)
   ↑ the BR-SEC-08 audit_log row is also in the same TX — never a separate write
   ↑ on Err, the toast is flare-bordered (4px left-bar) per §8.8 — persistent, no auto-dismiss
   ↑ every step cites a canonical ID — no prose descriptions (BR-LED-01, BR-RC-01, BR-CALC-02,
     BR-SEC-04, BR-SEC-08, BR-SYN-02 — all defined in 12_Business_Rules.md)
```

### 13.4 M3 — Next.js Static-Export Embed Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  apps/web/  (Next.js 16 App Router — the cousin surface)                            │
│  • Server Components, server actions, /api/* routes                                 │
│  • NOT shipped in the desktop binary (Tauri runs no Node)                           │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ shares ONLY:
                                   │  • @buddysaradhi/ui workspace package (glass/neumo primitives)
                                   │  • packages/shared (Zod schemas, formatINR, paise utils)
                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  apps/desktop/  (Vite + React — the desktop frontend)                               │
│  • react-router v6 (5 client-side routes, NO App Router)                            │
│  • @tauri-apps/api invoke() — NO server actions, NO /api/* routes                   │
│  • vite.config.ts: base="./"  (tauri://localhost requires relative base)             │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ bun run build (vite build)
                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  apps/desktop/dist/  (static export: HTML + JS + CSS + fonts)                       │
│  • index.html                    (entry, relative <script> paths)                  │
│  • assets/                                                          │
│    ├─ react-[hash].js            (manualChunk: react + react-dom + router)          │
│    ├─ ui-[hash].js               (manualChunk: @buddysaradhi/ui primitives)              │
│    ├─ route-dashboard-[hash].js  (route-level code split via react-router lazy())   │
│    ├─ route-students-[hash].js                                                      │
│    ├─ route-attendance-[hash].js                                                    │
│    ├─ route-fees-[hash].js                                                          │
│    ├─ route-settings-[hash].js                                                      │
│    └─ *.css                      (Tailwind + tokens from §2.1)                      │
│  total ≤ 1.5 MB gzipped  (the 2nd-largest chunk in the .msi per §9.1)              │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ bundled by Tauri at cargo tauri build time
                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  src-tauri/  (Rust binary, ~6 MB stripped, LTO, panic=abort)                        │
│  • src-tauri/src/main.rs        (Builder + 3 setup blocks per 02 §2)                │
│  • src-tauri/src/commands/*.rs  (7 sensitive + read-only helpers per 02 §6)         │
│  • src-tauri/migrations/*.sql   (refinery forward-only, per 02 §4.3)                │
│  • FRONTEND DIST embedded as resources/  ←── the static export lives INSIDE the bin │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ on launch, Tauri serves the embedded dist via
                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  WebView origin: tauri://localhost (Win/Linux) or https://tauri.localhost (macOS)   │
│  • index.html loads with relative <script> paths (base="./" makes this work)        │
│  • JS executes in the OS WebView (WebView2 / WebKit / WebKitGTK per §5)             │
│  • invoke() calls cross the IPC bridge to Rust (origin-validated per 03 §4)         │
│  • NO Node runtime, NO server, NO /api/* routes — pure client + Rust                │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ the shared .glass-strong modal + .neumo-raised CTA are the SAME components on web + desktop
   ↑ the only divergence: web uses server actions; desktop uses tauri::invoke (this file §3.2)
   ↑ Vite manualChunks keeps each route's chunk ≤ 200 KB (per §9.1 trimming techniques)
   ↑ base="./" is load-bearing — absolute paths (/assets/foo.js) break under tauri:// scheme
   ↑ the WebView is the OS's native one — Tauri ships zero Chromium, zero Node (§1)
   ↑ cross-refs: 02 §2 (Builder), 02 §4.3 (migrations), 02 §6 (commands), 03 §4 (origin), §9.1 (bundle)
```

### 13.5 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Full-screen layout | M1 window shell tree (1440×900 desktop layout) |
| Concept diagram (architecture / flow) | M2 IPC command flow, M3 static-export embed diagram |
| Component anatomy | (covered in screen specs — 04–08 — not duplicated here) |
| State matrix | (covered in screen specs — 04–08 — not duplicated here) |

> All three mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 84–116 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5; neumorphic controls recipe-annotated (`.neumo-raised`, `.neumo-inset`, `.neumo-pressed`) per §6.6. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.1`, `§6.3`, `§6.6`, `§7.3`, `§8.1`, `§8.2`, `§8.4`, `§8.5`, `§8.7`, `§8.9`, `§8.11`, `§13`, `§14`, `BR-LED-01`, `BR-RC-01`, `BR-CALC-02`, `BR-SEC-04`, `BR-SEC-08`, `BR-SYN-02`).
