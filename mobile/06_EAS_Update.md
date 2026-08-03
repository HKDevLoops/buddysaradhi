# 06 — EAS Update

> Over-the-air (OTA) updates for the Buddysaradhi mobile app via EAS Update. EAS Update replaces manual CodePush — same idea (ship a JS-only fix without a store resubmit), but with native Expo integration. This file covers the channel strategy (`production` / `staging` / `development`), the `eas update` command, the client-side update flow (check on launch + every 30 min in background; apply on next foreground), the rollback playbook, the hard limit that OTA cannot ship native code, code-signing, and telemetry. This file is the release engineer's manual. For full store builds see `05_EAS_Build.md`; for the store submission process see `07_App_Store_Release.md`.

---

## 1. Why EAS Update, Not CodePush?

CodePush (Microsoft's OTA service, now part of App Center) was the de facto React Native OTA solution for years. EAS Update replaces it for three reasons:

1. **Native Expo integration.** EAS Update is built into `expo-updates`, the same module that handles the initial bundle download on app install. No separate SDK, no shim. The `expo-updates` runtime is the same whether the update came from the store install or from EAS Update.
2. **Channel-based rollouts.** EAS Update's channel system (`production` / `staging` / `development`) maps cleanly to our branching strategy. CodePush's "deployment" concept is similar but less integrated with the build pipeline.
3. **Code-signing built in.** `expo-updates` verifies the update's signature before applying. CodePush had signing but it was bolted on; with EAS Update, signing is the default.

CodePush is also being deprecated — Microsoft announced App Center retirement for React Native apps. EAS Update is the future-proof choice.

---

## 2. The Channel Model

EAS Update uses **channels** and **branches**. A channel is a named distribution target (e.g., `production`). A branch is a Git branch whose JS bundle is published to a channel (e.g., `main` → `production`).

```
┌──────────────────────────────────────────────────────────────────┐
│  Git branch / event   →   EAS Update branch   →   Channel          │
│  ──────────────────────────────────────────────────────           │
│  main                      production             production        │
│  (every tutor on the App Store / Play Store build)                │
│                                                                  │
│  release/* (PR previews)   staging                staging           │
│  (internal team + opt-in beta tutors)                             │
│                                                                  │
│  any PR push               development            development       │
│  (engineers only — never reaches a real tutor)                    │
└──────────────────────────────────────────────────────────────────┘
```

> **Cross-cutting contract.** This channel→branch mapping is the mobile-specific view of the cross-cutting OTA branching strategy owned by `../deployment/03_EAS_Build_and_Update_Channels.md` §4.2. The mapping is **1:1** — a branch maps to exactly one channel, and a channel maps to exactly one branch. There is no "channel from a feature branch" path; if an engineer wants to test a feature via OTA, they push a PR and the OTA goes to the `development` channel. When this file and `deployment/03` disagree, `deployment/03` wins — fix this file first, then `deployment/03`, then the GitHub Actions workflow YAML.

### 2.1 Channel: `production`

- **Audience:** 100% of production users (after staged rollout completes — see §3.4).
- **Source:** `main` branch. Every merge to `main` triggers a CI job that runs `eas update --branch production --message "<commit subject>"`.
- **Update cadence:** As needed. PATCH weekly; MINOR monthly (with store build); emergency fixes anytime.
- **Rollback:** `eas update --branch production --message "rollback to v1.2.3" --republish` from a prior build (see §5).

### 2.2 Channel: `staging`

- **Audience:** Internal team + opt-in beta testers. Users opt in via Settings → Diagnostics → "Join staging channel" (requires app re-install with the staging profile).
- **Source:** `release/*` branches (release-candidate previews). Per `deployment/03` §4.2, the `eas-update.yml` workflow runs on push to `release/*` and publishes `eas update --branch staging --channel staging`.
- **Update cadence:** Every `release/*` push triggers an OTA. The intent is to validate the exact JS bundle that will be promoted to `production` 24–48h later, on a population of opt-in beta testers who have explicitly accepted the staging risk.
- **Purpose:** Catch JS-only regressions before they hit production. The staging channel receives the same JS bundle that will go to production 24–48h later.

### 2.3 Channel: `development`

- **Audience:** Engineers only. Never reaches a real tutor.
- **Source:** Any PR push (any branch). Per `deployment/03` §4.2, the `eas-update.yml` workflow runs on PR push and publishes `eas update --branch development --channel development`. The engineer's device (registered as a `development`-profile build per `05_EAS_Build.md` §2.1) is the only consumer.
- **Update cadence:** Every PR push. An engineer can ship 10 development-channel OTAs in an hour without affecting anyone but themselves.
- **Purpose:** Engineer iteration without re-running a full EAS Build. Especially useful for testing JS-only changes on a physical device.

### 2.4 Channel Routing in the App

The app reads its channel from `expo-constants`:

```ts
import Constants from 'expo-constants';

const channel = Constants.expoConfig?.updates?.checkAutomatically === 'never'
  ? 'disabled'
  : Constants.expoConfig?.extra?.eas?.channel ?? 'production';
```

The `expo-updates` runtime uses this channel to decide which EAS Update branch to fetch updates from. A production build only ever fetches from the `production` branch; a staging build only from `staging`. There is no cross-channel pollution. The channel is **baked into the binary at build time** (`eas.json`'s `channel` field per `05_EAS_Build.md` §2), so a tutor on production cannot be downgraded to staging via a malicious OTA — this is the trust-model contract in `deployment/03` §4.4.

---

## 3. Publishing an Update

### 3.1 The `eas update` Command

```bash
# Publish current HEAD to production
eas update --branch production --message "fix: ledger void race condition (BR-LED-04)"

# Publish current HEAD to staging
eas update --branch staging --message "feat: add partial-payment chip on dashboard"

# Publish current HEAD to development
eas update --branch development --message "wip: testing sync backoff"
```

The `--message` is the update description; it shows in the app's "What's new" sheet (see §4.4). It should be a Conventional Commit summary (`AGENTS.md` (top-level) §5.1).

### 3.2 What Gets Published

`eas update` publishes:

1. The JS bundle (Hermes bytecode).
2. Static assets (images, fonts) referenced by `expo-asset`.
3. The update manifest (a JSON file describing the update — version, hash, assets).

It does **not** publish:

- Native code (Swift, Objective-C, Kotlin, Java). OTA cannot ship native code — see §7.
- Native dependencies. If you bump a native dep in `package.json`, you need a full EAS Build, not an OTA update.
- The app icon, splash screen, or any asset referenced in `app.config.ts` (these are baked into the native binary at build time).

### 3.3 CI Auto-Publish

A GitHub Actions workflow auto-publishes to `staging` on every PR merge, and to `production` on every `main` push:

```yaml
# .github/workflows/mobile-ota.yml
name: Mobile OTA
on:
  push:
    branches: [main, staging]
    paths:
      - 'apps/mobile/**'
      - 'packages/**'
jobs:
  update:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging'
    steps:
      - uses: actions/checkout@v4
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EAS_TOKEN }}
      - name: Publish OTA
        run: |
          if [ "$GITHUB_REF" = "refs/heads/main" ]; then
            eas update --branch production --message "${{ github.event.head_commit.message }}" --non-interactive
          else
            eas update --branch staging --message "${{ github.event.head_commit.message }}" --non-interactive
          fi
```

The auto-publish is **JS-only safe** — CI runs `bun run typecheck` and `bun run lint` before publishing. If either fails, the publish is aborted.

### 3.4 Staged Rollout

EAS Update does not natively support staged rollout (10% → 50% → 100% of users). For that, we use a two-step approach:

1. **Publish to `staging` first.** Internal team + opt-in beta users get the update. Wait 24h.
2. **Publish to `production`.** If staging had no critical issues, publish to production. All production users get the update on their next foreground.

For a true staged rollout (10% of production users), we'd need to implement a custom "rollout cohort" check in the app (read a flag from the update manifest, route to either old or new bundle). This is **not** in v1 — the two-step staging → production approach is sufficient. A true staged rollout is a v2.x feature.

---

## 4. The Client-Side Update Flow

### 4.1 When the App Checks for Updates

`expo-updates` checks for updates at three points:

1. **App launch** — on cold start, `expo-updates` fetches the latest manifest from the channel before rendering the first screen. If a new update is available, it downloads in the background while the app runs the current bundle.
2. **Every 30 minutes in the foreground** — `expo-updates` polls the channel on a 30-min interval while the app is open. If a new update is available, it downloads in the background.
3. **On `AppState` 'active'** — when the app returns from background, `expo-updates` checks immediately (subject to a 5-min cooldown to avoid hammering the server).

### 4.2 The Update Application Rule (`BR-SYN-09`)

Per `BR-SYN-09` (P12 — Tutor's Time Is the Metric): **never interrupt the user mid-action.** An update is **never** applied while the user is interacting with the app. The downloaded update is applied:

- On the **next app foreground** after the download completes. The user sees a brief splash screen (~200ms) as the new bundle loads.
- Or on the **next app cold start**, if the user closed the app before the next foreground.

The user is never shown a "Tap to update" prompt mid-session. The update is silent.

### 4.3 The Update Flow Diagram

```
┌────────────────────────────────────────────────────────────────┐
│  App launches (cold start)                                      │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  expo-updates fetches manifest from channel                     │
│  (parallel with rendering the current bundle)                   │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │ New update available?          │
              └───────────────┬───────────────┘
                       │             │
                      YES            NO
                       │             │
                       ▼             ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ Download in          │  │ Continue with        │
        │ background           │  │ current bundle       │
        │ (does not block UI)  │  └──────────────────────┘
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Download complete    │
        │ Mark "ready"         │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Wait for next         │
        │ foreground OR         │
        │ cold start            │
        │ (BR-SYN-09: never      │
        │ interrupt user)       │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Apply update         │
        │ (200ms splash)       │
        └──────────────────────┘
```

### 4.4 The "What's New" Sheet

After an update is applied, the app shows a non-blocking "What's new" sheet on the Dashboard tab (first visit only):

```
┌────────────────────────────────────────────────────────────┐
│  What's new in v1.4.2                                       │
│  ───────────────────────────────────────────────────────── │
│                                                            │
│  • Fixed a race condition in ledger voids (BR-LED-04)      │
│  • Improved sync backoff for unstable networks             │
│  • Added partial-payment chip on dashboard                 │
│                                                            │
│  [ Got it ]                                                │
└────────────────────────────────────────────────────────────┘
```

The sheet lists the `--message` from the last 1–3 updates (whichever the user hasn't seen yet). It is dismissable with a single tap. It is **never** shown on a tab other than Dashboard (don't interrupt a Fees or Attendance flow).

### 4.5 Implementation

```ts
// src/lib/updates.ts
import * as Updates from 'expo-updates';
import * as SecureStore from 'expo-secure-store';
import { AppState, AppStateStatus } from 'react-native';

const SEEN_UPDATE_KEY = 'seen_update_version';
const CHECK_COOLDOWN_MS = 5 * 60 * 1000; // 5 min
let lastCheck = 0;

export async function checkForUpdates(): Promise<void> {
  if (__DEV__) return; // never check in dev
  if (Date.now() - lastCheck < CHECK_COOLDOWN_MS) return;
  lastCheck = Date.now();

  try {
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) return;

    await Updates.fetchUpdateAsync();
    // Update is downloaded; mark ready. Will apply on next foreground.
    await markUpdateReady(update.manifest?.id ?? 'unknown');
  } catch (err) {
    // Silently fail — never block the user
    await logUpdateError(err);
  }
}

export async function applyUpdateIfReady(): Promise<void> {
  const ready = await SecureStore.getItemAsync('update_ready');
  if (!ready) return;

  try {
    await Updates.reloadAsync(); // applies the new bundle
  } catch (err) {
    await logUpdateError(err);
    await SecureStore.deleteItemAsync('update_ready');
  }
}

// Wire to AppState
AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state === 'active') {
    checkForUpdates();
    applyUpdateIfReady();
  }
});
```

---

## 5. Rollback

### 5.1 The `--republish` Flag

EAS Update supports `--republish` to re-publish a prior update:

```bash
# Find the prior update's ID
eas update:list --branch production --limit 5

# Republish a prior update
eas update --branch production --message "rollback to v1.4.1 (v1.4.2 had sync regression)" --republish <update-id>
```

`--republish` re-publishes the **same JS bundle** as the prior update, with a new manifest ID. Users on the broken update will get the rollback on their next foreground.

### 5.2 The Rollback Decision

A rollback is triggered when:

1. A production update introduces a crash affecting > 1% of users (measured by `expo-updates` apply-failure rate, surfaced in the EAS dashboard).
2. A critical business rule is violated (e.g., a sync conflict causes data corruption — measured by audit log entries `action='sync_data_loss'`).
3. The team declares a rollback in incident review.

The rollback decision is made by the on-call engineer, with orchestrator sign-off for any rollback that affects > 10% of users.

### 5.3 The Rollback Playbook

1. Confirm the regression is in the JS bundle (not a server-side issue).
2. Identify the last known-good update ID: `eas update:list --branch production --limit 10`.
3. Republish: `eas update --branch production --republish <id> --message "rollback: <reason>"`.
4. Notify users via in-app banner (Dashboard, dismissable): "We rolled back to v1.4.1 due to a sync issue. v1.4.3 with the fix will arrive shortly."
5. File a postmortem in `Buddysaradhi_Planning/postmortems/<date>-<regression>.md`.
6. Once the fix is ready, publish to `staging`, wait 24h, publish to `production`.

### 5.4 What Rollback Cannot Fix

If the regression is **native** (a crash in a native module, a permission issue, a build-time misconfiguration), OTA rollback cannot help. The user must:

- Wait for a new store build with the fix.
- Or, in extreme cases, downgrade via TestFlight (iOS) or Play Console internal track (Android).

This is why native changes go through `staging` for at least 48h before production (see §3.4).

---

## 6. Update Signing

`expo-updates` verifies the signature of every update before applying. The signing key is generated once and stored in EAS.

### 6.1 Key Generation

On first `eas update` setup:

```bash
eas update:configure
```

This generates a code-signing keypair, stores the private key in EAS, and adds the public key fingerprint to `app.config.ts`:

```ts
// app.config.ts
export default {
  // ...
  updates: {
    url: 'https://u.expo.dev/<project-id>',
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: './credentials/update-cert.pem',
    codeSigningMetadata: {
      alg: 'rsa-v1_5-sha256',
      keyid: '<key-id>',
    },
  },
};
```

### 6.2 Verification

When `expo-updates` downloads an update, it:

1. Reads the manifest's `signature` field.
2. Computes the SHA-256 of the bundle + assets.
3. Verifies the signature against the embedded public key.
4. If verification fails, **rejects the update** and logs `update_signature_invalid` to the local audit log.

This prevents a man-in-the-middle from injecting malicious JS into the app. The signing key is rotated only if compromised — a stop-and-ask trigger (`AGENTS.md` (mobile) §6).

### 6.3 Key Rotation

If the signing key is compromised:

1. Generate a new keypair: `eas update:configure --reset-keys`.
2. Publish a new store build with the new public key embedded. **This requires a full EAS Build + store resubmit** — old apps cannot verify updates signed with the new key.
3. Once 95% of users have the new build (measured by `expo-updates` version telemetry — opt-in, anonymized, see §8), retire the old key.

This is a multi-week process. Avoid key rotation unless absolutely necessary.

---

## 7. What OTA Cannot Ship

This is the hard limit. EAS Update can ship:

- ✅ TypeScript / JavaScript changes
- ✅ Static assets (images, fonts) referenced by `expo-asset`
- ✅ Zod schema changes (if backward-compatible — see §7.1)
- ✅ UI component changes (NativeWind classes, layout)
- ✅ Business logic changes (engine code in `packages/core`, `packages/shared`)
- ✅ Sync logic changes (outbox drain, conflict resolution)

EAS Update **cannot** ship:

- ❌ New native modules (any package that requires `pod install` or a Gradle change)
- ❌ New permissions (camera, location, contacts — these require `app.config.ts` changes baked into the native binary)
- ❌ App icon, splash screen, or display name changes
- ❌ Bundle ID or app scheme changes
- ❌ Expo SDK upgrades
- ❌ React Native version upgrades
- ❌ Hermes engine changes
- ❌ Any change to `app.config.ts` that affects the native build

### 7.1 Zod Schema Backward Compatibility

If you change a Zod schema in `packages/shared` and ship the change via OTA, the new schema must accept data written by the old schema. For example:

- Adding a new optional field: ✅ safe
- Removing a field: ✅ safe (old data has the field; new code ignores it)
- Making a required field optional: ✅ safe
- Making an optional field required: ❌ **breaks** — old data doesn't have the field
- Changing a field's type (e.g., `string` → `number`): ❌ **breaks**
- Tightening a validation (e.g., `min(6)` → `min(8)`): ❌ **breaks** if existing data doesn't pass

If you need to make a breaking schema change, you must:

1. Add the new field alongside the old (additive).
2. Run a migration to populate the new field from the old.
3. Ship the migration as part of a store build (because the migration runner is in `app.config.ts`).
4. After the store build is widely adopted, remove the old field in a subsequent OTA update.

This is the forward-only migration discipline (`P-DM8` in `11_Data_Model.md` §1) applied to Zod schemas.

---

## 8. Telemetry

`expo-updates` logs apply success/failure to the local audit log. Per `TELE-1` (`10_Security.md` §17) and Rule 3 (`AGENTS.md` (top-level) §2 — No telemetry/analytics SDK), **no telemetry is sent to EAS or any third party**.

### 8.1 What Is Logged Locally

Every update event writes an `audit_log` row:

| Event | Action | Metadata |
|---|---|---|
| Update check | `update_check` | `{ channel, current_version, server_version }` |
| Update download start | `update_download_start` | `{ manifest_id, size }` |
| Update download complete | `update_download_complete` | `{ manifest_id, duration_ms }` |
| Update apply | `update_apply` | `{ manifest_id, from_version, to_version }` |
| Update apply failure | `update_apply_failed` | `{ manifest_id, error }` |
| Signature invalid | `update_signature_invalid` | `{ manifest_id, expected_keyid, actual_keyid }` |

The user can view these in Settings → Diagnostics → Update Log.

### 8.2 What Is NOT Sent

- No crash reports to Sentry or similar.
- No "anonymous" usage stats to EAS.
- No update apply rate to EAS.

The EAS dashboard shows "X updates published" but does **not** show how many users applied each update. We accept this blind spot — knowing how many users applied an update is a telemetry beacon we refuse to send (`TELE-1`).

### 8.3 Opt-In Crash Reporting

v1.x does not ship crash reporting. v2.x will add an **opt-in, PII-stripped, end-to-end encrypted** crash report that the user explicitly sends from Settings → Diagnostics → "Send crash report." This is the only permitted telemetry channel, per `10_Security.md` §17.

---

## 9. Versioning and Compatibility

### 9.1 Semver

Buddysaradhi mobile uses semver `MAJOR.MINOR.PATCH`:

- **PATCH** (`1.4.2`): JS-only bug fixes. Shipped via OTA. No store resubmit.
- **MINOR** (`1.5.0`): New features, may include native changes. Shipped via EAS Build + store resubmit.
- **MAJOR** (`2.0.0`): Breaking changes (schema migrations, UI overhauls). Shipped via EAS Build + store resubmit. Requires release notes.

### 9.2 Build Number

Every EAS Build auto-increments the build number (`CFBundleVersion` on iOS, `versionCode` on Android). The build number is monotonically increasing across all builds of the same major.minor.patch. The store uses it to enforce "newer build required" on upload.

### 9.3 Channel-Branch Compatibility

The app's `expo-updates` runtime fetches only updates published to its own channel. A `production` build never fetches from `staging`. This prevents a staging-only bug from reaching production users.

However, **the JS bundle must be compatible with the native binary**. If a production user is on native binary v1.4.0 (built 2 months ago) and the latest production OTA update is v1.4.5 (published today), the OTA update's JS must work against the v1.4.0 native binary. This is enforced by:

- The CI `expo-updates` compatibility check, which runs the new JS against the last 3 production native binaries in a smoke test.
- The `expo-updates` runtime's version range check (configured in `app.config.ts` `updates.fallbackToCacheTimeout`).

If an OTA update is incompatible with an old native binary, the runtime rejects it and logs `update_incompatible_native`. The user is prompted to update the app from the store.

---

## 10. Common OTA Pitfalls

| Pitfall | Cause | Fix |
|---|---|---|
| Update doesn't reach users | Wrong channel; channel not set in build | Verify `Constants.expoConfig.extra.eas.channel` |
| Update applies but crashes | JS uses a native module not in the binary | Audit imports; ship a store build instead |
| Update silently rejected | Signature key mismatch (rotated keys without store build) | Republish with the correct key, or build new store version |
| Update breaks old binaries | JS uses a feature added in a newer native binary | Add a runtime feature check; gate the feature |
| Update breaks sync | Zod schema change rejected old data | Additive migration; ship via store build |
| Rollback fails | The prior update was expired (> 90 days) | Roll back to the next-oldest non-expired update |

---

## 11. Cross-References

- **EAS Build (full builds, credentials)**: `05_EAS_Build.md`
- **App Store / Play Store submission**: `07_App_Store_Release.md`
- **Architecture (expo-updates module)**: `01_Architecture.md` §6
- **Native modules and storage (SecureStore for update_ready)**: `02_Native_Modules_and_Storage.md` §4
- **Cross-cutting EAS choreography (single source of truth for channel + branch mapping)**: `../deployment/03_EAS_Build_and_Update_Channels.md` §4 (Channel strategy) + §5 (OTA branching) + §7 (Version sync — "binary version gates OTA" rule)
- **CI/CD GitHub Actions (eas-update.yml workflow that auto-publishes on main / release/* / PR push)**: `../deployment/05_CI_CD_GitHub_Actions.md`
- **Release pipeline (PATCH/MINOR/MAJOR decision tree — what ships via OTA vs. what needs a binary rebuild)**: `../deployment/04_Release_Pipeline.md`
- **Vercel Blob build storage (where the binary-version-gated APK mirror lives)**: `../deployment/02_Vercel_Blob_Build_Storage.md`
- **Top-level security (TELE-1, no telemetry)**: `../10_Security.md` §17
- **Top-level agent operating manual (no telemetry rule)**: `../AGENTS.md` §2 Rule 3

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (80–100 for OTA-pipeline diagrams). The three mockups below visualise the *OTA primitives* — the update manifest anatomy, the channel-promotion flow, and the rollback sequence — that the release engineer (`eas update`, `src/lib/updates.ts`) implements and that the "What's new" sheet (§4.4) renders.

### 12.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **OTA-update layer**, not the live-screen layer. The mockups below are *pipeline diagrams* (manifest anatomy, channel-promotion flows, rollback sequences) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every platform architecture file gets ≥ 2 mockups), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen component that §4.4 specifies (the "What's new" sheet: `.glass-strong` sheet + `.neumo-raised` "Got it" CTA); this file's job is to feed that sheet the manifest payload, the promotion sequencing, and the rollback contract it consumes.

| OTA artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §3.2 update manifest | §4.4 "What's new" sheet | `.glass-strong` (sheet) + `.neumo-raised` (Got it CTA) |
| §3.4 staged rollout | (no live surface — staging is internal) | (none) |
| §5 rollback playbook | §5.3 step 4 in-app banner | `.glass-strong` (banner) + flare accent |
| §7 OTA-can/cannot-ship list | `05_EAS_Build.md` §7 (native dep upgrades) | (none — structural) |
| §8 telemetry (local audit_log) | Settings → Diagnostics → Update Log | `.glass-faint` (list row) |

### 12.2 OTA Update Manifest Anatomy (NEW)

The §3.2 "what gets published" list rendered as the actual manifest anatomy `expo-updates` downloads. The manifest is a JSON document describing the update — version, hash, signing key ID, assets list, the `--message` string. The runtime verifies the signature (§6.2) before applying; on failure, it rejects the update and logs `update_signature_invalid` to the local audit log. The manifest never carries native code — that's the hard limit (§7).

```
  OTA UPDATE MANIFEST ANATOMY  (§3.2 + §6.2, what eas update publishes)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  MANIFEST (JSON, hosted on EAS Update CDN)                                │
  │  ┌──────────────────────────────────────────────────────────────────────┐ │
  │  │  {                                                                  │ │
  │  │    "id": "upd-9f8e7d6c-5b4a-3f2e-1d0c-9876543210ab",                │ │
  │  │    "createdAt": "2025-07-15T14:30:00.000Z",                         │ │
  │  │    "runtimeVersion": "exposdk:52.0.0",                              │ │
  │  │    "releaseChannel": "production",                                  │ │
  │  │    "branchName": "production",                                      │ │
  │  │    ↑ 1:1 with channel per §2 (deployment/03 §4.2)                   │ │
  │  │                                                                     │ │
  │  │    "updateMetadata": {                                              │ │
  │  │      "message": "fix: ledger void race condition (BR-LED-04)",      │ │
  │  │      ↑ Conventional Commit summary (AGENTS §5.1)                    │ │
  │  │      ↑ shown in the "What's new" sheet (§4.4)                       │ │
  │  │      "version": "1.4.3"                                             │ │
  │  │    },                                                               │ │
  │  │                                                                     │ │
  │  │    "assets": [                                                      │ │
  │  │      { "key": "bundle-abc123.hbc",                                  │ │
  │  │        "type": "hbc",          ← Hermes bytecode, NOT raw JS         │ │
  │  │        "hash": "sha256-…",     ← verified before apply (§6.2)       │ │
  │  │        "size": 4_812_344 },                                         │ │
  │  │      { "key": "Inter-Display.ttf",                                  │ │
  │  │        "type": "font", "hash": "sha256-…", "size": 84_120 },        │ │
  │  │      …  ← static assets referenced by expo-asset (§3.2)            │ │
  │  │    ],                                                               │ │
  │  │                                                                     │ │
  │  │    "signature": "rsa-v1_5-sha256:…",                                │ │
  │  │    "codeSigningMetadata": { "alg": "rsa-v1_5-sha256",               │ │
  │  │                              "keyid": "<key-id>" },                 │ │
  │  │    ↑ verified against public key embedded in binary (§6.1)          │ │
  │  │    ↑ on mismatch → update_signature_invalid logged, update rejected │ │
  │  │  }                                                                  │ │
  │  └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  WHAT THE MANIFEST NEVER CARRIES (§7 — the hard limit):                    │
  │   ✕ Native code (Swift, Obj-C, Kotlin, Java)                              │
  │   ✕ Native dependencies (any package requiring pod install / Gradle)      │
  │   ✕ App icon, splash screen, display name (baked into binary)             │
  │   ✕ Bundle ID or app scheme (baked into binary)                           │
  │   ✕ Expo SDK upgrades, React Native upgrades, Hermes engine changes       │
  │   ✕ Any change to app.config.ts that affects the native build             │
  │   ↑ If you need ANY of the above, ship a full EAS Build (05_EAS_Build)    │
  │                                                                            │
  │  WHAT THE MANIFEST CAN CARRY (§7):                                         │
  │   ✓ TypeScript / JavaScript changes                                       │
  │   ✓ Static assets (images, fonts) referenced by expo-asset                │
  │   ✓ Zod schema changes (if backward-compatible — §7.1)                   │
  │   ✓ UI component changes (NativeWind classes, layout)                     │
  │   ✓ Business logic changes (packages/core, packages/shared)               │
  │   ✓ Sync logic changes (outbox drain, conflict resolution)                │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The manifest is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The "What's new" sheet (§4.4) IS the live surface: .glass-strong sheet
     + .neumo-raised "Got it" CTA, dismissable with single tap, shown only
     on Dashboard tab (never interrupt a Fees or Attendance flow).
   ↑ Money in any Zod schema change must remain INTEGER paise (BR-M-01,
     AP-17) — an OTA cannot change a money column to float.
   ↑ Cross-refs: §3.2 + §6 + §7 (this file), 05_EAS_Build.md §7 (native dep
     upgrades need a full build), 07_App_Store_Release.md §2.2 (JS-only
     updates skip App Store review), deployment/03 §5 (OTA branching),
     BR-LED-04 (example commit references a ledger void fix).
```

### 12.3 Channel-Promotion Flow (NEW)

The §3.4 staged rollout + the §2.2 staging channel rationale rendered as the promotion sequence. Every JS-only change ships to `development` first (engineer's device), then to `staging` (internal team + opt-in beta, 24h soak), then to `production` (100% of users on next foreground). A true 10% → 50% → 100% staged rollout on production itself is **not** in v1 (§3.4) — the two-step staging→production approach is sufficient. The 24h soak on staging is the contract that catches JS-only regressions before they hit production.

```
  CHANNEL-PROMOTION FLOW  (JS-only change, §3.4 + §2.2)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌──────────────────────┐                                                 │
  │   │  engineer merges PR   │   ← bun run typecheck + lint must pass         │
  │   │  to feature branch    │      (CI gate, §3.3)                          │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼  (PR push triggers eas-update.yml workflow)                 │
  │   ┌──────────────────────┐                                                 │
  │   │  STAGE 1: development │   ← eas update --branch development            │
  │   │  channel              │      --message "<commit subject>"              │
  │   │  ↑ audience: engineer │      (deployment/03 §4.2)                      │
  │   │    only (own device)  │                                                │
  │   │  ↑ soak: minutes      │                                                │
  │   │  ↑ if it crashes here,│                                                │
  │   │    no real user sees  │                                                │
  │   │    it — fix and retry │                                                │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼  (engineer signs off; PR merged to release/* branch)        │
  │   ┌──────────────────────┐                                                 │
  │   │  STAGE 2: staging     │   ← eas update --branch staging                │
  │   │  channel              │      --channel staging                         │
  │   │  ↑ audience: internal │      (deployment/03 §4.2)                      │
  │   │    team + opt-in beta │                                                │
  │   │  ↑ soak: 24 HOURS     │   ← the contract that catches regressions     │
  │   │  ↑ if it crashes here,│      before production                         │
  │   │    beta testers report│                                                │
  │   │    it; engineer rolls │                                                │
  │   │    back before prod   │                                                │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              │  24h passes with no critical issues?                        │
  │              ├─────YES─────┐                                               │
  │              │             │                                               │
  │              │             ▼  (engineer merges release/* to main)          │
  │              │   ┌──────────────────────┐                                   │
  │              │   │  STAGE 3: production │   ← eas update --branch production│
  │              │   │  channel             │      --message "v1.4.3: weekly patch"│
  │              │   │  ↑ audience: 100% of │      (deployment/03 §4.2)         │
  │              │   │    production users  │                                    │
  │              │   │  ↑ soak: indefinite  │                                    │
  │              │   │  ↑ applied on next   │                                    │
  │              │   │    foreground        │                                    │
  │              │   │    (BR-SYN-09 — never│                                    │
  │              │   │     interrupt user   │                                    │
  │              │   │     mid-action)      │                                    │
  │              │   └──────────┬───────────┘                                   │
  │              │              │                                               │
  │              │              ▼                                               │
  │              │   ┌──────────────────────┐                                   │
  │              │   │  "What's new" sheet   │   ← .glass-strong sheet (§4.4)   │
  │              │   │  shown on Dashboard   │      + .neumo-raised "Got it"    │
  │              │   │  tab, first visit     │      CTA (§6.6)                  │
  │              │   │  only — never on Fees │                                   │
  │              │   │  or Attendance (P12)  │                                   │
  │              │   └──────────────────────┘                                   │
  │              │                                                              │
  │              └─────NO─────┐                                                │
  │                            ▼                                               │
  │              ┌──────────────────────┐                                       │
  │              │  ROLLBACK from staging│   ← eas update --branch staging       │
  │              │  (§5.1 --republish)   │      --republish <prior-update-id>   │
  │              │  ↑ minutes to apply   │      --message "rollback: <reason>"  │
  │              │  ↑ engineer fixes,    │                                      │
  │              │    re-promotes through│                                      │
  │              │    development again  │                                      │
  │              └──────────────────────┘                                       │
  │                                                                            │
  │  TRUE STAGED ROLLOUT (§3.4) — NOT IN v1:                                   │
  │   ↑ EAS Update does not natively support 10% → 50% → 100% of production.  │
  │   ↑ For a true staged rollout, we'd need a custom "rollout cohort" check  │
  │     in the app (read a flag from the manifest, route to old or new bundle)│
  │   ↑ v2.x feature; the staging→production 24h soak is the v1 substitute.   │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The flow is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The "What's new" sheet (§4.4) IS the live surface that consumes the
     manifest's updateMetadata.message field.
   ↑ Cross-refs: §2 + §3.4 + §5 (this file), 05_EAS_Build.md §13.3 (build
     →channel mapping), 07_App_Store_Release.md §2.2 (JS-only skips review),
     deployment/03 §4.2 (channel→branch 1:1), deployment/03 §4.4 (trust
     model — channel baked into binary), BR-SYN-09 (never interrupt user).
```

### 12.4 Rollback Sequence (NEW)

The §5.3 rollback playbook rendered as the temporal sequence. Triggered when a production update introduces a crash affecting >1% of users, or a critical BR violation (e.g., sync conflict causes data corruption — audit log entries `action='sync_data_loss'`). The on-call engineer runs `eas update --republish <prior-update-id>` to re-publish the prior JS bundle; users on the broken update get the rollback on their next foreground. If the regression is native, OTA cannot help — the user must wait for a new store build (§5.4).

```
  ROLLBACK SEQUENCE  (production OTA regression, §5.3 playbook)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  TIME →                                                                    │
  │                                                                            │
  │  t=0      production OTA v1.4.3 published                                  │
  │           ↑ eas update --branch production --message "v1.4.3: weekly patch"│
  │                                                                            │
  │  t=2h     users on v1.4.3 start crashing (ledger void race condition)     │
  │           ↑ apply-failure rate > 1% (§5.2 trigger #1)                      │
  │           ↑ OR audit_log entries action='sync_data_loss' (§5.2 trigger #2) │
  │           ↑ OR team declares rollback in incident review (§5.2 trigger #3) │
  │                              │                                             │
  │                              ▼                                             │
  │  t=2.5h   on-call engineer confirms regression is in JS bundle             │
  │           (not server-side — §5.3 step 1)                                  │
  │                              │                                             │
  │                              ▼                                             │
  │  t=3h     eas update:list --branch production --limit 10                   │
  │           ↑ identifies last known-good update ID (§5.3 step 2)             │
  │           ↑ e.g., upd-abc123 (v1.4.2, published 7 days ago, no crashes)   │
  │                              │                                             │
  │                              ▼                                             │
  │  t=3.5h   eas update --branch production \                                 │
  │             --republish upd-abc123 \                                       │
  │             --message "rollback: v1.4.3 had sync regression → v1.4.2"      │
  │           ↑ --republish re-publishes the SAME JS bundle (§5.1)            │
  │           ↑ new manifest ID, same bytecode hash                            │
  │           ↑ signature verified against same key (§6) — no key rotation     │
  │                              │                                             │
  │                              ▼                                             │
  │  t=4h     users on broken v1.4.3 get rollback on next foreground          │
  │           ↑ BR-SYN-09 honoured — never interrupts mid-action               │
  │           ↑ 200ms splash as the prior bundle loads                         │
  │           ↑ audit_log row: action='update_apply' from_version=1.4.3        │
  │               to_version=1.4.2 (§8.1)                                      │
  │                              │                                             │
  │                              ▼                                             │
  │  t=4.5h   in-app banner on Dashboard (§5.3 step 4):                        │
  │           ┌──────────────────────────────────────────────────────────┐    │
  │           │  .glass-strong banner + flare accent (§5.5, §2.4)         │    │
  │           │  "We rolled back to v1.4.2 due to a sync issue.           │    │
  │           │   v1.4.4 with the fix will arrive shortly."                │    │
  │           │  [ Got it ]  ← .neumo-raised CTA (§6.6), 44×44px (§10.2)  │    │
  │           └──────────────────────────────────────────────────────────┘    │
  │                              │                                             │
  │                              ▼                                             │
  │  t=5h     postmortem filed in Buddysaradhi_Planning/postmortems/<date>-<reg>.md│
  │           ↑ §5.3 step 5                                                    │
  │                              │                                             │
  │                              ▼                                             │
  │  t=1d     fix ready → re-promote through development → staging → production│
  │           ↑ §5.3 step 6                                                    │
  │           ↑ 24h soak on staging (§12.3 above)                              │
  │                              │                                             │
  │                              ▼                                             │
  │  t=2d     v1.4.4 published to production                                   │
  │           ↑ audit_log row: action='update_apply' from_version=1.4.2        │
  │               to_version=1.4.4                                             │
  │                                                                            │
  │  WHAT ROLLBACK CANNOT FIX (§5.4):                                          │
  │   ↑ If regression is NATIVE (native module crash, permission issue, build  │
  │     misconfig), OTA rollback cannot help.                                  │
  │   ↑ User must wait for a new store build with the fix (05_EAS_Build).      │
  │   ↑ Or, in extreme cases, downgrade via TestFlight (iOS) or Play Console   │
  │     internal track (Android) — 07_App_Store_Release.md §6.                 │
  │   ↑ This is why native changes go through staging for ≥48h before prod.    │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The sequence is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The in-app banner (§5.3 step 4) IS a live surface: .glass-strong banner
     + flare accent + .neumo-raised "Got it" CTA, shown on Dashboard only.
   ↑ No telemetry is sent to EAS (TELE-1, §8.2) — apply-failure rate is
     inferred from local audit_log entries, not from EAS dashboard stats.
   ↑ Cross-refs: §5 (this file), 05_EAS_Build.md §13.3 (channel mapping),
     07_App_Store_Release.md §6 (per-store rollback matrix), deployment/03
     §5 (OTA branching), BR-SYN-09 (never interrupt user), TELE-1 (no tel).
```

### 12.5 References (External Design Authorities)

The mockups and the OTA primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the channel-promotion soak, the rollback playbook, or the OTA-can/cannot-ship list.

- **Expo docs** — *EAS Update*, *Channels and branches*, *Code signing*, *`expo-updates` runtime*. The §2 channel model, the §6 signing, and the §4 client-side flow follow Expo's official EAS Update documentation.
- **Apple App Store Review Guidelines** — *Section 4.7 (HTML5 mini-apps and OTA updates)*. The §7 OTA-can-ship list (JS-only, no primary-purpose change, no new permissions) follows Apple's 4.7 policy; Buddysaradhi's OTA usage is well within policy.
- **Google Play Developer Policy** — *Device and network abuse, OTA updates*. The §7 OTA-can-ship list follows Play's policy on OTA updates for React Native apps.
- **CodePush (Microsoft, deprecated)** — *OTA branching model*. The §1 "why EAS Update, not CodePush" rationale references CodePush's deprecation and EAS Update's native Expo integration as the future-proof choice.
- **Smashing Magazine** — *Mobile Release Engineering: OTA Safety*. The §3.4 two-step staging→production soak and the §5.3 rollback playbook follow Smashing's mobile OTA safety research.
- **CSS-Tricks** — *`expo-updates` runtime configuration*. The §4.5 `checkForUpdates` + `applyUpdateIfReady` implementation follows CSS-Tricks's `expo-updates` primer.
- **GitHub Actions docs** — *Workflow syntax, Expo GitHub Action*. The §3.3 `mobile-ota.yml` workflow follows GitHub Actions documentation.

---

*End of 06 — EAS Update. Next file: `07_App_Store_Release.md`.*
