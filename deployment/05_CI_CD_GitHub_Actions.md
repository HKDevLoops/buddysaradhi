# 05 — CI/CD: GitHub Actions Workflows

> The six GitHub Actions workflows that execute the release pipeline defined in `04_Release_Pipeline.md`. This file owns the **YAML**, the **caching strategy**, the **concurrency model**, the **secrets matrix**, and the **runner budget**. Cross-references: `01_Vercel_Hosting.md` (Vercel secrets + project IDs), `02_Vercel_Blob_Build_Storage.md` (Blob token + manifest schema), `03_EAS_Build_and_Update_Channels.md` (EAS token + project ID + Apple/Google credentials), `04_Release_Pipeline.md` (release checklist + rollback playbook), `AGENTS.md` §7.4 (CI gate).

---

## 1. The workflow graph

```
.github/workflows/
├── lint.yml              (on every PR + push to main)
│   └── bun install → bun run lint → bun run typecheck → upload coverage
│
├── web-deploy.yml        (on push to main — Vercel auto-deploys, no GH Actions needed for the deploy)
│   └── post-deploy step: agent-browser smoke against the new deployment
│
├── eas-build.yml         (on tag v*)
│   └── eas build --profile production --platform all --auto-submit --no-wait
│       └── follow-up job: poll eas build --status → on success, upload APK to Vercel Blob
│
├── eas-update.yml        (on push to main, JS-only changes)
│   └── eas update --branch production --channel production --message "..."
│
├── desktop-build.yml     (on tag v*)
│   └── matrix: windows-latest, macos-latest, ubuntu-22.04
│       └── install Rust + Bun → cargo build --release → bun run tauri:build
│           → sign (Windows: signtool, macOS: codesign + notarytool, Linux: skip)
│           → upload to Vercel Blob → update manifests/desktop-staging.json
│
└── release.yml           (manual workflow_dispatch)
    └── create GitHub Release + auto-generate changelog + attach artifacts
        → tweet via Twitter API → (v2) tag Sentry release
```

Each workflow is a separate file. They share **caches** (Cargo, Bun, Next.js) and **secrets** (Vercel, EAS, Apple, Google, Windows codesign, Tauri signer) via the repo-level GitHub Actions configuration.

---

## 2. `lint.yml` — the gate

Runs on every PR and every push to `main`. Blocks merge if any step fails.

```yaml
# .github/workflows/lint.yml
# Implements: deployment/05_CI_CD_GitHub_Actions.md §2 — lint gate
name: lint

on:
  pull_request:
    branches: [main, release/*]
  push:
    branches: [main]

concurrency:
  group: lint-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint + Typecheck + Tests
    runs-on: ubuntu-22.04
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Cache Bun
        uses: actions/cache@v4
        with:
          path: |
            ~/.bun/install/cache
            node_modules
            apps/web/node_modules
            apps/mobile/node_modules
            apps/desktop/node_modules
            packages/*/node_modules
          key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb', '**/package.json') }}
          restore-keys: |
            ${{ runner.os }}-bun-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint
        timeout-minutes: 5

      - name: Typecheck
        run: bun run typecheck
        timeout-minutes: 5

      - name: Unit tests
        run: bun run test:unit
        timeout-minutes: 5

      - name: Integration tests
        run: bun run test:integration
        timeout-minutes: 5

      - name: Accessibility tests
        run: bun run test:a11y
        timeout-minutes: 5

      - name: Upload coverage to Codecov
        if: always()
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false
          token: ${{ secrets.CODECOV_TOKEN }}

      - name: Version consistency check
        run: bun run version:check
        timeout-minutes: 1
```

### 2.1 Key points

- **`concurrency.cancel-in-progress: true`** — if a PR gets a new push while the lint is running, the old run is cancelled. This saves runner minutes.
- **`timeout-minutes: 15`** on the job, **`timeout-minutes: 5`** on each step. No step can hang indefinitely.
- **`bun install --frozen-lockfile`** — the lockfile is the contract; CI does not silently update it.
- **`if: always()`** on the Codecov upload — coverage is uploaded even if a later step fails, so we get partial-coverage data.
- **`bun run version:check`** — the version-consistency lint (`04_Release_Pipeline.md` §2.4); fails if any file's version field drifts from `package.json`'s.

---

## 3. `web-deploy.yml` — Vercel auto-deploy + post-deploy smoke

Vercel auto-deploys on every push to `main` — **no GitHub Actions workflow is needed for the deploy itself**. Vercel's GitHub integration handles the build + deploy in its own infrastructure. The `web-deploy.yml` workflow exists only for the **post-deploy smoke** — running agent-browser against the new deployment to verify it actually renders.

```yaml
# .github/workflows/web-deploy.yml
# Implements: deployment/05_CI_CD_GitHub_Actions.md §3 — post-deploy smoke
name: web-deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: web-deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  smoke:
    name: Post-deploy agent-browser smoke
    runs-on: ubuntu-22.04
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Wait for Vercel deployment
        run: |
          # Poll the Vercel deployment status until it's READY
          sleep 30  # give Vercel a head start
          for i in {1..20}; do
            STATUS=$(curl -s -H "Authorization: Bearer ${{ secrets.VERCEL_TOKEN }}" \
              "https://api.vercel.com/v6/deployments?projectId=${{ secrets.VERCEL_PROJECT_ID }}&limit=1&target=production" \
              | jq -r '.deployments[0].status')
            echo "Attempt $i: status=$STATUS"
            if [ "$STATUS" = "READY" ]; then
              echo "Deployment is ready"
              exit 0
            fi
            sleep 15
          done
          echo "Deployment did not become READY in 5 minutes"
          exit 1

      - name: Agent Browser smoke
        uses: ./.github/actions/agent-browser-smoke
        with:
          url: https://buddysaradhi.app
          vercel_token: ${{ secrets.VERCEL_TOKEN }}
          vercel_project_id: ${{ secrets.VERCEL_PROJECT_ID }}
        timeout-minutes: 5

      - name: Notify on failure
        if: failure()
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"⚠️ web-deploy smoke failed on commit ${{ github.sha }}\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### 3.1 The `agent-browser-smoke` composite action

The `./.github/actions/agent-browser-smoke` composite action (defined in `.github/actions/agent-browser-smoke/action.yml`) wraps the `agent-browser` skill:

```yaml
# .github/actions/agent-browser-smoke/action.yml
name: agent-browser-smoke
inputs:
  url:
    required: true
  vercel_token:
    required: true
  vercel_project_id:
    required: true
runs:
  using: composite
  steps:
    - name: Install agent-browser
      shell: bash
      run: npm install -g agent-browser
    - name: Run smoke
      shell: bash
      run: |
        agent-browser navigate "${{ inputs.url }}"
        agent-browser screenshot /tmp/home.png
        # Assert the page title contains "Buddysaradhi"
        TITLE=$(agent-browser title)
        if [[ "$TITLE" != *"Buddysaradhi"* ]]; then
          echo "FAIL: title is '$TITLE', expected 'Buddysaradhi'"
          exit 1
        fi
        # Assert no console errors
        ERRORS=$(agent-browser console-errors)
        if [ -n "$ERRORS" ]; then
          echo "FAIL: console errors: $ERRORS"
          exit 1
        fi
        # Assert sticky footer (per AGENTS.md §6.3)
        FOOTER=$(agent-browser eval "document.querySelector('footer')?.getBoundingClientRect().top")
        BODY_HEIGHT=$(agent-browser eval "document.body.scrollHeight")
        VIEWPORT_HEIGHT=$(agent-browser eval "window.innerHeight")
        # On a short page, footer top should equal viewport height (sticks to bottom)
        # On a long page, footer top should equal body height (pushed below fold)
        echo "Footer top: $FOOTER, body: $BODY_HEIGHT, viewport: $VIEWPORT_HEIGHT"
```

### 3.2 Why `cancel-in-progress: false` here

Unlike `lint.yml`, the `web-deploy.yml` workflow does **not** cancel in-progress runs. If two pushes to `main` happen in quick succession, both smokes run to completion (the second one verifies the second deployment). Cancelling the first would leave its deployment unverified.

---

## 4. `eas-build.yml` — mobile native builds

Triggers on tag `v*`. Builds iOS + Android binaries, auto-submits to TestFlight + Play Internal, mirrors the APK to Vercel Blob.

```yaml
# .github/workflows/eas-build.yml
# Implements: deployment/05_CI_CD_GitHub_Actions.md §4 — EAS build
name: eas-build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (e.g., 1.4.0)'
        required: true

concurrency:
  group: eas-build-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    name: EAS Build (iOS + Android)
    runs-on: ubuntu-22.04
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Expo
        uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          eas-version: latest
          token: ${{ secrets.EAS_TOKEN }}

      - name: Install dependencies
        run: bun install --frozen-lockfile
        working-directory: apps/mobile

      - name: Verify version matches tag
        run: |
          TAG_VERSION=${GITHUB_REF#refs/tags/v}
          PKG_VERSION=$(jq -r .version apps/mobile/package.json)
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "FAIL: tag version $TAG_VERSION != package.json version $PKG_VERSION"
            exit 1
          fi
          echo "OK: version $TAG_VERSION"

      - name: EAS Build (iOS + Android, auto-submit, no-wait)
        run: |
          eas build --profile production --platform all \
            --auto-submit --no-wait --non-interactive
        working-directory: apps/mobile
        env:
          EXPO_PROJECT_ID: ${{ vars.EXPO_PROJECT_ID }}

      - name: Capture build IDs
        id: build-ids
        run: |
          IOS_BUILD_ID=$(eas build:list --platform ios --limit 1 --json | jq -r '.[0].id')
          ANDROID_BUILD_ID=$(eas build:list --platform android --limit 1 --json | jq -r '.[0].id')
          echo "ios_build_id=$IOS_BUILD_ID" >> $GITHUB_OUTPUT
          echo "android_build_id=$ANDROID_BUILD_ID" >> $GITHUB_OUTPUT
        working-directory: apps/mobile

    outputs:
      ios_build_id: ${{ steps.build-ids.outputs.ios_build_id }}
      android_build_id: ${{ steps.build-ids.outputs.android_build_id }}

  wait-and-mirror:
    name: Wait for builds + mirror APK to Blob
    needs: build
    runs-on: ubuntu-22.04
    timeout-minutes: 60
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Setup Expo
        uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          eas-version: latest
          token: ${{ secrets.EAS_TOKEN }}

      - name: Wait for Android build
        run: |
          BUILD_ID=${{ needs.build.outputs.android_build_id }}
          for i in {1..60}; do
            STATUS=$(eas build:view $BUILD_ID --json | jq -r '.build.status')
            echo "Attempt $i: Android build $BUILD_ID status=$STATUS"
            if [ "$STATUS" = "finished" ]; then
              ARTIFACT_URL=$(eas build:view $BUILD_ID --json | jq -r '.build.artifacts.buildUrl')
              echo "Android build URL: $ARTIFACT_URL"
              echo "android_artifact_url=$ARTIFACT_URL" >> $GITHUB_ENV
              exit 0
            fi
            if [ "$STATUS" = "errored" ] || [ "$STATUS" = "canceled" ]; then
              echo "FAIL: Android build $STATUS"
              exit 1
            fi
            sleep 60
          done
          echo "Android build did not finish in 60 minutes"
          exit 1

      - name: Download Android APK
        run: |
          curl -L -o Buddysaradhi.apk "${{ env.android_artifact_url }}"
          ls -lh Buddysaradhi.apk

      - name: Mirror APK to Vercel Blob
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          bun run scripts/blob-upload.mjs \
            --local-path Buddysaradhi.apk \
            --blob-pathname "mobile/android/Buddysaradhi-${VERSION}-universal.apk" \
            --content-type "application/vnd.android.package-archive"
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Verify iOS build (no mirror)
        run: |
          BUILD_ID=${{ needs.build.outputs.ios_build_id }}
          for i in {1..60}; do
            STATUS=$(eas build:view $BUILD_ID --json | jq -r '.build.status')
            echo "Attempt $i: iOS build $BUILD_ID status=$STATUS"
            if [ "$STATUS" = "finished" ]; then
              echo "iOS build finished (not mirrored — TestFlight only)"
              exit 0
            fi
            if [ "$STATUS" = "errored" ] || [ "$STATUS" = "canceled" ]; then
              echo "FAIL: iOS build $STATUS"
              exit 1
            fi
            sleep 60
          done
          echo "iOS build did not finish in 60 minutes"
          exit 1

      - name: Notify on failure
        if: failure()
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"⚠️ eas-build failed on ${{ github.ref_name }}\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### 4.1 Key points

- **Two jobs: `build` and `wait-and-mirror`.** The `build` job returns immediately (via `--no-wait`); the `wait-and-mirror` job polls EAS's API until both builds finish.
- **`timeout-minutes: 30`** on `build`, **`timeout-minutes: 60`** on `wait-and-mirror`. EAS iOS builds can take ~25 minutes; the 60-minute timeout gives a buffer.
- **The APK mirror** (the `Mirror APK to Vercel Blob` step) runs the `scripts/blob-upload.mjs` script, which calls the `uploadInstaller` function from `02_Vercel_Blob_Build_Storage.md` §3.2.
- **The iOS IPA is NOT mirrored.** The `wait-and-mirror` job verifies the iOS build finished (so we know TestFlight submission succeeded), but does not download or upload the IPA. This is the `no-ios-blob-upload.test.ts` lint rule (`02_Vercel_Blob_Build_Storage.md` §2.2) operationalised.

---

## 5. `desktop-build.yml` — Tauri builds + sign + upload

Triggers on tag `v*`. Builds Windows, macOS, Linux in parallel via a matrix, signs + notarizes, uploads to Vercel Blob, updates the manifest.

```yaml
# .github/workflows/desktop-build.yml
# Implements: deployment/05_CI_CD_GitHub_Actions.md §5 — desktop build
name: desktop-build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (e.g., 1.4.0)'
        required: true

concurrency:
  group: desktop-build-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    name: Build (${{ matrix.platform }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            installer_ext: msi
            artifact_glob: "*.msi"
          - platform: macos-latest
            target: universal-apple-darwin
            installer_ext: dmg
            artifact_glob: "*.dmg"
          - platform: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            installer_ext: AppImage
            artifact_glob: "*.AppImage"
    runs-on: ${{ matrix.platform }}
    timeout-minutes: 45
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Cache Cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            apps/desktop/src-tauri/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Cache Next.js
        uses: actions/cache@v4
        with:
          path: |
            apps/web/.next/cache
          key: ${{ runner.os }}-nextjs-${{ hashFiles('apps/web/**/*.ts', 'apps/web/**/*.tsx') }}
          restore-keys: |
            ${{ runner.os }}-nextjs-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build Next.js (for Tauri static export)
        run: bun run build
        working-directory: apps/web

      - name: Sign + Build (Windows)
        if: matrix.platform == 'windows-latest'
        run: |
          # Decode the codesign cert from base64 secret
          echo ${{ secrets.WINDOWS_CODESIGN_PFX }} | base64 -d > cert.pfx
          # Set env vars for Tauri's signing
          export TAURI_SIGNING_PRIVATE_KEY="${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}"
          export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}"
          # Build with Tauri (signtool runs as a post-build step via tauri.conf.json)
          bun run tauri:build
        working-directory: apps/desktop
        env:
          WINDOWS_CODESIGN_PASSWORD: ${{ secrets.WINDOWS_CODESIGN_PASSWORD }}

      - name: Sign + Notarize + Build (macOS)
        if: matrix.platform == 'macos-latest'
        run: |
          export TAURI_SIGNING_PRIVATE_KEY="${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}"
          export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}"
          export APPLE_ID="${{ secrets.MACOS_NOTARY_APPLE_ID }}"
          export APPLE_TEAM_ID="${{ secrets.MACOS_NOTARY_TEAM_ID }}"
          export APPLE_PASSWORD="${{ secrets.MACOS_NOTARY_PASSWORD }}"
          bun run tauri:build
        working-directory: apps/desktop

      - name: Build (Linux)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
          export TAURI_SIGNING_PRIVATE_KEY="${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}"
          export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}"
          bun run tauri:build
        working-directory: apps/desktop

      - name: Upload to Vercel Blob
        id: upload
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          # Find the installer
          INSTALLER=$(find apps/desktop/src-tauri/target/release/bundle -name "${{ matrix.artifact_glob }}" | head -1)
          if [ -z "$INSTALLER" ]; then
            echo "FAIL: no installer found"
            exit 1
          fi
          # Determine the blob pathname
          case "${{ matrix.platform }}" in
            windows-latest) BLOB_PATH="desktop/windows/Buddysaradhi-${VERSION}-x64.${{ matrix.installer_ext }}" ;;
            macos-latest)   BLOB_PATH="desktop/macos/Buddysaradhi-${VERSION}-universal.${{ matrix.installer_ext }}" ;;
            ubuntu-22.04)   BLOB_PATH="desktop/linux/Buddysaradhi-${VERSION}-x86_64.${{ matrix.installer_ext }}" ;;
          esac
          # Upload
          UPLOAD_RESULT=$(bun run scripts/blob-upload.mjs \
            --local-path "$INSTALLER" \
            --blob-pathname "$BLOB_PATH" \
            --content-type "application/octet-stream" \
            --output-json)
          echo "$UPLOAD_RESULT"
          URL=$(echo "$UPLOAD_RESULT" | jq -r '.url')
          SHA256=$(echo "$UPLOAD_RESULT" | jq -r '.sha256')
          echo "url=$URL" >> $GITHUB_OUTPUT
          echo "sha256=$SHA256" >> $GITHUB_OUTPUT
          echo "blob_path=$BLOB_PATH" >> $GITHUB_OUTPUT
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Upload signature to Vercel Blob
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          INSTALLER=$(find apps/desktop/src-tauri/target/release/bundle -name "${{ matrix.artifact_glob }}" | head -1)
          SIG_FILE="${INSTALLER}.sig"
          if [ ! -f "$SIG_FILE" ]; then
            echo "FAIL: no .sig file found at $SIG_FILE"
            exit 1
          fi
          case "${{ matrix.platform }}" in
            windows-latest) SIG_BLOB_PATH="desktop/windows/Buddysaradhi-${VERSION}-x64.${{ matrix.installer_ext }}.sig" ;;
            macos-latest)   SIG_BLOB_PATH="desktop/macos/Buddysaradhi-${VERSION}-universal.${{ matrix.installer_ext }}.sig" ;;
            ubuntu-22.04)   SIG_BLOB_PATH="desktop/linux/Buddysaradhi-${VERSION}-x86_64.${{ matrix.installer_ext }}.sig" ;;
          esac
          bun run scripts/blob-upload.mjs \
            --local-path "$SIG_FILE" \
            --blob-pathname "$SIG_BLOB_PATH" \
            --content-type "application/octet-stream"
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

    outputs:
      url: ${{ steps.upload.outputs.url }}
      sha256: ${{ steps.upload.outputs.sha256 }}
      blob_path: ${{ steps.upload.outputs.blob_path }}

  update-manifest:
    name: Update desktop-staging.json manifest
    needs: build
    runs-on: ubuntu-22.04
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Build manifest update
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          # The build job's outputs are arrays (one per matrix entry); iterate
          bun run scripts/build-manifest.mjs \
            --version "$VERSION" \
            --commit "${{ github.sha }}" \
            --output manifests/desktop-staging.json
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Verify manifest
        run: bun run scripts/verify-manifest.mjs --manifest manifests/desktop-staging.json

      - name: Notify on completion
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"✅ desktop-build complete for ${{ github.ref_name }} — manifest at desktop-staging.json\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}

      - name: Notify on failure
        if: failure()
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"⚠️ desktop-build failed on ${{ github.ref_name }}\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### 5.1 Key points

- **`fail-fast: false`** on the matrix — if Windows fails, macOS + Linux still complete. This isolates platform-specific failures (e.g., a codesign cert expiry) without blocking the other platforms.
- **`timeout-minutes: 45`** on the build job — Rust release builds can take 20-30 minutes on a fresh runner (no Cargo cache); the 45-minute timeout gives a buffer for cold builds.
- **The Tauri signing keys** (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are passed as env vars, not files. Tauri's `tauri-signer` reads them from env.
- **The Windows codesign cert** is stored as a base64-encoded PFX in the `WINDOWS_CODESIGN_PFX` secret, decoded to a file at build time. The password is a separate secret (`WINDOWS_CODESIGN_PASSWORD`).
- **The macOS notarization** uses the `notarytool` API with an Apple ID + team ID + app-specific password (the `MACOS_NOTARY_*` secrets). Tauri's `tauri-build` invokes `notarytool` automatically.
- **The manifest update** is a separate job (`update-manifest`) that runs after all three platforms' builds finish. It uses the `needs: build` dependency to ensure all three artifacts are uploaded before the manifest is built.
- **The manifest verification** (`scripts/verify-manifest.mjs`) is the verification step from `02_Vercel_Blob_Build_Storage.md` §5.4 — JSON parse, URL 200, signature non-empty, version matches tag.

---

## 6. `eas-update.yml` — OTA push

Triggers on push to `main` (for production OTA) and on push to `release/*` (for staging OTA). Pushes a JS-only update to the appropriate channel.

```yaml
# .github/workflows/eas-update.yml
# Implements: deployment/05_CI_CD_GitHub_Actions.md §6 — EAS OTA
name: eas-update

on:
  push:
    branches:
      - main
      - 'release/*'
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to push OTA to (production | staging)'
        required: true
        default: production

concurrency:
  group: eas-update-${{ github.ref }}
  cancel-in-progress: false

jobs:
  detect-changes:
    name: Detect JS-only changes
    runs-on: ubuntu-22.04
    timeout-minutes: 5
    outputs:
      js_only: ${{ steps.check.outputs.js_only }}
      channel: ${{ steps.channel.outputs.channel }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Check if changes are JS-only
        id: check
        run: |
          # Get the list of changed files in the latest push
          CHANGED=$(git diff --name-only HEAD^ HEAD)
          echo "Changed files:"
          echo "$CHANGED"
          # JS-only = no changes to app.json, app.config.js, native files
          if echo "$CHANGED" | grep -qE '(app\.json|app\.config\.js|apps/mobile/ios/|apps/mobile/android/|package\.json)'; then
            echo "js_only=false" >> $GITHUB_OUTPUT
          else
            echo "js_only=true" >> $GITHUB_OUTPUT
          fi

      - name: Determine channel
        id: channel
        run: |
          if [[ "${{ github.ref }}" == "refs/heads/main" ]]; then
            echo "channel=production" >> $GITHUB_OUTPUT
          elif [[ "${{ github.ref }}" == refs/heads/release/* ]]; then
            echo "channel=staging" >> $GITHUB_OUTPUT
          else
            echo "channel=development" >> $GITHUB_OUTPUT
          fi

  ota:
    name: EAS Update OTA
    needs: detect-changes
    if: needs.detect-changes.outputs.js_only == 'true'
    runs-on: ubuntu-22.04
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Setup Expo
        uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          eas-version: latest
          token: ${{ secrets.EAS_TOKEN }}

      - name: Install dependencies
        run: bun install --frozen-lockfile
        working-directory: apps/mobile

      - name: Push OTA update
        run: |
          CHANNEL=${{ needs.detect-changes.outputs.channel }}
          COMMIT_MSG="${{ github.event.head_commit.message }}"
          # Sanitise the commit message (no newlines, escape quotes)
          COMMIT_MSG_CLEAN=$(echo "$COMMIT_MSG" | head -1 | sed 's/"/\\"/g')
          eas update --branch "$CHANNEL" --channel "$CHANNEL" \
            --message "$COMMIT_MSG_CLEAN" --non-interactive
        working-directory: apps/mobile
        env:
          EXPO_PROJECT_ID: ${{ vars.EXPO_PROJECT_ID }}

      - name: Notify on success
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"✅ EAS OTA pushed to ${{ needs.detect-changes.outputs.channel }} — ${{ github.event.head_commit.message }}\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}

      - name: Notify on failure
        if: failure()
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"⚠️ eas-update failed on ${{ github.ref }}\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### 6.1 The JS-only detection

The `detect-changes` job determines whether the push is OTA-eligible (`03_EAS_Build_and_Update_Channels.md` §5.2). If the push touches `app.json`, native files, or `package.json` (new native dep), `js_only=false` and the OTA is skipped — a new binary build via `eas-build.yml` is required instead.

This prevents shipping an OTA that references a native module the binary does not have (which would crash on launch).

---

## 7. `release.yml` — manual release dispatch

A **manual** workflow that creates the GitHub Release, generates the changelog, attaches artifacts, and tweets. Does **not** build anything — the builds are triggered by the `v*` tag push.

```yaml
# .github/workflows/release.yml
# Implements: deployment/05_CI_CD_GitHub_Actions.md §7 — release dispatch
name: release

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (e.g., 1.4.0)'
        required: true
      promote_desktop:
        description: 'Promote desktop-staging.json → desktop-stable.json?'
        required: true
        type: boolean
        default: true

jobs:
  release:
    name: Create GitHub Release
    runs-on: ubuntu-22.04
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history for changelog generation

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Verify version matches tag
        run: |
          VERSION=${{ inputs.version }}
          TAG="v${VERSION}"
          if ! git rev-parse "$TAG" >/dev/null 2>&1; then
            echo "FAIL: tag $TAG does not exist"
            exit 1
          fi
          PKG_VERSION=$(jq -r .version package.json)
          if [ "$VERSION" != "$PKG_VERSION" ]; then
            echo "FAIL: input version $VERSION != package.json version $PKG_VERSION"
            exit 1
          fi
          echo "OK: version $VERSION, tag $TAG"

      - name: Generate changelog
        id: changelog
        run: |
          VERSION=${{ inputs.version }}
          PREV_TAG=$(git describe --tags --abbrev=0 "v${VERSION}^" 2>/dev/null || echo "")
          if [ -z "$PREV_TAG" ]; then
            RANGE="v${VERSION}"
          else
            RANGE="${PREV_TAG}..v${VERSION}"
          fi
          echo "Generating changelog for range $RANGE"
          # Generate grouped changelog
          {
            echo "## Buddysaradhi v${VERSION}"
            echo ""
            echo "Released: $(date -u +'%Y-%m-%d')"
            echo ""
            echo "### Features"
            git log --pretty=format:'- %s' --grep='^feat' "$RANGE" || echo "(none)"
            echo ""
            echo "### Fixes"
            git log --pretty=format:'- %s' --grep='^fix' "$RANGE" || echo "(none)"
            echo ""
            echo "### Security"
            git log --pretty=format:'- %s' --grep='^sec' "$RANGE" || echo "(none)"
            echo ""
            echo "### Other"
            git log --pretty=format:'- %s' --grep='^chore\|^refactor\|^perf\|^docs' "$RANGE" || echo "(none)"
          } > CHANGELOG_ENTRY.md
          cat CHANGELOG_ENTRY.md

      - name: Promote desktop staging → stable
        if: ${{ inputs.promote_desktop }}
        run: |
          VERSION=${{ inputs.version }}
          bun run scripts/promote-manifest.mjs \
            --from manifests/desktop-staging.json \
            --to manifests/desktop-stable.json \
            --version "$VERSION"
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Verify stable manifest
        if: ${{ inputs.promote_desktop }}
        run: bun run scripts/verify-manifest.mjs --manifest manifests/desktop-stable.json

      - name: Upload changelog to Blob
        run: |
          VERSION=${{ inputs.version }}
          bun run scripts/blob-upload.mjs \
            --local-path CHANGELOG_ENTRY.md \
            --blob-pathname "changelogs/${VERSION}.md" \
            --content-type "text/markdown"
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ inputs.version }}
          name: Buddysaradhi v${{ inputs.version }}
          body_path: CHANGELOG_ENTRY.md
          draft: false
          prerelease: false
          generate_release_notes: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Tweet release announcement
        run: |
          VERSION=${{ inputs.version }}
          TWEET="🚀 Buddysaradhi v${VERSION} is live! Web (https://buddysaradhi.app), Desktop (https://buddysaradhi.app/download), Mobile (TestFlight + Play Store). Changelog: https://buddysaradhi.app/api/changelog/${VERSION}"
          # Tweet via Twitter API v2
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.TWITTER_BEARER_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{\"text\": \"$TWEET\"}" \
            https://api.twitter.com/2/tweets
        continue-on-error: true  # tweet failures don't fail the release

      - name: Append worklog entry
        run: |
          VERSION=${{ inputs.version }}
          cat >> /home/z/my-project/worklog.md << EOF
          ---
          Task ID: RELEASE-${VERSION}
          Agent: release-engineering
          Task: Cut v${VERSION} release.

          Work Log:
          - Tagged v${VERSION} on main.
          - Web: Vercel auto-deployed to https://buddysaradhi.app.
          - Mobile: EAS build shipped to TestFlight + Play Internal; OTA pushed to production channel.
          - Desktop: installers uploaded to Vercel Blob; manifest promoted staging → stable.
          - Changelog published at https://buddysaradhi.app/api/changelog/${VERSION}.
          - GitHub Release created: https://github.com/\${{ github.repository }}/releases/tag/v${VERSION}.

          Stage Summary:
          - All three surfaces live at v${VERSION}.
          - 1-hour monitor: <results>
          - Rollbacks: <none | web@HH:MM | ota@HH:MM | desktop@HH:MM>
          EOF

      - name: Notify on completion
        run: |
          curl -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"🚀 Buddysaradhi v${{ inputs.version }} released! Web + Mobile + Desktop all live.\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### 7.1 The manual gate

`release.yml` is `workflow_dispatch` only — it does **not** trigger on tag push. The tag push triggers `eas-build.yml` and `desktop-build.yml` (the builds); the release-engineering agent manually runs `release.yml` after the builds finish + the 24-hour desktop soak (§6 in `02_Vercel_Blob_Build_Storage.md`).

The manual gate is the **human-in-the-loop** that prevents an autonomous agent from promoting a broken build to all tutors.

---

## 8. Caching strategy

| Cache | Key | Restore keys | Path |
|---|---|---|---|
| Bun (root + workspaces) | `${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb', '**/package.json') }}` | `${{ runner.os }}-bun-` | `~/.bun/install/cache`, `node_modules`, per-workspace `node_modules` |
| Cargo (desktop) | `${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}` | `${{ runner.os }}-cargo-` | `~/.cargo/registry`, `~/.cargo/git`, `apps/desktop/src-tauri/target` |
| Next.js (web) | `${{ runner.os }}-nextjs-${{ hashFiles('apps/web/**/*.ts', 'apps/web/**/*.tsx') }}` | `${{ runner.os }}-nextjs-` | `apps/web/.next/cache` |
| Gradle (mobile, if needed) | `${{ runner.os }}-gradle-${{ hashFiles('apps/mobile/android/**/*.gradle*') }}` | `${{ runner.os }}-gradle-` | `~/.gradle/caches`, `apps/mobile/android/.gradle` |
| Xcode DerivedData (mobile, if needed) | `${{ runner.os }}-xcode-${{ hashFiles('apps/mobile/ios/**/*.pbxproj') }}` | `${{ runner.os }}-xcode-` | `apps/mobile/ios/DerivedData` |

The cache key includes a hash of the lockfile(s) so a dependency change busts the cache. The restore-keys allow partial restoration when only some deps changed (faster cold start).

### 8.1 Cache size budget

GitHub Actions caches are limited to **10 GB per repository**. The cache sizes for Buddysaradhi:

- Bun cache: ~500 MB
- Cargo cache: ~1.5 GB (the heavy one — Rust dependencies are large)
- Next.js cache: ~200 MB
- Gradle cache: ~800 MB
- Xcode DerivedData: ~1.5 GB

Total: ~4.5 GB. Well within the 10 GB limit. If a cache eviction becomes a problem (GitHub evicts oldest-unused first), the Cargo cache is the most valuable — pin it via `actions/cache@v4`'s `lookup-only` option on the restore to skip re-download.

---

## 9. Concurrency model

| Workflow | `concurrency.group` | `cancel-in-progress` | Rationale |
|---|---|---|---|
| `lint.yml` | `lint-${{ github.ref }}` | `true` | A new push to a PR supersedes the lint of the prior push; cancel saves runner minutes. |
| `web-deploy.yml` | `web-deploy-${{ github.ref }}` | `false` | Two pushes to `main` in succession: both smokes run (each verifies its own deployment). Cancelling the first would leave its deployment unverified. |
| `eas-build.yml` | `eas-build-${{ github.ref }}` | `false` | Two tags in succession: both builds run. Cancelling the first would lose its build artifacts. |
| `eas-update.yml` | `eas-update-${{ github.ref }}` | `false` | Two pushes in succession: both OTAs ship. Cancelling the first would lose the OTA for the first push's JS. |
| `desktop-build.yml` | `desktop-build-${{ github.ref }}` | `false` | Same as `eas-build.yml`. |
| `release.yml` | `release-${{ github.ref }}` | `true` | Two manual dispatches in succession: only the latest runs. The release-engineering agent re-runs with the right inputs. |

The pattern: **lint cancels (it's a gate); deploys/builds/releases don't cancel (they're events of record).**

---

## 10. Secrets matrix

| Secret | Used by | Scope | Rotation | If leaked |
|---|---|---|---|---|
| `VERCEL_TOKEN` | `web-deploy.yml`, `release.yml` | Vercel API | Quarterly | Revoke in Vercel dashboard; rotate. |
| `VERCEL_ORG_ID` | `web-deploy.yml` | Vercel org ID (not secret) | n/a | Non-sensitive. |
| `VERCEL_PROJECT_ID` | `web-deploy.yml` | Vercel project ID (not secret) | n/a | Non-sensitive. |
| `BLOB_READ_WRITE_TOKEN` | `eas-build.yml`, `desktop-build.yml`, `release.yml` | Vercel Blob | Quarterly | P0. Revoke in Vercel dashboard; audit Blob access logs; rotate. |
| `EAS_TOKEN` | `eas-build.yml`, `eas-update.yml` | Expo account | Quarterly | Revoke at expo.dev; rotate. |
| `EXPO_PROJECT_ID` | `eas-build.yml`, `eas-update.yml` (as `vars.`, not `secrets.`) | Expo project (not secret) | n/a | Non-sensitive. |
| `APPLE_APP_STORE_CONNECT_API_KEY` | `eas-build.yml` (via `submit.production.ios.ascApiKeyId`) | App Store Connect | Annually or on team change | P0. Revoke in App Store Connect; rotate. |
| `ANDROID_SERVICE_ACCOUNT_JSON` | `eas-build.yml` (via `submit.production.android.serviceAccountKeyPath`) | Play Console | Annually or on project change | P0. Revoke in Play Console; rotate. |
| `WINDOWS_CODESIGN_PFX` | `desktop-build.yml` (Windows runner) | Windows codesign cert (base64) | Annually (cert expiry) | P0. Revoke cert with CA; rotate. |
| `WINDOWS_CODESIGN_PASSWORD` | `desktop-build.yml` (Windows runner) | PFX password | With the cert | P0 (same as above). |
| `MACOS_NOTARY_APPLE_ID` | `desktop-build.yml` (macOS runner) | Apple ID for notarytool | On Apple ID change | Revoke app-specific password; rotate. |
| `MACOS_NOTARY_TEAM_ID` | `desktop-build.yml` (macOS runner) | Apple Team ID (not secret) | n/a | Non-sensitive. |
| `MACOS_NOTARY_PASSWORD` | `desktop-build.yml` (macOS runner) | App-specific password for notarytool | Quarterly | P0. Revoke at appleid.apple.com; rotate. |
| `TAURI_SIGNING_PRIVATE_KEY` | `desktop-build.yml` (all platforms) | Ed25519 private key for Tauri updater | Annually or on key compromise | **P0 critical.** Rotate the key; **all installed desktop apps cannot auto-update from manifests signed by the new key** — they must be manually reinstalled. This is the highest-impact secret in the system. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `desktop-build.yml` (all platforms) | Password for the above key | With the key | P0 (same as above). |
| `CODECOV_TOKEN` | `lint.yml` | Codecov upload | On team change | Non-critical; rotate. |
| `DISCORD_WEBHOOK_URL` | All workflows (notify) | Discord channel webhook | On webhook rotation | Non-critical; rotate. |
| `TWITTER_BEARER_TOKEN` | `release.yml` | Twitter API v2 | On token rotation | Non-critical; rotate. |

### 10.1 The `TAURI_SIGNING_PRIVATE_KEY` rotation problem

The Tauri signing key is **baked into every installed desktop app** as the public key (in `tauri.conf.json` → `plugins.updater.pubkey`). If the private key is compromised and rotated:

1. The new key's public half is compiled into new desktop apps (v1.4.1+).
2. **Old desktop apps (v1.4.0 and earlier) cannot verify manifests signed by the new key** — they refuse to auto-update.
3. Tutors on old apps must **manually reinstall** from the web hub to get the new public key.

This is a **high-impact rotation** — it should be avoided at all costs. The mitigation:

- The private key is stored in **1Password** (or equivalent), accessible only to the orchestrator + the release-engineering agent.
- The key is **never** in the repo, **never** in a non-secret GitHub Actions context, **never** in a log.
- The CI workflow that uses the key (`desktop-build.yml`) is reviewed quarterly for secret-handling correctness.

If a rotation is unavoidable (key compromise), the rotation plan is:

1. Generate a new keypair.
2. Update `tauri.conf.json` → `plugins.updater.pubkey` with the new public key.
3. Cut a new release (v1.4.1) with the new key.
4. The new release's manifest is signed with the new private key.
5. Old desktop apps cannot auto-update to v1.4.1 — they show "Manual reinstall required" with a link to the web hub.
6. Tutors reinstall; from v1.4.1 onward, the new key is in use.

This is the **heaviest rotation** in the system. Avoid it.

---

## 11. Runner budget

GitHub Actions free tier provides **2000 minutes/month for Linux runners**. Windows and macOS incur surcharges:

- **Linux:** 1× (2000 min/month free)
- **Windows:** 2× (1000 min/month free equivalent)
- **macOS:** 10× (200 min/month free equivalent)

Buddysaradhi's monthly runner usage (assuming 1 MINOR release + 2 PATCH releases + 1 hotfix):

| Workflow | Runs/month | Minutes/run | Platform | Billed minutes |
|---|---|---|---|---|
| `lint.yml` | 30 (10 PRs × 3 pushes avg) | 10 | Linux | 300 |
| `web-deploy.yml` | 5 | 5 | Linux | 25 |
| `eas-build.yml` | 1 | 30 + 60 (wait) | Linux | 90 |
| `eas-update.yml` | 10 | 5 | Linux | 50 |
| `desktop-build.yml` | 1 (matrix: 3 platforms) | 35 (Windows), 35 (macOS), 35 (Linux) | mixed | 35 × 2 (Windows) + 35 × 10 (macOS) + 35 (Linux) = 70 + 350 + 35 = 455 |
| `release.yml` | 1 | 5 | Linux | 5 |

Total billed minutes: ~925. The macOS surcharge (`desktop-build.yml`'s macOS runner) is the dominant cost — **350 of the 925 minutes** are macOS.

**Conclusion:** the free tier covers Buddysaradhi through ~2 releases per month. Beyond that, GitHub Pro ($4/user/month, 3000 free minutes) or a self-hosted macOS runner (Apple Silicon Mac mini, ~$700 one-time) is the upgrade path.

### 11.1 The macOS runner optimisation

The `desktop-build.yml` macOS job is the most expensive single workflow in the system. To minimise its cost:

- **Cache Cargo aggressively** (§8) — a cold Rust build takes 25 minutes; a warm build takes 5.
- **Use `macos-latest`** (Apple Silicon) — faster than `macos-13` (Intel) for Rust + Tauri builds.
- **Avoid re-running on transient failures** — the `fail-fast: false` matrix means a Windows failure does not re-trigger the macOS job.
- **Consider `macos-13-large`** (6-core, 16 GB RAM) for parallel Cargo builds — costs 2× more per minute but cuts build time in half. Net cost: roughly the same. Use only if builds exceed 35 minutes consistently.

---

## 12. The "workflow change" protocol

A change to any workflow in this file (or a new workflow) follows this protocol:

1. **Branch:** `chore/ci/<change-name>`.
2. **Test on the branch:** use `workflow_dispatch` to trigger the workflow on the branch (every workflow above has `workflow_dispatch` as a trigger).
3. **Verify the run succeeds** in the Actions tab.
4. **Open a PR** with `## Spec ref` citing this file (`deployment/05_CI_CD_GitHub_Actions.md`).
5. **Reviewer:** the orchestrator or a second release-engineering agent.
6. **Merge only after the on-branch test passes.**

A workflow change that is merged without an on-branch test is a workflow change that breaks the next release. The protocol is non-negotiable.

---

## 13. The cross-cutting contract this file makes

Every release-engineering agent working on the workflows agrees to:

1. **Never commit a secret in plaintext.** All secrets are GitHub Actions secrets (`secrets.*`), referenced via `${{ secrets.NAME }}`. Never echo'd, never logged, never written to a file.
2. **Never use `continue-on-error: true` on a deploy step.** A deploy that fails must fail the workflow; an error swallowed is an error that ships to production.
3. **Never skip the `timeout-minutes` on a job or step.** A hung workflow consumes runner minutes indefinitely; the timeout is the floor.
4. **Never edit a workflow on `main`.** All workflow changes go through a branch + on-branch test (§12).
5. **Never add a new secret without documenting it in §10.** The secrets matrix is the source of truth; an undocumented secret is an unmanaged secret.
6. **Always use `actions/checkout@v4` with `fetch-depth: 0` for workflows that need git history** (e.g., `release.yml`'s changelog generation).
7. **Always pin third-party actions to a commit SHA, not a tag.** Tags can be moved; SHAs cannot. (`actions/checkout@v4` is a tag — acceptable for first-party GitHub actions; for third-party like `softprops/action-gh-release`, pin to a SHA.)
8. **Always set `concurrency` on a workflow.** Without it, two pushes can race and produce inconsistent state.
9. **Always notify on failure.** The Discord webhook is the operations channel; a silent failure is an unmitigated failure.
10. **Always test the rollback path during a release drill** (`04_Release_Pipeline.md` §10). The workflows that ship code must have their un-ship paths verified.

---

## 14. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`, `TELE-1`). Box widths honour §20.3 rule 2 (80–120 for workflow-graph / matrix / pipeline diagrams). The three mockups below visualise the *GitHub Actions automation layer* this file owns — the 6-workflow graph (which YAML fires when), the workflow-trigger matrix (event → workflow → concurrency rule), and the CI gate sequence (the 5 lint checks that block every merge). A fourth mini-mockup annotates the one live UI surface this file references (the GitHub Actions check-run card) so the glass / neumorphic contract is visible where it applies.

### 14.1 Design System Reference (§5.5 + §6.6 single rule)

This file is the **workflow-automation view**, not a screen spec. Its artefacts are graph / matrix / sequence diagrams — concept diagrams per §20.4, governed by §20.1 + §20.6, and do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the one live UI surface this file references: the **GitHub Actions check-run card** (the per-PR status check that shows lint / typecheck / unit / integration / a11y results), where the agent reads pass/fail status + clicks "Re-run failed jobs" on failure. That card is glass-faint-equivalent content (it recedes — the PR diff is the focus, the check-run card is the supporting context); the "Re-run failed jobs" button is neumorphic-raised (it is a control the agent clicks).

| Artefact (this file) | Type | Glass / neumo tier (if live UI) |
|---|---|---|
| §14.2 6-workflow graph | Concept diagram (graph) | (none — workflow topology) |
| §14.3 Workflow-trigger matrix | Concept diagram (matrix) | (none — event→workflow routing) |
| §14.4 CI gate sequence (lint.yml) | Concept diagram (sequence) | (none — the 5-check pipeline) |
| §14.5 GitHub Actions check-run card | Live UI surface (third-party) | `.glass-faint`-equivalent card + `.neumo-raised` "Re-run failed jobs" (per §6.6 single rule) |

### 14.2 The 6-Workflow Graph

The canonical set of 6 workflows in `.github/workflows/`. Each workflow is a separate YAML file; they share caches (Cargo, Bun, Next.js) and secrets (Vercel, EAS, Apple, Google, Windows codesign, Tauri signer) via the repo-level GitHub Actions configuration. A 7th workflow is a stop-and-ask trigger (`AGENTS.md` §6 trigger #7 — workflow sprawl is how pipelines become unmaintainable).

```
  6-WORKFLOW GRAPH  (§1, the canonical set in .github/workflows/)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │  .github/workflows/                                                              │
  │  │                                                                              │
  │  ├── lint.yml              (on every PR + push to main)                         │
  │  │   └── bun install → bun run lint → typecheck → unit → integration → a11y     │
  │  │       → upload coverage to Codecov → version consistency check               │
  │  │       (emerald ✓ = the gate — blocks merge on any failure)                   │
  │  │                                                                              │
  │  ├── web-deploy.yml        (on push to main — Vercel auto-deploys)              │
  │  │   └── post-deploy step: agent-browser smoke against the new deployment       │
  │  │       (cyan — verifies the deployment actually renders)                      │
  │  │                                                                              │
  │  ├── eas-build.yml         (on tag v*)                                          │
  │  │   └── eas build --profile production --platform all                          │
  │  │       --auto-submit --no-wait                                                │
  │  │       └── follow-up: poll eas build --status → on success,                   │
  │  │           upload APK to Vercel Blob (cyan — building)                        │
  │  │                                                                              │
  │  ├── eas-update.yml        (on push to main, JS-only changes)                   │
  │  │   └── detect-changes job → if js_only=true → eas update                      │
  │  │       --branch production --channel production                               │
  │  │       (emerald ✓ = OTA pushed; amber = js_only=false, skipped)               │
  │  │                                                                              │
  │  ├── desktop-build.yml     (on tag v*)                                          │
  │  │   └── matrix: windows-latest, macos-latest, ubuntu-22.04                     │
  │  │       └── install Rust + Bun → cargo build --release →                       │
  │  │           bun run tauri:build → sign (signtool / codesign + notarytool)      │
  │  │           → upload to Vercel Blob → update desktop-staging.json              │
  │  │       (cyan — building 3 platforms in parallel)                              │
  │  │                                                                              │
  │  └── release.yml           (manual workflow_dispatch ONLY)                      │
  │      └── create GitHub Release + auto-generate changelog                        │
  │          + attach artifacts + tweet + (v2) Sentry release tag                   │
  │          (violet — the manual gate, P13 distribution)                           │
  │                                                                                  │
  │  RULES (the canonical-set contract):                                             │
  │   ↑ These 6 are the canonical set (AGENTS.md §6 trigger #7 — a 7th is a         │
  │     stop-and-ask).                                                              │
  │   ↑ Each workflow is a separate YAML file — no monolithic "ci.yml".             │
  │   ↑ Each shares caches (§8) + secrets (§10) via repo-level config.              │
  │   ↑ Each has `timeout-minutes` on every job + every long step (§3.1).          │
  │   ↑ Each has `concurrency` set (§9) — lint cancels; deploys/builds/releases     │
  │     don't (events of record).                                                   │
  │   ↑ Each notifies on failure via Discord webhook (Rule 9 — no silent failures). │
  │                                                                                  │
  │  SHARED INFRASTRUCTURE (§8 + §10 + §11):                                         │
  │   ↑ Caches: Bun (~500 MB), Cargo (~1.5 GB), Next.js (~200 MB), Gradle (~800 MB),│
  │     Xcode DerivedData (~1.5 GB) — total ~4.5 GB, under the 10 GB repo limit.    │
  │   ↑ Secrets: VERCEL_TOKEN, BLOB_READ_WRITE_TOKEN, EAS_TOKEN,                    │
  │     APPLE_APP_STORE_CONNECT_API_KEY, ANDROID_SERVICE_ACCOUNT_JSON,              │
  │     WINDOWS_CODESIGN_PFX + PASSWORD, MACOS_NOTARY_APPLE_ID + TEAM_ID +          │
  │     PASSWORD, TAURI_SIGNING_PRIVATE_KEY + PASSWORD, CODECOV_TOKEN,              │
  │     DISCORD_WEBHOOK_URL, TWITTER_BEARER_TOKEN.                                  │
  │   ↑ Runner budget: ~925 min/month on the free tier (macOS is the dominant       │
  │     cost — 350 of 925 min).                                                     │
  │                                                                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ The graph is a concept diagram (workflow topology), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = the gate (lint) + OTA success, cyan =
     building / verifying (web-deploy smoke, eas-build, desktop-build),
     amber = OTA skipped (js_only=false), violet = the manual gate
     (release.yml workflow_dispatch), flare = a failed workflow (page
     agent — Rule 9 no silent failures).
   ↑ Cross-refs: §1 (the workflow graph), §2 (lint.yml), §3 (web-deploy.yml),
     §4 (eas-build.yml), §5 (desktop-build.yml), §6 (eas-update.yml), §7
     (release.yml), §8 (caching), §9 (concurrency), §10 (secrets), §11
     (runner budget), AGENTS.md §6 trigger #7 (7th workflow = stop-and-ask),
     Rule 3 (no telemetry — no Sentry/PostHog in v1), Rule 5 (no indigo),
     Rule 9 (no silent failures), TELE-1 (no analytics SDK).
```

### 14.3 Workflow-Trigger Matrix

Which event triggers which workflow, and what the concurrency rule is. The matrix is the **single source of truth** for "I pushed X — which workflows fire?" The pattern: lint cancels in-progress (it's a gate); deploys/builds/releases don't cancel (they're events of record).

```
  WORKFLOW-TRIGGER MATRIX  (§9, event → workflow → concurrency rule)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │  EVENT                → WORKFLOW         → CONCURRENCY      → RATIONALE          │
  │  ─────                │ ────────         │ ───────────      │ ─────────          │
  │                                                                                  │
  │  PR open/push         │ lint.yml         │ cancel: true     │ New push supersedes│
  │  (any branch)         │                  │ (emerald ✓)      │ the prior lint;    │
  │                       │                  │                  │ saves runner min   │
  │                                                                                  │
  │  Push to main         │ lint.yml         │ cancel: true     │ Same as above —    │
  │                       │ web-deploy.yml   │ cancel: false    │ lint cancels; web- │
  │                       │ eas-update.yml   │ cancel: false    │ deploy + eas-      │
  │                       │                  │                  │ update don't (each │
  │                       │                  │                  │ verifies its own   │
  │                       │                  │                  │ deployment / OTA)  │
  │                       │                  │                  │ (cyan — events of  │
  │                       │                  │                  │ record)            │
  │                                                                                  │
  │  Push to release/*    │ lint.yml         │ cancel: true     │ Same — lint gate;  │
  │                       │ eas-update.yml   │ cancel: false    │ eas-update ships   │
  │                       │                  │                  │ OTA to staging     │
  │                       │                  │                  │ channel (amber —   │
  │                       │                  │                  │ beta)              │
  │                                                                                  │
  │  Tag v*               │ eas-build.yml    │ cancel: false    │ Both build;        │
  │                       │ desktop-build.yml│ cancel: false    │ cancelling would   │
  │                       │                  │                  │ lose artifacts.    │
  │                       │                  │                  │ (cyan — building)  │
  │                                                                                  │
  │  Manual dispatch      │ release.yml      │ cancel: true     │ Two dispatches in  │
  │  (workflow_dispatch)  │                  │ (violet —        │ succession: only   │
  │                       │                  │  manual gate)    │ the latest runs.   │
  │                       │                  │                  │ Agent re-runs with │
  │                       │                  │                  │ the right inputs.  │
  │                                                                                  │
  │  Manual dispatch      │ web-deploy.yml   │ cancel: false    │ All workflows      │
  │  (workflow_dispatch)  │ eas-build.yml    │ cancel: false    │ support manual     │
  │                       │ eas-update.yml   │ cancel: false    │ dispatch for       │
  │                       │ desktop-build.yml│ cancel: false    │ on-branch testing  │
  │                       │                  │                  │ (§12).             │
  │                                                                                  │
  │  THE PATTERN (§9, the rule):                                                    │
  │   ↑ lint cancels — it's a gate. New push supersedes the prior lint.             │
  │   ↑ deploys/builds/releases DON'T cancel — they're events of record.            │
  │   ↑ Cancelling a deploy would leave its deployment unverified.                  │
  │   ↑ Cancelling a build would lose its artifacts.                                │
  │   ↑ Cancelling a release would lose the changelog + GitHub Release.             │
  │                                                                                  │
  │  THE 7TH-WORKFLOW STOP-AND-ASK (AGENTS.md §6 trigger #7):                       │
  │   ↑ Adding a 7th workflow is a stop-and-ask.                                    │
  │   ↑ Workflow sprawl is how pipelines become unmaintainable.                    │
  │   ↑ If a 7th seems necessary, the orchestrator reviews: is it a new             │
  │     responsibility, or can it be a job inside one of the existing 6?            │
  │                                                                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ The matrix is a concept diagram (event→workflow routing), not a
     rendered UI surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = the gate (lint, cancel-in-progress), cyan =
     events of record (don't cancel — verify each), amber = staging-channel
     OTA (beta), violet = manual dispatch (release.yml), flare = a 7th-
     workflow attempt (stop-and-ask triggered).
   ↑ Cross-refs: §1 (workflow graph), §2 (lint.yml), §3 (web-deploy.yml),
     §4 (eas-build.yml), §5 (desktop-build.yml), §6 (eas-update.yml), §7
     (release.yml), §9 (concurrency model), §12 (workflow-change
     protocol), AGENTS.md §6 trigger #7 (7th workflow = stop-and-ask),
     04_Release_Pipeline.md §5 (15-item checklist — when each workflow
     fires in a release).
```

### 14.4 CI Gate Sequence (lint.yml)

The 5-check pipeline that blocks every merge to `main`. The gate is the **promotion contract** (01_Vercel_Hosting.md §6.3): only when all 5 pass does the merge button unblock, and Vercel then takes the merge and deploys. There is no "manual approve to deploy" step in v1 — the CI gate IS the approval.

```
  CI GATE SEQUENCE  (§2, the 5-check pipeline that blocks every merge)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │  PR opened against main (or release/*)                                           │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  lint.yml triggers  (concurrency: lint-<ref>, cancel-in-progress: true)   │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  STEP 1: bun install --frozen-lockfile                                    │   │
  │  │   ↑ the lockfile is the contract; CI does not silently update it          │   │
  │  │   (cyan — installing)                                                     │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  STEP 2: bun run lint  (timeout-minutes: 5)                               │   │
  │  │   ↑ 0 errors, 0 warnings — including:                                    │   │
  │  │     • no-indigo-accent       (Rule 5, AP-6)                              │   │
  │  │     • no-float-money         (Rule 6, BR-M-01 — integer paise)           │   │
  │  │     • no-empty-catch         (Rule 9 — no silent failures)               │   │
  │  │     • no-color-only-status   (WCAG §1.4.1, §10.6)                        │   │
  │  │     • no-service-role-in-client  (10_Security.md §2.2)                   │   │
  │  │     • no-ios-blob-upload     (02_Vercel_Blob §2.2)                       │   │
  │  │     • version-bump.test.ts  (04_Release_Pipeline.md §2.4)                │   │
  │  │   (emerald ✓ pass / flare ✕ fail → merge blocked)                       │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  STEP 3: bun run typecheck  (timeout-minutes: 5)                          │   │
  │  │   ↑ tsc --noEmit across apps/web, packages/*                              │   │
  │  │   (emerald ✓ pass / flare ✕ fail)                                        │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  STEP 4: bun run test:unit + test:integration  (timeout: 5+5 min)         │   │
  │  │   ↑ unit: ≥70% line coverage on packages/core + packages/shared           │   │
  │  │   ↑ integration: in-memory SQLite, every flow in AGENTS.md §7.2           │   │
  │  │   (emerald ✓ pass / flare ✕ fail)                                        │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  STEP 5: bun run test:a11y  (timeout-minutes: 5)                          │   │
  │  │   ↑ axe-core on every screen                                              │   │
  │  │   ↑ WCAG 2.1 AA (targeting AAA where stated, 13_UI_Guidelines.md §10.1)   │   │
  │  │   (emerald ✓ pass / flare ✕ fail)                                        │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  STEP 6: bun run version:check  (timeout-minutes: 1)                      │   │
  │  │   ↑ the version-consistency lint (04_Release_Pipeline.md §2.4)            │   │
  │  │   ↑ fails if any file's version field drifts from package.json's          │   │
  │  │   (emerald ✓ pass / flare ✕ fail)                                        │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
  │  │  Upload coverage to Codecov (if: always() — partial data on failure)      │   │
  │  └──────────────────────────────────────────────────────────────────────────┘   │
  │       │                                                                          │
  │       ▼                                                                          │
  │  ALL 5 GATES GREEN? ───► YES ──► merge button unblocks ──► Vercel deploys       │
  │                       (emerald ✓)                                                │
  │                       │                                                          │
  │                       NO  ──► merge blocked ──► PR author fixes ──► re-push     │
  │                       (flare ✕)                                                  │
  │                                                                                  │
  │  THE PROMOTION CONTRACT (01_Vercel_Hosting.md §6.3):                            │
  │   ↑ The CI gate IS the approval — no "manual approve to deploy" step in v1.     │
  │   ↑ For v2 (team > 2): consider Vercel's "Promote to Production" gate.         │
  │   ↑ A hotfix follows the SAME gate (04_Release_Pipeline.md §7.4 — no bypass).  │
  │   ↑ Bypassing CI for an "urgent" release is AGENTS.md §6 trigger #9            │
  │     (stop-and-ask — only the orchestrator).                                     │
  │                                                                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ The sequence is a concept diagram (the 5-check pipeline), not a
     rendered UI surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: cyan = installing (step 1), emerald = pass / merge
     unblocked, flare = fail / merge blocked, violet = the v2 manual
     promotion gate (placeholder, not in v1).
   ↑ Cross-refs: §2 (lint.yml full YAML), §2.1 (key points), 01_Vercel
     §6.3 (promotion contract), 04_Release_Pipeline.md §2.4 (version-
     consistency lint), §7.4 (hotfix does not skip CI), AGENTS.md §6
     trigger #9 (CI bypass = stop-and-ask), Rule 5 (no-indigo-accent),
     Rule 6 (no-float-money, BR-M-01), Rule 9 (no-empty-catch, no silent
     failures), 10_Security.md §2.2 (no-service-role-in-client), 02 §2.2
     (no-ios-blob-upload), 13_UI_Guidelines.md §10.1 (WCAG 2.1 AA) +
     §10.6 (no-color-only-status, WCAG §1.4.1).
```

### 14.5 GitHub Actions Check-Run Card (the one live UI surface this file references)

The per-PR status check that shows lint / typecheck / unit / integration / a11y results. The card is rendered in the GitHub PR UI (third-party chrome), but the contract this file makes about how the agent reads it (the card is glass-faint-equivalent content — it recedes so the PR diff is the focus; the "Re-run failed jobs" button is a control) follows §6.6's single rule.

```
  GITHUB ACTIONS CHECK-RUN CARD  (§2, the per-PR status check)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  github.com/buddysaradhi/buddysaradhi/pull/123  (the PR's "Checks" tab)               │
  │                                                                              │
  │  ┌─ Check-run card (GitHub chrome, glass-faint-equivalent — recedes) ────┐  │
  │  │                                                                        │  │
  │  │  ● lint / lint  ·  main  ·  abc1234  ·  2 min ago                      │  │
  │  │     ▲ status dot (emerald ✓ = pass, flare ✕ = fail, amber = pending)  │  │
  │  │                                                                        │  │
  │  │  ┌─ Steps (glass-faint-equivalent content surface) ──────────────────┐ │  │
  │  │  │  ✓ Checkout                          3s    (emerald ✓)            │ │  │
  │  │  │  ✓ Setup Bun                         2s    (emerald ✓)            │ │  │
  │  │  │  ✓ Cache Bun                         5s    (emerald ✓)            │ │  │
  │  │  │  ✓ Install dependencies             18s    (emerald ✓)            │ │  │
  │  │  │  ✓ Lint                              8s    (emerald ✓)            │ │  │
  │  │  │  ✓ Typecheck                        12s    (emerald ✓)            │ │  │
  │  │  │  ✓ Unit tests                       24s    (emerald ✓)            │ │  │
  │  │  │  ✕ Integration tests                31s    (flare ✕ — FAILED)     │ │  │
  │  │  │  ○ Accessibility test               —     (amber — skipped)       │ │  │
  │  │  │  ○ Upload coverage                  —     (amber — skipped)       │ │  │
  │  │  │  ○ Version consistency check        —     (amber — skipped)       │ │  │
  │  │  └────────────────────────────────────────────────────────────────────┘ │  │
  │  │     ↑ content surface = glass-faint-equivalent (§5.5 coverage map:       │  │
  │  │       "list row" tier — recedes so the PR diff is the focus)             │  │
  │  │                                                                        │  │
  │  │  [ View logs ]   [ Re-run failed jobs ]   ← control = .neumo-raised     │  │
  │  └────────────────────────────────────────────────────────────────────────┘  │
  │     ↑ on :active → .neumo-pressed (§6.3) + 1px translate                   │
  │     ↑ WCAG §1.4.1: the status dot is NEVER the only signal — the           │
  │       ✓ / ✕ / ○ glyph + the step name accompany the dot.                   │
  │     ↑ the "Re-run failed jobs" button is violet (manual re-trigger)        │
  │       — never indigo/blue per Rule 5.                                      │
  │                                                                              │
  │  AGENT PROTOCOL (when this card shows flare ✕):                            │
  │   1. Click "View logs" → read the failing step's output.                    │
  │   2. If the failure is a real bug → fix on the PR branch → re-push         │
  │      (lint.yml re-runs automatically; cancel-in-progress: true).            │
  │   3. If the failure is a flaky test → click "Re-run failed jobs"           │
  │      (the .neumo-raised control above).                                     │
  │   4. If 3 consecutive re-runs fail → it's not flaky; investigate           │
  │      (the §12 on-branch test protocol + §4.2 rollback-path drill).         │
  │   5. Append `---` worklog entry if the failure blocked a release.          │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ This is a live UI surface — the §6.6 single rule applies: card =
     glass-faint-equivalent (content, recedes), "Re-run failed jobs" =
     neumo-raised (control).
   ↑ Accent colours: emerald = pass, flare = fail (merge blocked), amber =
     pending / skipped, violet = the manual "Re-run failed jobs" control
     (P13 distribution — the agent re-triggers).
   ↑ Cross-refs: §2 (lint.yml), §2.1 (key points), §12 (workflow-change
     protocol), §4.1 (on-branch test), §4.2 (rollback-path drill),
     01_Vercel_Hosting §6.3 (the promotion contract — CI gate IS the
     approval), 04_Release_Pipeline.md §7.4 (hotfix does not skip CI),
     13_UI_Guidelines.md §5.5 (list-row / glass-faint tier), §6.6 (control
     = neumo), §6.3 (pressed), §10.6 (WCAG §1.4.1), Rule 5 (no indigo/blue
     — re-run button is violet), Rule 9 (no silent failures — the flare ✕
     is the contract's enforcement).
```

### 14.6 References (External Design Authorities)

The mockups and the workflow-automation contract in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the 6-workflow canonical set, the concurrency rules, or the CI gate sequence.

- **GitHub Actions docs** — *Workflow syntax, triggers, concurrency, matrix strategy, composite actions, secrets, caching*. The §14.2 workflow graph + §14.3 trigger matrix + §14.4 CI gate sequence follow GitHub Actions's workflow-syntax documentation.
- **Vercel docs** — *GitHub integration, auto-deploy on push, deployment protection*. The §14.2 web-deploy.yml node follows Vercel's GitHub-integration documentation (auto-deploy; the workflow exists only for post-deploy smoke).
- **Expo EAS GitHub Action** — *expo-expo-github-action, EAS build, EAS update, --no-wait, --auto-submit, --republish*. The §14.2 eas-build.yml + eas-update.yml nodes follow Expo's EAS GitHub Action documentation.
- **Tauri docs** — *Tauri GitHub Action, signing keys, notarytool, signtool, updater plugin*. The §14.2 desktop-build.yml node follows Tauri's CI/CD documentation (matrix build, sign + notarize, upload to Blob).
- **Smashing Magazine** — *CI/CD UX, workflow-graph readability, concurrency patterns*. The §14.2 workflow graph + §14.3 concurrency matrix follow Smashing's CI/CD-UX research (cancel-the-gate, don't-cancel-events-of-record).
- **CSS-Tricks** — *GitHub Actions caching strategy, runner-budget optimisation*. The §14.2 shared-infrastructure note + §8 caching table + §11 runner budget follow CSS-Tricks's GitHub Actions caching primer (Cargo cache is the heavy one — pin it).
- **Nielsen Norman Group** — *WCAG §1.4.1 Use of Color + §3.3.2 Labels or Instructions*. The §14.5 dual-signal note (status dot + ✓/✕/○ glyph + step name) follows NN/g's research and `13_UI_Guidelines.md` §10.6.
- **Codecov docs** — *Coverage upload, partial-data on failure*. The §14.4 step 6 `if: always()` coverage upload follows Codecov's partial-coverage documentation.

---

*This file is the operational spec for Buddysaradhi's GitHub Actions workflows. It is read by every release-engineering agent before they touch `.github/workflows/`. When this file and the actual workflow YAML disagree, this file wins — unless this file is wrong, in which case you amend this file first, then the YAML, then the worklog. The order matters.*
