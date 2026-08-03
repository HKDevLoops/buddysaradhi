# 07 — App Store Release

> The iOS App Store and Google Play Store release process for Buddysaradhi mobile. Covers first submission (full EAS Build → IPA/AAB → store submit → review), subsequent JS-only updates (EAS Update OTA, no review), subsequent native updates (full build + review), App Store Connect metadata (privacy labels, screenshots, privacy policy), Play Console data safety form, versioning (`MAJOR.MINOR.PATCH` + build number), release cadence (PATCH weekly OTA, MINOR monthly store, MAJOR quarterly), and the rollback playbook for each store. This file is the release engineer's manual. For EAS Build profiles see `05_EAS_Build.md`; for OTA channel strategy see `06_EAS_Update.md`.

---

## 1. The Two Stores, Side by Side

| Concern | iOS App Store | Google Play Store |
|---|---|---|
| Submission tool | `eas submit -p ios --latest` | `eas submit -p android --latest` |
| Build artifact | `.ipa` (signed with distribution cert) | `.aab` (signed with upload key) |
| Pre-release testing | TestFlight (internal + external testers) | Internal testing → Closed testing → Open testing |
| Review time | 5–7 days (first submission); 1–2 days (subsequent) | 1–3 days (usually faster than iOS) |
| Review strictness | High — strict on permissions, privacy, IAP | Medium — strict on data safety, less on UI |
| Privacy disclosure | App Privacy labels (per Apple's spec) | Data safety form (per Google's spec) |
| OTA support | Allowed for JS-only updates (per Apple's OTA policy) | Allowed for JS-only updates (per Play's policy) |
| Rollback | Republish prior build + EAS Update republish | Play Console "Rollback" (per-version) |
| Staged rollout | Phased release (1%, 2%, 5%, 10%, 20%, 50%, 100% over 7 days) | Staged rollout (1%, 10%, 50%, 100% over 4 days) |

Both stores permit JS-only OTA updates **as long as** the update does not change the app's primary purpose, does not introduce new permissions, and does not violate the original review. Buddysaradhi's OTA usage (bug fixes, UI polish, sync logic) is well within both stores' policies.

---

## 2. iOS App Store Release

### 2.1 First Submission

The first submission is the most involved. Plan for a 7-day review window.

```
┌────────────────────────────────────────────────────────────────┐
│  Step 1: Production build                                        │
│  $ eas build --platform ios --profile production --auto-submit  │
│  → EAS builds the IPA, signs it, uploads to App Store Connect   │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 2: TestFlight internal testing                            │
│  Build appears in App Store Connect → TestFlight                │
│  Internal testers (up to 100) install via TestFlight app        │
│  Smoke test for 24-48h: all 5 tabs, sync, biometric, backup     │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 3: App Store Connect metadata                             │
│  - App name: "Buddysaradhi"                                          │
│  - Subtitle: "Tuition management for private tutors"            │
│  - Description: (see §2.4)                                      │
│  - Keywords: tutor, tuition, coaching, attendance, fees         │
│  - Screenshots: 6.7" iPhone (iPhone 15 Pro Max) + 5.5" + iPad   │
│  - App Privacy Policy URL: https://buddysaradhi.app/privacy          │
│  - Support URL: https://buddysaradhi.app/support                     │
│  - Privacy labels: "Data Not Collected" (see §2.5)              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 4: Submit for review                                      │
│  App Store Connect → "Add for Review" → "Submit for Review"     │
│  Status: "Waiting for Review" (1-3 days)                        │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 5: Review                                                 │
│  Apple reviews: typically 1-2 days for a new app                │
│  Status: "In Review"                                            │
│  Common rejection reasons: see §2.6                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 6: Ready for Sale                                         │
│  Status: "Ready for Sale"                                       │
│  Release immediately OR schedule for a specific date            │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 7: Phased release                                         │
│  1% → 2% → 5% → 10% → 20% → 50% → 100% over 7 days             │
│  Monitor crash reports + audit log for issues                   │
│  Pause rollout if any P0 issue is detected                      │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Subsequent JS-Only Updates

After the first approved submission, JS-only updates ship via EAS Update OTA — **no App Store review needed**. The user gets the update on their next app foreground (per `06_EAS_Update.md` §4).

This is the dominant release path. 90% of Buddysaradhi updates are JS-only and ship within hours of the fix being merged.

### 2.3 Subsequent Native Updates

Native updates (new native module, new permission, Expo SDK upgrade, React Native upgrade) require a full EAS Build + App Store review. The path is the same as §2.1, but the review is typically faster (1–2 days) because the app is already approved.

For native updates, the version number (CFBundleShortVersionString) must increment. Per Apple's policy, a build with the same version number as a previously approved build cannot be submitted — `autoIncrement` in `eas.json` handles the build number, but the engineer must bump the marketing version manually in `app.config.ts`:

```ts
export default {
  version: '1.5.0', // was 1.4.2 — bumped for native update
  // ...
};
```

### 2.4 App Store Description

The description is a 4,000-character marketing blurb. The first sentence is what shows in search results, so it must be tight:

> Buddysaradhi is the operating system for private tutors and small coaching institutes. Run your entire tuition business from five screens — Dashboard, Students, Attendance, Fees & Payments, Settings — offline-first, with an immutable ledger, biometric security, and encrypted backups you control.

The body should cover:

- The five-screen doctrine (one paragraph per screen)
- The seven hidden engines (one paragraph: "Search, Reminders, Ledger, Reports, Notifications, Sync, Security — all background, no menus")
- Offline-first ("Works in airplane mode. Syncs when you reconnect.")
- Sovereignty ("Your data is yours. No telemetry. No vendor lock-in. Encrypted backups you can email to yourself.")
- Privacy ("We do not collect, sell, or share your data. Period.")
- Pricing ("Free for everyone, for now — free while our backend infra stays free. Paid tiers (Pro ₹299/month, Institute ₹999/month) launch when we scale, with 60 days' notice.") — the exact numbers must match `../product/05_Pricing_and_Plans.md` verbatim; if that file changes the price, this description must change in the same PR.

### 2.5 App Privacy Labels

Apple requires App Privacy labels declaring what data the app collects. Buddysaradhi's labels:

| Data type | Declared | Justification |
|---|---|---|
| Contact Info (Email, Phone) | **Not Collected** | Email/phone are stored locally in the tutor's DB; not collected by us |
| Identifiers (User ID) | **Not Collected** | Supabase auth uses email; no separate user ID is collected |
| Usage Data | **Not Collected** | No analytics, no telemetry (`TELE-1`) |
| Diagnostics | **Not Collected** | No crash reporting in v1 |
| Financial Info (Payment Info) | **Not Collected** | We do not process payments; the tutor records them |
| Location | **Not Collected** | No location services |
| Photos or Videos | **Not Collected** | No photo/video access |
| Health & Fitness | **Not Collected** | N/A |
| Contacts | **Not Collected** | No contacts access |
| Calendar | **Not Collected** | No calendar access |
| Browsing History | **Not Collected** | N/A |
| Search History | **Not Collected** | Search is local-only |

The headline answer is "Data Not Collected." This is rare among SaaS apps and is a competitive differentiator — emphasize it in the description.

### 2.6 Review Pitfalls

Common reasons Apple rejects apps, and how Buddysaradhi avoids each:

| Pitfall | How Buddysaradhi avoids it |
|---|---|
| App Tracking Transparency (ATT) prompt missing | We don't track — no ATT prompt needed |
| Missing privacy policy URL | `https://buddysaradhi.app/privacy` is live |
| Demo / placeholder content | First submission has a fully functional app; no "coming soon" screens |
| Crashes on launch | Tested on 6 device/OS combos via TestFlight internal |
| Login required but no demo account | Apple reviewers get a demo Supabase account (see §2.7) |
| Background modes declared but unused | We declare only `background-fetch` (used for sync); not audio, location, VOIP |
| In-app purchase not using StoreKit | We don't have IAP in v1 (subscription is via web) |
| App name / description keyword stuffing | Description uses natural language; no keyword lists |
| Screenshots don't match actual UI | Screenshots are auto-generated from a SmokeTestOS build |

### 2.7 The Apple Reviewer Demo Account

Apple reviewers need to log in to test the app. We provision a dedicated reviewer account:

- Supabase user: `apple-reviewer@buddysaradhi.app` (no real password — uses a one-time password emailed to `release@buddysaradhi.app` on each review submission)
- Pre-populated Turso DB: 12 students, 3 batches, 4 months of attendance + payments
- The reviewer's Apple ID email is added to the Supabase allowlist for the review window

The demo account credentials are entered in App Store Connect → "App Review Information" → "Demo Account." Apple uses them once during review; we rotate the password after each review.

### 2.8 Background Modes

`app.config.ts` declares:

```ts
ios: {
  backgroundModes: ['fetch'],
}
```

Only `fetch` (background fetch for sync). Not `audio`, `location`, `voip`, `external-accessory`, `bluetooth-central`, `bluetooth-peripheral`, or `processing`. Declaring modes you don't use is a review rejection.

### 2.9 iOS Permissions — Info.plist Usage Strings

Every permission requires a `NSXxxUsageDescription` string in `Info.plist`, set via `app.config.ts` `ios.infoPlist`:

```ts
ios: {
  infoPlist: {
    NSFaceIDUsageDescription: 'Buddysaradhi uses Face ID to unlock your tuition data and confirm sensitive actions like voiding receipts.',
    NSCameraUsageDescription: 'Buddysaradhi uses the camera to scan QR codes for quick student lookup.', // v1.x only
    // No NSLocationWhenInUseUsageDescription — we don't use location
    // No NSContactsUsageDescription — we don't access contacts
    // No NSPhotoLibraryUsageDescription — we don't access photos
  },
}
```

The usage description must explain **why** the app needs the permission, in plain language. Apple rejects generic strings like "App needs this permission."

---

## 3. Google Play Store Release

### 3.1 Release Tracks

Play Console has four release tracks, in order of increasing audience:

```
Internal testing (up to 100 testers)
        │
        │ promote
        ▼
Closed testing (named tracks, up to 2,000 testers each)
        │
        │ promote
        ▼
Open testing (anyone with the opt-in link)
        │
        │ promote
        ▼
Production (staged rollout: 10% → 50% → 100%)
```

### 3.2 The Release Flow

```
┌────────────────────────────────────────────────────────────────┐
│  Step 1: Production build                                        │
│  $ eas build --platform android --profile production            │
│  $ eas submit -p android --latest --track internal              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 2: Internal testing                                        │
│  Up to 100 testers install via Play Console internal track      │
│  Smoke test for 24-48h                                           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 3: Promote to Closed testing                              │
│  Play Console → "Promote release" → Closed testing              │
│  Named track: "Beta" — opt-in link shared with select users    │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 4: Promote to Open testing (optional)                     │
│  Anyone with the opt-in link can join                           │
│  Useful for gathering feedback before production                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 5: Promote to Production (staged rollout)                 │
│  Play Console → "Promote release" → Production                  │
│  Rollout: 10% → 50% → 100% over 4 days                          │
│  Monitor ANR/crash reports in Play Console → Android vitals     │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Step 6: Full rollout                                           │
│  100% of users on the new version                               │
│  Rollout complete                                               │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 Data Safety Form

Google requires a Data Safety form declaring what data the app collects and shares. Buddysaradhi's form:

| Data type | Collected? | Shared? | Purpose | Encrypted in transit? | Deletion possible? |
|---|---|---|---|---|---|
| Personal info (name, email, phone of tutor) | Yes (entered by tutor) | No | App functionality | Yes (HTTPS to Turso) | Yes (Settings → Delete account) |
| Financial info (fees, payments) | Yes (entered by tutor) | No | App functionality | Yes (HTTPS to Turso) | Yes |
| Student personal info (name, parent phone) | Yes (entered by tutor) | No | App functionality | Yes (HTTPS to Turso) | Yes |
| Usage data | **No** | No | — | — | — |
| Diagnostics | **No** | No | — | — | — |
| Device ID | **No** | No | — | — | — |
| Location | **No** | No | — | — | — |

The headline answer is "No data shared with third parties." This matches the iOS App Privacy label.

### 3.4 Play Store Listing

- **App name:** Buddysaradhi
- **Short description (80 chars):** "Tuition management for private tutors. Offline-first. Encrypted."
- **Full description (4,000 chars):** Same as iOS App Store description (§2.4), with Android-specific notes ("Works on Android 8.0+; optimized for AMOLED displays").
- **Screenshots:** Phone (16:9, 1080×1920), Tablet (16:10, 1200×1920), Feature graphic (1024×500)
- **Privacy Policy URL:** `https://buddysaradhi.app/privacy`
- **Category:** Education
- **Content rating:** Everyone (no violence, no user-generated content)
- **Target audience:** Adults (tutors, not students)
- **Ads:** No
- **In-app purchases:** No (v1)
- **App signing:** Play App Signing (Google holds the upload key; we sign with EAS-managed upload key, Google re-signs for distribution)

### 3.5 Play Store Permissions

The AAB's manifest declares permissions based on what native modules require. We declare only what we use:

- `android.permission.USE_BIOMETRIC` (for `expo-local-authentication`)
- `android.permission.USE_FINGERPRINT` (legacy, for older devices)
- `android.permission.POST_NOTIFICATIONS` (API 33+, for `expo-notifications`)
- `android.permission.VIBRATE` (for `expo-haptics`)
- `android.permission.INTERNET` (for libSQL HTTP sync)
- `android.permission.RECEIVE_BOOT_COMPLETED` (for rescheduling notifications after reboot)

We **do not** declare: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA` (in v1; v1.x adds it for QR scan), `READ_CONTACTS`, `READ_CALENDAR`, `READ_PHONE_STATE`.

The Play Store shows the permission list to users before install. Fewer permissions = more installs.

### 3.6 Review Pitfalls (Android)

| Pitfall | How Buddysaradhi avoids it |
|---|---|
| Data safety form mismatches manifest | We audit permissions quarterly; the form mirrors the manifest |
| Missing privacy policy | `https://buddysaradhi.app/privacy` is live |
| Target API level too low | We target the latest required by Play (API 34 as of 2025); EAS handles this |
| Use of SMS/CALL_LOG permissions | We use neither |
| Background location access | We don't use location |
| Notification permission not requested at runtime | `expo-notifications` requests on first reminder schedule |
| ANR rate > 0.47% | We test sync under load; main thread never blocks |

### 3.7 The Public Sideload APK Mirror on Vercel Blob

The Play Store is the primary distribution path, but it is not the only one. A subset of Indian tutors — especially those on secondary devices, on shared family phones, or whose Play Store is unavailable for regional/account reasons — need a sideloadable APK they can install without the Play Store middleman. We serve them via the **Vercel Blob sideload mirror**, which is the **commercial surface** for the mobile Android install path.

The mechanics, owned by `../deployment/03_EAS_Build_and_Update_Channels.md` §6.2:

1. The `production` profile's `eas build` produces a signed `.aab` and submits it to Play Console's `internal` track.
2. The post-build hook (`scripts/post-build-upload.js`, `05_EAS_Build.md` §6.2) runs `bundletool build-apks --mode=universal` against the AAB to produce a release-signed universal APK.
3. The hook uploads the universal APK to Vercel Blob at `buddysaradhi-builds/<version>/android/Buddysaradhi-<version>-universal.apk`, alongside a `manifest.json` describing the version, build number, file size, and CDN URL.
4. The commercial download hub at `buddysaradhi.app/download` (`../product/04_Download_Hub.md`) polls `https://blob.buddysaradhi.app/builds/latest/android/manifest.json` and renders a "Download APK" card next to the Play Store badge.

This sideload path is **only for Android**. iOS has no equivalent — the TestFlight invite link (also surfaced on the download hub) is the closest analogue, and it requires Apple's beta distribution machinery. The `no-ios-blob-upload.test.ts` lint rule (`../deployment/03` §6.3) hard-blocks any `.ipa` upload to Blob, because an IPA on a public URL is useless to 99% of iOS users (no signing match, no TestFlight allowlist).

The sideload APK is **release-signed** (signed with the same EAS-managed upload key as the Play Store AAB), not debug-signed. The `preview` profile's APK (used for internal QA sideloading) is debug-signed and is **never** published to the download hub — only the production-profile-derived universal APK reaches the public mirror.

### 3.8 Why Two Distribution Paths (Play Store + Sideload)

The Indian mobile landscape has a long tail of devices and accounts where the Play Store is not the frictionless default it is in Western markets:

- **Secondary devices** — a tutor's primary phone is on the Play Store, but their backup phone (often an older Redmi / Micromax / Lava device with limited storage) may have a misconfigured Play Store account or be on a guest profile.
- **Shared family phones** — a tutor's spouse or parent may own the device; the tutor doesn't have Play Store install privileges.
- **Network cost** — Play Store downloads count against a Jio/Airtel daily data cap. A direct APK download over office Wi-Fi is free.
- **App Store region gaps** — in rare cases, a tutor's Google account region is set incorrectly and the app is unavailable in their Play Store.

The sideload APK is the safety net. It is **not** the primary path (we don't link to it above the Play Store badge on the download hub — `product/04_Download_Hub.md` makes the Play Store the primary CTA), but it exists for the long tail.

---

## 4. Versioning

### 4.1 Semver Convention

Buddysaradhi mobile uses semver `MAJOR.MINOR.PATCH`:

- **PATCH** (`1.4.3`): JS-only bug fixes. OTA-shippable. No store resubmit.
- **MINOR** (`1.5.0`): New features, may include native changes. Store resubmit required.
- **MAJOR** (`2.0.0`): Breaking changes (schema migrations requiring data backfill, UI overhauls, principle amendments). Store resubmit + release notes + migration guide.

### 4.2 Build Number

Every EAS Build auto-increments the build number (`autoIncrement: true` in `eas.json`):

- iOS `CFBundleVersion`: monotonically increasing integer (1, 2, 3, ...)
- Android `versionCode`: monotonically increasing integer

The build number is independent of the marketing version. Two builds of v1.4.2 (e.g., a fix republished as v1.4.2) have different build numbers but the same marketing version. The stores use the build number to enforce "newer build required" on upload.

### 4.3 The Version Source of Truth

`app.config.ts` `version` is the source of truth for the marketing version. The build number is stored in EAS (and surfaced in `app.config.ts` `extra.eas.buildNumber`).

```ts
// app.config.ts
export default (): ExpoConfig => ({
  version: '1.4.2',
  extra: {
    eas: {
      projectId: '...',
      buildNumber: process.env.EAS_BUILD_BUILD_NUMBER,
      channel: process.env.EAS_BUILD_PROFILE,
    },
  },
  // ...
});
```

The app displays the marketing version + build number in Settings → About: `v1.4.2 (build 47)`.

---

## 5. Release Cadence

| Cadence | Type | Frequency | Channel |
|---|---|---|---|
| PATCH | JS-only bug fix | Weekly (or as needed) | EAS Update OTA |
| MINOR | New features, may include native | Monthly | EAS Build + store submit |
| MAJOR | Breaking changes | Quarterly | EAS Build + store submit + release notes |

### 5.1 The Weekly PATCH

Every Tuesday (or as needed), the engineer reviews the audit log for issues, merges approved PRs, and publishes a PATCH via EAS Update:

```bash
# Tag the release
git tag v1.4.3
git push origin v1.4.3

# CI auto-publishes to staging
# Wait 24h on staging
# Promote to production
eas update --branch production --message "v1.4.3: weekly patch"
```

No store review. Users get the update on next foreground. The whole cycle is < 30 minutes of engineer time.

### 5.2 The Monthly MINOR

The first Monday of each month:

```bash
# Bump version in app.config.ts
# (edit) version: '1.5.0'

# Build + submit
eas build --platform all --profile production --auto-submit
```

The build goes to TestFlight internal + Play Console internal. After 24h of smoke testing, promote to production:

- iOS: App Store Connect → "Release to App Store" with phased release.
- Android: Play Console → "Promote to Production" with 10% → 50% → 100% rollout.

The MINOR cycle takes ~5 days end-to-end (build → TestFlight → review → phased release).

### 5.3 The Quarterly MAJOR

Once per quarter, a MAJOR release. This includes:

- Schema migrations (forward-only, per `P-DM8`).
- UI overhauls (if any).
- Principle amendments (if any; requires orchestrator sign-off per `01_Product_Principles.md` §Amendment Process).

The MAJOR cycle takes ~3 weeks end-to-end (planning → migration → build → beta → review → phased release). Release notes are published on `buddysaradhi.app/blog/<version>` and linked from the store listing.

---

## 6. The Rollback Playbook

### 6.1 iOS Rollback

iOS does not have a "rollback" button in App Store Connect. To roll back:

1. **OTA rollback first** (if the regression is JS-only):
   ```bash
   eas update --branch production --republish <prior-update-id> --message "rollback to v1.4.2"
   ```
   This rolls back the JS bundle for all users on v1.4.3 within minutes.

2. **Binary rollback** (if the regression is native):
   - App Store Connect does not allow re-releasing an old binary. The only path is to ship a new binary with the fix.
   - In extreme cases (e.g., a crash on launch), Apple Support can manually roll back — but this requires a support ticket and takes 24–48h.
   - The practical path is to ship a hotfix binary ASAP:
     ```bash
     # Bump version
     # (edit) version: '1.4.4'
     eas build --platform ios --profile production --auto-submit
     ```
     Then expedite review via App Store Connect "Expedited Review" request (typically 24h).

### 6.2 Android Rollback

Play Console **does** support per-version rollback:

1. Play Console → "Production" → "Release history"
2. Select the prior version → "Rollback"
3. Confirm. Users on the broken version will be downgraded on their next Play Store check.

Rollback is **only** available for the production track, not for testing tracks. It also requires that the prior version's rollout was ≥ 0% (i.e., it was live).

### 6.3 Rollback Decision Matrix

| Regression type | iOS | Android |
|---|---|---|
| JS-only bug | OTA republish (minutes) | OTA republish (minutes) |
| Native crash on launch | Hotfix binary + expedited review (~24h) | Play Console rollback (minutes) + hotfix binary |
| Sync data corruption | OTA republish + audit_log review | OTA republish + audit_log review |
| Permission regression | Hotfix binary (cannot OTA a permission change) | Hotfix binary (cannot OTA a permission change) |

For sync data corruption specifically, the OTA rollback is the JS bundle fix; the data reconciliation is a separate effort:

1. Roll back the JS bundle (stops new corruption).
2. Run `NightlyJob.verifyLedgerChain` to detect tampered rows.
3. For each affected student, void the corrupted entries and re-post from the audit log.
4. Surface the reconciliation in Settings → Diagnostics → "Reconciliation report."

---

## 7. Pre-Release Checklist

Before every MINOR or MAJOR store release, the release engineer runs through this checklist:

### 7.1 Build

- [ ] `bun run lint` passes (0 errors, 0 warnings)
- [ ] `bun run typecheck` passes
- [ ] `eas build --platform all --profile production` succeeds on both platforms
- [ ] Bundle size within budget (iOS ≤ 30 MB, Android ≤ 20 MB — `01_Architecture.md` §9)
- [ ] Build number auto-incremented

### 7.2 TestFlight / Internal Testing

- [ ] All 5 tabs render without errors
- [ ] Biometric unlock works (FaceID + TouchID + Android Biometric)
- [ ] PIN unlock works (incl. 5/10/15 fail lockout per `BR-SEC-03`)
- [ ] Record payment → receipt generated → ledger hash chain intact
- [ ] Void receipt → reversing entry posted → audit log written
- [ ] Mark attendance → lock → 24h lock enforced (`BR-ATT-07`)
- [ ] Edit locked attendance → PIN challenge (`BR-ATT-08`)
- [ ] Sync offline → online → outbox drains → no conflicts
- [ ] Force schema drift → update prompt shown (`EC-SY-08`)
- [ ] Backup create → restore → round-trip matches (`BACKUP-1`)
- [ ] Notifications scheduled → quiet hours respected (`BR-REM-05`)
- [ ] Deep links (`buddysaradhi://students/{id}`) work

### 7.3 Store Metadata

- [ ] App Store Connect: description, keywords, screenshots updated
- [ ] App Store Connect: privacy labels reviewed (still "Data Not Collected")
- [ ] App Store Connect: build selected for release
- [ ] Play Console: data safety form reviewed
- [ ] Play Console: store listing reviewed
- [ ] Play Console: AAB uploaded to internal track
- [ ] Both: release notes written (markdown, ≤ 4,000 chars)

### 7.4 Release

- [ ] iOS: phased release enabled (1% → 100% over 7 days)
- [ ] Android: staged rollout enabled (10% → 50% → 100% over 4 days)
- [ ] Monitor EAS dashboard for crash rates (should be < 0.5%)
- [ ] Monitor audit log for `error_unhandled` entries
- [ ] Pause rollout if any P0 issue is detected
- [ ] After 7 days (iOS) / 4 days (Android), confirm 100% rollout
- [ ] Tag the release in Git: `git tag v1.5.0 && git push origin v1.5.0`
- [ ] Update `worklog.md` with release notes

---

## 8. The First Release — v1.0.0

The first release is special. It establishes:

- App Store Connect app record (cannot be deleted; choose the name carefully)
- Play Console app record (cannot be deleted; choose the package ID carefully)
- Bundle ID / package ID: `app.buddysaradhi.mobile` (locked at first submission)
- App name: "Buddysaradhi"
- Developer account: Apple Developer Program ($99/yr) + Google Play Console ($25 one-time)

### 8.1 Account Setup

Before the first build:

1. Apple Developer Program: enroll at `developer.apple.com`. Requires a D-U-N-S number if enrolling as an organization. Takes 1–2 weeks for org enrollment; 1 day for individual.
2. Google Play Console: enroll at `play.google.com/console`. One-time $25 fee. Takes 1–2 days for identity verification.

### 8.2 Bundle ID / Package ID

The bundle ID (iOS) and package ID (Android) are permanent. We use `app.buddysaradhi.mobile` for both. Variants:

- Production: `app.buddysaradhi.mobile`
- Preview: `app.buddysaradhi.mobile.preview`
- Development: `app.buddysaradhi.mobile.dev`

`app.config.ts` reads `APP_VARIANT` env var and sets the bundle ID:

```ts
const variant = process.env.APP_VARIANT ?? 'production';
const bundleId = variant === 'production' ? 'app.buddysaradhi.mobile' : `app.buddysaradhi.mobile.${variant}`;

export default {
  ios: { bundleIdentifier: bundleId },
  android: { package: bundleId },
  // ...
};
```

This allows all three variants to coexist on the same device (production, preview, dev) without conflict.

---

## 9. Cross-References

- **EAS Build (profiles, credentials)**: `05_EAS_Build.md`
- **EAS Update (OTA, no store resubmit)**: `06_EAS_Update.md`
- **Cross-cutting EAS choreography (the build → submit → OTA flow that this file is the store-submission tail of)**: `../deployment/03_EAS_Build_and_Update_Channels.md` §6 (Build → submit → OTA flow) + §9 (TestFlight + Play Internal Testing workflow) + §11 (the cross-cutting contract that governs this file)
- **Commercial download hub (TestFlight invite link + sideload APK mirror alongside the other platform installers)**: `../product/04_Download_Hub.md` — the public marketing surface that consumes the Vercel Blob APK mirror documented in §3.7 above
- **Vercel Blob build storage (where the sideload APK mirror lives)**: `../deployment/02_Vercel_Blob_Build_Storage.md` §2 — the Blob bucket + `manifest.json` schema the download hub polls
- **CI/CD GitHub Actions (eas-build.yml + eas-submit.yml + mobile-build.yml workflows)**: `../deployment/05_CI_CD_GitHub_Actions.md`
- **Release pipeline (PATCH/MINOR/MAJOR cadence decision tree)**: `../deployment/04_Release_Pipeline.md`
- **Architecture (bundle size budgets)**: `01_Architecture.md` §9
- **Native modules (permissions matrix)**: `02_Native_Modules_and_Storage.md` §9
- **Top-level security (TELE-1, no telemetry → "Data Not Collected")**: `../10_Security.md` §17
- **Top-level agent operating manual (no telemetry rule)**: `../AGENTS.md` §2 Rule 3
- **Top-level product principles (P12 — minutes-per-day)**: `../01_Product_Principles.md` P12

---

## 10. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (60–80 for store-screenshot grids, 80–100 for review-state diagrams). The three mockups below visualise the *store-release primitives* — the App Store Connect screenshot grid, the Play Store listing anatomy, and the review-state machine — that the release engineer (App Store Connect, Play Console) implements and that `product/04_Download_Hub.md` consumes as the public marketing surface.

### 10.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **store-release layer**, not the in-app live-screen layer. The mockups below are *external surfaces* (App Store Connect listings, Play Console listings) and *process diagrams* (review-state machines) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every platform architecture file gets ≥ 2 mockups), but they do **not** carry in-app glass-tier or neumo-recipe annotations because they are not rendered inside the Buddysaradhi app. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the in-app screenshots that the store grid displays (each screenshot is a snapshot of a `.glass`-tiered Buddysaradhi screen); this file's job is to feed the stores the metadata, screenshots, and review-ready binary that the download hub (`product/04_Download_Hub.md`) links to.

| Store artefact (this file) | Live-screen consumer | Glass / neumo tier (in screenshot source) |
|---|---|---|
| §2.4 App Store description | `product/04_Download_Hub.md` (download cards) | `.glass` (download card, §5.5) |
| §2.5 App Privacy labels | (no in-app surface — store-only) | (none) |
| §3.4 Play Store listing | `product/04_Download_Hub.md` (download cards) | `.glass` (download card, §5.5) |
| §3.7 Sideload APK mirror | `product/04_Download_Hub.md` (Android card) | `.glass` + `.neumo-raised` CTA |
| §6 Rollback playbook | `06_EAS_Update.md` §5.3 (in-app banner) | `.glass-strong` (banner) + flare accent |
| Screenshots (in store grid) | each screenshot is a snapshot of a Buddysaradhi screen | varies — `.glass` KPI cards, `.glass-strong` tab bar, `.glass-faint` list rows |

### 10.2 App Store Connect Screenshot Grid (NEW)

The §2.1 step-3 metadata block rendered as the App Store Connect screenshot grid. Apple requires screenshots for 6.7" iPhone (iPhone 15 Pro Max), 5.5" iPhone, and iPad; the grid below shows the 6.7" set. Each screenshot is auto-generated from a SmokeTestOS build (§2.6 — "Screenshots don't match actual UI" pitfall avoided). The first screenshot is the hero — it shows the Dashboard with KPI cards; the last shows Settings with the version footer. The grid is the primary visual a tutor sees in App Store search before reading the description.

```
  APP STORE CONNECT SCREENSHOT GRID  (6.7" iPhone, §2.1 step 3)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  App Store Connect → App → Screenshots → 6.7" iPhone                      │
  │                                                                            │
  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                       │
  │   │  SCREEN 1    │  │  SCREEN 2    │  │  SCREEN 3    │                      │
  │   │  Dashboard   │  │  Students    │  │  Attendance  │                      │
  │   │  (hero)      │  │  list        │  │  grid        │                      │
  │   │              │  │              │  │              │                      │
  │   │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │                      │
  │   │ │▌Collected│ │  │ │▌● Aarav  │ │  │ │  ● ○ ● ◐ │ │                      │
  │   │ │▌₹2,45,500│ │  │ │  Grade 10│ │  │ │  ✓ ○ ● ✕ │ │                      │
  │   │ │▌Due Today│ │  │ │▌● Kabir  │ │  │ │  ● ○ ◐ ○ │ │                      │
  │   │ │▌₹48,000  │ │  │ │  Grade 9 │ │  │ │  ○ ● ✓ ○ │ │                      │
  │   │ │▌Present %│ │  │ │▌● Ananya │ │  │ │  ● ○ ○ ✓ │ │                      │
  │   │ │▌92%      │ │  │ │  NEET    │ │  │ │  ◐ ● ○ ○ │ │                      │
  │   │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │                      │
  │   │  ↑ .glass     │  │  ↑ .glass-   │  │  ↑ .glass     │                     │
  │   │    KPI cards  │  │    faint list │  │    attendance │                     │
  │   │    + accent   │  │    rows       │  │    grid cells │                     │
  │   │    left-border│  │              │  │              │                      │
  │   │    (§5.4)     │  │              │  │              │                      │
  │   └─────────────┘  └─────────────┘  └─────────────┘                       │
  │                                                                            │
  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                       │
  │   │  SCREEN 4    │  │  SCREEN 5    │  │  SCREEN 6    │                      │
  │   │  Fees &      │  │  Record      │  │  Settings    │                      │
  │   │  Payments    │  │  Payment     │  │  + version   │                      │
  │   │              │  │  modal       │  │  footer      │                      │
  │   │              │  │              │  │              │                      │
  │   │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │                      │
  │   │ │▌Aarav    │ │  │ │ Amount   │ │  │ │ Profile  │ │                      │
  │   │ │ ₹4,500   │ │  │ │ ₹5,000   │ │  │ │ Security │ │                      │
  │   │ │▌Kabir    │ │  │ │ Method:  │ │  │ │ Backup   │ │                      │
  │   │ │ ₹0       │ │  │ │  UPI     │ │  │ │ Import/  │ │                      │
  │   │ │▌Ananya   │ │  │ │ [Save]   │ │  │ │  Export  │ │                      │
  │   │ │ ₹12,000  │ │  │ │          │ │  │ │ About    │ │                      │
  │   │ │ (overdue)│ │  │ │          │ │  │ │ v1.4.2   │ │                      │
  │   │ └──────────┘ │  │ └──────────┘ │  │ │ (build   │ │                      │
  │   │  ↑ .glass-   │  │  ↑ .glass-   │  │ │  47)     │ │                      │
  │   │    faint rows │  │    strong    │  │ └──────────┘ │                      │
  │   │    + flare    │  │    sheet +   │  │  ↑ .glass-   │                     │
  │   │    accent on  │  │    backdrop  │  │    faint rows │                     │
  │   │    overdue    │  │    + .neumo- │  │              │                      │
  │   │    (§5.4)     │  │    raised    │  │              │                      │
  │   │              │  │    Save CTA   │  │              │                      │
  │   │              │  │    (emerald)  │  │              │                      │
  │   └─────────────┘  └─────────────┘  └─────────────┘                       │
  │                                                                            │
  │  SCREENSHOT RULES (§2.6):                                                  │
  │   ↑ Auto-generated from a SmokeTestOS build (no manual Photoshop).        │
  │   ↑ Each screenshot is a real Buddysaradhi screen — no "coming soon" mockups.  │
  │   ↑ Money displayed as ₹ with en-IN grouping (BR-M-02) — ₹2,45,500,       │
  │     not ₹245,500. Integer paise in storage (BR-M-01, AP-17).              │
  │   ↑ No indigo/blue accents — emerald/cyan/amber/flare/violet only         │
  │     (Rule 5, AP-6).                                                        │
  │   ↑ Pricing in description (§2.4): Free ≤250 (cost-anchored), ₹299/mo Pro (future), ₹999/mo Inst. (future)   │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The screenshot grid is a STORE surface (external), not an in-app
     surface — the glass/neumo annotations above describe the Buddysaradhi
     screens being snapshotted, not the store's rendering of the grid.
   ↑ Cross-refs: §2.1 (this file), 01_Architecture.md §3 (five-tab map),
     03_Navigation_and_State.md §3 (tab bar), 13_UI_Guidelines.md §5.5
     (glass tiers in each screenshot), product/04_Download_Hub.md (the
     public surface that links to the App Store listing).
```

### 10.3 Play Store Listing Anatomy (NEW)

The §3.4 Play Store listing rendered as the anatomy a tutor sees on the Play Store product page. The short description (80 chars) is the headline; the full description (4,000 chars) is the body; the feature graphic (1024×500) is the hero banner; the screenshots mirror the App Store set. The Data Safety form (§3.3) is the "No data shared with third parties" headline that matches the iOS App Privacy label. The "Download APK" alternative (sideload) is **not** surfaced on the Play Store page — it lives on the download hub (`product/04_Download_Hub.md`) for the long-tail Indian devices without Play Store friction.

```
  PLAY STORE LISTING ANATOMY  (§3.4, what the tutor sees on Play Store)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Play Store → Buddysaradhi → Product Page                                       │
  │                                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────┐ │
  │  │  FEATURE GRAPHIC (1024×500)                                          │ │
  │  │   ↑ hero banner — cosmic canvas (#0f0c29 → #24243e → #0a0a1a)       │ │
  │  │   ↑ Buddysaradhi logo (emerald gradient) + tagline                        │ │
  │  │   ↑ "Tuition management for private tutors. Offline-first."          │ │
  │  └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  ┌───────────────────────┐  ┌──────────────────────────────────────────┐  │
  │  │  APP ICON (512×512)   │  │  Buddysaradhi                                  │  │
  │  │  ↑ emerald gradient   │  │  ↑ app name                               │  │
  │  │  ↑ T-logo centered    │  │  Education · PEGI 3                       │  │
  │  └───────────────────────┘  │  ↑ category + content rating             │  │
  │                              │                                            │  │
  │                              │  "Tuition management for private         │  │
  │                              │   tutors. Offline-first. Encrypted."     │  │
  │                              │  ↑ SHORT DESCRIPTION (80 chars, §3.4)    │  │
  │                              │                                            │  │
  │                              │  ★ 4.8 (123 reviews) · 10K+ downloads    │  │
  │                              │  ↑ rating + download count               │  │
  │                              │                                            │  │
  │                              │  [ Install ]  [ Add to wishlist ]         │  │
  │                              │   ↑ Install = primary CTA                │  │
  │                              └──────────────────────────────────────────┘  │
  │                                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────┐ │
  │  │  SCREENSHOTS  (mirror App Store set, 16:9 1080×1920)                 │ │
  │  │   [Dash] [Students] [Attendance] [Fees] [Record Pay] [Settings]      │ │
  │  │   ↑ same 6 screens as §10.2 above                                    │ │
  │  └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────┐ │
  │  │  FULL DESCRIPTION (4,000 chars, §2.4 mirror + Android-specific note) │ │
  │  │   "Buddysaradhi is the operating system for private tutors and small      │ │
  │  │    coaching institutes. Run your entire tuition business from five   │ │
  │  │    screens — Dashboard, Students, Attendance, Fees & Payments,       │ │
  │  │    Settings — offline-first, with an immutable ledger, biometric     │ │
  │  │    security, and encrypted backups you control.                      │ │
  │  │    ...                                                                │ │
  │  │    Free for everyone, for now — free while our backend      │ │
  │  │    infra stays free. Paid tiers launch when we scale        │ │
  │  │    (with 60 days' notice).                                  │ │
  │  │    Works on Android 8.0+; optimized for AMOLED displays."  │ │
  │  │   ↑ pricing matches product/05_Pricing_and_Plans.md verbatim        │ │
  │  │   ↑ ₹0 Free (live, single public tier); ₹299/mo Pro (internal future); ₹999/mo Inst. (internal future) — integer paise   │ │
  │  └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────┐ │
  │  │  DATA SAFETY  (§3.3 form)                                            │ │
  │  │   Headline: "No data shared with third parties"                      │ │
  │  │   ↑ matches iOS App Privacy label "Data Not Collected" (§2.5)        │ │
  │  │   ↑ TELE-1 (no telemetry) → both stores agree                        │ │
  │  └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────┐ │
  │  │  PERMISSIONS  (§3.5 — only what we use)                              │ │
  │  │   • USE_BIOMETRIC (expo-local-authentication)                        │ │
  │  │   • USE_FINGERPRINT (legacy)                                          │ │
  │  │   • POST_NOTIFICATIONS (API 33+, expo-notifications)                  │ │
  │  │   • VIBRATE (expo-haptics)                                            │ │
  │  │   • INTERNET (libSQL HTTP sync)                                       │ │
  │  │   • RECEIVE_BOOT_COMPLETED (reschedule notifications)                 │ │
  │  │   ↑ NOT declared: CAMERA (v1), location, contacts, calendar,         │ │
  │  │     READ_EXTERNAL_STORAGE, READ_PHONE_STATE                           │ │
  │  └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  ALTERNATIVE: SIDELOAD APK (§3.7 — NOT on Play Store page)                │
  │   ↑ Lives on buddysaradhi.app/download (product/04_Download_Hub.md)           │
  │   ↑ For Indian long-tail: secondary devices, shared family phones,       │
  │     data-cap-conscious users, region-gap accounts                        │
  │   ↑ Release-signed universal APK from production AAB via bundletool      │
  │     (05_EAS_Build.md §6.2 + §13.4 flow)                                  │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The listing is a STORE surface (external), not an in-app surface —
     the feature graphic's cosmic canvas mirrors the app's root background
     (01_Architecture.md §5) but is rendered by Play, not by Buddysaradhi.
   ↑ Cross-refs: §3.4 + §3.3 + §3.5 + §3.7 (this file), 05_EAS_Build.md
     §13.4 (AAB→APK sideload flow), product/04_Download_Hub.md (the
     download hub that surfaces the sideload alternative), 02_Native_
     Modules_and_Storage.md §9 (permissions matrix), TELE-1 (no telemetry
     → Data Safety + App Privacy agree).
```

### 10.4 Review-State Machine (NEW)

The §2.1 first-submission flow + the §3.2 Play release flow rendered as the unified review-state machine. Both stores follow the same arc: Submit → Waiting → In Review → (Approved → Released | Rejected → Fix → Resubmit). The key differences: iOS takes 1–2 days for subsequent submissions (5–7 days for first), Android takes 1–3 days typically; iOS phased release is 7 days (1→2→5→10→20→50→100%), Android staged rollout is 4 days (10→50→100%); Android supports per-version rollback via Play Console (iOS does not — must ship hotfix binary).

```
  REVIEW-STATE MACHINE  (iOS App Store + Google Play, §2.1 + §3.2)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌──────────────────────┐                                                 │
  │   │  eas build --profile  │   ← production build, autoSubmit: true        │
  │   │  production           │      (05_EAS_Build.md §2.3)                    │
  │   │  --auto-submit        │                                                │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  SUBMITTED            │   ← .ipa → App Store Connect                   │
  │   │                       │      .aab → Play Console internal track        │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  WAITING FOR REVIEW   │   ← iOS: 1-3 days (subsequent) / 5-7 (first)  │
  │   │                       │      Android: 1-3 days typically               │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  IN REVIEW            │   ← Apple/Google reviewer tests with demo      │
  │   │                       │      account (§2.7 — apple-reviewer@buddysaradhi)  │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │       ┌──────┴──────┐                                                      │
  │       │             │                                                      │
  │    APPROVED      REJECTED                                                  │
  │       │             │                                                      │
  │       ▼             ▼                                                      │
  │   ┌──────────┐  ┌──────────────────────────────────────────────────────┐  │
  │   │ READY    │  │  REJECTION REASONS (§2.6 + §3.6 pitfalls)             │  │
  │   │ FOR      │  │   • ATT prompt missing (we don't track — N/A)         │  │
  │   │ RELEASE  │  │   • Missing privacy policy URL (we have one)          │  │
  │   │          │  │   • Demo/placeholder content (we ship functional)     │  │
  │   │  iOS:    │  │   • Crashes on launch (tested on 6 device/OS combos)  │  │
  │   │  Ready   │  │   • Login required, no demo (we provision reviewer)   │  │
  │   │  for     │  │   • Background modes declared but unused (only fetch) │  │
  │   │  Sale    │  │   • IAP not using StoreKit (no IAP in v1)             │  │
  │   │          │  │   • Data Safety form mismatches manifest (audited)    │  │
  │   │  And:    │  │   • Target API level too low (EAS handles)            │  │
  │   │  Promote │  └──────────────────────────────────────────────────────┘  │
  │   │  to prod│             │                                                │
  │   └─────┬────┘             ▼                                                │
  │         │             ┌──────────────────────┐                              │
  │         │             │  FIX + RESUBMIT       │   ← address rejection,     │
  │         │             │  (back to SUBMITTED)  │      bump build number,    │
  │         │             └──────────────────────┘      re-run eas build       │
  │         │                                                                   │
  │         ▼                                                                   │
  │   ┌──────────────────────┐                                                 │
  │   │  PHASED / STAGED      │   ← iOS: 1→2→5→10→20→50→100% over 7 days      │
  │   │  ROLLOUT              │      Android: 10→50→100% over 4 days           │
  │   │                       │      (§2.1 step 7 + §3.2 step 5)               │
  │   │  ↑ monitor crash rate │      (EAS dashboard + audit_log)               │
  │   │    < 0.5% target      │                                                │
  │   │  ↑ pause if P0 issue  │                                                │
  │   │    detected           │                                                │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  FULL ROLLOUT         │   ← 100% of users on the new version          │
  │   │  (RELEASE COMPLETE)   │      tag in Git: v1.5.0                       │
  │   │                       │      update worklog.md with release notes     │
  │   └──────────────────────┘                                                 │
  │                                                                            │
  │  ROLLBACK (§6 — per-store):                                                │
  │   ↑ iOS: NO per-version rollback button in App Store Connect.             │
  │     → OTA rollback first (JS-only regression, 06_EAS_Update §5).          │
  │     → Hotfix binary + expedited review for native regression (~24h).      │
  │   ↑ Android: YES per-version rollback via Play Console.                   │
  │     → Production track → Release history → select prior → Rollback.       │
  │     → Plus OTA rollback for JS-only regressions.                          │
  │   ↑ See §6.3 rollback decision matrix for full per-regression-type path.  │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The state machine is a process diagram, not a rendered UI surface —
     no glass tier annotation here (§6.6 single rule applies to live
     components only).
   ↑ Cross-refs: §2.1 + §2.6 + §3.2 + §3.6 + §6 (this file), 05_EAS_Build.md
     §2.3 (production profile + autoSubmit), 06_EAS_Update.md §5 (rollback
     playbook), product/04_Download_Hub.md (public surface that links to
     both stores), deployment/03 §9 (TestFlight + Play Internal Testing).
```

### 10.5 References (External Design Authorities)

The mockups and the store-release primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the screenshot grid, the Play Store listing anatomy, or the review-state machine.

- **Apple App Store Review Guidelines** — *Section 2 (Functionality), Section 4 (Design), Section 5 (Legal)*. The §2.6 review pitfalls and the §10.4 review-state machine follow Apple's App Store Review Guidelines.
- **Apple Developer** — *App Store Connect, TestFlight, Phased release, App Privacy labels*. The §2.1 first-submission flow, the §2.5 privacy labels, and the §10.2 screenshot grid follow Apple Developer's App Store Connect documentation.
- **Google Play Developer Policy** — *Data Safety form, Store listing, Staged rollout*. The §3.3 Data Safety form, the §3.4 Play Store listing, and the §3.2 staged rollout follow Google Play's Developer Policy Center.
- **Google Play Console** — *Release tracks, per-version rollback, App Integrity*. The §3.1 four-track release flow and the §6.2 Android per-version rollback follow Play Console documentation.
- **Expo docs** — *EAS Submit, auto-submit, credentials*. The §2.1 step-1 production build with `--auto-submit` follows Expo's EAS Submit documentation.
- **Smashing Magazine** — *App Store Optimization (ASO) for Indian SaaS*. The §2.4 description structure (first sentence as search-result headline) and the §3.4 short-description 80-char limit follow Smashing's ASO research.
- **CSS-Tricks** — *App Store screenshot generation with SmokeTestOS*. The §2.6 auto-generated screenshot practice (no manual Photoshop) follows CSS-Tricks's automated-screenshot primer.
- **Nielsen Norman Group** — *App Store listing UX*. The §10.2 screenshot grid ordering (hero → list → grid → fees → modal → settings) follows NN/g's app-store-listing UX research.

---

*End of 07 — App Store Release. Next file: `AGENTS.md` (mobile handoff instructions).*
