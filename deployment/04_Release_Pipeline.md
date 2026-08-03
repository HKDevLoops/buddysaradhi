# 04 — Release Pipeline (Master Flow)

> The end-to-end story of how code goes from `git push` to running on user devices across all three platforms (Web / Mobile / Desktop) at the same version, on the same day, with a verified rollback. This file is the **choreography** that ties together `01_Vercel_Hosting.md`, `02_Vercel_Blob_Build_Storage.md`, `03_EAS_Build_and_Update_Channels.md`, and `05_CI_CD_GitHub_Actions.md`. Every release-engineering agent reads this file before a release; every release follows the checklist in §5; every rollback follows the playbook in §6.

---

## 1. The pipeline at a glance

```
                                   git push (tag v1.4.0)
                                              │
                                              ▼
                          ┌─────────────────────────────────────────┐
                          │       GitHub Actions orchestrator        │
                          │   (lint.yml gate → 4 parallel pipelines) │
                          └─────────────────────────────────────────┘
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                                ▼
    ┌─────────────────────┐        ┌──────────────────────┐         ┌────────────────────────────┐
    │  WEB (Vercel)        │        │  MOBILE (EAS)         │         │  DESKTOP (Tauri v2)        │
    │                      │        │                       │         │                            │
    │  Push to main →      │        │  Tag v1.4.0 →         │         │  Tag v1.4.0 →              │
    │  Vercel auto-build   │        │  eas-build.yml:       │         │  desktop-build.yml:        │
    │  → 90s production    │        │  iOS + Android        │         │  matrix(windows/macos/     │
    │  → preview per PR    │        │  → auto-submit to     │         │  linux) → cargo build      │
    │                      │        │  TestFlight + Play    │         │  → sign + notarize         │
    │  Vercel Web Analyt.  │        │  → store review 1–3d  │         │  → upload to Vercel Blob   │
    │  + Speed Insights    │        │                       │         │  → update manifest JSON    │
    │                      │        │  OTA via eas-update:  │         │                            │
    │  Rollback: instant   │        │  push to main → JS    │         │  Auto-update: Tauri        │
    │  (Vercel UI, 1 click)│        │  patch → 15-min reach │         │  updater polls manifest    │
    └─────────────────────┘        └──────────────────────┘         └────────────────────────────┘
              │                               │                                │
              │                               ▼                                │
              │                   ┌──────────────────────┐                    │
              │                   │  APK mirror to       │                    │
              │                   │  Vercel Blob         │◀───────────────────┘
              │                   │  (sideload hub)      │   installer + manifest
              │                   └──────────────────────┘
              │                               │
              └─────────────┬─────────────────┘
                            ▼
                ┌────────────────────────────┐
                │  Single source of truth:   │
                │  package.json version      │
                │  → tauri.conf.json version │
                │  → app.json version        │
                │  → eas.json build number   │
                │  (bun run version:bump)    │
                └────────────────────────────┘
                            │
                            ▼
                ┌────────────────────────────┐
                │  release.yml (manual       │
                │  dispatch):                │
                │  GitHub Release +          │
                │  changelog + tweet +       │
                │  Sentry release tag (v2)   │
                └────────────────────────────┘
                            │
                            ▼
                ┌────────────────────────────┐
                │  Monitor for 1 hour:       │
                │  Vercel Speed Insights,    │
                │  EAS OTA errors,           │
                │  Tauri updater 4xx/5xx,    │
                │  Statuspage components.    │
                └────────────────────────────┘
                            │
                            ▼
                       (Live. Done.)
```

The pipeline has **four moving parts** (Vercel, EAS native, EAS OTA, Tauri+Blob), **one synchronisation point** (the version-bump script), **one manual gate** (the `release.yml` workflow_dispatch), and **one observability surface** (the 1-hour post-release monitor).

---

## 2. Versioning

### 2.1 The semver rule

Buddysaradhi uses **semantic versioning** (`MAJOR.MINOR.PATCH`) with a build number:

- **MAJOR:** a breaking schema change. The local SQLite / Turso schema cannot be migrated forward without data loss; the user must run a migration on first launch. Example: v1 → v2 (multi-device sync, `15_Future_Roadmap.md` v2.0).
- **MINOR:** a new feature with a backward-compatible schema change. The schema migrates forward cleanly; no user action required. Example: v1.3 → v1.4 (platform store distribution, `15_Future_Roadmap.md` v1.4).
- **PATCH:** a bug fix or non-feature change. No schema change. Example: v1.4.0 → v1.4.1 (a fix for an LWW tie-break edge case).
- **Build number:** an integer (e.g., `140`, `141`, `142`) required by the iOS App Store (`CFBundleVersion`) and Google Play (`versionCode`). Encoded from semver: `MAJOR × 100 + MINOR × 10 + PATCH`. So `1.4.0` → `140`, `1.4.1` → `141`, `2.0.0` → `200`. (This scheme supports up to 9 minor versions per major and 9 patches per minor — sufficient for Buddysaradhi's cadence; if exceeded, switch to `MAJOR × 10000 + MINOR × 100 + PATCH`.)

### 2.2 The single source of truth

The version lives in **one canonical file**: `package.json` at the monorepo root. The `bun run version:bump` script (`§2.3`) propagates the version to:

| File | Field | Format |
|---|---|---|
| `package.json` (root) | `version` | `"1.4.0"` (semver string) |
| `apps/web/package.json` | `version` | `"1.4.0"` (semver string) |
| `apps/mobile/package.json` | `version` | `"1.4.0"` (semver string) |
| `apps/mobile/app.json` | `expo.version` | `"1.4.0"` (semver string) |
| `apps/mobile/app.json` | `expo.ios.buildNumber` | `"140"` (build number string) |
| `apps/mobile/app.json` | `expo.android.versionCode` | `140` (build number integer) |
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | `"1.4.0"` (semver string) |
| `apps/desktop/src-tauri/tauri.conf.json` | `plugins.updater.version` | `"1.4.0"` (semver string) |
| `Buddysaradhi_Planning/deployment/CHANGELOG.md` | latest entry | `## [1.4.0] — 2025-08-15` |

### 2.3 The `bun run version:bump` script

```typescript
// scripts/version-bump.ts
// Implements: deployment/04_Release_Pipeline.md §2.3 — version sync
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: bun run version:bump <major.minor.patch>');
  process.exit(1);
}

const newVersion = args[0];
const semverRegex = /^\d+\.\d+\.\d+$/;
if (!semverRegex.test(newVersion)) {
  console.error(`Invalid semver: ${newVersion}`);
  process.exit(1);
}

const [major, minor, patch] = newVersion.split('.').map(Number);
const buildNumber = major * 100 + minor * 10 + patch;

// 1. Root package.json
const rootPkg = JSON.parse(readFileSync('package.json', 'utf8'));
rootPkg.version = newVersion;
writeFileSync('package.json', JSON.stringify(rootPkg, null, 2) + '\n');

// 2. apps/web/package.json
const webPkg = JSON.parse(readFileSync('apps/web/package.json', 'utf8'));
webPkg.version = newVersion;
writeFileSync('apps/web/package.json', JSON.stringify(webPkg, null, 2) + '\n');

// 3. apps/mobile/package.json
const mobilePkg = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8'));
mobilePkg.version = newVersion;
writeFileSync('apps/mobile/package.json', JSON.stringify(mobilePkg, null, 2) + '\n');

// 4. apps/mobile/app.json
const appJson = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8'));
appJson.expo.version = newVersion;
appJson.expo.ios.buildNumber = String(buildNumber);
appJson.expo.android.versionCode = buildNumber;
writeFileSync('apps/mobile/app.json', JSON.stringify(appJson, null, 2) + '\n');

// 5. apps/desktop/src-tauri/tauri.conf.json
const tauriConf = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
tauriConf.version = newVersion;
tauriConf.plugins = tauriConf.plugins ?? {};
tauriConf.plugins.updater = tauriConf.plugins.updater ?? {};
tauriConf.plugins.updater.version = newVersion;
writeFileSync('apps/desktop/src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');

// 6. CHANGELOG.md — prepend new entry
const changelogPath = 'Buddysaradhi_Planning/deployment/CHANGELOG.md';
const today = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(changelogPath, 'utf8');
const newEntry = `## [${newVersion}] — ${today}\n\n_TBD — fill in before release._\n\n`;
writeFileSync(changelogPath, newEntry + changelog);

console.log(`✓ Bumped version to ${newVersion} (build ${buildNumber})`);
```

The script is run by the release-engineering agent at the start of every release (see §5 — checklist item 1). It is **never** run by CI automatically — version bumps are intentional, human-gated actions.

### 2.4 The "no manual version edits" rule

No file listed in §2.2 may have its version field edited by hand. The `version-bump.test.ts` CI lint (`05_CI_CD_GitHub_Actions.md` §3) checks that every file's version field matches `package.json`'s version. Drift = CI failure = no merge.

---

## 3. Release types

### 3.1 PATCH (bug fix, no schema change)

A PATCH release fixes a bug without changing the schema or adding a feature. Examples: a wrong rounding in `formatINR`, a crash on a specific Android version, a typo in the UI.

| Surface | What happens | User impact |
|---|---|---|
| **Web** | Push to `main` → Vercel auto-deploys in ~90s. | Tutors see the fix on next page load. |
| **Mobile (OTA)** | `eas-update.yml` triggers → OTA push to `production` channel. | Tutors get the fix on next app foreground (~15 min reach). |
| **Mobile (native)** | None — OTA is sufficient. | No store review. |
| **Desktop** | `desktop-build.yml` triggers on tag `v*` (Tauri bundles the Next.js static export into the binary — there is **no** JS-only OTA path for an offline-first desktop app). The 24-hour soak is shortened to **1 hour** per the hotfix rule in `02_Vercel_Blob_Build_Storage.md` §6.2. The Tauri updater downloads a delta patch (smaller than the full installer) and applies it on next launch. | Tutors get the fix on next desktop app launch (the updater polls the manifest every 5 min and applies on next launch). |
| **Sentry/telemetry** | None (no Sentry in v1). | n/a |

A PATCH release is the **fastest** path for Web + Mobile OTA — no store review, no JS-only build for mobile. The desktop surface still requires a new signed installer (because Tauri bundles the JS), but the 1-hour soak + delta-patch download keeps the user-side latency under 30 minutes from `git push` to "every online tutor has the fix." Offline tutors pick up the fix on next foreground/launch.

### 3.2 MINOR (new feature, backward-compatible schema)

A MINOR release adds a feature with a forward-compatible schema migration. Examples: bulk fee adjust (`15_Future_Roadmap.md` v1.3), platform store distribution (v1.4).

| Surface | What happens | User impact |
|---|---|---|
| **Web** | Push to `main` → Vercel auto-deploys. | Tutors see the new feature on next page load. |
| **Mobile (native)** | `eas-build.yml` triggers on tag `v*` → new iOS + Android builds → auto-submit to TestFlight + Play Internal. | Beta testers get the new build in ~1 hour; production tutors get it after Apple/Google review (1–3 days). |
| **Mobile (OTA)** | After the binary is live, `eas-update.yml` ships JS-only patches via OTA. | Tutors on the new binary get JS patches; tutors on the old binary see "App update required" linking to the store. |
| **Desktop** | `desktop-build.yml` triggers on tag `v*` → new Windows + macOS + Linux installers → upload to Blob → update `desktop-staging.json` → 24-hour soak → promote to `desktop-stable.json`. | Tutors on the desktop app see "Update available" within ~5 min of the manifest update; auto-update applies on next launch. |
| **Sentry/telemetry** | None (no Sentry in v1). | n/a |

A MINOR release takes **3–7 days** end-to-end (the Apple/Google review is the long pole). The web + desktop surfaces ship on day 1; mobile ships when the stores approve.

### 3.3 MAJOR (breaking schema change)

A MAJOR release changes the schema in a way that requires a migration on first launch. Example: v1 → v2 (multi-device sync, `15_Future_Roadmap.md` v2.0).

| Surface | What happens | User impact |
|---|---|---|
| **Web** | Push to `main` → Vercel auto-deploys. The first request after deploy triggers the per-user Turso DB migration (via the `migrations/NNNN_*.sql` files). | Tutors see a brief "Upgrading your data..." splash on first page load (typically <2s for a 1000-student tenant). |
| **Mobile (native)** | `eas-build.yml` triggers → new binaries with the new schema + migration code. | Tutors must update via the App Store / Play Store; the old binary cannot read the new schema (the API returns a `schema_version_mismatch` error). |
| **Mobile (OTA)** | None — OTA cannot change the migration code (it ships with the binary). | Tutors on the old binary see "App update required." |
| **Desktop** | `desktop-build.yml` triggers → new installers. The Tauri updater's `minimum_auto_update_from` field in the manifest is set to the previous MAJOR version (e.g., `1.0.0` for v2.0.0). Tutors on older versions see "Please reinstall" instead of an auto-update. | Tutors manually download the new installer from the web hub; the auto-updater does not handle MAJOR upgrades. |
| **Sentry/telemetry** | None (no Sentry in v1). | n/a |

A MAJOR release is the **most coordinated** — all three surfaces must ship at the same version on the same day, because the schema migration is one-way (once a tutor's Turso DB is migrated to v2, the v1 app cannot read it). The rollback is **not** "deploy the old code" — it's "restore the tutor's DB from a pre-migration backup" (`09_Backup_and_Import_Export.md` §11, `14_Edge_Cases.md` EC-M-03). This is the heaviest rollback in the system.

> **Note.** MAJOR releases are rare (one per year, max). The first MAJOR is v2.0 (multi-device sync). The release-engineering agent must read `15_Future_Roadmap.md` v2.0 in full before planning a MAJOR release.

---

## 4. The release cadence

| Release type | Cadence | Lead time |
|---|---|---|
| **PATCH** | As needed (typically 1-2 per week) | <1 day |
| **MINOR** | Monthly (per `15_Future_Roadmap.md` v1.x quarterly themes — but intra-quarter MINOR releases for urgent features are allowed) | 1 week (3-day beta + 3-day store review) |
| **MAJOR** | Yearly (per `15_Future_Roadmap.md`) | 4-6 weeks (RFC + amendment + beta + migration tooling) |

The cadence is **not** a release train — Buddysaradhi does not have a fixed "second Tuesday of the month" release schedule. The cadence is **event-driven**: a PATCH ships when a bug is fixed; a MINOR ships when a feature is ready; a MAJOR ships when an amendment is ratified.

---

## 5. The 15-item release checklist

Every MINOR and MAJOR release follows this checklist. PATCH releases follow items 1, 2, 4, 5, 6, 7, 11, 13 (skipping the staging build, manual smoke, and store submission steps).

| # | Step | Owner | Surface | Time |
|---|------|-------|---------|------|
| 1 | `bun run version:bump <new-version>` | Release eng | All | 1 min |
| 2 | Write the changelog entry in `CHANGELOG.md` | Release eng | All | 10 min |
| 3 | Run snapshot tests + lint + typecheck locally | Release eng | All | 5 min |
| 4 | Open PR `release/v<new-version>` against `main` | Release eng | All | 2 min |
| 5 | CI runs `lint.yml` on the PR (lint + typecheck + unit + integration + a11y) | CI | All | 10 min |
| 6 | Vercel auto-deploys a preview at `buddysaradhi-pr-<n>.vercel.app` | Vercel | Web | 90 s |
| 7 | 15-min `webDevReview` cron runs agent-browser smoke against the preview | Cron | Web | 15 min |
| 8 | Tag `v<new-version>` on the PR branch (or `main` after merge) | Release eng | All | 1 min |
| 9 | `desktop-build.yml` triggers → builds Windows/macOS/Linux → uploads to Blob → updates `desktop-staging.json` | CI | Desktop | 30 min |
| 10 | `eas-build.yml` triggers → builds iOS/Android → auto-submits to TestFlight + Play Internal | CI | Mobile | 25 min (iOS) + 12 min (Android) |
| 11 | Manual smoke on staging: open the staging desktop app, install the TestFlight build, install the Play Internal build, run the golden-path flows | Release eng | All | 60 min |
| 12 | Promote desktop: `release.yml` workflow_dispatch with `from=staging, to=stable` → updates `desktop-stable.json` | Release eng | Desktop | 1 min |
| 13 | Merge the PR to `main` → Vercel auto-deploys production → `eas-update.yml` ships OTA to `production` channel | CI + Vercel + EAS | Web + Mobile OTA | 90 s + 15 min OTA reach |
| 14 | Monitor Sentry (v2) + Vercel Speed Insights + EAS OTA errors + Tauri updater 4xx/5xx + Statuspage components for 1 hour | Release eng | All | 60 min |
| 15 | Post-release: archive release notes to GitHub Releases, tweet from `@buddysaradhi`, append `---`-delimited entry to `worklog.md` | Release eng | All | 15 min |

**Total wall-clock time for a MINOR release:** ~4-6 hours of active work + 3-7 days of store review wait. The active work is front-loaded (steps 1-12 in the first 2 hours); the wait is back-loaded (Apple/Google review).

### 5.1 Checklist item 14 (monitor) — what to watch

| Signal | Where | Threshold | Action |
|---|---|---|---|
| Vercel Speed Insights LCP | Vercel dashboard | Median LCP > 2.5s for 5 min | Roll back web (§6.1) |
| Vercel 5xx error rate | Vercel dashboard | > 1% of requests for 5 min | Roll back web |
| EAS OTA error rate | EAS dashboard | > 5% of OTA installs fail | Roll back OTA (§6.2) |
| Tauri updater 4xx/5xx | Vercel Blob logs + custom `/api/update-metrics` endpoint | > 5% of manifest fetches fail | Investigate (likely Blob outage — §11 in `02_Vercel_Blob_Build_Storage.md`) |
| Statuspage "Web App" component | `status.buddysaradhi.app` | Any non-Operational state | Investigate; if external (Vercel down), wait; if internal (bad deploy), roll back |
| `audit_log` error spike | `/api/admin/audit-log` (server-only) | > 10 `error_unhandled` rows in 5 min | Investigate; if from a specific code path, hotfix |

The 1-hour monitor is **non-negotiable**. A release that is unmonitored for the first hour is a release that fails silently — the first tutor to hit a bug at 7 AM on Monday is the canary.

---

## 6. Rollback playbook

### 6.1 Web rollback (Vercel Instant Rollback)

**Trigger:** Vercel Speed Insights LCP regression, 5xx error spike, or a manual "this is broken" call from a tutor.

**Steps:**

1. Vercel dashboard → Buddysaradhi project → Deployments.
2. Find the most recent stable deployment (the one before the bad merge).
3. Click "..." → "Instant Rollback".
4. Confirm.
5. Verify in agent-browser: `buddysaradhi.app` renders the previous version.
6. Append `---` entry to `worklog.md` with: the bad deployment URL, the rolled-back-to deployment URL, the reason, the next step (hotfix or revert PR).

**Time to roll back:** <60 seconds.

### 6.2 Mobile OTA rollback (`eas update --republish`)

**Trigger:** OTA error rate spike, or a tutor-reported crash on the new JS.

**Steps:**

1. EAS dashboard → Buddysaradhi project → Updates → `production` channel.
2. Find the prior update (the one before the bad push). Note its `<build-id>`.
3. `eas update --branch production --republish <prior-build-id>`.
4. Verify: a test device on the `production` channel sees the prior JS on next foreground.
5. Append `---` entry to `worklog.md`.

**Time to roll back:** <5 minutes (the republish is instant; device-side rollback happens on next foreground, ~15 min reach).

### 6.3 Mobile native rollback (re-publish prior build to stores)

**Trigger:** A native-only bug (not fixable via OTA) in a released binary.

**Steps:**

1. App Store Connect + Play Console: find the prior production build (the one before the bad release).
2. In App Store Connect: select the prior build → "Promote to App Store" → submit for Apple review (1-3 days).
3. In Play Console: select the prior build → "Promote to Production" → review (hours).
4. Once approved, the prior build is live on the stores.
5. Append `---` entry to `worklog.md`.

**Time to roll back:** 1-7 days (the store review is the long pole). This is the **slowest** rollback — avoid needing it by thoroughly beta-testing native builds (§9 in `03_EAS_Build_and_Update_Channels.md`).

### 6.4 Desktop rollback (manifest edit)

**Trigger:** A bad installer has been promoted to `desktop-stable.json` and tutors are auto-updating to it.

**Steps:**

1. Read `manifests/desktop-stable.json` from Blob.
2. Edit the `version`, `platforms.*.url`, `platforms.*.signature`, `sha256.*` fields to point at the prior installer (e.g., downgrade from 1.4.0 to 1.3.2 — the URLs and signatures for 1.3.2 are still in Blob per the retention policy, `02_Vercel_Blob_Build_Storage.md` §7).
3. Bump the `pub_date` to the current time (so the Tauri updater sees a "newer" manifest).
4. Write to `manifests/desktop-stable.json` using the atomic-update pattern (`02_Vercel_Blob_Build_Storage.md` §5.2).
5. Verify (§5.4 in `02_Vercel_Blob_Build_Storage.md`).
6. Desktop apps polling the manifest on next launch see the prior version is "newer" (per `pub_date`) and roll back automatically.
7. Append `---` entry to `worklog.md`.

**Time to roll back:** <5 minutes (the manifest edit is instant; desktop apps roll back on next launch, ~24h reach for offline tutors).

> **Caveat.** The Tauri updater's rollback works only if `minimum_auto_update_from` permits it. If the bad version (e.g., 1.4.0) was promoted with `minimum_auto_update_from: 1.3.0`, then a tutor on 1.4.0 can roll back to 1.3.2 (which is ≥ 1.3.0). If the bad version was a MAJOR (e.g., 2.0.0) with `minimum_auto_update_from: 2.0.0`, then rolling back to 1.x is **not** auto-updateable — the tutor sees "Please reinstall from the web hub" instead. This is by design: MAJOR rollbacks require manual reinstall (§3.3).

### 6.5 MAJOR rollback (restore from backup)

**Trigger:** A MAJOR release (e.g., v2.0) has corrupted a tutor's data via a bad migration.

**Steps:**

1. The tutor reports the corruption via support.
2. The release-engineering agent confirms the migration bug.
3. The agent instructs the tutor to: (a) export a `.buddysaradhi` backup from the v2 app (if possible), (b) uninstall the v2 app, (c) install the prior MAJOR (v1.x) app, (d) restore the most recent pre-v2 backup (the tutor should have one per `09_Backup_and_Import_Export.md` §6 — the recommended cadence is weekly).
4. The tutor's DB is now at v1.x, pre-migration.
5. The agent issues a hotfix (§7) to the migration code, cuts a new v2.0.1, and the tutor re-attempts the upgrade.

**Time to roll back:** 30-60 minutes (tutor-side, with agent guidance). This is the **heaviest** rollback — it requires the tutor's active participation and a pre-migration backup. The mitigation is thorough migration testing in staging (item 11 in §5).

> **Reference.** `14_Edge_Cases.md` EC-M-02 specifies the "migration fails mid-way" edge case (transaction rolls back, `schema_version` unchanged), and EC-M-03 specifies the "downgrade attempt" edge case (older app cannot read newer schema). The rollback above operationalises both: the tutor restores a pre-migration backup (EC-M-02 recovery) onto an older app version that can read it (EC-M-03 acceptance).

---

## 7. Hotfix branch strategy

### 7.1 When a hotfix is needed

A hotfix is a PATCH release cut from `main` outside the normal cadence, in response to a production bug. Examples: a crash on a specific Android version, a wrong calculation in the ledger, a security fix.

### 7.2 The hotfix branch

```
main ────●─────────────●─────────●───── (v1.4.1 merged)
          \           /          │
           ●─●─●─●───●           │  ← hotfix/v1.4.1
            (v1.4.0 tag)         │
                                 │
release/1.4.x ───────────────────●───── (v1.4.1 cherry-picked)
                                 │
                                 ●───── (v1.4.2 cherry-picked later)
```

The hotfix branch `hotfix/v1.4.1` is created from the `v1.4.0` tag:

```bash
git checkout -b hotfix/v1.4.1 v1.4.0
# ... make the fix ...
bun run version:bump 1.4.1
git commit -am "fix(fees): correct LWW tie-break on locked session (v1.4.1)"
git tag v1.4.1
git push origin hotfix/v1.4.1 --tags
```

### 7.3 The merge-back

After the hotfix ships, the branch is merged back to:

1. **`main`** — so the fix is in the next MINOR release.
2. **`release/1.4.x`** (if it exists) — so the fix is in the next 1.4.x patch release.

The merge-back is a standard PR with the `## Spec ref` block citing the hotfix's spec section (`AGENTS.md` §5.3).

### 7.4 The "hotfix does not skip CI" rule

A hotfix follows the same CI gate as any other PR: lint + typecheck + unit + integration + a11y. There is no "hotfix bypass" — a hotfix that skips CI is a hotfix that risks introducing a second bug while fixing the first.

The only **speedup** for a hotfix is:

- The PR is small (typically 1-10 lines), so CI runs fast.
- The PR is reviewed by one reviewer (not two) per `AGENTS.md` §5.4 (<300 lines, no ledger/security/AGENTS touch).
- The release-engineering agent monitors the deploy actively (item 14 in §5) for 1 hour, instead of moving on to the next task.

### 7.5 The "hotfix OTA is instant" path

For a hotfix that is OTA-eligible (`03_EAS_Build_and_Update_Channels.md` §5.2 — JS-only change), the OTA push is:

```bash
eas update --branch production --channel production \
  --message "fix(fees): correct LWW tie-break on locked session (hotfix v1.4.1)" \
  --non-interactive
```

This reaches all production-channel devices in ~15 minutes. The web rollback is instant (Vercel). The desktop rollback is the manifest swap (`02_Vercel_Blob_Build_Storage.md` §6 — staging → stable promotion of the hotfix's new installer).

A well-executed hotfix can go from "bug reported" to "fix live on all three surfaces" in **under 1 hour**.

---

## 8. The release coordination contract

### 8.1 The "same version on the same day" rule

For MINOR and MAJOR releases, all three surfaces must ship at the **same version** on the **same day** (where "same day" is ±24 hours to accommodate Apple/Google review delays). A tutor on v1.4.2-mobile and v1.4.3-desktop sees two different realities — that is a release-engineering failure.

The contract is enforced by:

1. **The version-bump script** (§2.3) updates all surfaces in lockstep. There is no "bump mobile but not desktop" path.
2. **The release checklist** (§5) walks through every surface in order, with explicit "did this surface ship at v1.4.x?" checkmarks.
3. **The post-release worklog entry** (item 15 in §5) records the version on each surface and the timestamp of each ship.

### 8.2 The "PATCH releases can drift" exception

PATCH releases (§3.1) can drift across surfaces by 1-2 patch versions, because:

- Web PATCH is instant (Vercel auto-deploy).
- Mobile OTA PATCH is ~15 min reach.
- Desktop PATCH is ~5 min manifest swap + ~24h reach for offline tutors.

A tutor on v1.4.0-web, v1.4.1-mobile (OTA already applied), and v1.4.0-desktop (not yet launched today) is **acceptable** — the differences are bug fixes, not features. The drift closes within 24 hours as the desktop app polls the manifest.

The drift is **not** acceptable for MINOR or MAJOR releases, because those change features or schema.

### 8.3 The "no simultaneous MAJOR" rule

A MAJOR release (e.g., v2.0) must **not** ship while a MINOR release (e.g., v1.4.5) is in beta. The two would collide on the version-bump script, the changelog, the store review queue, and the tutor's mental model. The release-engineering agent ensures only one release is in flight at a time.

The exception is a **security hotfix** that cannot wait — it cuts through the in-flight release, ships as the in-flight release's version + 1 patch (e.g., v1.4.5-beta → v1.4.5 shipped as the security fix, v1.4.6 rescheduled), and the in-flight release is rebased.

---

## 9. The "what could go wrong" matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Vercel deploy fails on `main` push | Low | Web down for ~5 min | Vercel's atomic swap means the prior deployment stays live until the new one is ready. Rollback is instant. |
| EAS build fails on tag | Medium | Mobile release delayed | The `eas-build.yml` workflow retries 3 times; if all fail, the release-engineering agent investigates + cuts a re-tag (v1.4.0 → v1.4.0-1). |
| Apple rejects the build | Low | iOS release delayed 1-7 days | The 3-7 day beta cycle catches most rejection causes (privacy description, entitlements, etc.) before the production submit. |
| Tauri manifest is corrupt | Very low | Desktop auto-update fails | The verification step (`02_Vercel_Blob_Build_Storage.md` §5.4) catches corruption before publish. |
| Vercel Blob outage during release | Low | Desktop + sideload mobile delayed | The release waits for Blob to recover; the GitHub Releases fallback (`02_Vercel_Blob_Build_Storage.md` §11) covers the download hub. |
| Version-bump script has a bug | Low | All surfaces ship at the wrong version | The `version-bump.test.ts` CI lint catches drift before merge. |
| A secret leaks (e.g., `BLOB_READ_WRITE_TOKEN` in client bundle) | Very low (lint gate) | P0 security incident | The lint gate (`01_Vercel_Hosting.md` §4.3) blocks the merge. If it slips through, rotate the secret + audit access logs. |
| The 1-hour monitor catches a regression | Medium | Rollback required | The rollback playbooks (§6) cover every surface; the release-engineering agent executes the right one. |

---

## 10. The "first release" drill

Before the first production release (v1.0.0 or v1.4.0, whichever comes first), the release-engineering agent runs a **table-top exercise** of the entire checklist against staging infrastructure. The drill:

1. Bump version to `1.4.0-rc.1` (a release candidate, not a real release).
2. Walk through every item in §5, including the 1-hour monitor.
3. Trigger every rollback playbook (§6) at least once: roll back web, roll back OTA, roll back desktop manifest.
4. Verify each rollback succeeds and the system returns to the prior state.
5. Document the drill in `worklog.md` with timestamps, snags, and improvements.
6. Cut a real `1.4.0` release only after the drill passes.

The drill is **non-negotiable** for the first release. Subsequent releases can skip the drill if the release-engineering agent has run one in the last 90 days.

---

## 11. The cross-cutting contract this file makes

Every release-engineering agent executing a release agrees to:

1. **Never skip the version-bump script.** Manual version edits cause drift; the script is the only path.
2. **Never skip the 1-hour monitor.** An unmonitored release is a release that fails silently.
3. **Never ship a MAJOR without a table-top drill.** MAJOR rollbacks are heavy; the drill is the contract.
4. **Never cut a hotfix that bypasses CI.** CI is the gate; "hotfix urgency" is not a bypass reason.
5. **Never let surfaces drift on a MINOR.** Same version, same day, ±24 hours.
6. **Never roll back without a worklog entry.** A rollback without a documented reason is an unaccountable mutation.
7. **Always cite the spec in the release notes.** The `## Spec ref` block in the release PR (`AGENTS.md` §5.3) is mandatory.
8. **Always verify the rollback worked** in agent-browser / on a test device. "I clicked rollback" is not verification.
9. **Always communicate a delay.** If Apple/Google review slips, post on `status.buddysaradhi.app` and append to `worklog.md`.
10. **Always run `bun run lint` before tagging.** A tag that fails lint is a tag that fails CI, is a tag that fails the release.

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`). Box widths honour §20.3 rule 2 (80–120 for pipeline / decision-tree diagrams). The three mockups below visualise the *release choreography* this file owns — the PATCH/MINOR/MAJOR release-flow diagram (which surface ships what, when), the soak-time matrix (how long each release type soaks on each surface), and the rollback decision tree (which playbook runs for which signal). A fourth mini-mockup annotates the one live UI surface this file references (the release-engineer's checklist console) so the glass / neumorphic contract is visible where it applies.

### 12.1 Design System Reference (§5.5 + §6.6 single rule)

This file is the **release choreography view**, not a screen spec. Its artefacts are flow / matrix / decision-tree diagrams — concept diagrams per §20.4, governed by §20.1 + §20.6, and do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the one live UI surface this file references: the **release-engineer's checklist console** (the GitHub Release UI + the `release.yml` workflow_dispatch form), where the agent reads the 15-item checklist (§5) and clicks "Run workflow" to dispatch `release.yml`. That console is glass-equivalent content (the checklist is a content surface the agent reads); the "Run workflow" button is neumorphic-raised (it is a control the agent clicks); each checklist checkbox is a neumorphic-inset control (it is a toggle the agent manipulates).

| Artefact (this file) | Type | Glass / neumo tier (if live UI) |
|---|---|---|
| §12.2 PATCH/MINOR/MAJOR release-flow diagram | Concept diagram (flow) | (none — release-type routing) |
| §12.3 Soak-time matrix | Concept diagram (matrix) | (none — temporal table) |
| §12.4 Rollback decision tree | Concept diagram (decision tree) | (none — signal→playbook routing) |
| §12.5 Release-engineer's checklist console | Live UI surface (third-party) | `.glass`-equivalent checklist + `.neumo-raised` "Run workflow" + `.neumo-inset` checkboxes (per §6.6 single rule) |

### 12.2 PATCH / MINOR / MAJOR Release-Flow Diagram

Which surface ships what, when, for each release type. The three surfaces (Web / Mobile / Desktop) ship on different timelines: Web is instant (~90s), Mobile OTA is ~15 min, Mobile native + Desktop are tag-triggered binary builds (1–3 day store review for mobile, 24-hour soak for desktop). The diagram is the **single source of truth** for "what happens when I tag v1.4.0."

```
  PATCH / MINOR / MAJOR RELEASE-FLOW DIAGRAM  (§3, which surface ships what, when)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │                    ┌──────────────────────────────────────────────┐              │
  │                    │  git tag v<MAJOR.MINOR.PATCH>                │              │
  │                    │  + bun run version:bump (§2.3)               │              │
  │                    └──────────────────────────────────────────────┘              │
  │                                       │                                          │
  │                                       ▼                                          │
  │                    ┌──────────────────────────────────────────────┐              │
  │                    │  GitHub Actions orchestrator                  │              │
  │                    │  (lint.yml gate → 4 parallel pipelines)       │              │
  │                    └──────────────────────────────────────────────┘              │
  │                                       │                                          │
  │           ┌───────────────────────────┼───────────────────────────┐              │
  │           ▼                           ▼                           ▼              │
  │   ┌────────────────┐         ┌────────────────────┐      ┌────────────────────┐  │
  │   │  WEB (Vercel)  │         │  MOBILE (EAS)       │      │  DESKTOP (Tauri)  │  │
  │   │                │         │                     │      │                    │  │
  │   │  push to main  │         │  tag v* →           │      │  tag v* →         │  │
  │   │  → 90s prod    │         │  eas-build.yml      │      │  desktop-build.yml│  │
  │   │  (emerald ✓)   │         │  (cyan — building)  │      │  matrix(3 OSes)   │  │
  │   │                │         │                     │      │  (cyan — building)│  │
  │   │                │         │  ┌────────────────┐ │      │                    │  │
  │   │                │         │  │ iOS: 25 min    │ │      │  sign + notarize  │  │
  │   │                │         │  │ → TestFlight   │ │      │  → upload to Blob │  │
  │   │                │         │  │ → Apple review │ │      │  → desktop-       │  │
  │   │                │         │  │   1–3 days     │ │      │    staging.json   │  │
  │   │                │         │  │ (amber — soak) │ │      │  (cyan — staging) │  │
  │   │                │         │  ├────────────────┤ │      │                    │  │
  │   │                │         │  │ Android: 12 min│ │      │  24-hour soak     │  │
  │   │                │         │  │ → Play Internal│ │      │  (amber — soak)   │  │
  │   │                │         │  │ → Play review  │ │      │                    │  │
  │   │                │         │  │   hours        │ │      │  release.yml      │  │
  │   │                │         │  │ (amber — soak) │ │      │  workflow_dispatch│  │
  │   │                │         │  └────────────────┘ │      │  (violet — manual)│  │
  │   │                │         │                     │      │                    │  │
  │   │                │         │  APK mirror to Blob │      │  → desktop-       │  │
  │   │                │         │  (sideload hub)     │      │    stable.json    │  │
  │   │                │         │  (emerald ✓)        │      │  (emerald ✓ live) │  │
  │   │                │         │                     │      │                    │  │
  │   │                │         │  OTA: eas-update    │      │  Auto-update:     │  │
  │   │                │         │  push to main →     │      │  Tauri polls      │  │
  │   │                │         │  JS patch → 15-min  │      │  manifest → delta │  │
  │   │                │         │  reach (emerald ✓)  │      │  patch on next    │  │
  │   │                │         │                     │      │  launch (emerald) │  │
  │   └────────────────┘         └────────────────────┘      └────────────────────┘  │
  │           │                           │                           │              │
  │           │                           │                           │              │
  │           └───────────────────────────┼───────────────────────────┘              │
  │                                       ▼                                          │
  │                    ┌──────────────────────────────────────────────┐              │
  │                    │  release.yml (manual workflow_dispatch)       │              │
  │                    │  → GitHub Release + changelog + tweet         │              │
  │                    │  → (v2) Sentry release tag                    │              │
  │                    │  (violet — manual gate)                       │              │
  │                    └──────────────────────────────────────────────┘              │
  │                                       │                                          │
  │                                       ▼                                          │
  │                    ┌──────────────────────────────────────────────┐              │
  │                    │  Monitor for 1 hour (§5 item 14):             │              │
  │                    │  Vercel Speed Insights, EAS OTA errors,       │              │
  │                    │  Tauri updater 4xx/5xx, Statuspage components │              │
  │                    │  (cyan — monitoring)                          │              │
  │                    └──────────────────────────────────────────────┘              │
  │                                       │                                          │
  │                                       ▼                                          │
  │                                (Live. Done. emerald ✓)                            │
  │                                                                                  │
  │  RELEASE-TYPE NOTES (§3):                                                        │
  │   ↑ PATCH  = bug fix, no schema change. Web + Mobile OTA ship instantly.        │
  │              Desktop ships via 1-hour soak (hotfix rule, §3.1 + 02 §6.2).        │
  │   ↑ MINOR  = new feature, backward-compat schema. All 3 surfaces ship;          │
  │              mobile native + desktop require binary build (1–3 day store review  │
  │              for mobile; 24-hour soak for desktop).                              │
  │   ↑ MAJOR  = breaking schema change. All 3 surfaces ship; mobile + desktop       │
  │              require binary build; rollback = restore pre-migration backup       │
  │              (EC-M-02 + EC-M-03, §6.5).                                          │
  │                                                                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ The diagram is a concept diagram (release-type routing), not a rendered
     UI surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = live / verified, cyan = building / monitoring
     (in-progress), amber = soak (pending store review or 24-hour soak),
     violet = manual gate (release.yml workflow_dispatch), flare = rollback
     triggered (the §12.4 decision tree below).
   ↑ Cross-refs: §1 (pipeline at a glance), §2 (versioning), §3 (release
     types), §3.1 (PATCH), §3.2 (MINOR), §3.3 (MAJOR), §5 (15-item
     checklist), 02_Vercel_Blob §6 (promotion + soak), 03_EAS §6 (build →
     submit → OTA flow), 05_CI_CD §1 (workflow graph), 14_Edge_Cases.md
     EC-M-02 + EC-M-03 (MAJOR rollback), 15_Future_Roadmap.md v2.0 (first
     MAJOR), P13 (distribution), Rule 9 (no silent failures — the 1-hour
     monitor is the contract).
```

### 12.3 Soak-Time Matrix

How long each release type soaks on each surface before it reaches tutors. The soak is the **contract between CI and the tutor** (§3.2, 02_Vercel_Blob §6.2) — a build that has not soaked is a build that has not been verified by real traffic. Hotfixes shorten the soak to 1 hour (the floor); MAJOR releases require a table-top drill (§10) on top of the soak.

```
  SOAK-TIME MATRIX  (§3 + 02 §6.2, how long each release type soaks per surface)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │  RELEASE    │ WEB         │ MOBILE OTA   │ MOBILE NATIVE │ DESKTOP            │
  │  TYPE       │ (Vercel)    │ (eas-update) │ (eas-build)   │ (desktop-build)    │
  │  ────────   │ ────────    │ ──────────   │ ────────────  │ ────────────       │
  │                                                                                │
  │  PATCH      │ 0s (instant │ 0s (instant  │ n/a (OTA is   │ 1 hour (hotfix     │
  │  (bug fix)  │  on merge)  │  on push)    │  sufficient)  │  floor, §3.1)      │
  │             │ emerald ✓   │ emerald ✓    │ emerald ✓     │ amber — 1h soak    │
  │                                                                                │
  │  MINOR      │ 0s (instant │ 0s (after    │ 3–7 day beta  │ 24 hours (the      │
  │  (feature)  │  on merge)  │  binary live)│  on staging   │  standard soak,    │
  │             │ emerald ✓   │ emerald ✓    │ amber — beta  │  §6.2)             │
  │             │             │              │               │ amber — 24h soak   │
  │                                                                                │
  │  MAJOR      │ 0s (instant │ n/a (OTA     │ 3–7 day beta  │ 24 hours + table-  │
  │  (breaking) │  on merge)  │  cannot      │  on staging + │  top drill (§10)   │
  │             │ emerald ✓   │  change      │  migration    │ flare — high-      │
  │             │             │  migration)  │ flare — high  │  stakes, heaviest  │
  │             │             │              │ stakes        │  rollback          │
  │                                                                                │
  │  HOTFIX     │ 0s (instant │ 0s (instant  │ n/a (OTA-     │ 1 hour (the floor  │
  │  (urgent    │  on merge)  │  on push)    │  eligible)    │  — never below 1h, │
  │   PATCH)    │ emerald ✓   │ emerald ✓    │ emerald ✓     │  §7.5)             │
  │                                                                                │
  │  RULES (the soak contract):                                                   │
  │   ↑ The soak is the contract between CI and the tutor (02 §6.2).              │
  │   ↑ A build that has not soaked is a build that has not been verified         │
  │     by real staging-channel traffic.                                          │
  │   ↑ Hotfixes shorten the soak to 1 hour — the absolute floor. Below 1h,      │
  │     the build is "rushed," not "soaked."                                      │
  │   ↑ MAJOR releases add the table-top drill (§10) on top of the 24h soak —    │
  │     every rollback playbook triggered at least once.                          │
  │   ↑ The 1-hour post-release monitor (§5 item 14) is NOT a soak — it is the   │
  │     "did the release actually work?" watch.                                   │
  │                                                                                │
  │  THE "PATCH RELEASES CAN DRIFT" EXCEPTION (§8.2):                             │
  │   ↑ A tutor on v1.4.0-web, v1.4.1-mobile (OTA already applied), and          │
  │     v1.4.0-desktop (not yet launched today) is ACCEPTABLE — the              │
  │     differences are bug fixes, not features. Drift closes within 24h.         │
  │   ↑ Drift is NOT acceptable for MINOR or MAJOR (those change features or     │
  │     schema). Same version, same day, ±24 hours (§8.1).                        │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The matrix is a concept diagram (temporal table), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = live / no soak needed (instant ship), amber =
     soak (24h or beta cycle), flare = MAJOR (high-stakes, heaviest
     rollback), violet = hotfix (the 1-hour floor — manual urgency).
   ↑ Cross-refs: §3 (release types), §3.1 (PATCH), §3.2 (MINOR), §3.3
     (MAJOR), §5 item 14 (the 1-hour monitor), §7 (hotfix branch
     strategy), §7.5 (hotfix OTA is instant), §8.1 (same version, same
     day), §8.2 (PATCH drift exception), §10 (table-top drill),
     02_Vercel_Blob §6.2 (24-hour soak), 03_EAS §9 (TestFlight + Play
     Internal beta cycle), 14_Edge_Cases.md EC-M-02 + EC-M-03 (MAJOR
     rollback).
```

### 12.4 Rollback Decision Tree

Which rollback playbook runs for which signal. The tree is the **single source of truth** for "I see signal X — which §6 playbook do I run?" Every leaf is a named playbook with a named time-to-rollback. The tree is exhaustive — there is no rollback signal that does not land on exactly one leaf.

```
  ROLLBACK DECISION TREE  (§6, signal → playbook routing)
  ┌────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │              ┌──────────────────────────────────────────────────────┐           │
  │              │  ROLLBACK SIGNAL OBSERVED  (during 1-hour monitor,   │           │
  │              │  §5 item 14, OR a tutor-reported issue)              │           │
  │              └──────────────────────────────────────────────────────┘           │
  │                                  │                                                │
  │       ┌────────────┬─────────────┼──────────────┬─────────────┐                 │
  │       ▼            ▼             ▼              ▼             ▼                 │
  │   "Vercel      "EAS OTA       "Tauri         "Mobile      "MAJOR release      │
  │    Speed LCP   error rate     updater 4xx/   native bug   corrupted a         │
  │    > 2.5s or   > 5% or        5xx > 5% or    (not fixable tutor's DB via      │
  │    5xx > 1%"   tutor crash"   Blob outage"   via OTA)"    bad migration"      │
  │       │            │             │              │             │                 │
  │       ▼            ▼             ▼              ▼             ▼                 │
  │   §6.1 WEB     §6.2 OTA      §6.4 DESKTOP   §6.3 NATIVE   §6.5 MAJOR          │
  │   ROLLBACK     ROLLBACK      ROLLBACK       ROLLBACK       ROLLBACK            │
  │   (Vercel      (eas update   (manifest      (re-publish   (restore from       │
  │   Instant      --republish   edit,          prior build   pre-migration       │
  │   Rollback)    prior         §5.2 atomic    to stores)    backup,             │
  │                build-id)     pattern)                      EC-M-02 + EC-M-03)  │
  │       │            │             │              │             │                 │
  │       ▼            ▼             ▼              ▼             ▼                 │
  │   <60 sec      <5 min        <5 min          1–7 days      30–60 min           │
  │   (emerald ✓)  (emerald ✓)   (emerald ✓)    (amber —       (flare — heaviest,  │
  │                                              store review  tutor participates) │
  │                                              is long pole)                     │
  │                                                                                  │
  │  RULES (the rollback contract):                                                  │
  │   ↑ Every rollback appends a `---` worklog entry (§6 + §11 contract item 6).    │
  │   ↑ Every rollback is VERIFIED in agent-browser / on a test device              │
  │     ("I clicked rollback" is not verification — §11 contract item 8).           │
  │   ↑ The 1-hour post-release monitor (§5 item 14) is the watch that             │
  │     triggers the tree above.                                                    │
  │   ↑ A rollback without a worklog entry is an unaccountable mutation            │
  │     (AGENTS.md §8 anti-pattern #16).                                            │
  │   ↑ The MAJOR rollback is the heaviest — it requires the tutor's active        │
  │     participation + a pre-migration backup (§6.5). Thorough migration          │
  │     testing in staging (§5 item 11) is the mitigation.                         │
  │                                                                                  │
  │  TIME-TO-ROLLBACK SUMMARY (the table above, ranked fastest → slowest):          │
  │   ↑ §6.1 WEB       : <60 sec  (Vercel Instant Rollback, atomic alias re-point) │
  │   ↑ §6.2 OTA       : <5 min   (eas update --republish, instant in dashboard)   │
  │   ↑ §6.4 DESKTOP   : <5 min   (manifest edit, atomic-update pattern)           │
  │   ↑ §6.3 NATIVE    : 1–7 days (store review is the long pole — AVOID by        │
  │                                thorough beta testing, 03 §9)                    │
  │   ↑ §6.5 MAJOR     : 30–60 min (tutor-side, with agent guidance — AVOID by     │
  │                                thorough migration testing, §5 item 11)         │
  │                                                                                  │
  └────────────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is a concept diagram (signal→playbook routing), not a rendered
     UI surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = fast rollback (≤5 min, the web/OTA/desktop
     paths), amber = slow rollback (1–7 days, the native store-review path),
     flare = heaviest rollback (MAJOR — tutor-side, with backup restore),
     cyan = the signal-observation phase (the 1-hour monitor).
   ↑ Cross-refs: §5 item 14 (the 1-hour monitor), §6 (rollback playbook),
     §6.1 (web), §6.2 (mobile OTA), §6.3 (mobile native), §6.4 (desktop),
     §6.5 (MAJOR), §11 contract item 6 (worklog entry) + item 8 (verification),
     01_Vercel_Hosting §6.2 (Instant Rollback), 02_Vercel_Blob §6.4
     (desktop rollback = manifest edit), 03_EAS §5.5 (OTA --republish),
     14_Edge_Cases.md EC-M-02 (migration fails mid-way) + EC-M-03 (downgrade
     attempt), AGENTS.md §8 anti-pattern #16 (rollback without worklog),
     09_Backup_and_Import_Export.md §11 (pre-migration backup restore).
```

### 12.5 Release-Engineer's Checklist Console (the one live UI surface this file references)

The 15-item release checklist (§5) is rendered in the GitHub Release UI + the `release.yml` workflow_dispatch form. The console is third-party chrome (GitHub's own UI), but the contract this file makes about how the agent reads it (the checklist is glass-equivalent content; the "Run workflow" button is a control; each checkbox is a control) follows §6.6's single rule.

```
  RELEASE-ENGINEER'S CHECKLIST CONSOLE  (§5, the 15-item release checklist)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  github.com/buddysaradhi/buddysaradhi/actions/workflows/release.yml                   │
  │                                                                              │
  │  ┌─ Run-workflow dispatch card (GitHub chrome, glass-equivalent content) ┐  │
  │  │                                                                        │  │
  │  │  Release v1.4.0  ·  branch: main  ·  commit: abc1234                   │  │
  │  │                                                                        │  │
  │  │  Inputs:                                                               │  │
  │  │    version:           [1.4.0          ]   ← .neumo-inset input well    │  │
  │  │    promote_desktop:   [✓] true            ← .neumo-inset checkbox       │  │
  │  │                                                                        │  │
  │  │  ┌─ 15-item checklist (glass-equivalent content surface) ───────────┐ │  │
  │  │  │  [✓] 1.  bun run version:bump 1.4.0       (emerald ✓ done)       │ │  │
  │  │  │  [✓] 2.  Write changelog entry            (emerald ✓ done)       │ │  │
  │  │  │  [✓] 3.  Snapshot tests + lint + typecheck(emerald ✓ done)       │ │  │
  │  │  │  [✓] 4.  Open PR release/v1.4.0          (emerald ✓ merged)      │ │  │
  │  │  │  [✓] 5.  CI lint.yml on PR               (emerald ✓ passed)      │ │  │
  │  │  │  [✓] 6.  Vercel preview deployed        (emerald ✓ live)         │ │  │
  │  │  │  [✓] 7.  webDevReview cron smoke        (emerald ✓ passed)       │ │  │
  │  │  │  [✓] 8.  Tag v1.4.0                     (emerald ✓ tagged)       │ │  │
  │  │  │  [✓] 9.  desktop-build.yml complete    (emerald ✓ uploaded)     │ │  │
  │  │  │  [✓] 10. eas-build.yml complete        (emerald ✓ submitted)    │ │  │
  │  │  │  [✓] 11. Manual smoke on staging       (emerald ✓ passed)       │ │  │
  │  │  │  [ ] 12. Promote desktop staging→stable(amber — pending this    │ │  │
  │  │  │                                         dispatch)                │ │  │
  │  │  │  [ ] 13. Merge PR → Vercel + OTA       (amber — pending)         │ │  │
  │  │  │  [ ] 14. Monitor 1 hour                (amber — pending)         │ │  │
  │  │  │  [ ] 15. Post-release: GitHub Release  (amber — pending)         │ │  │
  │  │  │              + tweet + worklog entry                              │ │  │
  │  │  └────────────────────────────────────────────────────────────────────┘ │  │
  │  │     ↑ content surface = glass-equivalent (§5.5 coverage map: card)      │  │
  │  │     ↑ checkboxes = controls = .neumo-inset (§6.6 — toggles the agent    │  │
  │  │       manipulates; the inset well receives the raised check)            │  │
  │  │     ↑ "Run workflow" button below = control = .neumo-raised (§6.6)      │  │
  │  │                                                                        │  │
  │  │  [ Cancel ]   [ Run workflow ]   ← .neumo-raised (violet — manual gate) │  │
  │  └────────────────────────────────────────────────────────────────────────┘  │
  │     ↑ on :active → .neumo-pressed (§6.3) + 1px translate                   │
  │     ↑ WCAG §1.4.1: the checkbox state is NEVER colour-only — the text      │
  │       label "done / merged / passed / pending" accompanies the check.       │
  │     ↑ the "Run workflow" button is violet (manual gate, P13 distribution)   │
  │       — never indigo/blue per Rule 5.                                       │
  │                                                                              │
  │  CONTRACT (§5 + §11):                                                       │
  │   ↑ The 15-item checklist is the contract — every item is verified         │
  │     before "Run workflow" is clicked.                                       │
  │   ↑ Item 14 (1-hour monitor) is NON-NEGOTIABLE (§11 contract item 2).      │
  │   ↑ Item 12 (promote desktop) is the manual gate that this dispatch        │
  │     triggers — the human-in-the-loop that prevents auto-promotion.         │
  │   ↑ Every release appends a `---` worklog entry (item 15, §11 item 6).     │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ This is a live UI surface — the §6.6 single rule applies: checklist =
     glass-equivalent (content), checkboxes + "Run workflow" = neumo
     (controls — inset for toggles, raised for the CTA).
   ↑ Accent colours: emerald = done / passed / live, amber = pending (the
     release is in flight, items 12–15 not yet complete), violet = the
     manual "Run workflow" gate (P13 distribution).
   ↑ Cross-refs: §5 (15-item checklist), §11 (the contract this file
     makes), §5.1 (item 14 monitor — what to watch), 05_CI_CD §7
     (release.yml workflow_dispatch), 13_UI_Guidelines.md §5.5 (card tier),
     §6.6 (control = neumo), §6.2 (raised button), §6.3 (pressed),
     §10.2 (44×44px touch targets on the CTA), §10.6 (WCAG §1.4.1),
     P13 (distribution), Rule 5 (no indigo/blue — manual-gate button is
     violet, never indigo).
```

### 12.6 References (External Design Authorities)

The mockups and the release-choreography contract in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the soak times, the rollback decision tree, or the 15-item checklist.

- **GitHub Actions docs** — *Workflow dispatch, concurrency, matrix strategy, secrets*. The §12.5 release-engineer's checklist console follows GitHub Actions's workflow_dispatch documentation; the §12.2 release-flow diagram follows GitHub's event-trigger model.
- **Vercel docs** — *Instant Rollback, deployment protection, promotion gates*. The §12.4 §6.1 web-rollback leaf follows Vercel's Instant Rollback documentation (atomic alias re-point, <60s).
- **Expo EAS docs** — *Update republish, OTA rollback, channel branching*. The §12.4 §6.2 OTA-rollback leaf follows EAS's `eas update --republish` documentation.
- **Tauri docs** — *Updater plugin, manifest edit, minimum_auto_update_from*. The §12.4 §6.4 desktop-rollback leaf follows Tauri's updater-plugin rollback documentation (manifest edit + atomic-update pattern).
- **Smashing Magazine** — *Release pipelines, soak times, rollback playbooks*. The §12.3 soak-time matrix + §12.4 rollback decision tree follow Smashing's release-pipeline research (the soak as the contract between CI and the user).
- **CSS-Tricks** — *Semver discipline, hotfix branch strategy*. The §12.2 release-type routing + §12.3 hotfix row follow CSS-Tricks's semver + hotfix primer.
- **Nielsen Norman Group** — *WCAG §1.4.1 Use of Color + §3.3.2 Labels or Instructions*. The §12.5 dual-signal note (checkbox state + text label) follows NN/g's research and `13_UI_Guidelines.md` §10.6.
- **Shape Up** by Ryan Singer (Basecamp, 2019) — *The 15-item checklist as a "fat-marker" contract*. The §12.5 checklist follows Shape Up's pitch-level contract tradition (the checklist is the contract; the release.yml run is the execution).

---

*This file is the operational spec for Buddysaradhi's release pipeline. It is read by every release-engineering agent before they cut a release. When this file and the actual release behaviour disagree, this file wins — unless this file is wrong, in which case you amend this file first, then the behaviour, then the worklog. The order matters.*
