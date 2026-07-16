# 06 — Build & Release (Web + Vercel Blob Download Hub)

> The web build itself is deployed by Vercel (covered in `05_Deployment_Vercel.md`). But the web app also serves as the **download hub** for Desktop installers (`.msi` / `.dmg` / `.AppImage`) and Mobile side-load APKs (the `.ipa` is TestFlight-only — see `mobile/05_EAS_Build.md`). This file is the contract for the build artifacts, the Vercel Blob bucket layout, the manifest schema, the SHA-256 verification, and the retention policy. The marketing spec for the download hub — the copy on the five DownloadCards, the persona narratives, the "recommended for your device" logic intent — lives in `product/04_Download_Hub.md` (the WHAT). The implementation spec for the download hub as it renders on the commercial landing page lives in `07_Landing_Page.md §6` (the HOW). This file is the build/release plumbing between them: the artifacts the marketing spec sells and the implementation spec renders.

---

## 1. Scope

This file covers three things:

1. **The web build artifact** — what Vercel produces when `bun run build` runs. (Brief; the deep dive is in `05_Deployment_Vercel.md`.)
2. **Vercel Blob storage** — the bucket layout for Desktop/Mobile installer artifacts + manifests + changelogs.
3. **The Desktop updater** — how the Tauri app polls the manifest, downloads from Blob, verifies SHA-256, and applies the update via `tauri-plugin-updater`.

It does **not** cover:
- Mobile OTA updates via EAS Update (see `mobile/06_EAS_Update.md`).
- Desktop build internals (Rust, Tauri config — see `desktop/`).
- Mobile build internals (EAS Build, Expo — see `mobile/`).

---

## 2. The Web Build Artifact

### 2.1 What Vercel Produces

`bun run build` (the `package.json` build script) runs:

```bash
next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
```

The output is a self-contained `.next/standalone/` directory:

```
.next/standalone/
├── server.js                # Node server entry point
├── .next/
│   ├── static/              # JS chunks, CSS, fonts (copied by the script)
│   │   ├── chunks/
│   │   ├── css/
│   │   └── media/
│   ├── server/              # RSC bundles (server-only)
│   └── BUILD_ID             # build hash for cache-busting
├── public/                  # static files at the root
│   ├── favicon.ico
│   ├── robots.txt
│   └── manifest.json        # PWA manifest
├── node_modules/            # only the prod deps (tree-shaken)
└── package.json
```

On Vercel, this is largely cosmetic (Vercel uses its own Next.js adapter and `.next/` directly). On self-hosted (Droplet, fly.io, Raspberry Pi), `node .next/standalone/server.js` runs the app.

### 2.2 Build Output Sizes (Target)

| Asset | Target | Notes |
|---|---|---|
| First-load JS on `/` (marketing) | ≤ 90 KB gzipped | No TanStack, no Zustand, no Recharts. |
| First-load JS on `/dashboard` | ≤ 180 KB gzipped | TanStack + Zustand + Recharts + Framer. |
| First-load CSS | ≤ 30 KB gzipped | Tailwind purged to used classes only. |
| Fonts (Inter 400/600) | ≤ 38 KB | `next/font/google` subset + `display: swap`. |
| Total `/dashboard` first-load | ≤ 350 KB | JS + CSS + fonts + HTML. |

The lint rule `bundle-budget-guard` (in `eslint.config.js`) fails CI if the `/dashboard` first-load JS exceeds 180 KB.

### 2.3 Build Verification

Every Vercel build runs (in order):

1. `bun run lint` — ESLint + Prettier + design-system rules.
2. `bun run typecheck` — `tsc --noEmit`.
3. `next build` — the actual build.
4. (Vercel) Post-build: `@next/bundle-analyzer` runs if `ANALYZE=true` is set; output uploaded as a build artifact.
5. (Vercel) Post-deploy smoke test: `/api/cron/post-deploy-smoke` (production only) — agent-browser hits `https://buddysaradhi.app/`, asserts 200, screenshots the dashboard.

A failure at any step blocks the deploy.

---

## 3. Vercel Blob Storage — Bucket Layout

The web app is also the **download hub** for cross-platform installers. Vercel Blob Storage (`@vercel/blob`) hosts the binaries. The bucket layout:

```
blob://buddysaradhi-releases/
├── desktop/
│   ├── windows/
│   │   ├── Buddysaradhi-Setup-1.0.0-x64.msi
│   │   ├── Buddysaradhi-Setup-1.0.1-x64.msi
│   │   └── Buddysaradhi-Setup-1.1.0-x64.msi
│   ├── macos/
│   │   ├── Buddysaradhi-1.0.0-universal.dmg
│   │   ├── Buddysaradhi-1.0.0-universal.dmg.sig
│   │   └── Buddysaradhi-1.1.0-universal.dmg
│   └── linux/
│       ├── Buddysaradhi-1.0.0-x86_64.AppImage
│       └── Buddysaradhi-1.1.0-x86_64.AppImage
├── mobile/
│   ├── android/
│   │   ├── Buddysaradhi-1.0.0-universal.apk
│   │   └── Buddysaradhi-1.1.0-universal.apk
│   └── ios/
│       └── Buddysaradhi-1.0.0.ipa          (TestFlight only — NOT public)
├── manifests/
│   ├── desktop-stable.json
│   ├── desktop-staging.json
│   ├── mobile-stable.json
│   └── mobile-staging.json
└── changelogs/
    ├── 1.0.0.md
    ├── 1.0.1.md
    └── 1.1.0.md
```

### 3.1 Naming Convention

- **Desktop Windows:** `Buddysaradhi-Setup-{version}-x64.msi` — produced by Tauri's `bundle.targets: ["msi"]`.
- **Desktop macOS:** `Buddysaradhi-{version}-universal.dmg` — produced by Tauri's `bundle.targets: ["dmg"]` with `bundle.macOS.signingIdentity`. The `.dmg.sig` is the minisign signature produced by `tauri-plugin-updater`'s signing key (separate from the Apple Developer ID signature).
- **Desktop Linux:** `Buddysaradhi-{version}-x86_64.AppImage` — produced by Tauri's `bundle.targets: ["appimage"]`.
- **Mobile Android:** `Buddysaradhi-{version}-universal.apk` — produced by EAS Build with `buildType: "apk"`, `android.arch: "universal"`.
- **Mobile iOS:** `Buddysaradhi-{version}.ipa` — produced by EAS Build with `buildType: "release"`. This file is **never** published to Blob's public path; it's uploaded to App Store Connect via `eas submit`. The Blob entry here is a placeholder for emergency sideload via Apple Configurator (rare; not linked from `/download`).

### 3.2 Version Numbering

- **Stable channel:** `MAJOR.MINOR.PATCH` (semver). E.g. `1.0.0`, `1.0.1`, `1.1.0`.
- **Staging channel:** `MAJOR.MINOR.PATCH-rc.N` (semver pre-release). E.g. `1.1.0-rc.3`.
- **Build metadata:** The Desktop `.msi`/`.dmg`/`.AppImage` carry an embedded `version` (from `tauri.conf.json` `version` field) and a `buildNumber` (CI-incremented). The `buildNumber` is for engineering tracking; the user-facing version is semver only.

---

## 4. The Manifest Schema

Each manifest file (`desktop-stable.json`, `desktop-staging.json`, `mobile-stable.json`, `mobile-staging.json`) is the **single source of truth** for "what's the latest version?" The Desktop app polls this on launch; the Mobile app does NOT poll this (it uses EAS Update's `update.json` — see `mobile/06_EAS_Update.md`).

### 4.1 Full Schema Example — `desktop-stable.json`

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "platform": "desktop",
  "version": "1.1.0",
  "pubDate": "2025-09-15T10:30:00Z",
  "minimumAutoUpdateFrom": "1.0.0",
  "platforms": {
    "windows": {
      "url": "https://public.blob.vercel-storage.com/desktop/windows/Buddysaradhi-Setup-1.1.0-x64.msi",
      "sha256": "a3f5e8b9c1d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
      "sizeBytes": 14233600,
      "signature": "-----BEGIN MINISIGN SIGNATURE-----\n..."
    },
    "macos": {
      "url": "https://public.blob.vercel-storage.com/desktop/macos/Buddysaradhi-1.1.0-universal.dmg",
      "sha256": "b4f6e9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
      "sizeBytes": 15643648,
      "signature": "-----BEGIN MINISIGN SIGNATURE-----\n..."
    },
    "linux": {
      "url": "https://public.blob.vercel-storage.com/desktop/linux/Buddysaradhi-1.1.0-x86_64.AppImage",
      "sha256": "c5f7e0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "sizeBytes": 13894656,
      "signature": "-----BEGIN MINISIGN SIGNATURE-----\n..."
    }
  },
  "notesUrl": "https://public.blob.vercel-storage.com/changelogs/1.1.0.md",
  "notesExcerpt": "### Added\n- WhatsApp deep-link reminder cards on Dashboard.\n\n### Fixed\n- Receipt PDF font rendering on Windows.",
  "critical": false,
  "forceUpdateBefore": null
}
```

### 4.2 Field Definitions

| Field | Type | Purpose |
|---|---|---|
| `schemaVersion` | `number` | Always `1`. Bumped on schema change (forward-only; old clients ignore unknown fields). |
| `channel` | `"stable" \| "staging"` | The release channel. |
| `platform` | `"desktop" \| "mobile"` | The platform family. |
| `version` | `string` | Semver (e.g. `1.1.0`) or pre-release (`1.1.0-rc.3`). |
| `pubDate` | `string` (ISO 8601) | When this version was published. |
| `minimumAutoUpdateFrom` | `string` | The minimum version that can auto-update to this one. Older versions must do a fresh install (the Tauri updater refuses to apply a delta if it crosses an incompatible boundary). |
| `platforms.{windows,macos,linux}.url` | `string` | The Vercel Blob URL. |
| `platforms.{...}.sha256` | `string` | The SHA-256 hash of the binary. Verified after download before apply. |
| `platforms.{...}.sizeBytes` | `number` | File size; used to show download progress. |
| `platforms.{...}.signature` | `string` | Minisign signature produced by `tauri-plugin-updater`'s signing key. The Desktop app verifies this **in addition to** the SHA-256. |
| `notesUrl` | `string` | Link to the changelog markdown in Blob. |
| `notesExcerpt` | `string` | First 500 chars of the changelog; shown in the update prompt without a second network call. |
| `critical` | `boolean` | If `true`, the update prompt cannot be dismissed (security fix). |
| `forceUpdateBefore` | `string \| null` | ISO date; if set, the app refuses to launch past this date without updating. Used for breaking-protocol upgrades. |

### 4.3 Manifest Signing

The manifest itself is **signed** with a minisign keypair (separate from the per-binary signature). The signature is appended as `desktop-stable.json.sig` next to `desktop-stable.json` in Blob:

```
blob://buddysaradhi-releases/manifests/
├── desktop-stable.json
├── desktop-stable.json.sig
├── desktop-staging.json
├── desktop-staging.json.sig
└── ...
```

The Desktop app fetches both, verifies the signature against a hardcoded public key in the Rust binary, then verifies the per-binary signature after download. Two layers: manifest signing prevents a CDN compromise from substituting a malicious manifest; per-binary signing prevents a manifest compromise from substituting a malicious binary.

---

## 5. The Desktop Updater — Poll, Download, Verify, Apply

The Desktop app (Tauri v2 + Rust) uses `tauri-plugin-updater` to poll the manifest on launch and every 6 hours while running. The flow:

```
┌────────────────────────┐
│  Desktop app launches  │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  fetch(manifestUrl + '?' + cacheBust)          │
│  cacheBust = current version (defeats CDN)     │
└──────────┬─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  verify minisign signature (hardcoded pubkey)  │
│  if FAIL → log + abort; do NOT prompt user     │
└──────────┬─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  parse JSON; compare version vs currentVersion │
│  if currentVersion >= manifest.version → done  │
│  if currentVersion < minimumAutoUpdateFrom →   │
│      prompt "fresh install required"           │
└──────────┬─────────────────────────────────────┘
           │ new version available
           ▼
┌────────────────────────────────────────────────┐
│  prompt user: "Buddysaradhi 1.1.0 available.        │
│   • Notes: <notesExcerpt>                      │
│   • [Update now] [Later]                       │
│   (if critical=true, [Later] disabled)         │
└──────────┬─────────────────────────────────────┘
           │ user clicks [Update now]
           ▼
┌────────────────────────────────────────────────┐
│  download binary to temp dir                   │
│  show progress bar (sizeBytes)                 │
└──────────┬─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  sha256(downloaded) === manifest.sha256?       │
│  if FAIL → delete, abort, toast error          │
└──────────┬─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  verify minisign signature on the binary       │
│  (separate from manifest signature)            │
│  if FAIL → delete, abort, log security event   │
└──────────┬─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  tauri-plugin-updater.apply(downloadedPath)    │
│  → installer runs; app exits; new version boot │
└────────────────────────────────────────────────┘
```

### 5.1 The Rust Side (Sketch)

```rust
// src-tauri/src/updater.rs
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<(), String> {
    let manifest_url = format!(
        "{}/manifests/desktop-stable.json?cb={}",
        env!("BLOB_PUBLIC_BASE_URL"),
        env!("CARGO_PKG_VERSION")
    );
    let manifest_bytes = reqwest::get(&manifest_url).await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;

    // Verify manifest signature (minisign)
    let sig_url = format!("{}.sig", manifest_url);
    let sig_bytes = reqwest::get(&sig_url).await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
    verify_minisign(&manifest_bytes, &sig_bytes, MANIFEST_PUBKEY)
        .map_err(|_| "Manifest signature verification failed".to_string())?;

    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    if manifest.version <= env!("CARGO_PKG_VERSION").to_string() {
        return Ok(()); // up to date
    }

    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(update) = update {
        // The Tauri updater handles download + signature verification
        // (we set `pubkey` in tauri.conf.json).
        update.download_and_install(|_, _| {}, || {}).await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}
```

The `tauri.conf.json` `plugins.updater` block:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://public.blob.vercel-storage.com/manifests/desktop-stable.json"
      ],
      "pubkey": "RWQ....minisign public key....",
      "windows": { "installMode": "passive" }
    }
  }
}
```

The `pubkey` is hardcoded in the Rust binary; a CDN compromise cannot substitute it.

---

## 6. Mobile OTA Updates — Not Via Blob

Mobile OTA updates flow through **EAS Update**, not Vercel Blob. EAS Update is Expo's OTA service that pushes JS bundle + asset updates to installed apps without going through the App Store / Play Store. The flow is documented in `mobile/06_EAS_Update.md`.

The `mobile-stable.json` manifest in Blob is **not** polled by the mobile app — it exists only as a version-history record for the `/download` page on web (which links to the APK side-load for Android; iOS users are sent to TestFlight).

---

## 7. Retention Policy

### 7.1 Keep Last 10 Per Platform

For each `(platform, channel)` pair, keep the last 10 versions in Vercel Blob. Older versions are auto-deleted by the retention script.

```
desktop/windows/Buddysaradhi-Setup-1.1.0-x64.msi   ← keep
desktop/windows/Buddysaradhi-Setup-1.0.9-x64.msi   ← keep
...
desktop/windows/Buddysaradhi-Setup-1.0.1-x64.msi   ← keep (10th)
desktop/windows/Buddysaradhi-Setup-1.0.0-x64.msi   ← DELETE (11th)
```

### 7.2 The Retention Script

```ts
// scripts/retain-blob-releases.ts
import { list, del } from "@vercel/blob";

const KEEP = 10;

async function retain(platform: "desktop" | "mobile", channel: "stable" | "staging") {
  const prefix = `${platform}/`;
  const blobs = await list({ prefix });
  // Group by (sub-platform, channel, version), sort by pubDate desc, keep top 10.
  // ...
  for (const old of blobsToDelete) {
    await del(old.url);
    console.log(`[retain] deleted ${old.url}`);
  }
}
```

Run weekly via `/api/cron/retain-releases` (added to `vercel.json` `crons`).

### 7.3 The Manifest Exception

The manifest files (`desktop-stable.json`, etc.) are **never** deleted — they always reflect the latest version. The changelog markdown files in `changelogs/` are kept indefinitely (they're tiny; < 5 KB each).

### 7.4 The `.ipa` Exception

The iOS `.ipa` files in `mobile/ios/` are kept for **2 weeks** only (long enough for an emergency sideload via Apple Configurator). After 2 weeks they're deleted. The App Store Connect submission is the canonical iOS distribution; the Blob `.ipa` is a fallback only.

---

## 8. The `/download` Page (Web)

The web app serves a public `/download` page (in `(marketing)`) that links to the latest installers. The marketing copy for this page — the five DownloadCards, the persona narratives ("For the tutor who teaches from their laptop" / "For the tutor who is always on their phone"), the "recommended for your device" intent — is authored in `product/04_Download_Hub.md`. The implementation of the in-landing Download Hub (the version that renders inside the commercial landing page at `/`) is in `07_Landing_Page.md §6`; this section covers the standalone `/download` page, which is a sister route with the same data source and a different layout.

The standalone `/download` page:

1. Reads `manifests/desktop-stable.json` and `manifests/mobile-stable.json` via `fetch()` (server-side, in an RSC).
2. Renders platform cards (Windows, macOS, Linux, Android) with download buttons linking to the binary URLs.
3. iOS card says "Available on TestFlight" with a link to the TestFlight invite URL.
4. Shows the latest changelog excerpt (`notesExcerpt`) on the page.
5. Lists the previous 5 versions (linked from `changelogs/`) in an accordion.

The page is statically prerendered with PPR; the manifest fetch is cached for 5 minutes (revalidate via `revalidate = 300`). The same `next: { revalidate: 300 }` pattern powers the in-landing Download Hub in `07_Landing_Page.md §6.1` (which goes through the `/api/releases/latest` server route, whereas this standalone page reads the manifest files directly).

### 8.1 Page Sketch

```tsx
// src/app/(marketing)/download/page.tsx
import { Card } from "@/components/ui/card";
import { Download, Apple, Terminal } from "lucide-react";

const REVALIDATE = 300; // 5 minutes

async function getManifests() {
  const [desktop, mobile] = await Promise.all([
    fetch(`${process.env.BLOB_PUBLIC_BASE_URL}/manifests/desktop-stable.json`, {
      next: { revalidate: REVALIDATE },
    }).then((r) => r.json()),
    fetch(`${process.env.BLOB_PUBLIC_BASE_URL}/manifests/mobile-stable.json`, {
      next: { revalidate: REVALIDATE },
    }).then((r) => r.json()),
  ]);
  return { desktop, mobile };
}

export default async function DownloadPage() {
  const { desktop, mobile } = await getManifests();
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-h1">Download Buddysaradhi</h1>
      <p className="mt-4 text-body text-text-secondary">
        Version {desktop.version} · released {new Date(desktop.pubDate).toLocaleDateString("en-IN")}
      </p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <PlatformCard
          icon={Download}
          title="Windows"
          accent="cyan"
          url={desktop.platforms.windows.url}
          sizeBytes={desktop.platforms.windows.sizeBytes}
        />
        <PlatformCard
          icon={Apple}
          title="macOS"
          accent="emerald"
          url={desktop.platforms.macos.url}
          sizeBytes={desktop.platforms.macos.sizeBytes}
        />
        <PlatformCard
          icon={Terminal}
          title="Linux"
          accent="violet"
          url={desktop.platforms.linux.url}
          sizeBytes={desktop.platforms.linux.sizeBytes}
        />
        <PlatformCard
          icon={Download}
          title="Android"
          accent="amber"
          url={mobile.platforms.android.url}
          sizeBytes={mobile.platforms.android.sizeBytes}
        />
        <TestFlightCard />
      </div>
      <section className="mt-12">
        <h2 className="text-h2">What's New</h2>
        <pre className="mt-4 whitespace-pre-wrap font-sans text-body">
          {desktop.notesExcerpt}
        </pre>
      </section>
    </main>
  );
}
```

---

## 9. The Release Pipeline (CI/CD)

A new release goes from `git tag v1.1.0` to a published Blob artifact in five stages:

```
┌────────────────┐  git tag v1.1.0  ┌──────────────────────────────────┐
│  main branch   │ ───────────────► │  GitHub Actions: release.yml     │
│  (CI green)    │                  │                                  │
└────────────────┘                  │  Stage 1: Desktop build (Tauri)  │
                                    │    → upload .msi/.dmg/.AppImage  │
                                    │    → sign with minisign          │
                                    │                                  │
                                    │  Stage 2: Mobile build (EAS)     │
                                    │    → eas build --platform android│
                                    │    → eas build --platform ios    │
                                    │    → eas submit (ios)            │
                                    │                                  │
                                    │  Stage 3: Upload to Vercel Blob  │
                                    │    → @vercel/blob put() each     │
                                    │    → compute sha256              │
                                    │                                  │
                                    │  Stage 4: Update manifests       │
                                    │    → rewrite desktop-stable.json │
                                    │    → sign manifest               │
                                    │    → put manifest + .sig         │
                                    │                                  │
                                    │  Stage 5: Announce               │
                                    │    → tweet / blog / in-app toast │
                                    └──────────────────────────────────┘
```

The GitHub Actions workflow `release.yml` is in `.github/workflows/release.yml`. Each stage is a job; failures block the next stage. The Tauri signing key and the Vercel Blob token are GitHub Actions secrets.

---

## 10. Common Pitfalls

| # | Anti-pattern | Why wrong | Fix |
|---|---|---|---|
| 1 | Forgetting to bump `tauri.conf.json` `version` before tagging | Manifest says `1.1.0` but binary reports `1.0.0`; updater refuses to apply. | CI asserts `version` matches the git tag. |
| 2 | Uploading a binary without computing SHA-256 | Manifest's `sha256` is empty; Desktop app refuses to apply. | Compute SHA-256 in Stage 3, embed in manifest in Stage 4. |
| 3 | Forgetting the minisign signature on the manifest | Desktop app's signature check fails; update silently refuses. | Always upload `manifest.json` and `manifest.json.sig` together. |
| 4 | Publishing to `desktop-stable.json` instead of `desktop-staging.json` first | Untested build goes to all stable users. | Always publish to staging first; promote to stable after 48h of clean telemetry (Speed Insights; no crash spike). |
| 5 | Setting `forceUpdateBefore` without an `minimumAutoUpdateFrom` | Users on old versions can't update (they need a fresh install) and can't launch. | Always pair `forceUpdateBefore` with `minimumAutoUpdateFrom`. |
| 6 | Keeping all old versions forever | Blob storage grows unbounded; hits 1 GB free tier. | Run retention script weekly (§7). |
| 7 | Publishing the iOS `.ipa` to a public Blob URL | Apple's policy forbids public sideload distribution. | `.ipa` lives in Blob but is never linked from `/download`; only App Store Connect + 2-week emergency sideload window. |
| 8 | Using `https://buddysaradhi.app/manifests/...` instead of the Blob URL | Couples the manifest URL to the web domain; breaks if the web app moves. | Always use `https://public.blob.vercel-storage.com/manifests/...`. |

---

## 11. Cross-References

- Top-level `AGENTS.md` §2 Rule 2 — the update-check ping is the only allowed non-Turso network call (the manifest poll is this).
- Top-level `10_Security.md` §15 — backup crypto (separate from release crypto, but same `ENCRYPTION_KEY` rotation discipline).
- Top-level `15_Future_Roadmap.md` — v1.x self-hosting path; the Blob bucket can be mirrored to a self-hosted S3-compatible store.
- Sibling `product/04_Download_Hub.md` — the **marketing spec** for the download hub (the five-card layout intent, persona narratives, "recommended for your device" copy). This file is the build/release plumbing; `product/04_Download_Hub.md` is what the user reads on the cards.
- This directory's `07_Landing_Page.md §6` — the **implementation spec** for the in-landing Download Hub (the version that renders inside the commercial landing page at `/`, with the platform-detector island and the QR-code cards).
- This directory's `05_Deployment_Vercel.md` §3 — env vars (`BLOB_READ_WRITE_TOKEN`, `BLOB_PUBLIC_BASE_URL`, `ENCRYPTION_KEY`).
- This directory's `04_API_Routes.md` §1.1 — the `/api/spec` allowlist pattern (the manifest endpoint inherits this discipline if it's ever proxied through `/api/`).
- `mobile/05_EAS_Build.md` — Mobile build pipeline.
- `mobile/06_EAS_Update.md` — Mobile OTA (separate from Blob).
- `desktop/` — Desktop build pipeline (Tauri, Rust, code signing).
- Sibling `deployment/02_Vercel_Blob_Build_Storage.md` — the master Blob bucket layout (mirrored in §3 above).

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ build-and-release file must carry ≥ 2 ASCII art mockups. The mockups below complement the existing §3 Blob bucket layout, §5 desktop-updater flow, and §9 release pipeline — they add three new views: (1) the Blob bucket layout as an annotated tree with retention + signing metadata, (2) the manifest schema visualised as a field-tree, and (3) the atomic-update sequence as a state machine with rollback paths. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only. The build/release surface is infrastructure — it carries **no glass tier and no neumorphic recipe** (the in-app surfaces that consume release artifacts — the DownloadCard on the commercial landing page — ARE in the design system, catalogued in `07_Landing_Page.md` §13.1).

### 12.1 Design System Reference — Build & Release Surface (Infra, No Glass)

> **The single rule (§6.6) does not apply to the build/release layer.** Vercel Blob storage, manifest JSON files, minisign signatures, and the Tauri updater are infrastructure — they serve bytes, not UI. The **in-app surfaces that consume release artifacts** (the DownloadCard on the commercial landing page, the `/download` standalone page) ARE in the design system; the tables below list the consumer surfaces and their tier/recipe so the release author knows which UI surfaces a given manifest field will land on.

| Surface (consumer of release artifacts) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| DownloadCard (renders `manifest.platforms.*` on landing) | `glass` per platform card; recommended = `glass-strong` + emerald glow | `/` Download Hub, `/download` | §5.5, `07 §6.2` |
| Changelog excerpt card (renders `notesExcerpt`) | `glass-faint` band | `/` Download Hub, `/changelog/[version]` | §5.5, §8.4 |
| TestFlight card (iOS — no Blob URL, just the invite link) | `glass` + amber accent (differentiator) | `/` Download Hub, `/download` | §5.5, §8.1 |
| "Update available" toast (Tauri updater prompt — desktop) | `glass-strong` + 4px emerald bar (info) or flare bar (critical) | desktop only (not web) | §8.8 |
| Version-number badge (renders `manifest.version` on landing) | flat tinted chip (not glass) | `/` Download Hub header | §2.3 tinting recipe |

| Control (consumer of release artifacts) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| "Download .dmg / .msi / .AppImage / .apk" button | `neumo-raised` + emerald glow (primary CTA on recommended card) | DownloadCard | §6.6, §8.2 |
| "Join TestFlight" button (iOS) | `neumo-raised` + amber glow | TestFlightCard | §6.6, §8.2 |
| "View changelog" link | ghost (transparent, `--text-secondary`) | DownloadCard | §8.2 |
| "Show SHA-256" expandable row | flat tinted + Radix Accordion | DownloadCard | §8.5 (segmented well is neumo-inset; the row itself is flat) |
| "How to install" accordion | `neumo-inset` well + `neumo-raised` ± buttons | DownloadCard | §6.6, §8.5 |

> **References.** Vercel Blob docs (`@vercel/blob` `put()`, `list()`, `del()`, `cacheControlMaxAge`, immutable URLs); Tauri Updater docs (`tauri-plugin-updater`, minisign signature verification, `endpoints` config, `pubkey`); minisign docs (signature format, key rotation); EAS Build docs (Android `.apk` production, iOS `.ipa` TestFlight submission); GitHub Actions docs (release.yml workflow, secrets, job dependencies); Semantic Versioning 2.0.0 (semver parsing, pre-release tags, build metadata); OWASP Secure Software Supply Chain (signature verification, key handling, rollback). These are the same references cited in `README.md` §7.2.

### 12.2 Mockup M1 — Vercel Blob Bucket Layout (Annotated Tree, Retention + Signing)

The §3 narrative listed the bucket structure; this mockup shows it as an **annotated tree** with retention policy, signing metadata, and cache headers per node. The point: every file in Blob is either immutable (per-version binaries, kept last 10), perpetual (manifests + changelogs, never deleted), or short-lived (iOS `.ipa`, 2-week emergency window).

```
   Vercel Blob Bucket — buddysaradhi-releases (annotated tree)
   ↑ served from https://public.blob.vercel-storage.com/buddysaradhi-releases/...
   ↑ access: BLOB_READ_WRITE_TOKEN (server-only, Vercel env); public read for /desktop/*, /mobile/*, /manifests/*, /changelogs/*

   blob://buddysaradhi-releases/
   │
   ├── desktop/                                    ← DESKTOP INSTALLERS (immutable per version)
   │   ├── windows/
   │   │   ├── Buddysaradhi-Setup-1.0.0-x64.msi          ← KEEP (v1.0.0 — 11th oldest, would be DELETED)
   │   │   ├── Buddysaradhi-Setup-1.0.1-x64.msi          ← KEEP (10th — last retained)
   │   │   ├── Buddysaradhi-Setup-1.0.2-x64.msi          ← KEEP
   │   │   ├── ...                                  ← (8 more versions, kept)
   │   │   └── Buddysaradhi-Setup-1.1.0-x64.msi          ← KEEP (latest stable)
   │   │       • sizeBytes: ~14 MB
   │   │       • Cache-Control: public, max-age=31536000, immutable
   │   │       • SHA-256: embedded in manifest (verified post-download by Tauri updater)
   │   │       • minisign signature: NOT on the binary itself (Windows EV cert is the OS-facing sig);
   │   │         the manifest entry's `signature` field is the minisign sig over the binary hash
   │   │       • retention: keep last 10 (§7.1); older versions auto-deleted by /api/cron/retain-releases
   │   │
   │   ├── macos/
   │   │   ├── Buddysaradhi-1.0.0-universal.dmg          ← KEEP (10th)
   │   │   ├── Buddysaradhi-1.0.0-universal.dmg.sig      ← KEEP (paired minisign signature)
   │   │   ├── ...                                  ← (9 more versions, kept)
   │   │   ├── Buddysaradhi-1.1.0-universal.dmg          ← KEEP (latest stable)
   │   │   └── Buddysaradhi-1.1.0-universal.dmg.sig      ← KEEP (paired minisign signature)
   │   │       • sizeBytes: ~15 MB
   │   │       • Cache-Control: public, max-age=31536000, immutable
   │   │       • TWO signatures: Apple Developer ID (notarization + stapling) AND minisign (.dmg.sig)
   │   │         — Apple sig is OS-facing (Gatekeeper); minisign sig is updater-facing (tauri-plugin-updater)
   │   │       • retention: keep last 10 (binary + .sig paired — never delete one without the other)
   │   │
   │   └── linux/
   │       ├── Buddysaradhi-1.0.0-x86_64.AppImage        ← KEEP (10th)
   │       ├── ...                                  ← (9 more versions, kept)
   │       └── Buddysaradhi-1.1.0-x86_64.AppImage        ← KEEP (latest stable)
   │           • sizeBytes: ~14 MB
   │           • Cache-Control: public, max-age=31536000, immutable
   │           • signature: minisign in manifest (Linux has no OS-level sig requirement)
   │           • retention: keep last 10
   │
   ├── mobile/                                     ← MOBILE INSTALLERS
   │   ├── android/
   │   │   ├── Buddysaradhi-1.0.0-universal.apk          ← KEEP (10th)
   │   │   ├── ...                                  ← (9 more versions, kept)
   │   │   └── Buddysaradhi-1.1.0-universal.apk          ← KEEP (latest stable)
   │   │       • sizeBytes: ~28 MB
   │   │       • Cache-Control: public, max-age=31536000, immutable
   │   │       • signature: Android v2 sig (embedded in APK); minisign NOT used (EAS Build handles it)
   │   │       • retention: keep last 10
   │   │       • distribution: side-load only (Play Store submission is a v1.x roadmap item)
   │   │
   │   └── ios/
   │       └── Buddysaradhi-1.1.0.ipa                    ← KEEP 2 WEEKS ONLY (emergency sideload window)
   │           • sizeBytes: ~22 MB
   │           • Cache-Control: private, max-age=0 (NOT publicly cacheable — Apple policy)
   │           • signature: Apple distribution cert (embedded in IPA)
   │           • retention: 2 weeks (§7.4); auto-deleted by retention script
   │           • distribution: TestFlight (canonical) + emergency sideload via Apple Configurator (rare)
   │           • NEVER linked from /download — the /download iOS card links to TestFlight invite URL
   │
   ├── manifests/                                  ← MANIFESTS (perpetual, never deleted)
   │   ├── desktop-stable.json                     ← KEEP FOREVER (always reflects latest stable)
   │   ├── desktop-stable.json.sig                 ← KEEP FOREVER (minisign signature over the manifest)
   │   ├── desktop-staging.json                    ← KEEP FOREVER (staging channel)
   │   ├── desktop-staging.json.sig                ← KEEP FOREVER
   │   ├── mobile-stable.json                      ← KEEP FOREVER
   │   ├── mobile-stable.json.sig                  ← KEEP FOREVER
   │   ├── mobile-staging.json                     ← KEEP FOREVER
   │   └── mobile-staging.json.sig                 ← KEEP FOREVER
   │       • sizeBytes: ~2 KB each (tiny)
   │       • Cache-Control: public, max-age=3600 (1 h ISR; the Tauri updater appends ?cb=<version> cache-bust)
   │       • signed with minisign keypair (separate from per-binary signatures — two layers of verification)
   │       • ENCRYPTION_KEY (Vercel env) used to encrypt the manifest at rest in Blob? NO — manifests are
   │         public-readable; ENCRYPTION_KEY is for the .sig sidecar if we ever add an encrypted manifest
   │         channel (future). Today: manifests are plain JSON + .sig.
   │       • retention: NEVER delete (§7.3 — they always reflect the latest version; history is in changelogs/)
   │
   └── changelogs/                                 ← CHANGELOGS (perpetual, never deleted)
       ├── 1.0.0.md                                ← KEEP FOREVER
       ├── 1.0.1.md                                ← KEEP FOREVER
       ├── 1.0.2.md                                ← KEEP FOREVER
       ├── ...                                     ← (one per released version)
       └── 1.1.0.md                                ← KEEP FOREVER (latest)
           • sizeBytes: ~3-5 KB each (markdown)
           • Cache-Control: public, max-age=86400 (24 h — changelogs don't change post-release)
           • retention: NEVER delete (§7.3 — tiny; the historical record)
           • referenced by manifest.notesUrl + the /changelog/[version] route on web

   ── Retention summary (per (platform, channel) pair) ──────────────────────────────────────────────────
     desktop/{windows,macos,linux}:  keep last 10 versions   (auto-delete 11th+; weekly cron)
     mobile/android:                 keep last 10 versions   (auto-delete 11th+; weekly cron)
     mobile/ios:                     keep 2 weeks only       (auto-delete older; weekly cron)
     manifests/*.json + .sig:        NEVER delete            (always reflects latest)
     changelogs/*.md:                NEVER delete            (historical record)

   ── Signing summary (two layers) ──────────────────────────────────────────────────────────────────────
     Layer 1 — Manifest signing (minisign keypair #1):
       • signs desktop-stable.json + mobile-stable.json (+ staging variants)
       • .sig sidecar uploaded alongside the manifest
       • verified by the Tauri updater against MANIFEST_PUBKEY (hardcoded in Rust binary)
       • prevents: CDN compromise substituting a malicious manifest
     Layer 2 — Per-binary signing (minisign keypair #2 + OS-level certs):
       • signs each .dmg / .msi / .AppImage / .apk (embedded in manifest's `signature` field)
       • verified by the Tauri updater AFTER download, BEFORE apply
       • prevents: manifest compromise substituting a malicious binary
       • OS-level certs (Apple Developer ID + notarization; Windows EV cert post-v1.1) are SEPARATE —
         they satisfy the OS (Gatekeeper / SmartScreen), not the updater

   ── Cache-Control summary ─────────────────────────────────────────────────────────────────────────────
     /desktop/*, /mobile/*:   max-age=31536000, immutable  (content-addressed; never overwritten)
     /manifests/*.json:       max-age=3600                  (1 h ISR; updater appends ?cb=<version>)
     /manifests/*.json.sig:   max-age=3600                  (same as manifest)
     /changelogs/*.md:        max-age=86400                 (24 h — changelogs don't change post-release)
     /mobile/ios/*.ipa:       max-age=0, private            (NOT publicly cacheable — Apple policy)
```

The tree shows every node with sizeBytes, Cache-Control, signing metadata, and retention policy. The retention summary at the bottom restates the three classes: immutable-per-version (binaries, keep last 10), perpetual (manifests + changelogs, never deleted), and short-lived (iOS `.ipa`, 2-week emergency window). The signing summary explains the two-layer defence: manifest signing (keypair #1) prevents CDN compromise from substituting a malicious manifest; per-binary signing (keypair #2 + OS-level certs) prevents manifest compromise from substituting a malicious binary. The Cache-Control summary restates the per-node cache headers — binaries are immutable (max-age=1 year), manifests are ISR (max-age=1 hour, cache-busted by the updater), changelogs are stable (max-age=24 hours), and the iOS `.ipa` is private (not publicly cacheable per Apple policy).

### 12.3 Mockup M2 — Manifest Schema (Field-Tree Visualised)

The §4.1 example showed the JSON; this mockup shows the schema as a **field-tree** with type, purpose, and the consumer of each field. The point: every field has exactly one consumer (the Tauri updater, the `/download` page, the changelog route, the marketing landing's DownloadCard) — a field without a consumer is a spec defect.

```
   Manifest Schema — desktop-stable.json (field-tree visualised)
   ↑ schemaVersion: 1 (forward-only; old clients ignore unknown fields)

   desktop-stable.json
   │
   ├── schemaVersion: 1                  [number, always 1]
   │   └── consumer: Tauri updater (version-gate; refuses if > current updater's supported schema)
   │
   ├── channel: "stable"                 [enum: "stable" | "staging"]
   │   └── consumer: Tauri updater (selects endpoint: desktop-stable.json vs desktop-staging.json)
   │
   ├── platform: "desktop"               [enum: "desktop" | "mobile"]
   │   └── consumer: /api/releases/latest (merge logic: desktop + mobile → unified payload)
   │
   ├── version: "1.1.0"                  [string, semver or pre-release]
   │   └── consumer: Tauri updater (compares vs CARGO_PKG_VERSION); /download page (version badge)
   │   └── constraint: must match the git tag that triggered the release (CI asserts)
   │
   ├── pubDate: "2025-09-15T10:30:00Z"   [ISO 8601]
   │   └── consumer: /download page ("released {date}" formatted en-IN); /changelog route
   │
   ├── minimumAutoUpdateFrom: "1.0.0"    [string, semver]
   │   └── consumer: Tauri updater (refuses auto-update if current < minimum; prompts fresh install)
   │   └── constraint: paired with forceUpdateBefore (anti-pattern to set one without the other — §10 #5)
   │
   ├── platforms:                        [object: per-OS download descriptors]
   │   │
   │   ├── windows:
   │   │   ├── url: "https://public.blob.vercel-storage.com/.../Buddysaradhi-Setup-1.1.0-x64.msi"
   │   │   │   └── consumer: Tauri updater (download target); /download page (download button href)
   │   │   │   └── constraint: immutable URL (content-addressed; never overwritten — §3.5 of deployment/02)
   │   │   │
   │   │   ├── sha256: "a3f5e8b9c1d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
   │   │   │   └── consumer: Tauri updater (post-download verification; deletes binary on mismatch)
   │   │   │   └── also surfaced: /download page expandable "Show SHA-256" row (power-user verification)
   │   │   │
   │   │   ├── sizeBytes: 14233600
   │   │   │   └── consumer: Tauri updater (download progress bar); /download page ("14.2 MB" formatted en-IN)
   │   │   │
   │   │   └── signature: "-----BEGIN MINISIGN SIGNATURE-----\n..."
   │   │       └── consumer: Tauri updater (verifies AFTER download, BEFORE apply; separate from manifest sig)
   │   │       └── keypair: minisign keypair #2 (per-binary; keypair #1 is for the manifest itself)
   │   │
   │   ├── macos:                        [same shape as windows]
   │   │   ├── url, sha256, sizeBytes, signature
   │   │   └── note: macOS also has Apple Developer ID + notarization + stapling (OS-facing, separate)
   │   │
   │   └── linux:                        [same shape as windows]
   │       ├── url, sha256, sizeBytes, signature
   │       └── note: Linux has no OS-level sig requirement (minisign is the only verification layer)
   │
   ├── notesUrl: "https://public.blob.vercel-storage.com/.../changelogs/1.1.0.md"
   │   └── consumer: Tauri updater (rarely fetched — notesExcerpt covers most cases); /changelog route
   │
   ├── notesExcerpt: "### Added\n- WhatsApp deep-link reminder cards on Dashboard.\n\n### Fixed\n- Receipt PDF font rendering on Windows."
   │   └── consumer: Tauri updater (renders in update prompt without a second network call);
   │                 /download page ("What's New" section); /changelog route (first 500 chars)
   │   └── constraint: first 500 chars of the changelog markdown (§4.2)
   │
   ├── critical: false                   [boolean]
   │   └── consumer: Tauri updater (if true, the "Later" button is disabled; force-update path)
   │   └── used for: security fixes (e.g. a ledger tamper-evidence bug → critical=true)
   │
   └── forceUpdateBefore: null           [string | null, ISO date]
       └── consumer: Tauri updater (if set, app refuses to launch past this date without updating)
       └── used for: breaking-protocol upgrades (e.g. sync_outbox schema v2 → forceUpdateBefore=30 days)
       └── constraint: MUST be paired with minimumAutoUpdateFrom (anti-pattern §10 #5)

   ── Field → consumer matrix ───────────────────────────────────────────────────────────────────────────
     Field                    │ Tauri updater │ /download │ /changelog/[v] │ /api/releases/latest │ Marketing landing
     ─────────────────────────┼───────────────┼───────────┼────────────────┼──────────────────────┼──────────────────
     schemaVersion            │ ✓ (gate)      │           │                │ ✓ (merge logic)       │
     channel                  │ ✓ (endpoint)  │           │                │                       │
     platform                 │               │           │                │ ✓ (merge logic)       │
     version                  │ ✓ (compare)   │ ✓ (badge) │ ✓ (h1)         │ ✓ (passthrough)       │ ✓ (badge)
     pubDate                  │               │ ✓ (date)  │ ✓ (date)       │ ✓ (passthrough)       │ ✓ (date)
     minimumAutoUpdateFrom    │ ✓ (gate)      │           │                │                       │
     platforms.*.url          │ ✓ (download)  │ ✓ (href)  │                │ ✓ (passthrough)       │ ✓ (href)
     platforms.*.sha256       │ ✓ (verify)    │ ✓ (show)  │                │ ✓ (passthrough)       │ ✓ (show)
     platforms.*.sizeBytes    │ ✓ (progress)  │ ✓ (size)  │                │ ✓ (passthrough)       │ ✓ (size)
     platforms.*.signature    │ ✓ (verify)    │           │                │                       │
     notesUrl                 │ ✓ (rare fetch)│ ✓ (link)  │ ✓ (source)     │                       │
     notesExcerpt             │ ✓ (prompt)    │ ✓ (body)  │ ✓ (excerpt)    │ ✓ (passthrough)       │ ✓ (body)
     critical                 │ ✓ (force)     │           │                │                       │
     forceUpdateBefore        │ ✓ (force)     │           │                │                       │

   ── Schema evolution discipline ────────────────────────────────────────────────────────────────────────
     • schemaVersion bumps on schema CHANGE (added/removed/renamed field) — NOT on data change
     • old clients ignore unknown fields (forward-compatible); new clients handle absent fields (backward)
     • a field is NEVER removed — only deprecated (kept in the schema, no longer written by new releases)
     • a field is NEVER renamed — a new field is added alongside the old; old is deprecated
     ↑ this discipline is what lets the Tauri updater ship a security fix without forcing every desktop
       user to upgrade simultaneously (the updater reads the manifest with its current schema support)
```

The field-tree shows every field with its type, purpose, consumer, and constraints. The field → consumer matrix at the bottom is the contract: every field has at least one consumer; a field with zero consumers is a spec defect. The schema-evolution discipline at the bottom restates the forward/backward compatibility rules — schemaVersion bumps on schema change (not data change), old clients ignore unknown fields, fields are never removed (only deprecated), fields are never renamed (a new field is added alongside the old). This discipline is what lets the Tauri updater ship a security fix without forcing every desktop user to upgrade simultaneously.

### 12.4 Mockup M3 — Atomic Update Sequence (State Machine with Rollback Paths)

The §5 narrative walked the updater flow linearly; this mockup shows it as a **state machine** with explicit rollback paths at every verification gate. The point: every state has a defined failure mode and a defined rollback — a tutor never ends up with a half-applied update that breaks the app.

```
   Atomic Update Sequence — Tauri Updater State Machine (with rollback paths)
   ↑ every state has a failure mode + a rollback; a half-applied update is impossible

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S0: IDLE                                                                                       │
   │  • app running normally                                                                        │
   │  • CARGO_PKG_VERSION = current installed version                                               │
   │  • poll timer: every 6 hours while running + once on launch                                    │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  poll timer fires
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S1: FETCHING_MANIFEST                                                                          │
   │  • fetch(manifestUrl + '?' + cacheBust)  ← cacheBust = current version (defeats CDN)            │
   │  • fetch(sigUrl)                  ← the .sig sidecar                                            │
   │  • on success → S2                                                                              │
   │  • on failure (network) → R1 (retry 3×, then S0 with silent log — do NOT prompt user)           │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  manifest + sig fetched
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S2: VERIFYING_MANIFEST_SIG                                                                     │
   │  • verify_minisign(manifest_bytes, sig_bytes, MANIFEST_PUBKEY)                                  │
   │  • MANIFEST_PUBKEY is hardcoded in the Rust binary — CDN compromise cannot substitute it        │
   │  • on success → S3                                                                              │
   │  • on failure (sig mismatch) → R2 (LOG SECURITY EVENT + S0; do NOT prompt user;                │
   │    this is a possible CDN compromise or a key rotation mismatch — alert platform team)         │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  manifest sig verified
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S3: PARSING_MANIFEST                                                                           │
   │  • serde_json::from_slice(manifest_bytes) → Manifest struct                                    │
   │  • compare manifest.version vs CARGO_PKG_VERSION                                               │
   │  • if manifest.version <= current → S0 (up to date; no prompt)                                 │
   │  • if manifest.version > current but < minimumAutoUpdateFrom → S4 (fresh install required)     │
   │  • if manifest.version > current and >= minimumAutoUpdateFrom → S5 (prompt user)               │
   │  • on parse failure (schema drift) → R3 (log + S0; do NOT prompt — schemaVersion gate failed)  │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  new version available, auto-update eligible
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S4: FRESH_INSTALL_REQUIRED (terminal state — no auto-update path)                              │
   │  • prompt: "Buddysaradhi {version} requires a fresh install. Download from buddysaradhi.app/download."    │
   │  • the updater does NOT download or apply — the user manually downloads + installs             │
   │  • if forceUpdateBefore is set AND past that date → S9 (REFUSE_LAUNCH — see below)              │
   │  • transition: user dismisses → S0 (app continues running; will re-prompt next poll)            │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  (parallel path — auto-update eligible)
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S5: PROMPTING_USER                                                                             │
   │  • render update prompt: "Buddysaradhi {version} available."                                        │
   │    "Notes: {notesExcerpt}"                                                                      │
   │    "[Update now] [Later]"                                                                       │
   │  • if critical=true → "Later" disabled (force-update path)                                     │
   │  • if forceUpdateBefore set → show "Required by {date}" line                                   │
   │  • on [Update now] → S6                                                                         │
   │  • on [Later] → S0 (re-prompt next poll; if critical, next poll is in 1 h not 6 h)             │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  user clicks [Update now]
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S6: DOWNLOADING_BINARY                                                                         │
   │  • download binary to temp dir (e.g. /tmp/buddysaradhi-update-1.1.0.dmg)                             │
   │  • show progress bar (sizeBytes drives the percentage)                                          │
   │  • on success → S7                                                                              │
   │  • on failure (network) → R4 (retry 3× with exponential backoff; then S5 with "Download        │
   │    failed — retry?" prompt; temp dir cleaned up)                                                │
   │  • on failure (disk full) → R5 (prompt "Not enough disk space"; S0; temp dir cleaned up)       │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  binary downloaded
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S7: VERIFYING_BINARY_HASH                                                                      │
   │  • sha256(downloaded) === manifest.sha256?                                                      │
   │  • on success → S8                                                                              │
   │  • on failure (hash mismatch) → R6 (DELETE temp file; log security event; S0; do NOT prompt —  │
   │    this is a possible CDN compromise or a manifest/binary mismatch; alert platform team)        │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  hash verified
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S8: VERIFYING_BINARY_SIGNATURE                                                                 │
   │  • verify_minisign(downloaded_bytes, manifest.platforms.*.signature, BINARY_PUBKEY)            │
   │  • BINARY_PUBKEY is hardcoded in the Rust binary — separate from MANIFEST_PUBKEY                │
   │  • on success → S9                                                                              │
   │  • on failure (sig mismatch) → R7 (DELETE temp file; log security event; S0; do NOT prompt —   │
   │    this is a possible manifest compromise substituting a malicious binary; alert platform team)│
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  binary sig verified
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S9: APPLYING_UPDATE                                                                            │
   │  • tauri-plugin-updater.apply(downloadedPath)                                                   │
   │  • the installer runs (passive mode on Windows; drag-to-Applications on macOS)                  │
   │  • app exits; new version boots                                                                │
   │  • on success → S10 (next launch is the new version)                                            │
   │  • on failure (installer error) → R8 (LOG + prompt "Update failed — contact support.";          │
   │    app restarts on the OLD version — the installer did not modify the existing install)         │
   │  • if forceUpdateBefore is set AND past that date AND S9 fails → S11 (REFUSE_LAUNCH)            │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  installer completes; app restarts
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S10: UPDATED (terminal — app is now the new version)                                           │
   │  • CARGO_PKG_VERSION = manifest.version                                                         │
   │  • audit_log row (desktop-side): action='app_updated', from_version, to_version                 │
   │  • transition: → S0 (idle; poll resumes on the new version's schedule)                          │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  S11: REFUSE_LAUNCH (terminal — breaking-protocol upgrade required, not applied)                │
   │  • app refuses to launch past forceUpdateBefore date without updating                           │
   │  • prompt: "This version of Buddysaradhi is out of date and cannot run. Download the latest from     │
   │    buddysaradhi.app/download."                                                                       │
   │  • the user must manually download + install — the auto-updater is bypassed                     │
   │  • this state is rare (used for sync_outbox schema v2 → v3 type upgrades)                       │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Rollback paths (R1..R8) ───────────────────────────────────────────────────────────────────────────
     R1 (network failure on manifest fetch):     retry 3× → S0 (silent; do NOT prompt)
     R2 (manifest sig mismatch):                 LOG SECURITY EVENT → S0 (silent; alert platform team)
     R3 (manifest parse failure / schema drift): LOG → S0 (silent; schemaVersion gate failed)
     R4 (network failure on binary download):   retry 3× → S5 (re-prompt "Download failed — retry?")
     R5 (disk full):                             prompt "Not enough disk space" → S0 (temp cleaned up)
     R6 (binary hash mismatch):                  DELETE temp; LOG SECURITY EVENT → S0 (silent; alert)
     R7 (binary sig mismatch):                   DELETE temp; LOG SECURITY EVENT → S0 (silent; alert)
     R8 (installer error):                       LOG + prompt "Update failed — contact support.";
                                                app restarts on OLD version (existing install untouched)

   ── The "never half-applied" invariant ───────────────────────────────────────────────────────────────
     The updater NEVER overwrites the existing install before the new binary is verified.
     The download lives in a temp dir; the installer runs against the temp dir; the installer's job
     is to atomically swap the old install for the new. If the installer fails mid-swap (R8), the
     OS's installer atomicity guarantees the OLD install is still bootable — the user is never stranded.
     The only exception is S11 (REFUSE_LAUNCH) — and that's a deliberate refusal, not a half-applied
     state. The user manually downloads + installs; the auto-updater is bypassed entirely.

   ── The two-layer signing defence ────────────────────────────────────────────────────────────────────
     Layer 1 (S2): manifest sig → prevents CDN compromise substituting a malicious manifest
     Layer 2 (S8): binary sig   → prevents manifest compromise substituting a malicious binary
     ↑ a CDN compromise alone fails at S2 (manifest sig mismatch — R2, silent)
     ↑ a manifest compromise alone (attacker has the manifest minisign key) fails at S8 (binary sig
       mismatch — R7, silent) — UNLESS the attacker also has the per-binary minisign key, which is
       stored separately (different GitHub Actions secret, different rotation cadence)
```

The state machine shows 12 states (S0–S11) and 8 rollback paths (R1–R8). Every verification gate (manifest sig, binary hash, binary sig) has a defined failure mode that DELETES the temp file, LOGS a security event, and returns to S0 silently — the user is never prompted with a scary "possible attack" message; the platform team is alerted via the security log. The "never half-applied" invariant at the bottom is the load-bearing safety property: the updater downloads to a temp dir, verifies, then atomically swaps; the OS's installer atomicity guarantees the old install is still bootable if the installer fails mid-swap. The two-layer signing defence restates why a CDN compromise alone (R2) and a manifest compromise alone (R7) both fail safely — the attacker would need both minisign keys (stored as separate GitHub Actions secrets with different rotation cadences) to substitute a malicious binary.

---

*Build and release in this file is the contract. When a manifest field, a retention rule, or an updater step diverges, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog.*
