# 05 — Auto-Updater

> The desktop app updates itself silently, signed-ly, and rollback-ably via `tauri-plugin-updater`. The manifest lives on Vercel at `https://buddysaradhi.app/api/releases/desktop/stable`; the binaries live on Vercel Blob. This file is the updater contract: the configuration, the manifest format, the update flow in Rust, the channels (`stable` / `staging`), the rollback policy, the cadence, the never-interrupt-the-user rule, and the signature-verification failure path.

Cross-references: `01_Architecture.md` §10 (build pipeline), `04_Code_Signing.md` §6 (updater keypair rotation — the updater signature is *separate* from the OS code-signing signature), `06_Installers.md` (the installer formats the updater swaps in), `10_Security.md` §14.3 (code signing & updater), `12_Business_Rules.md` BR-SYN-09 (never interrupt the user mid-action — the updater prompts, never forces), `14_Edge_Cases.md` (network-dies-mid-update). **Producer side:** `deployment/02_Vercel_Blob_Build_Storage.md` §2 (bucket layout — where each installer lives), §4 (canonical manifest schema — the full field reference), §5 (atomic update pattern), §6 (staging→stable promotion). **Release flow:** `deployment/04_Release_Pipeline.md` §5 (release checklist), §6.4 (desktop rollback play — manifest edit), §7 (hotfix branch strategy). **Commercial surface:** `product/04_Download_Hub.md` §2 (the five download cards — Mac + Windows cards link to the same Vercel Blob URLs the updater polls), §4 (the web-version CTA — the lowest-friction fallback when an update fails), §6 (install guides embedded on the cards), §8 (bandwidth budget that constrains installer size). The 10 non-negotiable rules in top-level `AGENTS.md` §2 apply unchanged — especially Rule 2 (no network calls that process user data — the update check is a no-PII GET), Rule 3 (no telemetry — the update check sends only `{version, platform}`), Rule 9 (no silent failures — a signature failure is audited + surfaced, never silently swallowed).

---

## 1. The Updater at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│  App launches.                                                  │
│  Rust spawns a tokio task: run_periodic_check().                │
│  The task calls tauri-plugin-updater::check() on launch +       │
│  every 6 hours while the app is open.                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  check() fetches the manifest from:                             │
│    https://buddysaradhi.app/api/releases/desktop/<channel>           │
│  (channel = 'stable' by default; 'staging' if the user opted    │
│  in via Settings → Advanced → Update channel.)                  │
│                                                                  │
│  The manifest is signed with minisign / Tauri updater signature.│
│  The updater verifies the signature with the pubkey pinned in   │
│  tauri.conf.json.                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  If manifest.version > app.version:                             │
│    Show toast: "Update available (v1.4.3). Restart now or       │
│    tonight at 3 AM?" — per BR-SYN-09 (never interrupt mid-action)│
│                                                                  │
│  If user clicks "Restart now":                                  │
│    1. Download the binary for this platform from manifest URL.  │
│    2. Verify the binary's signature against the manifest.       │
│    3. Write to a temp path.                                     │
│    4. Rename current binary to .bak.                            │
│    5. Rename temp to the production path.                       │
│    6. Restart the app.                                          │
│                                                                  │
│  If user clicks "Tonight at 3 AM":                              │
│    Schedule a background update at 3 AM local.                  │
│    The app silently updates + restarts (with a brief toast).    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  On next launch, the app checks for a "first-launch-after-      │
│  update" flag. If set:                                          │
│    - Run smoke tests (DB opens, keychain accessible).           │
│    - If smoke tests pass: delete the .bak, clear the flag.      │
│    - If smoke tests fail (3x in a row across launches):         │
│      rollback to the .bak, log audit 'updater_rollback',        │
│      show flare toast "Update failed — reverted to v1.4.2."     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. The `tauri.conf.json` Configuration

```json
// src-tauri/tauri.conf.json (excerpt — plugins block)
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://buddysaradhi.app/api/releases/desktop/stable"
      ],
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEY5RkQ4NUI4QjcxQzI2NEQKUldSbGRtRnVaU0JrWVhSbGJYQnZaSFZqWVd0a01WUkRVV1JDVFcwS05EVkdWV2RJVWsxSVRteEphWE5DVnpGQ1JYSTRVa2RVTUV3eQo=",
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### 2.1 Field Reference

| Field | Value | Why |
|---|---|---|
| `active` | `true` | Enables the updater plugin. |
| `endpoints` | `["https://buddysaradhi.app/api/releases/desktop/stable"]` | The manifest URL. The endpoint is a Vercel-hosted route (Next.js API route or a static JSON file on Vercel Blob). |
| `pubkey` | Base64-encoded Ed25519 public key | Pinned in the binary; the trust root for updater signatures. Rotated per-major-version (`04_Code_Signing.md` §6.1). |
| `windows.installMode` | `"passive"` | Windows MSI install mode: `passive` shows a progress bar but no user interaction; `quiet` shows nothing; `basicUi` shows a basic UI. We use `passive` for transparency. |

### 2.2 The Channel Switch

The `endpoints` array is single-element by default (`stable`). When the user opts into the staging channel (Settings → Advanced → Update channel), the Rust code swaps the endpoint to `https://buddysaradhi.app/api/releases/desktop/staging` at runtime:

```rust
// src-tauri/src/updater.rs
fn endpoint_for_channel(channel: &str) -> String {
    match channel {
        "staging" => "https://buddysaradhi.app/api/releases/desktop/staging",
        _ => "https://buddysaradhi.app/api/releases/desktop/stable",
    }.to_string()
}

pub async fn check_for_update(app: &AppHandle) -> Result<Option<Update>, Error> {
    let settings = app.state::<AppState>().settings.read().await;
    let channel = settings.update_channel.as_str();
    let endpoint = endpoint_for_channel(channel);

    let updater = tauri_plugin_updater::UpdaterBuilder::new(app)
        .endpoints(vec![endpoint])
        .build()?;

    match updater.check().await? {
        Some(update) => Ok(Some(update)),
        None => Ok(None),
    }
}
```

The channel is stored in the `settings` table (`update_channel TEXT NOT NULL DEFAULT 'stable'`). The staging channel is for power users who want to test new features before stable release; it is documented as "may have bugs" in the Settings UI.

---

## 3. The Manifest Format

The endpoint `https://buddysaradhi.app/api/releases/desktop/stable` returns a JSON manifest. The full canonical schema is owned by `deployment/02_Vercel_Blob_Build_Storage.md §4`; this section reproduces it verbatim and adds the desktop-specific commentary. If the two ever diverge, `deployment/02` wins (per `desktop/README.md §10.2`).

```json
{
  "version": "1.4.3",
  "pub_date": "2026-06-27T10:00:00Z",
  "release_notes_url": "https://buddysaradhi.app/api/changelog/1.4.3",
  "minimum_auto_update_from": "1.3.0",
  "platforms": {
    "windows-x86_64": {
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/windows/Buddysaradhi-1.4.3-x64.msi",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIFR1dG9yT1MgdXBkYXRlciBrZXkKUldSbGRtRnVaU0JrWVhSbGJYQnZaSFZqWVd0a01WUkRVV1JDVFcwS05EVkdWV2RJVWsxSVRteEphWE5DVnpGQ1JYSTRVa2RVTUV3eQo=:eyJhbGciOiJFZERTQSJ9...."
    },
    "darwin-universal": {
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/macos/Buddysaradhi-1.4.3-universal.dmg",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    },
    "darwin-aarch64": {
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/macos/Buddysaradhi-1.4.3-universal.dmg",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    },
    "linux-x86_64": {
      "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/linux/Buddysaradhi-1.4.3-x86_64.AppImage",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    }
  },
  "sha256": {
    "windows-x86_64": "a3f5b8c7d2e9...",
    "darwin-universal": "c7e9d2a3f5b8...",
    "darwin-aarch64": "c7e9d2a3f5b8...",
    "linux-x86_64": "f1b4c8e9a7d2..."
  },
  "metadata": {
    "build_commit": "abc1234",
    "build_runner": "github-actions",
    "build_branch": "main"
  }
}
```

### 3.1 Field Reference

| Field | Type | Purpose |
|---|---|---|
| `version` | string (semver) | The new version. The updater compares this to `app.version` (from `tauri::App::config().version`); if greater, an update is available. |
| `pub_date` | ISO 8601 datetime | When the manifest was published. Used for caching and as a manifest-rollback defence (the updater skips updates whose `pub_date` is older than the installed version's `pub_date`). |
| `release_notes_url` | string (URL) | Where the desktop app's "Update available" dialog fetches the changelog Markdown. Rendered by the frontend via `react-markdown`. The URL points at `/api/changelog/<version>` on the web app, which streams the `changelogs/<version>.md` file from Vercel Blob (per `deployment/02 §2.3`). |
| `minimum_auto_update_from` | string (semver) | The oldest version that can auto-update to `version`. A tutor on `1.2.0` with `minimum_auto_update_from: 1.3.0` sees a "manual reinstall required" dialog instead of an auto-update prompt. This is the breaking-change gate — a MAJOR version bump (per `deployment/04 §3.3`) sets this to the previous MAJOR. |
| `platforms` | object | Per-platform download URLs + Ed25519 signatures. |
| `platforms.<platform>.url` | HTTPS URL | The Vercel Blob URL of the installer. Must be HTTPS. The URL pattern is `https://buddysaradhi-releases.vercel-storage.com/desktop/<os>/Buddysaradhi-<version>-<arch>.<ext>` (per `deployment/02 §2.1`). |
| `platforms.<platform>.signature` | base64 string | The Tauri updater signature of the binary. Computed at build time via `tauri signer sign` using the `TAURI_SIGNING_PRIVATE_KEY` (stored as a GitHub Actions secret). |
| `sha256` | object | Per-platform SHA-256 of the installer bytes. Consumed by the download hub at `product/04_Download_Hub.md §2.2` (card item 7 — the truncated SHA-256 caption) as a secondary hash check for users who manually verify before installing. Not consumed by the auto-updater (the Ed25519 signature is the primary integrity check). |
| `metadata` | object | Build provenance: `build_commit` (git SHA), `build_runner` (`github-actions`), `build_branch` (`main` / `release/*`). Used for forensic debugging when a tutor reports an update failure; not consumed by the updater. |

### 3.2 The Platform Keys

| Key | OS | Architecture |
|---|---|---|
| `windows-x86_64` | Windows 10/11 | x86_64 |
| `darwin-universal` | macOS 11+ | Universal (Apple Silicon + Intel) |
| `darwin-aarch64` | macOS 11+ | Apple Silicon only (we ship universal, so this is unused) |
| `darwin-x86_64` | macOS 11+ | Intel only (we ship universal, so this is unused) |
| `linux-x86_64` | Linux | x86_64 |

The updater picks the platform key matching the current OS + architecture. If the current platform is not in the manifest (e.g. a Linux ARM user), the updater logs a debug message and does not update — the user is told "no update available for your platform" if they manually check.

### 3.3 The Signature

The signature is computed at build time:

```bash
# Generate the keypair (one-time, on a secure machine)
$ tauri signer generate -w ~/.tauri/buddysaradhi-updater.key
# Private key saved to ~/.tauri/buddysaradhi-updater.key
# Public key printed to stdout — this goes into tauri.conf.json's `pubkey` field

# Sign a binary
$ tauri signer sign -k ~/.tauri/buddysaradhi-updater.key \
    -w $TAURI_KEY_PASSWORD \
    Buddysaradhi-1.4.3-x64.msi
# Signature printed to stdout — this goes into the manifest's `signature` field
```

The private key (`~/.tauri/buddysaradhi-updater.key`) is stored in GitHub Actions secrets as `TAURI_PRIVATE_KEY`. The password is stored as `TAURI_KEY_PASSWORD`. The public key is pinned in `tauri.conf.json` and shipped with every binary — it is the trust root for the updater.

### 3.4 The Manifest Is Itself Signed

The manifest at the endpoint is served over HTTPS, which provides transport integrity. But HTTPS alone is not enough — if `buddysaradhi.app` is compromised, an attacker could serve a malicious manifest. The Tauri updater additionally verifies the manifest's signature using the pinned pubkey. To be precise: Tauri v2's updater does not sign the manifest itself; it signs the *binary* (the `signature` field in each platform entry). The manifest's integrity is provided by HTTPS + the fact that the binary's signature is verified against the pinned pubkey.

If `buddysaradhi.app` is compromised, an attacker could swap the binary URL to point to their own server. But the binary they serve must be signed with our private key — which they don't have. So even with a compromised manifest, the binary signature check catches the attack. The trust root is the pinned pubkey, not the manifest URL.

A secondary defence is the `pub_date` field: the updater refuses to "update" to a manifest whose `pub_date` is older than the installed version's `pub_date`. This blocks manifest-rollback attacks where a compromised endpoint serves an older (but still validly signed) manifest to keep users on a vulnerable version. The `sha256` field is a third belt-and-braces check — the download hub at `product/04_Download_Hub.md §2.2` displays it so a paranoid user can verify the hash manually before installing.

---

## 4. The Update Flow (Rust)

```rust
// src-tauri/src/updater.rs
// Implements: Buddysaradhi_Planning/desktop/05_Updater.md §4

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use crate::{AppState, Error, security::audit};
use std::time::Duration;
use tokio::time;

pub async fn run_periodic_check(app: AppHandle) {
    // Initial check on launch (after a 30s delay to let the app settle).
    time::sleep(Duration::from_secs(30)).await;
    let _ = check_and_prompt(&app).await;

    // Then every 6 hours.
    let mut interval = time::interval(Duration::from_secs(6 * 60 * 60));
    loop {
        interval.tick().await;
        let _ = check_and_prompt(&app).await;
    }
}

async fn check_and_prompt(app: &AppHandle) -> Result<(), Error> {
    let Some(update) = check_for_update(app).await? else {
        return Ok(());  // No update available.
    };

    let current_version = app.package_info().version.to_string();
    let new_version = update.version.clone();
    tracing::info!("update available: {} → {}", current_version, new_version);

    // Emit an event to the frontend; the frontend shows the toast with
    // "Restart now" / "Tonight at 3 AM" / "Skip this version" buttons.
    app.emit("update-available", UpdateAvailablePayload {
        current_version,
        new_version: new_version.clone(),
        notes: update.body.clone(),
        pub_date: update.date.clone(),
    })?;

    Ok(())
}

async fn check_for_update(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, Error> {
    let state = app.state::<AppState>();
    let settings = state.settings.read().await;
    let channel = settings.update_channel.as_str();
    let endpoint = endpoint_for_channel(channel);

    let updater = app.updater_builder()
        .endpoints(vec![endpoint])
        .build()
        .map_err(|e| Error::Sync(format!("updater builder: {e}")))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(Some(update)),
        Ok(None) => Ok(None),
        Err(e) => {
            tracing::warn!("updater check failed: {e:?}");
            // Do NOT propagate — updater failures are not user-visible errors
            // (the user might be offline; the endpoint might be down).
            // Log and move on; the next periodic check will retry.
            Ok(None)
        }
    }
}

#[derive(serde::Serialize, Clone)]
struct UpdateAvailablePayload {
    current_version: String,
    new_version: String,
    notes: String,
    pub_date: String,
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    schedule: UpdateSchedule,  // 'now' | 'tonight' | 'skip'
) -> Result<(), Error> {
    let state = app.state::<AppState>();

    match schedule {
        UpdateSchedule::Now => {
            install_now(&app).await?;
        }
        UpdateSchedule::Tonight => {
            // Schedule a background task for 3 AM local.
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                install_at_night(&app_clone).await;
            });
        }
        UpdateSchedule::Skip => {
            // Record the skipped version; the updater will not prompt again
            // until a newer version is available.
            let mut settings = state.settings.write().await;
            settings.skipped_update_version = Some(get_latest_version(&app).await?);
            settings.save(&state.db.lock())?;
        }
    }
    Ok(())
}

async fn install_now(app: &AppHandle) -> Result<(), Error> {
    let Some(update) = check_for_update(app).await? else {
        return Ok(());  // Race: the update disappeared.
    };

    // 1. Download the binary. Tauri's updater handles this internally
    //    when we call update.download_and_install().
    // 2. Verify the binary's signature against the pinned pubkey.
    //    (Tauri does this automatically — it will reject an unsigned or
    //    wrongly-signed binary with an error.)
    // 3. Write to a temp path, then swap on restart.

    let mut update_buffer = Vec::new();
    update.download(|chunk, _| {
        update_buffer.extend_from_slice(chunk);
        // Could emit progress events to the frontend here.
        true
    }).await
    .map_err(|e| Error::Sync(format!("download failed: {e}")))?;

    // 4. Pre-flight: write a "first-launch-after-update" flag.
    //    On next launch, smoke tests will run; if they fail 3x, rollback.
    let store = tauri_plugin_store::StoreExt::get_store(app, ".store.dat")?;
    store.set("updater.pending_version", serde_json::json!(update.version));
    store.set("updater.fail_count", serde_json::json!(0));
    store.save()?;

    // 5. Install (swap on next restart).
    update.install().await
        .map_err(|e| Error::Sync(format!("install failed: {e}")))?;

    // 6. Audit log.
    let state = app.state::<AppState>();
    audit::write(&state.db.lock(), &tenant_id(&state)?, "system",
        "updater_installed", "app", "", serde_json::json!({
            "from_version": app.package_info().version.to_string(),
            "to_version": update.version,
        }))?;

    // 7. Restart.
    app.restart();

    Ok(())
}

async fn install_at_night(app: &AppHandle) {
    // Sleep until 3 AM local.
    let now = chrono::Local::now();
    let tomorrow_3am = (now.date_naive() + chrono::Duration::days(1))
        .and_hms_opt(3, 0, 0)
        .unwrap();
    let duration = (tomorrow_3am - now.naive_local()).to_std().unwrap_or(Duration::from_secs(0));
    time::sleep(duration).await;

    // Check the app is idle (no recent user input in the last 5 min).
    if !is_app_idle(app).await {
        // Reschedule for the next night.
        return install_at_night(app).await;
    }

    if let Err(e) = install_now(app).await {
        tracing::warn!("nightly update failed: {e:?}");
        // Audit log + flare toast on next user interaction.
        let state = app.state::<AppState>();
        let _ = audit::write(&state.db.lock(), &tenant_id(&state).ok().unwrap_or_default(),
            "system", "updater_nightly_failed", "app", "",
            serde_json::json!({"error": e.to_string()}));
    }
}

async fn is_app_idle(app: &AppHandle) -> bool {
    // Implementation: check the last user input timestamp (tracked by
    // a global mouse/keyboard listener on the webview).
    let state = app.state::<AppState>();
    let session = state.session.lock().unwrap();
    if let Some(last) = session.last_user_input {
        last < chrono::Utc::now() - chrono::Duration::minutes(5)
    } else {
        true  // No input tracked yet — treat as idle.
    }
}

fn endpoint_for_channel(channel: &str) -> String {
    match channel {
        "staging" => "https://buddysaradhi.app/api/releases/desktop/staging",
        _ => "https://buddysaradhi.app/api/releases/desktop/stable",
    }.to_string()
}
```

### 4.1 The Frontend Side

```tsx
// apps/desktop/src/lib/updater.ts
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./invoke";
import { toast } from "./useToast";

export type UpdateSchedule = "now" | "tonight" | "skip";

export function initUpdaterListener() {
  return listen<{ current_version: string; new_version: string; notes: string }>(
    "update-available",
    (event) => {
      const { current_version, new_version, notes } = event.payload;
      toast({
        title: `Update available — v${new_version}`,
        description: notes.split("\n")[0],  // First line of release notes.
        duration: 60_000,  // 1 minute — give the user time to decide.
        action: {
          label: "Restart now",
          onClick: () => invoke("download_and_install_update", { schedule: "now" }),
        },
        secondaryAction: {
          label: "Tonight at 3 AM",
          onClick: () => invoke("download_and_install_update", { schedule: "tonight" }),
        },
        dismissAction: {
          label: "Skip this version",
          onClick: () => invoke("download_and_install_update", { schedule: "skip" }),
        },
      });
    },
  );
}
```

The toast uses the `glass-strong` tier per `13_UI_Guidelines.md` §8.8 with a violet accent (informational, not destructive — destructive would be flare). The toast is persistent (60-second duration, not the default 4s) because the user needs time to read the release notes and decide.

---

## 5. Update Check Cadence

| Trigger | When | Behaviour |
|---|---|---|
| App launch | 30 seconds after the app starts (lets the DB + sync settle) | `check_for_update` → if update available, emit `update-available` event. |
| Periodic | Every 6 hours while the app is open | Same as above. |
| Manual | User clicks "Check for updates" in Settings → Advanced | Same, but if no update, show "You're on the latest version." toast. |
| After a skipped version | When the user clicks "Skip this version", the skipped version is recorded. The updater only re-prompts for versions newer than the skipped one. |

The 6-hour cadence is a balance: short enough that security updates reach users within a working day, long enough that the periodic check doesn't drain battery or bandwidth. The check is a single HTTPS GET (~2 KB response); negligible overhead.

### 5.1 Why 30s After Launch (Not 0s)

On launch, the app is doing a lot: opening the SQLCipher DB, running migrations, fetching the Supabase session, initial sync. Adding an updater check at t=0 competes for network + CPU and could slow the first paint. The 30s delay lets the app settle before the updater asks "is there a new version?".

### 5.2 Why Not on App Exit

A check on exit would catch users who open the app briefly and close it. But:

- The exit path is the worst time to ask "restart now?" — the user is closing the app, not opening it.
- An exit-time download would compete with the OS's quit-shutdown timeout.
- The nightly 3 AM install handles the "user closed the app" case if they had clicked "Tonight at 3 AM".

We accept that very-short sessions (open + close in < 30s) skip the update check. The next launch will catch it.

---

## 6. The Never-Interrupt Rule (BR-SYN-09)

> **BR-SYN-09:** The updater never interrupts the user mid-action. If the user is in the middle of a sensitive flow (entering a PIN, recording a payment, marking attendance), the updater waits.

The desktop app implements this via the `is_app_idle` check (§4) — the nightly install only proceeds if the app has been idle for 5+ minutes. For the "Restart now" path, the user has explicitly clicked the button, so they have consented to the interruption.

### 6.1 What Counts as "Mid-Action"

The frontend tracks a `isUserInSensitiveFlow` flag (Zustand store) that is set to `true` when:

- A PIN prompt is open.
- A payment is being recorded (form is dirty + amount field is non-empty).
- Attendance is being marked (a batch grid is open + at least one toggle has been changed but not saved).
- A backup is being created or restored.
- A drawer is open with unsaved changes.

When `isUserInSensitiveFlow` is `true`, the `update-available` toast is deferred until the flag flips back to `false`. This is implemented by the frontend's `initUpdaterListener`:

```tsx
// apps/desktop/src/lib/updater.ts (continued)
import { useAppStore } from "./store";

export function initUpdaterListener() {
  return listen<UpdateAvailablePayload>("update-available", (event) => {
    const { isUserInSensitiveFlow } = useAppStore.getState();
    if (isUserInSensitiveFlow) {
      // Defer — store the payload and show the toast when the flag flips.
      useAppStore.getState().pendingUpdate = event.payload;
    } else {
      showUpdateToast(event.payload);
    }
  });
}

// In the GlassShell, a useEffect watches for isUserInSensitiveFlow flipping
// to false; if pendingUpdate is set, it shows the toast then clears the pending.
```

### 6.2 The "Restart now" Confirmation

Even with the never-interrupt rule, clicking "Restart now" is a destructive action (closes the app). The toast's "Restart now" button has a two-click confirmation: the first click changes the button to "Are you sure? Click again to restart." (5-second timeout), the second click triggers the restart. This mirrors the typed-confirm pattern from `08_Settings.md` for destructive actions.

---

## 7. Rollback Policy

If an update fails to launch successfully 3 times in a row, the updater rolls back to the previous binary.

### 7.1 The Rollback Mechanism

Tauri's updater keeps the previous binary as `<binary_path>.bak` after a successful install. On every launch, the app checks the `updater.pending_version` flag in the store:

- If `pending_version` is set, this is the first launch after an update. The app runs smoke tests:
  1. Open the SQLCipher DB.
  2. Read a row from `settings`.
  3. Read a row from `audit_log` (verifies the chain isn't broken).
  4. Emit a `window-shown` event (verifies the webview is responsive).
- If the smoke tests pass: delete the `.bak`, clear the `pending_version` flag, reset `fail_count` to 0.
- If the smoke tests fail: increment `fail_count`. If `fail_count >= 3`:
  - Restore the `.bak` (rename `.bak` to the production path).
  - Write `audit_log` row `action='updater_rollback'` with `metadata={from_version: pending_version, to_version: previous_version, fail_count}`.
  - Clear `pending_version` + `fail_count`.
  - Show a flare error toast: "Update failed — reverted to v1.4.2. The Buddysaradhi team has been notified (no telemetry — please report this in Settings → Diagnostics)."
  - Skip the next auto-update for this version (write `skipped_update_version = pending_version`).

### 7.2 The Three-Failure Threshold

The 3-failure threshold is a balance:

- **1 failure:** Too aggressive — a single bad launch (e.g. the user force-quit during boot) would trigger rollback.
- **3 failures:** Catches real update bugs (the app consistently fails to launch with the new binary) while tolerating transient issues.
- **5+ failures:** Too lax — the user has to relaunch the broken app 5 times before rollback.

### 7.3 What About the Database Schema?

If a new version ships a migration that the rollback binary doesn't understand, the rollback binary will fail to open the DB. This is the "schema-drift on rollback" problem. Mitigations:

- **Migrations are forward-only** (`11_Data_Model.md` P-DM8). A new version's migrations are additive (new tables, new columns with defaults). The old binary ignores the new tables/columns — it just doesn't read them.
- **The old binary refuses to open a DB with a newer `schema_version`** (per `BR-SYN-05`). On rollback, if the new version ran a migration, the old binary shows "Database was migrated to v2 by v1.4.3. Please reinstall v1.4.3 or restore from a v1.4.2 backup." This is the worst case — and it's why the nightly 3 AM install (not "restart now") is the recommended path: it gives the user time to notice and restore.

---

## 8. Signature Verification Failure

If the binary's signature does not verify (the manifest's `signature` field doesn't match the binary's content signed with our private key), the updater:

1. Aborts the install. The current binary is untouched.
2. Writes `audit_log` row `action='updater_signature_failed'` with `metadata={version: attempted_version, url: attempted_url}`.
3. Shows a flare error toast: "Update verification failed. This could be a network error or a security issue. The Buddysaradhi team has been notified (no telemetry — please report this in Settings → Diagnostics)."
4. Does NOT retry until the next periodic check (6 hours).

### 8.1 Why Flare (Not Violet)

Signature verification failure is a potential security incident — it could mean:

- The Vercel Blob storage was compromised and the binary was tampered with.
- The manifest was tampered with to point to a different (attacker-controlled) binary.
- Our private key was compromised and an attacker signed a malicious binary.

Per `13_UI_Guidelines.md` §2.4, flare (#FF5E00) is the destructive / security-warning accent. The user should pay attention.

### 8.2 What the User Should Do

The toast offers two actions:

- **"Report to Buddysaradhi"** — opens the default email client with a pre-filled message to `security@buddysaradhi.app` containing the audit log entry (no PII, just the version + URL + timestamp).
- **"Retry later"** — dismisses the toast; the updater will retry on the next periodic check.

The user is NOT offered a way to bypass the signature check. There is no "install anyway" button. This is non-negotiable.

---

## 9. Channels

| Channel | Endpoint | Audience | Stability |
|---|---|---|---|
| `stable` | `/api/releases/desktop/stable` | All users (default) | Production-ready; passed the staging channel's smoke tests. |
| `staging` | `/api/releases/desktop/staging` | Power users who opt in via Settings → Advanced → Update channel | Pre-release; may have bugs; used for beta testing. |

The staging channel ships the same binaries that passed CI, plus a `pub_date` earlier than stable. The staging manifest points to binaries in a separate Vercel Blob path (`manifests/desktop-staging.json` per `deployment/02 §4.4`, with binaries under `desktop/<os>/Buddysaradhi-<version>-<arch>.<ext>` — the staging binaries are visually distinct in the Blob dashboard because the manifest filename differs, even though the binaries themselves use the same naming convention as stable). The promotion from staging to stable is an atomic copy of the staging manifest to the stable manifest — no rebuild, no re-sign (per `deployment/02 §6`).

### 9.1 The Channel Switch

The user switches channels in Settings → Advanced → Update channel. The switch:

1. Updates `settings.update_channel` in the DB.
2. Appends an `audit_log` row `action='update_channel_changed'`.
3. Triggers an immediate `check_for_update` (so the user sees the staging version's release notes right away).

### 9.2 Downgrade Protection

If the user is on stable v1.4.3 and switches to staging which has v1.4.2 (older), the updater does NOT offer a downgrade. The `version` field in the manifest is compared with `>`; equal or lower versions are ignored. To downgrade, the user must uninstall + reinstall the older binary manually.

---

## 10. The Web-Side Manifest Endpoint

The manifest at `/api/releases/desktop/stable` is served by the web app (Next.js API route or a static JSON file on Vercel Blob). Two options:

### 10.1 Option A: Static JSON on Vercel Blob (Canonical — Used for v1.x)

The manifest is a static JSON file at `manifests/desktop-stable.json` on Vercel Blob (per `deployment/02_Vercel_Blob_Build_Storage.md §2` + `§4`). The web app's Next.js rewrite rule routes `/api/releases/desktop/stable` to `https://buddysaradhi-releases.vercel-storage.com/manifests/desktop-stable.json`. The release workflow uploads the manifest as part of the build (after the binaries are uploaded — per `deployment/02 §3` and `desktop/04_Code_Signing.md` §6).

**Pros:** Zero compute cost; served from Vercel's CDN; atomic updates (the upload-then-swap pattern in `deployment/02 §5` means there's never a half-written manifest).
**Cons:** Updating the manifest requires uploading a new file (the release workflow handles this — see `scripts/update-release-manifest.ts` below).

### 10.2 Option B: Next.js API Route (Reserved for v2.x)

The web app has a route `/app/api/releases/desktop/[channel]/route.ts` that reads the manifest from Vercel Blob (or a Turso DB table) and returns it as JSON.

**Pros:** Dynamic — can include user-specific data (not currently needed); can be cached at the edge.
**Cons:** Compute cost (negligible at our scale); adds a hop (the API route reads from Blob, then serves the client) — Option A removes that hop.

The desktop app uses **Option A** for v1.x. The manifest is a static JSON file, served from Vercel Blob, cached at the edge. The release workflow uploads `manifests/desktop-stable.json` after all three platform binaries are uploaded and signed.

### 10.3 The Release Workflow (Web Side)

```ts
// scripts/update-release-manifest.ts
import { put } from "@vercel/blob";
import { readFileSync } from "fs";

const [, , version, platform, url, signature] = process.argv;

// Fetch the existing manifest (or start fresh).
const existing = await fetch("https://buddysaradhi-releases.vercel-storage.com/manifests/desktop-stable.json");
const manifest = existing.ok ? await existing.json() : {
  version,
  pub_date: new Date().toISOString(),
  release_notes_url: `https://buddysaradhi.app/api/changelog/${version}`,
  minimum_auto_update_from: "1.3.0",  // bumped per MAJOR release
  platforms: {},
  sha256: {},
  metadata: { build_commit: process.env.GITHUB_SHA!, build_runner: "github-actions", build_branch: process.env.GITHUB_REF_NAME! },
};

// Update the version + pub_date + platform entry.
manifest.version = version;
manifest.pub_date = new Date().toISOString();
manifest.platforms[platform] = { url, signature };

// Compute the SHA-256 of the binary (the download hub displays it as a secondary check).
manifest.sha256[platform] = await sha256OfUrl(url);

// Upload the updated manifest (atomic per deployment/02 §5 — upload to a temp path, then swap).
await put("manifests/desktop-stable.json", JSON.stringify(manifest, null, 2), {
  access: "public",
  contentType: "application/json",
  addRandomSuffix: false,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});
```

The script is idempotent — running it twice with the same parameters produces the same manifest. The release workflow runs it once per platform (Windows, macOS, Linux) in sequence; the final run produces the complete manifest with all three platforms. The script is invoked from the `release.yml` GitHub Actions workflow (`desktop/04_Code_Signing.md` §6 + `deployment/05_CI_CD_GitHub_Actions.md` §6).

---

## 11. Cross-Reference Summary

| Topic in this file | Master / platform spec cross-ref |
|---|---|
| Updater signature (separate from OS signing) | `10_Security.md` §14.3, `04_Code_Signing.md` §6.1 |
| Never-interrupt rule | `12_Business_Rules.md` BR-SYN-09 |
| No telemetry (update check sends only version + platform) | `10_Security.md` §17 (TELE-1), top-level `AGENTS.md` §2 Rule 3 |
| No silent failures (signature failure audited + surfaced) | top-level `AGENTS.md` §2 Rule 9 |
| Schema-drift on rollback | `12_Business_Rules.md` BR-SYN-05 |
| Distribution milestone | `15_Future_Roadmap.md` v1.4 |
| Build pipeline | `01_Architecture.md` §10 |
| Canonical manifest schema (full field reference) | `deployment/02_Vercel_Blob_Build_Storage.md` §4 |
| Bucket layout (where each installer lives) | `deployment/02_Vercel_Blob_Build_Storage.md` §2 |
| Atomic update pattern (upload-then-swap, never overwrite in place) | `deployment/02_Vercel_Blob_Build_Storage.md` §5 |
| Staging→stable promotion (copy manifest, no rebuild) | `deployment/02_Vercel_Blob_Build_Storage.md` §6 |
| Release checklist (15 items — desktop is item 4) | `deployment/04_Release_Pipeline.md` §5 |
| Desktop rollback play (manifest edit, no re-sign) | `deployment/04_Release_Pipeline.md` §6.4 |
| Hotfix branch strategy | `deployment/04_Release_Pipeline.md` §7 |
| "Same version on the same day" rule | `deployment/04_Release_Pipeline.md` §8.1 |
| Commercial download hub (Mac + Windows cards → same Vercel Blob URLs) | `product/04_Download_Hub.md` §2 |
| Install guides on the download cards | `product/04_Download_Hub.md` §6 |
| Bandwidth budget that constrains installer size | `product/04_Download_Hub.md` §8 |

---

## 12. What This File Does NOT Cover

- **OS code signing (EV cert, notarization, GPG)** → `04_Code_Signing.md`.
- **Installer formats (WiX, DMG, AppImage)** → `06_Installers.md`.
- **Rust command implementations** → `02_Rust_Core.md`.
- **Capability allowlist, CSP, file scope** → `03_IPC_Security.md`.

---

## 13. The Updater Test Plan (Pre-Release)

Before announcing a release, the following end-to-end test must pass on all three OSes:

1. **Fresh install:** Install v1.4.2 from the download hub. Verify it launches.
2. **Pre-stage the update:** Bump the manifest to v1.4.3 on the staging channel.
3. **Switch to staging:** In Settings → Advanced → Update channel → "Staging".
4. **Wait for the prompt:** Within 30s, the "Update available" toast appears.
5. **Click "Restart now":** Confirm the two-click confirmation. The app downloads, verifies, swaps, restarts.
6. **Verify the new version:** Settings → About shows v1.4.3. The `.bak` file is deleted after the smoke tests pass.
7. **Test the rollback:** Manually corrupt the v1.4.3 binary (e.g. `dd if=/dev/zero of=Buddysaradhi.app/Contents/MacOS/Buddysaradhi bs=1024 count=10`). Launch the app — it crashes. Relaunch — crashes. Relaunch — crashes. On the 3rd crash, the app rolls back to v1.4.2 and shows the flare toast.
8. **Test signature failure:** Replace the v1.4.3 binary on Vercel Blob with an unsigned binary. Bump the manifest to v1.4.4. Switch a fresh v1.4.3 install to staging. Wait for the prompt. Click "Restart now" — the updater downloads, signature check fails, flare toast appears, audit log row written, current binary untouched.
9. **Test never-interrupt:** Open the "Record payment" form. Bump the manifest. Wait 30s — no toast appears. Submit the payment (form closes). Toast appears within 5s.
10. **Test nightly install:** Click "Tonight at 3 AM". Wait until 3 AM (or change the system clock). Verify the app updates + restarts.

A failure on any of these tests blocks the release.

---

*This file is the updater contract. If the implementation diverges, this file wins — unless this file is wrong, in which case you amend this file first, then the code, then `worklog.md`. The order matters.*

---

## 14. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers three updater artefacts: the Tauri updater manifest schema (the JSON shape served from Vercel Blob, consumed by both the desktop updater and the download hub — schema owned by `deployment/02 §4`), the delta-patch flow (poll → fetch → verify → compare → download → verify binary → swap → restart → smoke test), and the rollback sequence (3 failed launches → restore `.bak` → audit + flare toast → skip next auto-update).

### 14.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The updater owns two UI touchpoints: (a) the "Update available" toast in `.glass-strong` + 4px violet left-bar (informational, not destructive — destructive would be flare per §8.8), and (b) the signature-failed toast in `.glass-strong` + 4px flare left-bar (security warning, persistent per §8.8). Both toasts carry `.neumo-raised` action buttons (Restart now / Skip this version / Retry later) per §8.2.

**Glass surfaces in the updater flow (§5.5 coverage map excerpt):**

| Surface | Glass tier | Updater purpose |
|---|---|---|
| "Update available" toast | `.glass-strong` + 4px violet left-bar | Informational prompt (60s duration per §4.1) |
| "Signature failed" toast | `.glass-strong` + 4px flare left-bar | Security warning (persistent, no auto-dismiss) |
| "Update failed — reverted" toast | `.glass-strong` + 4px flare left-bar | Rollback notification (§7.1) |
| Settings → Advanced → Update channel | `.glass` card + 2px cyan left-border | Channel switch (stable/staging) |
| Settings → About → "Check for updates" button row | `.glass-faint` band | Manual check trigger |

**Neumorphic controls in the updater flow (§6.6 coverage map excerpt):**

| Control | Recipe | Updater purpose |
|---|---|---|
| "Restart now" button (toast) | `.neumo-raised` + violet glow | Two-click confirm per §6.2 |
| "Tonight at 3 AM" button (toast) | `.neumo-raised` (no glow) | Schedule background install |
| "Skip this version" button (toast) | `.neumo-raised` (no glow) | Dismiss + record skipped version |
| "Retry later" button (signature-failed toast) | `.neumo-raised` (no glow) | Dismiss flare toast |
| Channel switch (Settings) | `.neumo-inset` segmented + raised active pill | Stable vs Staging |

> **References.** Tauri 2 updater plugin docs (tauri.app/plugin/updater); Tauri signer docs (tauri.app/develop/signing); Vercel Blob docs (vercel.com/docs/storage/vercel-blob); Ed25519 RFC 8032 (datatracker.ietf.org/doc/html/rfc8032); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "Backdrop-Filter Performance Case Study"; Nielsen Norman Group — "Wireframing for UX Design". The mockups below are the updater contract; the prose above is the rationale.

### 14.2 M1 — Tauri Updater Manifest Schema (Served from Vercel Blob)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  MANIFEST  —  manifests/desktop-stable.json  (served from Vercel Blob)              │
│  URL: https://buddysaradhi-releases.vercel-storage.com/manifests/desktop-stable.json     │
│  Polled by: https://buddysaradhi.app/api/releases/desktop/stable  (Next.js rewrite)      │
│  Schema owner: deployment/02 §4 (this file §3 reproduces verbatim + adds commentary)│
└────────────────────────────────────────────────────────────────────────────────────┘

┌─ .glass card (2px cyan left-border, §5.4 — informational) ───────────────────────┐
│                                                                                    │
│  {                                                                                 │
│    "version": "1.4.3",                          ← semver; updater compares > app.v │
│    "pub_date": "2026-06-27T10:00:00Z",          ← ISO 8601; rollback defence       │
│    "release_notes_url": "https://buddysaradhi.app/   ← changelog Markdown (react-md)    │
│      api/changelog/1.4.3",                        rendered in update-available     │
│                                                  toast (§4.1 of this file)         │
│    "minimum_auto_update_from": "1.3.0",         ← oldest auto-updatable version;  │
│                                                  MAJOR bump sets this to prev MAJOR│
│                                                                                    │
│    "platforms": {                  ← per-OS download URL + Ed25519 signature      │
│      "windows-x86_64": {                                                          │
│        "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/windows/        │
│                Buddysaradhi-1.4.3-x64.msi",                                            │
│        "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."  ← base64 Ed25519 detached sig   │
│      },                                                                           │
│      "darwin-universal": {                ← macOS universal (Apple Silicon + Intel)│
│        "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/macos/          │
│                Buddysaradhi-1.4.3-universal.dmg",                                      │
│        "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."                                 │
│      },                                                                           │
│      "darwin-aarch64": {                  ← unused (we ship universal); kept for   │
│        "url": "...same as darwin-universal...",    Tauri API compatibility         │
│        "signature": "...same as darwin-universal..."                               │
│      },                                                                           │
│      "linux-x86_64": {                                                             │
│        "url": "https://buddysaradhi-releases.vercel-storage.com/desktop/linux/          │
│                Buddysaradhi-1.4.3-x86_64.AppImage",                                    │
│        "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."                                 │
│      }                                                                            │
│    },                                                                             │
│                                                                                    │
│    "sha256": {                  ← per-platform SHA-256 (secondary check; not       │
│      "windows-x86_64": "a3f5b8c7d2e9...",          consumed by auto-updater —      │
│      "darwin-universal": "c7e9d2a3f5b8...",         Ed25519 is primary)            │
│      "darwin-aarch64": "c7e9d2a3f5b8...",          consumed by download hub at     │
│      "linux-x86_64": "f1b4c8e9a7d2..."             product/04_Download_Hub §2.2    │
│    },                                                                             │
│                                                                                    │
│    "metadata": {                ← build provenance (forensic debugging only;       │
│      "build_commit": "abc1234",  not consumed by the updater)                     │
│      "build_runner": "github-actions",                                            │
│      "build_branch": "main"                                                       │
│    }                                                                              │
│  }                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the manifest is served as static JSON on Vercel Blob (Option A, §10.1)
   ↑ the URL buddysaradhi.app/api/releases/desktop/stable is a Next.js rewrite to the Blob object
   ↑ the manifest is ITSELF signed via HTTPS transport + the per-binary Ed25519 signature;
     there is no separate manifest signature (§3.4)
   ↑ the trust root is the pinned pubkey in tauri.conf.json (plugins.updater.pubkey) — NOT
     the manifest URL. A compromised buddysaradhi.app cannot ship a malicious update because
     they cannot sign the binary without TAURI_PRIVATE_KEY (§3.4, §10.1 of 03)
   ↑ the pub_date field defends against manifest-rollback attacks: the updater refuses to
     "update" to a manifest whose pub_date is older than the installed version's pub_date
   ↑ the sha256 field is a SECONDARY check (consumed by download hub for manual verification)
   ↑ the staging manifest (manifests/desktop-staging.json) follows the same schema; the
     promotion from staging to stable is an atomic copy (no rebuild, no re-sign — §9 + deployment/02 §6)
   ↑ cross-refs: §2 (tauri.conf.json), §3.1 (field reference), §3.2 (platform keys),
     §3.3 (signature), §3.4 (manifest is itself signed), §9 (channels), §10 (web-side endpoint),
     deployment/02 §4 (canonical schema), deployment/02 §5 (atomic update), deployment/02 §6 (promotion)
```

### 14.3 M2 — Delta-Patch Flow (Poll → Verify → Download → Swap → Restart → Smoke)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  TRIGGER 1: App launch + 30s delay  (lets DB + sync settle, §5.1)                   │
│  TRIGGER 2: Every 6 hours while app is open  (periodic check)                       │
│  TRIGGER 3: User clicks "Check for updates" in Settings → Advanced  (manual)        │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: FETCH MANIFEST                                                             │
│    updater::check() → HTTPS GET https://buddysaradhi.app/api/releases/desktop/stable     │
│    → 200 OK + JSON manifest (per §3 of this file + deployment/02 §4)                │
│    channel switch: if settings.update_channel == "staging" → fetch /staging instead │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: VERIFY MANIFEST SIGNATURE (transport-level)                                │
│    HTTPS provides transport integrity (TLS 1.3 to buddysaradhi.app)                      │
│    The manifest itself is NOT separately signed (§3.4) — but the per-binary         │
│    signature field is verified in STEP 5 against the pinned pubkey.                 │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: COMPARE VERSIONS                                                           │
│    if manifest.version > app.package_info().version → update available              │
│    if manifest.version <= app.version → no update; return None (silently)           │
│    if manifest.pub_date < installed_version.pub_date → refuse (rollback defence)    │
│    if app.version < manifest.minimum_auto_update_from → refuse; show "manual        │
│      reinstall required" dialog (the breaking-change gate, §3.1)                    │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │  (update available)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: EMIT "update-available" EVENT TO FRONTEND                                  │
│    app.emit("update-available", { current_version, new_version, notes, pub_date }) │
│    frontend's initUpdaterListener checks isUserInSensitiveFlow:                     │
│      ├─ if true → defer (store pendingUpdate; show when flow ends, §6.1)            │
│      └─ if false → show "Update available" toast immediately                        │
│                                                                                      │
│  ┌─ .glass-strong toast (8% white, 24px blur) + 4px violet left-bar ─────────────┐ │
│  │ ● Update available — v1.4.3                                                  ✕ │ │
│  │   Bug fixes + new attendance heatmap filter.                                  │ │
│  │   ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐            │ │
│  │   │ Restart now  │  │ Tonight at 3 AM  │  │ Skip this version    │            │ │
│  │   └──────────────┘  └──────────────────┘  └──────────────────────┘            │ │
│  │   ↑ neumo-raised    ↑ neumo-raised         ↑ neumo-raised (no glow)           │ │
│  │   ↑ violet glow     ↑ no glow              ↑ dismisses + records skipped       │ │
│  │   ↑ two-click       ↑ schedules 3 AM       ↑ re-prompts only for newer        │ │
│  │     confirm (§6.2)    background install      versions                        │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│  duration: 60s (not the default 4s — user needs time to read notes per §4.1)        │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │  (user clicks "Restart now", two-click confirm)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: DOWNLOAD BINARY                                                            │
│    pick platform key: windows-x86_64 / darwin-universal / linux-x86_64              │
│    HTTPS GET manifest.platforms.<key>.url  (Vercel Blob → CDN-cached)               │
│    stream to memory buffer with progress callback (could emit progress events)      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: VERIFY BINARY SIGNATURE (PRIMARY integrity check)                          │
│    signature = base64_decode(manifest.platforms.<key>.signature)                    │
│    pubkey = tauri.conf.json plugins.updater.pubkey (PINNED IN BINARY)               │
│    if !ed25519_verify(binary_bytes, signature, pubkey):                             │
│      → abort install (current binary untouched)                                     │
│      → audit_log (action='updater_signature_failed', metadata={version, url})       │
│      → flare toast (.glass-strong + 4px flare left-bar, persistent)                 │
│      → do NOT retry until next periodic check (6h)                                  │
│      → return Err(Sync("signature verification failed"))                            │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │  (signature OK)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 7: PRE-FLIGHT: SET PENDING-VERSION FLAG                                       │
│    tauri-plugin-store.set("updater.pending_version", update.version)                │
│    tauri-plugin-store.set("updater.fail_count", 0)                                  │
│    tauri-plugin-store.save()                                                         │
│    (on next launch, smoke tests will run; if they fail 3x → rollback per §7)        │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 8: INSTALL (swap on next restart)                                             │
│    update.install().await                                                           │
│      → Tauri's installer: write new binary to temp path, then atomic swap           │
│      → current binary renamed to <binary>.bak (kept for rollback per §7.1)          │
│      → temp renamed to production path                                              │
│    audit_log (action='updater_installed', metadata={from_version, to_version})      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 9: RESTART + SMOKE TEST                                                       │
│    app.restart()                                                                    │
│    on next launch, the app checks updater.pending_version:                          │
│      if set → run smoke tests:                                                      │
│        1. Open the SQLCipher DB (key from keychain)                                 │
│        2. Read a row from settings                                                  │
│        3. Read a row from audit_log (verifies chain isn't broken)                   │
│        4. Emit window-shown event (verifies webview is responsive)                  │
│      if smoke tests pass:                                                           │
│        → delete the .bak                                                            │
│        → clear updater.pending_version                                              │
│        → reset updater.fail_count to 0                                              │
│        → emerald toast (4s) "Updated to v1.4.3"                                     │
│      if smoke tests fail:                                                           │
│        → increment fail_count                                                       │
│        → if fail_count < 3: launch anyway (transient issue)                        │
│        → if fail_count >= 3: ROLLBACK (see M3 below)                                │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the never-interrupt rule (BR-SYN-09) is enforced at STEP 4 — the toast is deferred
     if isUserInSensitiveFlow is true (PIN prompt open, payment being recorded, etc.)
   ↑ the 60s toast duration (not the default 4s) gives the user time to read the notes
   ↑ the two-click "Restart now" confirm prevents accidental restart (§6.2)
   ↑ the signature verification at STEP 6 is the PRIMARY integrity check — sha256 is secondary
   ↑ the .bak file is kept until smoke tests pass on next launch (§7.1)
   ↑ the smoke tests run on EVERY launch where pending_version is set — not just the first
   ↑ cross-refs: §2 (tauri.conf.json), §3 (manifest), §4 (update flow), §5 (cadence),
     §6 (never-interrupt), §7 (rollback), §8 (signature failure), §9 (channels), §10 (web side)
```

### 14.4 M3 — Rollback Sequence (3 Failed Launches → Restore .bak → Flare Toast)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  LAUNCH 1 AFTER UPDATE  (pending_version = "1.4.3", fail_count = 0)                 │
│  ┌─ .glass-strong splash (8% white, 24px blur, centered logo) ──────────────────┐  │
│  │                                                                                │  │
│  │                     ◈  Buddysaradhi                                                 │  │
│  │                                                                                │  │
│  │              ░░░░ starting v1.4.3 ░░░░                                         │  │
│  │                                                                                │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│  → smoke test 1: open SQLCipher DB (key from keychain)                              │
│  → smoke test 2: SELECT * FROM settings LIMIT 1                                     │
│  → smoke test 3: SELECT * FROM audit_log LIMIT 1 (chain integrity)                  │
│  → smoke test 4: emit window-shown event                                            │
│                                                                                      │
│  ❌ smoke test 3 FAILS (audit_log chain broken — schema migration issue)             │
│  → fail_count = 1                                                                   │
│  → app launches anyway (transient — maybe the migration is still running)            │
│  → user sees a degraded UI but can work                                              │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │  (user restarts)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  LAUNCH 2 AFTER UPDATE  (pending_version = "1.4.3", fail_count = 1)                 │
│  → smoke tests run again                                                             │
│  ❌ smoke test 2 FAILS (settings row missing — schema drift)                        │
│  → fail_count = 2                                                                   │
│  → app launches anyway (still transient)                                             │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │  (user restarts)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  LAUNCH 3 AFTER UPDATE  (pending_version = "1.4.3", fail_count = 2)                 │
│  → smoke tests run again                                                             │
│  ❌ smoke test 1 FAILS (DB won't open — schema incompatible with this binary)       │
│  → fail_count = 3 → THRESHOLD REACHED → ROLLBACK                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ROLLBACK MECHANISM (§7.1)                                                          │
│  1. restore .bak:                                                                    │
│     Windows:  rename Buddysaradhi.exe.bak → Buddysaradhi.exe (overwrites broken v1.4.3)       │
│     macOS:    rename Buddysaradhi.app.bak → Buddysaradhi.app                                  │
│     Linux:    rename buddysaradhi.AppImage.bak → buddysaradhi.AppImage                        │
│  2. write audit_log:                                                                 │
│     action = 'updater_rollback'                                                      │
│     metadata = { from_version: "1.4.3", to_version: "1.4.2",                        │
│                  fail_count: 3, failure_reason: "smoke test 1: DB open failed" }     │
│  3. clear store flags:                                                               │
│     updater.pending_version = null                                                   │
│     updater.fail_count = 0                                                           │
│  4. set skipped_update_version = "1.4.3"  (do not re-prompt for this version)       │
│  5. emit rollback-applied event to frontend                                          │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  NEXT LAUNCH (now running v1.4.2 — the rolled-back binary)                          │
│                                                                                      │
│  ┌─ .glass-strong toast (8% white, 24px blur) + 4px FLARE left-bar ──────────────┐  │
│  │ ✕ Update failed — reverted to v1.4.2                                  ✕        │  │
│  │   The Buddysaradhi team has been notified. (No telemetry — please report            │  │
│  │   this in Settings → Diagnostics.)                                              │  │
│  │   ┌────────────────────────────────────┐                                       │  │
│  │   │ Open Settings → Diagnostics         │  ← .neumo-raised (no glow)           │  │
│  │   └────────────────────────────────────┘                                       │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│  duration: persistent (no auto-dismiss — user must acknowledge)                      │
│  accent: FLARE (#FF5E00) per §2.4 — security/destructive warning                     │
│                                                                                      │
│  the updater will NOT re-prompt for v1.4.3 — it was skipped. The next prompt         │
│  fires only when a NEWER version (e.g. v1.4.4) is published. The skipped version    │
│  can be manually re-installed via Settings → About → "Check for updates"            │
│  (which ignores the skip flag).                                                      │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  SCHEMA-DRIFT ON ROLLBACK (§7.3 — the worst case)                                   │
│                                                                                      │
│  if v1.4.3 ran a migration (V0005__add_field.sql) before the smoke tests failed:     │
│    → the DB schema_version is now 5                                                  │
│    → the rolled-back v1.4.2 binary expects schema_version ≤ 4                       │
│    → v1.4.2 refuses to open the DB (BR-SYN-05: schema-version refusal)              │
│    → user sees: "Database was migrated to v5 by v1.4.3. Please reinstall v1.4.3     │
│      or restore from a v1.4.2 backup."                                               │
│                                                                                      │
│  mitigation: migrations are FORWARD-ONLY and ADDITIVE (new tables, new columns      │
│  with defaults). The old binary ignores the new tables/columns — it just doesn't    │
│  read them. The schema-version refusal only fires if a migration changed an         │
│  existing column type or constraint (which we never do per 11_Data_Model.md §11).    │
│                                                                                      │
│  this is why the nightly 3 AM install (not "Restart now") is the recommended path:  │
│  it gives the user time to notice a broken update and restore from backup before    │
│  the next workday begins.                                                            │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the 3-failure threshold balances false-positive (transient launch issues) vs
     false-negative (real update bugs not caught) — §7.2
   ↑ the .bak file is the rollback artefact — kept until smoke tests pass (then deleted)
   ↑ the flare toast is persistent — the user MUST acknowledge (no 4s auto-dismiss)
   ↑ the audit_log row records from_version, to_version, fail_count, failure_reason
   ↑ the skipped_update_version prevents re-prompting for the same broken version
   ↑ the schema-drift case is rare (migrations are additive) but documented — it requires
     manual intervention (reinstall v1.4.3 or restore from backup)
   ↑ cross-refs: §7.1 (rollback mechanism), §7.2 (3-failure threshold), §7.3 (schema drift),
     §8 (signature failure), §9.2 (downgrade protection), BR-SYN-05 (schema-version refusal),
     BR-SYN-09 (never-interrupt), 03 §10.2 (signature failure path),
     deployment/04 §6.4 (desktop rollback play — manifest edit, no rebuild)
```

### 14.5 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (architecture / flow) | M1 manifest schema, M2 delta-patch flow, M3 rollback sequence |
| Component anatomy | M2 update-available toast (annotated with glass/neumo tiers) |
| State matrix | M3 launch 1/2/3 → smoke fail → rollback (3-state threshold) |
| Full-screen layout | (n/a — 05 is an updater spec, not a screen) |

> All three mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 84–116 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5; neumorphic controls recipe-annotated (`.neumo-raised`, `.neumo-inset`) per §6.6. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `§8.2`, `§8.8`, `§2`, `§3.1`–`§3.4`, `§4`, `§5`, `§6`, `§7.1`–`§7.3`, `§8`, `§9`, `§10`, `BR-SYN-05`, `BR-SYN-09`). Manifest schema verified consistent with `deployment/02_Vercel_Blob_Build_Storage.md §4` (version, pub_date, release_notes_url, minimum_auto_update_from, platforms, sha256, metadata — all 7 fields match).
