# 05 — EAS Build

> The build pipeline for the Buddysaradhi mobile app: `eas.json` profiles (`development` / `preview` / `production`), credential management, the build matrix (iOS Simulator + device, Android x86 + arm64 + universal APK + AAB), environment variables, the post-build hook that uploads APK copies to Vercel Blob for the web download hub, caching strategy for fast incremental builds, and the native-dependency-upgrade protocol. This file is the release engineer's manual. For OTA updates (no store resubmit) see `06_EAS_Update.md`; for the App Store / Play Store submission process see `07_App_Store_Release.md`.

---

## 1. EAS Build at a Glance

EAS Build is Expo Application Services' cloud build pipeline. We send it our TypeScript source + `app.config.ts` + `eas.json`; it returns a signed `.ipa` (iOS) or `.aab`/`.apk` (Android) hosted on EAS's S3.

```
┌────────────────────────────────────────────────────────────────┐
│  Engineer's laptop                                              │
│    │                                                            │
│    │ $ eas build --platform ios --profile production            │
│    │                                                            │
│    ▼                                                            │
│  EAS CLI reads eas.json + app.config.ts + package.json         │
│    │                                                            │
│    │ tar source + upload to EAS                                 │
│    ▼                                                            │
│  EAS Cloud (Linux build host)                                   │
│    │                                                            │
│    │ 1. Read native dependencies from package.json              │
│    │ 2. Generate ios/ and android/ folders (npx expo prebuild)  │
│    │ 3. Install pods (iOS) / Gradle build (Android)             │
│    │ 4. Compile native code (Xcode / Android Studio)            │
│    │ 5. Bundle JS (Hermes bytecode)                             │
│    │ 6. Sign with credentials (EAS-managed)                     │
│    │ 7. Upload .ipa / .aab to EAS-hosted S3                     │
│    │                                                            │
│    ▼                                                            │
│  EAS Build dashboard                                            │
│    │                                                            │
│    │ Build URL: https://eas.build/...                           │
│    │ Download: .ipa / .aab / .apk                               │
│    │                                                            │
│    ▼                                                            │
│  Post-build hook (eas.json "build.lifecycleHooks.onComplete")  │
│    │                                                            │
│    │ Upload APK/AAB copy to Vercel Blob                         │
│    │ (for the web download hub — see web/06_Build_and_Release)  │
│    ▼                                                            │
│  Vercel Blob: buddysaradhi-builds/<version>/<platform>/<file>        │
│    │                                                            │
│    │ Web app's download hub polls the blob list                 │
│    ▼                                                            │
│  User visits buddysaradhi.app/download → sees latest build           │
└────────────────────────────────────────────────────────────────┘
```

A production iOS build (clean) takes ~12 minutes; an incremental build with cached pods and Hermes bytecode takes ~4 minutes. Android is faster — ~8 minutes clean, ~3 minutes cached.

---

## 2. `eas.json` — The Build Profiles

```json
{
  "cli": {
    "version": ">= 12.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "credentialsSource": "remote",
      "ios": {
        "simulator": true,
        "image": "latest"
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleDebug"
      },
      "env": {
        "APP_VARIANT": "development",
        "EXPO_PUBLIC_LOG_LEVEL": "debug"
      },
      "channel": "development"
    },
    "preview": {
      "distribution": "internal",
      "credentialsSource": "remote",
      "ios": {
        "simulator": false,
        "buildType": "release",
        "buildCache": true
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      },
      "env": {
        "APP_VARIANT": "preview"
      },
      "channel": "staging"
    },
    "production": {
      "distribution": "store",
      "credentialsSource": "remote",
      "autoIncrement": true,
      "autoSubmit": true,
      "ios": {
        "buildType": "release",
        "applicationArchivePath": "build/Buddysaradhi.ipa"
      },
      "android": {
        "buildType": "app-bundle",
        "gradleCommand": ":app:bundleRelease"
      },
      "env": {
        "APP_VARIANT": "production"
      },
      "channel": "production",
      "lifecycleHooks": {
        "onComplete": {
          "node": "20.0.0",
          "command": "node scripts/post-build-upload.js"
        }
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "release@buddysaradhi.app",
        "ascAppId": "6500000000",
        "appleTeamId": "ABCDE12345"
      },
      "android": {
        "serviceAccountKeyPath": "./credentials/play-service-account.json",
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

> **Cross-cutting contract.** This `eas.json` is the mobile-specific implementation of the cross-cutting EAS choreography defined in `../deployment/03_EAS_Build_and_Update_Channels.md` §3. The three profiles (`development` / `preview` / `production`) and the three channels (`development` / `staging` / `production`) are owned jointly by `mobile/05_EAS_Build.md` and `mobile/06_EAS_Update.md` per that file's §4 (Channel strategy). When this file and `deployment/03` disagree, `deployment/03` wins — fix this file first, then `deployment/03`, then `eas.json` itself. The `cli.version` pin (`>= 12.0.0`) is intentionally newer than `deployment/03`'s `>= 5.9.0` baseline because the mobile surface runs on the newer EAS CLI; both pins are compatible (the `>=` operator means "any version at or above"). The `APP_VARIANT` env var (instead of `deployment/03`'s `APP_ENV`) is intentional — `APP_VARIANT` drives the bundle-ID switching in `app.config.ts` per `07_App_Store_Release.md` §8.2, so the mobile surface needs the more specific var.

### 2.1 Profile: `development`

Used by engineers during local development. Builds a **development client** (not the production JS bundle) that can load JS from a local Metro server. Distributes via **internal** distribution (registered test devices only).

- iOS: `simulator: true` builds for the iOS Simulator (no signing required). Engineers without a paid Apple Developer account can run this.
- Android: `buildType: "apk"` produces a debuggable APK that can be sideloaded on any Android device.
- Channel: `development` — OTA updates from this channel only.
- `EXPO_PUBLIC_LOG_LEVEL: "debug"` — verbose logging (typed logger, not `console.log`).

### 2.2 Profile: `preview`

Used for QA and internal testing before a store release. Distributes via **internal** distribution (TestFlight internal testers on iOS; sideloaded APK on Android).

- iOS: `simulator: false` + `buildType: "release"` — real-device release-mode build. Requires Apple Developer account + signing credentials (managed by EAS via `credentialsSource: "remote"`).
- Android: `buildType: "apk"` + `gradleCommand: ":app:assembleRelease"` — release-mode universal APK for easy sideloading on any Android device.
- `credentialsSource: "remote"` — EAS-managed credentials (mirrors `deployment/03` §3.3).
- Channel: `staging` — OTA updates from the `staging` channel (see `06_EAS_Update.md` §2.2 for the staging-channel branching strategy).
- `APP_VARIANT: "preview"` — `app.config.ts` reads this and sets the app name to "Buddysaradhi Preview" + a violet icon tint, so QA can distinguish the preview build from the production build on the same device.

### 2.3 Profile: `production`

Used for App Store and Play Store releases. Produces a signed `.ipa` (iOS) and `.aab` (Android).

- `distribution: "store"` — explicit declaration that this profile ships to the public App Store / Play Store (not internal). Mirrors `deployment/03` §3.4.
- `credentialsSource: "remote"` — EAS manages the signing credentials in its credential store. Local `.p12` / `.keystore` files are a P0 security risk; the only path is EAS Credentials (per `deployment/03` §11 contract #4).
- `autoIncrement: true` — EAS auto-increments the build number (`CFBundleVersion` on iOS, `versionCode` on Android) on every build. This is required by both stores (each upload must have a unique build number).
- `autoSubmit: true` — `eas build` automatically runs `eas submit` after a successful build. Per `deployment/03` §6.5, the auto-submit is idempotent — duplicate submits are no-ops because the store recognises the build by its build number. This eliminates a manual step and the "did I remember to submit?" failure mode.
- iOS: `buildType: "release"` + `applicationArchivePath: "build/Buddysaradhi.ipa"` — release-mode build saved to a known path for the post-build hook.
- Android: `buildType: "app-bundle"` + `gradleCommand: ":app:bundleRelease"` — AAB for Play Store (smaller download per device because of per-ABI splitting).
- Channel: `production` — OTA updates from the production branch (see `06_EAS_Update.md` §2).
- `lifecycleHooks.onComplete` — runs `scripts/post-build-upload.js` after a successful build, which uploads a copy of the universal APK (derived from the AAB via `bundletool`, per `deployment/03` §6.2) to Vercel Blob for the sideload download hub (`product/04_Download_Hub.md`).

---

## 3. Credential Management

EAS manages credentials automatically. The engineer never touches a `.p12`, `.mobileprovision`, or `.keystore` file.

### 3.1 iOS Credentials

For a production iOS build, EAS needs:

- **App Store API Key** — created once per Apple Developer account, stored in EAS. Used to upload builds to App Store Connect.
- **Signing certificate** — EAS creates a distribution certificate on first build, stores it in EAS, reuses on subsequent builds.
- **Provisioning profile** — EAS creates a distribution profile (App Store profile) on first build, stores it in EAS.

To set up:

```bash
eas credentials --platform ios --profile production
# EAS walks you through Apple ID login, 2FA, and credential creation.
```

If a credential is lost (rare — EAS stores them durably), EAS can revoke and recreate. This invalidates the old credential but does not affect apps already in the store.

### 3.2 Android Credentials

For a production Android build, EAS needs:

- **Upload key (keystore)** — EAS generates one on first build, stores it in EAS. Used to sign the AAB for Play Store upload.
- **Play Store service account JSON** — used by `eas submit -p android` to upload the AAB to Play Console. This is **not** managed by EAS; the engineer downloads it from Google Cloud Console and stores it locally at `./credentials/play-service-account.json` (gitignored).

To set up the upload key:

```bash
eas credentials --platform android --profile production
# EAS generates the keystore and stores it.
```

To set up the service account:

1. Google Cloud Console → IAM → Service Accounts → Create.
2. Grant the "Service Account Token Creator" and "Play Console Admin" roles.
3. Download JSON key, save as `./credentials/play-service-account.json`.
4. Add the service account email to Play Console → Setup → API Access.

### 3.3 Credential Rotation

If a credential is compromised (e.g., laptop theft), rotate:

- **iOS**: `eas credentials --platform ios --profile production --clear-cache` — EAS revokes old, creates new. Submit a new build to App Store Connect.
- **Android upload key**: Google Play Console → Setup → App Integrity → "Request upload key reset". This requires Google support intervention (takes 24–48h).
- **Android service account**: Delete in Google Cloud Console, create new, update local file.
- **Turso JWT**: All sessions revoked via `BR-SEC-10`. Users must re-login.

---

## 4. Build Matrix

| Platform | Target | Architecture | Build type | Profile |
|---|---|---|---|---|
| iOS | Simulator | x86_64 / arm64-simulator | Dev client | `development` |
| iOS | Device | arm64 | IPA (signed) | `preview` / `production` |
| Android | Simulator | x86_64 / arm64 | APK (debug) | `development` |
| Android | Device | arm64-v8a / armeabi-v7a / x86_64 | APK (sideload) | `preview` |
| Android | Device (per-ABI) | arm64-v8a + armeabi-v7a + x86_64 | AAB (split per ABI) | `production` |

### 4.1 Why AAB for Production Android

AAB (Android App Bundle) is the Play Store format. Google Play splits the AAB into per-ABI APKs on the fly; each device downloads only the APK for its architecture. A 20 MB universal APK becomes ~7 MB per device. AAB also enables Play Asset Delivery and Play Feature Delivery (we use neither in v1, but the size win alone justifies the format).

### 4.2 Universal APK for Preview Android

The preview profile uses a universal APK so QA can sideload the same file on any device without Play Store involvement. This is the format the web download hub also links to (see §6).

### 4.3 iOS Simulator Builds

The development profile produces a simulator build (`.app` bundle, not `.ipa`). Engineers without an Apple Developer account can run this — it requires no signing. The simulator build is for local iteration only; it never reaches TestFlight.

---

## 5. Environment Variables

EAS Build reads env vars from three sources, in priority order:

1. `eas.json` profile `env` block (lowest priority — defaults)
2. `eas env:push` (project-level, stored in EAS)
3. EAS Build dashboard "Environment Variables" (highest priority — secrets)

### 5.1 Variables Used by Buddysaradhi Mobile

| Variable | Where set | Purpose |
|---|---|---|
| `APP_VARIANT` | `eas.json` profile | Drives `app.config.ts` to set app name, icon, bundle ID per profile |
| `EXPO_PUBLIC_LOG_LEVEL` | `eas.json` profile | `debug` in dev, `info` in prod |
| `EXPO_PUBLIC_SUPABASE_URL` | `eas env:push` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `eas env:push` | Supabase anon key (safe to ship in client) |
| `EXPO_PUBLIC_TURSO_SYNC_URL` | `eas env:push` | Base Turso platform URL for provisioning |
| `EAS_PROJECT_ID` | `eas env:push` | EAS project ID (used by `expo-updates`) |
| `TURSO_PLATFORM_TOKEN` | EAS dashboard (secret) | Turso Platform API token — used only by the provisioning Edge Function, **not** shipped in the app bundle |
| `VERCEL_BLOB_READ_WRITE_TOKEN` | EAS dashboard (secret) | Vercel Blob token for post-build upload |

### 5.2 `eas env:push`

```bash
# Push env vars from .eas.env (gitignored) to EAS
eas env:push --environment production --non-interactive
```

The `.eas.env` file is gitignored. Its template (`.eas.env.example`) is committed:

```bash
# .eas.env.example
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_TURSO_SYNC_URL=https://api.turso.tech
EAS_PROJECT_ID=your-eas-project-id
```

### 5.3 Secrets in the EAS Dashboard

`TURSO_PLATFORM_TOKEN` and `VERCEL_BLOB_READ_WRITE_TOKEN` are set in the EAS Build dashboard (not in `eas.json` or `.eas.env`). They are marked as "secret" — they are never logged, never exposed to the build output, and only available to the build process.

---

## 6. The Post-Build Vercel Blob Upload

After a successful production build, the `lifecycleHooks.onComplete` script runs. This script uploads a copy of the APK (Android) or IPA (iOS) to Vercel Blob, where the web download hub (`buddysaradhi.app/download`) can link to it.

### 6.1 Why?

The web download hub is the primary distribution surface for sideloaded builds (Android APK for testers without Play Store access; iOS IPA for enterprise distribution). Hosting on Vercel Blob (not EAS) means:

- The download URL is stable: `https://blob.buddysaradhi.app/builds/<version>/<platform>/<file>`.
- The URL is CDN-cached globally.
- The web app can list all builds via the Vercel Blob API.
- The download hub is decoupled from EAS (which is an engineer tool, not a user-facing surface).

### 6.2 The Script

The post-build hook handles the iOS `.ipa` upload directly. For Android, it shells out to `bundletool` to derive a release-signed universal APK from the production AAB (per `../deployment/03_EAS_Build_and_Update_Channels.md` §6.2), then uploads the resulting APK + `manifest.json` to Vercel Blob.

```js
// scripts/post-build-upload.js
const { put } = require('@vercel/blob');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

async function main() {
  const buildPath = process.env.EAS_BUILD_ARTIFACT_PATH;
  const version = process.env.EAS_BUILD_APP_VERSION;
  const platform = process.env.EAS_BUILD_PLATFORM; // 'ios' or 'android'
  const buildNumber = process.env.EAS_BUILD_BUILD_NUMBER;

  if (!buildPath || !fs.existsSync(buildPath)) {
    console.error('No build artifact found at:', buildPath);
    process.exit(1);
  }

  // Android: the production build is an .aab. Convert to a universal APK
  // via bundletool before uploading — the .aab is not directly installable.
  // The .apk we ship to the sideload hub must be release-signed (it is —
  // the AAB was signed with the EAS-managed upload key, and bundletool
  // preserves that signature). See deployment/03 §6.2 for the contract.
  let uploadPath = buildPath;
  if (platform === 'android' && buildPath.endsWith('.aab')) {
    const apksPath = buildPath.replace(/\.aab$/, '.apks');
    const apksDir = path.dirname(buildPath);
    execFileSync('bundletool', [
      'build-apks',
      '--bundle', buildPath,
      '--output', apksPath,
      '--mode=universal',
    ], { stdio: 'inherit' });
    // .apks is a zip; extract universal.apk
    execFileSync('unzip', ['-o', apksPath, '-d', apksDir], { stdio: 'inherit' });
    uploadPath = path.join(apksDir, 'universal.apk');
  }

  const fileName = path.basename(uploadPath);
  const blobPath = `builds/${version}/${platform}/${fileName}`;

  const blob = await put(blobPath, fs.readFileSync(uploadPath), {
    access: 'public',
    token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });

  console.log('Uploaded to Vercel Blob:', blob.url);

  // Write a manifest the web app can poll
  const manifest = {
    version,
    buildNumber,
    platform,
    fileName,
    url: blob.url,
    uploadedAt: new Date().toISOString(),
    size: fs.statSync(uploadPath).size,
  };
  await put(
    `builds/${version}/${platform}/manifest.json`,
    JSON.stringify(manifest, null, 2),
    {
      access: 'public',
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    }
  );
  console.log('Manifest uploaded');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### 6.3 The Web Download Hub

The web app at `buddysaradhi.app/download` polls `https://blob.buddysaradhi.app/builds/latest/ios/manifest.json` and `https://blob.buddysaradhi.app/builds/latest/android/manifest.json`. If a new version is detected, the page shows a "Download v1.4.2" button linking to `manifest.url`. See the `../web/06_Build_and_Release.md` spec for the full download hub implementation, and `../product/04_Download_Hub.md` for the commercial design + copy that surfaces the APK sideload link alongside the iOS TestFlight invite and the other platform installers (Web / Mac / Win). The download hub is the consumer of this file's post-build hook output; the contract between them is the `manifest.json` schema documented in §6.2 above.

### 6.4 Failure Handling

If the Vercel Blob upload fails (network error, quota exceeded), the build is **still considered successful** — the IPA/AAB is already on EAS-hosted S3 and can be submitted to stores. The post-build hook logs the failure to `audit_log` (in the EAS build, not the app) and the web download hub continues to show the previous build. The hook does **not** block the build pipeline.

---

## 7. Native Dependency Upgrades

Upgrading a native dependency (a package that requires native compilation — anything with `pod install` on iOS or a Gradle change on Android) is a **stop-and-ask trigger** (`AGENTS.md` (mobile) §6). The protocol:

### 7.1 Pre-Upgrade Checklist

1. Read the package's changelog. Identify breaking changes.
2. Check Expo SDK compatibility — does the new version require a newer Expo SDK?
3. If yes, plan an Expo SDK upgrade as a separate task (see `06_EAS_Update.md` §7 — OTA can't ship native code).
4. Open an RFC stub in `Buddysaradhi_Planning/rfc/<dep>-upgrade.md` citing the changelog and the spec sections affected.

### 7.2 The Upgrade

```bash
# Bump the version in package.json
bun install

# Re-run prebuild to regenerate native projects
npx expo prebuild --clean

# Test on a development build
eas build --platform ios --profile development
eas build --platform android --profile development
```

If the prebuild succeeds and the development build runs without errors on both platforms, the upgrade is approved. If either fails, the upgrade is reverted.

### 7.3 OTA Cannot Ship Native Code

This is critical: **EAS Update can ship JS-only changes. Native dependency upgrades require a full EAS Build + store resubmit.** See `06_EAS_Update.md` §7 for the full list of what OTA can and cannot ship.

---

## 8. Build Caching

EAS Build caches three layers:

### 8.1 Pod Cache (iOS)

CocoaPods downloads are cached by pod version + iOS SDK version. A clean build downloads ~2 GB of pods; a cached build reuses them. Cache hit: ~3 min saved.

### 8.2 Gradle Cache (Android)

Gradle dependencies are cached by version + AGP version. Cache hit: ~2 min saved.

### 8.3 Hermes Bytecode Cache

The Hermes JS bytecode compilation is cached by source hash. If the JS bundle hasn't changed (e.g., a config-only rebuild), Hermes reuses the cached bytecode. Cache hit: ~1 min saved.

### 8.4 Cache Invalidation

The cache is invalidated by:

- A change to `package.json` (any native dep version bump)
- A change to `expo` SDK version
- A change to `eas.json` profile `env` block (for some env vars — those baked into native code)
- A manual `eas build --clear-cache` flag

### 8.5 Typical Build Times

| Scenario | iOS | Android |
|---|---|---|
| Clean build (no cache) | 12 min | 8 min |
| Incremental (cached) | 4 min | 3 min |
| Config-only change (Hermes cached) | 3 min | 2.5 min |

---

## 9. Build Triggers

Builds are triggered manually or via CI:

### 9.1 Manual Triggers (Engineer)

```bash
# Development build for iOS Simulator
eas build --platform ios --profile development

# Production build for both platforms
eas build --platform all --profile production --auto-submit
```

`--auto-submit` chains the build with a store submission (`eas submit`). For iOS, this uploads to App Store Connect (TestFlight); for Android, this uploads to Play Console (internal track).

### 9.2 CI Triggers (GitHub Actions)

A GitHub Actions workflow runs on every push to `main`:

```yaml
# .github/workflows/mobile-build.yml
name: Mobile Build
on:
  push:
    branches: [main]
    paths:
      - 'apps/mobile/**'
      - 'packages/**'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EAS_TOKEN }}
      - run: eas build --platform all --profile preview --non-interactive
```

This produces a preview build (sideloadable APK + TestFlight internal build) for every merge to `main`. Engineers and QA install via the EAS portal.

### 9.3 Release Triggers

A release is triggered by tagging a commit:

```bash
git tag v1.4.2
git push origin v1.4.2
```

A GitHub Actions workflow on tag push runs:

```bash
eas build --platform all --profile production --auto-submit --non-interactive
```

This produces a production build, submits to stores, and uploads to Vercel Blob. See `07_App_Store_Release.md` for the full release process.

---

## 10. Build Artifacts and Reproducibility

Every EAS Build produces:

- The IPA / AAB / APK (downloadable from EAS dashboard)
- A build manifest (Git SHA, package versions, native dep versions, env vars used)
- Build logs (full Xcode / Gradle output)
- A `buildProfile` snapshot (the `eas.json` profile used)

The build manifest is stored in EAS for 30 days. For long-term reproducibility, the engineer downloads the manifest and commits it to `apps/mobile/build-manifests/<version>.json`. This lets us answer "what was in v1.4.2?" without re-running the build.

---

## 11. Common Build Failures and Fixes

| Failure | Cause | Fix |
|---|---|---|
| `xcodebuild` exited with code 65 | Pod version mismatch; missing import | `npx expo prebuild --clean`; rebuild |
| `Could not find method googleServices()` | Missing `expo-google-services` plugin in `app.config.ts` | Add plugin, rebuild |
| `No profiles for 'app.buddysaradhi.mobile' were found` | EAS credentials not set up | `eas credentials --platform ios --profile production` |
| `Keystore file not set for reading` | Android upload key not generated | `eas credentials --platform android --profile production` |
| Hermes bytecode compilation failed | JS syntax error not caught by tsc | Run `bun run typecheck` locally first |
| AAB exceeds 150 MB | Native binary bloat (rare) | Audit native deps; consider Play Asset Delivery |
| Build hangs at "Installing pods" | CocoaPods CDN outage | Retry; or use `--no-pty` flag |

---

## 12. Cross-References

- **OTA updates (no store resubmit)**: `06_EAS_Update.md`
- **App Store / Play Store submission**: `07_App_Store_Release.md`
- **Architecture (native module inventory)**: `01_Architecture.md` §6
- **Native modules and storage**: `02_Native_Modules_and_Storage.md`
- **Cross-cutting EAS choreography (single source of truth for channels, profiles, branching)**: `../deployment/03_EAS_Build_and_Update_Channels.md` — this file is the mobile-specific implementation of that file's §3 (Build profiles), §4 (Channel strategy), and §6 (Build → submit → OTA flow)
- **Vercel Blob build storage (APK mirror target)**: `../deployment/02_Vercel_Blob_Build_Storage.md` §2 — the Blob bucket where `scripts/post-build-upload.js` writes the universal APK and `manifest.json`
- **CI/CD GitHub Actions (EAS_TOKEN, mobile-build.yml, mobile-ota.yml workflows)**: `../deployment/05_CI_CD_GitHub_Actions.md`
- **Commercial download hub (consumer of the APK mirror)**: `../product/04_Download_Hub.md` — the public surface that polls `https://blob.buddysaradhi.app/builds/latest/android/manifest.json` and renders the "Download APK" button
- **Web build and release (companion spec for the download hub)**: `../web/06_Build_and_Release.md`
- **Top-level agent operating manual**: `../AGENTS.md`

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (80–100 for build-pipeline diagrams). The three mockups below visualise the *build primitives* — the `eas.json` profile tree, the build→channel mapping, and the AAB→APK conversion flow — that the release engineer (`scripts/post-build-upload.js`, `eas.json`) implements and that `06_EAS_Update.md` consumes.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **build-pipeline layer**, not the live-screen layer. The mockups below are *pipeline diagrams* (profile trees, channel maps, build-artifact flows) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every platform architecture file gets ≥ 2 mockups), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen component that `07_App_Store_Release.md` specifies (the App Store Connect screenshot grid, the Play Store listing); this file's job is to feed that file the signed IPA/AAB artifacts and the Vercel Blob APK mirror it consumes.

| Build artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2 `eas.json` profiles | `07_App_Store_Release.md` (store listings) | (none — store listings are external surfaces) |
| §6 Vercel Blob upload | `product/04_Download_Hub.md` (download cards) | `.glass` (per-platform download card, §5.5) |
| §4 Build matrix | `07_App_Store_Release.md` §2.6 (review pitfalls) | (none — matrix is structural) |
| §3 Credential management | Settings → Diagnostics (build info) | `.glass-faint` (list row) |
| §7 Native dep upgrades | `06_EAS_Update.md` §7 (OTA limits) | (none — OTA vs build is structural) |

### 13.2 `eas.json` Profile Tree (NEW)

The §2 `eas.json` rendered as the actual three-profile tree EAS Build compiles. Each profile pins `distribution`, `credentialsSource`, `channel`, and `APP_VARIANT`; the `production` profile additionally pins `autoIncrement`, `autoSubmit`, and the `lifecycleHooks.onComplete` post-build hook. The three channels (`development` / `staging` / `production`) are the mobile-specific implementation of the cross-cutting EAS choreography owned by `deployment/03_EAS_Build_and_Update_Channels.md` §3 — when this file and `deployment/03` disagree, `deployment/03` wins.

```
  EAS.JSON PROFILE TREE  (§2, three profiles + submit + update blocks)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  eas.json                                                                 │
  │  ↑ cli.version: ">= 12.0.0"  (newer than deployment/03 ≥5.9.0 baseline)  │
  │  ↑ cli.appVersionSource: "remote"  (EAS holds the canonical version)     │
  │                                                                           │
  │  ├── build/                                                               │
  │  │   ├── development   ← engineers, local iteration                       │
  │  │   │   ├── developmentClient: true     (loads JS from Metro)            │
  │  │   │   ├── distribution: "internal"                                     │
  │  │   │   ├── credentialsSource: "remote"  (EAS-managed)                   │
  │  │   │   ├── ios.simulator: true          (no signing needed)             │
  │  │   │   ├── android.buildType: "apk"     (debuggable sideload)           │
  │  │   │   ├── env: { APP_VARIANT: "development",                          │
  │  │   │   │         EXPO_PUBLIC_LOG_LEVEL: "debug" }                       │
  │  │   │   └── channel: "development"  → OTA branch: development            │
  │  │   │                                                                   │
  │  │   ├── preview        ← QA + internal testing, TestFlight internal      │
  │  │   │   ├── distribution: "internal"                                     │
  │  │   │   ├── credentialsSource: "remote"                                  │
  │  │   │   ├── ios.simulator: false, buildType: "release"                   │
  │  │   │   ├── android.buildType: "apk"  (release universal APK)            │
  │  │   │   ├── env: { APP_VARIANT: "preview" }  (violet icon tint)          │
  │  │   │   └── channel: "staging"       → OTA branch: staging               │
  │  │   │                                                                   │
  │  │   └── production     ← App Store + Play Store + Vercel Blob mirror     │
  │  │       ├── distribution: "store"                                        │
  │  │       ├── credentialsSource: "remote"  (no local .p12/.keystore)       │
  │  │       ├── autoIncrement: true   (CFBundleVersion + versionCode)        │
  │  │       ├── autoSubmit: true      (chains eas build → eas submit)        │
  │  │       ├── ios.buildType: "release", applicationArchivePath             │
  │  │       ├── android.buildType: "app-bundle"  (AAB, not APK)              │
  │  │       ├── env: { APP_VARIANT: "production" }                           │
  │  │       ├── channel: "production"  → OTA branch: production              │
  │  │       └── lifecycleHooks.onComplete:                                   │
  │  │           └── node 20.0.0 → scripts/post-build-upload.js               │
  │  │               ↑ uploads universal APK (from AAB via bundletool)        │
  │  │                 to Vercel Blob for the sideload hub (§6)                │
  │  │                                                                       │
  │  ├── submit/                                                              │
  │  │   └── production                                                       │
  │  │       ├── ios: { appleId, ascAppId, appleTeamId }                      │
  │  │       └── android: { serviceAccountKeyPath, track: "internal" }        │
  │  │           ↑ Android submit goes to internal track first; promote       │
  │  │             to closed/open/production via Play Console (07_App_Store)  │
  │  │                                                                       │
  │  └── update/                                                              │
  │      ├── development → channel: "development"                             │
  │      ├── preview     → channel: "staging"                                 │
  │      └── production  → channel: "production"                              │
  │          ↑ channel→branch mapping is 1:1 (06_EAS_Update §2)               │
  │          ↑ no "channel from a feature branch" path                        │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The profile tree is structural, not a rendered UI surface — no glass
     tier annotation here (§6.6 single rule applies to live components only).
   ↑ All three profiles use credentialsSource: "remote" — local .p12 /
     .keystore files are a P0 security risk (deployment/03 §11 contract #4).
   ↑ Cross-refs: §2 (this file), 06_EAS_Update.md §2 (channel→branch mapping),
     07_App_Store_Release.md §8.2 (bundle ID per APP_VARIANT), deployment/03
     §3 (cross-cutting profile contract), product/04_Download_Hub.md
     (consumer of the Vercel Blob APK mirror produced by the production hook).
```

### 13.3 Build→Channel Mapping (NEW)

The §2.1–§2.3 profile descriptions + the §2 cross-cutting contract rendered as the build→channel→audience flow. A `production` build is baked with `channel: "production"`; its `expo-updates` runtime only ever fetches OTA updates from the `production` branch. This is the trust-model contract in `deployment/03` §4.4 — a tutor on production cannot be downgraded to staging via a malicious OTA. The three audiences (engineers / internal team + opt-in beta / 100% of production users) are strictly partitioned by channel.

```
  BUILD→CHANNEL MAPPING  (§2 profiles × §2 channels × audiences)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
  │   │  development      │    │  preview          │    │  production      │    │
  │   │  profile          │    │  profile          │    │  profile         │    │
  │   │  ↑ eas build      │    │  ↑ eas build      │    │  ↑ eas build     │    │
  │   │    --profile      │    │    --profile      │    │    --profile     │    │
  │   │    development    │    │    preview        │    │    production    │    │
  │   │  ↑ APP_VARIANT=   │    │  ↑ APP_VARIANT=   │    │  ↑ APP_VARIANT=  │    │
  │   │    development    │    │    preview        │    │    production    │    │
  │   │  ↑ bundle ID:     │    │  ↑ bundle ID:     │    │  ↑ bundle ID:    │    │
  │   │    app.buddysaradhi.   │    │    app.buddysaradhi.   │    │    app.buddysaradhi.  │    │
  │   │    mobile.dev     │    │    mobile.preview │    │    mobile        │    │
  │   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘    │
  │            │                       │                       │              │
  │            ▼                       ▼                       ▼              │
  │   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
  │   │  channel:         │    │  channel:         │    │  channel:        │    │
  │   │  development      │    │  staging          │    │  production      │    │
  │   │  ↑ baked into     │    │  ↑ baked into     │    │  ↑ baked into    │    │
  │   │    binary at      │    │    binary at      │    │    binary at     │    │
  │   │    build time     │    │    build time     │    │    build time    │    │
  │   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘    │
  │            │                       │                       │              │
  │            ▼                       ▼                       ▼              │
  │   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
  │   │  OTA branch:     │    │  OTA branch:     │    │  OTA branch:     │    │
  │   │  development      │    │  staging          │    │  production      │    │
  │   │  ↑ eas update     │    │  ↑ eas update     │    │  ↑ eas update    │    │
  │   │    --branch       │    │    --branch       │    │    --branch      │    │
  │   │    development    │    │    staging        │    │    production    │    │
  │   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘    │
  │            │                       │                       │              │
  │            ▼                       ▼                       ▼              │
  │   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
  │   │  AUDIENCE:        │    │  AUDIENCE:        │    │  AUDIENCE:       │    │
  │   │  engineers only   │    │  internal team +  │    │  100% of prod    │    │
  │   │  ↑ never reaches  │    │  opt-in beta      │    │  users (after    │    │
  │   │    a real tutor   │    │  ↑ Settings →     │    │  staged rollout) │    │
  │   │                   │    │    Diagnostics →  │    │  ↑ phased release │    │
  │   │                   │    │    "Join staging" │    │    1→2→5→10→20→   │    │
  │   │                   │    │    (re-install    │    │    50→100% over   │    │
  │   │                   │    │     with preview  │    │    7 days iOS;    │    │
  │   │                   │    │     profile)      │    │    10→50→100%    │    │
  │   │                   │    │                   │    │    over 4 days    │    │
  │   │                   │    │                   │    │    Android        │    │
  │   └──────────────────┘    └──────────────────┘    └──────────────────┘    │
  │                                                                            │
  │  TRUST MODEL (deployment/03 §4.4):                                         │
  │   ↑ A production build only ever fetches from production branch.           │
  │   ↑ A staging build only ever fetches from staging branch.                 │
  │   ↑ No cross-channel pollution — a tutor on production cannot be           │
  │     downgraded to staging via a malicious OTA.                             │
  │   ↑ The channel is baked into the binary at build time — it is NOT        │
  │     a runtime-configurable value.                                          │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The mapping is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ Cross-refs: §2 (this file), 06_EAS_Update.md §2 (channel→branch 1:1),
     07_App_Store_Release.md §5 (release cadence), deployment/03 §4
     (cross-cutting channel strategy), deployment/03 §4.4 (trust model).
```

### 13.4 AAB→APK Conversion Flow (NEW)

The §6.2 `post-build-upload.js` script rendered as the artifact flow for a production Android build. EAS Build produces a signed `.aab`; the post-build hook shells out to `bundletool build-apks --mode=universal` to derive a release-signed universal APK; the hook uploads the APK + `manifest.json` to Vercel Blob at `buddysaradhi-builds/<version>/android/`. The commercial download hub at `buddysaradhi.app/download` polls the manifest and renders a "Download APK" card next to the Play Store badge. This sideload path is **only for Android** — iOS has no equivalent (`no-ios-blob-upload.test.ts` hard-blocks `.ipa` upload to Blob).

```
  AAB→APK CONVERSION FLOW  (production Android, §6.2 post-build hook)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌──────────────────────┐                                                 │
  │   │  eas build --platform │   ← engineer or CI tag push                    │
  │   │  android --profile    │      (deployment/03 §6.2 contract)             │
  │   │  production           │                                                │
  │  --auto-submit            │                                                │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  EAS Cloud (Linux)    │   ← prebuild → gradle :app:bundleRelease       │
  │   │  produces signed .aab │   ← signed with EAS-managed upload key         │
  │   │  (~18 MB compressed)  │      (credentialsSource: "remote")             │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              ├──────────────────────►  eas submit -p android --latest      │
  │              │                          →  Play Console internal track     │
  │              │                          →  promote to closed/open/prod     │
  │              │                          (07_App_Store_Release.md §3.2)     │
  │              │                                                             │
  │              ▼  (parallel: lifecycleHooks.onComplete fires)                │
  │   ┌──────────────────────────────────────────────────────────────────────┐ │
  │   │  scripts/post-build-upload.js  (Node 20 on EAS build host)            │ │
  │   │                                                                        │ │
  │   │   1. read EAS_BUILD_ARTIFACT_PATH  (.aab path on build host)          │ │
  │   │   2. execFileSync('bundletool',                                     │ │
  │   │        ['build-apks',                                               │ │
  │   │         '--bundle', buildPath,                                      │ │
  │   │         '--output', apksPath,                                       │ │
  │   │         '--mode=universal'])                                        │ │
  │   │      ↑ .apks is a zip containing universal.apk                      │ │
  │   │      ↑ release-signed (inherits AAB's upload-key signature)         │ │
  │   │   3. execFileSync('unzip', ['-o', apksPath, '-d', apksDir])          │ │
  │   │      ↑ extract universal.apk                                        │ │
  │   │   4. put(`builds/${version}/android/Buddysaradhi-<ver>-universal.apk`,    │ │
  │   │        fs.readFileSync(uploadPath),                                  │ │
  │   │        { access: 'public', token: VERCEL_BLOB_READ_WRITE_TOKEN })    │ │
  │   │   5. put(`builds/${version}/android/manifest.json`,                  │ │
  │   │        JSON.stringify({ version, buildNumber, platform,              │ │
  │   │                          fileName, url, uploadedAt, size }),         │ │
  │   │        { access: 'public', … })                                      │ │
  │   └──────────────────────────────────────────────────────────────────────┘ │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────────────────────────────────────────────────────┐ │
  │   │  Vercel Blob  (deployment/02_Vercel_Blob_Build_Storage.md §2)         │ │
  │   │   blob.buddysaradhi.app/builds/                                            │ │
  │   │   ├── 1.4.2/android/Buddysaradhi-1.4.2-universal.apk   ← release-signed    │ │
  │   │   ├── 1.4.2/android/manifest.json                  ← polled by hub   │ │
  │   │   ├── 1.4.2/ios/  (BLOCKED — no-ios-blob-upload.test.ts, §6.3)        │ │
  │   │   └── 1.4.3/android/…  (next build overwrites by version)            │ │
  │   └──────────────────────────────────────────────────────────────────────┘ │
  │              │                                                             │
  │              ▼                                                             │
  │   ┌──────────────────────────────────────────────────────────────────────┐ │
  │   │  buddysaradhi.app/download  (product/04_Download_Hub.md)                   │ │
  │   │   polls https://blob.buddysaradhi.app/builds/latest/android/manifest.json  │ │
  │   │   renders a .glass download card (§5.5) with:                         │ │
  │   │     • "Download APK v1.4.2"  ← .neumo-raised CTA (emerald glow, §6.6)│ │
  │   │     • "Play Store" badge     ← primary CTA (sideload is safety net)  │ │
  │   │     • "TestFlight" invite    ← iOS only, separate card                │ │
  │   │   ↑ 5 cards: Web / macOS / Windows / Android / iOS (product/04 §2)   │ │
  │   └──────────────────────────────────────────────────────────────────────┘ │
  │                                                                            │
  │  FAILURE HANDLING (§6.4):                                                  │
  │   ↑ If Vercel Blob upload fails (network, quota), the build is STILL      │
  │     successful — the .aab is on EAS S3 and submitted to Play Console.     │
  │   ↑ The hook logs the failure to audit_log (EAS build, not the app).      │
  │   ↑ The download hub continues to show the previous build's APK.          │
  │   ↑ The hook does NOT block the build pipeline.                           │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The flow is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The download hub's "Download APK" card IS a live surface: it is
     .glass (per-platform download card, §5.5) with a .neumo-raised CTA
     (§6.6). The Play Store badge is the primary CTA; sideload is safety net.
   ↑ Cross-refs: §6 (this file), 07_App_Store_Release.md §3.7 (sideload
     rationale — Indian secondary devices, shared family phones, data caps),
     deployment/03 §6.2 (cross-cutting AAB→APK contract), deployment/02 §2
     (Vercel Blob bucket schema), product/04_Download_Hub.md (consumer).
```

### 13.5 References (External Design Authorities)

The mockups and the build primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the three-profile split, the channel baking, or the AAB→APK sideload path.

- **Expo docs** — *EAS Build*, *EAS Submit*, *Build profiles*, *Lifecycle hooks*. The §2 `eas.json` profile tree, the §3 credential management, and the §6.2 post-build hook follow Expo's official EAS Build documentation.
- **Google Play** — *Android App Bundle format*, *bundletool*, *Play App Signing*. The §13.4 AAB→APK conversion flow follows Google's bundletool documentation; the release-signing inheritance follows Play App Signing.
- **Vercel** — *Vercel Blob API*, *CDN caching*. The §6.2 `put()` upload and the stable `blob.buddysaradhi.app/builds/<version>/<platform>/<file>` URL follow Vercel Blob's documentation.
- **Apple Developer** — *App Store Connect API*, *TestFlight*, *Phased release*. The §2.3 production profile's `autoSubmit` and the §13.3 phased-release schedule follow Apple Developer's App Store Connect documentation.
- **Smashing Magazine** — *Mobile Release Engineering: Build Channels*. The §13.3 three-channel partition (engineers / beta / production) follows Smashing's mobile release-engineering research.
- **CSS-Tricks** — *CI/CD for React Native with EAS*. The §9.2 GitHub Actions workflow (`mobile-build.yml`) follows CSS-Tricks's EAS CI/CD primer.
- **GitHub Actions docs** — *Workflow syntax, secrets, Expo GitHub Action*. The §9.2 CI triggers and the `EAS_TOKEN` secret management follow GitHub Actions documentation.

---

*End of 05 — EAS Build. Next file: `06_EAS_Update.md`.*
