# 02 — Vercel Blob as the Cross-Cutting Build Artifact Registry

> Buddysaradhi's installer binaries — Desktop `.msi`/`.dmg`/`.AppImage` and the sideload Mobile `.apk` — live in **Vercel Blob Storage**. This file owns the **bucket layout, the manifest schema, the upload workflow, the atomic-update pattern, the promotion (staging → stable) pattern, the retention policy, the bandwidth budget, and the access-control model**. Cross-references: `product/04_Download_Hub.md` (the **commercial** spec for the download hub — five DownloadCards whose installer URLs are populated from the Blob manifest defined in §4), `web/07_Landing_Page.md §6` (the **implementation** spec for the download hub that consumes the Blob manifest via `/api/releases/latest`), `web/06_Build_and_Release.md` (the legacy app-side `/download` route), `desktop/05_Updater.md` (the Tauri updater plugin that polls the manifest), `mobile/05_EAS_Build.md` (the EAS build that produces the APK mirror).

---

## 1. Why Vercel Blob (not S3 / R2 / self-hosted)

Buddysaradhi ships installer binaries on three platforms:

- **Desktop (Tauri v2):** Windows `.msi`, macOS `.dmg` (+ `.app.tar.gz` for delta updates), Linux `.AppImage`.
- **Mobile sideload (Android):** Universal `.apk` mirrored from EAS Build.
- **Mobile store (iOS + Android):** Distributed via App Store / Play Store — **not** via Blob.

These artifacts need a home that is:

1. **Publicly readable** (the Tauri updater polls a manifest URL; the download hub links to installers).
2. **Authenticated writable** (only CI / a server-side API can upload new versions).
3. **CDN-distributed** (a tutor in Nagpur should download at full BSNL/Jio speed, not from a single-region origin).
4. **Cheap at v1 scale** (a few hundred downloads/month, ~6 GB egress).
5. **Same auth as the web app** (the `BLOB_READ_WRITE_TOKEN` already lives in the Vercel project env vars — `01_Vercel_Hosting.md` §4.2).

Vercel Blob satisfies all five. The alternatives fail:

- **AWS S3.** Requires an AWS account, IAM users, bucket policies, CORS config, CloudFront distribution. ~7 config surfaces to learn, ~$0.50/month minimum (free tier notwithstanding — it is a different bill). Overkill.
- **Cloudflare R2.** Requires a Cloudflare account in front of Vercel — breaks the "one CDN" rule (`01_Vercel_Hosting.md` §10.2). R2's egress is free, but the architecture cost is real.
- **GitHub Releases.** Free, but GitHub's CDN is not optimised for binary downloads; rate-limits anonymous downloads at 100 MB/hour per IP — a non-starter for an installer hub.
- **Self-hosted (nginx on a VPS).** Violates `01_Product_Principles.md` P5 (offline-first means the cloud is a replica, not a dependency — but the installer hub is a hard dependency at install time). Also: we'd have to run a server.

Vercel Blob it is. One account, one bill, one CDN, one auth model.

---

## 2. Bucket layout

The Vercel Blob "bucket" is a flat namespace of objects, each addressed by a pathname. Buddysaradhi uses a directory-style layout under a single `buddysaradhi-releases/` root (Blob does not have real directories; the `/` in the pathname is a convention, but it is a convention Vercel's dashboard and SDK respect for grouping).

```
buddysaradhi-releases/
├── desktop/
│   ├── windows/
│   │   ├── Buddysaradhi-1.4.0-x64.msi
│   │   ├── Buddysaradhi-1.4.0-x64.msi.sig
│   │   ├── Buddysaradhi-1.3.2-x64.msi
│   │   └── Buddysaradhi-1.3.2-x64.msi.sig
│   ├── macos/
│   │   ├── Buddysaradhi-1.4.0-universal.dmg
│   │   ├── Buddysaradhi-1.4.0-universal.dmg.sig
│   │   ├── Buddysaradhi-1.4.0-universal.app.tar.gz       ← delta-update payload
│   │   └── Buddysaradhi-1.4.0-universal.app.tar.gz.sig
│   └── linux/
│       ├── Buddysaradhi-1.4.0-x86_64.AppImage
│       └── Buddysaradhi-1.4.0-x86_64.AppImage.sig
├── mobile/
│   ├── android/
│   │   ├── Buddysaradhi-1.4.0-universal.apk
│   │   └── Buddysaradhi-1.4.0-universal.apk.sig
│   └── ios/
│       └── (LOCKED — TestFlight only; never mirrored publicly)
├── manifests/
│   ├── desktop-staging.json
│   ├── desktop-stable.json
│   ├── mobile-staging.json
│   └── mobile-stable.json
├── changelogs/
│   ├── 1.4.0.md
│   ├── 1.3.2.md
│   └── 1.3.1.md
└── signatures/
    ├── Buddysaradhi-1.4.0-x64.msi.sha256                  ← detached SHA-256
    ├── Buddysaradhi-1.4.0-universal.dmg.sha256
    └── Buddysaradhi-1.4.0-x86_64.AppImage.sha256
```

### 2.1 Naming conventions

- **Versions** are semver `MAJOR.MINOR.PATCH` (e.g., `1.4.0`), never `v1.4.0` in the filename (the `v` prefix is for git tags only).
- **Architectures** use the platform's canonical name: `x64` (Windows), `universal` (macOS — fat binary), `x86_64` (Linux). No abbreviations like `win64` or `mac-arm`.
- **Extensions** are the platform's native installer extension: `.msi` (Windows), `.dmg` (macOS), `.AppImage` (Linux), `.apk` (Android sideload).
- **Signatures** use `.sig` (Ed25519 detached signature, produced by `tauri-signer` for desktop, `apksigner` for Android). The `.sha256` files in `signatures/` are a secondary, hash-only verification — useful for users who manually verify before installing.

### 2.2 The `mobile/ios/` directory is a placeholder

iOS IPAs are **never** uploaded to Blob. Apple's distribution model requires either TestFlight (beta) or the App Store (production). There is no "sideload the IPA from a website" path that does not require a paid Apple Developer account on the user's side. The `mobile/ios/` directory exists in the layout above as a documented placeholder — it is empty, and CI lint fails the build if any file is uploaded there. This is enforced by a `no-ios-blob-upload.test.ts` lint rule (see `05_CI_CD_GitHub_Actions.md` §3).

### 2.3 The `changelogs/` directory

Every release has a changelog file: `changelogs/{version}.md`. The file is generated by the `release.yml` workflow (`05_CI_CD_GitHub_Actions.md` §6) from the commit history between the previous tag and the new tag, with categories (`feat`, `fix`, `sec`, `chore`) per Conventional Commits (`AGENTS.md` §5.1). The changelog file is:

- Publicly readable (linked from the GitHub Release + the web download hub).
- Markdown-formatted (rendered by the web hub via `react-markdown`).
- Stable URL: `https://buddysaradhi.app/api/changelog/1.4.0` (a server route that streams the Blob file with `Content-Type: text/markdown`).

---

## 3. The upload workflow

### 3.1 When uploads happen

Two workflows upload to Blob (see `05_CI_CD_GitHub_Actions.md`):

1. **`desktop-build.yml`** — runs on tag `v*`. Builds Windows + macOS + Linux in parallel, signs + notarizes, then uploads all three installers + the `.app.tar.gz` delta payload + the manifest update.
2. **`eas-build.yml`** — runs on tag `v*` for the Android build. After EAS Build produces the APK, a post-build hook uploads the APK to `mobile/android/`.

Both workflows use the `@vercel/blob` SDK with the `BLOB_READ_WRITE_TOKEN` secret (server-only — `01_Vercel_Hosting.md` §4.2).

### 3.2 The upload code (TypeScript, in `apps/web/server/blob-upload.ts`)

```typescript
// Implements: deployment/02_Vercel_Blob_Build_Storage.md §3.2 — Upload workflow
import { put, head, list } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN not set');

export interface UploadResult {
  pathname: string;
  url: string;
  sha256: string;
  size: number;
  uploadedAt: string;
}

export async function uploadInstaller(
  localPath: string,
  blobPathname: string,
  contentType: string,
): Promise<UploadResult> {
  const fileBuffer = await readFile(localPath);
  const sha256 = createHash('sha256').update(fileBuffer).digest('hex');

  // Check if the file already exists with the same hash (idempotent re-runs)
  const existing = await head(`buddysaradhi-releases/${blobPathname}`);
  if (existing && existing.customMetadata?.sha256 === sha256) {
    return {
      pathname: blobPathname,
      url: existing.url,
      sha256,
      size: Number(existing.size),
      uploadedAt: existing.uploadedAt.toISOString(),
    };
  }

  const blob = await put(`buddysaradhi-releases/${blobPathname}`, fileBuffer, {
    access: 'public',
    addRandomSuffix: false, // deterministic pathnames — we manage versions explicitly
    contentType,
    token: BLOB_TOKEN,
    customMetadata: {
      sha256,
      uploadedBy: 'ci',
    },
  });

  return {
    pathname: blobPathname,
    url: blob.url,
    sha256,
    size: fileBuffer.length,
    uploadedAt: new Date().toISOString(),
  };
}
```

### 3.3 The upload sequence

The `desktop-build.yml` job runs the following sequence per platform (Windows shown; macOS and Linux are analogous):

1. Build the `.msi` via `bun run tauri:build` (Tauri's CLI handles `cargo build --release` + WiX packaging).
2. Sign the `.msi` via `signtool sign /f cert.pfx /p $PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 Buddysaradhi-1.4.0-x64.msi`.
3. Compute the SHA-256 of the signed `.msi` and write to `signatures/Buddysaradhi-1.4.0-x64.msi.sha256`.
4. Compute the Ed25519 detached signature via `tauri-signer sign -k $TAURI_SIGNING_PRIVATE_KEY -p $PASSWORD Buddysaradhi-1.4.0-x64.msi > Buddysaradhi-1.4.0-x64.msi.sig`.
5. Upload the `.msi` to `buddysaradhi-releases/desktop/windows/Buddysaradhi-1.4.0-x64.msi` via the `uploadInstaller` function above.
6. Upload the `.sig` to `buddysaradhi-releases/desktop/windows/Buddysaradhi-1.4.0-x64.msi.sig`.
7. Upload the `.sha256` to `buddysaradhi-releases/signatures/Buddysaradhi-1.4.0-x64.msi.sha256`.
8. Record the `url`, `sha256`, `size`, and `uploadedAt` into a per-platform result object that the manifest-update step (§5) consumes.

### 3.4 Idempotency

The `uploadInstaller` function is **idempotent**: if the file already exists with the same SHA-256, it returns the existing URL without re-uploading. This makes the `desktop-build.yml` workflow safe to re-run on transient failures (a flaky network during step 5 does not corrupt the bucket — the re-run detects the partial upload via `head()` and either resumes or skips).

### 3.5 The "no overwrite" rule

If a file exists at the target pathname with a **different** SHA-256, the upload **fails** (the `put` call with `addRandomSuffix: false` will throw if the pathname is taken — Vercel Blob does not support overwriting an existing object). This is intentional: a re-build of the same version with different bytes is a build-reproducibility bug, not a deployment event. The CI fails loudly, and the release-engineering agent must investigate.

The only legitimate way to "replace" an installer is:

1. Bump the version (e.g., `1.4.0` → `1.4.1`).
2. Upload under the new pathname.
3. Update the manifest to point at the new pathname.

Re-uploading the same version with different bytes is forbidden. This is the binary equivalent of `AGENTS.md` §0.2 (no orphan code) — every byte has a version, and every version is immutable once published.

---

## 4. The manifest schema

The Tauri updater (`desktop/05_Updater.md`) polls a JSON manifest at a fixed URL. The manifest tells the updater:

- What the latest version is.
- Where to download the installer for each platform.
- What the signature is (so the updater can verify the download before installing).
- What the minimum auto-updatable version is (so a tutor on v1.0.0 is not auto-updated across a breaking change — they see a "please reinstall" message instead).

### 4.1 The full schema

```json
{
  "version": "1.4.0",
  "pub_date": "2025-08-15T10:30:00Z",
  "release_notes_url": "https://buddysaradhi.app/api/changelog/1.4.0",
  "minimum_auto_update_from": "1.3.0",
  "platforms": {
    "windows-x86_64": {
      "signature": "dGhpcyBpcyBhIGJhc2U2NCBlZDI1NTE5IHNpZ25hdHVyZQ==",
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/windows/Buddysaradhi-1.4.0-x64.msi"
    },
    "darwin-universal": {
      "signature": "dGhpcyBpcyBhIGJhc2U2NCBlZDI1NTE5IHNpZ25hdHVyZQ==",
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/macos/Buddysaradhi-1.4.0-universal.dmg"
    },
    "darwin-aarch64": {
      "signature": "dGhpcyBpcyBhIGJhc2U2NCBlZDI1NTE5IHNpZ25hdHVyZQ==",
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/macos/Buddysaradhi-1.4.0-universal.dmg"
    },
    "linux-x86_64": {
      "signature": "dGhpcyBpcyBhIGJhc2U2NCBlZDI1NTE5IHNpZ25hdHVyZQ==",
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/linux/Buddysaradhi-1.4.0-x86_64.AppImage"
    }
  },
  "sha256": {
    "windows-x86_64": "a3f5b8...",
    "darwin-universal": "c7e9d2...",
    "darwin-aarch64": "c7e9d2...",
    "linux-x86_64": "f1b4c8..."
  },
  "metadata": {
    "build_commit": "abc1234",
    "build_runner": "github-actions",
    "build_branch": "main"
  }
}
```

### 4.2 Field reference

| Field | Type | Purpose |
|---|---|---|
| `version` | string (semver) | The version this manifest advertises. |
| `pub_date` | string (ISO 8601) | When this manifest was published. The Tauri updater uses this to skip updates older than the installed version's pub_date (defence against manifest-rollback attacks). |
| `release_notes_url` | string (URL) | Where to fetch the changelog. The desktop app's "Update available" dialog links here. |
| `minimum_auto_update_from` | string (semver) | The oldest version that can auto-update to `version`. A tutor on `1.2.0` with `minimum_auto_update_from: 1.3.0` sees a "manual reinstall required" dialog, not an auto-update. This is the breaking-change gate. |
| `platforms` | object | Per-platform download URL + Ed25519 signature (base64). The Tauri updater keys off `windows-x86_64`, `darwin-universal`, `darwin-aarch64`, `linux-x86_64`. |
| `sha256` | object | Per-platform SHA-256 of the installer bytes. Used by the download hub for a secondary hash check (the primary check is the Ed25519 signature). |
| `metadata` | object | Build provenance: commit SHA, runner, branch. Used for forensic debugging; not consumed by the updater. |

### 4.3 The signature format

The `signature` field is a **base64-encoded Ed25519 detached signature** of the installer bytes, produced by `tauri-signer sign` using the `TAURI_SIGNING_PRIVATE_KEY`. The Tauri updater:

1. Downloads the installer bytes from `url`.
2. Decodes the `signature` from base64.
3. Verifies the signature against the public key compiled into the app (`tauri.conf.json` → `plugins.updater.pubkey`).
4. If verification fails, refuses to install and writes to the local audit log (`10_Security.md` §8 — `audit_log` action `update_signature_mismatch`).

This is the **primary** integrity check. The `sha256` is secondary — useful for users who manually verify before installing, but not consumed by the auto-updater.

### 4.4 Why two manifests: `staging` and `stable`

The Tauri updater polls **one** URL by default. Buddysaradhi uses two:

- `manifests/desktop-staging.json` — the latest build that passed CI + manual smoke on staging. Polled by the staging channel of the desktop app (the internal-test build that points at `staging` for QA).
- `manifests/desktop-stable.json` — the latest build that has been promoted from staging after a 24-hour soak. Polled by the production desktop app.

This two-stage model (see §6 — Promotion) lets us:

1. Build + smoke-test on staging without exposing tutors to a half-tested build.
2. Promote to stable by **copying** the staging manifest to the stable manifest (atomic, no rebuild).
3. Roll back to a prior stable by editing the stable manifest to point at an older installer URL (no rebuild, no re-sign).

---

## 5. The atomic update pattern

### 5.1 Why atomic

A manifest update that is interrupted mid-write leaves a corrupt JSON file on the Blob. Every desktop app that polls it in the next 5 minutes fails to parse and either crashes or shows a spurious "no update available" — depending on how defensive the Tauri updater's JSON parser is. Neither is acceptable.

### 5.2 The pattern (write-temp-then-rename)

Vercel Blob does not natively support atomic rename across pathnames. The `@vercel/blob` SDK supports `addRandomSuffix: false`, which makes the upload deterministic — but a `put` to an existing pathname throws (Vercel Blob is immutable-once-written). The atomic-update pattern is therefore:

1. **Write** the new manifest to `manifests/desktop-staging.json.tmp` (a temporary pathname).
2. **Verify** the temp file's content by reading it back and JSON-parsing it.
3. **Delete** the old `manifests/desktop-staging.json` (via `del()` from `@vercel/blob`).
4. **Write** the verified content to `manifests/desktop-staging.json`.

There is a tiny (millisecond) window between step 3 and step 4 where the stable URL 404s. The Tauri updater's retry logic (3 retries with exponential backoff) handles this gracefully — a tutor polling in that window sees one failed poll and a successful one 30 seconds later.

### 5.3 The Vercel Blob versioning upgrade path

When Buddysaradhi upgrades to Vercel Pro (`01_Vercel_Hosting.md` §8.4), Blob gains **versioning**. With versioning enabled, the pattern simplifies:

1. `put` to `manifests/desktop-staging.json` (Blob keeps the prior version as a numbered historical object).
2. If the write fails or the content is wrong, restore the prior version via the Blob API.

Until Pro is enabled, the temp-rename pattern (§5.2) is the operational pattern. It is documented in `apps/web/server/blob-manifest.ts` with a `// SAFETY:` comment explaining the millisecond 404 window.

### 5.4 The "no partial manifest" invariant

The CI workflow (`05_CI_CD_GitHub_Actions.md` §5 — `desktop-build.yml`) has a final verification step that:

1. Reads `manifests/desktop-staging.json` from Blob.
2. JSON-parses it.
3. Asserts every `platforms.*.url` returns HTTP 200.
4. Asserts every `platforms.*.signature` is non-empty and base64-decodable.
5. Asserts `version` matches the git tag.

If any assertion fails, the workflow fails loudly, posts to the `#buddysaradhi-alerts` webhook, and the release-engineering agent is paged. The manifest is **never** left in a half-written state — the verification is the contract.

---

## 6. Promotion: staging → stable

### 6.1 The promotion model

A build that has passed CI + manual smoke on staging for 24 hours is **promoted** to stable. Promotion is **not a rebuild** — it is a copy:

1. Read `manifests/desktop-staging.json`.
2. Bump the `pub_date` to the current time (so the Tauri updater sees a "newer" manifest).
3. Write to `manifests/desktop-stable.json` using the atomic-update pattern (§5.2).
4. Verify (§5.4).

The installer binaries do **not** move — they remain at their original pathnames (`desktop/windows/Buddysaradhi-1.4.0-x64.msi`, etc.). The stable manifest simply points at the same URLs the staging manifest points at. This is a one-line content change in the manifest, executed in <1 second.

### 6.2 The 24-hour soak

The 24-hour soak between staging promotion and stable promotion is **non-negotiable** in v1. It catches:

- A manifest that parses but has a wrong URL (the staging channel's Tauri updater would have failed to download).
- A signature that's wrong (the staging channel would have refused to install).
- An installer that crashes on first launch (the staging channel's auto-update would have rolled back via the Tauri updater's "rollback on first-launch crash" behaviour — see `desktop/05_Updater.md`).
- A regression in the user-visible flow that the manual smoke missed.

The soak can be shortened for **hotfixes** (see `04_Release_Pipeline.md` §7 — hotfix branch strategy) but never below 1 hour. A 1-hour soak is the absolute floor; below that, the build is not "soaked," it is "rushed."

### 6.3 The "staging stays" rule

After promotion, the staging manifest **stays** pointing at the same version. It is not reset to null. The staging channel continues to poll and see "you're on the latest" until the next build is pushed to staging. This is intentional — staging is a forward-only channel; the production channel inherits from it via promotion, not via reset.

### 6.4 The "promote via workflow_dispatch" gate

Promotion is a **manual** workflow run. The `release.yml` workflow (`05_CI_CD_GitHub_Actions.md` §6) has a `workflow_dispatch` trigger with inputs:

- `version` (the semver to promote, e.g., `1.4.0`)
- `from_channel` (always `staging`)
- `to_channel` (always `stable`)

The workflow reads the staging manifest, validates it, writes the stable manifest, and verifies. The manual trigger is the human-in-the-loop gate that prevents an autonomous agent from accidentally promoting a broken build to all tutors.

---

## 7. Retention policy

### 7.1 Keep last 10 per platform

For each platform (Windows / macOS / Linux / Android sideload), keep the **last 10 versions**. Older versions are auto-deleted by a weekly cron (`release-cron.yml` — runs every Monday 09:00 UTC) that:

1. Lists all objects under `buddysaradhi-releases/desktop/windows/`.
2. Sorts by version (semver-aware sort, not lexicographic).
3. Keeps the top 10.
4. Deletes the rest, including their `.sig` and `.sha256` siblings.

### 7.2 Manifests are never deleted

The `manifests/` directory is **never** pruned. Every manifest ever published stays in Blob. This is the historical record — a tutor on v1.0.0 can still poll `desktop-stable.json` and see "your version is 1.0.0, latest is 1.4.0" indefinitely. (The Tauri updater does not delete old manifests; it just overwrites the same URL.)

If a tutor needs to download a specific old version (e.g., to reproduce a bug on v1.2.0), they cannot — the installer binary is gone (only 10 versions are kept). The manifest still references the URL, but the URL 404s. This is acceptable: we do not support running ancient versions; the auto-updater is the supported path.

### 7.3 Changelogs are never deleted

The `changelogs/` directory is never pruned. Every release's changelog is a permanent historical record, linked from the GitHub Release (which is also permanent). This is the audit trail.

### 7.4 The Blob size budget

Per-platform installer sizes (compressed):

- Windows `.msi`: ~12 MB
- macOS `.dmg`: ~14 MB
- macOS `.app.tar.gz` (delta): ~6 MB
- Linux `.AppImage`: ~13 MB
- Android `.apk`: ~18 MB

10 versions × 5 installers × ~14 MB average = ~700 MB. Plus the manifests (~5 KB each, hundreds of them = ~1 MB) and changelogs (~5 KB each, hundreds = ~1 MB). Total Blob storage: **~702 MB**.

The Hobby plan provides 1 GB. The 702 MB is **70% of the limit** — close to the 80% alert threshold (`01_Vercel_Hosting.md` §8.2). The retention policy of "10 per platform" is calibrated to fit under the 1 GB limit. If we exceed it (e.g., installers grow to 20 MB each), the retention drops to "7 per platform" before the 80% alert fires.

### 7.5 The bandwidth budget

Each installer is downloaded:

- On every new install (one-time, per tutor).
- On every auto-update (one-time per version bump, per tutor).
- On manual download from the web hub (rare; mostly the same as install).

For 500 tutors across 3 platforms (~1,500 install events per release), at ~12 MB average:

- 1,500 × 12 MB = 18 GB per release.
- At 1 release per month: 18 GB/month.

But the Tauri updater uses **delta patches** (the `.app.tar.gz` on macOS, bsdiff on Windows) which are ~6 MB instead of 12 MB. So:

- 1,000 full installs (first-time) × 12 MB = 12 GB.
- 500 auto-updates × 6 MB = 3 GB.
- Total: ~15 GB per release, ~15 GB/month.

Vercel Hobby's Blob egress limit is 10 GB/month. We are **over** the free-tier limit at 500 tutors. The upgrade trigger fires at 8 GB/month (`01_Vercel_Hosting.md` §8.2) — well before we hit the hard cap.

**Conclusion:** the free tier covers Buddysaradhi through the first ~300 tutors. Beyond that, Pro is required, and the Pro tier's 100 GB Blob egress is more than enough.

---

## 8. Access control

### 8.1 Public reads

Every object under `buddysaradhi-releases/` is uploaded with `access: 'public'` (see the `uploadInstaller` function in §3.2). Public reads:

- Do not require authentication.
- Are CDN-cached at the Edge (Vercel's Blob CDN, same as the web app's static assets).
- Have a stable URL: `https://buddysaradhi-releases.vercel-storage.com/<pathname>`.

The Tauri updater polls `manifests/desktop-stable.json` as a public GET. The download hub at `buddysaradhi.app/download` links to the installer URLs as public HTTPS GETs. No auth, no rate limit, no fuss.

### 8.2 Authenticated writes

Writes require the `BLOB_READ_WRITE_TOKEN` (a Vercel-issued token, scoped to the `buddysaradhi-releases` store). The token is:

- Stored as a Vercel env var (`01_Vercel_Hosting.md` §4.2).
- Available only to the `apps/web` server runtime and the GitHub Actions workflows via the `BLOB_READ_WRITE_TOKEN` secret (`05_CI_CD_GitHub_Actions.md` §6).
- **Never** in the client bundle (enforced by the lint gate in `01_Vercel_Hosting.md` §4.3).
- Rotated quarterly (per the env-var matrix).

### 8.3 The "no delete from client" rule

No client-side code path can delete a Blob object. The `del()` function from `@vercel/blob` is only imported in `apps/web/server/blob-admin.ts` (a server-only module) and in the GitHub Actions workflows. The lint rule `no-blob-del-in-client` blocks any `del` import outside `apps/web/server/**`.

### 8.4 The "no upload from client" rule

Symmetrically, no client-side code path can upload a Blob object. The `put()` function is only imported in `apps/web/server/blob-upload.ts` and the GitHub Actions workflows. The lint rule `no-blob-put-in-client` blocks any `put` import outside `apps/web/server/**`.

### 8.5 The admin route

There is one server route that can list + delete Blob objects: `apps/web/app/api/admin/blob/route.ts`. It is:

- Protected by the Supabase admin-role check (only the `buddysaradhi` team owner can call it).
- Logs every call to `audit_log` (`10_Security.md` §8) with action `blob_admin_op`.
- Used for manual cleanup (rare; the weekly cron handles retention automatically).

This is the **only** path a human uses to touch Blob. Everything else is automated.

---

## 9. The download hub (web)

### 9.1 The two download-hub surfaces

Buddysaradhi has **two** download-hub surfaces on the web, both rendered from the same Vercel Blob manifest:

1. **The in-landing-page Download Hub section** (`/#download`) — the primary surface, embedded in the commercial landing page between Pricing and FAQ. The commercial spec for this surface — five DownloadCards (Web, macOS, Windows, Android, iOS), persona narratives, copy, layout intent — is `product/04_Download_Hub.md`. The implementation spec — the `<DownloadHub />` RSC, the `/api/releases/latest` endpoint that merges `desktop-stable.json` and `mobile-stable.json` into a unified shape, the PlatformDetector island, the QR code cards, the install-steps accordion — is `web/07_Landing_Page.md §6`.
2. **The standalone `/download` route** — the secondary surface, for visitors who arrive from a "download Buddysaradhi" Google search, a partner blog link, or a press article. The standalone route is owned by `web/06_Build_and_Release.md` and wraps the same `<DownloadHub />` component in a standard marketing layout (nav + footer).

Both surfaces read from the same Blob manifest, so a release that publishes `desktop-stable.json` and `mobile-stable.json` (per §5) is reflected in both surfaces on the next ISR revalidation (60-second cache). There is one source of truth for the download UI (the `<DownloadHub />` component), not two; the standalone page is a thin wrapper that adds nav + footer + an expanded install guide section.

The route fetches `manifests/desktop-stable.json` and `manifests/mobile-stable.json` at request time (Server Component, ISR with 60-second revalidation, or 1-hour revalidation per `web/07_Landing_Page.md §6.1` for the in-landing variant) and renders the download buttons.

### 9.2 The signature verification UX

For users who want to verify the installer before installing (rare but documented), the `/download` page links to:

- The `.sha256` file for each installer.
- A "How to verify" expandable section explaining `sha256sum Buddysaradhi-1.4.0-x64.msi` and comparing to the published hash.
- The Ed25519 public key (also in `tauri.conf.json` → `plugins.updater.pubkey`) for advanced users who want to verify the `.sig` with `minisign` or `age-verify`.

### 9.3 The "what to do if the signature doesn't match" guidance

If a user's local SHA-256 doesn't match the published one:

1. Re-download (transient corruption).
2. If still mismatched, **do not install** — the binary may have been tampered with.
3. Open an issue on GitHub with the URL, the expected hash, and the actual hash.
4. The release-engineering agent investigates; if the Blob object was tampered with (theoretical — Vercel Blob is immutable), the agent rotates the `TAURI_SIGNING_PRIVATE_KEY` and re-signs + re-uploads every installer.

This scenario has never happened in any project using Vercel Blob + Tauri (as of 2025). It is documented for completeness, not because it is likely.

---

### 9.4 Cross-references for the download hub

| Surface | Spec |
|---|---|
| Commercial / marketing WHAT (five cards, persona narratives, copy, layout intent) | `product/04_Download_Hub.md` |
| Implementation HOW — the `<DownloadHub />` RSC + `/api/releases/latest` endpoint (the in-landing variant) | `web/07_Landing_Page.md §6` |
| Implementation HOW — the standalone `/download` route (the deep-linkable variant) | `web/06_Build_and_Release.md` §8 |
| Manifest schema (the JSON this hub reads) | §4 of this file |
| Bucket layout (the pathnames this hub links to) | §2 of this file |
| Code signing + notarization (the signatures this hub verifies) | `desktop/04_Code_Signing.md` |

---

## 10. The `.buddysaradhi` magic bytes connection

The `.buddysaradhi` backup file (`09_Backup_and_Import_Export.md` §6) starts with the magic bytes `BSR1`. This is a deliberate marker — a tutor can identify a Buddysaradhi backup file with `file Buddysaradhi_Backup.buddysaradhi` or `hexdump -C Buddysaradhi_Backup.buddysaradhi | head -1`.

The installer manifest's `signature` field uses a different magic (`dGhpcyBpcyBh...` base64 — there is no magic, it is a raw Ed25519 signature). The two are **not** related — the manifest signs the installer bytes; the `.buddysaradhi` magic identifies the backup envelope. They are mentioned together here only to disambiguate for a release-engineering agent who might confuse the two.

The **only** place the `BSR1` magic appears in the deployment story is in the **desktop installer's first-launch check**: the Tauri app's Rust code reads `~/.buddysaradhi/backups/*.buddysaradhi` and verifies the magic bytes before offering a restore option. This is a `packages/core` concern (`09_Backup_and_Import_Export.md`), not a Blob concern.

---

## 11. The "what if Blob goes down" plan

Vercel Blob's SLA is 99.9% uptime. The 0.1% downtime (~8 hours/year) is rare but real. The impact:

- The download hub at `/download` returns 500s for the installer URLs.
- The Tauri updater's poll fails; the desktop app shows "couldn't check for updates, will retry in 30 minutes."
- New installs from the web hub fail.

The mitigation:

1. **The Tauri updater is non-blocking.** A failed poll does not crash the app; it just logs and retries. Tutors on the desktop app continue working with their installed version. (`01_Product_Principles.md` P5 — offline-first.)
2. **The download hub falls back to GitHub Releases.** Every installer is also attached to the GitHub Release (see `release.yml` in `05_CI_CD_GitHub_Actions.md` §6). The `/download` page detects Blob failure (500 from the manifest fetch) and falls back to linking the GitHub Release assets instead. GitHub's CDN is independent of Vercel's.
3. **The status page reflects the outage.** The "Desktop Update Server" component on `status.buddysaradhi.app` (`01_Vercel_Hosting.md` §11) flips to "Partial Outage" when the manifest URL returns non-200 for 5 consecutive polls.

This is the **operational resilience** layer. The pipeline is not single-vendor-dependent for the critical "can a tutor install the app" path — GitHub Releases is the fallback.

---

## 12. The cross-cutting contract this file makes

Every release-engineering agent working on Blob agrees to:

1. **Never upload an unsigned installer.** The `desktop-build.yml` workflow signs before upload; if signing fails, the upload step is skipped and the workflow fails.
2. **Never overwrite an existing pathname.** The `addRandomSuffix: false` + idempotency check enforces this; do not bypass it.
3. **Never upload an iOS IPA.** The `no-ios-blob-upload.test.ts` lint rule blocks it; Apple's distribution model does not permit sideload.
4. **Never delete a manifest.** Manifests are permanent; only installer binaries rotate per the retention policy.
5. **Never skip the 24-hour soak** before staging → stable promotion. The soak is the contract between CI and the tutor.
6. **Never promote without `workflow_dispatch`.** Promotion is a human-in-the-loop action; an autonomous agent never auto-promotes.
7. **Always verify the manifest post-write.** The verification step (§5.4) is mandatory; a manifest without verification is not "promoted," it is "speculative."
8. **Always update both staging and stable on a hotfix.** A hotfix that lands on stable but not staging leaves the channels diverged; the next "promote staging → stable" sees the staging channel older than stable and refuses (the workflow's `version_consistency` check).
9. **Always log a Blob admin op to `audit_log`.** The `apps/web/app/api/admin/blob/route.ts` route does this automatically; do not bypass it.
10. **Always test the fallback to GitHub Releases** during a release drill. The fallback is documented but only trusted if exercised.

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`, `BACKUP-1`, `LEDGER-1`). Box widths honour §20.3 rule 2 (80–120 for tree / pipeline diagrams; 60–80 for the manifest schema anatomy). The three mockups below visualise the *artefact registry* this file owns — the bucket layout tree (every directory + the iOS-LOCKED placeholder), the manifest schema anatomy (every field + its consumer), and the atomic-update sequence (the temp-write → verify → delete → write pattern). A fourth mini-mockup annotates the one live UI surface this file references (the download-hub DownloadCard) so the glass / neumorphic contract is visible where it applies.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

This file is the **artefact-registry view**, not a screen spec. Most of its artefacts are tree / sequence / schema diagrams — these are concept diagrams per §20.4, governed by §20.1 + §20.6, and do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the live UI surface this file **feeds but does not own**: the **DownloadCard** rendered on `buddysaradhi.app/download` and `buddysaradhi.app/#download` (commercial spec: `product/04_Download_Hub.md`; implementation spec: `web/07_Landing_Page.md §6`). That card is glass (it is a content surface the tutor reads — version, size, SHA-256); its "Download .apk" / "Download .msi" CTA is neumorphic-raised (it is a control the tutor clicks). The "Verify signature" expandable is a neumorphic-inset chevron (a control). The bucket layout itself is **not** UI — it is the storage topology that the DownloadCard reads.

| Artefact (this file) | Type | Glass / neumo tier (if live UI) |
|---|---|---|
| §13.2 Blob bucket layout tree | Concept diagram (tree) | (none — storage topology) |
| §13.3 Manifest schema anatomy | Concept diagram (schema) | (none — JSON contract) |
| §13.4 Atomic-update sequence | Concept diagram (sequence) | (none — write pattern) |
| §13.5 DownloadCard (consumer = `product/04` + `web/07 §6`) | Live UI surface (downstream) | `.glass` card + `.neumo-raised` "Download" CTA + `.neumo-inset` "Verify signature" chevron |

### 13.2 Blob Bucket Layout Tree

The full directory-style layout under `buddysaradhi-releases/`. Every leaf is an object; every internal node is a path-prefix convention (Blob has no real directories — the `/` is a Vercel-dashboard grouping convention). The `mobile/ios/` directory is the **locked placeholder** — empty, enforced by `no-ios-blob-upload.test.ts` (§2.2). The `manifests/` and `changelogs/` directories are **never pruned** (§7.2, §7.3) — the historical record.

```
  BLOB BUCKET LAYOUT TREE  (§2, the buddysaradhi-releases/ namespace)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │  buddysaradhi-releases/                                                             │
  │  ├── desktop/                          ← Tauri v2 installers (3 platforms)    │
  │  │   ├── windows/                      ← .msi (signtool-signed)                │
  │  │   │   ├── Buddysaradhi-1.4.0-x64.msi            ← current stable (emerald ✓)    │
  │  │   │   ├── Buddysaradhi-1.4.0-x64.msi.sig        ← Ed25519 detached signature    │
  │  │   │   ├── Buddysaradhi-1.3.2-x64.msi            ← prior (retained, amber)       │
  │  │   │   └── Buddysaradhi-1.3.2-x64.msi.sig                                         │
  │  │   ├── macos/                        ← .dmg + .app.tar.gz (delta payload)   │
  │  │   │   ├── Buddysaradhi-1.4.0-universal.dmg     ← current stable (emerald ✓)     │
  │  │   │   ├── Buddysaradhi-1.4.0-universal.dmg.sig                                  │
  │  │   │   ├── Buddysaradhi-1.4.0-universal.app.tar.gz  ← delta-update payload       │
  │  │   │   └── Buddysaradhi-1.4.0-universal.app.tar.gz.sig                           │
  │  │   └── linux/                        ← .AppImage (chmod +x, no installer)   │
  │  │       ├── Buddysaradhi-1.4.0-x86_64.AppImage   ← current stable (emerald ✓)     │
  │  │       └── Buddysaradhi-1.4.0-x86_64.AppImage.sig                                │
  │  │                                                                            │
  │  ├── mobile/                           ← sideload + store binaries             │
  │  │   ├── android/                      ← universal .apk mirrored from EAS     │
  │  │   │   ├── Buddysaradhi-1.4.0-universal.apk     ← current (emerald ✓)             │
  │  │   │   └── Buddysaradhi-1.4.0-universal.apk.sig ← apksigner signature            │
  │  │   └── ios/                          ← ✕ LOCKED (TestFlight only; never     │
  │  │       └── (empty)                     mirrored publicly — §2.2 + §6.3)     │
  │  │                                      ↑ enforced by no-ios-blob-upload.test.ts │
  │  │                                                                            │
  │  ├── manifests/                        ← NEVER deleted (§7.2 — historical)     │
  │  │   ├── desktop-staging.json          ← latest staging build (cyan, in-soak) │
  │  │   ├── desktop-stable.json           ← promoted stable (emerald ✓ live)     │
  │  │   ├── mobile-staging.json           ← mobile sideload manifest             │
  │  │   └── mobile-stable.json            ← mobile sideload stable               │
  │  │                                                                            │
  │  ├── changelogs/                       ← NEVER deleted (§7.3 — audit trail)   │
  │  │   ├── 1.4.0.md                      ← rendered via /api/changelog/:v       │
  │  │   ├── 1.3.2.md                                                             │
  │  │   └── 1.3.1.md                                                             │
  │  │                                                                            │
  │  └── signatures/                       ← detached SHA-256 (secondary check)   │
  │      ├── Buddysaradhi-1.4.0-x64.msi.sha256                                         │
  │      ├── Buddysaradhi-1.4.0-universal.dmg.sha256                                  │
  │      └── Buddysaradhi-1.4.0-x86_64.AppImage.sha256                                │
  │                                                                                │
  │  RETENTION (§7):                                                               │
  │   ↑ installers (desktop/* + mobile/android/*): keep last 10 per platform       │
  │     (release-cron.yml weekly prune, Monday 09:00 UTC)                          │
  │   ↑ manifests/* and changelogs/*: NEVER pruned — the historical record         │
  │   ↑ signatures/*: pruned with their installer sibling                          │
  │                                                                                │
  │  SIZING (§7.4):                                                                │
  │   ↑ 10 versions × 5 installers × ~14 MB avg = ~700 MB                          │
  │   ↑ + manifests (~1 MB) + changelogs (~1 MB) = ~702 MB total                   │
  │   ↑ Hobby limit: 1 GB. 702 MB is 70% — under the 80% alert threshold.          │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is a concept diagram (storage topology), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = current stable (live), amber = prior version
     (retained for rollback), cyan = staging (in-soak, not yet promoted),
     flare = LOCKED (the iOS directory — never written).
   ↑ Cross-refs: §2 (bucket layout), §2.1 (naming conventions), §2.2 (iOS
     locked), §7 (retention), §7.4 (size budget), 03_EAS §6.3 (iOS never
     mirrored), 05_CI_CD §3 (no-ios-blob-upload.test.ts lint rule),
     BACKUP-1 (10_Security.md §15 — installer artifacts ≠ user data).
```

### 13.3 Manifest Schema Anatomy

The JSON contract the Tauri updater polls. Every field has a named consumer (the updater, the download hub, or the forensic debugger). The `signature` field is the **primary** integrity check (Ed25519); the `sha256` field is the **secondary** check (download-hub UI). The `minimum_auto_update_from` field is the breaking-change gate (§4.2).

```
  MANIFEST SCHEMA ANATOMY  (§4, desktop-stable.json field-by-field)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │                                                                              │
  │  {                                                                           │
  │    "version": "1.4.0",                         ← semver string (Rule 6,    │
  │    │                                            AP-17 — never a float)      │
  │    │  consumer: Tauri updater (compares to installed version)               │
  │    │                                                                        │
  │    "pub_date": "2025-08-15T10:30:00Z",         ← ISO 8601                   │
  │    │  consumer: Tauri updater (manifest-rollback-attack defence — skips     │
  │    │            updates older than installed pub_date)                      │
  │    │                                                                        │
  │    "release_notes_url": "https://buddysaradhi.app/api/changelog/1.4.0",           │
  │    │  consumer: desktop "Update available" dialog (links here)              │
  │    │                                                                        │
  │    "minimum_auto_update_from": "1.3.0",         ← semver string             │
  │    │  consumer: Tauri updater (the breaking-change gate — a tutor on 1.2.0  │
  │    │            sees "manual reinstall required", not an auto-update)       │
  │    │  cross-ref: §4.2, 04_Release_Pipeline.md §3.3 (MAJOR releases set      │
  │    │            this to the prior MAJOR, e.g., 2.0.0 → "1.0.0")             │
  │    │                                                                        │
  │    "platforms": {                              ← per-platform download     │
  │      "windows-x86_64": {                       ← Tauri updater key         │
  │        "signature": "dGhpcyBpcyBh...==",       ← base64 Ed25519 (PRIMARY)  │
  │        "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/windows/ │
  │               Buddysaradhi-1.4.0-x64.msi"                                         │
  │      },                                                                     │
  │      "darwin-universal": { ... },              ← macOS fat binary          │
  │      "darwin-aarch64":  { ... },              ← Apple Silicon (same .dmg)  │
  │      "linux-x86_64":    { ... }                                           │
  │    },                                                                       │
  │    │  consumer: Tauri updater (downloads + verifies signature against the   │
  │    │            public key compiled into tauri.conf.json → plugins.updater  │
  │    │            .pubkey; refuses to install on mismatch, writes audit_log   │
  │    │            action = update_signature_mismatch per 10_Security.md §8)   │
  │    │                                                                        │
  │    "sha256": {                                 ← per-platform SHA-256      │
  │      "windows-x86_64": "a3f5b8...",            ← (SECONDARY — download-hub)│
  │      "darwin-universal": "c7e9d2...",                                       │
  │      "darwin-aarch64":  "c7e9d2...",                                       │
  │      "linux-x86_64":    "f1b4c8..."                                        │
  │    },                                                                       │
  │    │  consumer: download hub /download (the "Verify signature" expandable   │
  │    │            on the DownloadCard, §9.2 — for users who manually verify)  │
  │    │                                                                        │
  │    "metadata": {                               ← build provenance          │
  │      "build_commit": "abc1234",                                           │
  │      "build_runner": "github-actions",                                    │
  │      "build_branch": "main"                                               │
  │    }                                                                        │
  │    │  consumer: forensic debugging (NOT consumed by the updater)            │
  │  }                                                                           │
  │                                                                              │
  │  TWO MANIFESTS (§4.4 — why staging + stable):                               │
  │   ↑ desktop-staging.json  → polled by staging-channel desktop app (cyan)    │
  │   ↑ desktop-stable.json   → polled by production desktop app (emerald ✓)    │
  │   ↑ promotion = COPY staging → stable (atomic, no rebuild — §6.1)           │
  │   ↑ rollback   = EDIT stable to point at older installer URL (§6.4)         │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ The anatomy is a concept diagram (JSON contract), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = stable (live), cyan = staging (in-soak),
     amber = breaking-change gate (the minimum_auto_update_from field —
     honoured on MAJOR releases), violet = forensic-only (metadata — not
     consumed by the updater).
   ↑ Cross-refs: §4 (manifest schema), §4.2 (field reference), §4.3
     (Ed25519 signature format), §4.4 (why two manifests), §5.4 (no-partial
     invariant — the verification contract), §6 (promotion), 04 §3.3 (MAJOR
     releases set minimum_auto_update_from), 10_Security.md §8 (audit_log
     action = update_signature_mismatch), BR-LED-01 (immutability — the
     manifest's append-only history mirrors the ledger's), Rule 6 (versions
     are strings, never floats — AP-17 applies to the version field).
```

### 13.4 Atomic Update Sequence

The write-temp-then-rename pattern (§5.2) — the operational workaround for Vercel Blob's lack of native atomic rename. There is a millisecond 404 window between step 3 (delete old) and step 4 (write new); the Tauri updater's retry logic (3 retries, exponential backoff) absorbs it. The verification step (§5.4) is the **contract** — a manifest without verification is "speculative," not "promoted."

```
  ATOMIC UPDATE SEQUENCE  (§5.2 + §5.4, write-temp → verify → delete → write)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │                                                                              │
  │  ACTOR: scripts/build-manifest.mjs  (or scripts/promote-manifest.mjs)       │
  │  TARGET: manifests/desktop-staging.json  (or desktop-stable.json on promo)  │
  │                                                                              │
  │   t0  ┌─────────────────────────────────────────────────────────────────┐   │
  │       │  STEP 1 — WRITE TEMP                                            │   │
  │       │  put("manifests/desktop-staging.json.tmp", newContent,          │   │
  │       │       { addRandomSuffix: false, access: "public" })             │   │
  │       │  ↑ cyan — in-progress write                                     │   │
  │       └─────────────────────────────────────────────────────────────────┘   │
  │                       │                                                      │
  │                       ▼                                                      │
  │   t1  ┌─────────────────────────────────────────────────────────────────┐   │
  │       │  STEP 2 — VERIFY TEMP                                            │   │
  │       │  head("manifests/desktop-staging.json.tmp")                      │   │
  │       │  → read back the bytes                                           │   │
  │       │  → JSON.parse() — fails? abort, leave stable untouched           │   │
  │       │  → assert every platforms.*.url returns HTTP 200                 │   │
  │       │  → assert every platforms.*.signature is non-empty + base64      │   │
  │       │  → assert version matches the git tag                            │   │
  │       │  ↑ emerald ✓ if all assertions pass (the §5.4 contract)         │   │
  │       │  ↑ flare ✕ if any assertion fails → workflow fails, page agent  │   │
  │       └─────────────────────────────────────────────────────────────────┘   │
  │                       │                                                      │
  │                       ▼                                                      │
  │   t2  ┌─────────────────────────────────────────────────────────────────┐   │
  │       │  STEP 3 — DELETE OLD                                             │   │
  │       │  del("manifests/desktop-staging.json")                           │   │
  │       │  ↑ amber — the millisecond 404 window opens here                 │   │
  │       │  ↑ Tauri updater polling in this window: 1 failed poll, retries  │   │
  │       │    in 30s, succeeds on next poll — graceful (§5.2)               │   │
  │       └─────────────────────────────────────────────────────────────────┘   │
  │                       │                                                      │
  │                       ▼                                                      │
  │   t3  ┌─────────────────────────────────────────────────────────────────┐   │
  │       │  STEP 4 — WRITE NEW (verified content)                          │   │
  │       │  put("manifests/desktop-staging.json", verifiedContent,         │   │
  │       │       { addRandomSuffix: false, access: "public" })             │   │
  │       │  ↑ emerald ✓ — manifest is live, atomic, verified               │   │
  │       └─────────────────────────────────────────────────────────────────┘   │
  │                       │                                                      │
  │                       ▼                                                      │
  │   t4  ┌─────────────────────────────────────────────────────────────────┐   │
  │       │  STEP 5 — DELETE TEMP                                            │   │
  │       │  del("manifests/desktop-staging.json.tmp")                      │   │
  │       │  ↑ housekeeping (no contract impact)                            │   │
  │       └─────────────────────────────────────────────────────────────────┘   │
  │                                                                              │
  │  PRO UPGRADE PATH (§5.3 — when Vercel Pro is enabled):                      │
  │   ↑ Blob versioning simplifies: put() keeps the prior version as a         │
  │     numbered historical object. No temp, no delete — just put + verify.    │
  │   ↑ Rollback = restore prior version via the Blob API (no temp-rename).   │
  │   ↑ Until Pro: the temp-rename pattern above is the operational pattern.  │
  │                                                                              │
  │  THE NO-PARTIAL INVARIANT (§5.4 — the contract):                           │
  │   ↑ The CI workflow's final step re-reads the live manifest and re-runs   │
  │     every assertion. If any fails, the workflow fails loudly + pages.     │
  │   ↑ A manifest is NEVER left half-written — verification is the contract. │
  │   ↑ Rule 9 (no silent failures) — the page is the contract's enforcement. │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ The sequence is a concept diagram (write pattern), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: cyan = in-progress write, emerald = verified / live,
     amber = the millisecond 404 window (transient, absorbed by retry),
     flare = verification failure (page agent).
   ↑ Cross-refs: §5.2 (the pattern), §5.3 (Pro upgrade path), §5.4 (the
     no-partial invariant), 02_Vercel_Blob §6.1 (promotion uses this
     pattern), §6.4 (rollback uses this pattern), 04_Release_Pipeline.md
     §6.4 (desktop rollback), 05_CI_CD_GitHub_Actions.md §5 (desktop-build
     final verification step), Rule 9 (no silent failures).
```

### 13.5 DownloadCard (the one live UI surface this file feeds)

The DownloadCard is the consumer of the manifest schema (§13.3) and the bucket layout (§13.2). This file does **not** own the card — the commercial WHAT lives in `product/04_Download_Hub.md` and the implementation HOW lives in `web/07_Landing_Page.md §6`. The mockup below shows the design-system contract that this file's manifest fields populate: the version label, the size label, the SHA-256 (in the "Verify signature" expandable), and the "Download" CTA.

```
  DOWNLOADCARD (Web)  (§9.1, downstream consumer = product/04 + web/07 §6)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  ┌─ .glass card (5% white, 24px blur, §5.5 workhorse tier) ──────────────┐ │
  │  │  ▌ ← 2px emerald accent left-border (§5.4 — status surface)            │ │
  │  │                                                                        │ │
  │  │   Buddysaradhi for the Web                                                  │ │
  │  │   v1.4.0  ·  0 MB (just a link)  ·  opens in your browser              │ │
  │  │                                                                        │ │
  │  │   [ Open Buddysaradhi.app ]   ← control = .neumo-raised (§6.6, §8.2)        │ │
  │  │     ↑ 44×44px touch target (§10.2)                                     │ │
  │  │     ↑ on :active → .neumo-pressed (§6.3) + 1px translate              │ │
  │  │                                                                        │ │
  │  │   › Verify signature   ← control = .neumo-inset chevron (§6.6, §8.5)   │ │
  │  │     (collapsed by default; expands to show SHA-256 from §13.3)         │ │
  │  └────────────────────────────────────────────────────────────────────────┘ │
  │     ↑ content surface = .glass (§5.5 workhorse tier — the version + size   │
  │       + label are read; the card is a surface, not a control)              │
  │     ↑ the CTA "Open Buddysaradhi.app" = control = .neumo-raised                 │
  │     ↑ the "Verify signature" chevron = control = .neumo-inset              │
  │     ↑ never invert: the card is NEVER neumo; the CTA is NEVER glass.       │
  │                                                                              │
  │  FIELD → CARD MAPPING (which §13.3 field feeds which card element):         │
  │   ↑ manifest.version           → "v1.4.0" label                             │
  │   ↑ manifest.platforms.*.url   → CTA href (https://buddysaradhi.app for Web;     │
  │                                  installer URL for macOS/Windows/Linux/     │
  │                                  Android; "TestFlight invite" for iOS)      │
  │   ↑ manifest.sha256.*          → "Verify signature" expandable content      │
  │   ↑ manifest.release_notes_url → "What's new in 1.4.0" link                 │
  │   ↑ Content-Length header      → "0 MB" / "~12 MB" / "~18 MB" size label   │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ This is a live UI surface — the §6.6 single rule applies: card =
     .glass (content), CTA = .neumo-raised (control), chevron =
     .neumo-inset (control).
   ↑ Accent colours: emerald = the accent left-border (status surface,
     §5.4) + the CTA's on-success glow; cyan = the version label (info).
   ↑ Cross-refs: §9.1 (the two download-hub surfaces), §9.2 (signature
     verification UX), product/04_Download_Hub.md (commercial WHAT),
     web/07_Landing_Page.md §6 (implementation HOW), 13_UI_Guidelines.md
     §5.5 (glass card tier), §5.4 (accent border), §6.6 (neumo controls),
     §8.2 (raised button), §8.5 (segmented / chevron inset), §10.2 (44×44px
     touch targets), §10.6 (WCAG §1.4.1 — never colour alone).
```

### 13.6 References (External Design Authorities)

The mockups and the artefact-registry contract in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the bucket layout, the manifest schema, or the atomic-update pattern.

- **Vercel docs** — *Blob Storage, SDK, versioning, access control*. The §13.2 bucket layout tree follows Vercel Blob's directory-convention documentation; the §13.4 atomic-update sequence follows Vercel Blob's immutability-once-written + `addRandomSuffix: false` documentation.
- **Tauri docs** — *Updater plugin, manifest schema, signing keys, pub_date defence*. The §13.3 manifest schema anatomy follows Tauri's updater-plugin manifest documentation; the Ed25519 signature format follows `tauri-signer` documentation.
- **Smashing Magazine** — *Design Systems With Sketches And Wireframes*. The §13.5 DownloadCard mockup follows Smashing's case for ASCII-over-pixels for spec-grade contracts (the card is downstream-owned but the contract is first-party).
- **CSS-Tricks** — *Atomic storage patterns on immutable object stores*. The §13.4 write-temp-then-rename pattern follows CSS-Tricks's primer on atomic updates when the underlying store lacks native rename.
- **Apple Developer docs** — *TestFlight distribution, Ad Hoc limits, App Store review*. The §13.2 `mobile/ios/` LOCKED placeholder follows Apple's distribution-model documentation (no public-URL IPA path).
- **Google Play docs** — *Internal testing, app bundles, versionCode monotonicity*. The §13.2 `mobile/android/` directory follows Play Console's internal-testing + AAB→APK conversion documentation (`bundletool build-apks --mode=universal`).
- **Nielsen Norman Group** — *WCAG §1.4.4 Resize text + §2.4.4 Link purpose*. The §13.5 DownloadCard's "verify signature" expandable + the CTA's text label (never colour alone) follow NN/g's research and `13_UI_Guidelines.md` §10.6.

---

*This file is the operational spec for Vercel Blob as Buddysaradhi's installer registry. It is read by every release-engineering agent before they touch the Blob SDK or the manifest. When this file and the Vercel Blob dashboard disagree, this file wins — unless this file is wrong, in which case you amend this file first, then the dashboard, then the workflow YAML, then the worklog. The order matters.*
