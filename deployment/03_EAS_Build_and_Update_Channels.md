# 03 — EAS Build & Update Channels (Cross-Cutting)

> Expo Application Services (EAS) is the **single** mobile build + OTA pipeline for Buddysaradhi. This file owns the **cross-cutting** view: the channel strategy, the build profiles, the OTA branching model, and the integration with Vercel Blob (APK mirroring) and the iOS App Store / Google Play Store. The mobile-specific `eas.json` config and per-profile secret handling are owned by `mobile/05_EAS_Build.md`; the OTA runtime behaviour (channel selection, update fetch, rollback) is owned by `mobile/06_EAS_Update.md`. This file is the **choreography** that ties them together.

---

## 1. Why EAS (not Fastlane / not bare React Native)

Buddysaradhi's mobile surface is Expo SDK 51+ (`AGENTS.md` §3.2). The mobile build options:

1. **Bare React Native + Fastlane.** Maximum control, maximum complexity. We'd own the iOS / Android build pipelines, signing credentials, store-submission scripts. ~2 weeks of setup for a team of one. Buddysaradhi is built by a small team; this is overhead we cannot afford.
2. **Expo Application Services (EAS).** Managed builds in the cloud (Linux for Android, macOS for iOS), credentials managed by EAS, store submission via `eas submit`, OTA updates via `eas update`. One CLI, one account, one bill. ~2 hours of setup.
3. **Self-hosted Expo + Turtle CLI.** Deprecated; no longer supported as of SDK 50.

EAS is the only viable option for Buddysaradhi's team size and v1 timeline. The trade-offs:

- **Less control.** We cannot customise the Android NDK version or the Xcode build flags. Acceptable — Buddysaradhi does not need custom native modules beyond what Expo provides.
- **Per-build cost.** Free tier = 15 iOS + 15 Android builds/month. Paid tier = $59/month for unlimited. See §8 for the upgrade trigger.
- **Vendor lock-in.** EAS is Expo-specific. Migrating to bare RN later is possible (Expo's "prebuild" generates the native projects) but non-trivial. Acceptable — we're not planning to leave Expo.

EAS it is. The rest of this file specifies how to use it.

---

## 2. EAS project setup

### 2.1 `eas init`

The first time the mobile app is configured for EAS:

```bash
cd apps/mobile
eas init
```

This:

1. Creates an EAS project (if it doesn't exist) and writes the `expo-project-id` to `app.json`:
   ```json
   {
     "expo": {
       "extra": {
         "eas": {
           "projectId": "abc123def456..."
         }
       }
     }
   }
   ```
2. Generates `eas.json` (the build + update config — see §3).
3. Writes `.easignore` (files excluded from the build context — node_modules, .git, etc.).

The `expo-project-id` is permanent and public — it identifies the project in EAS's backend. It is **not** a secret.

### 2.2 The `EAS_TOKEN` secret

The `EAS_TOKEN` is the **personal access token** that authenticates the GitHub Actions workflows to EAS. It is:

- Generated at `expo.dev/accounts/<account>/settings/access-tokens`.
- Stored as a GitHub Actions secret (`EAS_TOKEN`) — `05_CI_CD_GitHub_Actions.md` §6.
- Scoped to the `buddysaradhi` Expo account.
- **Never** in the client bundle, **never** in `app.json`, **never** in `eas.json`.
- Rotated quarterly (same cadence as the Vercel / Supabase secrets).

### 2.3 The `EXPO_PROJECT_ID` env var

The GitHub Actions workflows also need `EXPO_PROJECT_ID` (the same ID from §2.1). It is set as a GitHub Actions variable (not a secret — it is public). The workflow reads it via `${{ vars.EXPO_PROJECT_ID }}`.

---

## 3. Build profiles

`eas.json` defines three build profiles: `development`, `preview`, `production`. Each profile is a complete build configuration — distribution mode, credentials source, environment variables, channel.

### 3.1 The full `eas.json`

```json
{
  "cli": {
    "version": ">= 5.9.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "env": {
        "APP_ENV": "development",
        "NEXT_PUBLIC_APP_URL": "https://buddysaradhi-dev.vercel.app"
      },
      "ios": {
        "simulator": true
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleDebug"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "staging",
      "credentialsSource": "remote",
      "env": {
        "APP_ENV": "staging",
        "NEXT_PUBLIC_APP_URL": "https://buddysaradhi-pr-staging.vercel.app"
      },
      "ios": {
        "simulator": false,
        "buildType": "release"
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      }
    },
    "production": {
      "distribution": "store",
      "channel": "production",
      "credentialsSource": "remote",
      "autoSubmit": true,
      "env": {
        "APP_ENV": "production",
        "NEXT_PUBLIC_APP_URL": "https://buddysaradhi.app"
      },
      "ios": {
        "buildType": "release",
        "applicationArchivePath": "build/*.ipa"
      },
      "android": {
        "buildType": "app-bundle",
        "gradleCommand": ":app:bundleRelease"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "release@buddysaradhi.app",
        "ascApiKeyId": "...",
        "ascApiKeyKeyPath": "./AuthKey_XXX.p8",
        "ascApiKeyIssuerId": "..."
      },
      "android": {
        "serviceAccountKeyPath": "./pc-api-xxx.json",
        "track": "internal"
      }
    }
  },
  "update": {
    "development": { "channel": "development" },
    "preview": { "channel": "staging" },
    "production": { "channel": "production" }
  }
}
```

### 3.2 Profile: `development`

- **Purpose:** Engineers' local dev builds. Used during development to test native modules, expo-haptics, expo-local-authentication, etc.
- **`distribution: "internal"`** — distributed via EAS's internal URL (downloadable, not via store).
- **`developmentClient: true`** — includes the Expo Dev Client (allows hot-reload of native code).
- **`channel: "development"`** — OTA updates from the `development` branch (§5).
- **iOS `simulator: true`** — builds for the iOS Simulator (no Apple Developer account needed).
- **Android `buildType: "apk"`** — produces a debug APK that installs on any Android device.
- **Env:** `APP_ENV=development`, `NEXT_PUBLIC_APP_URL=https://buddysaradhi-dev.vercel.app` (a long-lived Vercel preview deployment for dev — `01_Vercel_Hosting.md` §5).

### 3.3 Profile: `preview`

- **Purpose:** Beta builds for TestFlight (iOS) and Internal Testing (Android). Used by the release-engineering agent + early beta tutors.
- **`distribution: "internal"`** — distributed via TestFlight (iOS) and Play Console Internal Testing (Android), not the public stores.
- **`channel: "staging"`** — OTA updates from the `staging` branch (§5).
- **`credentialsSource: "remote"`** — EAS manages the signing credentials (stored in EAS's credential store, not in the repo).
- **iOS `buildType: "release"`** — release-mode build (smaller, faster, no dev client).
- **Android `buildType: "apk"`** — produces a release APK that is **also mirrored to Vercel Blob** (§6.1) for the sideload download hub.

### 3.4 Profile: `production`

- **Purpose:** Production builds for the App Store (iOS) and Play Store (Android). Used by every tutor.
- **`distribution: "store"`** — distributed via the public stores.
- **`channel: "production"`** — OTA updates from the `production` branch (§5).
- **`credentialsSource: "remote"`** — EAS manages credentials.
- **`autoSubmit: true`** — `eas build` automatically runs `eas submit` after a successful build, pushing to App Store Connect and Play Console.
- **iOS `buildType: "release"`** — release-mode `.ipa` for App Store submission.
- **Android `buildType: "app-bundle"`** — produces an `.aab` (Android App Bundle) for Play Store submission. This is **not** the APK that gets mirrored to Blob — that's the `preview` profile's APK.

### 3.5 The `submit` config

The `submit.production` block defines how `eas submit` pushes to the stores:

- **iOS:** uses an App Store Connect API key (`ascApiKeyId`, `ascApiKeyKeyPath`, `ascApiKeyIssuerId`) — stored as GitHub Actions secrets (`APPLE_APP_STORE_CONNECT_API_KEY`, etc.) and materialised as a `.p8` file at build time.
- **Android:** uses a Google Play service account JSON (`serviceAccountKeyPath`) — stored as the GitHub Actions secret `ANDROID_SERVICE_ACCOUNT_JSON` and materialised as a `.json` file at build time. Submitted to the `internal` track (from there, the release-engineering agent manually promotes to `alpha` → `beta` → `production` in the Play Console).

---

## 4. Channel strategy

### 4.1 The three channels

| Channel | Branch | Audience | OTA reach | Native reach |
|---|---|---|---|---|
| `development` | `development` | Engineers | Engineers' dev builds | Local simulator / dev device |
| `staging` | `release/*` (PR previews) | Beta testers | TestFlight + Play Internal Testing | TestFlight + Play Internal Testing |
| `production` | `main` | All tutors | App Store + Play Store | App Store + Play Store |

### 4.2 Channel → branch mapping

The mapping is enforced via `eas.json`'s `update.<profile>.channel` field (§3.1) and via GitHub Actions workflow triggers (`05_CI_CD_GitHub_Actions.md`):

- **`eas-update.yml`** runs on push to `main` → `eas update --branch production --channel production`. Every push to `main` ships a JS-only OTA update to all production-channel devices.
- **`eas-update.yml`** runs on push to `release/*` → `eas update --branch staging --channel staging`. Every push to a release branch ships a JS-only OTA update to all staging-channel devices.
- **`eas-update.yml`** runs on PR push (any branch) → `eas update --branch development --channel development`. Every PR push ships a JS-only OTA update to all development-channel devices.

The mapping is **1:1** — a branch maps to exactly one channel, and a channel maps to exactly one branch. There is no "channel from a feature branch" path; if an engineer wants to test a feature via OTA, they push to a PR and the OTA goes to the `development` channel.

### 4.3 Why three channels (not two)

The three-channel model separates **engineer-facing** (development), **beta-tester-facing** (staging), and **tutor-facing** (production) update streams. With two channels (staging + production), an engineer testing a risky change would either:

- Pollute staging (breaking beta testers' experience), or
- Skip OTA entirely and rebuild native every time (slow).

The development channel is the engineer's sandbox — they can push 10 OTAs in an hour without affecting anyone but themselves. The staging channel is the beta-tester's view of the next release. The production channel is the tutor's view of the current release.

### 4.4 The channel → audience trust model

| Channel | Who installs | Trust level |
|---|---|---|
| `development` | The engineer who ran `eas build --profile development` | Self-trusted — engineer ships to themselves. |
| `staging` | Beta testers invited via TestFlight / Play Internal Testing | Opt-in — beta testers explicitly enrolled. |
| `production` | Any tutor who installs from App Store / Play Store | Implicit trust — the tutor installed the app from a store. |

The trust model is enforced by the distribution mechanism:

- **`development`:** builds are distributed via EAS's internal URL — only the engineer with the URL can install.
- **`staging`:** builds are distributed via TestFlight (requires Apple ID allowlist) or Play Internal Testing (requires Google Group allowlist).
- **`production`:** builds are distributed via the public stores — anyone can install.

OTA updates inherit the trust model: a `production`-channel device can only receive updates published to the `production` channel; a `staging`-channel device can only receive `staging` updates; etc. The channel is **baked into the binary** at build time (`eas.json`'s `channel` field), so a tutor on production cannot be downgraded to staging via a malicious OTA.

---

## 5. OTA update branching

### 5.1 What OTA is

EAS Update pushes **JavaScript-only** changes to mobile devices without a store review. The desktop analogue is the Tauri updater's manifest swap (§6 in `02_Vercel_Blob_Build_Storage.md`), but for JS bundles instead of installer binaries.

- **Reach:** ~15 minutes from `eas update` to "every online device has the new JS." Devices offline at update time pick up the new JS on next foreground.
- **Cost:** Free (no per-update charge).
- **Limitation:** Cannot change native code (new Expo module, new permission, new Info.plist key). Native changes require a new binary build + store resubmit.

### 5.2 What ships via OTA

Per `04_Release_Pipeline.md`:

- **PATCH release (bug fix, no schema change):** ships via OTA to all three channels. No store review.
- **MINOR release (new feature, backward-compatible schema):** ships via OTA if no native module changes; otherwise requires a new binary build + store resubmit (1–3 day review).
- **MAJOR release (breaking schema change):** requires a new binary build + store resubmit. OTA cannot change the schema migration code (it ships with the binary).

The decision is made per-release by the release-engineering agent, based on the diff between the previous and new versions:

- If the diff touches only `.tsx` / `.ts` files in `apps/mobile/src/**` and `packages/**` → OTA-eligible.
- If the diff touches `app.json`, `app.config.js`, `package.json` (new native dep), or any file in `apps/mobile/ios/` or `apps/mobile/android/` → binary build required.

### 5.3 The OTA publish command

```bash
eas update --branch production --channel production \
  --message "fix(fees): correct LWW tie-break on locked session" \
  --non-interactive
```

The `--message` becomes the update's commit message in the EAS dashboard. It is shown to tutors in the (rare) case they look at the "What's new" view in the app's settings. The message follows Conventional Commits (`AGENTS.md` §5.1).

### 5.4 The OTA runtime

The mobile app uses `expo-updates` to fetch + apply updates. The runtime behaviour (owned by `mobile/06_EAS_Update.md`):

1. On app foreground, `expo-updates` checks the channel's update URL (a per-channel EAS endpoint).
2. If a new update is available, it downloads in the background.
3. On next app launch, the new update is loaded atomically (the old JS is kept as a fallback).
4. If the new update crashes on launch, `expo-updates` rolls back to the previous update automatically.

This is the OTA equivalent of the Tauri updater's "rollback on first-launch crash" behaviour (`02_Vercel_Blob_Build_Storage.md` §6.2).

### 5.5 The OTA rollback

If a bad OTA ships (e.g., a runtime crash on a specific Android version), the rollback is:

```bash
eas update --branch production --republish <prior-build-id>
```

This re-publishes the prior update as the "latest" on the channel. Devices that already downloaded the bad update will roll back on next foreground (the channel's "latest" is now the prior update). Devices that haven't downloaded the bad update yet will get the prior update directly.

The `<prior-build-id>` is found in the EAS dashboard's Update History. The rollback is **instant** in the dashboard; the device-side rollback happens on next foreground.

This is the **primary rollback mechanism for the mobile OTA surface** (see `04_Release_Pipeline.md` §6.2).

---

## 6. Build → submit → OTA flow

### 6.1 The full sequence for a MINOR release

A MINOR release (e.g., v1.4.0 → v1.5.0) requires a new binary build because it includes a new feature with new native module dependencies. The sequence:

```
1. Tag v1.5.0 on main.
2. GitHub Actions eas-build.yml triggers.
3. eas build --profile production --platform all --auto-submit --no-wait
   ├─ iOS build (macOS runner, ~25 min)
   │  └─ eas submit --platform ios (pushes .ipa to App Store Connect)
   │     └─ Apple review (1-3 days)
   └─ Android build (Linux runner, ~12 min)
      ├─ eas submit --platform android (pushes .aab to Play Console internal track)
      │  └─ Play review (instant for internal; hours for production track)
      └─ post-build hook: copy APK from preview build (or rebuild as APK) to Vercel Blob
         └─ uploadInstaller uploads to mobile/android/Buddysaradhi-1.5.0-universal.apk
4. Once both stores approve, manually promote:
   ├─ App Store Connect: TestFlight → App Store
   └─ Play Console: Internal → Alpha → Beta → Production
5. OTA: eas update --branch production --message "..."
   └─ Reaches all production-channel devices in ~15 min
```

### 6.2 The APK mirror step (§6.1, step 3, Android sub-step)

The `production` profile produces an `.aab` (App Bundle) for the Play Store. The `.aab` is **not** installable directly on a device — it's a publishing format. To produce an installable `.apk` for the sideload hub on the web (`02_Vercel_Blob_Build_Storage.md` §2), the build pipeline also runs:

```bash
# After the production build, generate a universal APK from the AAB
bundletool build-apks --bundle=build/Release.aab --output=build/Buddysaradhi-1.5.0-universal.apks --mode=universal
unzip build/Buddysaradhi-1.5.0-universal.apks -d build/apks
mv build/apks/universal.apk build/Buddysaradhi-1.5.0-universal.apk
```

The resulting `Buddysaradhi-1.5.0-universal.apk` is then signed with the same release key and uploaded to Vercel Blob via the `uploadInstaller` function (`02_Vercel_Blob_Build_Storage.md` §3.2).

This is the **only** path that produces an APK for the sideload hub. The `preview` profile produces a debug-signed APK (not suitable for the public hub). The `production` profile's APK is release-signed and suitable for public distribution. The commercial spec for the download-hub UI that surfaces this APK (the Android DownloadCard, its "Download .apk" CTA, its install-steps accordion, its QR code) is `product/04_Download_Hub.md`; the implementation that fetches the merged manifest (containing this APK's URL + SHA-256 + size) and renders the card is `web/07_Landing_Page.md §6`.

### 6.3 The iOS IPA is NEVER mirrored

The iOS IPA is **not** uploaded to Vercel Blob. The reasons:

1. **Apple's distribution model forbids it.** A `.ipa` is installable only via TestFlight (with an Apple ID allowlist) or via a Mac with Xcode + a USB cable (Ad Hoc distribution, limited to 100 devices/year per Apple Developer account). Publishing an IPA on a public URL is useless to 99% of iOS users.
2. **The signing would not match.** An IPA signed for TestFlight cannot be installed by a device not in the TestFlight beta. Re-signing for Ad Hoc distribution requires the user's device UDID, which we do not collect.
3. **TestFlight is the path.** Beta testers install via TestFlight; production users install via the App Store. There is no "sideload the IPA from the website" path.

The CI lint `no-ios-blob-upload.test.ts` (`02_Vercel_Blob_Build_Storage.md` §2.2) fails the build if any file matching `*.ipa` is uploaded to Blob. This is a hard contract.

### 6.4 The `--no-wait` flag

The `eas build --profile production --platform all --auto-submit --no-wait` command starts the builds and returns immediately — it does not block the GitHub Actions job until the builds finish. This is intentional:

- iOS builds take ~25 minutes; Android builds take ~12 minutes. Blocking the GH Actions job for 25 minutes consumes 25 minutes of GH Actions runner time per release. The `--no-wait` flag releases the runner in ~30 seconds.
- The `eas-build.yml` workflow then polls EAS's API (`eas build --status <build-id>`) every 60 seconds in a follow-up job (`eas-build-status.yml`) until both builds finish or fail.
- On finish, the follow-up job runs the APK mirror step (§6.2) and the manifest update (for desktop — mobile has no manifest).

This is the **asynchronous build pattern** — common in CI/CD for cloud builds (EAS, Tauri, etc.).

### 6.5 The auto-submit step

`autoSubmit: true` in the `production` profile (§3.4) means `eas build` automatically runs `eas submit` after a successful build. The submit pushes:

- **iOS:** the `.ipa` to App Store Connect, where it enters the Apple review queue (1–3 days).
- **Android:** the `.aab` to Play Console's `internal` track (instant; no review for internal). The release-engineering agent then manually promotes to `alpha` → `beta` → `production` tracks in the Play Console.

The auto-submit is **idempotent** — if the same build is submitted twice (e.g., due to a re-run), the second submit is a no-op. The store recognises the build by its build number and rejects the duplicate.

---

## 7. The version sync

### 7.1 The single source of truth

The mobile app's version is stored in three places:

1. `apps/mobile/package.json` — `version: "1.5.0"`.
2. `apps/mobile/app.json` — `expo.version: "1.5.0"`, `expo.ios.buildNumber: "150"`, `expo.android.versionCode: 150`.
3. `apps/mobile/eas.json` — no version field, but the `appVersionSource: "remote"` means EAS reads the version from `app.json`.

The `bun run version:bump` script (owned by `04_Release_Pipeline.md` §3) updates all three in lockstep. The iOS `buildNumber` and Android `versionCode` are integer-encoded versions of the semver (`1.5.0` → `150`), required by the stores (Apple and Google do not accept semver strings as build numbers).

### 7.2 The OTA version vs. the binary version

There are two version concepts:

- **Binary version:** `1.5.0` (the version of the installed `.ipa` or `.apk`). Bumped on every MINOR and MAJOR release. Requires a store resubmit.
- **OTA version:** a hash of the JS bundle. Bumped on every `eas update`. Does not require a store resubmit.

The Tauri-equivalent (desktop) has only one version (the binary version; OTA is not separate). For mobile, the runtime knows both — the binary version is in the app's About screen, the OTA version is in the Settings → Diagnostics → "Update channel" view.

### 7.3 The "binary version gates OTA" rule

An OTA update can only be applied if the binary version is **at least** the version the OTA was built against. If an OTA is published with `binary-version: 1.5.0` and a tutor is still on binary `1.4.9`, the OTA is **not** applied — the tutor sees an "App update required" prompt linking to the App Store / Play Store.

This is enforced by `expo-updates`'s `binary-version` field in the update manifest. The release-engineering agent does not need to manage this manually — `eas update` stamps the binary version automatically.

---

## 8. EAS billing

### 8.1 The free tier

EAS's free tier (with an Expo account, no paid plan) provides:

- **15 iOS builds / month.**
- **15 Android builds / month.**
- **Unlimited OTA updates.**
- **Unlimited build minutes** (free tier builds are slower — Linux builds queue behind paid-tier builds; macOS builds queue even longer).

For Buddysaradhi's v1 release cadence (~1 release per month, with 2-3 hotfix builds per month), the free tier is **sufficient**:

- Per MINOR release: 1 iOS build + 1 Android build = 2 builds.
- Per PATCH release (OTA only): 0 native builds.
- Per MAJOR release: 1 iOS + 1 Android + maybe 1 re-build for a fix = 4 builds.
- Per month: ~6 builds (1 MINOR + 1 MAJOR + 4 hotfix rebuilds, if any).
- Free tier budget: 15 + 15 = 30 builds/month. 6 builds/month is **20% utilisation**.

The free tier is the right choice for v1.

### 8.2 The upgrade trigger

Upgrade to EAS Paid ($59/month per account) when **any** of the following is true:

1. **Total builds > 25/month** (80% of the free tier's 30-build budget — `01_Vercel_Hosting.md` §8.2's 80% rule applied to EAS).
2. **Build queue time > 30 minutes consistently.** Indicates the free-tier queue is too slow for the release cadence.
3. **Concurrent builds needed.** The free tier does not support concurrent builds; paid tier does. If a release needs iOS + Android builds in parallel (they do — `05_CI_CD_GitHub_Actions.md` §4), and the queue is slow, paid tier is the answer.
4. **A commercial launch.** Same as Vercel — the moment Buddysaradhi charges a tutor, the free tier's TOS may not permit commercial use. Confirm with Expo's TOS at launch time.

### 8.3 The paid tier benefits

EAS Paid ($59/month) provides:

- **Unlimited builds.** No 15-per-month-per-platform cap.
- **Priority build queue.** Builds start within ~1 minute (vs. 5-30 minutes on free tier).
- **Concurrent builds.** iOS and Android builds run in parallel.
- **Longer build retention.** Build artifacts are kept for 90 days (vs. 30 on free).
- **Update channels branching.** (Free tier already supports this; paid tier adds more granular control.)

For v1's cadence, the free tier is correct. For v2.x (multiple releases per month, parallel builds needed), paid tier is the upgrade.

### 8.4 The cost stack at v1

| Service | Plan | Monthly cost |
|---|---|---|
| Vercel | Hobby | $0 |
| Vercel Blob | Hobby (1 GB) | $0 |
| EAS | Free | $0 |
| GitHub Actions | Free (2000 min/month for Linux) | $0 |
| Supabase | Free | $0 |
| Turso | Free (500 DBs) | $0 |
| Atlassian Statuspage | Free | $0 |
| **Total v1 monthly cost** | | **$0** |

Buddysaradhi v1 runs on **zero monthly infrastructure cost**. This is the sovereign model (`00_Vision.md` §10) — the tutor's data lives on their device; the cloud is a free-tier replica + an installer hub. When the user base grows past the free tiers, the upgrade triggers fire one by one, and the cost grows incrementally (Vercel Pro $20 → EAS Paid $59 → Supabase Pro $25 → Turso Scale $29 → ~$130/month total at v2 scale).

---

## 9. The TestFlight + Play Internal Testing workflow

### 9.1 TestFlight (iOS)

After `eas submit --platform ios` pushes the `.ipa` to App Store Connect, the build enters "Processing" status (~10-30 minutes while Apple re-signs and prepares it for TestFlight). Once processing completes:

1. The build appears in App Store Connect → TestFlight.
2. The release-engineering agent adds the build to the "Buddysaradhi Beta" test group (a pre-configured group with ~10-50 invited beta testers).
3. Beta testers receive an email from TestFlight: "Buddysaradhi 1.5.0 is available for testing."
4. Testers install via the TestFlight app on iOS.
5. Testers' devices are automatically on the `staging` OTA channel (baked into the binary at build time, §3.3).

The Apple review for TestFlight builds is **instant** (no human review) for internal testers (≤25). For external testers (>25), Apple runs an automated review (~30 minutes).

### 9.2 Play Console Internal Testing (Android)

After `eas submit --platform android` pushes the `.aab` to Play Console's `internal` track:

1. The build appears in Play Console → Internal Testing.
2. The release-engineering agent adds the build to the "Buddysaradhi Beta" email list (a Google Group with ~10-50 invited beta testers).
3. Beta testers receive an email from Play Console: "Buddysaradhi 1.5.0 is available for testing."
4. Testers install via the Play Store app on Android (after joining the Internal Testing program via the opt-in URL).
5. Testers' devices are automatically on the `staging` OTA channel.

Google's review for Internal Testing builds is **instant** (no review). For the `alpha` and `beta` tracks, review is minutes; for `production`, review is hours.

### 9.3 The promotion to production

When the beta cycle is complete (typically 3-7 days of beta testing):

- **iOS:** In App Store Connect, select the build → "Promote to App Store" → fill in the release notes → submit for Apple review (1-3 days). Once approved, the build is live on the App Store.
- **Android:** In Play Console, select the build → "Promote to Production" → fill in the release notes → review (hours). Once approved, the build is live on the Play Store.

This is the **manual gate** between beta and production for the mobile surface. The desktop surface has an analogous gate (the 24-hour soak + `workflow_dispatch` promotion, `02_Vercel_Blob_Build_Storage.md` §6).

---

## 10. The "what if EAS goes down" plan

EAS has had occasional outages (the EAS Build service was down for ~3 hours in March 2024, for example). The impact:

- `eas build` commands fail.
- `eas update` commands fail (OTA updates cannot be published).
- Already-installed OTA updates continue to work (they're cached on the device).
- The App Store / Play Store builds remain available (they're on Apple's / Google's infrastructure, not EAS's).

The mitigation:

1. **OTA is non-blocking for the user.** A failed `eas update` does not crash the app; tutors continue working with their installed JS. The release-engineering agent retries the `eas update` when EAS is back up.
2. **Builds can be deferred.** A release that requires a new binary build (MINOR / MAJOR) can wait for EAS to recover. The release-engineering agent communicates the delay in `worklog.md` and on `status.buddysaradhi.app`.
3. **The Tauri / web surfaces are independent.** If EAS is down, the desktop + web releases proceed normally. The mobile release is delayed, but the other surfaces are unaffected. This is the **decoupling** benefit of the three-channel pipeline.

For a prolonged EAS outage (>24 hours), the fallback is:

- **For OTA:** no fallback; tutors stay on their current JS.
- **For native builds:** no fallback; the release is delayed until EAS recovers. (Bare React Native + Fastlane is a theoretical fallback but not a practical one — it would take weeks to set up.)

The probability of a >24-hour EAS outage is very low (EAS's SLA is 99.9%+). The risk is acceptable for v1.

---

## 11. The cross-cutting contract this file makes

Every release-engineering agent working on EAS agrees to:

1. **Never upload an iOS IPA to Blob.** The `no-ios-blob-upload.test.ts` lint rule blocks it; Apple's distribution model does not permit it.
2. **Never ship an OTA without a binary-compatible version.** The `binary-version` stamp on the update must be ≤ the oldest installed binary version on the channel.
3. **Never re-use a build number.** iOS `buildNumber` and Android `versionCode` are monotonic; a re-use causes the store to reject the build.
4. **Never bypass `credentialsSource: "remote"`.** Local credentials (`.p12` for iOS, `.keystore` for Android) are a P0 security risk if committed; EAS's credential store is the only path.
5. **Never ship to the `production` channel without a `staging` soak.** The 3-7 day beta cycle on `staging` is the contract between CI and the tutor.
6. **Never manually edit `app.json`'s `expo.version` without running `bun run version:bump`.** The version-bump script syncs `package.json`, `app.json`, and `eas.json`; manual edits cause drift.
7. **Always set `--non-interactive` in CI.** Interactive prompts block the workflow; `--non-interactive` fails fast if a prompt would have appeared.
8. **Always poll `eas build --status` after `--no-wait`.** The follow-up job is mandatory; a build that finishes unmonitored is a build whose failure is undetected.
9. **Always log an OTA publish to `worklog.md`.** The `eas-update.yml` workflow does this automatically; do not bypass it.
10. **Always test the OTA rollback path during a release drill.** `eas update --republish` is documented but only trusted if exercised.

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`, `TELE-1`). Box widths honour §20.3 rule 2 (80–120 for tree / pipeline diagrams). The three mockups below visualise the *mobile build + OTA choreography* this file owns — the `eas.json` profile tree (every profile + its channel + its distribution mode), the build→channel map (which git branch produces which binary on which channel), and the OTA promotion flow (PATCH vs. MINOR vs. MAJOR — what ships via OTA, what requires a binary rebuild). A fourth mini-mockup annotates the one live UI surface this file references (the EAS dashboard's Update History card) so the glass / neumorphic contract is visible where it applies.

### 12.1 Design System Reference (§5.5 + §6.6 single rule)

This file is the **mobile build + OTA view**, not a screen spec. Its artefacts are tree / map / flow diagrams — concept diagrams per §20.4, governed by §20.1 + §20.6, and do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the one live UI surface this file references: the **EAS dashboard's Update History card** (`expo.dev/accounts/buddysaradhi`), where the agent reads the latest OTA's `<build-id>` and clicks "Republish" to roll back (§5.5). That card is glass-equivalent content (it surfaces build-id, channel, message, timestamp); the "Republish" control is neumorphic-raised (it is a button the agent clicks).

| Artefact (this file) | Type | Glass / neumo tier (if live UI) |
|---|---|---|
| §12.2 `eas.json` profile tree | Concept diagram (tree) | (none — config topology) |
| §12.3 Build → channel map | Concept diagram (mapping) | (none — branch→channel routing) |
| §12.4 OTA promotion flow (PATCH/MINOR/MAJOR) | Concept diagram (flow) | (none — release-type routing) |
| §12.5 EAS dashboard Update History card | Live UI surface (third-party) | `.glass`-equivalent card + `.neumo-raised` "Republish" control (per §6.6 single rule — surface = glass, control = neumo) |

### 12.2 `eas.json` Profile Tree

The three build profiles (`development` / `preview` / `production`) and the three OTA channels they map to. Every profile is a complete build configuration — distribution mode, credentials source, env vars, channel. The `submit.production` block is the store-submission contract; the `update` block is the OTA-channel routing.

```
  eas.json PROFILE TREE  (§3, the three-profile / three-channel model)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │  eas.json                                                                      │
  │  ├── cli                                                                      │
  │  │   ├── version: ">= 5.9.0"                                                  │
  │  │   └── appVersionSource: "remote"  ← EAS reads version from app.json (§7.1) │
  │  │                                                                            │
  │  ├── build  (3 profiles)                                                      │
  │  │   ├── development  (§3.2)                                                  │
  │  │   │   ├── developmentClient: true   ← Expo Dev Client (hot-reload native) │
  │  │   │   ├── distribution: "internal"  ← EAS internal URL (engineer-only)    │
  │  │   │   ├── channel: "development"    ← OTA from development branch (§5)    │
  │  │   │   ├── env: APP_ENV=development, NEXT_PUBLIC_APP_URL=buddysaradhi-dev.v.app │
  │  │   │   ├── ios.simulator: true       ← no Apple Dev account needed         │
  │  │   │   └── android.buildType: "apk"  ← debug APK (any Android device)      │
  │  │   │       ↑ violet — engineer's sandbox (self-trusted)                    │
  │  │   │                                                                        │
  │  │   ├── preview  (§3.3)                                                      │
  │  │   │   ├── distribution: "internal"  ← TestFlight + Play Internal Testing  │
  │  │   │   ├── channel: "staging"        ← OTA from release/* branch (§5)      │
  │  │   │   ├── credentialsSource: "remote" ← EAS credential store (no .p12)    │
  │  │   │   ├── env: APP_ENV=staging, NEXT_PUBLIC_APP_URL=buddysaradhi-pr-staging... │
  │  │   │   ├── ios.buildType: "release"                                         │
  │  │   │   └── android.buildType: "apk"  ← release APK mirrored to Blob (§6.2) │
  │  │   │       ↑ amber — beta-tester view (opt-in, in-soak)                    │
  │  │   │                                                                        │
  │  │   └── production  (§3.4)                                                   │
  │  │       ├── distribution: "store"     ← App Store + Play Store              │
  │  │       ├── channel: "production"     ← OTA from main branch (§5)           │
  │  │       ├── credentialsSource: "remote"                                       │
  │  │       ├── autoSubmit: true          ← eas build → eas submit (§6.5)       │
  │  │       ├── env: APP_ENV=production, NEXT_PUBLIC_APP_URL=buddysaradhi.app        │
  │  │       ├── ios.buildType: "release"  + applicationArchivePath: build/*.ipa │
  │  │       └── android.buildType: "app-bundle"  ← .aab for Play Store          │
  │  │           ↑ emerald — tutor-facing (implicit trust, live in stores)       │
  │  │                                                                            │
  │  ├── submit  (store-submission contract — §3.5)                              │
  │  │   └── production                                                          │
  │  │       ├── ios:  appleId, ascApiKeyId, ascApiKeyKeyPath (.p8),             │
  │  │       │       ascApiKeyIssuerId  ← GitHub Actions secrets (§10 in 05)     │
  │  │       └── android: serviceAccountKeyPath (.json), track: "internal"       │
  │  │                                                                            │
  │  └── update  (OTA-channel routing — 1:1 with build profiles)                 │
  │      ├── development: { channel: "development" }                             │
  │      ├── preview:     { channel: "staging" }                                 │
  │      └── production:   { channel: "production" }                             │
  │          ↑ 1:1 — branch maps to exactly one channel, channel to one branch   │
  │          ↑ a tutor on production CANNOT be downgraded to staging via OTA     │
  │            (channel is baked into the binary at build time, §4.4)            │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is a concept diagram (config topology), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: violet = development (engineer's sandbox, self-trusted),
     amber = preview (beta-tester view, opt-in, in-soak), emerald =
     production (tutor-facing, implicit trust, live).
   ↑ Cross-refs: §3 (build profiles), §3.1 (full eas.json), §3.5 (submit
     config), §4 (channel strategy), §4.4 (channel→audience trust model),
     05_CI_CD §10 (secrets matrix — APPLE_APP_STORE_CONNECT_API_KEY,
     ANDROID_SERVICE_ACCOUNT_JSON), Rule 4 (five screens — /download is a
     sub-screen, not a 6th), Rule 5 (no indigo/blue accents — channels use
     the bioluminescent palette, never a blue "staging" tag).
```

### 12.3 Build → Channel Map

Which git branch produces which binary on which channel. The map is enforced via `eas.json`'s `update.<profile>.channel` field (§3.1) AND via the `eas-update.yml` workflow triggers (§4.2 + `05_CI_CD_GitHub_Actions.md` §6). The map is **1:1** — never invert, never cross-route.

```
  BUILD → CHANNEL MAP  (§4.2, branch → channel routing, 1:1 enforced)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │   GIT BRANCH           EAS PROFILE      OTA CHANNEL    AUDIENCE                │
  │   ───────────────      ─────────────    ───────────    ──────────             │
  │                                                                                │
  │   PR push (any)   ──►  development  ──► development  ──► engineers            │
  │   (PR previews)        (§3.2)              (violet)        self-trusted        │
  │                          │                                                     │
  │                          └─ eas-update.yml trigger: PR push                    │
  │                             → eas update --branch development                 │
  │                                                                                │
  │   release/*       ──►  preview       ──► staging      ──► beta testers        │
  │   (release PRs)        (§3.3)              (amber)         opt-in (TestFlight  │
  │                          │                                  + Play Internal)   │
  │                          └─ eas-update.yml trigger: push to release/*         │
  │                             → eas update --branch staging                    │
  │                                                                                │
  │   main            ──►  production    ──► production   ──► all tutors          │
  │   (production)         (§3.4)              (emerald ✓)     implicit trust     │
  │                          │                                  (store-installed) │
  │                          └─ eas-update.yml trigger: push to main             │
  │                             → eas update --branch production                 │
  │                                                                                │
  │  TAG v*          ──►  production    ──► (binary build, not OTA)               │
  │  (release tag)        (§3.4)              (emerald ✓)                          │
  │                          │                                                     │
  │                          └─ eas-build.yml trigger: tag v*                     │
  │                             → eas build --profile production                  │
  │                                --platform all --auto-submit --no-wait         │
  │                             → follow-up: mirror APK to Blob (§6.2)            │
  │                                                                                │
  │  RULES (the 1:1 contract):                                                    │
  │   ↑ A branch maps to EXACTLY ONE channel.                                     │
  │   ↑ A channel maps to EXACTLY ONE branch.                                     │
  │   ↑ There is NO "channel from a feature branch" path.                         │
  │   ↑ An engineer testing a feature via OTA pushes to a PR → development        │
  │     channel. They do NOT pollute staging.                                     │
  │   ↑ The channel is BAKED INTO THE BINARY at build time (§4.4). A              │
  │     production-channel device CANNOT be downgraded to staging via             │
  │     a malicious OTA.                                                          │
  │                                                                                │
  │  TRUST MODEL (§4.4):                                                          │
  │   ↑ development: builds distributed via EAS internal URL — only the          │
  │     engineer with the URL can install.                                        │
  │   ↑ staging: builds distributed via TestFlight (Apple ID allowlist) or       │
  │     Play Internal Testing (Google Group allowlist).                          │
  │   ↑ production: builds distributed via the public stores — anyone           │
  │     can install.                                                              │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The map is a concept diagram (branch→channel routing), not a rendered
     UI surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: violet = development (engineer sandbox), amber =
     staging (beta-tester, in-soak), emerald = production (tutor-facing,
     live), cyan = the tag-triggered binary build path (in-progress).
   ↑ Cross-refs: §3 (build profiles), §4.1 (the three channels), §4.2
     (channel→branch mapping), §4.3 (why three channels, not two), §4.4
     (trust model), §5 (OTA branching), 05_CI_CD §4 (eas-build.yml),
     §6 (eas-update.yml), 04_Release_Pipeline.md §3 (PATCH/MINOR/MAJOR
     release types), Rule 9 (no silent failures — every OTA publishes
     or fails loudly).
```

### 12.4 OTA Promotion Flow (PATCH vs. MINOR vs. MAJOR)

What ships via OTA (JS-only, ~15-min reach, no store review) vs. what requires a binary build + store resubmit (1–3 day review). The decision is per-release, based on the diff between the previous and new versions. The `js_only` detection in `eas-update.yml` (§5.2 + `05_CI_CD_GitHub_Actions.md` §6.1) enforces it.

```
  OTA PROMOTION FLOW  (§5.2 + 04_Release_Pipeline.md §3, PATCH/MINOR/MAJOR)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │   RELEASE TYPE    DIFF TOUCHES         OTA-ELIGIBLE?    PATH                  │
  │   ────────────    ──────────────       ─────────────    ────                  │
  │                                                                                │
  │   PATCH           .tsx / .ts only      ✓ YES            eas-update.yml →     │
  │   (bug fix)       in apps/mobile/src/                    eas update           │
  │   (v1.4.0→1.4.1)  + packages/*                          --branch production  │
  │                     │                                                     │
  │                     │                                  → reaches all        │
  │                     │                                    production devices  │
  │                     │                                    in ~15 min          │
  │                     │                                    (emerald ✓)         │
  │                     │                                                     │
  │                     └─ no schema change, no native change                 │
  │                        → no store review, no binary rebuild                │
  │                        (the fastest path — Rule 9: ship the fix today)    │
  │                                                                                │
  │   MINOR           new feature,          △ MAYBE         if JS-only: OTA      │
  │   (new feature)   backward-compat       (depends on     if native dep added: │
  │   (v1.4→1.5)      schema migration      the diff)        eas-build.yml →     │
  │                     │                                      eas build           │
  │                     │                                        --profile prod    │
  │                     │                                        --platform all    │
  │                     │                                        --auto-submit     │
  │                     │                                      → TestFlight + Play │
  │                     │                                        Internal (1 hour)  │
  │                     │                                      → store review      │
  │                     │                                        (1–3 days)         │
  │                     │                                      (amber — pending)   │
  │                     │                                                     │
  │                     └─ if diff touches app.json, app.config.js,             │
  │                        package.json (new native dep), or                    │
  │                        apps/mobile/ios/ or apps/mobile/android/             │
  │                        → binary build required (the js_only=false gate)    │
  │                                                                                │
  │   MAJOR           breaking schema      ✕ NO             eas-build.yml →     │
  │   (v1→v2)         change                                binary build with   │
  │   (15_Future_                                           new schema +       │
  │    Roadmap.md                                             migration code     │
  │    v2.0)                                                → store resubmit    │
  │                                                          (1–3 days)         │
  │                                                        (flare — high-stakes) │
  │                     │                                                     │
  │                     └─ OTA CANNOT change the migration code                │
  │                        (it ships with the binary). Tutors on the old       │
  │                        binary see "App update required".                   │
  │                        Rollback = restore pre-migration backup (EC-M-02    │
  │                        + EC-M-03, 04_Release_Pipeline.md §6.5).            │
  │                                                                                │
  │  THE js_only GATE (eas-update.yml §6.1, the contract):                       │
  │   ┌────────────────────────────────────────────────────────────────────┐    │
  │   │  CHANGED=$(git diff --name-only HEAD^ HEAD)                         │    │
  │   │  if echo "$CHANGED" | grep -qE                                      │    │
  │   │    '(app\.json|app\.config\.js|apps/mobile/ios/|                    │    │
  │   │     apps/mobile/android/|package\.json)'; then                      │    │
  │   │    js_only=false   ← binary build required                          │    │
  │   │  else                                                               │    │
  │   │    js_only=true    ← OTA-eligible                                   │    │
  │   │  fi                                                                 │    │
  │   └────────────────────────────────────────────────────────────────────┘    │
  │   ↑ prevents shipping an OTA that references a native module the binary     │
  │     lacks (would crash on launch — AGENTS.md §8 anti-pattern #9).          │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The flow is a concept diagram (release-type routing), not a rendered
     UI surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = PATCH (OTA, fast, no review), amber = MINOR
     (binary build, in-review, pending), flare = MAJOR (high-stakes, schema
     migration, heaviest rollback), cyan = the js_only gate (the decision
     point).
   ↑ Cross-refs: §3 (build profiles), §5 (OTA branching), §5.2 (OTA-eligible
     diff), 04_Release_Pipeline.md §3.1 (PATCH), §3.2 (MINOR), §3.3 (MAJOR),
     05_CI_CD_GitHub_Actions.md §6.1 (js_only detection), §6 (eas-update.yml),
     14_Edge_Cases.md EC-M-02 (migration fails mid-way), EC-M-03 (downgrade
     attempt), AGENTS.md §8 anti-pattern #9 (shipping OTA that references a
     native module the binary lacks), 15_Future_Roadmap.md v2.0 (first MAJOR).
```

### 12.5 EAS Dashboard Update History Card (the one live UI surface this file references)

The only screen a release-engineering agent opens from this file's contract is the EAS dashboard's Updates tab — to read the latest OTA's `<build-id>` and, when needed, click "Republish" to roll back (§5.5). The dashboard is third-party chrome (Expo's own UI), but the contract this file makes about how the agent reads it (the card is glass-equivalent content; the republish button is a control) follows §6.6's single rule.

```
  EAS DASHBOARD — UPDATE HISTORY CARD  (§5.5, the OTA rollback lever)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  expo.dev/accounts/buddysaradhi/projects/<project-id>/updates                     │
  │                                                                              │
  │  ┌─ Update card (EAS chrome, glass-equivalent content surface) ──────────┐  │
  │  │  ● production  ·  abc1234  ·  2 min ago  ·  "fix(fees): LWW tie-break" │  │
  │  │     ▲ channel dot (emerald = production, amber = staging, violet =    │  │
  │  │       development — never indigo/blue per Rule 5)                      │  │
  │  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
  │  │  │  build-id: 9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c                  │ │  │
  │  │  │  runtime-version: 1.4.0    binary-version: 1.4.0                  │ │  │
  │  │  │  reach: 47 of 312 devices (15%)  ·  ETA: ~12 min                  │ │  │
  │  │  └──────────────────────────────────────────────────────────────────┘ │  │
  │  │  [ View ]   [ ... → Republish ]   ← control = .neumo-raised (§6.6)     │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  │     ↑ content surface = glass-equivalent (§5.5 coverage map: "card" tier)   │
  │     ↑ "Republish" button = control = .neumo-raised per §6.6                 │
  │     ↑ on :active → .neumo-pressed (§6.3) + 1px translate                   │
  │     ↑ WCAG §1.4.1: the channel dot is NEVER the only signal — the          │
  │       text label "production / staging / development" accompanies it.       │
  │                                                                              │
  │  OTA ROLLBACK FLOW (§5.5, the procedure this card enables):                 │
  │   1. Agent finds the PRIOR update (the one before the bad push).            │
  │   2. Copies its <build-id> from the card above.                              │
  │   3. Runs: eas update --branch production --republish <prior-build-id>.      │
  │   4. Verifies: a test device on production sees the prior JS on next         │
  │      foreground (~15 min reach).                                             │
  │   5. Appends `---` worklog entry (the rollback audit trail, §5.5 step 5).   │
  │                                                                              │
  │  TIME TO ROLL BACK: <5 min (republish is instant; device-side rollback      │
  │  on next foreground, ~15 min reach).                                         │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ This is a live UI surface — the §6.6 single rule applies: card =
     glass-equivalent (content), "Republish" = neumo-raised (control).
   ↑ Accent colours: emerald = production channel (live), amber = staging
     (in-soak), violet = development (engineer sandbox), flare = bad-OTA
     rollback triggered (the procedure this card enables).
   ↑ Cross-refs: §5 (OTA branching), §5.5 (OTA rollback procedure, 5 steps),
     04_Release_Pipeline.md §6.2 (mobile OTA rollback playbook),
     13_UI_Guidelines.md §5.5 (card tier), §6.6 (control = neumo), §6.3
     (pressed), §10.6 (WCAG §1.4.1), BR-SEC-08 (audit_log — the worklog
     entry is the ops-side audit equivalent), Rule 5 (no indigo/blue —
     channel dots use the bioluminescent palette).
```

### 12.6 References (External Design Authorities)

The mockups and the mobile build + OTA contract in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the three-channel model, the `eas.json` profile tree, or the OTA-eligible diff rule.

- **Expo EAS docs** — *Build profiles, channels, OTA updates, credentials, auto-submit*. The §12.2 profile tree follows EAS's `eas.json` schema documentation; the §12.4 OTA promotion flow follows EAS's update-eligibility documentation.
- **Apple App Store Connect docs** — *TestFlight, app review, build numbers, versionCode monotonicity*. The §12.3 staging→production promotion path follows App Store Connect's TestFlight documentation; the §12.5 update-history card follows ASC's build-status model.
- **Google Play Console docs** — *Internal testing, app bundles, AAB→APK conversion, track promotion*. The §12.3 Android sub-path follows Play Console's internal-testing + track-promotion documentation; the §6.2 AAB→APK conversion follows `bundletool` documentation.
- **Smashing Magazine** — *Mobile release pipelines, OTA UX*. The §12.5 update-history card mockup follows Smashing's case for ASCII-over-pixels for spec-grade contracts (the card is third-party chrome, but the contract about how the agent reads it is first-party).
- **CSS-Tricks** — *Branch→channel routing for mobile release pipelines*. The §12.3 build→channel map follows CSS-Tricks's primer on 1:1 branch-to-channel routing.
- **Nielsen Norman Group** — *WCAG §1.4.1 Use of Color*. The §12.5 dual-signal note (channel dot + text label, never colour alone) follows NN/g's colour-only-signal research and `13_UI_Guidelines.md` §10.6.

---

*This file is the operational spec for EAS as Buddysaradhi's mobile build + OTA pipeline. It is read by every release-engineering agent before they touch `eas.json` or run `eas build` / `eas update`. When this file and the EAS dashboard disagree, this file wins — unless this file is wrong, in which case you amend this file first, then the dashboard, then the workflow YAML, then the worklog. The order matters.*
