# 04 — Code Signing (Windows + macOS + Linux)

> An unsigned binary triggers OS-level warnings that destroy a tutor's trust on first install: Windows SmartScreen's "Unknown publisher" blue box, macOS Gatekeeper's "Buddysaradhi cannot be opened because Apple cannot check it for malicious software." Code signing is not optional — it is the difference between "I installed Buddysaradhi" and "I deleted the file because my computer told me to." This file is the signing contract: the certificates, the tools, the GitHub Actions workflows, the private-key handling, and the per-OS verification protocol.

Cross-references: `01_Architecture.md` §10 (build pipeline), `05_Updater.md` (updater signature, which is separate from the OS code-signing signature), `10_Security.md` §14.3 (code signing & updater), `15_Future_Roadmap.md` v1.4 (distribution milestone). The 10 non-negotiable rules in top-level `AGENTS.md` §2 apply unchanged — especially Rule 3 (no telemetry — even the signing flow must not phone home) and Rule 9 (no silent failures — a signing failure is a release blocker, not a "ship it unsigned" shortcut).

---

## 1. The Three-OS Signing Landscape

| OS | Certificate | Tool | Verification | Reputation system |
|---|---|---|---|---|
| Windows | EV Code Signing Certificate (SSL.com or DigiCert, ~$400/yr) | `SignTool.exe` | SmartScreen (cloud reputation) | EV cert bypasses "Unknown publisher" immediately; OV cert takes weeks of reputation buildup |
| macOS | Apple Developer ID Application certificate ($99/yr Apple Developer Program) | `codesign` + `xcrun notarytool` + `xcrun stapler` | Gatekeeper (notarization ticket) | Notarization is Apple's automated malware scan — required for distribution outside the App Store |
| Linux | (none required) — optional GPG self-signed | `gpg --detach-sign` | User opt-in via `AppImageLauncher` or manual `gpg --verify` | No central reputation system; trust is per-distribution |

The desktop app ships signed on all three. The signing is performed in GitHub Actions (never on a developer machine, except for manual emergency releases) using secrets stored in GitHub Actions encrypted secrets. The private keys never touch disk in plaintext — they live in the CI runner's ephemeral filesystem for the duration of the build, then are wiped when the runner is destroyed.

---

## 2. Windows — EV Code Signing

### 2.1 Why EV, Not OV

Windows distinguishes two types of code-signing certificates:

- **OV (Organisation Validation):** ~$200/yr. Issued after the CA verifies the organisation's identity. SmartScreen treats OV-signed binaries as "Unknown publisher" until the binary accumulates enough downloads (typically 100–1000) to build reputation. During this period, every user sees the blue "Windows protected your PC" SmartScreen warning.
- **EV (Extended Validation):** ~$400/yr. Issued after stricter verification (organisation registration, operational address, telephone verification). SmartScreen treats EV-signed binaries as "trusted" immediately — no reputation buildup required. The blue warning is skipped entirely.

For a tutor in Nagpur who is installing Buddysaradhi for the first time and sees "Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognised app from starting," the most likely outcome is they click "Don't run" and never come back. The EV cert is the difference between a smooth install and a lost user. The $200/yr premium is non-negotiable.

### 2.2 The EV Certificate Format

EV certs are issued as either:

- **A physical USB token** (the legacy format — the private key never leaves the token, and SignTool uses the token's CP to sign).
- **A cloud-hosted signing service** (SSL.com eSigner, DigiCert ONE, SignPath) — the private key never leaves the cloud HSM, and SignTool (or a signing tool) authenticates via a one-time TOTP.

The desktop app uses **SignPath** (free for OSS projects; paid tier for commercial) — the private key is in SignPath's HSM, and GitHub Actions authenticates via OIDC. This avoids shipping the EV cert's private key in any form to GitHub Actions secrets, which is a meaningful security improvement over the legacy USB-token flow.

### 2.3 The SignTool Command

```bash
# Sign the .msi with SHA-256 + RFC 3161 timestamp
signtool sign \
  /fd sha256 \
  /tr http://timestamp.digicert.com \
  /td sha256 \
  /sha1 <THUMBPRINT_OF_EV_CERT> \
  /d "Buddysaradhi" \
  /du "https://buddysaradhi.app" \
  Buddysaradhi-1.4.2-x64.msi

# Verify the signature
signtool verify /pa /v Buddysaradhi-1.4.2-x64.msi
```

| Flag | Purpose |
|---|---|
| `/fd sha256` | File digest algorithm — SHA-256 (the modern standard; SHA-1 is deprecated and rejected by SmartScreen). |
| `/tr http://timestamp.digicert.com` | RFC 3161 timestamp server URL — embeds a trusted timestamp in the signature so the signature remains valid after the certificate expires. |
| `/td sha256` | Timestamp digest algorithm — SHA-256. |
| `/sha1 <thumbprint>` | The thumbprint of the EV cert in the cert store (or the SignPath equivalent). |
| `/d "Buddysaradhi"` | Description — appears in the file's Properties → Digital Signatures tab. |
| `/du "https://buddysaradhi.app"` | Description URL — appears as a clickable link in the SmartScreen dialog. |

### 2.4 The GitHub Actions Workflow (Windows)

```yaml
# .github/workflows/desktop-release-windows.yml
name: Desktop Release — Windows

on:
  push:
    tags: ['v*']

jobs:
  build-and-sign:
    runs-on: windows-latest
    permissions:
      contents: write
      id-token: write  # required for SignPath OIDC
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with: { bun-version: '1.1' }

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Install frontend deps
        run: bun install --frozen-lockfile

      - name: Build frontend
        run: bun run build
        working-directory: apps/desktop

      - name: Build Rust binary
        run: cargo build --release --target x86_64-pc-windows-msvc
        working-directory: src-tauri

      - name: Bundle as .msi
        run: cargo tauri build --target x86_64-pc-windows-msvc
        working-directory: src-tauri
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}

      - name: Sign .msi with SignPath
        uses: signpath-io/signpath-action@v1
        with:
          organization-id: ${{ secrets.SIGNPATH_ORG_ID }}
          project-slug: buddysaradhi-desktop
          signing-policy-slug: release-signing
          artifact-configuration-slug: msi
          github-token: ${{ secrets.GITHUB_TOKEN }}
          parameters: |
            {"version": "${{ github.ref_name }}"}
          input-path: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Buddysaradhi-1.4.2-x64.msi
          output-path: Buddysaradhi-1.4.2-x64.msi

      - name: Verify signature
        run: |
          & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" verify /pa /v Buddysaradhi-1.4.2-x64.msi

      - name: Upload to Vercel Blob
        run: bun run scripts/upload-to-blob.ts --file Buddysaradhi-1.4.2-x64.msi --path releases/desktop/windows/${{ github.ref_name }}/Buddysaradhi-x64.msi
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Update manifest
        run: bun run scripts/update-release-manifest.ts --version ${{ github.ref_name }} --platform windows-x86_64 --url https://blob.vercel-storage.com/.../Buddysaradhi-${{ github.ref_name }}-x64.msi --signature $(cat Buddysaradhi-1.4.2-x64.msi.sig)

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: Buddysaradhi-1.4.2-x64.msi
          generate_release_notes: true
```

### 2.5 SmartScreen Reputation

Even with an EV cert, the first few hundred downloads of a new binary may see a "Windows protected your PC" warning if Microsoft's cloud hasn't yet registered the binary as trusted. Mitigations:

- **EV cert short-circuits this.** EV-signed binaries are trusted immediately; no reputation buildup required. This is the primary reason we pay $400/yr instead of $200/yr.
- **Submit to Microsoft Partner Center.** Even without an EV cert, you can submit binaries for reputation review (free, takes 1–14 days). With an EV cert, this is unnecessary.
- **Domain reputation.** The download URL (`buddysaradhi.app`) is HTTPS, has a valid SSL cert, and is linked from the web app's download hub. Microsoft's SmartScreen checks the download domain's reputation as part of the verdict.

### 2.6 What Happens If the EV Cert Expires

EV certs expire every 1–3 years. The signed .msi remains valid indefinitely **because of the RFC 3161 timestamp** — the timestamp proves the signature was made when the cert was valid. The cert must be renewed before expiry so new releases can be signed; old releases remain installable.

A non-renewed EV cert is a release blocker — the next release ships unsigned, which means SmartScreen warnings, which means lost users. Renewal is calendared 30 days before expiry.

---

## 3. macOS — Developer ID + Notarization + Stapling

### 3.1 The Three-Step macOS Signing Process

macOS requires three distinct operations on a distributable binary:

1. **Code sign** with a Developer ID Application certificate.
2. **Notarize** via `xcrun notarytool submit` — Apple's automated malware scan.
3. **Staple** the notarization ticket via `xcrun stapler staple` — embeds the ticket in the binary so offline verification works.

A binary that is signed but not notarized triggers Gatekeeper's "Buddysaradhi cannot be opened because Apple cannot check it for malicious software" dialog. A binary that is signed and notarized but not stapled requires an online check on first launch (Gatekeeper contacts Apple's servers to verify the notarization ticket) — fails on offline machines. All three steps are mandatory.

### 3.2 The Developer ID Application Certificate

The Developer ID Application certificate is issued by Apple as part of the Apple Developer Program ($99/yr). It is **not** the same as the "Mac App Distribution" certificate (which is for App Store distribution). The Developer ID Application cert is for distribution **outside** the App Store — exactly our case.

To create the cert:

1. Generate a Certificate Signing Request (CSR) on a Mac via Keychain Access.
2. Submit the CSR at developer.apple.com → Account → Certificates, Identifiers & Profiles → Certificates → "+" → "Developer ID Application".
3. Download the issued certificate and add it to Keychain.
4. Export the certificate + private key as a `.p12` file (password-protected) — this is what GitHub Actions uses.

The `.p12` file is stored in GitHub Actions secrets as `MACOS_CERTIFICATE_P12_BASE64` (base64-encoded). The password is stored as `MACOS_CERTIFICATE_PASSWORD`. The Apple ID + team ID + app-specific password (for `notarytool`) are stored as `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`.

### 3.3 The `codesign` Command

```bash
# 1. Build the universal .app bundle
cargo tauri build --target universal-apple-darwin

# 2. Code-sign the .app bundle (recursive, hardened runtime)
codesign --deep --force --options runtime --sign "Developer ID Application: Buddysaradhi Pvt Ltd (TEAM_ID)" \
  --entitlements src-tauri/entitlements.plist \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/Buddysaradhi.app

# 3. Verify the signature
codesign --verify --deep --strict --verbose=2 src-tauri/target/universal-apple-darwin/release/bundle/macos/Buddysaradhi.app
```

| Flag | Purpose |
|---|---|
| `--deep` | Recursively sign all nested bundles (the .app contains frameworks, helpers, etc.). |
| `--force` | Replace any existing signature. |
| `--options runtime` | Enable Hardened Runtime (required for notarization). Blocks certain runtime attacks (JIT, dyld injection). |
| `--sign "Developer ID Application: ..."` | The certificate Common Name (CN) — exact string from Keychain. |
| `--entitlements` | The entitlements plist (declares exceptions to Hardened Runtime — e.g. `com.apple.security.cs.allow-jit` if needed). |

### 3.4 The `entitlements.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <false/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <false/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <false/>
    <key>com.apple.security.device.camera</key>
    <false/>
    <!-- No entitlements needed — Buddysaradhi does not use JIT, unsigned memory, or library validation bypass. -->
</dict>
</plist>
```

The desktop app requires no Hardened Runtime exceptions. This is the strictest possible posture — the app cannot load unsigned dylibs, cannot JIT-compile code, cannot map writable+executable memory. A future feature requiring an exception (e.g. a v3.0 on-device LLM with JIT) would need a `desktop/AGENTS.md` §8 stop-and-ask.

### 3.5 Notarization via `xcrun notarytool`

```bash
# 4. Zip the .app bundle (notarytool accepts .zip, .dmg, .pkg)
ditto -c -k --keepParent src-tauri/target/universal-apple-darwin/release/bundle/macos/Buddysaradhi.app Buddysaradhi.zip

# 5. Submit for notarization (5–30 min wait)
xcrun notarytool submit Buddysaradhi.zip \
  --apple-id "engineering@buddysaradhi.app" \
  --team-id "TEAM_ID" \
  --password "APP_SPECIFIC_PASSWORD" \
  --keychain-profile "buddysaradhi-notarization" \
  --wait

# 6. Check the notarization status
xcrun notarytool info <SUBMISSION_ID> \
  --apple-id "engineering@buddysaradhi.app" \
  --team-id "TEAM_ID" \
  --password "APP_SPECIFIC_PASSWORD"
```

`notarytool submit --wait` blocks until Apple's notarization service returns a verdict (typically 5–30 minutes). The verdict is either:

- **Accepted** — the binary passed Apple's malware scan. The notarization ticket is now available for stapling.
- **Invalid** — the binary failed the scan. The full log is fetched via `xcrun notarytool log <SUBMISSION_ID>` — typical failures are unsigned nested code, wrong entitlements, or Hardened Runtime not enabled.

A notarization failure is a release blocker. The CI workflow fails the build and surfaces the log URL in the GitHub Actions summary.

### 3.6 Stapling via `xcrun stapler`

```bash
# 7. Build the .dmg from the signed + notarized .app
cargo tauri build --target universal-apple-darwin --bundle dmg
# (this produces Buddysaradhi-1.4.2.dmg containing the .app)

# 8. Staple the notarization ticket to the .dmg
xcrun stapler staple src-tauri/target/universal-apple-darwin/release/bundle/dmg/Buddysaradhi-1.4.2.dmg

# 9. Verify the staple
xcrun stapler validate src-tauri/target/universal-apple-darwin/release/bundle/dmg/Buddysaradhi-1.4.2.dmg
```

Stapling embeds the notarization ticket in the .dmg so Gatekeeper can verify it offline. Without stapling, the first launch on an offline machine fails with "Buddysaradhi cannot be opened because Apple cannot check it for malicious software."

### 3.7 The GitHub Actions Workflow (macOS)

```yaml
# .github/workflows/desktop-release-macos.yml
name: Desktop Release — macOS

on:
  push:
    tags: ['v*']

jobs:
  build-and-sign:
    runs-on: macos-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with: { bun-version: '1.1' }

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - name: Import code-signing certificate
        env:
          MACOS_CERTIFICATE_P12_BASE64: ${{ secrets.MACOS_CERTIFICATE_P12_BASE64 }}
          MACOS_CERTIFICATE_PASSWORD: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}
        run: |
          echo $MACOS_CERTIFICATE_P12_BASE64 | base64 --decode > certificate.p12
          security create-keychain -p build build.keychain
          security import certificate.p12 -P $MACOS_CERTIFICATE_PASSWORD -k build.keychain -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k build build.keychain

      - name: Install frontend deps
        run: bun install --frozen-lockfile

      - name: Build frontend
        run: bun run build
        working-directory: apps/desktop

      - name: Build universal .app
        run: cargo tauri build --target universal-apple-darwin
        working-directory: src-tauri
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
          APPLE_SIGNING_IDENTITY: "Developer ID Application: Buddysaradhi Pvt Ltd (${{ secrets.APPLE_TEAM_ID }})"

      - name: Notarize .app
        run: |
          ditto -c -k --keepParent src-tauri/target/universal-apple-darwin/release/bundle/macos/Buddysaradhi.app Buddysaradhi.zip
          xcrun notarytool submit Buddysaradhi.zip \
            --apple-id ${{ secrets.APPLE_ID }} \
            --team-id ${{ secrets.APPLE_TEAM_ID }} \
            --password ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }} \
            --wait

      - name: Staple notarization ticket
        run: |
          xcrun stapler staple src-tauri/target/universal-apple-darwin/release/bundle/dmg/Buddysaradhi-1.4.2.dmg
          xcrun stapler validate src-tauri/target/universal-apple-darwin/release/bundle/dmg/Buddysaradhi-1.4.2.dmg

      - name: Upload to Vercel Blob
        run: bun run scripts/upload-to-blob.ts --file src-tauri/target/universal-apple-darwin/release/bundle/dmg/Buddysaradhi-1.4.2.dmg --path releases/desktop/macos/${{ github.ref_name }}/Buddysaradhi.dmg
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Update manifest
        run: bun run scripts/update-release-manifest.ts --version ${{ github.ref_name }} --platform darwin-universal --url https://blob.vercel-storage.com/.../Buddysaradhi-${{ github.ref_name }}.dmg --signature $(cat Buddysaradhi-1.4.2.dmg.sig)
```

### 3.8 Apple's Notarization Lifecycle

- **Notarization is per-binary.** Every release must be re-notarized. There is no "once notarized, always notarized" — Apple re-scans every binary.
- **Notarization is free** (included in the $99/yr Apple Developer Program). No per-submission fee.
- **Notarization takes 5–30 minutes.** Apple's service is asynchronous; the `--wait` flag blocks until the verdict. During Apple's WWDC week (early June), notarization can take 2+ hours due to load.
- **Notarization can be revoked.** If Apple determines a notarized binary is malware (post facto), they can revoke the notarization, which causes Gatekeeper to start blocking the binary. We have never had a notarization revoked; the policy is "do not ship anything that could be classified as malware."

---

## 4. Linux — Optional GPG Signing

Linux has no central code-signing authority. The desktop app ships as an `.AppImage` (no signing required) and a `.deb` (signed via `dpkg-sig`, optional). The `.rpm` (if shipped) is signed via `rpm --sign`.

### 4.1 The AppImage

AppImages are portable executables — the user `chmod +x Buddysaradhi-1.4.2.AppImage && ./Buddysaradhi-1.4.2.AppImage`. No install, no signing. The user trusts the source (the download from `buddysaradhi.app`).

For paranoid users, the desktop app additionally GPG-signs the AppImage:

```bash
# Generate a GPG keypair (one-time, on a secure machine)
gpg --gen-key
# Use Buddysaradhi <security@buddysaradhi.app> as the identity
# Use a 4096-bit RSA key (or ed25519 for modern GPG)

# Export the public key (publish on buddysaradhi.app/.well-known/openpgpkey/...)
gpg --armor --export security@buddysaradhi.app > buddysaradhi-public-key.asc

# Sign the AppImage
gpg --detach-sign --armor Buddysaradhi-1.4.2.AppImage
# Produces Buddysaradhi-1.4.2.AppImage.asc

# Verify (user-side)
gpg --import buddysaradhi-public-key.asc
gpg --verify Buddysaradhi-1.4.2.AppImage.asc Buddysaradhi-1.4.2.AppImage
```

The GPG signature is uploaded alongside the AppImage to Vercel Blob. The download hub links to both files. Users who want to verify can run `gpg --verify`.

### 4.2 The .deb

The .deb is signed via `dpkg-sig` (optional but recommended for users who add the Buddysaradhi APT repository):

```bash
# Sign the .deb
dpkg-sig --sign builder -k security@buddysaradhi.app buddysaradhi-1.4.2.deb

# Verify (user-side)
dpkg-sig --verify buddysaradhi-1.4.2.deb
```

For users who install via `dpkg -i buddysaradhi-1.4.2.deb` (without adding the APT repo), signature verification is not performed — `dpkg` does not verify signatures by default. The APT repo, if added, would use the standard APT signing key flow (`apt-key add buddysaradhi-archive-key.asc`).

### 4.3 The .rpm (Optional)

The .rpm is signed via `rpmsign`:

```bash
# Configure ~/.rpmmacros (one-time)
# %_gpg_name Buddysaradhi <security@buddysaradhi.app>
# %__gpg_sign_cmd %{__gpg} gpg --force-v3-sigs --detach-sign --armor --batch --yes --no-tty ...

# Sign the .rpm
rpmsign --addsign buddysaradhi-1.4.2.rpm

# Verify (user-side)
rpm --checksig buddysaradhi-1.4.2.rpm
```

The .rpm is community-maintained — it ships later than the .AppImage and .deb. The signing key is the same GPG key as the AppImage.

### 4.4 The Linux GitHub Actions Workflow

```yaml
# .github/workflows/desktop-release-linux.yml
name: Desktop Release — Linux

on:
  push:
    tags: ['v*']

jobs:
  build-and-sign:
    runs-on: ubuntu-22.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with: { bun-version: '1.1' }

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-unknown-linux-gnu

      - name: Install system deps (WebKitGTK)
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

      - name: Install frontend deps
        run: bun install --frozen-lockfile

      - name: Build frontend
        run: bun run build
        working-directory: apps/desktop

      - name: Build AppImage + .deb
        run: cargo tauri build --target x86_64-unknown-linux-gnu
        working-directory: src-tauri
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}

      - name: Import GPG key
        env:
          GPG_PRIVATE_KEY: ${{ secrets.GPG_PRIVATE_KEY }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        run: |
          echo "$GPG_PRIVATE_KEY" | gpg --batch --import
          echo "allow-preset-passphrase" >> ~/.gnupg/gpg-agent.conf
          echo "default-cache-ttl 1" >> ~/.gnupg/gpg-agent.conf
          gpg-connect-agent reloadagent /bye
          echo "$GPG_PASSPHRASE" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 --export-subkeys security@buddysaradhi.app

      - name: GPG-sign AppImage
        run: |
          gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" \
            --detach-sign --armor \
            src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/Buddysaradhi-1.4.2.AppImage
        env:
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}

      - name: dpkg-sign .deb
        run: |
          dpkg-sig --sign builder -k security@buddysaradhi.app \
            src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/buddysaradhi-1.4.2_amd64.deb
        env:
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}

      - name: Upload to Vercel Blob
        run: |
          bun run scripts/upload-to-blob.ts --file src-tauri/.../Buddysaradhi-1.4.2.AppImage --path releases/desktop/linux/${{ github.ref_name }}/Buddysaradhi.AppImage
          bun run scripts/upload-to-blob.ts --file src-tauri/.../Buddysaradhi-1.4.2.AppImage.asc --path releases/desktop/linux/${{ github.ref_name }}/Buddysaradhi.AppImage.asc
          bun run scripts/upload-to-blob.ts --file src-tauri/.../buddysaradhi-1.4.2_amd64.deb --path releases/desktop/linux/${{ github.ref_name }}/buddysaradhi.deb
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}
```

---

## 5. Private Key Handling

### 5.1 The Five Secrets

| Secret | Storage | Rotation |
|---|---|---|
| `TAURI_PRIVATE_KEY` (Ed25519, for updater signature) | GitHub Actions secret | Per-major-version (v1 → v2 → ...); rotation is a release-blocker review. |
| `TAURI_KEY_PASSWORD` | GitHub Actions secret | Same as above. |
| `MACOS_CERTIFICATE_P12_BASE64` + `MACOS_CERTIFICATE_PASSWORD` | GitHub Actions secret | When the Developer ID cert expires (every 5 years) or is revoked. |
| `APPLE_ID` + `APPLE_TEAM_ID` + `APPLE_APP_SPECIFIC_PASSWORD` | GitHub Actions secret | When the app-specific password is rotated (annually) or the Apple ID changes. |
| `SIGNPATH_ORG_ID` + SignPath OIDC trust | SignPath console + GitHub OIDC | SignPath handles rotation internally; we only rotate the org ID if we move orgs. |
| `GPG_PRIVATE_KEY` + `GPG_PASSPHRASE` | GitHub Actions secret | Annually, or on suspected compromise. |
| `BLOB_READ_WRITE_TOKEN` | GitHub Actions secret (Vercel Blob) | Vercel auto-rotates; we only rotate on suspected compromise. |

### 5.2 Local Dev vs CI

The certificates are **not** installed on developer machines by default. A developer who needs to test signing locally (e.g. to debug a notarization failure) does so via:

- **macOS:** Their own self-signed cert (created via Keychain Access → "Create a Certificate"). The signed binary won't pass Gatekeeper, but the codesign flow is exercised.
- **Windows:** A self-signed cert via `New-SelfSignedCertificate`. Same caveat.
- **Linux:** Their own GPG key.

Production signing happens only in GitHub Actions. This separation means a compromised developer machine cannot produce a binary that users would trust (the production cert's private key is not on the developer machine).

### 5.3 The macOS Keychain on Local Dev

For the rare case where a developer needs to test signing with the production cert (e.g. to reproduce a notarization failure in CI), the production `.p12` is stored in 1Password (engineering vault) and imported into the developer's Keychain on a need-to-sign basis. The developer's Keychain is locked with a strong password; the cert is removed after the debugging session.

This is a manual process with two-person review (the developer + a second engineer confirms the cert is removed). It is not automated.

---

## 6. Key Rotation

### 6.1 The Updater Key (TAURI_PRIVATE_KEY)

The updater keypair is the most sensitive secret — it is the trust root for the auto-updater. If the private key is compromised, an attacker can ship a malicious update to every desktop install. Rotation:

1. Generate a new Ed25519 keypair (`tauri signer generate`).
2. Update the public key in `tauri.conf.json` → `plugins.updater.pubkey`.
3. Ship a new release with the new pubkey pinned. This release is signed with the **old** key (so existing installs trust the update).
4. After this release, all subsequent releases are signed with the **new** key. Existing installs now have the new pubkey pinned and trust the new signatures.
5. Revoke the old keypair (delete from GitHub Actions secrets; archive the private key in 1Password in case of emergency rollback).

This is a forward-rotation: the new release teaches existing installs the new pubkey. A backward-rotation (compromised new key, fall back to old) is harder and requires shipping a release signed with the old key that re-pins the old pubkey — feasible only if the old key was not also compromised.

### 6.2 The Apple Developer ID Cert

Rotation is rare (every 5 years). The new cert is issued via developer.apple.com, the .p12 is regenerated, and GitHub Actions secrets are updated. Old signed binaries remain valid (RFC 3161 timestamp).

### 6.3 The GPG Key

Annually. The new public key is published to `buddysaradhi.app/.well-known/openpgpkey/...` and keyserver.ubuntu.com. The old key is revoked (uploaded to keyservers with a revocation certificate). Users who verify with the old key see "REVOKED" and must re-import the new key.

---

## 7. The Signing Failure Modes

| Failure | Symptom | Fix | Prevention |
|---|---|---|---|
| EV cert expired | SignTool fails with "The signer's certificate is not valid for signing." | Renew the EV cert; re-issue via SSL.com. | Calendar renewal 30 days before expiry. |
| Apple notarization rejected | `xcrun notarytool` returns `Invalid`; log shows specific issue (e.g. "The binary is not signed with a Developer ID Application certificate"). | Fix the issue, re-sign, re-notarize. | CI runs `codesign --verify` before `notarytool submit` to catch signing issues early. |
| Notarization timeout (Apple WWDC week) | `--wait` blocks for 2+ hours; CI times out. | Re-submit; or release later. | Schedule major releases around WWDC (early June). |
| SignPath OIDC auth fails | SignPath action returns 401. | Check the GitHub Actions OIDC token claims; re-link the SignPath project to the GitHub repo. | Quarterly OIDC audit. |
| GPG key expired | `gpg --verify` returns "KEY EXPIRED". | Rotate the GPG key (§6.3). | Calendar GPG rotation annually. |
| Timestamp server down | SignTool fails with "The timestamp server could not be reached." | Retry with a different timestamp server (e.g. `http://timestamp.sectigo.com`). | SignTool has built-in retry (3 attempts). |
| Vercel Blob upload fails | The signed binary is uploaded but the manifest update fails. | Re-run `update-release-manifest.ts` manually with the same parameters. | The manifest update is idempotent (uses upsert by version+platform). |

---

## 8. Verification Protocol

A release is not "signed" until it has been verified end-to-end:

### 8.1 Windows Verification

```powershell
# On a fresh Windows VM (no Buddysaradhi installed):
PS> Invoke-WebRequest -Uri "https://blob.vercel-storage.com/.../Buddysaradhi-1.4.2-x64.msi" -OutFile Buddysaradhi.msi
PS> & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" verify /pa /v Buddysaradhi.msi

# Expected: "Successfully verified: Buddysaradhi.msi"
# Expected: "Signing Certificate Chain: ... Issued by: SSL.com EV Code Signing CA"
# Expected: NO SmartScreen warning on first install
```

### 8.2 macOS Verification

```bash
# On a fresh macOS VM:
$ curl -O https://blob.vercel-storage.com/.../Buddysaradhi-1.4.2.dmg
$ hdiutil attach Buddysaradhi-1.4.2.dmg
$ codesign --verify --deep --strict --verbose=2 /Volumes/Buddysaradhi/Buddysaradhi.app
# Expected: "Buddysaradhi.app: valid on disk"
# Expected: "Buddysaradhi.app: satisfies its Designated Requirement"

$ spctl --assess --type execute --verbose /Volumes/Buddysaradhi/Buddysaradhi.app
# Expected: "/Volumes/Buddysaradhi/Buddysaradhi.app: accepted"
# Expected: "source=Notarized Developer ID"

$ xcrun stapler validate /Volumes/Buddysaradhi/Buddysaradhi.app
# Expected: "Processing: /Volumes/Buddysaradhi/Buddysaradhi.app"
# Expected: "The validate action worked!"
```

### 8.3 Linux Verification

```bash
$ curl -O https://blob.vercel-storage.com/.../Buddysaradhi-1.4.2.AppImage
$ curl -O https://blob.vercel-storage.com/.../Buddysaradhi-1.4.2.AppImage.asc
$ curl -O https://buddysaradhi.app/.well-known/openpgpkey/buddysaradhi-public-key.asc
$ gpg --import buddysaradhi-public-key.asc
$ gpg --verify Buddysaradhi-1.4.2.AppImage.asc Buddysaradhi-1.4.2.AppImage
# Expected: "Good signature from 'Buddysaradhi <security@buddysaradhi.app>'"
$ chmod +x Buddysaradhi-1.4.2.AppImage
$ ./Buddysaradhi-1.4.2.AppImage
# Expected: Buddysaradhi launches without any "untrusted" prompts (AppImage has no central signing authority).
```

### 8.4 The Release Verification Checklist

Before announcing a release:

- [ ] Windows .msi signed, SmartScreen does NOT show "Unknown publisher" on a fresh VM.
- [ ] macOS .dmg signed, notarized, stapled. `spctl --assess` returns "accepted" with "source=Notarized Developer ID".
- [ ] Linux .AppImage GPG-signed; `gpg --verify` returns "Good signature".
- [ ] Linux .deb dpkg-signed; `dpkg-sig --verify` returns "GOODSIG".
- [ ] Updater manifest updated on Vercel Blob with all three platforms' URLs + signatures.
- [ ] End-to-end auto-update test passes: install the previous version, launch, verify the auto-updater offers the new version, accept, verify the update installs and launches.
- [ ] GitHub Release published with the three signed binaries attached.
- [ ] `worklog.md` appended with the release entry.

---

## 9. Cross-Reference Summary

| Topic in this file | Master / platform spec cross-ref |
|---|---|
| Code signing & updater | `10_Security.md` §14.3 |
| Distribution milestone | `15_Future_Roadmap.md` v1.4 |
| Build pipeline | `01_Architecture.md` §10 |
| Updater signature (separate from OS signing) | `05_Updater.md` §4 |
| No telemetry (the signing flow must not phone home) | `10_Security.md` §17, top-level `AGENTS.md` §2 Rule 3 |
| No silent failures (signing failure = release blocker) | top-level `AGENTS.md` §2 Rule 9 |
| Signed-binary upload → Vercel Blob bucket layout | `deployment/02_Vercel_Blob_Build_Storage.md` §2 |
| Signed-binary upload → manifest update workflow | `deployment/02_Vercel_Blob_Build_Storage.md` §3, `desktop/05_Updater.md` §10.3 |
| Commercial download hub (Mac + Windows cards link to the signed artifacts) | `product/04_Download_Hub.md` §2 |
| Release checklist (signing is item 7 of 15) | `deployment/04_Release_Pipeline.md` §5 |

---

## 10. What This File Does NOT Cover

- **The updater manifest format and channels** → `05_Updater.md`.
- **Installer internals (WiX, DMG layout, AppImage)** → `06_Installers.md`.
- **The Rust backend that produces the binaries** → `02_Rust_Core.md`.
- **The capability allowlist and CSP** → `03_IPC_Security.md`.

---

*This file is the code-signing contract. If the implementation diverges, this file wins — unless this file is wrong, in which case you amend this file first, then the code, then `worklog.md`. The order matters.*

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers three signing artefacts: the three-OS signing pipeline (Windows Authenticode via SignPath, macOS Developer ID + notarization + stapling, Linux GPG), the certificate chain (per-OS trust root: Microsoft root → SSL.com EV CA → Buddysaradhi; Apple Root CA → Apple Worldwide Developer Relations → Developer ID Application; GPG self-signed web-of-trust), and the trust flow (binary built in CI → signed → uploaded to Vercel Blob → updater verifies pinned pubkey → user installs without warnings).

### 11.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The signing pipeline owns no UI pixels — but its outputs (the signed `.msi` / `.dmg` / `.AppImage`) are surfaced in two UI touchpoints: (a) the commercial download hub at `product/04_Download_Hub.md` (5 cards in `.glass` + accent left-border per §5.4, emerald for Mac/Windows/Linux installers), and (b) the desktop updater's "Update available" toast in `.glass-strong` + violet accent per §8.8 (informational, not destructive — destructive would be flare).

**Glass surfaces the signing pipeline feeds (§5.5 coverage map excerpt):**

| Surface | Glass tier | Signing output consumed |
|---|---|---|
| Download hub card (Mac / Windows / Linux) | `.glass` + 2px emerald left-border (§5.4) | Signed `.dmg` / `.msi` / `.AppImage` URLs |
| Download hub SHA-256 caption | `.glass-faint` band | Per-platform `sha256` field from manifest |
| Updater "Update available" toast | `.glass-strong` + 4px violet left-bar | Signed binary from manifest `platforms.<os>.url` |
| Updater "Signature failed" toast | `.glass-strong` + 4px flare left-bar | Tampered binary — install aborted (§10.2 of 03) |
| GitHub Release assets list | (GitHub UI, not Buddysaradhi) | Signed binary + `.asc` (Linux) attached |

**Neumorphic controls the signing pipeline touches (§6.6 coverage map excerpt):**

| Control | Recipe | Signing interaction |
|---|---|---|
| "Download for Mac/Windows/Linux" button | `.neumo-raised` + emerald glow | Triggers download of signed binary |
| "Restart now" button (updater toast) | `.neumo-raised` + violet glow | Two-click confirm per §6.2 of 05 |
| "Skip this version" button (updater toast) | `.neumo-raised` (no glow) | Dismisses update prompt |
| "Retry later" button (signature-failed toast) | `.neumo-raised` (no glow) | Dismisses flare toast |

> **References.** Microsoft Authenticode + SignTool docs (learn.microsoft.com/windows/win32/seccrypto/signtool); Microsoft SignPath docs (signpath.org); Apple Developer — Code Signing + Notarization (developer.apple.com/documentation/security/notarizing_macos_software_before_distribution); Apple `xcrun notarytool` docs (developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/customizing_the_notarization_workflow); Linux AppImage signing docs (docs.appimage.org); GnuPG docs (gnupg.org/documentation); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "Backdrop-Filter Performance Case Study". The mockups below are the signing contract; the prose above is the rationale.

### 11.2 M1 — Three-OS Signing Pipeline (CI Matrix)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  TRIGGER: git push tag v1.4.3 (per deployment/04_Release_Pipeline.md §3)            │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  GitHub Actions matrix (3 jobs in parallel, .github/workflows/desktop-release-*.yml)│
└────────────────────────────────────────────────────────────────────────────────────┘
            │                              │                              │
            ▼                              ▼                              ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│  windows-latest           │  │  macos-latest              │  │  ubuntu-22.04             │
│  ┌─ .glass card ────────┐ │  │  ┌─ .glass card ────────┐ │  │  ┌─ .glass card ────────┐ │
│  │▌Windows · emerald    │ │  │  │▌macOS · emerald      │ │  │  │▌Linux · emerald      │ │
│  └──────────────────────┘ │  │  └──────────────────────┘ │  │  └──────────────────────┘ │
│                           │  │                           │  │                           │
│  1. bun install           │  │  1. bun install           │  │  1. bun install           │
│  2. bun run build (Vite)  │  │  2. bun run build (Vite)  │  │  2. bun run build (Vite)  │
│  3. cargo build --release │  │  3. cargo build --release │  │  3. cargo build --release │
│     --target              │  │     --target              │  │     --target              │
│     x86_64-pc-windows-msvc│  │     universal-apple-darwin│  │     x86_64-unknown-linux-gnu│
│  4. cargo tauri build     │  │  4. cargo tauri build     │  │  4. cargo tauri build     │
│     → Buddysaradhi-1.4.3-x64   │  │     → Buddysaradhi.app         │  │     → Buddysaradhi-1.4.3       │
│       .msi                │  │     → Buddysaradhi-1.4.3.dmg   │  │       .AppImage + .deb    │
│  5. tauri signer sign     │  │  5. tauri signer sign     │  │  5. tauri signer sign     │
│     (TAURI_PRIVATE_KEY)   │  │     (TAURI_PRIVATE_KEY)   │  │     (TAURI_PRIVATE_KEY)   │
│  6. SignPath OIDC sign    │  │  6. codesign --deep       │  │  6. gpg --detach-sign     │
│     .msi (EV cert, HSM)   │  │     --options runtime     │  │     --armor AppImage      │
│  7. signtool verify /pa   │  │     --sign "Developer ID  │  │  7. dpkg-sig --sign       │
│     → ✓ Success           │  │     Application: Buddysaradhi" │  │     --builder .deb        │
│                           │  │  7. xcrun notarytool      │  │  8. gpg --verify (smoke)  │
│                           │  │     submit --wait         │  │                           │
│                           │  │     → ✓ Accepted          │  │                           │
│                           │  │  8. xcrun stapler staple  │  │                           │
│                           │  │     .dmg                  │  │                           │
│                           │  │  9. xcrun stapler validate│  │                           │
│                           │  │     → ✓ staple OK         │  │                           │
│                           │  │ 10. codesign --verify     │  │                           │
│                           │  │     --deep --strict       │  │                           │
│                           │  │     → ✓ valid on disk     │  │                           │
└─────────────┬─────────────┘  └─────────────┬─────────────┘  └─────────────┬─────────────┘
              │                              │                              │
              ▼                              ▼                              ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  Upload to Vercel Blob (deployment/02 §3 — upload-to-blob.ts)                       │
│  • desktop/windows/Buddysaradhi-1.4.3-x64.msi          + .sig                          │
│  • desktop/macos/Buddysaradhi-1.4.3-universal.dmg      + .sig                          │
│  • desktop/linux/Buddysaradhi-1.4.3-x86_64.AppImage    + .sig + .asc (GPG)             │
│  • signatures/Buddysaradhi-1.4.3-x64.msi.sha256        (detached SHA-256)              │
│  • signatures/Buddysaradhi-1.4.3-universal.dmg.sha256                                 │
│  • signatures/Buddysaradhi-1.4.3-x86_64.AppImage.sha256                               │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  Update manifest (atomic write-temp-then-rename per deployment/02 §5)               │
│  manifests/desktop-staging.json:                                                    │
│    version: "1.4.3"                                                                 │
│    platforms.windows-x86_64.{url, signature}                                        │
│    platforms.darwin-universal.{url, signature}                                       │
│    platforms.darwin-aarch64.{url, signature}  (= darwin-universal, we ship universal)│
│    platforms.linux-x86_64.{url, signature}                                          │
│    sha256.{windows-x86_64, darwin-universal, darwin-aarch64, linux-x86_64}          │
│    metadata.{build_commit, build_runner, build_branch}                              │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (24-hour soak, then promote staging → stable per deployment/02 §6)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  THREE SURFACES ADVANCE ATOMICALLY (desktop/README §10.4 — one upload, three       │
│  surfaces, zero drift):                                                             │
│  (a) download hub cards at product/04_Download_Hub.md refresh (Mac + Windows cards)│
│  (b) desktop auto-updater prompts existing installs                                 │
│  (c) latest symlink on the download hub advances                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ each OS job is a .glass card with a 2px emerald left-border per §5.4 (proceed accent)
   ↑ the SignPath OIDC flow never ships the EV private key to GitHub Actions — it lives in
     SignPath's HSM; GitHub authenticates via OIDC (§2.2)
   ↑ the macOS flow is 10 steps — codesign + notarize + staple, in that order (§3.1)
   ↑ the Linux flow produces BOTH .AppImage + .deb (+ optional .rpm community-maintained)
   ↑ the .sig file is the Tauri Ed25519 updater signature (separate from OS signing — §3.3 of 05)
   ↑ the .asc file is the GPG detached signature (Linux paranoid-user verification, §4.1)
   ↑ the .sha256 file is a secondary hash check (consumed by download hub per product/04 §2.2)
   ↑ the manifest update is atomic (write-temp-then-rename per deployment/02 §5.2) — never a
     half-written manifest
   ↑ cross-refs: §2.4 (Windows CI), §3.7 (macOS CI), §4.4 (Linux CI), §5.1 (5 secrets),
     §6.1 (updater key rotation), 05 §3 (manifest schema), deployment/02 §3/§5 (Blob workflow)
```

### 11.3 M2 — Certificate Chain (Per-OS Trust Root)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  WINDOWS — EV Code Signing Certificate Chain                                        │
│                                                                                      │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │                                                                                │  │
│  │   Microsoft Root Authority  (offline root, in Windows Trust Store)            │  │
│  │           │                                                                   │  │
│  │           └── Microsoft Code Signing PCA 2011                                 │  │
│  │                   │                                                           │  │
│  │                   └── SSL.com EV Code Signing Intermediate CA                 │  │
│  │                           │                                                   │  │
│  │                           └── Buddysaradhi Pvt Ltd  (EV cert, ~$400/yr)            │  │
│  │                                ↑ stored in SignPath HSM (never on disk)       │  │
│  │                                ↑ thumbprint: <SHA-1 of cert>                  │  │
│  │                                ↑ SignTool /sha1 <thumbprint> signs .msi       │  │
│  │                                                                                │  │
│  │  RFC 3161 Timestamp Server (timestamp.digicert.com)                            │  │
│  │   └── embeds trusted timestamp in signature → .msi remains valid after         │  │
│  │       cert expiry (§2.6)                                                      │  │
│  │                                                                                │  │
│  │  SmartScreen Reputation: EV-signed → trusted IMMEDIATELY (no reputation build) │  │
│  │  OV-signed → "Unknown publisher" warning until ~100–1000 downloads accrue     │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  macOS — Developer ID Application + Notarization Chain                              │
│                                                                                      │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │                                                                                │  │
│  │   Apple Root CA  (offline root, in macOS System Roots)                        │  │
│  │           │                                                                   │  │
│  │           └── Apple Worldwide Developer Relations Certification Authority     │  │
│  │                   │                                                           │  │
│  │                   └── Developer ID Application: Buddysaradhi Pvt Ltd (TEAM_ID)     │  │
│  │                        ↑ $99/yr Apple Developer Program                       │  │
│  │                        ↑ stored as .p12 in GitHub Actions secret              │  │
│  │                          (MACOS_CERTIFICATE_P12_BASE64 + password)            │  │
│  │                        ↑ codesign --deep --options runtime --sign "Developer  │  │
│  │                          ID Application: Buddysaradhi Pvt Ltd (TEAM_ID)"           │  │
│  │                                                                                │  │
│  │  Apple Notarization Service (xcrun notarytool submit --wait)                  │  │
│  │   ├── scans .app for malware (5–30 min)                                       │  │
│  │   ├── on Accept → notarization ticket available for stapling                  │  │
│  │   └── on Invalid → CI fails; release blocker (§3.5)                           │  │
│  │                                                                                │  │
│  │  Stapling (xcrun stapler staple .dmg)                                          │  │
│  │   └── embeds ticket in .dmg → Gatekeeper verifies OFFLINE                     │  │
│  │                                                                                │  │
│  │  Gatekeeper (first launch):                                                    │  │
│  │   ├── spctl --assess → "source=Notarized Developer ID" → ✅ accepted          │  │
│  │   └── without staple → requires online check on first launch (fails offline)  │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  LINUX — GPG Self-Signed Web-of-Trust (optional, paranoid-user path)               │
│                                                                                      │
│  ┌─ .glass card (2px emerald left-border, §5.4) ────────────────────────────────┐  │
│  │                                                                                │  │
│  │   Buddysaradhi <security@buddysaradhi.app>  (4096-bit RSA or ed25519 GPG key)            │  │
│  │   ├── generated via: gpg --gen-key (one-time, on a secure machine)             │  │
│  │   ├── public key published to:                                                 │  │
│  │   │     • buddysaradhi.app/.well-known/openpgpkey/buddysaradhi-public-key.asc            │  │
│  │   │     • keyserver.ubuntu.com (so gpg --recv-keys works)                     │  │
│  │   ├── private key in GitHub Actions secret (GPG_PRIVATE_KEY + GPG_PASSPHRASE)  │  │
│  │   └── rotates annually (§6.3) — old key REVOKED on keyservers                  │  │
│  │                                                                                │  │
│  │  Signing commands:                                                             │  │
│  │   ├── gpg --detach-sign --armor Buddysaradhi-1.4.3-x86_64.AppImage                 │  │
│  │   │     → produces Buddysaradhi-1.4.3-x86_64.AppImage.asc                           │  │
│  │   ├── dpkg-sig --sign builder -k security@buddysaradhi.app buddysaradhi-1.4.3_amd64.deb │  │
│  │   └── rpmsign --addsign buddysaradhi-1.4.3.x86_64.rpm (optional, community)        │  │
│  │                                                                                │  │
│  │  User verification:                                                            │  │
│  │   ├── gpg --import buddysaradhi-public-key.asc                                      │  │
│  │   ├── gpg --verify Buddysaradhi-*.AppImage.asc Buddysaradhi-*.AppImage                   │  │
│  │   │     → "Good signature from 'Buddysaradhi <security@buddysaradhi.app>'"               │  │
│  │   └── dpkg-sig --verify buddysaradhi-*.deb → "GOODSIG"                              │  │
│  │                                                                                │  │
│  │  No central reputation system (unlike SmartScreen / Gatekeeper) — trust is     │  │
│  │  per-distribution. The download hub at product/04_Download_Hub.md links to     │  │
│  │  both the .AppImage AND the .asc so paranoid users can verify.                 │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ each OS chain is a .glass card with emerald left-border per §5.4 (proceed accent)
   ↑ Windows EV cert: $400/yr, SmartScreen-trusted immediately (§2.1)
   ↑ macOS Developer ID: $99/yr, requires notarization + stapling (§3.1)
   ↑ Linux GPG: free, optional, paranoid-user path (§4)
   ↑ the .p12 (macOS) and GPG private key never touch disk in plaintext outside CI —
     they live in GitHub Actions encrypted secrets (§5.1)
   ↑ the RFC 3161 timestamp means signed .msi / .app remain valid after cert expiry (§2.6, §3.8)
   ↑ key rotation: updater key per-major-version (§6.1), Apple cert every 5 years (§6.2),
     GPG annually (§6.3)
   ↑ cross-refs: §2.1 (EV vs OV), §2.3 (SignTool), §3.3 (codesign), §3.5 (notarytool),
     §3.6 (stapler), §4.1 (GPG), §5.1 (5 secrets), §6 (rotation), §8 (verification)
```

### 11.4 M3 — Trust Flow (Binary Built → Signed → Verified → Installed)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  BUILD  (CI runner, ephemeral filesystem)                                            │
│  cargo tauri build --release → Buddysaradhi-1.4.3-x64.msi (unsigned at this point)        │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  SIGN  (3 paths, per §2/§3/§4)                                                      │
│                                                                                      │
│  Windows:  signtool sign /fd sha256 /tr <ts_url> /td sha256 /sha1 <thumbprint> ...   │
│            → .msi now carries EV cert signature + RFC 3161 timestamp                 │
│                                                                                      │
│  macOS:    codesign --deep --force --options runtime --sign "Developer ID ..." ...   │
│            → .app now carries Developer ID signature + Hardened Runtime              │
│            xcrun notarytool submit Buddysaradhi.zip --wait                                │
│            → Apple notarization ticket issued (or release blocker on Invalid)        │
│            xcrun stapler staple Buddysaradhi-1.4.3.dmg                                    │
│            → ticket embedded in .dmg (offline Gatekeeper verification)               │
│                                                                                      │
│  Linux:    gpg --detach-sign --armor Buddysaradhi-1.4.3-x86_64.AppImage                  │
│            → .asc file produced alongside .AppImage                                  │
│            dpkg-sig --sign builder -k security@buddysaradhi.app buddysaradhi-1.4.3_amd64.deb  │
│            → .deb carries dpkg signature                                             │
│                                                                                      │
│  ALL THREE:  tauri signer sign -k $TAURI_PRIVATE_KEY Buddysaradhi-1.4.3-<arch>.<ext>     │
│              → .sig file (Ed25519 updater signature, separate from OS signing)       │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  UPLOAD  (deployment/02 §3 — upload-to-blob.ts)                                     │
│  • signed binary → desktop/<os>/Buddysaradhi-1.4.3-<arch>.<ext>                          │
│  • .sig (Ed25519 updater signature) → desktop/<os>/Buddysaradhi-1.4.3-<arch>.<ext>.sig   │
│  • .sha256 (secondary hash) → signatures/Buddysaradhi-1.4.3-<arch>.<ext>.sha256          │
│  • .asc (Linux GPG) → desktop/linux/Buddysaradhi-1.4.3-<arch>.AppImage.asc               │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  MANIFEST UPDATE  (atomic write-temp-then-rename per deployment/02 §5)              │
│  manifests/desktop-staging.json → version, platforms.*.url + signature, sha256,     │
│  metadata. After 24-hour soak → copy to manifests/desktop-stable.json (§6 promotion)│
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
│  PATH A: NEW INSTALL     │  │  PATH B: AUTO-UPDATE     │  │  PATH C: GPG VERIFY      │
│  (download hub)          │  │  (existing desktop app)  │  │  (paranoid Linux user)   │
│                          │  │                          │  │                          │
│  user visits             │  │  Tauri updater polls     │  │  user downloads          │
│   buddysaradhi.app/#download  │  │   /api/releases/desktop/ │  │   .AppImage + .asc       │
│                          │  │   stable every 6h        │  │                          │
│  hub card (Mac/Win/      │  │                          │  │  gpg --import            │
│   Linux) shows:          │  │  fetches manifest        │  │   buddysaradhi-public-key.asc │
│   • version (1.4.3)      │  │                          │  │                          │
│   • size (12 MB)         │  │  verifies manifest sig   │  │  gpg --verify            │
│   • SHA-256 (truncated)  │  │   with pinned pubkey     │  │   .AppImage.asc          │
│                          │  │   (tauri.conf.json       │  │   .AppImage              │
│  user clicks Download    │  │    plugins.updater.pubkey)│  │                          │
│   → Vercel Blob URL      │  │                          │  │  → "Good signature       │
│                          │  │  compares manifest       │  │      from Buddysaradhi"       │
│  OS verifies signature   │  │   version > app.version  │  │                          │
│   on first launch:       │  │   → if yes, emit         │  │  chmod +x .AppImage      │
│   Win: SmartScreen       │  │   "update-available"     │  │  ./.AppImage             │
│        checks EV cert    │  │   toast (.glass-strong   │  │                          │
│        → ✅ trusted      │  │    + violet left-bar)    │  │  (no central reputation  │
│   Mac: Gatekeeper        │  │                          │  │   system — trust is      │
│        checks notarized  │  │  user clicks "Restart    │  │   per-distribution)      │
│        + stapled ticket  │  │   now" (two-click        │  │                          │
│        → ✅ accepted     │  │   confirm per §6.2 of 05)│  │                          │
│   Linux: (no central     │  │                          │  │                          │
│    authority — user      │  │  updater downloads       │  │                          │
│    trusts the source)    │  │   binary, verifies       │  │                          │
│                          │  │   Ed25519 signature      │  │                          │
│                          │  │   against pinned pubkey  │  │                          │
│                          │  │                          │  │                          │
│                          │  │  swaps binary, restarts  │  │                          │
│                          │  │  smoke tests on launch   │  │                          │
│                          │  │  → ✅ passes: delete .bak│  │                          │
│                          │  │  → ❌ fails 3x: rollback │  │                          │
└──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
   ↑ all three paths consume the SAME signed binary on Vercel Blob — no drift
   ↑ Path A (new install): OS-level signature check (SmartScreen / Gatekeeper)
   ↑ Path B (auto-update): Tauri Ed25519 signature check (pinned pubkey in binary)
   ↑ Path C (GPG verify): user-driven, optional, Linux-only
   ↑ the download hub cards (.glass + emerald left-border) and the updater toast
     (.glass-strong + violet left-bar) read the SAME manifest — they cannot disagree
   ↑ a signature failure on Path B writes audit_log 'updater_signature_failed' + flare toast
     (§10 of 03, §8 of 05)
   ↑ cross-refs: §2 (Windows signing), §3 (macOS signing), §4 (Linux signing), §5 (secrets),
     §6 (rotation), §8 (verification protocol), 05 §3/§4 (manifest + flow), 05 §7 (rollback),
     deployment/02 §3/§5 (Blob upload + atomic), product/04 §2 (download hub)
```

### 11.5 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (architecture / pipeline) | M1 three-OS signing pipeline, M2 certificate chain, M3 trust flow |
| Full-screen layout | (n/a — 04 is a signing spec, not a screen) |
| Component anatomy | (n/a — covered in screen specs 04–08) |
| State matrix | (n/a — covered in 05 §13 updater test plan) |

> All three mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 84–116 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5 in the design-system callout above; neumorphic recipes referenced in the same callout. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§8.2`, `§8.8`, `§2.1`, `§2.3`, `§2.6`, `§3.1`, `§3.3`, `§3.5`, `§3.6`, `§3.8`, `§4.1`, `§5.1`, `§6`, `§8`, `BR-SYN-09`, `BR-SEC-08`).
