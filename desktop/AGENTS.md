# AGENTS.md — Desktop Platform Agent Directive

> Read this file before writing any desktop code. It governs every agent (AI or human) operating in the `apps/desktop/` and `src-tauri/` directories. The master `AGENTS.md` (top-level) is the operating manual for the whole monorepo; this file is the desktop-specific specialisation. When this file and the top-level `AGENTS.md` disagree, the top-level wins — unless the top-level is wrong, in which case you amend the top-level first, then this file, then the code.

---

## 0. Prime Directive

> **Before writing or modifying any desktop code, read the relevant spec section in `Buddysaradhi_Planning/desktop/` AND the master spec it cross-references. If no spec covers it, write the spec first, get it reviewed, then code. Code without a spec is tech debt.**

The desktop spec is the contract the code is held to. Every line of production code in `apps/desktop/` and `src-tauri/` maps to a sentence in some spec under `Buddysaradhi_Planning/` (top-level or `desktop/`). If you cannot point to that sentence, you are writing orphan code, and orphan code is the most expensive kind — it survives review because nobody knows what it's for, and it breaks in production because nobody knows how it should behave.

### 0.0 Platform Boundary & Sequencing — You Are the Desktop Agent

> **Read `../16_Platform_Delivery_Sequence.md` before any cross-platform thought.** It is the process keystone: exactly one platform `In-Flight` at a time, hard Production Gates between them.

You are the **Desktop** agent (platform P3 — the last to ship). The boundary rules:

- **Desktop is LOCKED until the worklog carries `Task ID: MOBILE-PROD-GATE … State: COMPLETED … Next platform unlocked: DESKTOP.`** Until that line exists, you may NOT create `apps/desktop/`, `src-tauri/`, or edit any desktop spec. Web and mobile must both be in production first — desktop inherits their frozen contracts (`contracts/v1.0.0`) and the proven gateway.
- **Once unlocked, you may edit:** `apps/desktop/`, `src-tauri/`, `buddysaradhi_Planning/desktop/*.md`, append-only `worklog.md`, and `packages/*` **only via an RFC**.
- **You may NOT create or edit:** `apps/web/`, `apps/mobile/`, `buddysaradhi_Planning/web/*.md`, `buddysaradhi_Planning/mobile/*.md`. A desktop bug found in web/mobile code is a `BUG-{WEB,MOBILE}-*` issue for that platform's agent.
- **All network access goes through the same API gateway** (`../17_API_Gateway_System.md`) via the typed SDK. The Rust core (`02_Rust_Core.md`) handles local SQLCipher + IPC only; remote access is gateway-only. No hardcoded service URLs.
- **Desktop's 3D hero** (`../20_3D_Product_Page.md` §6) is the **same R3F component web built**, running in the Tauri webview — no desktop-specific 3D code. This is the payoff of serial delivery: by the time desktop begins, the web hero is a frozen, tested contract.
- **Check the status block** at the top of `/home/z/my-project/worklog.md` first. If `In-Flight` is not `DESKTOP`, STOP and run the close-out (`../AGENTS.md` §9.2.2).

Web → production → mobile → production → desktop → production. Desktop is the last mile, not a parallel sprint.

### 0.1 The Spec → Code → Test Loop

Every non-trivial desktop change follows this loop, in order:

1. **Spec.** Read or write the spec section (`Buddysaradhi_Planning/desktop/01_Architecture.md` through `06_Installers.md`, plus the cross-referenced top-level spec). If writing, cite the principle (`01_Product_Principles.md`) that authorises the feature and the edge cases (`14_Edge_Cases.md`) it must handle.
2. **Code.** Implement against the spec. Every commit message cites the spec section (see §6).
3. **Test.** `cargo test` → `cargo clippy` → manual smoke on Windows + macOS + Linux (or via GitHub Actions matrix). Add a regression note in the worklog.

If the implementation diverges from the spec, the spec wins — *unless* the spec is wrong, in which case you update the spec first, get the amendment reviewed, and only then change the code.

---

## 1. The Five-Screen Rule (Carried from Top-Level)

> **Five persistent screens: Dashboard, Students, Attendance, Fees & Payments, Settings.** A sixth top-level route requires a ratified principle amendment per `01_Product_Principles.md` §Amendment Process.

The desktop app maps these five screens to five client-side routes (`/dashboard`, `/students`, `/attendance`, `/fees`, `/settings`) via react-router v6 (`01_Architecture.md` §4). A sixth route is a build error and a top-level `AGENTS.md §2 Rule 4` violation.

### 1.1 No 6th Window Either

Tauri supports multiple windows. The desktop app uses exactly **one** main window. A second window (e.g. a "quick add" floating window) is a stop-and-ask (§8 #4) — it's effectively a 6th screen.

The v3.2 menu-bar widget (`15_Future_Roadmap.md` v3.2) is a projection of the Attendance and Fees screens, not a 6th screen. It is out of scope for v1.x.

### 1.2 No Nested Modal Stacks Deeper Than 2 Levels

A modal can open a sub-modal (e.g. "Record payment" → "Add new student from this form"). The sub-modal cannot open a sub-sub-modal. A 3-level deep modal stack is a UX failure and a stop-and-ask.

```
GlassShell (root)
└── Modal 1: Record Payment
    └── Modal 2: Add New Student  ← maximum depth
        └── (no Modal 3 allowed)
```

---

## 2. Where to Start — Reading Order for a New Desktop Agent

1. **`Buddysaradhi_Planning/desktop/README.md`** — orientation index, stack at a glance, decision tree.
2. **`Buddysaradhi_Planning/desktop/01_Architecture.md`** — Tauri v2 architecture, project layout, static-export frontend, the 5-screen route map, command allowlist, window config, bundle-size targets.
3. **The existing web components** in `src/components/buddysaradhi/*.tsx` — the desktop app reuses these components via the shared `@buddysaradhi/ui` package. Pay particular attention to:
   - `primitives.tsx` — `GlassPanel`, `NeumoToggle`, `Chip`, etc. (the cross-platform primitives).
   - `dashboard-prototype.tsx`, `students-prototype.tsx`, `attendance-prototype.tsx`, `fees-ledger-prototype.tsx`, `settings-prototype.tsx` — the 5 screen prototypes. The desktop app's routes mirror these layouts.
   - `command-palette.tsx` — the Ctrl+K palette (shared).
   - `keyboard-shortcuts.tsx` — the G+1..5, G+B, G+D, G+R, G+S shortcuts (shared).
   - `data.ts` — the `ACCENT_MAP` (bioluminescent accent palette: emerald, cyan, flare, amber, violet). Import this; never hardcode hex.
4. **`Buddysaradhi_Planning/desktop/02_Rust_Core.md`** — Rust backend: `main.rs`, `AppState`, the 7 Tauri commands, the typed `Error` enum.
5. **`Buddysaradhi_Planning/desktop/03_IPC_Security.md`** — capability JSON, CSP, origin validation, SQLCipher-at-rest, audit log, file scope.
6. **`Buddysaradhi_Planning/desktop/04_Code_Signing.md`** — EV cert, notarization, GPG, GitHub Actions workflows.
7. **`Buddysaradhi_Planning/desktop/05_Updater.md`** — `tauri-plugin-updater`, manifest, channels, rollback, never-interrupt rule.
8. **`Buddysaradhi_Planning/desktop/06_Installers.md`** — WiX, DMG, AppImage, file association, auto-launch.
9. **`Buddysaradhi_Planning/AGENTS.md`** (top-level) — the 10 non-negotiable rules; §3 file map; §8 stop-and-ask triggers.

If your task is "scaffold the workspace" → start at `01_Architecture.md`.
If your task is "add a Rust command" → start at `02_Rust_Core.md` §6 + `03_IPC_Security.md` §2 (allowlist).
If your task is "wire up the updater" → start at `05_Updater.md`.
If your task is "ship a signed release" → start at `04_Code_Signing.md` + `06_Installers.md`.

---

## 3. File Map — Spec → Code

Every spec file in `Buddysaradhi_Planning/desktop/` governs specific code locations. The mapping is 1:1.

| Spec file | Governs code in | Read this spec before touching |
|---|---|---|
| `README.md` | (orientation only — no code) | n/a |
| `01_Architecture.md` | `apps/desktop/` (frontend), `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs` (Builder structure), `src-tauri/src/window.rs` | `apps/desktop/vite.config.ts`, `apps/desktop/src/App.tsx`, `src-tauri/tauri.conf.json` |
| `02_Rust_Core.md` | `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/src/state.rs`, `src-tauri/src/commands/*.rs`, `src-tauri/src/db/*.rs`, `src-tauri/src/sync/*.rs`, `src-tauri/src/crypto/*.rs`, `src-tauri/src/security/*.rs`, `src-tauri/migrations/*.sql`, `src-tauri/src/error.rs` | Any Rust file in `src-tauri/src/` |
| `03_IPC_Security.md` | `src-tauri/capabilities/*.json`, `src-tauri/tauri.conf.json` (security block), `src-tauri/src/security/*.rs`, `src-tauri/src/crypto/keychain.rs` | Any capability file, any change to CSP, any new Tauri permission |
| `04_Code_Signing.md` | `.github/workflows/desktop-release-*.yml`, `src-tauri/entitlements.plist`, signing secrets in GitHub Actions | Any release workflow, any entitlement change, any signing secret rotation |
| `05_Updater.md` | `src-tauri/tauri.conf.json` (plugins.updater block), `src-tauri/src/updater.rs`, `apps/desktop/src/lib/updater.ts`, `apps/web/app/api/releases/desktop/*` (manifest endpoint) | Any updater config, any change to the manifest format, any change to the channels |
| `06_Installers.md` | `src-tauri/tauri.conf.json` (bundle block), `src-tauri/wix/Buddysaradhi.wxs`, `src-tauri/dmg/`, `src-tauri/src/auto_launch.rs`, `src-tauri/Info.plist` (macOS) | Any installer config, any file-association change, any auto-launch change |
| `AGENTS.md` (this file) | All of the above — the operating manual | Before starting any task |

---

## 4. Code Style

### 4.1 Rust

- **`cargo fmt --check`** — no manual formatting. Run `cargo fmt` before every commit.
- **`cargo clippy -D warnings`** — all warnings are errors. Fix the warning, do not `#[allow(...)]` it.
- **Rust 1.82+** — the `Cargo.toml` declares `rust-version = "1.82"`. Use modern Rust idioms (let-else, async traits, `OnceCell`).
- **No `unwrap()` / `expect()` in production code.** Use `?` and the typed `Error` enum (`02_Rust_Core.md` §8). The single exception is `main()`'s final `.expect("error while running Buddysaradhi")` — the app cannot recover from a builder failure.
- **No `unsafe` without a `// SAFETY:` comment** explaining the invariant. `unsafe` blocks require a security reviewer per §8 stop-and-ask #2.
- **No `panic!()` in `#[tauri::command]` functions.** A panic propagates to the frontend as an opaque "command panicked" error — always convert to a typed `Error` first.
- **Every public function has a doc comment** naming the spec section it implements. Example: `/// Implements: 12_Business_Rules.md BR-LED-04 (void requires PIN + new row)`.
- **`#[serde(rename_all = "snake_case")]` on every enum** that crosses the IPC boundary. The frontend receives snake_case JSON.
- **`#[derive(Debug, Clone, Serialize, Deserialize)]` on every struct** that crosses the IPC boundary. `Clone` because Tauri sometimes needs to clone for async commands.

### 4.2 TypeScript (Frontend)

- **Strict mode** (`"strict": true`, `"noUncheckedIndexedAccess": true`). Mirror of the web app's `tsconfig.json`.
- **No `any`.** Use `unknown` and narrow with a type guard or Zod parse.
- **No `as` casts** unless paired with a `// SAFETY:` comment explaining the invariant.
- **Functional React.** No class components. Hooks for state.
- **Zod for all input validation.** Every `invoke()` argument is parsed through a Zod schema imported from `packages/shared`. Types are inferred from Zod, never hand-written.
- **Integer paise, never float.** Money is `bigint` or safe-integer `number` (max `9_007_199_254_740_991`, which is ₹9 crore — far above any tutor's balance). Display via `formatINR(paise)` from `packages/shared`.
- **No `console.log` in prod.** Use the typed logger (`log.info`, `log.warn`, `log.error`) which routes to `audit_log` via a Tauri command.
- **No `import` from `next/*`.** The desktop app is a Vite + React app, not a Next.js app. No Server Components, no server actions, no `next/link`, no `next/image`.
- **`react-router-dom` v6** for routing. Not Next.js App Router.
- **`@tauri-apps/api`** for all Tauri-side calls. Wrap in `apps/desktop/src/lib/invoke.ts` for typed error handling.

### 4.3 Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Rust functions, variables | snake_case | `record_payment`, `tenant_id` |
| Rust structs, enums, traits | PascalCase | `AppState`, `Error`, `LedgerEntry` |
| Rust constants | SCREAMING_SNAKE_CASE | `MAX_PIN_ATTEMPTS`, `SYNC_INTERVAL_SECS` |
| Rust modules | snake_case | `commands::students`, `crypto::envelope` |
| TypeScript functions, variables | camelCase | `recordPayment`, `tenantId` |
| TypeScript components, types, interfaces | PascalCase | `GlassPanel`, `LedgerEntry`, `StudentRow` |
| TypeScript constants | SCREAMING_SNAKE_CASE | `MAX_PIN_ATTEMPTS`, `SYNC_INTERVAL_MS` |
| Component files | kebab-case | `glass-panel.tsx`, `student-row.tsx` |
| Non-component files | camelCase | `recordPayment.ts`, `formatINR.ts` |
| Spec files | Numbered snake-case | `02_Rust_Core.md`, `06_Installers.md` |
| Zod schemas | PascalCase + `Schema` suffix | `LedgerEntrySchema`, `StudentInputSchema` |

### 4.4 The Command Wrapper Rule

Every `invoke()` call from the frontend goes through `apps/desktop/src/lib/invoke.ts`:

```ts
// apps/desktop/src/lib/invoke.ts
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export class DesktopError extends Error {
  constructor(public code: string, public message: string) {
    super(`${code}: ${message}`);
    this.name = "DesktopError";
  }
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
      throw new DesktopError(String(e.code), String(e.message));
    }
    throw new DesktopError("UNKNOWN", String(e));
  }
}
```

Direct `tauriInvoke` calls outside this file are an ESLint error (`no-raw-tauri-invoke`).

---

## 5. The 10 Non-Negotiable Rules (Desktop Specialisation)

The top-level `AGENTS.md §2` defines 10 non-negotiable rules. The desktop specialisation:

| # | Rule (top-level) | Desktop enforcement |
|---|---|---|
| 1 | Ledger is append-only | Rust: `trg_ledger_no_update` + `trg_ledger_no_delete` SQLCipher triggers; CI lint `no-ledger-mutation.rs` scans PRs. |
| 2 | No network calls that process user data | CSP `connect-src` locked to 3 origins (`03_IPC_Security.md` §3); the only outbound calls are libsql sync, Supabase auth, updater check. |
| 3 | No telemetry/analytics SDK | `Cargo.toml` dependency lint `no-telemetry-deps.rs` rejects PRs adding `sentry`, `mixpanel`, etc. |
| 4 | Five screens only | `apps/desktop/src/App.tsx` route lint: exactly 5 routes; a 6th is a build error. |
| 5 | No indigo/blue primary accents | ESLint rule `no-indigo-accent` rejects `#4F46E5`, `blue-600`, etc. (see §6 below). |
| 6 | Integer paise, never float | Rust: `i64` for all money columns; Zod: `z.bigint()` or paise-int; `formatINR(paise)` for display. |
| 7 | Every mutation writes `sync_outbox` | Rust: every `BEGIN TRANSACTION ... COMMIT` block includes a `sync_outbox INSERT`. CI integration test asserts `sync_outbox` row count after every mutation flow. |
| 8 | AES-256-GCM + Argon2id backups | Rust: `crypto/envelope.rs` uses `aes-gcm` + `argon2` with m=64MiB / t=3 / p=2. CI round-trip test (`backup_roundtrip.rs`) on every PR. |
| 9 | No silent failures | Rust: `?` propagates typed `Error`; no `unwrap()`; no `panic!()` in commands. Frontend: `DesktopError` surfaced via toast + `audit_log`. |
| 10 | Accessibility is not optional | WCAG 2.1 AA. 44×44px touch targets. `prefers-reduced-motion` honoured. Keyboard parity (Tab, Enter, Esc, G+1..5, Ctrl+K). `axe-core` gate in CI. |

---

## 6. The No-Indigo / No-Blue Rule (Special Attention)

> **Rule 5 (top-level): Use the bioluminescent palette (emerald, cyan, flare, amber, violet). Indigo and blue are the visual signature of every generic SaaS dashboard since 2018.** The cosmic indigo→violet *canvas* is neutral; accents are bioluminescent.

The desktop app inherits this rule unchanged. The accent palette:

| Accent | Hex | Use |
|---|---|---|
| Emerald | `#00FF9D` | Paid / present / active / positive delta / primary CTA |
| Cyan | `#00F0FF` | Info / focus / selection / sync progress |
| Flare | `#FF5E00` | Destructive / void / overdue / security warning |
| Amber | `#FFB300` | Pending / partial / late / warning |
| Violet | `#B388FF` | Secondary / hover / informational elevated |

The cosmic indigo→violet *canvas* (`#0f0c29` → `#24243e`) is neutral — it's the night-sky background, not an accent. Indigo (`#4F46E5` / `blue-600`) as a *primary accent* is forbidden.

### 6.1 ESLint Enforcement

```js
// eslint.config.mjs (desktop-specific rules)
export default [
  // ... base config
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(4F46E5|4338CA|3730A3|312E81|1E1B4B)/]",
          message: "Indigo accents are forbidden (Rule 5). Use --accent-emerald, --accent-cyan, --accent-flare, --accent-amber, or --accent-violet.",
        },
        {
          selector: "Literal[value=/blue-(50|100|200|300|400|500|600|700|800|900)/]",
          message: "Tailwind blue-* accents are forbidden (Rule 5). Use emerald/cyan/flare/amber/violet.",
        },
      ],
    },
  },
];
```

### 6.2 What to Do If You're Tempted to Use Indigo

You will be tempted. Indigo is the default accent in every Tailwind tutorial, every shadcn/ui example, every "modern dashboard" mockup. Resist it.

- For "primary CTA" → emerald.
- For "info" → cyan.
- For "destructive" → flare.
- For "warning" → amber.
- For "secondary / elevated" → violet.

If you genuinely need a sixth accent (you don't), stop and ask per §8.

---

## 7. Testing Protocol

### 7.1 The Test Pyramid (Desktop)

```
                    ┌─────┐
                    │ e2e │  ← 5% — golden-path flows only (Tauri's WebDriver)
                ┌───┴─────┴───┐
                │ integration │  ← 25% — multi-module, in-memory SQLite + SQLCipher
            ┌───┴─────────────┴───┐
            │      unit           │  ← 70% — pure functions, Zod schemas, calc utils
            └─────────────────────┘
```

### 7.2 What MUST Be Tested

| Concern | Test | Spec ref |
|---|---|---|
| Ledger integrity | Append-only trigger fires on UPDATE/DELETE attempt; reversing entry net-zero; running balance after 10k entries | `02_Rust_Core.md` §4, `12_Business_Rules.md` BR-LED-01..10 |
| Backup round-trip | Encrypt → decrypt → restore → verify every table row matches | `02_Rust_Core.md` §9, `09_Backup_and_Import_Export.md` §11 |
| Auth lockout | 5/10/15 failed PIN → 30s/5min/wipe; biometric fallback | `03_IPC_Security.md` §12, `10_Security.md` §3 |
| Sync conflict resolution | LWW picks newer `updated_at`; loser → audit_log; ledger UUID-keyed, conflict-immune | `02_Rust_Core.md` §5, `12_Business_Rules.md` BR-SYN-03..04 |
| Receipt numbering | Void does not decrement `next_receipt_seq`; gap is intentional | `12_Business_Rules.md` BR-LED-03 |
| Money math | 10% discount on ₹1,255.55 rounds half-to-even on paise | `12_Business_Rules.md` BR-FEE-01, `14_Edge_Cases.md` EC-F-01 |
| Crypto envelope | AES-256-GCM + Argon2id round-trip; wrong-passphrase lockout | `02_Rust_Core.md` §9, `10_Security.md` §15 |
| Updater signature verification | Tampered binary → signature check fails → abort + audit | `05_Updater.md` §8 |
| Updater rollback | 3 failed launches → rollback to `.bak` | `05_Updater.md` §7 |

### 7.3 The "Never Mock the DB" Rule

> In a ledger test, never mock the database. Use an in-memory SQLite (`:memory:`) with SQLCipher and run real migrations. A mocked DB tells you nothing about whether your trigger fires.

```rust
// ✅ Good
let conn = Connection::open_in_memory()?;
conn.pragma_update(None, "key", "test_key_hex")?;
run_migrations(&conn)?;
post_payment(&conn, &input)?;
assert_eq!(get_balance(&conn, &student_id)?, 470000);  // ₹4,700 in paise

// ❌ Bad — proves nothing
let mock_db = MockDb::new();
mock_db.expect_query(...).returning(...);
post_payment(&mock_db, &input).unwrap();
// What did this test? Nothing about the trigger, the constraint, the audit row.
```

### 7.4 CI Gate

Merge is blocked unless **all** pass:

1. `cargo fmt --check` — no formatting drift.
2. `cargo clippy -D warnings` — no warnings.
3. `cargo test` — all unit + integration tests pass.
4. `bun run lint` — ESLint on `apps/desktop/src/` + `packages/shared/` + `packages/ui/`.
5. `bun run typecheck` — `tsc --noEmit` on `apps/desktop/src/` + `packages/*`.
6. `bun run test:unit` — Vitest on `packages/shared` + `packages/ui` (≥70% line coverage).
7. Bundle-size check — the .msi / .dmg / .AppImage are at or below the targets (`06_Installers.md` §9).
8. Cross-platform build matrix — Windows / macOS / Linux all build in CI.
9. (If release) Code-signing check — the binary is signed + notarized per `04_Code_Signing.md` §8.

---

## 8. Stop-and-Ask Triggers

> The following situations require a pause and human review **before** the PR is opened. An autonomous agent MUST NOT proceed unilaterally.

| # | Trigger | Why sensitive | Who reviews |
|---|---|---|---|
| 1 | Adding a new Tauri permission or broadening an existing one | The allowlist is the structural defence against XSS → DB exfiltration (`03_IPC_Security.md` §2). Broadening it weakens that defence. | Security reviewer |
| 2 | Adding a new native (Rust) dependency | New crates add attack surface (memory safety, supply chain). | Security reviewer + Rust reviewer |
| 3 | Changing the SQLCipher key derivation (params, keychain entry name, derivation flow) | A bug here bricks every install — the DB becomes unreadable. | 2 reviewers incl. security owner |
| 4 | Adding a 6th top-level route or a 6th window | Violates Rule 4; requires principle amendment. | Orchestrator + principle review |
| 5 | Any use of indigo/blue as a primary accent | Violates Rule 5 (`13_UI_Guidelines.md` §2). | Design reviewer |
| 6 | Any change to the ledger schema, the backup envelope, or the audit-log trigger | These are the financial + cryptographic invariants. A bug corrupts every tutor's books or every backup. | 2 reviewers incl. ledger-crypto owner |
| 7 | Any new outbound network call (any `fetch` / `http` / `libsql::Client` to a new origin) | The CSP allowlist in `03_IPC_Security.md` §3 must be updated first; new origins expand the attack surface. | Security reviewer |
| 8 | Any change to `tauri.conf.json`'s `security` block, `plugins.updater` block, or `bundle` block | These are the load-bearing config files; a bug here breaks signing, the updater, or the installer. | 2 reviewers |
| 9 | Any `unsafe` block in Rust | `unsafe` opts out of Rust's safety guarantees. | Security reviewer + a `// SAFETY:` comment explaining the invariant |
| 10 | Any PR that touches >500 lines | Large PRs hide bugs; large Rust PRs hide catastrophes. | 2 reviewers + flag in PR description |
| 11 | Any change to `desktop/AGENTS.md` (this file) or `Buddysaradhi_Planning/AGENTS.md` | These are the constitution; drift here propagates everywhere. | Orchestrator sign-off |
| 12 | Any "quick fix" that violates a non-negotiable (§5) | Quick fixes that violate rules are not fixes — they are debt with a deadline. | The rule's named reviewer |

### 8.1 What "Stop and Ask" Looks Like

1. Stop coding. Commit what you have with `chore(wip): <what> — pending human review`.
2. Open a draft PR with the `## Spec ref` and `## Risk` blocks filled in, even if incomplete.
3. In the worklog, note: `BLOCKED on human review: <trigger #>`.
4. Return control to the orchestrator with a clear request.

---

## 9. Agent Hygiene

1. **Keep commits small.** <300 lines per commit. A 600-line commit is two commits.
2. **Run `cargo fmt && cargo clippy -D warnings && cargo test` before every commit.** Fix all errors before staging.
3. **Run `bun run lint` before every commit.** Fix all errors before staging.
4. **Never commit secrets.** The `.env.example` pattern: `.env.example` documents the keys; `.env.local` holds the values and is git-ignored. If you accidentally commit a secret, rotate it — do not just delete the line.
5. **Update the spec if the implementation diverges.** Spec drift is tech debt with a longer half-life than code debt.
6. **Update the worklog after each meaningful change.** Append a `---`-delimited section with Task ID, Agent, Task, Work Log, Stage Summary.
7. **Use TodoRead / TodoWrite for multi-step tasks.** A task with ≥3 steps gets a todo list; the agent marks each step complete as it ships.
8. **Cite the spec in every PR.** (See top-level `AGENTS.md` §5.3.)
9. **No orphan code.** (See top-level `AGENTS.md` §0.2.)
10. **Verify on all three OSes (or via CI matrix) before declaring done.** A feature that works on macOS but breaks on Windows is not done.

### 9.1 The Agent Operating Loop

When an autonomous agent is working a desktop task:

1. Read `worklog.md` to learn prior context.
2. Read the relevant spec section per §2.
3. Make the smallest correct change.
4. Run `cargo fmt && cargo clippy -D warnings && cargo test`. Fix all errors.
5. Run `bun run lint`. Fix all errors.
6. (If UI) verify in Agent Browser or by running the dev build: render + primary interaction + sticky footer.
7. Append a `---`-delimited section to `worklog.md` with Task ID, Agent, Task, Work Log, Stage Summary **and a `State: COMPLETED | PAUSED | BLOCKED` field** (top-level `AGENTS.md` §9.2.2).
8. Report back with: files changed, verification result, next recommended task.

### 9.2 Task-to-Task Transition Protocol (extends top-level `AGENTS.md` §9.2)

Desktop agents frequently shift between Rust core work, Tauri IPC work, and installer/signing work — three different toolchains, three different test surfaces. Every shift runs the top-level §9.2.2 Close-Out Checklist. **Desktop-specific shift triggers** (in addition to the top-level §9.2.5 table):
- A `cargo clippy` warning surfaces mid-feature → close-out the feature as `PAUSED`, fix the clippy lint, resume. Never leave a clippy-dirty tree.
- A cross-OS break (works on macOS, fails on Windows) → close-out as `BLOCKED` with the OS + error in the worklog; do not mark `completed` on a single-OS pass.
- A Tauri signing-key or updater-manifold issue surfaces → close-out the current task as `PAUSED`, fix the signing/updater config (`desktop/06_Installers.md`), resume.
- A SQLCipher `PRAGMA key` or keychain-access regression → close-out as `BLOCKED`, this is a P1 security regression (top-level `AGENTS.md` §2 Rule 8).

The `no-orphaned-task.test.ts` lint (§9.2.6) runs in the `webDevReview` cron and fails if a desktop todo is left `in_progress` with no worklog entry in the last 30 minutes.

---

## 10. Glossary

| Term | Definition |
|---|---|
| **Tauri** | The framework that produces the desktop binary: Rust backend + OS WebView frontend. Tauri v2 is the current major version. (`01_Architecture.md` §1.) |
| **WebView2** | Microsoft's Chromium-based WebView, used by Tauri on Windows 10+. Bundled via the Evergreen Bootstrapper in the .msi. (`01_Architecture.md` §5.) |
| **WebKit** | Apple's WebView, used by Tauri on macOS (system WKWebView). No bundle needed — it's part of macOS. (`01_Architecture.md` §5.) |
| **WebKitGTK** | The Linux port of WebKit, used by Tauri on Linux. The AppImage bundles 2.42+; the .deb declares it as a dependency. (`01_Architecture.md` §5.) |
| **SQLCipher** | The SQLite extension that adds AES-256 encryption at rest. The desktop app's local DB is SQLCipher-encrypted; the key lives in the OS keychain. (`02_Rust_Core.md` §4, `10_Security.md` §14.2.) |
| **rusqlite** | The Rust binding to SQLite (with the `bundled-sqlcipher` feature for SQLCipher). (`02_Rust_Core.md` §1.) |
| **libsql** | The open-source fork of SQLite by Turso, with HTTP sync. The desktop app uses `libsql::Client` to sync the local DB with the per-user Turso cloud DB. (`02_Rust_Core.md` §5.) |
| **Argon2id** | The memory-hard key-derivation function used for backup passphrases. Parameters: m=64 MiB, t=3, p=2. (`03_IPC_Security.md` §6, `10_Security.md` §15.3.) |
| **AES-256-GCM** | The authenticated-encryption algorithm used for the `.buddysaradhi` backup envelope. 256-bit key, 96-bit nonce, 128-bit auth tag. (`02_Rust_Core.md` §9, `09_Backup_and_Import_Export.md` §15.3.) |
| **EV cert (Extended Validation)** | A Windows code-signing certificate with stricter identity verification. SmartScreen trusts EV-signed binaries immediately; OV (Organisation Validation) certs take weeks of reputation buildup. (`04_Code_Signing.md` §2.1.) |
| **Notarization (macOS)** | Apple's automated malware scan of a binary. Required for distribution outside the App Store. Performed via `xcrun notarytool submit`. (`04_Code_Signing.md` §3.5.) |
| **Stapling (macOS)** | Embedding the notarization ticket in the binary so Gatekeeper can verify it offline. Performed via `xcrun stapler staple`. (`04_Code_Signing.md` §3.6.) |
| **AppImage** | A portable Linux executable format — a single file containing the app + bundled dependencies. The user `chmod +x` and runs. (`06_Installers.md` §4.1.) |
| **WiX** | Windows Installer XML — the open-source toolset that produces `.msi` files. (`06_Installers.md` §2.1.) |
| **MMKV** | (Not used on desktop — mobile only.) Mentioned here for completeness: the mobile app's key-value store. The desktop equivalent is `tauri-plugin-store`. |
| **Capability (Tauri)** | A JSON file under `src-tauri/capabilities/` that declares which Tauri permissions a window has. Every permission must be explicitly listed — no wildcards. (`03_IPC_Security.md` §2.) |
| **CSP** | Content Security Policy — the HTTP header (or `<meta>` tag) that restricts which origins the webview can load from. (`03_IPC_Security.md` §3.) |
| **Origin validation** | Tauri's automatic rejection of IPC calls from non-`tauri://` origins (or non-`http://localhost:1420` in dev). (`03_IPC_Security.md` §4.) |
| **sync_outbox** | A table that queues local writes for replay to the cloud on reconnect. Every mutation appends a row in the same transaction. (`02_Rust_Core.md` §5, `12_Business_Rules.md` BR-SYN-02.) |
| **LWW** | Last-Writer-Wins. The conflict-resolution rule for non-ledger rows: the row with the newer `updated_at` wins; the loser is logged to `audit_log`. (`12_Business_Rules.md` BR-SYN-03.) |
| **Audit log** | The append-only `audit_log` table; every sensitive mutation writes a row in the same transaction. Trigger-guarded against UPDATE/DELETE. (`02_Rust_Core.md` §7, `03_IPC_Security.md` §8.) |

---

## 11. What "Done" Means for a Desktop Task

A desktop task is done when **all** of the following are true (mirror of top-level `AGENTS.md` §12, specialised for desktop):

- `cargo fmt --check` passes.
- `cargo clippy -D warnings` passes.
- `cargo test` passes.
- `bun run lint` passes on `apps/desktop/src/` + `packages/shared/` + `packages/ui/`.
- `bun run typecheck` passes.
- If the task touches the UI: the relevant screen renders without runtime/hydration errors in the dev build; the primary interaction works; the sticky footer behaves.
- If the task touches Rust commands: the command's input validation, error mapping, and audit-logging are tested.
- If the task touches the build/installer: the app builds on all three OSes (Windows / macOS / Linux) in CI; the bundle size is at or below the target.
- If the task touches signing/updater: the end-to-end signing + updater test passes (`04_Code_Signing.md` §8, `05_Updater.md` §13).
- `worklog.md` is appended with a `---`-delimited entry.
- No `AGENTS.md §5` non-negotiable is violated.
- The PR cites its spec section (`## Spec ref`).
- Every "stop and ask" trigger (§8) that fired has a recorded human review.

> **"It compiles" is never sufficient.** A green build is the floor, not the ceiling.

---

## 12. The Anti-Patterns (Desktop Edition)

Mirror of top-level `AGENTS.md` §10, with desktop-specific additions:

| # | Anti-pattern | Correction |
|---|---|---|
| 1 | Adding a feature without a spec | Write the spec first (`desktop/AGENTS.md` §0.1); cite the principle that authorises it. |
| 2 | Using a `float`/`f64` for money in Rust | Use `i64` paise; display via `formatINR(paise)`. |
| 3 | Using `number` for money in TypeScript | Use `bigint` or safe-integer `number`; Zod `z.bigint()` or paise-int. |
| 4 | `unwrap()` / `expect()` in a `#[tauri::command]` | Use `?` and the typed `Error`. Convert panics to `Error::Io` / `Error::Db` / etc. |
| 5 | Skipping the `sync_outbox` write on a mutation | Append the outbox row in the same transaction as the mutation (BR-SYN-02). |
| 6 | Using indigo because "it looks nice" | Use the bioluminescent palette (§6); indigo is the canvas, not the accent. |
| 7 | Mocking the DB in a ledger test | Use an in-memory SQLite (`:memory:`) with SQLCipher and run real migrations. |
| 8 | Returning `any` from a Tauri command | Return a typed `Result<T, Error>`; parse inputs with `serde` + `validator`. |
| 9 | Editing a merged SQL migration | Add a new numbered migration (`V####__description.sql`); never edit history. |
| 10 | Catching an error and silently continuing | Throw a typed error or return `Err`; surface via toast + `audit_log`. |
| 11 | Adding a 6th route or 6th window "just for now" | Ship the capability inside one of the five screens; open an RFC if a 6th is truly needed. |
| 12 | `UPDATE` on a `ledger_entries` row to "fix" it | INSERT a reversing entry with `reverses_entry_id`. Always. |
| 13 | Hardcoding a Turso `db_url` / `db_token` in Rust | Read from the OS keychain (`keyring::Entry`). Hardcoded credentials are a P0 bug. |
| 14 | Skipping the `audit_log` write on void / backup / restore / lock | Every sensitive mutation writes an audit row in the same transaction (BR-SEC-08). |
| 15 | Treating "it compiles" as done | Done = lint + clippy + test + manual smoke + worklog + no §5 violation. |
| 16 | Broadening a Tauri capability "just to get it working" | Stop and ask per §8 #1. The allowlist is the structural defence; broadening it weakens it. |
| 17 | Direct `tauriInvoke` call outside `lib/invoke.ts` | Go through the typed wrapper. ESLint `no-raw-tauri-invoke` rejects direct calls. |
| 18 | Adding a `next/*` import in the desktop frontend | The desktop app is Vite + React, not Next.js. No `next/link`, no `next/image`, no Server Components. |
| 19 | Skipping `prefers-reduced-motion` on a new animation | Honour the media query (Rule 10, `13_UI_Guidelines.md` §7.2). |
| 20 | Blocking the UI on a remote call when local data exists | Optimistic UI from local SQLite; sync in the background (Rule 7, P5). |
| 21 | Using `unsafe` without a `// SAFETY:` comment | Stop and ask per §8 #9. `unsafe` opts out of Rust's safety guarantees. |

---

## 13. Cross-Reference Summary

| Topic in this file | Master spec cross-ref |
|---|---|
| 10 non-negotiable rules | top-level `AGENTS.md` §2 |
| Spec → code → test loop | top-level `AGENTS.md` §0.1 |
| Stop-and-ask triggers | top-level `AGENTS.md` §8 |
| Anti-patterns | top-level `AGENTS.md` §10 |
| Reading order for new agents | top-level `AGENTS.md` §4.1 |
| File map (monorepo) | top-level `AGENTS.md` §3 |
| Desktop stack snapshot | top-level `AGENTS.md` §3.2 + `01_Architecture.md` §2 |
| Five screens only | top-level `AGENTS.md` §2 Rule 4, `02_Core_Logic.md` §1.1 |
| No indigo/blue accents | top-level `AGENTS.md` §2 Rule 5, `13_UI_Guidelines.md` §2 |
| Integer paise, never float | top-level `AGENTS.md` §2 Rule 6, `11_Data_Model.md` §1 |
| Append-only ledger | top-level `AGENTS.md` §2 Rule 1, `12_Business_Rules.md` BR-LED-01 |
| sync_outbox on every mutation | top-level `AGENTS.md` §2 Rule 7, `12_Business_Rules.md` BR-SYN-02 |
| No telemetry | top-level `AGENTS.md` §2 Rule 3, `10_Security.md` §17 |
| No silent failures | top-level `AGENTS.md` §2 Rule 9 |
| Accessibility (WCAG AA) | top-level `AGENTS.md` §2 Rule 10, `13_UI_Guidelines.md` §10 |

---

## 14. Final Note

The desktop app is a livelihood tool, not a toy (`00_Vision.md` §1.3, top-level `AGENTS.md` §1.3). A tutor's month-end fees depend on the ledger being correct. A tutor's receipt numbering must never collide. A tutor's backup must restore on the day their laptop is stolen. Every shortcut you take — a `unwrap()` in a command, a skipped `sync_outbox` write, a silent `catch {}`, a broadened Tauri capability — is a shortcut paid for, eventually, by a tutor who cannot afford it.

When you are tempted to skip a step, ask: *would I ship this to the maths teacher in Nagpur who has 40 students, three batches, and one laptop?* If the answer is "no," do not ship it.

The spec is the contract. The code is the implementation. The worklog is the audit trail. The order matters.

---

*This file is the desktop operating manual. Read it first, before any desktop spec. When a desktop spec and this file disagree, the desktop spec wins — unless the desktop spec is wrong, in which case you amend the desktop spec first, then the code, then this file. The order matters.*

---

## 15. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers the two orientation artefacts this AGENTS.md owns: the reading-order flowchart (§2 above, rendered as a diagram so a fresh agent can scan it in 5 seconds) and the stop-and-ask decision tree (§8 above, rendered as a triage diagram so the trigger → reviewer mapping is unambiguous).

### 15.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The desktop agent operates on code, not pixels — but every UI affordance the agent's code produces must obey the rule. The eslint gate in §6.1 below enforces the no-indigo/no-blue palette at CI time; the mockups in the screen specs enforce the glass/neumorphic split at review time.

**Glass surfaces the desktop agent's code touches (§5.5 coverage map excerpt):**

| Surface | Glass tier | Code location |
|---|---|---|
| GlassShell root (cosmic canvas) | (none — raw gradient per §2.2) | `apps/desktop/src/GlassShell.tsx` |
| Top header bar (sticky) | `.glass-strong` | `@buddysaradhi/ui` `Header` primitive |
| Sidebar (5 routes + sync chip) | `.glass-strong` | `@buddysaradhi/ui` `Sidebar` primitive |
| Modal / sheet (PIN prompt, backup, restore) | `.glass-strong` + backdrop | `@buddysaradhi/ui` `Sheet` / `Modal` |
| Toast (DesktopError, update available) | `.glass-strong` + 4px accent left-bar | `@buddysaradhi/ui` `Toast` |

**Neumorphic controls the desktop agent's code touches (§6.6 coverage map excerpt):**

| Control | Recipe | Code location |
|---|---|---|
| Primary CTA (Save, Record Payment) | `.neumo-raised` + emerald glow | `@buddysaradhi/ui` `NeumoButton` |
| Toggle (auto-launch, biometric, density) | `.neumo-inset` well + raised knob | `@buddysaradhi/ui` `NeumoToggle` (per §6.4) |
| Input field (PIN, passphrase, search) | `.neumo-inset` + cyan focus ring | `@buddysaradhi/ui` `NeumoInput` |
| Segmented control (status filter, period) | `.neumo-inset` well + raised active pill | `@buddysaradhi/ui` `SegmentedControl` |

> **References.** Tauri 2 capabilities + security docs (tauri.app); Rust API Guidelines (rust-lang.github.io/api-guidelines); Apple Developer — Code Signing + Notarization (developer.apple.com); Microsoft Authenticode + SignTool docs (learn.microsoft.com); Linux AppImage docs (docs.appimage.org); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "Backdrop-Filter Performance Case Study"; Nielsen Norman Group — "Wireframing for UX Design". The mockups below are the agent's contract; the prose above is the rationale.

### 15.2 M1 — Reading-Order Flowchart

```
                          ┌──────────────────────────────────────────┐
                          │  New desktop agent · where to start?     │
                          │  ░ header (.glass-strong, 64px) ░         │
                          └────────────────────┬─────────────────────┘
                                               │
                                ┌──────────────┴──────────────┐
                                ▼                             ▼
                    ┌───────────────────────┐    ┌───────────────────────┐
                    │  Fresh / no task yet  │    │  Narrow task on a      │
                    │  → read in order      │    │  known surface         │
                    └───────────┬───────────┘    └───────────┬───────────┘
                                ▼                            │
       ┌────────────────────────────────────────────────────┐ │
       │  1. desktop/README.md  (orientation, decision tree)│ │
       │     ↓                                              │ │
       │  2. desktop/01_Architecture.md  (Tauri v2 + routes) │ │
       │     ↓                                              │ │
       │  3. src/components/buddysaradhi/*.tsx  (shared UI prim)  │ │
       │     ↓                                              │ │
       │  4. desktop/02_Rust_Core.md  (AppState + 7 commands)│ │
       │     ↓                                              │ │
       │  5. desktop/03_IPC_Security.md  (allowlist + CSP)   │ │
       │     ↓                                              │ │
       │  6. desktop/04_Code_Signing.md  (EV + notarize)     │ │
       │     ↓                                              │ │
       │  7. desktop/05_Updater.md  (manifest + channels)    │ │
       │     ↓                                              │ │
       │  8. desktop/06_Installers.md  (WiX + DMG + AppImg)  │ │
       │     ↓                                              │ │
       │  9. top-level AGENTS.md  (10 non-negotiables)       │ │
       │     ↓                                              │ │
       │ 10. desktop/AGENTS.md (this file — keep open)       │ │
       └────────────────────────────────────────────────────┘ │
                                                               │
                                ┌──────────────────────────────┴───────┐
                                ▼                                      ▼
            ┌────────────────────────┐              ┌──────────────────────────────┐
            │  "Add a Rust command"  │              │  "Ship a signed release"     │
            │  → 02_Rust_Core §6     │              │  → 04_Code_Signing +         │
            │  → 03_IPC_Security §2  │              │    06_Installers +           │
            │    (allowlist FIRST!)  │              │    05_Updater                │
            └────────────────────────┘              └──────────────────────────────┘
            ┌────────────────────────┐              ┌──────────────────────────────┐
            │  "Wire the updater"    │              │  "Add a Tauri permission"    │
            │  → 05_Updater          │              │  → 03_IPC_Security §2        │
            │  → 04_Code_Signing §6  │              │    then STOP and ask (§8 #1) │
            │    (keypair rotation)  │              │    ← flare border = stop     │
            └────────────────────────┘              └──────────────────────────────┘
   ↑ each step is a .glass card (5% white, 24px blur) with 2px accent left-border (§5.4)
   ↑ accent per branch: cyan = proceed, amber = release path, flare = STOP-and-ask
   ↑ the reading order is sequential (1→10) for fresh agents; branching for narrow tasks
   ↑ narrow-task readers MUST still read AGENTS.md (this file) — the §8 triggers apply to everyone
   ↑ any change touching >500 lines, any unsafe Rust, any 6th route → STOP and ask (§8 #4, #9, #10)
```

### 15.3 M2 — Stop-and-Ask Decision Tree

```
                            ┌──────────────────────────────────────────────┐
                            │  You are about to commit a desktop change.   │
                            │  Does it match any §8 trigger?               │
                            │  ░ glass-strong backdrop + cyan ring (§10.3) ░│
                            └─────────────────────────┬────────────────────┘
                                                      │
                            ┌─────────────────────────┴────────────────────┐
                            ▼                                              ▼
                    ┌─────────────────┐                          ┌─────────────────────┐
                    │  NO trigger     │                          │  YES — at least one │
                    │  matches        │                          │  trigger fires      │
                    └────────┬────────┘                          └──────────┬──────────┘
                             ▼                                              ▼
                ┌────────────────────────┐               ┌──────────────────────────────────┐
                │  Proceed:               │               │  Stop coding. Commit WIP with    │
                │  • cargo fmt + clippy   │               │  `chore(wip): <what> — pending   │
                │  • cargo test           │               │  human review`.                   │
                │  • bun lint + typecheck │               │  Open draft PR with ## Spec ref  │
                │  • update worklog       │               │  + ## Risk blocks filled in.     │
                │  • open PR citing spec  │               │  Log BLOCKED in worklog.md.      │
                └────────────────────────┘               └────────────────┬─────────────────┘
                                                                       │
                                  ┌────────────────────────────────────┴────────────────────────┐
                                  ▼                          ▼                          ▼         ▼
                  ┌────────────────────────┐    ┌────────────────────────┐   ┌──────────────────┐ ┌──────────────────┐
                  │  Trigger #1, #7, #8    │    │  Trigger #2, #6, #9    │   │  Trigger #3      │ │  Trigger #4, #11 │
                  │  (permission, network, │    │  (new dep, ledger/     │   │  (SQLCipher key  │ │  (6th route,     │ │
                  │   config block)        │    │   backup schema,       │   │   derivation)    │ │   this file)     │
                  │  → Security reviewer   │    │   unsafe)              │   │  → 2 reviewers   │ │  → Orchestrator  │
                  │                        │    │  → Security + Rust     │   │    incl. crypto  │ │    sign-off      │
                  └────────────────────────┘    └────────────────────────┘   └──────────────────┘ └──────────────────┘
                  ┌────────────────────────┐    ┌────────────────────────┐   ┌──────────────────┐ ┌──────────────────┐
                  │  Trigger #5            │    │  Trigger #10           │   │  Trigger #12     │ │  Trigger #3, #6  │
                  │  (indigo/blue accent)  │    │  (>500 lines)          │   │  (quick fix that │ │  (combined)      │
                  │  → Design reviewer     │    │  → 2 reviewers +       │   │   violates §5)   │ │  → 2 reviewers + │
                  │                        │    │    flag in PR desc     │   │  → Rule's named  │ │    ledger-crypto │
                  │                        │    │                        │   │    reviewer      │ │    owner         │
                  └────────────────────────┘    └────────────────────────┘   └──────────────────┘ └──────────────────┘
   ↑ every leaf is a .glass card with a 2px accent left-border (§5.4)
   ↑ accent: cyan = proceed, amber = needs reviewer, flare = needs 2 reviewers + stop
   ↑ the cyan-ringed header is the focus-visible state per §10.3 (the agent's attention ring)
   ↑ all 12 triggers in §8 are represented — no trigger is silently dropped
   ↑ "Stop and ask" is not a failure — it is the structural defence against the anti-patterns in §12
```

### 15.4 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (flowchart / decision tree) | M1 reading-order flowchart, M2 stop-and-ask decision tree |
| Full-screen layout | (n/a — AGENTS.md is not a screen) |
| Component anatomy | (n/a — AGENTS.md has no UI components) |
| State matrix | (n/a — AGENTS.md has no interactive controls) |

> Both mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 80–112 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5; neumorphic recipes referenced in the design-system callout above. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.4`, `§6.6`, `§8`, `§10.3`, `§12`, `BR-LED-01`, `BR-SYN-02`, `BR-SEC-04`, `P6`, `P11`).
