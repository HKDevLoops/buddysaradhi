# 06 — Installers (Per-OS Formats)

> The desktop app ships as three installer formats: a Windows `.msi` (built by WiX), a macOS `.dmg` (universal, drag-to-install), and a Linux `.AppImage` (portable) + `.deb` (apt-integrated). Each format has its own install path, uninstall behaviour, file-association rules, and auto-launch-on-login mechanism. This file is the installer contract: the WiX template, the DMG layout, the AppImage + .deb + optional .rpm, the `.buddysaradhi` file association, the user-data preservation on uninstall, and the opt-in auto-launch on login.

Cross-references: `01_Architecture.md` §9 (bundle-size targets), `04_Code_Signing.md` (signing each installer), `05_Updater.md` (the updater swaps binaries, not installers), `10_Security.md` §14.2 (DB file paths per OS), `12_Business_Rules.md` BR-IMP-01 (the `.buddysaradhi` file format). **Commercial surface:** `product/04_Download_Hub.md` §2 (the five download cards — the Mac and Windows cards link to the Vercel Blob URLs of the `.dmg` and `.msi` produced here), §6 (the expandable install guides embedded on the cards — the user-facing version of the install flows in §3.4, §4.2.1, and §6 below), §8 (the bandwidth budget that constrains installer size), §10 (the changelog page that the download hub links from each card). **Producer side:** `deployment/02_Vercel_Blob_Build_Storage.md` §2 (bucket layout — where each installer artifact lives on Vercel Blob), §2.1 (naming conventions — `Buddysaradhi-<version>-<arch>.<ext>`), §2.3 (the `changelogs/` directory the download hub links to). **Release flow:** `deployment/04_Release_Pipeline.md` §3 (release types — PATCH / MINOR / MAJOR), §5 (release checklist — installer tests are items 1–8 in §12 below), §6.4 (desktop rollback via manifest edit — does NOT re-build installers). The 10 non-negotiable rules in top-level `AGENTS.md` §2 apply unchanged — especially Rule 4 (5 screens only — the installer does not add a 6th window) and Rule 9 (no silent failures — an installer failure is a release blocker, not a "ship it and hope" shortcut).

---

## 1. The Three Install Targets

| OS | Primary format | Secondary format | Install path | User-data path (preserved on uninstall) |
|---|---|---|---|---|
| Windows 10/11 | `.msi` (WiX) | (none) | `%LOCALAPPDATA%\Buddysaradhi\` (per-user, no admin) | `%APPDATA%\Buddysaradhi\data\` |
| macOS 11+ | `.dmg` (universal) | (none) | `/Applications/Buddysaradhi.app` (drag-to-install) | `~/Library/Application Support/Buddysaradhi/` |
| Linux | `.AppImage` (portable) | `.deb` (apt-integrated); `.rpm` (community-maintained) | Anywhere (AppImage); `/opt/buddysaradhi/` (.deb) | `~/.local/share/Buddysaradhi/` |

The "user-data path preserved on uninstall" is the load-bearing rule: a tutor who uninstalls Buddysaradhi (to free disk space, to switch laptops, by accident) must not lose their database, backups, or receipts. The installer removes the binary; the data stays.

---

## 2. Windows `.msi` (WiX)

### 2.1 Why WiX (Not NSIS)

WiX (Windows Installer XML) is the open-source toolset that produces `.msi` files natively supported by Windows Installer. NSIS produces `.exe` installers that are not Windows Installer packages. We use WiX because:

- **Windows Installer handles uninstall / repair / upgrade natively.** A `.msi` is a database of install actions; Windows Installer can roll back, repair, and upgrade predictably.
- **Group Policy deployment.** Enterprises can deploy `.msi` files via GPO; `.exe` installers require manual deployment.
- **Tauri's default.** `cargo tauri build` on Windows produces a `.msi` via the bundled WiX toolchain.

### 2.2 The WiX Template

```xml
<!-- src-tauri/wix/Buddysaradhi.wxs -->
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product
    Id="*"
    Name="Buddysaradhi"
    Language="1033"
    Version="1.4.2.0"
    Manufacturer="Buddysaradhi Pvt Ltd"
    UpgradeCode="7B8A9C4D-1234-5678-9ABC-DEF012345678">

    <Package
      InstallerVersion="405"
      Compressed="yes"
      InstallScope="perUser"
      InstallPrivileges="limited"
      Description="Buddysaradhi desktop app — installer"
      Manufacturer="Buddysaradhi Pvt Ltd" />

    <Media Id="1" Cabinet="Buddysaradhi.cab" EmbedCab="yes" />

    <!-- Per-user install: LOCALAPPDATA -->
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder">
        <Directory Id="INSTALLDIR" Name="Buddysaradhi">
          <Component Id="MainExecutable" Guid="*">
            <File Id="BuddysaradhiExe" Source="$(var.BuildDir)\Buddysaradhi.exe" KeyPath="yes" />
            <!-- ... other files (frontend dist, icons, etc.) -->
          </Component>
        </Directory>
      </Directory>

      <!-- Start Menu shortcut -->
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ApplicationProgramsFolder" Name="Buddysaradhi">
          <Component Id="ApplicationShortcut" Guid="*">
            <Shortcut Id="ApplicationStartMenuShortcut"
                      Name="Buddysaradhi"
                      Description="Buddysaradhi desktop app"
                      Target="[INSTALLDIR]Buddysaradhi.exe"
                      WorkingDirectory="INSTALLDIR"
                      Icon="BuddysaradhiIcon" />
            <RemoveFolder Id="ApplicationProgramsFolder" On="uninstall" />
            <RegistryValue Root="HKCU" Key="Software\Buddysaradhi" Name="installed" Type="integer" Value="1" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>

      <!-- Desktop shortcut (opt-in via property) -->
      <Directory Id="DesktopFolder" Name="Desktop">
        <Component Id="DesktopShortcut" Guid="*" Condition="DESKTOPSHORTCUT = 1">
          <Shortcut Id="ApplicationDesktopShortcut"
                    Name="Buddysaradhi"
                    Target="[INSTALLDIR]Buddysaradhi.exe"
                    WorkingDirectory="INSTALLDIR"
                    Icon="BuddysaradhiIcon" />
        </Component>
      </Directory>
    </Directory>

    <!-- File association: .buddysaradhi → opens app for restore -->
    <DirectoryRef Id="TARGETDIR">
      <Component Id="FileAssociation" Guid="*">
        <ProgId Id="Buddysaradhi.buddysaradhi" Description="Buddysaradhi Backup File" Icon="BuddysaradhiIcon">
          <Extension Id="buddysaradhi" ContentType="application/x-buddysaradhi-backup">
            <Verb Id="open" Command="Open with Buddysaradhi" Argument="--restore &quot;%1&quot;" />
          </Extension>
        </ProgId>
        <RegistryValue Root="HKCU" Key="Software\Classes\.buddysaradhi" Type="string" Value="Buddysaradhi.buddysaradhi" KeyPath="yes" />
      </Component>
    </DirectoryRef>

    <!-- Features -->
    <Feature Id="Complete" Level="1" Title="Buddysaradhi" Description="The complete Buddysaradhi desktop app.">
      <ComponentRef Id="MainExecutable" />
      <ComponentRef Id="ApplicationShortcut" />
      <ComponentRef Id="DesktopShortcut" />
      <ComponentRef Id="FileAssociation" />
    </Feature>

    <!-- UI: opt-in desktop shortcut -->
    <UI>
      <UIRef Id="WixUI_InstallDir" />
      <UIRef Id="WixUI_FeatureTree" />
      <Property Id="DESKTOPSHORTCUT" Value="0" />
      <DialogRef Id="DesktopShortcutDialog" />
    </UI>

    <!-- Custom action: invoke the auto-launch-on-login registration -->
    <CustomAction Id="RegisterAutoLaunch"
                  BinaryKey="BuddysaradhiCA"
                  DllEntry="RegisterAutoLaunch"
                  Execute="deferred"
                  Impersonate="yes"
                  Return="check" />
    <CustomAction Id="UnregisterAutoLaunch"
                  BinaryKey="BuddysaradhiCA"
                  DllEntry="UnregisterAutoLaunch"
                  Execute="deferred"
                  Impersonate="yes"
                  Return="check" />

    <InstallExecuteSequence>
      <Custom Action="RegisterAutoLaunch" After="InstallFinalize">NOT Installed AND AUTO_LAUNCH = 1</Custom>
      <Custom Action="UnregisterAutoLaunch" Before="RemoveFiles">Installed AND REMOVE = "ALL"</Custom>
    </InstallExecuteSequence>

    <!-- Icon -->
    <Icon Id="BuddysaradhiIcon" SourceFile="$(var.BuildDir)\icon.ico" />
    <Property Id="ARPPRODUCTICON" Value="BuddysaradhiIcon" />

  </Product>
</Wix>
```

### 2.3 The Key WiX Decisions

| Decision | Value | Why |
|---|---|---|
| `InstallScope` | `perUser` | Per-user install — no admin rights required. The tutor double-clicks the .msi and it installs to their `%LOCALAPPDATA%`. |
| `InstallPrivileges` | `limited` | Same as above — no UAC prompt. |
| `InstallDirectory` | `%LOCALAPPDATA%\Buddysaradhi\` | Per-user; survives Windows feature updates; not roamed (the binary is not user data). |
| User data path | `%APPDATA%\Buddysaradhi\data\` | Per-user; **roamed** on domain-joined machines; preserved on uninstall (the .msi's `RemoveFile` does not touch this path). |
| Start Menu shortcut | Always created | Mandatory — the tutor needs a way to launch the app beyond the desktop icon. |
| Desktop shortcut | Opt-in (checkbox in the installer UI) | Some tutors hate desktop icons; the opt-in checkbox respects this. Default: checked. |
| `.buddysaradhi` file association | Always registered | Double-clicking a `.buddysaradhi` file opens Buddysaradhi with the restore-from-backup flow (`08_Settings.md` "Backup & Data" tab). |
| Auto-launch on login | Opt-in (custom property `AUTO_LAUNCH=1`) | Off by default; the tutor enables it in Settings → Advanced → "Launch Buddysaradhi when I start my computer". |

### 2.4 The Uninstall Behaviour

On uninstall (`msiexec /x Buddysaradhi-1.4.2-x64.msi`):

1. **Remove** `%LOCALAPPDATA%\Buddysaradhi\` (the binary, frontend dist, icons).
2. **Remove** the Start Menu shortcut.
3. **Remove** the Desktop shortcut (if it was created).
4. **Remove** the `.buddysaradhi` file association.
5. **Remove** the auto-launch registry entry (if it was created).
6. **Preserve** `%APPDATA%\Buddysaradhi\data\` (the SQLCipher DB, backups, receipts, crash dumps).
7. **Preserve** the OS keychain entries (SQLCipher key, Supabase token, Turso token) — these are not in the file system; the OS keychain keeps them until the user explicitly removes them.

If the tutor reinstalls later, the preserved data + keychain entries make the app boot straight into their existing state. This is the "uninstall is not data loss" guarantee.

### 2.5 The WebView2 Runtime Bootstrapper

The .msi bundles the WebView2 Evergreen Bootstrapper (~2 MB). On first install, if `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` is missing (WebView2 Runtime not installed), the bootstrapper silently downloads + installs it. The bootstrapper is bundled (not downloaded at install time) so the install works on offline machines — the bootstrapper itself is small, and the actual WebView2 Runtime download is ~100 MB but happens only once per machine.

### 2.6 The WiX Build in CI

Tauri's build process generates a `.wixobj` from the template + the binary's file list, then invokes `light.exe` (WiX's linker) to produce the `.msi`. The signing happens after the `.msi` is produced (`04_Code_Signing.md` §2.4).

---

## 3. macOS `.dmg` (Universal, Drag-to-Install)

### 3.1 The Universal Binary

```bash
# Build a universal binary (Apple Silicon + Intel)
$ cargo tauri build --target universal-apple-darwin

# Produces:
#   src-tauri/target/universal-apple-darwin/release/bundle/macos/Buddysaradhi.app
#   src-tauri/target/universal-apple-darwin/release/bundle/dmg/Buddysaradhi-1.4.2.dmg
```

The `--target universal-apple-darwin` flag tells Tauri to build for both `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel), then `lipo` them into a single universal binary. The resulting `.dmg` is ~2 MB larger than a single-arch build, but it means we ship one download link for all Mac users.

### 3.2 The DMG Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Buddysaradhi-1.4.2.dmg (mounted volume: "Buddysaradhi 1.4.2")            │
│                                                                  │
│  ┌───────────────┐                                              │
│  │               │                                              │
│  │  Buddysaradhi.app  │  ──── drag ────►  ┌──────────────────┐      │
│  │   (app icon)  │                    │  Applications    │      │
│  │               │                    │  (folder alias)  │      │
│  └───────────────┘                    └──────────────────┘      │
│                                                                  │
│  ── background.png (cosmic indigo gradient + bioluminescent     │
│     emerald arrow pointing from app to Applications) ──         │
│                                                                  │
│  ── README.txt ("Drag Buddysaradhi to Applications to install.") ──  │
└─────────────────────────────────────────────────────────────────┘
```

Tauri's DMG bundler produces this layout automatically. The `background.png` is a 660×400 cosmic-indigo gradient with an emerald (#00FF9D) arrow pointing from the app icon to the Applications folder alias — matching the web app's `13_UI_Guidelines.md` design system. The arrow uses the bioluminescent accent; no indigo/blue accents (per `AGENTS.md` §2 Rule 5).

### 3.3 The DMG Build in Tauri Config

```json
// src-tauri/tauri.conf.json (excerpt — bundle.mac)
{
  "bundle": {
    "macOS": {
      "frameworks": [],
      "minimumSystemVersion": "11.0",
      "exceptionDomain": "",
      "signingIdentity": "Developer ID Application: Buddysaradhi Pvt Ltd (TEAM_ID)",
      "providerShortName": "Buddysaradhi",
      "entitlements": "src-tauri/entitlements.plist",
      "dmg": {
        "background": "src-tauri/dmg/background.png",
        "windowPosition": { "x": 200, "y": 120 },
        "windowSize": { "width": 660, "height": 400 },
        "appPosition": { "x": 180, "y": 170 },
        "applicationFolderPosition": { "x": 480, "y": 170 },
        "appDropLink": { "x": 480, "y": 170 }
      }
    }
  }
}
```

### 3.4 The Install Flow

1. The tutor downloads `Buddysaradhi-1.4.2.dmg` from `buddysaradhi.app/#download` (the commercial download hub at `product/04_Download_Hub.md §2` — the macOS card links directly to this Vercel Blob URL).
2. Double-clicks the `.dmg` — macOS mounts it as a volume.
3. The tutor drags `Buddysaradhi.app` to the `Applications` folder alias.
4. The tutor ejects the DMG (right-click → Eject) and deletes the `.dmg` file.
5. The tutor double-clicks `Buddysaradhi.app` in Applications. On first launch, macOS Gatekeeper checks the notarization ticket (`04_Code_Signing.md` §3.6). If valid, the app launches. If invalid, Gatekeeper shows "Buddysaradhi cannot be opened because Apple cannot check it for malicious software" — the user is told to right-click → Open (which gives them a one-time bypass).

The user-facing version of this flow (with screenshots, troubleshooting for Gatekeeper errors, and the "drag to Applications" animation) is the install guide embedded on the macOS download card at `product/04_Download_Hub.md §6.1`. The commercial download hub also displays the SHA-256 of the `.dmg` (per `product/04_Download_Hub.md §2.2` card item 7) so a paranoid user can verify the download before opening it.

### 3.5 The Uninstall Behaviour

On macOS, "uninstall" means drag `Buddysaradhi.app` from Applications to the Trash. This removes:

- The binary (`Buddysaradhi.app/Contents/MacOS/Buddysaradhi`).
- The frontend dist (`Buddysaradhi.app/Contents/Resources/`).
- The frameworks (`Buddysaradhi.app/Contents/Frameworks/`).

It does **not** remove:

- `~/Library/Application Support/Buddysaradhi/` (the SQLCipher DB, backups, receipts, crash dumps).
- `~/Library/Preferences/app.buddysaradhi.Buddysaradhi.plist` (the Tauri store: window state, app state).
- `~/Library/Logs/Buddysaradhi/` (the app's log files).
- The OS keychain entries (`10_Security.md` §5.3).

These preserved paths mean a re-install (re-drag `Buddysaradhi.app` to Applications) boots straight into the tutor's existing state. There is no macOS-native uninstaller — drag-to-Trash is the convention, and we follow it.

### 3.6 The "Move to Trash" Cleanup

For tutors who want a clean uninstall (remove the preserved data too), the Settings → Advanced → "Erase all data and quit" button (`10_Security.md` §18.1 secure-erase flow) is the path. This deletes the keychain entries, `VACUUM`s the DB, overwrites the file with zeros, and removes the `~/Library/Application Support/Buddysaradhi/` directory. After this, dragging the app to Trash produces a fully clean uninstall.

---

## 4. Linux `.AppImage` + `.deb` (+ optional `.rpm`)

### 4.1 The AppImage

AppImage is the portable Linux format — a single file that contains the app + all its dependencies (WebKitGTK, GTK, etc.). The user `chmod +x Buddysaradhi-1.4.2.AppImage && ./Buddysaradhi-1.4.2.AppImage`. No install, no root, no dependencies to apt-install.

```json
// src-tauri/tauri.conf.json (excerpt — bundle.linux)
{
  "bundle": {
    "linux": {
      "appimage": {
        "bundleMediaFramework": true,
        "files": {}
      },
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0", "libayatana-appindicator3-1"]
      },
      "rpm": {
        "depends": ["webkit2gtk3", "gtk3", "libayatana-appindicator"]
      }
    }
  }
}
```

#### 4.1.1 The AppImage Build

```bash
$ cargo tauri build --target x86_64-unknown-linux-gnu
# Produces:
#   src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/Buddysaradhi-1.4.2.AppImage
```

Tauri uses `appimagetools` to bundle the binary + the frontend dist + a bundled WebKitGTK runtime into a single AppImage file. The resulting AppImage is ~14 MB — at the bundle-size target ceiling. The bundled WebKitGTK adds ~6 MB compared to the .deb (which uses the system WebKitGTK), but it ensures the app runs identically across distros (Ubuntu, Fedora, Debian, Arch, etc.) without dependency issues.

#### 4.1.2 The AppImage Launcher

When the user runs an AppImage for the first time, the OS asks "Do you want to integrate this app into your system?" — if the user has `AppImageLauncher` installed, the app is integrated (Start Menu entry, file association). If not, the app runs as a standalone process.

The desktop app recommends `AppImageLauncher` in the download hub's Linux section, but does not require it. The app runs fine without integration — the tutor just double-clicks the AppImage file each time they want to launch it.

#### 4.1.3 The AppImage User-Data Path

The AppImage writes user data to `~/.local/share/Buddysaradhi/` (the XDG-standard data directory) and config to `~/.config/Buddysaradhi/`. These paths are determined at runtime by the `directories` crate, which respects `XDG_DATA_HOME` and `XDG_CONFIG_HOME` if set.

### 4.2 The `.deb`

The `.deb` is for Debian/Ubuntu users who want apt integration. The tutor installs via:

```bash
$ sudo dpkg -i buddysaradhi-1.4.2_amd64.deb
# (or, after adding the APT repository:)
$ sudo apt install buddysaradhi
```

The `.deb`:

- Installs the binary to `/opt/buddysaradhi/Buddysaradhi`.
- Installs the frontend dist to `/opt/buddysaradhi/resources/`.
- Installs a `.desktop` file to `/usr/share/applications/buddysaradhi.desktop` (Start Menu entry).
- Installs an icon to `/usr/share/icons/hicolor/512x512/apps/buddysaradhi.png`.
- Registers the `.buddysaradhi` MIME type via `/usr/share/mime/packages/buddysaradhi.xml`.
- Declares dependencies on `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`.

The `.deb` uses the system WebKitGTK (saves ~6 MB vs the AppImage) but requires the user's distro to have a compatible WebKitGTK version (4.1, shipped in Ubuntu 22.04+ / Debian 12+ / Fedora 38+).

#### 4.2.1 The `.desktop` File

```ini
# /usr/share/applications/buddysaradhi.desktop
[Desktop Entry]
Type=Application
Name=Buddysaradhi
Comment=The operating system for private tutors
Exec=/opt/buddysaradhi/Buddysaradhi %U
Icon=buddysaradhi
Terminal=false
Categories=Education;Office;Finance;
MimeType=application/x-buddysaradhi-backup;
StartupWMClass=Buddysaradhi
```

The `%U` in `Exec` passes a URL argument (used when the user clicks a `buddysaradhi://` link, though we don't currently register a custom scheme). The `MimeType` line registers the `.buddysaradhi` file association.

#### 4.2.2 The `.deb` Uninstall

```bash
$ sudo apt remove buddysaradhi
# Removes /opt/buddysaradhi/, /usr/share/applications/buddysaradhi.desktop,
# /usr/share/icons/hicolor/512x512/apps/buddysaradhi.png,
# /usr/share/mime/packages/buddysaradhi.xml.
# PRESERVES ~/.local/share/Buddysaradhi/ (the user data).

$ sudo apt purge buddysaradhi
# Same as remove, plus removes config files in /etc.
# STILL preserves ~/.local/share/Buddysaradhi/ and ~/.config/Buddysaradhi/.
```

### 4.3 The `.rpm` (Optional, Community-Maintained)

The `.rpm` is for Fedora / RHEL / openSUSE users. Tauri can produce a `.rpm` from the same build:

```bash
$ cargo tauri build --target x86_64-unknown-linux-gnu --bundles rpm
# Produces:
#   src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/buddysaradhi-1.4.2.x86_64.rpm
```

The `.rpm` ships later than the AppImage and .deb (community-maintained — a Fedora user volunteers to test each release on Fedora). The signing key is the same GPG key as the AppImage (`04_Code_Signing.md` §4).

---

## 5. The `.buddysaradhi` File Association

Double-clicking a `.buddysaradhi` file opens Buddysaradhi with the restore-from-backup flow. This works on all three OSes:

| OS | Mechanism |
|---|---|
| Windows | The WiX template's `<Extension Id="buddysaradhi">` registers the file type. Double-clicking invokes `Buddysaradhi.exe --restore "<path>"`. |
| macOS | The `Info.plist` (inside `Buddysaradhi.app/Contents/`) declares `CFBundleDocumentTypes` for `.buddysaradhi`. Double-clicking launches Buddysaradhi and passes the file path via the Apple Events system. |
| Linux (.deb) | The `/usr/share/mime/packages/buddysaradhi.xml` + `/usr/share/applications/buddysaradhi.desktop` register the MIME type. Double-clicking invokes `Buddysaradhi --restore "<path>"`. |
| Linux (AppImage) | AppImageLauncher handles the file association if installed; otherwise the user manually opens the file via the app's Settings → Backup & Data → Restore. |

### 5.1 The `--restore` CLI Argument

```rust
// src-tauri/src/main.rs (excerpt — CLI arg parsing)
use clap::Parser;

#[derive(Parser)]
#[command(version, about = "Buddysaradhi desktop app")]
struct Cli {
    /// Restore a .buddysaradhi backup file on launch.
    #[arg(long)]
    restore: Option<std::path::PathBuf>,
}

fn main() {
    let cli = Cli::parse();

    tauri::Builder::default()
        .setup(move |app| {
            let state = AppState::init(app.handle())?;
            app.manage(state);

            if let Some(restore_path) = &cli.restore {
                // Emit an event to the frontend; the frontend navigates to
                // /settings and shows the restore-from-backup flow with the
                // path pre-filled.
                app.emit("restore-from-cli", restore_path)?;
            }

            Ok(())
        })
        // ...
        .run(tauri::generate_context!())
        .expect("error while running Buddysaradhi desktop application");
}
```

The frontend listens for the `restore-from-cli` event in `GlassShell.tsx`:

```tsx
useEffect(() => {
  const unlisten = listen<string>("restore-from-cli", (event) => {
    navigate("/settings");
    // The settings page reads the pending restore path from a Zustand store
    // and pre-fills the restore-from-backup form.
    useAppStore.getState().pendingRestorePath = event.payload;
  });
  return () => { unlisten.then(fn => fn()); };
}, [navigate]);
```

---

## 6. Auto-Launch on Login (Opt-In)

The tutor can opt in to "Launch Buddysaradhi when I start my computer" via Settings → Advanced → Auto-launch. The opt-in writes the OS-appropriate auto-launch entry; the opt-out removes it.

| OS | Mechanism | Registry / File Path |
|---|---|---|
| Windows | Registry `Run` key (per-user) | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Buddysaradhi = "C:\Users\<user>\AppData\Local\Buddysaradhi\Buddysaradhi.exe"` |
| macOS | `LSSharedFileList` (modern macOS) or `Login Items` via `osascript` | `osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Buddysaradhi.app", hidden:false}'` |
| Linux | `.desktop` file in `~/.config/autostart/` | `~/.config/autostart/buddysaradhi.desktop` with `Exec=/opt/buddysaradhi/Buddysaradhi` (or the AppImage path) |

### 6.1 The Rust Implementation

```rust
// src-tauri/src/auto_launch.rs
use auto_launch::AutoLaunchBuilder;

pub fn set_auto_launch(enable: bool) -> Result<(), Error> {
    let auto = AutoLaunchBuilder::new()
        .set_app_name("Buddysaradhi")
        .set_app_path(&app_path()?)
        .set_use_launch_agent_on_mac(true)
        .build()
        .map_err(|e| Error::Io(format!("auto-launch: {e}")))?;

    if enable {
        auto.enable().map_err(|e| Error::Io(format!("auto-launch enable: {e}")))?;
    } else {
        auto.disable().map_err(|e| Error::Io(format!("auto-launch disable: {e}")))?;
    }
    Ok(())
}

fn app_path() -> Result<String, Error> {
    // Returns the current executable's path.
    std::env::current_exe()?
        .to_str()
        .ok_or_else(|| Error::Io("current_exe path is not UTF-8".into()))
        .map(String::from)
}
```

The `auto_launch` crate (https://crates.io/crates/auto-launch) wraps the OS-specific auto-launch mechanisms in a single API. On Windows it writes the `HKCU\...\Run` key; on macOS it uses `LSSharedFileList` (or `osascript`); on Linux it writes the `.desktop` file.

### 6.2 The Settings UI

The Settings → Advanced → "Auto-launch" toggle uses the same `NeumoToggle` component as the rest of the app (`13_UI_Guidelines.md` §8). When toggled on:

1. The frontend calls `invoke('set_auto_launch', { enable: true })`.
2. The Rust command writes the OS-specific entry.
3. The toggle animates to "on" (emerald glow).
4. An audit_log row is written (`action='auto_launch_enabled'`).

When toggled off, the reverse. The toggle is persistent across app updates — the auto-launch entry is not removed on update (the updater swaps the binary but leaves the auto-launch entry intact, since it points to the same path).

### 6.3 The Auto-Launch Flag in the .msi

The Windows .msi has an `AUTO_LAUNCH` property (default: 0). If the installer is invoked with `msiexec /i Buddysaradhi-1.4.2-x64.msi AUTO_LAUNCH=1`, the auto-launch registry entry is written as part of the install. This is used by enterprise deployments (Group Policy can set this property).

For interactive installs, the auto-launch is off by default — the tutor enables it in Settings. We don't prompt for it during install because the tutor hasn't used the app yet and doesn't know if they want it auto-launching.

---

## 7. The First-Run Experience

On first launch (no DB file exists at the OS-appropriate path), the app shows:

1. **Welcome screen** — "Welcome to Buddysaradhi" with the cosmic-indigo gradient + bioluminescent accents. A single "Get started" button (emerald glass).
2. **Sign-in screen** — Supabase OAuth popup (Google / email link). On success, the Supabase session is stored in the OS keychain; the Turso `db_token` is provisioned via the Supabase Edge Function (`02_Core_Logic.md` §19).
3. **PIN setup** — 6-digit PIN (BR-SEC-05). The PIN is hashed with Argon2id and stored in `settings.pin_hash`.
4. **Biometric setup** (optional) — "Enable Face ID / Touch ID / Windows Hello?" If yes, biometric is enrolled (the OS keychain releases the SQLCipher key on biometric prompt).
5. **Backup passphrase setup** — "Choose a passphrase for your backups. If you forget this, we cannot recover your data." (BACKUP-1). The passphrase is hashed with Argon2id and stored in `settings.backup_passphrase_hash`. The passphrase itself is never stored.
6. **Dashboard** — the app navigates to `/dashboard` with the empty-state component (`04_Dashboard.md`).

On subsequent launches, the app shows the lock screen (PIN / biometric prompt) and then the last-active route.

---

## 8. The Bundle Composition (What's in Each Format)

### 8.1 Windows `.msi` (~12 MB)

```
Buddysaradhi-1.4.2-x64.msi
├── Buddysaradhi.exe                                  ~6.0 MB (Rust binary, stripped, LTO)
├── dist/                                        ~1.5 MB (frontend: JS + CSS + fonts, gzipped)
├── icon.ico                                     ~0.2 MB
├── WebView2EvergreenBootstrapper.exe            ~2.0 MB (downloads WebView2 Runtime on first run)
├── WiX scaffold + .cab                          ~2.3 MB
└── Total                                        ~12.0 MB
```

### 8.2 macOS `.dmg` (~14 MB, universal)

```
Buddysaradhi-1.4.2.dmg
└── Buddysaradhi.app
    └── Contents/
        ├── MacOS/Buddysaradhi                        ~7.0 MB (universal binary: aarch64 + x86_64)
        ├── Resources/
        │   ├── dist/                            ~1.5 MB (frontend)
        │   ├── icon.icns                        ~0.5 MB
        │   └── entitlements.plist               ~0.001 MB
        ├── Frameworks/                          ~4.0 MB (Tauri's bundled frameworks)
        └── Info.plist                           ~0.005 MB
└── DMG overhead (background, README)            ~1.0 MB
                                                ────────
                                                ~14.0 MB
```

### 8.3 Linux `.AppImage` (~14 MB)

```
Buddysaradhi-1.4.2.AppImage (squashfs)
├── AppRun                                       ~0.05 MB (launcher script)
├── Buddysaradhi                                      ~6.0 MB (Rust binary)
├── dist/                                        ~1.5 MB (frontend)
├── icon.png                                     ~0.3 MB
├── buddysaradhi.desktop                              ~0.001 MB
├── usr/lib/                                     ~6.0 MB (bundled WebKitGTK + GTK runtime)
└── Total                                        ~14.0 MB
```

The bundled WebKitGTK + GTK runtime is what makes the AppImage portable across distros. The .deb skips this (uses the system WebKitGTK) and ships at ~8 MB.

---

## 9. The Bundle-Size Budget

| Format | Target | Hard ceiling | CI gate |
|---|---|---|---|
| Windows .msi | ≤ 12 MB | 14 MB | `bundle-size-check` job fails the build if > 14 MB. |
| macOS .dmg (universal) | ≤ 14 MB | 16 MB | Same. |
| Linux .AppImage | ≤ 14 MB | 16 MB | Same. |
| Linux .deb | ≤ 14 MB | 16 MB | Same. |

A PR that crosses the target ships a `chore(deps): trim bundle` follow-up before the next release. A PR that crosses the hard ceiling is blocked by CI.

### 9.1 Trimming Techniques

If a bundle crosses the target:

1. **Check for new heavy dependencies.** `cargo bloat --release --crates` shows the largest crates in the binary. Candidates for removal: unused features (e.g. `chrono`'s `serde` feature if we don't serialize `DateTime`).
2. **Strip debug symbols** (`strip = true` in `[profile.release]`). Already on.
3. **LTO** (`lto = true`). Already on.
4. **`opt-level = "z"`** (optimise for size, not speed). Already on. If a hot path (e.g. ledger posting) is too slow, downgrade to `opt-level = 3` for that specific crate via `[profile.release.package."*"]`.
5. **Frontend tree-shaking.** Vite's `manualChunks` config splits the frontend into per-route chunks; check that no single chunk exceeds 200 KB.
6. **Bundle only the icons you need.** The `tauri.conf.json` `bundle.icon` array should list only the icons actually bundled (Windows .ico, macOS .icns, Linux .png).

---

## 10. Cross-Reference Summary

| Topic in this file | Master / platform spec cross-ref |
|---|---|
| Bundle-size targets | `01_Architecture.md` §9 |
| Code signing (per-OS) | `04_Code_Signing.md` |
| Updater (swaps binaries, not installers) | `05_Updater.md` |
| DB file paths per OS | `10_Security.md` §14.2 |
| `.buddysaradhi` file format | `09_Backup_and_Import_Export.md` §15, `12_Business_Rules.md` BR-IMP-01 |
| 5 screens only (no 6th window) | top-level `AGENTS.md` §2 Rule 4 |
| No silent failures (installer failure = release blocker) | top-level `AGENTS.md` §2 Rule 9 |
| Distribution milestone | `15_Future_Roadmap.md` v1.4 |
| Commercial download hub (Mac + Windows cards → Vercel Blob URLs of these installers) | `product/04_Download_Hub.md` §2 |
| User-facing install guides (the commercial version of §3.4 / §4.2.1 below) | `product/04_Download_Hub.md` §6 |
| Bandwidth budget that constrains installer size | `product/04_Download_Hub.md` §8 |
| Changelog page (linked from each download card) | `product/04_Download_Hub.md` §10 |
| Bucket layout (where each installer artifact lives on Vercel Blob) | `deployment/02_Vercel_Blob_Build_Storage.md` §2 |
| Naming conventions (`Buddysaradhi-<version>-<arch>.<ext>`) | `deployment/02_Vercel_Blob_Build_Storage.md` §2.1 |
| Release types (PATCH / MINOR / MAJOR — drives installer version bump) | `deployment/04_Release_Pipeline.md` §3 |
| Release checklist (installer tests are items 1–8 in §12 below) | `deployment/04_Release_Pipeline.md` §5 |
| Desktop rollback via manifest edit (no installer rebuild) | `deployment/04_Release_Pipeline.md` §6.4 |

---

## 11. What This File Does NOT Cover

- **Code signing (EV cert, notarization, GPG)** → `04_Code_Signing.md`.
- **Updater manifest + rollback** → `05_Updater.md`.
- **Rust backend** → `02_Rust_Core.md`.
- **Architecture / project layout** → `01_Architecture.md`.
- **The .buddysaradhi file format internals** → `09_Backup_and_Import_Export.md` §15.

---

## 12. The Installer Test Plan (Pre-Release)

Before announcing a release, the following installer tests must pass on all three OSes:

1. **Fresh install on a clean OS VM:** Download the installer, double-click, follow the wizard, verify the app launches.
2. **Install over an existing version (upgrade):** Install v1.4.2, then install v1.4.3. Verify the app launches as v1.4.3 with all data preserved.
3. **Uninstall + reinstall:** Install v1.4.2, uninstall, reinstall v1.4.2. Verify the app launches with all data preserved (DB, backups, receipts, keychain entries).
4. **File association:** Double-click a `.buddysaradhi` file. Verify Buddysaradhi launches and the restore-from-backup flow opens with the path pre-filled.
5. **Auto-launch on login:** Enable in Settings → Advanced. Reboot the OS. Verify Buddysaradhi launches on login.
6. **Bundle size:** Verify the installer is at or below the target size (`ls -lh` on the file).
7. **Code signature:** Verify per `04_Code_Signing.md` §8 (signtool / codesign / gpg).
8. **WebView2 first-run:** On a clean Windows 10 VM without WebView2 Runtime, verify the installer silently installs the runtime and the app launches.

A failure on any of these tests blocks the release.

---

*This file is the installer contract. If the implementation diverges, this file wins — unless this file is wrong, in which case you amend this file first, then the code, then `worklog.md`. The order matters.*

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers three installer artefacts: the per-OS installer anatomy (what's inside the `.msi` / `.dmg` / `.AppImage` / `.deb` — file tree + size budget), the install-path tree (where binaries + user data + keychain entries live per OS), and the uninstall flow (the "uninstall is not data loss" guarantee — what's removed vs preserved).

### 13.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The installer owns no in-app UI (it runs before the app launches), but its outputs are surfaced in two UI touchpoints: (a) the commercial download hub at `product/04_Download_Hub.md` (5 cards in `.glass` + accent left-border per §5.4), and (b) the desktop first-run experience (Welcome screen = `.glass` card + emerald CTA, per §7 of this file). The Settings → Advanced → Auto-launch toggle (`.neumo-inset` well + raised knob per §6.4) is the only persistent installer-owned control.

**Glass surfaces the installer pipeline feeds (§5.5 coverage map excerpt):**

| Surface | Glass tier | Installer output consumed |
|---|---|---|
| Download hub card (Mac / Windows / Linux) | `.glass` + 2px emerald left-border (§5.4) | Installer URL + size + SHA-256 |
| First-run Welcome screen | `.glass` card + emerald CTA (§8.19 empty-state pattern) | Fresh install trigger |
| First-run PIN setup screen | `.glass-strong` + backdrop | BR-SEC-05 6-digit PIN |
| First-run backup-passphrase setup | `.glass-strong` + backdrop | BACKUP-1, BR-SEC-06 |
| Settings → Advanced → Auto-launch toggle row | `.glass-faint` band | Auto-launch on login opt-in |

**Neumorphic controls the installer touches (§6.6 coverage map excerpt):**

| Control | Recipe | Installer interaction |
|---|---|---|
| First-run "Get started" CTA | `.neumo-raised` + emerald glow | Launches sign-in flow |
| First-run "Enable biometric?" toggle | `.neumo-inset` well + raised knob | BR-SEC-04 opt-in |
| Auto-launch toggle (Settings) | `.neumo-inset` well + raised knob | Writes OS-specific entry (§6.1) |
| "Erase all data and quit" button | `.neumo-raised` + FLARE glow | 10_Security §18.1 secure-erase |

> **References.** WiX Toolset docs (wixtoolset.org); Tauri 2 bundle docs (tauri.app/develop/bundle); Apple Developer — Installer docs + `dmgbuild` (developer.apple.com); Microsoft — MSIX + AppInstaller docs (learn.microsoft.com); Linux AppImage docs (docs.appimage.org); Debian Policy Manual (debian.org/doc/debian-policy); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "Backdrop-Filter Performance Case Study"; Nielsen Norman Group — "Wireframing for UX Design". The mockups below are the installer contract; the prose above is the rationale.

### 13.2 M1 — Per-OS Installer Anatomy (File Tree + Size Budget)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  WINDOWS .msi  (~12 MB, target per §9; built by WiX per §2)                         │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │  Buddysaradhi-1.4.3-x64.msi                                                          │  │
│  │  ├── Buddysaradhi.exe                              ~6.0 MB  (Rust binary, stripped, │  │
│  │                                                        LTO, panic=abort)        │  │
│  │  ├── dist/                                    ~1.5 MB  (frontend: JS + CSS +   │  │
│  │   │   ├── index.html                                    fonts, gzipped)         │  │
│  │   │   ├── assets/react-[hash].js                                              │  │
│  │   │   ├── assets/ui-[hash].js  (@buddysaradhi/ui primitives)                       │  │
│  │   │   ├── assets/route-dashboard-[hash].js                                     │  │
│  │   │   ├── assets/route-students-[hash].js                                      │  │
│  │   │   ├── assets/route-attendance-[hash].js                                    │  │
│  │   │   ├── assets/route-fees-[hash].js                                          │  │
│  │   │   ├── assets/route-settings-[hash].js                                      │  │
│  │   │   └── assets/*.css  (Tailwind + tokens from §2.1)                          │  │
│  │  ├── icon.ico                                 ~0.2 MB                          │  │
│  │  ├── WebView2EvergreenBootstrapper.exe        ~2.0 MB  (downloads WebView2      │  │
│  │                                                        Runtime on first run)    │  │
│  │  └── WiX scaffold + .cab                      ~2.3 MB                          │  │
│  │  ─────────────────────────────────────────────                                   │  │
│  │  TOTAL                                         ~12.0 MB  (≤ 12 MB target ✓)    │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  macOS .dmg  (~14 MB universal, target per §9; built by Tauri per §3)               │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │  Buddysaradhi-1.4.3.dmg  (drag-to-install, 660×400 background per §3.2)              │  │
│  │  └── Buddysaradhi.app                                                                │  │
│  │      └── Contents/                                                              │  │
│  │          ├── MacOS/Buddysaradhi                    ~7.0 MB  (universal binary:       │  │
│  │            (lipo of aarch64 + x86_64)                   aarch64 + x86_64)        │  │
│  │          ├── Resources/                                                          │  │
│  │          │   ├── dist/                        ~1.5 MB  (frontend)               │  │
│  │          │   ├── icon.icns                    ~0.5 MB                            │  │
│  │          │   └── entitlements.plist           ~0.001 MB (Hardened Runtime)       │  │
│  │          ├── Frameworks/                      ~4.0 MB  (Tauri's bundled         │  │
│  │            (signed + notarized + stapled)              frameworks)               │  │
│  │          └── Info.plist                       ~0.005 MB                          │  │
│  │  ─────────────────────────────────────────────                                   │  │
│  │  TOTAL                                         ~14.0 MB  (≤ 14 MB target ✓)    │  │
│  │  + DMG overhead (background, README)          ~1.0 MB  (counted above)          │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  Linux .AppImage  (~14 MB, target per §9; built by Tauri per §4.1)                  │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │  Buddysaradhi-1.4.3-x86_64.AppImage  (squashfs, portable, chmod +x to run)            │  │
│  │  ├── AppRun                                   ~0.05 MB  (launcher script)        │  │
│  │  ├── Buddysaradhi                                  ~6.0 MB  (Rust binary)            │  │
│  │  ├── dist/                                    ~1.5 MB  (frontend)               │  │
│  │  ├── icon.png                                 ~0.3 MB                            │  │
│  │  ├── buddysaradhi.desktop                          ~0.001 MB                          │  │
│  │  └── usr/lib/                                 ~6.0 MB  (bundled WebKitGTK +     │  │
│  │    (the portability tax — AppImage bundles              GTK runtime — makes the  │  │
│  │     the runtime so it runs identically across           AppImage run identically │  │
│  │     Ubuntu / Fedora / Debian / Arch)                    across distros)          │  │
│  │  ─────────────────────────────────────────────                                   │  │
│  │  TOTAL                                         ~14.0 MB  (≤ 14 MB target ✓)    │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  Linux .deb  (~8 MB, uses system WebKitGTK; built by Tauri per §4.2)                │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │  buddysaradhi-1.4.3_amd64.deb                                                         │  │
│  │  ├── /opt/buddysaradhi/Buddysaradhi                    ~6.0 MB  (Rust binary)            │  │
│  │  ├── /opt/buddysaradhi/resources/dist/            ~1.5 MB  (frontend)               │  │
│  │  ├── /usr/share/applications/buddysaradhi.desktop  ~0.001 MB                         │  │
│  │  ├── /usr/share/icons/hicolor/512x512/apps/   ~0.3 MB                          │  │
│  │  │   buddysaradhi.png                                                                 │  │
│  │  └── /usr/share/mime/packages/buddysaradhi.xml     ~0.001 MB                         │  │
│  │  ─────────────────────────────────────────────                                   │  │
│  │  TOTAL                                         ~8.0 MB   (≤ 14 MB target ✓)    │  │
│  │  (smaller than AppImage — uses system WebKitGTK instead of bundling it)         │  │
│  │  Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1            │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ each installer format is a .glass card with emerald left-border per §5.4 (proceed accent)
   ↑ the Rust binary dominates every format (~6 MB) — kept small via LTO + strip + opt-level=z
   ↑ the frontend dist is ~1.5 MB across all formats (gzipped JS + CSS + fonts)
   ↑ the Windows .msi bundles WebView2 Bootstrapper (~2 MB) for first-run install
   ↑ the macOS .dmg ships a universal binary (~2 MB larger than single-arch; accepted per §9.2)
   ↑ the Linux .AppImage bundles WebKitGTK (~6 MB portability tax) for distro-agnostic runs
   ↑ the Linux .deb uses system WebKitGTK (smaller, but requires distro to have 4.1+)
   ↑ CI gate: bundle-size-check job fails if any format exceeds the 14/16 MB hard ceiling (§9)
   ↑ cross-refs: §2 (WiX), §3 (DMG), §4 (AppImage + deb), §8 (composition), §9 (size budget)
```

### 13.3 M2 — Install-Path Tree (Per-OS: Binary, Data, Keychain)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  WINDOWS  (per-user install, no admin, per §2.3)                                    │
│                                                                                      │
│  C:\Users\<user>\AppData\                                                            │
│  │                                                                                  │
│  ├── Local\Buddysaradhi\                ← APP_DATA_DIR  (binary, NOT roamed)             │
│  │   ├── Buddysaradhi.exe               ← binary (installed by .msi)                     │
│  │   ├── dist\                     ← frontend (installed by .msi)                   │
│  │   ├── buddysaradhi.db                ← SQLCipher ciphertext (10_Security §14.2)       │
│  │   ├── .store.dat                ← tauri-plugin-store (window.state, last_crash)  │
│  │   ├── receipts\                 ← shell:allow-open scope (*.pdf only)           │
│  │   │   ├── RCT-2025-000043.pdf                                                     │
│  │   │   └── RCT-2025-000044.pdf                                                     │
│  │   ├── crash-<ts>.dmp            ← crash dumps (10_Security §3.6, never sent)     │
│  │   └── backups\                  ← fs:allow-read-dir scope  ✅ read by webview    │
│  │       ├── 2025-01-15.buddysaradhi                                                     │
│  │       └── 2025-01-22.buddysaradhi                                                     │
│  │                                                                                  │
│  └── Roaming\Buddysaradhi\              ← APP_CONFIG_DIR (roamed on domain join)         │
│      └── (same layout as Local\Buddysaradhi above on Windows; paths canonicalised        │
│         by the `directories` crate which respects XDG on Linux)                     │
│                                                                                      │
│  OS Keychain (Credential Manager):                                                   │
│  ├── buddysaradhi / sqlcipher-key       ← base64 of 32 random bytes                     │
│  ├── buddysaradhi / supabase-refresh    ← Supabase refresh token                         │
│  └── buddysaradhi / turso-db-token      ← scoped Turso JWT                               │
│                                                                                      │
│  Start Menu: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Buddysaradhi\Buddysaradhi.lnk     │
│  Desktop (opt-in): C:\Users\<user>\Desktop\Buddysaradhi.lnk                              │
│  Auto-launch (opt-in): HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Buddysaradhi    │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  macOS  (drag-to-install, per §3)                                                   │
│                                                                                      │
│  /Applications/Buddysaradhi.app          ← binary (drag from .dmg)                       │
│  └── Contents/                                                                      │
│      ├── MacOS/Buddysaradhi                                                              │
│      ├── Resources/dist/                                                            │
│      ├── Frameworks/                                                                │
│      └── Info.plist                                                                 │
│                                                                                      │
│  ~/Library/Application Support/Buddysaradhi/   ← APP_CONFIG_DIR + APP_DATA_DIR (same)    │
│  ├── buddysaradhi.db                    ← SQLCipher ciphertext                            │
│  ├── .store.dat                    ← tauri-plugin-store                             │
│  ├── receipts\                     ← shell:allow-open scope                         │
│  ├── crash-<ts>.dmp                ← crash dumps                                    │
│  └── backups\                      ← fs:allow-read-dir scope                        │
│                                                                                      │
│  ~/Library/Preferences/app.buddysaradhi.Buddysaradhi.plist   ← Tauri store preferences        │
│  ~/Library/Logs/Buddysaradhi/                            ← app logs                      │
│                                                                                      │
│  OS Keychain (Keychain Access):                                                      │
│  ├── buddysaradhi / sqlcipher-key       ← base64 of 32 random bytes                     │
│  ├── buddysaradhi / supabase-refresh                                                     │
│  └── buddysaradhi / turso-db-token                                                       │
│                                                                                      │
│  Auto-launch (opt-in): Login Items (via osascript or LSSharedFileList, §6)          │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  LINUX  (AppImage portable OR .deb apt-integrated, per §4)                          │
│                                                                                      │
│  AppImage (portable):                                                                │
│  ~/Applications/Buddysaradhi-1.4.3-x86_64.AppImage  ← wherever the user puts it         │
│  (chmod +x; ./Buddysaradhi-*.AppImage)                                                    │
│                                                                                      │
│  .deb (apt-integrated):                                                              │
│  /opt/buddysaradhi/Buddysaradhi               ← binary                                         │
│  /opt/buddysaradhi/resources/dist/       ← frontend                                       │
│  /usr/share/applications/buddysaradhi.desktop  ← Start Menu entry                         │
│  /usr/share/icons/hicolor/512x512/apps/buddysaradhi.png                        │
│  /usr/share/mime/packages/buddysaradhi.xml  ← .buddysaradhi MIME type                          │
│                                                                                      │
│  ~/.local/share/Buddysaradhi/            ← APP_DATA_DIR (XDG_DATA_HOME respected)        │
│  ├── buddysaradhi.db                    ← SQLCipher ciphertext                            │
│  ├── .store.dat                    ← tauri-plugin-store                             │
│  ├── receipts/                     ← shell:allow-open scope                         │
│  ├── crash-<ts>.dmp                ← crash dumps                                    │
│  └── backups/                      ← fs:allow-read-dir scope                        │
│                                                                                      │
│  ~/.config/Buddysaradhi/                 ← APP_CONFIG_DIR (XDG_CONFIG_HOME respected)    │
│  └── (config files; the `directories` crate keeps data + config separate on Linux)  │
│                                                                                      │
│  OS Keychain (Secret Service / D-Bus → GNOME Keyring or KDE Wallet):                 │
│  ├── buddysaradhi / sqlcipher-key       ← base64 of 32 random bytes                     │
│  ├── buddysaradhi / supabase-refresh                                                     │
│  └── buddysaradhi / turso-db-token                                                       │
│                                                                                      │
│  Auto-launch (opt-in): ~/.config/autostart/buddysaradhi.desktop                           │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the "user-data path preserved on uninstall" rule (§1) is the load-bearing installer
     invariant — a tutor who uninstalls (to free disk, switch laptops, by accident) keeps
     their DB, backups, receipts, and keychain entries
   ↑ the binary path differs per OS: %LOCALAPPDATA% (Win), /Applications (Mac), /opt or
     anywhere (Linux) — but the user-data path is always per-user, never system-wide
   ↑ the OS keychain is NOT a file — it lives in Credential Manager (Win), Keychain (Mac),
     or Secret Service / D-Bus (Linux). The Rust `keyring` crate abstracts the platform.
   ↑ the backups/ and receipts/ dirs are scope-restricted per 03 §11 (fs:allow-read-dir
     and shell:allow-open) — the webview can only access these two paths, nothing else
   ↑ the auto-launch entry is opt-in (Settings → Advanced), off by default — the tutor
     hasn't used the app yet at install time, so we don't presume (§6.3)
   ↑ cross-refs: §1 (three install targets), §2.3 (Windows paths), §3.5 (macOS uninstall),
     §4.1.3 (Linux AppImage paths), §4.2 (Linux .deb paths), §6 (auto-launch), 03 §11 (scope)
```

### 13.4 M3 — Uninstall Flow (Uninstall Is Not Data Loss)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  WINDOWS UNINSTALL  (msiexec /x Buddysaradhi-1.4.3-x64.msi, per §2.4)                    │
│                                                                                      │
│  ┌─ .glass-strong modal (Confirm uninstall) ────────────────────────────────────┐  │
│  │  Are you sure you want to uninstall Buddysaradhi?                                  │  │
│  │                                                                                │  │
│  │  Your data (database, backups, receipts) will be PRESERVED.                   │  │
│  │  Reinstalling later will resume where you left off.                           │  │
│  │                                                                                │  │
│  │  ┌──────────────┐  ┌──────────────────┐                                       │  │
│  │  │  Cancel      │  │ ▌ Uninstall       │  ← .neumo-raised + FLARE glow         │  │
│  │  └──────────────┘  └──────────────────┘     (destructive — removes binary)     │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  STEP 1: REMOVE  %LOCALAPPDATA%\Buddysaradhi\       ← binary, dist, icon                 │
│  STEP 2: REMOVE  Start Menu shortcut                                                │
│  STEP 3: REMOVE  Desktop shortcut (if it was created)                               │
│  STEP 4: REMOVE  .buddysaradhi file association (HKCU\Software\Classes\.buddysaradhi)          │
│  STEP 5: REMOVE  auto-launch registry entry (HKCU\...\Run\Buddysaradhi, if created)       │
│  STEP 6: PRESERVE %APPDATA%\Buddysaradhi\data\       ← SQLCipher DB, backups, receipts   │
│  STEP 7: PRESERVE OS keychain entries (sqlcipher-key, supabase-refresh, turso-db-   │
│          token) — these are NOT in the filesystem; the OS keychain keeps them        │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (reinstall later)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  REINSTALL  →  app boots straight into the tutor's existing state (data preserved)  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  macOS UNINSTALL  (drag Buddysaradhi.app from Applications to Trash, per §3.5)           │
│                                                                                      │
│  REMOVE:                                                                             │
│    • /Applications/Buddysaradhi.app (binary, dist, frameworks)                            │
│                                                                                      │
│  PRESERVE:                                                                           │
│    • ~/Library/Application Support/Buddysaradhi/  (DB, backups, receipts, crash dumps)    │
│    • ~/Library/Preferences/app.buddysaradhi.Buddysaradhi.plist  (Tauri store)                  │
│    • ~/Library/Logs/Buddysaradhi/  (app logs)                                             │
│    • OS Keychain entries (sqlcipher-key, supabase-refresh, turso-db-token)           │
│                                                                                      │
│  REINSTALL → re-drag Buddysaradhi.app to Applications → boots into existing state         │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  LINUX UNINSTALL  (apt remove buddysaradhi OR delete AppImage, per §4.2.2)               │
│                                                                                      │
│  AppImage:  rm ~/Applications/Buddysaradhi-*.AppImage                                     │
│    REMOVE:    the AppImage file                                                      │
│    PRESERVE:  ~/.local/share/Buddysaradhi/, ~/.config/Buddysaradhi/, OS keychain               │
│                                                                                      │
│  .deb:  sudo apt remove buddysaradhi                                                      │
│    REMOVE:    /opt/buddysaradhi/, /usr/share/applications/buddysaradhi.desktop,                │
│                /usr/share/icons/hicolor/512x512/apps/buddysaradhi.png,                    │
│                /usr/share/mime/packages/buddysaradhi.xml                                   │
│    PRESERVE:  ~/.local/share/Buddysaradhi/, ~/.config/Buddysaradhi/, OS keychain               │
│                                                                                      │
│  sudo apt purge buddysaradhi  (also removes /etc config — STILL preserves user data)     │
│                                                                                      │
│  REINSTALL → apt install buddysaradhi (or re-download AppImage) → boots into existing    │
│  state                                                                               │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  THE CLEAN-UNINSTALL ESCAPE HATCH  (Settings → Advanced → "Erase all data and      │
│  quit", per §3.6 + 10_Security.md §18.1)                                            │
│                                                                                      │
│  For tutors who want a FULLY clean uninstall (remove preserved data too):           │
│   1. Settings → Advanced → "Erase all data and quit"                                │
│   2. Typed "ERASE" confirmation (.neumo-inset input + flare ring)                    │
│   3. PIN gate (BR-SEC-04)                                                            │
│   4. crypto-shred: delete keychain entries, VACUUM DB, overwrite file with zeros,   │
│      remove ~/Library/Application Support/Buddysaradhi/ (or equivalent)                  │
│   5. audit_log (action='erase_complete') — written to a sidecar file before the     │
│      keychain is wiped (the audit row itself is destroyed in step 4)                │
│   6. App quits                                                                       │
│   7. Drag Buddysaradhi.app to Trash (or msiexec /x, or apt remove) → fully clean uninstall│
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the "uninstall is not data loss" guarantee (§1) is the load-bearing rule — every
     uninstall path preserves the user-data path + keychain entries
   ↑ the .neumo-raised + FLARE glow on the Uninstall button signals destructive intent
     (§8.2 — destructive variant)
   ↑ the .glass-strong modal + bg-black/60 backdrop focuses the user on the confirmation
   ↑ the Escape Hatch (Erase all data) is the only path that removes the preserved data —
     it requires typed "ERASE" + PIN + crypto-shred (10_Security §18.1)
   ↑ the audit_log row in step 5 is written to a SIDECAR file because the DB itself is
     about to be destroyed — the audit trail survives the wipe
   ↑ cross-refs: §1 (three install targets), §2.4 (Windows uninstall), §3.5 (macOS uninstall),
     §3.6 (clean uninstall), §4.2.2 (.deb uninstall), §6 (auto-launch), §7 (first-run),
     10_Security §18.1 (secure-erase), BR-SEC-04 (PIN gate), BR-IMP-01 (.buddysaradhi format)
```

### 13.5 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (architecture / file tree) | M1 installer anatomy, M2 install-path tree, M3 uninstall flow |
| Component anatomy | M3 uninstall-confirm modal (annotated with glass/neumo tiers) |
| State matrix | M3 uninstall paths × preserve/remove matrix (3 OSes × 2 actions) |
| Full-screen layout | (n/a — 06 is an installer spec, not a screen) |

> All three mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 84–116 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5; neumorphic controls recipe-annotated (`.neumo-raised`, `.neumo-inset`) per §6.6. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.4`, `§6.6`, `§8.2`, `§8.19`, `§1`, `§2.3`, `§2.4`, `§3.2`, `§3.5`, `§3.6`, `§4.1`, `§4.2`, `§6`, `§7`, `§8`, `§9`, `BR-SEC-04`, `BR-SEC-06`, `BR-IMP-01`, `BACKUP-1`).
