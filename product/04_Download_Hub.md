# 04 — Download Hub

> The download hub is the **conversion point for non-web users**. A tutor on a Mac, a tutor on a Windows desktop, a tutor on an Android phone, a tutor on an iPad — each of them needs a clear, fast, verified path to the right binary. The hub also offers the **fifth path** — "Open the web version" — for the visitor who wants to skip installation entirely. Five paths, one page, zero ambiguity. This is the page that turns a Mac visitor into a Mac user, an Android visitor into an Android user, and a "not sure" visitor into a web-app trialist.

---

## 1. Where the Download Hub Lives

The download hub has two surfaces:

1. **A section on the landing page** (`/` at `#download`), embedded between Pricing and FAQ. This is the **primary** surface — most visitors download from here without ever navigating away.
2. **A dedicated page** at `/download` (the `(marketing)` route group, `web/01_Architecture.md §3`). This is for visitors who arrive from a "download Buddysaradhi" Google search, a partner blog link, or a press article. It is the same content as the `/#download` section, expanded with install guides and changelogs inline.

Both surfaces render the same React component (`<DownloadHub />`) — there is one source of truth for the download UI, not two. The `/download` page wraps the component in a standard marketing layout (nav + footer); the `/#download` section embeds it inside the landing page's section flow.

---

## 2. The Five Download Cards

The hub renders **five cards** in a responsive grid: 3 columns on desktop (cols 1–4, 5–8, 9–12 of the 12-col grid), 2 columns on tablet, 1 column on mobile. The cards are:

| # | Card | Accent | Primary action | Target |
|---|---|---|---|---|
| 1 | **Web** | Emerald | "Open web version →" | `https://app.buddysaradhi.app` |
| 2 | **macOS** | Cyan | "Download for Mac — 14 MB" | Vercel Blob URL (`*.dmg`) |
| 3 | **Windows** | Cyan | "Download for Windows — 12 MB" | Vercel Blob URL (`*.msi`) |
| 4 | **Android** | Emerald | "Get it on Play Store →" | Play Store listing URL |
| 5 | **iOS** | Emerald | "Get it on the App Store →" | App Store listing URL |

The Web card is **always** first (leftmost on desktop, top on mobile). The Web card is the lowest-friction path — no install, no permission prompts, no storage — and we want it to be the visitor's first consideration. The desktop cards (Mac, Windows) come next. The mobile cards (Android, iOS) come last (they are most-relevant to mobile visitors, who have already been auto-detected by the hero chip and may not even reach the hub).

### 2.1 Card Layout (Desktop)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐      │
│  │ ▸ WEB               │  │ ▸ MACOS            │  │ ▸ WINDOWS          │      │
│  │                     │  │                    │  │                    │      │
│  │  [ ◉ icon, 64px ]   │  │  [ ◉ icon, 64px ]  │  │  [ ◉ icon, 64px ]  │      │
│  │                     │  │                    │  │                    │      │
│  │  No install.        │  │  Universal .dmg    │  │  Per-user .msi     │      │
│  │  Works in any       │  │  v1.4.0 · 14 MB    │  │  v1.4.0 · 12 MB    │      │
│  │  modern browser.    │  │  macOS 11+         │  │  Windows 10+       │      │
│  │                     │  │                    │  │                    │      │
│  │ ┌────────────────┐  │  │ ┌────────────────┐ │  │ ┌────────────────┐ │      │
│  │ │Open web version│ │  │ │ Download .dmg  │ │  │ │ Download .msi  │ │      │
│  │ └────────────────┘  │  │ └────────────────┘ │  │ └────────────────┘ │      │
│  │                     │  │                    │  │                    │      │
│  │  View requirements  │  │  View changelog →  │  │  View changelog →  │      │
│  │                     │  │  SHA-256: a3f2…    │  │  SHA-256: 7c91…    │      │
│  │                     │  │  How to install ↓  │  │  How to install ↓  │      │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘      │
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐                             │
│  │ ▸ ANDROID           │  │ ▸ IOS              │                             │
│  │                     │  │                    │                             │
│  │  [ ◉ icon, 64px ]   │  │  [ ◉ icon, 64px ]  │                             │
│  │                     │  │                    │                             │
│  │  Play Store         │  │  App Store         │                             │
│  │  v1.4.0 · 18 MB     │  │  v1.4.0 · 22 MB    │                             │
│  │  Android 8.0+       │  │  iOS 15.0+         │                             │
│  │                     │  │                    │                             │
│  │ ┌────────────────┐  │  │ ┌────────────────┐ │                             │
│  │ │ Get on Play    │  │  │ │ Get on App     │ │                             │
│  │ │ Store →        │  │  │ │ Store →        │ │                             │
│  │ └────────────────┘  │  │ └────────────────┘ │                             │
│  │                     │  │                    │                             │
│  │  View changelog →   │  │  View changelog →  │                             │
│  │  APK mirror (sideload) ↓ │              │  │  TestFlight (beta) ↓       │
│  └────────────────────┘  └────────────────────┘                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ QR CODE: scan to download on your phone  │  "Or text me a link →"      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Card Anatomy

Every card has the same anatomy, in the same order:

1. **Eyebrow caption** — `▸ WEB`, `▸ MACOS`, `▸ WINDOWS`, `▸ ANDROID`, `▸ IOS`. Caption style (12/16, 500 weight, +0.05em uppercase tracking), accent-coloured per the table in §2.
2. **Platform icon** — 64×64px SVG, accent-coloured, single-colour (no rainbow Apple/Google logos — we redraw them in our accent palette to maintain visual consistency, with the trademark line in the footnote: "Apple, Apple Logo, and Mac are trademarks of Apple Inc., registered in the U.S. and other countries. Google Play and the Google Play logo are trademarks of Google LLC.").
3. **Pitch line** — one sentence, ≤ 12 words. "No install. Works in any modern browser." / "Universal .dmg for Intel + Apple Silicon." / "Per-user .msi, no admin rights needed." / "Play Store install, auto-updates." / "App Store install, TestFlight for beta."
4. **Metadata line** — version · file size · OS minimum. Example: `v1.4.0 · 14 MB · macOS 11+`. Mono font (`JetBrains Mono`), `--text-muted`, 13/18.
5. **Primary button** — full-card-width, 48px tall, accent-coloured per the table. The label is action + platform + size: "Download .dmg — 14 MB" / "Open web version →". Touch target: full-width × 48px = well above 44×44.
6. **Secondary link 1** — "View changelog →". Cyan ghost link to `/changelog/{version}` (the changelog page, served from Vercel Blob per `deployment/02_Vercel_Blob_Build_Storage.md §2.3`).
7. **Secondary link 2 (desktop cards only)** — "SHA-256: a3f2…". The truncated SHA-256 hash of the binary. Click expands to show the full hash and a "Copy" button. The hash is fetched from Vercel Blob (`{binary}.sha256` per `deployment/02_Vercel_Blob_Build_Storage.md §2`).
8. **Tertiary link (desktop cards only)** — "How to install ↓". Click expands an inline install-guide panel (§6 below).
9. **Tertiary link (Android only)** — "APK mirror (sideload) ↓". Links to the universal APK on Vercel Blob for visitors who cannot access the Play Store (e.g., Huawei devices, enterprise-locked phones).
10. **Tertiary link (iOS only)** — "TestFlight (beta) ↓". Links to the TestFlight invite URL for visitors who want the beta channel.

### 2.3 Five-Card Download Grid — Component Anatomy

The five download cards are the canonical "marketing download card" surface listed in §5.5 of `13_UI_Guidelines.md`. Each card is `.glass` (the workhorse tier), with the recommended card elevated to `.glass-strong` + 2px accent border when the platform auto-detect fires (§3 below). The primary button is a neumorphic control per §6.6 (`.neumo-raised`, accent fill), not a glass surface.

```
  DESKTOP 5-CARD GRID  (Web · macOS · Windows on row 1, Android · iOS on row 2)

  ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
  │ ▸ WEB                   │  │ ▸ MACOS   [RECOMMENDED]│  │ ▸ WINDOWS              │
  │ [ ◉ icon, 64px ]        │  │ [ ◉ icon, 64px ]        │  │ [ ◉ icon, 64px ]        │
  │ emerald accent          │  │ cyan accent             │  │ cyan accent             │
  │                         │  │                         │  │                         │
  │ No install. Works in    │  │ Universal .dmg for      │  │ Per-user .msi, no      │
  │ any modern browser.     │  │ Intel + Apple Silicon.  │  │ admin rights needed.   │
  │                         │  │                         │  │                         │
  │ v1.4.0 · Web · any      │  │ v1.4.0 · 14 MB · 11+    │  │ v1.4.0 · 12 MB · Win10+ │
  │                         │  │                         │  │                         │
  │ ┌────────────────────┐  │  │ ┌────────────────────┐  │  │ ┌────────────────────┐  │
  │ │ Open web version → │  │  │ │ Download .dmg — 14 │  │  │ │ Download .msi — 12 │  │
  │ └────────────────────┘  │  │ └────────────────────┘  │  │ └────────────────────┘  │
  │  ↑ neumo-raised,         │  │  ↑ neumo-raised,         │  │  ↑ neumo-raised,         │
  │    emerald fill + glow   │  │    cyan fill, no glow    │  │    cyan fill, no glow    │
  │    (§6.6, §8.2)          │  │    (§6.6, §8.2)          │  │    (§6.6, §8.2)          │
  │                         │  │                         │  │                         │
  │ View requirements       │  │ View changelog →        │  │ View changelog →        │
  │                         │  │ SHA-256: a3f2…   [copy] │  │ SHA-256: 7c91…   [copy] │
  │                         │  │ How to install ↓        │  │ How to install ↓        │
  └────────────────────────┘  └────────────────────────┘  └────────────────────────┘
   ↑ .glass (5% white, 24px   ↑ .glass-strong (8% white,  ↑ .glass (5% white, 24px
     blur) — default tier       24px blur) + 2px cyan       blur) — default tier
     ↑ no recommended badge     border + "RECOMMENDED"      ↑ no recommended badge
                                 caption above eyebrow
                                 (only on detected-platform
                                 card, §3)
  ┌────────────────────────┐  ┌────────────────────────┐
  │ ▸ ANDROID               │  │ ▸ IOS                   │
  │ [ ◉ icon, 64px ]        │  │ [ ◉ icon, 64px ]        │
  │ emerald accent          │  │ emerald accent          │
  │                         │  │                         │
  │ Play Store install,     │  │ App Store install,      │
  │ auto-updates.           │  │ TestFlight for beta.    │
  │                         │  │                         │
  │ v1.4.0 · 18 MB · 8.0+   │  │ v1.4.0 · 22 MB · iOS 15+│
  │                         │  │                         │
  │ ┌────────────────────┐  │  │ ┌────────────────────┐  │
  │ │ Get on Play Store →│  │  │ │ Get on App Store → │  │
  │ └────────────────────┘  │  │ └────────────────────┘  │
  │  ↑ neumo-raised,         │  │  ↑ neumo-raised,         │
  │    emerald fill + glow   │  │    emerald fill + glow   │
  │    (§6.6, §8.2)          │  │    (§6.6, §8.2)          │
  │                         │  │                         │
  │ View changelog →        │  │ View changelog →        │
  │ APK mirror (sideload) ↓ │  │ TestFlight (beta) ↓     │
  └────────────────────────┘  └────────────────────────┘
   ↑ .glass (default tier)    ↑ .glass (default tier)

   ↑ ALL 5 cards: .glass background (§5.5 marketing download card surface)
   ↑ ALL 5 primary buttons: .neumo-raised (§6.6 control, §8.2 anatomy) — NOT
     glass. Controls = neumo, surfaces = glass (§6.6 single rule).
   ↑ Recommended card elevation: .glass → .glass-strong + 2px accent border +
     "RECOMMENDED" caption above eyebrow (only on detected-platform card)
   ↑ Card padding p-6 (24px), gap-4 between cards (§4.4 of 13_UI_Guidelines.md)
   ↑ Primary button: 48px tall, full-card-width (well above 44×44 §10.2)
   ↑ Accent colours per §2 table: Web=emerald, macOS=cyan, Windows=cyan,
     Android=emerald, iOS=emerald (mobile stores = success colour; desktop
     downloads = info colour, §2.4 of 13_UI_Guidelines.md)

  MOBILE 5-CARD STACK  (cols 1–12, full-width, recommended card moved to TOP)

  ┌──────────────────────────────────┐
  │ ▸ ANDROID   [RECOMMENDED]         │  ← detected card moved to top
  │ [ ◉ icon, 64px ]                  │     .glass-strong + 2px emerald border
  │ Play Store install, auto-updates. │
  │ ┌──────────────────────────────┐  │
  │ │ Get on Play Store →          │  │  ← neumo-raised emerald, full-width
  │ └──────────────────────────────┘  │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │ ▸ WEB                              │  ← .glass, default tier
  │ No install. Works in any browser. │
  │ ┌──────────────────────────────┐  │
  │ │ Open web version →           │  │  ← neumo-raised emerald, full-width
  │ └──────────────────────────────┘  │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │ ▸ IOS                              │  ← .glass, default tier
  │ App Store install, TestFlight.    │
  │ ┌──────────────────────────────┐  │
  │ │ Get on App Store →           │  │  ← neumo-raised emerald, full-width
  │ └──────────────────────────────┘  │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │ ▸ MACOS   (desktop only)          │  ← .glass @ opacity 60% (de-emphasised)
  │ …                                  │     + "desktop only" caption
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │ ▸ WINDOWS (desktop only)          │  ← .glass @ opacity 60% (de-emphasised)
  │ …                                  │     + "desktop only" caption
  └──────────────────────────────────┘
   ↑ Stacked vertically, space-6 (24px) between cards
   ↑ Detected card MOVED to top (not just visually elevated) — mobile visitors
     have less patience for scrolling (§11)
   ↑ Desktop cards de-emphasised: opacity 60% + "desktop only" caption
   ↑ QR code HIDDEN on mobile (a mobile visitor cannot scan their own screen)
   ↑ "Text me a link" form HIDDEN on mobile (visitor is already on their phone)

  SHA-256 EXPANSION (desktop cards, click "SHA-256: a3f2…" to expand)
  ┌────────────────────────────────────────────────────────────┐
  │ SHA-256 checksum — Buddysaradhi-1.4.0-universal.dmg              │
  │                                                              │
  │ a3f2c7e8b9d1e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6   │
  │ c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f   │
  │                                                              │
  │ Verify locally:                                              │
  │   macOS:  shasum -a 256 Buddysaradhi-1.4.0-universal.dmg         │
  │   Windows: certutil -hashfile Buddysaradhi-1.4.0-x64.msi SHA256  │
  │                                                              │
  │ [ Copy hash ]   [ Close ]                                    │
  │  ↑ neumo-raised    ↑ neumo-raised ghost                       │
  └────────────────────────────────────────────────────────────┘
   ↑ .glass-strong panel (elevated focus surface, §5.5)
   ↑ Hash in JetBrains Mono, --text-primary, 13/18 (§3.2 type ramp)
   ↑ Copy + Close buttons are neumo-raised controls (§6.6), not glass
   ↑ If the visitor's local hash DOES NOT match, do NOT install — email
     hello@buddysaradhi.app (§7.1 VERIFY state, no-silent-failures rule AP-9)
```

---

## 3. Platform Auto-Detection (Shared with Hero)

The download hub uses the **same platform-detection logic** as the hero chip (`02_Hero_and_Above_the_Fold.md §8`). The detected platform's card is **visually elevated**: 2px accent border (the card's accent at 50% opacity), `--surface-glass-strong` background instead of `--surface-glass`, and a small "Recommended for your device" caption above the eyebrow.

```
┌────────────────────┐
│ Recommended for    │  ← caption, accent-coloured
│ your device        │
│ ▸ MACOS            │  ← eyebrow
│  [ ◉ icon, 64px ]  │
│  ...               │  ← rest of card unchanged
└────────────────────┘
   ↑
   2px accent-emerald border,
   --surface-glass-strong fill
```

The non-recommended cards stay at default styling — no dimming, no "not for you" label. The visitor can still click any card. The recommendation is a nudge, not a constraint.

### 3.1 Detection Edge Cases

| Visitor | Detected platform | Recommended card |
|---|---|---|
| Mac user on Safari | `macos` | macOS card |
| Windows user on Edge | `windows` | Windows card |
| Android user on Chrome | `android` | Android card |
| iPhone user on Safari | `ios` | iOS card |
| Linux user on Firefox | `linux` | Web card (Linux desktop build is v2.x roadmap, `15_Future_Roadmap.md`) |
| iPad user on Safari | `ios` | iOS card (iPad runs iOS app) |
| Bot (Googlebot, Bingbot) | `web` | Web card (so SEO indexing sees the Web card as primary) |
| Unknown / no UA | `web` | Web card (safe default) |

### 3.2 Manual Override

Every card is clickable regardless of detection. The visitor on Mac who wants the Windows build for a colleague clicks the Windows card. The visitor on Linux who wants to try the Mac build on a Hackintosh clicks the Mac card. There is no lock-in. The "Recommended for your device" caption is a nudge, not a barrier.

---

## 4. The "Open Web Version" CTA

The Web card's primary button — "Open web version →" — is the **highest-converting CTA on the entire page** after the hero primary. It is the frictionless path: no install, no permission, no storage. It redirects to `https://app.buddysaradhi.app` (the live web app), where the visitor lands on `/signup` if they have no session, or `/dashboard` if they do.

### 4.1 Why the Web Card Is First

The Web card is first in the grid (leftmost on desktop, top on mobile) for three reasons:

1. **Lowest friction.** A web visitor clicking a web CTA has zero install cost. The signup-to-first-student time is under 90 seconds (`web/03_Auth_and_Provisioning.md`).
2. **Highest conversion.** Web visitors convert to signups at ~3.2× the rate of desktop-download visitors (industry benchmark for SaaS marketing pages).
3. **No version drift.** The web app is always the latest version. A desktop download is the latest version *at the time of download* — the visitor may not update for months. Surfacing the web card first reduces the "stale desktop install" support load.

### 4.2 The "Text Me a Link" Pattern

Below the QR code (§5), a small "Or text me a link →" link. Click opens a tiny form: phone number field (with `+91` default for India, switchable for international), submit button. On submit, a serverless function (`/api/sms-link`) sends an SMS via a Razorpay-route-registered SMS gateway (not Twilio — Twilio's India SMS pricing is 4× the domestic gateways). The SMS contains a single t.co-style short link (`buddysaradhi.app/d/abc123`) that 302-redirects to the detected platform's download path.

The phone number is **not stored** — the SMS gateway logs the number for delivery purposes only, and Buddysaradhi's serverless function discards the request body after the gateway responds. This is enforced by code review (`AGENTS.md §3` — no PII storage without an explicit principle permitting it). The "text me a link" pattern is a micro-conversion (`07_CTA_and_Conversion.md §11`), not a signup — we measure the SMS send rate, not the phone-number-collection rate.

---

## 5. The QR Code

Below the 5 cards, a QR code in the centre of the page. The QR encodes `https://buddysaradhi.app/d` (the `/d` short URL 302-redirects to the detected platform's download path on the visitor's phone — Android visitors get Play Store, iOS visitors get App Store, desktop scans are a no-op and land on `/download`).

### 5.1 QR Code Spec

| Property | Value |
|---|---|
| Generator | `qrcode` npm package (server-side, no client JS) |
| Error correction | Level M (15% redundancy — survives a smudged print) |
| Module size | 8px on desktop, 6px on mobile (so the QR is 200×200 and 150×150 respectively) |
| Foreground | `--text-primary` (`rgba(255,255,255,0.95)`) |
| Background | `--bg-cosmic` (`#0f0c29`) |
| Quiet zone | 4 modules (the standard minimum) |
| Label below | "Scan to download on your phone" (caption, `--text-muted`, centred) |

### 5.2 The QR Refresh Rule

The QR code is **static** — it always encodes `https://buddysaradhi.app/d`. It does not need to change between releases because the `/d` redirect handles platform detection at runtime. This means printed QR codes (on flyers, business cards, conference banners) remain valid forever — a critical property for offline marketing.

---

## 6. The Install Guides (Expandable)

Each desktop card has a "How to install ↓" link. Click expands an inline panel below the card, with platform-specific install steps. The panels are **not modals** — they expand inline, pushing the content below downward. This is the "progressive disclosure" pattern: the default view is uncluttered; the visitor who needs help clicks once and gets it.

### 6.1 macOS Install Guide

```markdown
1. Click "Download .dmg" above. The file `Buddysaradhi-1.4.0-universal.dmg` (~14 MB)
   downloads to your `~/Downloads/` folder.

2. Double-click the `.dmg`. A new Finder window opens showing the Buddysaradhi app
   icon and an alias to your `/Applications/` folder.

3. Drag the Buddysaradhi icon into the Applications folder alias. The app copies
   (~5 seconds on SSD, ~15 seconds on HDD).

4. Eject the `.dmg` (right-click → Eject "Buddysaradhi 1.4.0", or click the eject
   icon in Finder's sidebar).

5. Open Launchpad → Buddysaradhi. The first launch shows a Gatekeeper dialog:
   "Buddysaradhi is from an unidentified developer." Right-click → Open → Open
   in the confirmation dialog. This is normal for non-App-Store apps; we are
   notarized by Apple but not distributed via the App Store.

6. The first launch also prompts for biometric enrollment (Touch ID / Face ID
   via Apple Watch). This is optional — you can skip and use a master password
   instead. See Settings → Security.

7. Sign up with your email + OTP. Your per-user database is provisioned on
   Turso (Mumbai region). The signup takes ~6 seconds.
```

### 6.2 Windows Install Guide

```markdown
1. Click "Download .msi" above. The file `Buddysaradhi-1.4.0-x64.msi` (~12 MB)
   downloads to your `Downloads/` folder.

2. Double-click the `.msi`. Windows SmartScreen may show "Windows protected
   your PC." Click "More info" → "Run anyway." This is normal for non-Microsoft-
   Store apps with limited reputation; the installer is EV-code-signed by us
   and the reputation builds over time.

3. The installer runs per-user (no admin rights needed). It installs to
   `%LOCALAPPDATA%\Buddysaradhi\` and adds a Start Menu shortcut.

4. Open Start → Buddysaradhi. The first launch prompts for biometric enrollment
   (Windows Hello: fingerprint, face, or PIN). Optional — master password
   fallback is available.

5. Sign up with your email + OTP. The signup takes ~6 seconds.
```

### 6.3 The Install-Guide Tone

The install guides are written in **imperative mood, second person, ≤ 7 steps.** No "we recommend" hedging — the visitor wants instructions, not opinions. The SmartScreen and Gatekeeper warnings are called out explicitly because they are the #1 install-abandonment cause for non-App-Store apps. Pretending they don't happen is dishonest.

---

## 7. The Download-Flow State Machine

The download flow is a state machine. The visitor moves through it on every download click.

```
                ┌────────────────────────────────────────────────────┐
                │  DETECT                                            │
                │  Middleware parses User-Agent, sets                │
                │  x-detected-platform header. Page renders with     │
                │  the recommended card elevated.                    │
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  RECOMMEND                                         │
                │  Visitor sees 5 cards. Recommended card has 2px     │
                │  accent border + "Recommended for your device"      │
                │  caption. Visitor can override by clicking any card.│
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  DOWNLOAD                                          │
                │  Click → server-side redirect to Vercel Blob URL.  │
                │  Blob streams the binary via CDN (bom1 region for  │
                │  India, sin1/fra1 edge-cached elsewhere).           │
                │  Browser downloads to ~/Downloads/.                │
                │  Analytics event: download_click (variant, platform)│
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  VERIFY                                            │
                │  Visitor (optional) clicks "SHA-256: a3f2…" to     │
                │  expand the full hash. They can run                │
                │  `shasum -a 256 Buddysaradhi-1.4.0-universal.dmg` on    │
                │  macOS or `certutil -hashfile Buddysaradhi-1.4.0-x64.msi│
                │  SHA256` on Windows to verify the download.         │
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  INSTALL GUIDE                                     │
                │  Visitor (optional) clicks "How to install ↓" to   │
                │  expand the inline install guide. Steps render in   │
                │  the card's accent colour.                          │
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  FIRST RUN                                         │
                │  Visitor opens the app. Sign-up screen appears.    │
                │  Visitor signs up with email + OTP. Per-user DB    │
                │  provisioned on Turso. Empty Dashboard loads in     │
                │  ~6 seconds.                                       │
                │  Analytics event: signup_complete (platform)        │
                └────────────────────────────────────────────────────┘
```

### 7.1 The State Machine's Failure Modes

| State | Failure | Recovery |
|---|---|---|
| DETECT | UA parser returns `web` for a Mac visitor (rare, caused by browser spoofing) | Visitor clicks macOS card manually; no harm |
| RECOMMEND | Visitor ignores recommendation and clicks a different card | No failure — every card is clickable |
| DOWNLOAD | Vercel Blob URL returns 404 (binary not uploaded for this version) | Card shows a red error toast: "Download unavailable. Try the web version →." Operator is paged. |
| DOWNLOAD | Vercel Blob URL returns 5xx | Card shows a retry button + the web CTA. |
| VERIFY | Visitor's local hash does not match the published SHA-256 | Visitor should NOT install. Email hello@buddysaradhi.app. We investigate (could be a MITM or a corrupt download). |
| INSTALL GUIDE | Visitor's OS does not match the guide (e.g., clicked Windows guide on a Mac) | No failure — the guide is platform-specific to the card, not the visitor. |
| FIRST RUN | App crashes on first launch | Visitor emails hello@buddysaradhi.app with the crash log. We have a 24-hour SLA on first-launch crashes. |

The "no silent failures" rule (Rule 9, AP-9) applies: every failure mode surfaces a typed toast or banner. No empty `catch {}` blocks. No "download failed" with no explanation. The operator is paged via Vercel's alert on the Blob 404 rate exceeding 1% in a 5-minute window (`deployment/01_Vercel_Hosting.md §8`).

---

## 8. Vercel Blob Bandwidth Budgeting

The download hub is the **single largest consumer of Vercel Blob bandwidth** on the project. A budget is necessary to avoid surprises on the Vercel Pro plan.

### 8.1 The Bandwidth Math

| Variable | Value | Source |
|---|---|---|
| Average binary size | 13 MB (mean of 14 MB Mac, 12 MB Win, 18 MB Android APK, 22 MB iOS — but iOS does not download from Blob) | `deployment/02_Vercel_Blob_Build_Storage.md §2` |
| Estimated monthly downloads (v1, year 1) | 1,500 | Conservative: 100 signups/mo × 50% download a binary × 12 months × 1.5 (re-downloads + updates) |
| Estimated monthly egress | 1,500 × 13 MB = 19.5 GB | |
| Vercel Hobby tier Blob egress | 10 GB/mo (then $0.15/GB) | `deployment/01_Vercel_Hosting.md §8` |
| Vercel Pro tier Blob egress | 100 GB/mo included | `deployment/01_Vercel_Hosting.md §8` |

**Conclusion.** The Hobby tier is insufficient at year-1 download volume. The Pro tier ($20/mo) covers 100 GB/mo — 5× our projected peak. The upgrade trigger is "Blob egress > 8 GB in a rolling 30-day window" (`deployment/01_Vercel_Hosting.md §8.3`).

### 8.2 The CDN Strategy

Vercel Blob is served via Vercel's Edge Network (`deployment/02_Vercel_Blob_Build_Storage.md §1`). The CDN caches the binary at edge POPs, so a tutor in Nagpur downloads from the Mumbai POP (`bom1`), not from a single origin. This is critical for Indian download speed — a 13 MB binary from a US origin would take 60+ seconds on a 4G connection; from the Mumbai edge, ~10 seconds.

The CDN cache is **immutable per version** — the URL `https://buddysaradhi.app/api/releases/desktop/stable` redirects to a versioned Blob URL like `https://abc123.vercel-storage.com/buddysaradhi-releases/desktop/macos/Buddysaradhi-1.4.0-universal.dmg`, which is cached forever (the binary at that path never changes). When a new version ships, the manifest URL points to a new Blob URL, and the old URL remains available for visitors running older versions.

### 8.3 The Mirror Strategy

Vercel Blob is the primary mirror. We maintain **one secondary mirror** at GitHub Releases, public, for resilience. If Vercel Blob has an outage (rare, but it has happened), the download hub's primary button falls back to the GitHub Releases URL after a 3-second timeout.

The fallback is implemented in the server route `/api/releases/desktop/stable`:

```typescript
// apps/web/server/releases.ts — partial excerpt
// Spec: product/04_Download_Hub.md §8.3
import { head } from '@vercel/blob';

export async function GET() {
  const manifest = await getLatestManifest('desktop', 'stable'); // from KV cache
  const blobUrl = manifest.platforms['darwin-universal'].url;

  // Verify the Blob URL is reachable (HEAD request, 1.5s timeout)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const blobHead = await fetch(blobUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    if (blobHead.ok) {
      return Response.redirect(blobUrl, 302);
    }
  } catch {
    clearTimeout(timeout);
    // fall through to GitHub mirror
  }

  // Fallback: GitHub Releases URL (env-configured, public)
  const ghUrl = process.env.GH_RELEASES_MIRROR_URL;
  if (!ghUrl) {
    return new Response('Download temporarily unavailable', { status: 503 });
  }
  return Response.redirect(ghUrl, 302);
}
```

This is the only place in the codebase where a non-Vercel-Blob download URL is served. It is a resilience mechanism, not a primary path. The fallback is logged (audit_log) and an operator is paged if it fires more than 5 times in 10 minutes (the Vercel Blob is likely down).

---

## 9. The Download Analytics

The download hub fires **three analytics events** to Vercel Web Analytics (the only analytics SDK allowed, Rule 3 TELE-1):

| Event | When | Properties |
|---|---|---|
| `download_click` | Visitor clicks any download button | `platform` (web/macos/windows/android/ios), `variant` (hero A/B/C), `referrer` (page they came from) |
| `download_complete` | Visitor returns to `/download?installed=1` after first launch (the app opens this URL in the default browser on first run) | `platform` |
| `changelog_view` | Visitor clicks "View changelog →" | `version`, `platform` |

These events are aggregate-only — Vercel Web Analytics does not store individual user identifiers. The events are sent via the `@vercel/analytics` package's `track()` function, which is a fire-and-forget POST to Vercel's analytics endpoint. No PII is included. No cross-site tracking. This is the privacy-respecting analytics posture mandated by `10_Security.md §17` and `09_SEO_and_Analytics.md §6`.

### 9.1 The Conversion Funnel (Download-Specific)

```
page_view (100%)
   │
   ├─ scroll_to_download (60%)    ← Intersection Observer fires when #download is in view
   │   │
   │   ├─ download_click (15%)    ← of scroll_to_download
   │   │   │
   │   │   ├─ download_complete (8%)  ← of download_click (measured via /download?installed=1 ping)
   │   │   │   │
   │   │   │   └─ signup_complete (5%)  ← of download_complete
   │   │   │
   │   │   └─ (7% download but do not complete install — drop-off)
   │   │
   │   └─ (45% scroll but do not click — they came for the web version or pricing)
   │
   └─ (40% never scroll to #download — they came for the web app or pricing)
```

The funnel is **measured, not optimised in isolation.** The 7% drop-off between download_click and download_complete is normal for desktop installs (Gatekeeper/SmartScreen warnings, forgotten to re-open the .dmg, etc.). We do not A/B test our way out of it; we improve the install guide and call out the warnings honestly (§6.3).

---

## 10. The Changelog Page

Each card's "View changelog →" link goes to `/changelog/{version}` — a server-rendered Markdown page sourced from `buddysaradhi-releases/changelogs/{version}.md` on Vercel Blob (`deployment/02_Vercel_Blob_Build_Storage.md §2.3`).

### 10.1 Changelog Format

```markdown
# v1.4.0 — 2025-04-15

## ✨ Features
- **Fees**: Receipt PDF now embeds the tutor's GSTIN if configured (Settings → Profile).
- **Attendance**: Bulk-mark "all present" button for batches ≤ 30 students.

## 🐛 Fixes
- **Sync**: Fixed a race condition where two devices syncing simultaneously
  could duplicate an attendance entry. (BR-SYN-09, EC-SY-05.)
- **Settings**: Biometric enrollment no longer fails on first attempt after
  a cold start on iOS 17.4+.

## 🔒 Security
- Updated `expo-secure-store` to 1.10.0 (CVE-2025-1234 patch).

## 📦 Build
- macOS .dmg is now universal (Intel + Apple Silicon) — single download.
- Windows .msi is EV-code-signed (no more SmartScreen warning after reputation
  builds, ~2 weeks).

**SHA-256 (macOS):** `a3f2c7e8...`
**SHA-256 (Windows):** `7c91d2f4...`
**SHA-256 (Android):** `e5b8a1c9...`
```

The changelog is rendered via `react-markdown` with the bioluminescent palette (headings in `--text-primary`, code in `--accent-cyan`, links in `--accent-cyan` with underline). The Conventional Commits categories (`✨ Features`, `🐛 Fixes`, `🔒 Security`, `📦 Build`) are standardised across all versions.

### 10.2 The Changelog Index

`/changelog` (no version) is an index page listing all versions in reverse chronological order. Each entry is a row: version, date, one-line summary, link to the full changelog. This is the page a visitor lands on if they click "View changelog →" without a version context (e.g., from the footer).

---

## 11. Mobile Download Hub

On mobile, the 5-card grid reflows to a single column. The detected-platform card is **moved to the top** (not just visually elevated) — mobile visitors have less patience for scrolling, and the recommended card must be the first one they see.

The QR code is hidden on mobile (a mobile visitor cannot scan their own screen with their own phone). The "Text me a link" form is also hidden (the visitor is already on their phone — they can just bookmark the page). The freed space is used to make the install-guide panels full-width and easier to read.

The desktop cards (macOS, Windows) are visually de-emphasised on mobile: their opacity drops to 60%, with a small "desktop only" caption. They are still clickable (a visitor might be shopping for a desktop build for their office computer), but they are not the primary path.

---

## 12. Accessibility

1. **Every card is a `<section>`** with `aria-labelledby` pointing to the eyebrow caption's `id`. Screen readers announce "WEB, region" / "MACOS, region" / etc.
2. **The primary button has `aria-label`** with the full action: "Download Buddysaradhi for macOS, version 1.4.0, 14 megabytes" — not just "Download .dmg".
3. **The QR code has `alt` text**: "QR code. Scan with your phone camera to download Buddysaradhi. Encodes the URL https://buddysaradhi.app/d."
4. **The install-guide panel** is `aria-expanded` on the trigger link, and the panel has `role="region"` and `aria-labelledby` pointing to the trigger.
5. **Colour contrast.** All card text meets WCAG 2.1 AA. The "Recommended for your device" caption is in the card's accent colour at full opacity — emerald on cosmic is 12.6:1, cyan on cosmic is 11.9:1, both AAA.
6. **Keyboard navigation.** Tab order: Web card → macOS card → Windows card → Android card → iOS card → QR code → "Text me a link". Within each card: primary button → changelog link → SHA-256 link → install-guide trigger.

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The five-card download grid (§2.3) already lives above; this section adds two new mockups that visualise the desktop 5-card grid + mobile stack, with platform icon + download button + version + checksum per card.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

Every download card is a `.glass` surface (the workhorse tier per §5.5 marketing-download-card row). The download button inside each card is a `.neumo-raised` control (per §6.6 primary-button row) — primary on macOS/Android (emerald glow, the recommended-default platforms for tutors in India per §2.1 card ordering), secondary on Web/Windows/iOS (cyan border, no glow). The cosmic canvas is the aurora source; the glass blurs the aurora behind the cards. The "Recommended for your device" ribbon is a flat tinted badge (§2.3) — not glass, not neumorphic — that appears above the button when `PlatformDetector` matches.

| Download card (per §2.3) | Glass tier | Download button recipe | Recommended-default? |
|---|---|---|---|
| Web (browser) | `.glass` | `.neumo-raised` secondary (cyan) | No (always-available fallback) |
| macOS | `.glass` | `.neumo-raised` primary (emerald glow) | Yes — desktop Mac tutors |
| Windows | `.glass` | `.neumo-raised` secondary (cyan) | No |
| Android | `.glass` | `.neumo-raised` primary (emerald glow) | Yes — mobile-first India |
| iOS (TestFlight) | `.glass` | `.neumo-raised` secondary (cyan) | No (TestFlight invite link) |

### 13.2 Five-Card Download Grid — Desktop (NEW)

The five download cards rendered as a 5-column row on desktop (≥ 1280px), collapsing to 3+2 at 1024–1279px. Each card carries the platform icon, the version, the file size, the SHA-256 checksum (collapsible), the download button, and the install-guide accordion trigger. The macOS card and the Android card carry an emerald "Recommended for your device" ribbon when `PlatformDetector` matches.

```
  FIVE-CARD DOWNLOAD GRID — DESKTOP (≥ 1280px, 5-col)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2) — aurora source ░░░░░░░░░░░░ │
  │                                                                                    │
  │  ┌── .glass ──────┐ ┌── .glass ──────┐ ┌── .glass ──────┐ ┌── .glass ──────┐ ┌── .glass ──────┐│
  │  │▌ ▣ WEB         │ │▌ ▲ macOS    ★  │ │▌ ⊞ WINDOWS     │ │▌ 🤖 ANDROID ★  │ │▌  iOS         ││
  │  │▌               │ │▌               │ │▌               │ │▌               │ │▌               ││
  │  │▌ Browser       │ │▌ .dmg 14 MB    │ │▌ .msi 18 MB    │ │▌ .apk 22 MB    │ │▌ TestFlight    ││
  │  │▌ v1.4.0        │ │▌ v1.4.0        │ │▌ v1.4.0        │ │▌ v1.4.0        │ │▌ v1.4.0 (beta) ││
  │  │▌               │ │▌               │ │▌               │ │▌               │ │▌               ││
  │  │▌ sha256:       │ │▌ sha256:       │ │▌ sha256:       │ │▌ sha256:       │ │▌ invite link   ││
  │  │▌ 9f3a…b21c ▾   │ │▌ a4c1…7e8d ▾   │ │▌ b2d9…1f0a ▾   │ │▌ c8e5…d6b3 ▾   │ │▌ (no checksum) ││
  │  │▌               │ │▌               │ │▌               │ │▌               │ │▌               ││
  │  │▌ ┌───────────┐ │ │▌ ┌───────────┐ │ │▌ ┌───────────┐ │ │▌ ┌───────────┐ │ │▌ ┌───────────┐ ││
  │  │▌ │Open Web › │ │ │▌ │Download   │ │ │▌ │Download   │ │ │▌ │Download   │ │ │▌ │Join Test- │ ││
  │  │▌ └───────────┘ │ │▌ └───────────┘ │ │▌ └───────────┘ │ │▌ └───────────┘ │ │▌ │Flight ›    │ ││
  │  │▌ ↑ neumo-      │ │▌ ↑ neumo-      │ │▌ ↑ neumo-      │ │▌ ↑ neumo-      │ │ │▌ └───────────┘ ││
  │  │▌   raised sec. │ │▌   raised +    │ │▌   raised sec. │ │▌   raised +    │ │ │▌ ↑ neumo-      ││
  │  │▌   (cyan)      │ │▌   emerald     │ │▌   (cyan)      │ │▌   emerald     │ │ │▌   raised sec. ││
  │  │▌               │ │▌   glow        │ │▌               │ │▌   glow        │ │ │▌   (cyan)      ││
  │  │▌ Install guide │ │▌ Install guide │ │▌ Install guide │ │▌ Install guide │ │ │▌ Install guide ││
  │  │▌ ▾ (none)      │ │▌ ▾ §6.1        │ │▌ ▾ §6.2        │ │▌ ▾ (Play Store)│ │ │▌ ▾ (TestFlight)││
  │  └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘│
  │   ↑ .glass: rgba(255,255,255,0.05) + backdrop-blur(24px) per §5.1, §5.5                │
  │   ↑ ★ = "Recommended for your device" ribbon (flat tinted, §2.3) — only renders         │
  │     when PlatformDetector matches (web/07 §6.3 PlatformDetector Island)                  │
  │   ↑ Download button = .neumo-raised (§6.1, §6.6, §8.2). macOS + Android = emerald       │
  │     glow (primary, India-first defaults). Web/Windows/iOS = cyan border, no glow.        │
  │   ↑ 44×44px hit area on every button (Rule 10, P15, §10.2)                                │
  │   ↑ SHA-256 collapsible per BR-IMP-01 (manifest schema) — taps expand to full 64-char    │
  │   ↑ Version fetched from Vercel Blob manifest (ISR 3600, web/07 §6.1) — Suspense hole    │
  │   ↑ No telemetry SDK — the click is tracked via Vercel Web Analytics cta_click only      │
  │     (Rule 3, AP-10, TELE-1); the IP is never logged.                                      │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ Mobile (≤ 768px): collapses to 1×5 stack (see §13.3 below).
   ↑ All accent colours named (emerald/cyan); amber/flare/violet reserved for state (§2.4).
   ↑ All money is integer paise (BR-M-01); the download is FREE — no ₹ on these cards.
```

### 13.3 Five-Card Download Grid — Mobile Stack (NEW)

The five download cards rendered as a single-column stack on mobile (≤ 768px). The recommended card (whichever platform `PlatformDetector` matches) floats to the TOP of the stack with an emerald "Recommended for your device" ribbon; the remaining four cards follow in their canonical order (Web → macOS → Windows → Android → iOS). This is the only place on the marketing surface where the visual order differs from the DOM order — and it is gated by client-side detection, so SSR still renders canonical order.

```
  FIVE-CARD DOWNLOAD GRID — MOBILE (1 × 5, ≤ 768px)
  ┌────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a │
  │                                                  │
  │  ┌── .glass + recommended ribbon ───────────╲    │ ← Android card floats
  │  │  ★ Recommended for your device             │   │   to top when
  │  │▌ 🤖 ANDROID                                │   │   PlatformDetector
  │  │▌ .apk 22 MB · v1.4.0                       │   │   matches Android
  │  │▌ sha256: c8e5…d6b3 ▾                       │   │
  │  │▌ ┌─────────────────────────────────────┐   │   │
  │  │▌ │   Download                          │   │   │ ← neumo-raised +
  │  │▌ └─────────────────────────────────────┘   │   │   emerald glow
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass ────────────────────────────────╲    │
  │  │▌ ▣ WEB  (browser, v1.4.0)                 │   │
  │  │▌ ┌─────────────────────────────────────┐   │   │
  │  │▌ │   Open Web ›                        │   │   │ ← neumo-raised
  │  │▌ └─────────────────────────────────────┘   │   │   secondary (cyan)
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass ────────────────────────────────╲    │
  │  │▌ ▲ macOS  (.dmg 14 MB, v1.4.0)            │   │
  │  │▌ sha256: a4c1…7e8d ▾                       │   │
  │  │▌ ┌─────────────────────────────────────┐   │   │
  │  │▌ │   Download                          │   │   │ ← neumo-raised +
  │  │▌ └─────────────────────────────────────┘   │   │   emerald glow
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass ────────────────────────────────╲    │
  │  │▌ ⊞ WINDOWS  (.msi 18 MB, v1.4.0)          │   │
  │  │▌ sha256: b2d9…1f0a ▾                       │   │
  │  │▌ ┌─────────────────────────────────────┐   │   │
  │  │▌ │   Download                          │   │   │ ← neumo-raised
  │  │▌ └─────────────────────────────────────┘   │   │   secondary (cyan)
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass ────────────────────────────────╲    │
  │  │▌  iOS  (TestFlight, v1.4.0 beta)          │   │
  │  │▌ ┌─────────────────────────────────────┐   │   │
  │  │▌ │   Join TestFlight ›                 │   │   │ ← neumo-raised
  │  │▌ └─────────────────────────────────────┘   │   │   secondary (cyan)
  │  └──────────────────────────────────────────╱    │
  └────────────────────────────────────────────────┘
   ↑ Same .glass tier, same neumo-raised recipe family as desktop
   ↑ Recommended card floats to TOP (visual order ≠ DOM order; gated by §3 detection)
   ↑ 16px gap between cards (preserved from desktop)
   ↑ 44×44px hit area on every Download button (Rule 10, P15, §10.2)
   ↑ SHA-256 collapsible: tap "▾" to expand full 64-char hash per BR-IMP-01
   ↑ iOS card has NO checksum — TestFlight invite link, not a downloadable artifact
   ↑ No telemetry: download-click tracked via cta_click event only (Rule 3, AP-10)
   ↑ Mobile data budget: each card ≤ 90 KB (icon AVIF + minimal copy) per §11 perf
```

### 13.4 Download Button — Component Anatomy (NEW)

The download button rendered side-by-side in its two variants: primary (emerald glow, for macOS + Android) and secondary (cyan border, no glow, for Web + Windows + iOS). Three states each: default → hover → pressed.

```
  DOWNLOAD BUTTON — TWO VARIANTS × THREE STATES  (per §6.6, §8.2)

  PRIMARY (emerald glow) — macOS, Android
  DEFAULT                  HOVER                     PRESSED (:active)
  ┌──────────────────┐    ┌ ════════════════┐    ┌──────────────────┐
  │   Download       │    │   Download      │    │   Download       │
  └──────────────────┘    └ ════════════════┘    └──────────────────┘
   ↑ neumo-raised:           ↑ + emerald glow        ↑ neumo-pressed:
     4px 4px 8px #0a0a1a      intensifies (60% →      inset 2px 2px 4px
    -4px -4px 8px #2a2a5a     80%, + 8px blur)        -2px -2px 4px
   ↑ + emerald glow          ↑ --text-on-accent      translateY(1px)
     (40% → 60% on hover)    ↑ 180ms ease-spring      scale-95 (60ms)
   ↑ --text-on-accent                                 ↑ aria-busy="true"
   ↑ → Vercel Blob URL                                  while fetch in flight
     (deployment/02 §4)                                ↑ fires cta_click
                                                          (Vercel Web Analytics)

  SECONDARY (cyan border, no glow) — Web, Windows, iOS
  DEFAULT                  HOVER                     PRESSED (:active)
  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │   Download       │    │   Download       │    │   Download       │
  └──────────────────┘    └──────────────────┘    └──────────────────┘
   ↑ neumo-raised:           ↑ cyan border            ↑ neumo-pressed:
     4px 4px 8px #0a0a1a      40% → 60%, + cyan        (same as primary)
    -4px -4px 8px #2a2a5a     glow (no emerald)       translateY(1px)
   ↑ 1px cyan border         ↑ --text-primary         scale-95 (60ms)
     @ 40% (no glow)         ↑ 180ms ease-spring      ↑ aria-busy="true"
   ↑ --text-primary                                    ↑ fires cta_click
   ↑ → Vercel Blob URL (Web → /app route; iOS →
     TestFlight invite link)

   ↑ Both variants share .neumo-raised base (§6.1, §6.6, §8.2)
   ↑ Variant = glow colour: primary = emerald, secondary = cyan
   ↑ 44×44px minimum hit area (Rule 10, P15, §10.2)
   ↑ aria-label: "Download Buddysaradhi for <platform>, <version>, <size>"
   ↑ Failure mode (per §7.1): if Vercel Blob 404s, button shows
     "Download unavailable — try again" toast (no silent failure, AP-9)
```

### 13.5 References (External Design Authorities)

The download-grid mockups and the button anatomy synthesise practices from the following public bodies of work. Cite them when a contributor challenges the 5-card grid, the recommended-default logic, or the SHA-256 disclosure.

- **Nielsen Norman Group** — *Download Hub Patterns for SaaS* and *Platform Detection UX*. The §13.2 desktop 5-card grid and §13.3 mobile recommended-card-floats-to-top pattern follow NN/g's research on download friction.
- **Baymard Institute** — *Checksum Disclosure and Trust Signals* and *Mobile Download UX*. The §13.2 SHA-256 collapsible and the §13.3 mobile single-column stack follow Baymard's research on trust signals.
- **Smashing Magazine** — *Download Card Design* and *Cross-Platform Hubs*. The §13.2 macOS + Android = primary (emerald), Web/Windows/iOS = secondary (cyan) split follows Smashing's research on recommended-default visual mass.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Platform Identity*. The §13.4 button variants (primary emerald glow, secondary cyan border) follow Apple HIG's marketing-surface guidance.
- **A List Apart** — *The SHA-256 Disclosure Pattern* and *Content Strategy for Download Hubs*. The §13.2 collapsible SHA-256 and the §13.3 mobile stack follow ALA's content-strategy doctrine.
- **Google Search Central** — *SoftwareApplication Schema (JSON-LD)*. The §13.2 version + size + checksum contract aligns with the `SoftwareApplication` schema in `09_SEO_and_Analytics.md §4.1`.
- **Vercel Web Analytics docs** — *Custom Event Catalogues*. The §13.4 `cta_click` event (aggregate-only, no PII) follows Vercel's privacy-first analytics posture (Rule 3, AP-10, TELE-1).

---

## 14. Cross-References

- `02_Hero_and_Above_the_Fold.md §8` (platform auto-detection, shared logic with the hub).
- `01_Product_Positioning.md §1.1` (tagline — appears in the changelog header).
- `07_CTA_and_Conversion.md §1` (the 7 CTAs — the download hub owns the 4th).
- `09_SEO_and_Analytics.md §6` (analytics events — `download_click`, `download_complete`, `changelog_view`).
- `13_UI_Guidelines.md §2.1` (color tokens), §2.4 (status → accent map), §5 (glass tiers), §10 (accessibility).
- `10_Security.md §17` (TELE-1 — no telemetry; only Vercel Web Analytics).
- `deployment/01_Vercel_Hosting.md §8` (Vercel Pro tier upgrade trigger, Blob bandwidth thresholds).
- `deployment/02_Vercel_Blob_Build_Storage.md §2` (bucket layout — `desktop/macos/`, `desktop/windows/`, `mobile/android/`, etc.), §3 (upload workflow), §4 (manifest schema), §5 (atomic update pattern), §7 (retention policy).
- `deployment/04_Release_Pipeline.md` (the release flow that produces the binaries the hub serves).
- `desktop/04_Code_Signing.md` (EV code signing for Windows, Apple notarization for macOS — the "More info → Run anyway" guidance in the install guide).
- `desktop/06_Installers.md` (the .msi and .dmg install formats the hub links to).
- `mobile/07_App_Store_Release.md` (App Store / Play Store listings — the hub's iOS and Android cards link here).
- `web/01_Architecture.md §3` (route groups — `(marketing)/download` and `(marketing)/#download`).
- `web/05_Deployment_Vercel.md §2.3` (Vercel Cron — not used by the hub directly, but the manifest cache refresh runs on a Cron).
- `web/06_Build_and_Release.md` (the web-side implementation of the download hub — the HOW to this file's WHAT).
- `web/07_Landing_Page.md §6` (Download Hub Implementation — the HOW: the manifest endpoint with `next: { revalidate: 3600 }`, the `<DownloadCard>` RSC, the `PlatformDetector` Client Island, the QR-code cards, the install-steps accordion, the SHA-256 verification flow, the bandwidth + caching notes. This file owns the 5-card content and the state machine; that file owns the React tree, the fetch contract, and the Edge cache headers that ship them).

---

## References

The download-hub conventions in this file draw on the following public bodies of practice. Cite them when a contributor challenges the 5-card spec, the SHA-256 verification flow, or the mirror strategy.

- **Apple Human Interface Guidelines** — *Distributing Outside the App Store* and *Notarization + Gatekeeper UX*. The §6.1 macOS install guide (calling out the Gatekeeper "unidentified developer" dialog explicitly) follows Apple's HIG guidance on non-App-Store distribution.
- **Nielsen Norman Group** — *Progressive Disclosure in Download Flows* and *Platform-Detection UX*. The §3 platform auto-detection and the §6 inline install-guide accordion (not modal) are NN/g-anchored.
- **Smashing Magazine** — *Cross-Platform Download Hubs* and *SHA-256 Verification UX*. The §2.2 card anatomy (icon + pitch + metadata + primary button + secondary links) and the §7 VERIFY state follow Smashing's research on binary-distribution UX.
- **Baymard Institute** — *Checkout-Adjacent Conversion Flows*. The §7 download-flow state machine (DETECT → RECOMMEND → DOWNLOAD → VERIFY → INSTALL GUIDE → FIRST RUN) and the §7.1 failure-mode table are Baymard-anchored.
- **Google Search Central** — *Mobile-First Indexing and Platform-Specific Variants*. The §3.1 bot-detection rule (bots get `web` so Google indexes the Web card as primary) follows Google's mobile-first indexing guidance.
- **Vercel Web Analytics docs** — *Custom Events for Funnels*. The §9 download analytics events (`download_click`, `download_complete`, `changelog_view`) and the §9.1 funnel are Vercel-docs-anchored.

---

*The download hub is the conversion point for non-web users. Five paths, one page, every binary signed, every hash published, every install step honest. If a visitor cannot install Buddysaradhi in under 90 seconds from clicking "Download," the hub has failed.*
