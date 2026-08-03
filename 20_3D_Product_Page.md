# 20 — 3D Product Page

> The commercial landing page (`/`) gains a **3D hero scene**: a floating neumorphic-glass tuition desk rendered in WebGL, with the bioluminescent accents from `13_UI_Guidelines.md` acting as the light sources. This is a **Web-phase deliverable** (`16_Platform_Delivery_Sequence.md` W6): it ships on web first, is verified at ≥ 50 fps on a mid-tier laptop, and degrades to a static poster on no-WebGL devices. Mobile and desktop inherit the scene only after their respective Production Gates unlock — mobile via `expo-three` (WebGL on RN), desktop via the same R3F scene running in the Tauri webview.

---

## 0. Package Reality Check (do not hallucinate)

The user named two npm packages. One exists; one does not. This section is the audit so the implementing agent does not waste a cycle.

| Package | npm status | Decision |
|---|---|---|
| `boneyard-js` | **EXISTS** — `boneyard-js@1.8.2`, "Pixel-perfect skeleton loading screens. Wrap your component in `<Skeleton>` and boneyard snapshots the real DOM layout — no manual descriptors, no configuration." | **Use it.** It is the skeleton loader for the 3D scene's asset-load phase (§4). Perfect fit: it snapshots the *real* hero layout and shows a pixel-perfect skeleton until the WebGL canvas hydrates, so there is no layout shift. |
| `3d-js` | **DOES NOT EXIST** on the npm registry (`npm view 3d-js` → 404). | **Do not install.** Use the de-facto React 3D stack instead (§1.1). Document this decision in the PR so a future agent does not re-attempt `npm i 3d-js`. |

### 1.1 The Verified 3D Stack

| Package | Verified version | Role |
|---|---|---|
| `three` | `0.185.0` | The WebGL engine |
| `@react-three/fiber` | `9.6.1` | React renderer for three.js (declarative scene graph) |
| `@react-three/drei` | `10.7.7` | Helpers: `Environment`, `Float`, `ContactShadows`, `MeshTransmissionMaterial` (the glass material), `Html` (DOM-in-3D) |
| `boneyard-js` | `1.8.2` | Pixel-perfect skeleton during asset load |
| `maath` | (drei peer) | Easing + random helpers for the float animation |

All five resolve cleanly on the current registry. No fabricated packages.

---

## 1. The Scene — What the Tutor Sees

A single hero canvas above the fold on `/`. Concept: **"The desk at the centre of a tuition business."** A neumorphic-glass panel (the "ledger card") floats centred, tilted ~15° toward the viewer. Bioluminescent accent lights (emerald, cyan, amber) orbit it slowly, casting coloured rim-light. The card shows a live KPI — "₹0 owed · 0 students · 1 ledger" — in the product's typography. Behind it, the cosmic gradient (`--bg-cosmic → --bg-midnight → --bg-abyss`) with a faint particle field (200 points, parallax on pointer move). Below the fold, the existing marketing sections (`product/02`–`09`) render normally.

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                      /  —  3D HERO (above the fold)                     │
 │                                                                         │
 │                                                                         │
 │            ✦  (cyan accent light, orbiting)                             │
 │                                                                         │
 │              ╔═════════════════════════════════╗                        │
 │              ║   neumorphic-glass ledger card  ║   ← floats, tilted 15° │
 │              ║   ┌─────────────────────────┐   ║                        │
 │              ║   │  ₹0 owed · 0 students   │   ║   (MeshTransmissionMat) │
 │              ║   │  1 ledger · 5 screens    │   ║                        │
 │              ║   └─────────────────────────┘   ║                        │
 │              ╚═════════════════════════════════╝                        │
 │                      ↕ contact shadow                                    │
 │                                                                         │
 │           ✦  (amber accent light, orbiting, opposite phase)             │
 │                                                                         │
 │        ·  ·   ·   ·  (particle field, parallax)  ·   ·   ·              │
 │                                                                         │
 │   ────────────── scroll for the product story ──────────────            │
 └─────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Design-Language Continuity (Neumorphism + Glassmorphism)

This is not a separate "3D mode." It is the existing `13_UI_Guidelines.md` system expressed in three dimensions:

- **Glassmorphism background →** the cosmic gradient lives in the scene's `<color>` background; the floating card uses `MeshTransmissionMaterial` (drei) — real refraction, the 3D equivalent of `--surface-glass` `rgba(255,255,255,0.05)` + `backdrop-blur(24px)`.
- **Neumorphism on the card →** the card's edge is a soft dual-light extrusion: a `--bg-neumo-light`-tinted key light from upper-left, a `--bg-abyss`-tinted ambient occlusion from below. `ContactShadows` (drei) grounds it. This is the 3D translation of the `.neumo-raised` box-shadow (`13_UI_Guidelines.md` §4).
- **Bioluminescent accents →** three point lights, colours `#00FF9D`, `#00F0FF`, `#FFB300`, intensity tuned so accents never exceed ~8% of the frame (the existing "accents never exceed 8%" rule, now in 3D).
- **No indigo/blue accents** (`AGENTS.md` Rule 5) — the only blue-ish light is the cyan `#00F0FF`, which is a focus/selection accent, not a primary. Indigo is the canvas (the cosmic background), never a light source.
- **No pure black / no pure white** (`13_UI_Guidelines.md` §1.3) — the darkest material is `#0a0a1a` (Abyss); the brightest text texture is `rgba(255,255,255,0.95)`.

---

## 2. Component Architecture (Web)

```
   apps/web/src/components/hero/
   ├── Hero3D.tsx              ← the <Canvas> + scene root (client component)
   ├── scene/
   │   ├── LedgerCard.tsx      ← the floating neumorphic-glass card (R3F mesh)
   │   ├── AccentLights.tsx    ← the 3 orbiting bioluminescent point lights
   │   ├── ParticleField.tsx   ← 200-point parallax field (instanced)
   │   └── ContactShadow.tsx   ← drei <ContactShadows> grounding the card
   ├── materials/
   │   ├── glassMaterial.ts    ← MeshTransmissionMaterial config (the glass)
   │   └── neumoEdgeMaterial.ts← dual-light edge shader (the neumorphic rim)
   ├── hooks/
   │   ├── useWebGLAvailable.ts← feature-detect; returns false → poster fallback
   │   ├── useReducedMotion.ts ← prefers-reduced-motion → freeze orbit, static
   │   └── useHeroKPI.ts       ← the live "₹0 owed · 0 students" numbers
   ├── Skeleton.tsx            ← <boneyard-js> <Skeleton> wrapping the canvas
   └── Poster.tsx              ← the static PNG fallback (no-WebGL / reduced-data)
```

### 2.1 The Load Sequence (boneyard-js is the hero here)

```
   / loads
     │
     ├─ <Hero3D/> renders <Skeleton> (boneyard-js) immediately
     │     boneyard snapshots the real hero DOM layout → pixel-perfect skeleton
     │     (no manual descriptors; it reads the rendered box tree)
     │
     ├─ <Canvas> mounts (R3F); three.js + drei hydrate
     │     ├─ environment HDRI loads (drei <Environment preset="city">)
     │     ├─ glass material compiles (MeshTransmissionMaterial shader)
     │     └─ particle field instanced
     │
     ├─ on first frame rendered (onCreated) → swap <Skeleton> out, <Canvas> in
     │     (boneyard's snapshot guarantees zero layout shift on swap)
     │
     └─ if WebGL unavailable (useWebGLAvailable === false) → render <Poster/>
           (a pre-rendered PNG of the same scene, served via next/image)
```

The key property: **the user never sees a blank box or a layout jump.** boneyard-js snapshots the *final* layout (the card + KPI text boxes) and shows a glass-tinted skeleton that occupies the exact pixels; the WebGL canvas swaps in underneath without shifting a pixel. This is why `boneyard-js` was the right pick over a hand-rolled skeleton.

---

## 3. Performance Budget (the W6 bar)

| Metric | Target | How |
|---|---|---|
| Frame rate (mid-tier laptop, e.g. M1 Air / Ryzen 5) | **≥ 50 fps** | instanced particles (1 draw call), transmission material at 1 sample, `<AdaptiveDpr>` caps DPR at 1.5 |
| Frame rate (low-end / integrated GPU) | ≥ 30 fps | `<AdaptiveDpr>` drops to 0.75; particle count → 80; transmission samples → 1 |
| First-contentful paint | < 1.2 s | boneyard skeleton is HTML/CSS, paints before JS; poster path < 200 KB |
| Time-to-interactive (canvas hydrate) | < 3 s | three.js is dynamically imported (`next/dynamic`, ssr:false); HDRI is `<Environment>` lazy |
| No-WebGL fallback | instant | `<Poster/>` is a static image, no JS |
| Lighthouse (Performance) on `/` | **≥ 90** | the 3D scene is lazy + DPR-capped; below-the-fold marketing is RSC, zero client JS |
| Bundle cost of the 3D stack | < 180 KB gzipped (three + fiber + drei tree-shaken) | dynamic import isolates it from the main chunk; users who never scroll to hero (rare) don't pay |

### 3.1 The Degradation Ladder

```
   device capability                  what renders
   ─────────────────                  ────────────
   WebGL2 + discrete GPU              full scene, 60 fps, transmission @ 4 samples
   WebGL2 + integrated GPU            full scene, ≥30 fps, transmission @ 1 sample, DPR 0.75–1.5
   WebGL1 only                        poster (transmission too costly); particle field only
   no WebGL                           poster (static PNG)
   prefers-reduced-motion             full scene but FROZEN (no orbit, no float) — accessibility
   Save-Data header                   poster (skip the 3D bundle entirely)
```

The ladder is checked in `useWebGLAvailable` + `useReducedMotion` + a `navigator.connection.saveData` read. No user toggles — it's automatic. The tutor on a ₹12,000 Android phone with 2 bars of 4G (the persona from `product/AGENTS.md`) gets the poster, fast.

---

## 4. Accessibility (the 3D scene is decorative, not a barrier)

- **The hero conveys no information that isn't also in the DOM.** The KPI numbers ("₹0 owed · 0 students") are real HTML text overlaid via drei `<Html>` (or rendered as a sibling DOM node on top of the canvas), so a screen reader reads them regardless of WebGL. The 3D card is decoration.
- **`prefers-reduced-motion`** freezes the orbit + float; the card sits still. No parallax.
- **No flashing.** The accent lights pulse at 0.5 Hz max (well under the 3 Hz photosensitivity threshold).
- **Keyboard.** The hero has no keyboard-operable 3D controls (it's not a game). The CTA below it ("Start free →") is the keyboard target.
- **`aria-hidden="true"`** on the `<canvas>` itself (it's decorative); the KPI text node is the accessible surface.

---

## 5. Mobile (P2 — after Mobile Production Gate work begins, not before)

`16_Platform_Delivery_Sequence.md` forbids touching `apps/mobile/` until the Web Production Gate clears. The mobile 3D scene is specified here for completeness; it is built in the Mobile phase.

### 5.1 Mobile Stack

R3F is web-only. On React Native, the equivalent is **`expo-three`** (three.js over Expo GLView) for a true 3D scene, or **`@shopify/react-native-skia`** for a 2.5D parallax fallback on low-end devices.

| Tier | Stack | Renders |
|---|---|---|
| High-end (iPhone 12+, Pixel 6+) | `expo-three` + the same scene graph as web (ported) | full 3D, capped 30 fps, transmission @ 1 sample |
| Mid/low Android | Skia — a 2.5D parallax of the card + accent glows (no real refraction) | the "feel" of 3D at 60 fps, cheap |
| Fallback | static poster (the same PNG as web) | instant |

### 5.2 Mobile Constraints

- Battery: the scene renders only when the hero tab is visible (`useIsFocused`); pauses on background.
- Heat: capped 30 fps even on high-end (a 60 fps 3D scene on a phone is a hand-warmer, not a marketing tool).
- Data: the 3D bundle is downloaded on first launch only, after the user has signed up (not on the cold app-open — that's the poster).

---

## 6. Desktop (P3 — after Desktop Production Gate work begins)

Desktop runs the web app as a Tauri static export, so the **same R3F scene** renders in the Tauri webview with zero porting. The only desktop-specific tweaks:

- Higher DPR cap (desktop monitors are 1x–2x): `<AdaptiveDpr>` cap raised to 2.
- The scene can be richer (desktop users have GPUs): transmission @ 4 samples, particle count 300.
- The hero is the same component (`apps/web/src/components/hero/`), imported by the desktop shell. **No desktop-specific 3D code.** This is the payoff of serial delivery: by the time desktop begins, the web hero is a frozen, tested contract (`16_Platform_Delivery_Sequence.md` G2).

---

## 7. Neumorphism + Glassmorphism — The 3D Material Spec

This is the explicit mapping the user asked for ("Ensure Neumorphism on the components and Glassmorphism backgrounds"), expressed in three.js materials so the implementing agent has no ambiguity.

### 7.1 The Card — Neumorphic Glass (both at once)

```tsx
// scene/LedgerCard.tsx — the material recipe (pseudocode, R3F declarative)
<mesh rotation={[-0.26, 0.2, 0]} position={[0, 0, 0]}>
  <boxGeometry args={[3.2, 2, 0.12]} />
  {/* Glassmorphism: real refraction, the 3D backdrop-blur */}
  <MeshTransmissionMaterial
    transmission={1}              // fully refractive
    thickness={0.4}               // how deep the refraction samples
    roughness={0.06}              // smooth, like the glass panels
    ior={1.25}                    // subtle bend
    chromaticAberration={0.02}    // faint colour split at edges (bioluminescent hint)
    backside={false}
    samples={isLowEnd ? 1 : 4}    // the degradation lever
    resolution={256}
    color="#1a1a3a"               // --bg-neumo-light tint (so it's not invisible glass)
  />
  {/* Neumorphism: the soft dual-light edge */}
  <Edges scale={1.01} threshold={15}>
    <meshBasicMaterial color="#00F0FF" transparent opacity={0.25} />
  </Edges>
</mesh>
```

### 7.2 The Lighting — Bioluminescent Neumorphic Dual-Light

```tsx
// scene/AccentLights.tsx — the neumorphic light recipe
// Neumorphism on 2D = one light from upper-left (key) + one dark shadow below.
// In 3D = a warm key light + a cool fill, plus the bioluminescent accent rims.
<ambientLight intensity={0.15} color="#0a0a1a" />           {/* Abyss ambient */}
<directionalLight position={[3, 5, 4]} intensity={0.6}      {/* key, upper-left */}
                  color="#1a1a3a" />                        {/* neumo-light tint */}
<directionalLight position={[-3, -2, 2]} intensity={0.2}    {/* fill, cool */}
                  color="#0a0a1a" />                        {/* abyss tint */}
{/* the bioluminescent orbiters (accents, <8% of frame energy) */}
<Float speed={1.2} rotationIntensity={0.4} floatIntensity={1.2}>
  <pointLight position={[2, 1, 2]} intensity={8} color="#00FF9D" distance={6} />  {/* emerald */}
  <pointLight position={[-2, 1, 2]} intensity={6} color="#00F0FF" distance={6} /> {/* cyan */}
  <pointLight position={[0, -1.5, 2]} intensity={4} color="#FFB300" distance={6}/>{/* amber */}
</Float>
<ContactShadows position={[0, -1.3, 0]} opacity={0.4} blur={2.5} far={4} />
```

### 7.3 The Background — Cosmic Glass

```tsx
// Hero3D.tsx — the background recipe
<Canvas gl={{ antialias: true, powerPreference: "high-performance" }} dpr={[0.75, cap]}>
  <color attach="background" args={["#0f0c29"]} />          {/* --bg-cosmic floor */}
  <fog attach="fog" args={["#0a0a1a", 6, 14]} />            {/* Abyss fog → depth */}
  {/* particle field = the "aurora" grain on the cosmic canvas */}
  <ParticleField count={isLowEnd ? 80 : 200} />
  ...scene...
</Canvas>
// The CSS behind the canvas is the cosmic gradient, so the canvas (transparent where
// there's no geometry) blends with --bg-cosmic → --bg-midnight → --bg-abyss.
```

---

## 8. What This Is NOT (Anti-Patterns)

| Temptation | Why forbidden |
|---|---|
| A 3D scene that's interactive (drag/zoom the card) | The hero is marketing, not a toy; interaction invites a fiddly UX that hurts conversion. Static beauty. |
| Loading the 3D bundle on every route | It's `/` only. Dynamically imported; other routes never fetch three.js. |
| A 60 fps target on mobile | Phones throttle + heat; 30 fps cap is the responsible choice. |
| Indigo/blue accent lights | `AGENTS.md` Rule 5. Cyan `#00F0FF` is a focus accent, permitted; indigo/violet lights are not. |
| Pure-black materials | `13_UI_Guidelines.md` §1.3. Darkest is `#0a0a1a`. |
| Skipping the poster fallback | A tutor on a 2G connection or a 5-year-old Android gets a blank box without it. The poster is the contract with that tutor. |
| Building the mobile 3D scene during the Web phase | `16_Platform_Delivery_Sequence.md` §7. Mobile is locked until the Web Gate clears. |

---

## 9. Implementation Order (within Web phase, `16_Platform_Delivery_Sequence.md` §10.1 step 6)

```
   3D PRODUCT PAGE BUILD-OUT (part of P1: WEB IN-FLIGHT):

   1. npm i three @react-three/fiber @react-three/drei boneyard-js maath
        (do NOT attempt `3d-js` — it 404s; see §0)
   2. apps/web/src/components/hero/ skeleton (§2) — Canvas + Poster + Skeleton
   3. LedgerCard + AccentLights + ParticleField + ContactShadow (§7 materials)
   4. useWebGLAvailable + useReducedMotion + useHeroKPI hooks; degradation ladder (§3.1)
   5. boneyard-js <Skeleton> wrapping the canvas; verify zero layout shift on swap
   6. Performance: AdaptiveDpr, instanced particles, dynamic import; hit ≥50 fps mid-tier
   7. Accessibility: aria-hidden canvas, KPI as DOM text, reduced-motion frozen (§4)
   8. Lighthouse ≥ 90 on / (W5); the 3D bundle isolated from main chunk
   9. Agent Browser verify: hero renders, skeleton→canvas swap clean, poster on no-WebGL
   ─── W6 of the Web Production Gate clears ───
```

---

## 10. Cross-References

- `16_Platform_Delivery_Sequence.md` W6 — this is a Web-gate deliverable; §7 forbids mobile 3D during Web phase.
- `13_UI_Guidelines.md` §2.1 (tokens) + §4 (neumorphic classes) — the materials in §7 consume these exact tokens.
- `product/02_Hero_and_Above_the_Fold.md` — the copy + KPI text the 3D card displays; the 3D scene is the visual, the product spec is the words.
- `product/03_Features_Showcase.md` — below-the-fold sections (unchanged; the 3D hero sits above them).
- `17_API_Gateway_System.md` — the KPI numbers on the card are fetched via the SDK (no hardcoded fetch).
- `19_Concurrency_and_Testing.md` — the 3D scene has no server concurrency, but its load budget is part of W5 Lighthouse.

---

## 11. ASCII Mockup Suite (§20 Compliance)

### 11.1 The Hero Frame (annotated)

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  /  —  3D HERO  (above the fold)                                        │
 │                                                                         │
 │           ◆ emerald light #00FF9D (orbit, 1.2 Hz)                       │
 │              ╲                                                          │
 │               ╲     ╔════════════════════════╗                          │
 │                ╲    ║  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ║  ← MeshTransmission     │
 │                 ╲   ║  ▓ ₹0 owed · 0 students ▓ ║     (glass, refractive)│
 │      cyan #00F0FF◀──║  ▓ 1 ledger · 5 screens ▓ ║                        │
 │                     ║  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ║  ← Edges: cyan 0.25 op  │
 │                     ╚════════════════════════╝     (neumorphic rim)     │
 │                              ▓▓▓▓▓                                    │
 │                          contact shadow                                │
 │                                  ◆ amber #FFB300 (orbit, opp. phase)    │
 │   ·  ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·            │
 │                        particle field (200, parallax)                   │
 │                                                                         │
 │   ┌─────────────────────────────────────────────────────────────────┐  │
 │   │  Buddysaradhi — five screens, seven engines, one ledger.        │  │
 │   │  [ Start free → ]   (the keyboard target; canvas is aria-hidden) │  │
 │   └─────────────────────────────────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────────────────────┘
   tokens: --bg-cosmic #0f0c29 · --accent-emerald #00FF9D · --accent-cyan #00F0FF
           --accent-amber #FFB300 · text rgba(255,255,255,0.95)  (13_UI_Guidelines §2.1)
```

### 11.2 The Load Sequence (boneyard-js → canvas swap)

```
   t=0ms     / loads. <Hero3D/> renders <Skeleton> (boneyard-js).
             boneyard snapshots the real hero DOM box tree → pixel-perfect
             glass-tinted skeleton occupies the exact card + KPI pixels.
             ┌─────────────────────────────────────┐
             │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │  ← skeleton (no layout shift)
             │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
             └─────────────────────────────────────┘

   t=200ms   <Canvas> mounts (ssr:false, dynamic). three + drei hydrate.
             environment HDRI + transmission shader compile.

   t=~1.8s   first frame rendered → onCreated fires.
             <Skeleton> fades out (120ms), <Canvas> fades in (120ms).
             boneyard's snapshot guarantee: ZERO pixel shift on swap.
             ┌─────────────────────────────────────┐
             │  ╔═══════════════════════════════╗  │  ← live WebGL canvas
             │  ║ ₹0 owed · 0 students · 1 ledger║  │
             │  ╚═══════════════════════════════╝  │
             └─────────────────────────────────────┘

   no-WebGL  useWebGLAvailable === false → <Poster/> (static PNG, same scene)
             ┌─────────────────────────────────────┐
             │  [pre-rendered PNG of the hero]     │  ← instant, no JS
             └─────────────────────────────────────┘
```

### 11.3 The Degradation Ladder (decision tree)

```
                 ┌─ navigator.connection.saveData? ────────┐
                 │                                         │
                yes                                       no
                 │                                         │
                 ▼                                         ▼
            <Poster/>                        ┌─ WebGL2 available? ┐
                                              │                    │
                                             yes                   no
                                              │                    │
                                              ▼                    ▼
                                   ┌─ prefers-reduced-motion? ┐   <Poster/>
                                     │                          │
                                    yes                        no
                                     │                          │
                                     ▼                          ▼
                          full scene, FROZEN         full scene, orbit + float
                          (static beauty)            DPR cap by GPU tier:
                                                     discrete → [1, 2]
                                                     integrated → [0.75, 1.5]
```
