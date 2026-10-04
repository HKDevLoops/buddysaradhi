# 20 — 3D Product Page

> The commercial landing page (`/`) gains a **3D hero scene**: a floating
> neumorphic-glass tuition desk rendered in WebGL, with the bioluminescent
> accents from `13_UI_Guidelines.md` acting as the light sources. This is a
> **Web-phase deliverable** (`16_Platform_Delivery_Sequence.md` W6): it ships on
> web first, is verified at ≥ 50 fps on a mid-tier laptop, and degrades to a
> static poster on no-WebGL devices. Mobile and desktop inherit the scene only
> after their respective Production Gates unlock — mobile via `expo-three`
> (WebGL on RN), desktop via the same R3F scene running in the Tauri webview.

---

## 0. Package Reality Check (do not hallucinate)

The user named two npm packages. One exists; one does not. This section is the
audit so the implementing agent does not waste a cycle.

| Package       | npm status                                                                                                                                                                                            | Decision                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boneyard-js` | **EXISTS** — `boneyard-js@1.8.2`, "Pixel-perfect skeleton loading screens. Wrap your component in `<Skeleton>` and boneyard snapshots the real DOM layout — no manual descriptors, no configuration." | **DROPPED (amended 2026-10-04).** The Poster veil (§2.2) covers the same load with zero deps: the canvas mounts immediately and the pixel-identical Poster overlays it until the first frame, so there is no layout shift to snapshot. One fewer dependency, one fewer hydration owner. Kept here so a future agent does not re-propose it. |
| `3d-js`       | **DOES NOT EXIST** on the npm registry (`npm view 3d-js` → 404).                                                                                                                                      | **Do not install.** Use the de-facto React 3D stack instead (§1.1). Document this decision in the PR so a future agent does not re-attempt `npm i 3d-js`.                                                                         |

### 1.1 The Verified 3D Stack

| Package              | Verified version         | Role                                                                                                    |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `three`              | `0.182.0` (spec `0.185`) | The WebGL engine                                                                                        |
| `@react-three/fiber` | `9.8.0` (spec `9.6`)     | React renderer for three.js (declarative scene graph)                                                   |
| `@react-three/drei`  | `10.7.8` (spec `10.7`)   | Helpers: `ScrollControls`, `Float`, `ContactShadows`, `MeshTransmissionMaterial`, `Html`, `AdaptiveDpr` |
| `boneyard-js`        | DROPPED (see §0)         | Replaced by the Poster veil (§2.2) — zero-dep discipline                                                |
| `maath`              | DROPPED                  | Easing is `THREE.MathUtils.damp` (already in the bundle); no new 3D deps per FM-09                       |

All three resolve. Actual pins at `0.182.0 / 9.8.0 / 10.7.8` per
`apps/product-page/package.json` (dedupe single React 19.2). No new 3D deps:
no `maath`, no `boneyard-js`, no `anime` — damp comes from `THREE.MathUtils`,
scrub from `gsap` (already present).

### 1.2 Penguin Living — Isometric Stage (Reference: penguin.music)

Penguin teaches **alive at load, no scroll required**: fullscreen `WebGL`
isometric stage + idle `Float 1.2` + vinyl ripples on tap. Buddysaradhi maps it
as: `Canvas fixed inset-0 h-[100dvh]` always visible, `LedgerCard` + seeker idle
at `y=0` stage `Float 1.2`, `Poster` fallback via pop-out. Scroll hint
`↓ scroll or click pin`.

---

## 1. The Scene — What the Tutor Sees

A single hero canvas above the fold on `/`. Concept: **"The desk at the centre
of a tuition business."** A neumorphic-glass panel (the "ledger card") floats
centred, tilted ~15° toward the viewer. Bioluminescent accent lights (emerald,
cyan, amber) orbit it slowly, casting coloured rim-light. The card shows a live
KPI — "₹0 owed · 0 students · 1 ledger" — in the product's typography. Behind
it, the cosmic gradient (`--bg-cosmic → --bg-midnight → --bg-abyss`) with a
faint particle field (200 points, parallax on pointer move). Below the fold, the
existing marketing sections (`product/02`–`09`) render normally.

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

This is not a separate "3D mode." It is the existing `13_UI_Guidelines.md`
system expressed in three dimensions:

- **Glassmorphism background →** the cosmic gradient lives in the scene's
  `<color>` background; the floating card uses `MeshTransmissionMaterial` (drei)
  — real refraction, the 3D equivalent of `--surface-glass`
  `rgba(255,255,255,0.05)` + `backdrop-blur(24px)`.
- **Neumorphism on the card →** the card's edge is a soft dual-light extrusion:
  a `--bg-neumo-light`-tinted key light from upper-left, a `--bg-abyss`-tinted
  ambient occlusion from below. `ContactShadows` (drei) grounds it. This is the
  3D translation of the `.neumo-raised` box-shadow (`13_UI_Guidelines.md` §4).
- **Bioluminescent accents →** three point lights, colours `#00FF9D`, `#00F0FF`,
  `#FFB300`, intensity tuned so accents never exceed ~8% of the frame (the
  existing "accents never exceed 8%" rule, now in 3D).
- **No indigo/blue accents** (`AGENTS.md` Rule 5) — the only blue-ish light is
  the cyan `#00F0FF`, which is a focus/selection accent, not a primary. Indigo
  is the canvas (the cosmic background), never a light source.
- **No pure black / no pure white** (`13_UI_Guidelines.md` §1.3) — the darkest
  material is `#0a0a1a` (Abyss); the brightest text texture is
  `rgba(255,255,255,0.95)`.

---

## 2. Component Architecture (Web)

```
    apps/product-page/src/components/product-3d/
    ├── ProductHero.tsx           ← the sticky stage + GSAP scrub proxy (client component)
    ├── ProductScene.tsx          ← the <Canvas> + scene root (client, ssr:false)
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
    ├── scene-tiers.ts            ← the pure tier map (DPR/samples/stage/FOV/beat ids)
    ├── Poster.tsx                ← the static fallback AND the loading veil (§2.2)
    └── (no Skeleton.tsx — boneyard-js dropped, §0; the veil is the pattern)
```

### 2.1 The Load Sequence + Zacamil Pins (Reference: coloniazacamil.com)

Zacamil teaches **story as spatial pins, not linear tunnel**: 25 pins + `flyTo`
camera `lerp` + `Raycaster` + CMS copy (`Discover`, `swipe/drag/pinch`).
Buddysaradhi maps it as 5 beats → 5 fly-to pins along alley + 3 sub-pins in
Exploration. Both `useScroll offset 0→1` **and**
`onPointerDown pin → targetScroll lerp 0.06` drive the GSAP scrub proxy (§12 —
`anime.timeline` dropped with `anime` itself). Spec
mapping `20_3D §2 flyTo`.

### 2.2 The Load Sequence (the Poster veil is the pattern — amended 2026-10-04)

`boneyard-js` was specified here, then dropped (§0): the veil covers the same
load with zero deps and zero hydration owners. Rationale: a skeleton library
snapshots DOM to hide a mount gap, but FM-10 removes the gap instead — the
canvas mounts immediately inside the final box and the pixel-identical Poster
overlays it until `onCreated` fires. Nothing to snapshot, nothing to shift.

```
    / loads
      │
      ├─ <ProductHero/> renders <Poster/> immediately (static HTML, no JS)
      │
      ├─ <Canvas> mounts at once (R3F, ssr:false); three.js + drei hydrate
      │     ├─ NO environment HDRI (dropped — see below)
      │     ├─ glass material compiles (MeshTransmissionMaterial shader)
      │     └─ particle field instanced
      │
      ├─ on first frame rendered (onCreated) → veil lifts, canvas live
      │     (veil and canvas share one h-[100dvh] w-full box: ZERO pixel shift;
      │      asserted in apps/product-page/tests/ssr.test.ts)
      │
      └─ if WebGL unavailable (useWebGLAvailable === false) → <Poster/> stays
            (the same component, no second asset, no JS)
```

The key property: **the user never sees a blank box or a layout jump.**
The veil occupies the exact pixels the canvas takes over, because it _is_ the
same box. This is why the veil replaced `boneyard-js`: one fewer dependency
for an identical guarantee.

**Environment / HDRI: DROPPED (amended 2026-10-04).** `<Environment
preset="city">` fetches a remote HDRI at runtime — a new outbound network call
carrying user timing data, forbidden by AGENTS.md Rule 2 (only the blob store
and the update ping may call out). The palette-lit alternative is the §7.2 rig:
abyss ambient + neumo key/fill directionals + three palette accent points,
with `ACESFilmicToneMapping` + exposure 1.1 (FM-12) so the render never comes
out dark and muddy. No reflections are lost that the transmission material
needs: the card refracts the lit scene itself.

---

## 3. Performance Budget (the W6 bar)

| Metric                                              | Target                                              | How                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Frame rate (mid-tier laptop, e.g. M1 Air / Ryzen 5) | **≥ 50 fps**                                        | instanced particles (1 draw call), transmission material at 1 sample, `<AdaptiveDpr>` caps DPR at 1.5 |
| Frame rate (low-end / integrated GPU)               | ≥ 30 fps                                            | `<AdaptiveDpr>` drops to 0.75; particle count → 80; transmission samples → 1                          |
| First-contentful paint                              | < 1.2 s                                             | boneyard skeleton is HTML/CSS, paints before JS; poster path < 200 KB                                 |
| Time-to-interactive (canvas hydrate)                | < 3 s                                               | three.js is dynamically imported (`next/dynamic`, ssr:false); HDRI is `<Environment>` lazy            |
| No-WebGL fallback                                   | instant                                             | `<Poster/>` is a static image, no JS                                                                  |
| Lighthouse (Performance) on `/`                     | **≥ 90**                                            | the 3D scene is lazy + DPR-capped; below-the-fold marketing is RSC, zero client JS                    |
| Bundle cost of the 3D stack                         | < 180 KB gzipped (three + fiber + drei tree-shaken) | dynamic import isolates it from the main chunk; users who never scroll to hero (rare) don't pay       |

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

The ladder is checked in `useWebGLAvailable` + `useReducedMotion` + a
`navigator.connection.saveData` read. No user toggles — it's automatic. The
tutor on a ₹12,000 Android phone with 2 bars of 4G (the persona from
`product/AGENTS.md`) gets the poster, fast.

---

## 4. Accessibility (the 3D scene is decorative, not a barrier)

- **The hero conveys no information that isn't also in the DOM.** The KPI
  numbers ("₹0 owed · 0 students") are real HTML text overlaid via drei `<Html>`
  (or rendered as a sibling DOM node on top of the canvas), so a screen reader
  reads them regardless of WebGL. The 3D card is decoration.
- **`prefers-reduced-motion`** freezes the orbit + float; the card sits still.
  No parallax.
- **No flashing.** The accent lights pulse at 0.5 Hz max (well under the 3 Hz
  photosensitivity threshold).
- **Keyboard.** The hero has no keyboard-operable 3D controls (it's not a game).
  The CTA below it ("Start free →") is the keyboard target.
- **`aria-hidden="true"`** on the `<canvas>` itself (it's decorative); the KPI
  text node is the accessible surface.

---

## 5. Mobile (P2 — after Mobile Production Gate work begins, not before)

`16_Platform_Delivery_Sequence.md` forbids touching `apps/mobile/` until the Web
Production Gate clears. The mobile 3D scene is specified here for completeness;
it is built in the Mobile phase.

### 5.1 Mobile Stack

R3F is web-only. On React Native, the equivalent is **`expo-three`** (three.js
over Expo GLView) for a true 3D scene, or **`@shopify/react-native-skia`** for a
2.5D parallax fallback on low-end devices.

| Tier                            | Stack                                                                  | Renders                                         |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| High-end (iPhone 12+, Pixel 6+) | `expo-three` + the same scene graph as web (ported)                    | full 3D, capped 30 fps, transmission @ 1 sample |
| Mid/low Android                 | Skia — a 2.5D parallax of the card + accent glows (no real refraction) | the "feel" of 3D at 60 fps, cheap               |
| Fallback                        | static poster (the same PNG as web)                                    | instant                                         |

### 5.2 Mobile Constraints

- Battery: the scene renders only when the hero tab is visible (`useIsFocused`);
  pauses on background.
- Heat: capped 30 fps even on high-end (a 60 fps 3D scene on a phone is a
  hand-warmer, not a marketing tool).
- Data: the 3D bundle is downloaded on first launch only, after the user has
  signed up (not on the cold app-open — that's the poster).

---

### 8.3 Graffico Walk — Blender Baked + WASD/E (Reference: office.graffico.it)

Graffico teaches **you are there**: `Blender baked lightmaps + R3F` +
`PointerLockControls` + `Rapier` colliders + `Html` live screens + `Howler`
radio, `WASD + mouse + E near + Shift faster + Esc`. Buddysaradhi Reveal beat
maps it as: at `0.85–1.0` camera lands `-38` staffroom, `WASD` unlocks
desktop-only (`!isLowEnd && window.innerWidth>768`) to walk 2m to 5 desks — `E`
opens `Html` live KPI `₹0 owed`. Mobile keeps scroll-zoom. Baked lightmaps keep
First Load `<180KB gz`.

## 6. Desktop (P3 — after Desktop Production Gate work begins)

Desktop runs the web app as a Tauri static export, so the **same R3F scene**
renders in the Tauri webview with zero porting. The only desktop-specific
tweaks:

- Higher DPR cap (desktop monitors are 1x–2x): `<AdaptiveDpr>` cap raised to 2.
- The scene can be richer (desktop users have GPUs): transmission @ 4 samples,
  particle count 300.
- The hero is the same component (`apps/web/src/components/hero/`), imported by
  the desktop shell. **No desktop-specific 3D code.** This is the payoff of
  serial delivery: by the time desktop begins, the web hero is a frozen, tested
  contract (`16_Platform_Delivery_Sequence.md` G2).

---

## 7. Neumorphism + Glassmorphism — The 3D Material Spec

This is the explicit mapping the user asked for ("Ensure Neumorphism on the
components and Glassmorphism backgrounds"), expressed in three.js materials so
the implementing agent has no ambiguity.

### 7.1 The Card — Neumorphic Glass (both at once)

```tsx
// scene/LedgerCard.tsx — the material recipe (pseudocode, R3F declarative)
<mesh rotation={[-0.26, 0.2, 0]} position={[0, 0, 0]}>
  <boxGeometry args={[3.2, 2, 0.12]} />
  {/* Glassmorphism: real refraction, the 3D backdrop-blur */}
  <MeshTransmissionMaterial
    transmission={1} // fully refractive
    thickness={0.4} // how deep the refraction samples
    roughness={0.06} // smooth, like the glass panels
    ior={1.25} // subtle bend
    chromaticAberration={0.02} // faint colour split at edges (bioluminescent hint)
    backside={false}
    samples={isLowEnd ? 1 : 4} // the degradation lever
    resolution={256}
    color="#1a1a3a" // --bg-neumo-light tint (so it's not invisible glass)
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
<Canvas
  gl={{ antialias: true, powerPreference: "high-performance" }}
  dpr={[0.75, cap]}
>
  <color attach="background" args={["#0f0c29"]} /> {/* --bg-cosmic floor */}
  <fog attach="fog" args={["#0a0a1a", 6, 14]} /> {/* Abyss fog → depth */}
  {/* particle field = the "aurora" grain on the cosmic canvas */}
  <ParticleField count={isLowEnd ? 80 : 200} />
  ...scene...
</Canvas>
// The CSS behind the canvas is the cosmic gradient, so the canvas (transparent where
// there's no geometry) blends with --bg-cosmic → --bg-midnight → --bg-abyss.
```

---

## 8. What This Is NOT (Anti-Patterns)

| Temptation                                         | Why forbidden                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A 3D scene that's interactive (drag/zoom the card) | The hero is marketing, not a toy; interaction invites a fiddly UX that hurts conversion. Static beauty.                     |
| Loading the 3D bundle on every route               | It's `/` only. Dynamically imported; other routes never fetch three.js.                                                     |
| A 60 fps target on mobile                          | Phones throttle + heat; 30 fps cap is the responsible choice.                                                               |
| Indigo/blue accent lights                          | `AGENTS.md` Rule 5. Cyan `#00F0FF` is a focus accent, permitted; indigo/violet lights are not.                              |
| Pure-black materials                               | `13_UI_Guidelines.md` §1.3. Darkest is `#0a0a1a`.                                                                           |
| Skipping the poster fallback                       | A tutor on a 2G connection or a 5-year-old Android gets a blank box without it. The poster is the contract with that tutor. |
| Building the mobile 3D scene during the Web phase  | `16_Platform_Delivery_Sequence.md` §7. Mobile is locked until the Web Gate clears.                                          |

---

## 9. Implementation Order (within Web phase, `16_Platform_Delivery_Sequence.md` §10.1 step 6)

```
    3D PRODUCT PAGE BUILD-OUT (part of P1: WEB IN-FLIGHT):

    1. three 0.182.0 + @react-three/fiber 9.8.0 + @react-three/drei 10.7.8
         (do NOT attempt `3d-js` — it 404s, see §0; do NOT add boneyard-js or
         maath — dropped, see §0/§1.1; do NOT add anime — GSAP scrubs, see §12)
    2. apps/product-page/src/components/product-3d/ (§2) — Canvas + Poster + veil
    3. LedgerCard + AccentLights + ParticleField + ContactShadow (§7 materials)
    4. useWebGLAvailable + useReducedMotion hooks; degradation ladder (§3.1,
       decided in code by scene-tiers.ts — one ladder, two routes)
    5. Poster veil over the mounting canvas; zero layout shift on lift
         (asserted in apps/product-page/tests/ssr.test.ts)
    6. Performance: AdaptiveDpr, instanced particles, dynamic import; hit ≥50 fps mid-tier
    7. Accessibility: aria-hidden canvas, KPI as DOM text, reduced-motion frozen (§4)
    8. Lighthouse ≥ 90 on / (W5); the 3D bundle isolated from main chunk
    9. Agent Browser verify: hero renders, veil→canvas swap clean, poster on no-WebGL
    ─── W6 of the Web Production Gate clears ───
```

---

## 10. Cross-References

- `16_Platform_Delivery_Sequence.md` W6 — this is a Web-gate deliverable; §7
  forbids mobile 3D during Web phase.
- `13_UI_Guidelines.md` §2.1 (tokens) + §4 (neumorphic classes) — the materials
  in §7 consume these exact tokens.
- `product/02_Hero_and_Above_the_Fold.md` — the copy + KPI text the 3D card
  displays; the 3D scene is the visual, the product spec is the words.
- `product/03_Features_Showcase.md` — below-the-fold sections (unchanged; the 3D
  hero sits above them).
- `17_API_Gateway_System.md` — the KPI numbers on the card are fetched via the
  SDK (no hardcoded fetch).
- `19_Concurrency_and_Testing.md` — the 3D scene has no server concurrency, but
  its load budget is part of W5 Lighthouse.

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

### 11.2 The Load Sequence (Poster veil — boneyard-js dropped, see §2.2)

```
    t=0ms     / loads. <ProductHero/> renders <Poster/> (static HTML, no JS).
              ┌─────────────────────────────────────┐
              │  canvas-coloured backdrop           │  ← veil (no layout shift)
              └─────────────────────────────────────┘

    t=200ms   <Canvas> mounts at once (ssr:false, dynamic). three + drei
              hydrate INSIDE the same box; transmission shader compiles.
              No HDRI fetch (dropped per Rule 2 — palette-lit rig, §2.2).

    t=~1.8s   first frame rendered → onCreated fires → veil lifts.
              Veil and canvas share one h-[100dvh] w-full box: ZERO pixel shift.
              ┌─────────────────────────────────────┐
              │  ╔═══════════════════════════════╗  │  ← live WebGL canvas
              │  ║ ₹0 owed · 0 students · 1 ledger║  │
              │  ╚═══════════════════════════════╝  │
              └─────────────────────────────────────┘

    no-WebGL  useWebGLAvailable === false → the SAME <Poster/> stays
              (no second asset, no JS)
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

DPR cap note (amended 2026-10-04, decided in `resolveDpr`): the hero keeps
`[1, 1.5]` below 1280px viewport width even on capable GPUs — a phone-width
frame gains nothing from more pixels. `[1, 2]` opens only above 1280px on
non-low-end devices; `<AdaptiveDpr>` still sheds load under pressure either
way.

---

## 12. 3D Narrative Story — Kurious Bastard 5 Beats, Shonen (Penguin×Zacamil×Graffico)

Shonen pacing (Naruto/DBZ/One Piece): fast ease-in, whip-pan on punch, `FOV 55->75->55` 200ms via `THREE.MathUtils.damp` (in-bundle; `maath` stays dropped), speed-lines on chaos, impact frame.

**Animation driver: GSAP scrub (amended 2026-10-04).** The sticky stage owns one
GSAP `ScrollTrigger` scrub proxy (section scroll → 0..1 progress ref); the
camera damps toward it per frame. No `anime` dep: GSAP 3.15 is already present
and does the scrub, so a second timeline library would be a second owner for
one job. `ScrollTrigger.refresh()` after settle (~600ms + font-ready) per
FM-21; `gsap.context` + `ctx.revert()` + `io.disconnect()` per FM-15;
`frameloop` suspends off-screen per FM-16.

**Canonical beats (scroll map, no overlap):**
1. **Hook `0.00-0.25`** — seeker finds tuition, phone in hand (Penguin living idle at `y=0`).
2. **Exploration `0.25-0.55`** — hallway chaos: fighting/teasing/supporting, 3 sub-pins (Zacamil pins).
3. **Relief `0.55-0.70`** — doubts cleared, breathes easy, nod.
4. **Climax `0.70-0.85`** — Staffroom cluster, every tutor on BuddySaradhi.
5. **Reveal `0.85-1.00`** — zoom into 5 screens: Dashboard->Students->Attendance->Fees->Settings + optional `WASD/E` walk (Graffico).

**Assets:** code-first ONLY (amended 2026-10-04). `LedgerCard,
AccentLights, ParticleField, Tube 48x6` are code; `ScrollControls`-style
pinning is DOM buttons → `scrollTo` plus the GSAP scrub proxy (no
`anime.timeline`). Nano Banana stills and Veo clips were specced here
(`public/nano/*`, `public/veo/alley-roam.mp4`) but are recorded as DROPPED for
this build: they cannot be generated in this environment, and shipping
`CanvasTexture`/`VideoTexture` planes against assets that do not exist would
404 on the hero path. If the assets ever exist, they arrive as `CanvasTexture`
on `Plane` with `dispose()`, `crossOrigin="anonymous"` only if CORS-clean, and
`currentTime` clamped to `duration - 0.15` — until then the alley is desks,
screens, thread and light. No remote fetch either way (Rule 2).

### 12.1 The `/tour` Route (amended 2026-10-04)

The five beats get a second, longer telling at
`apps/product-page/src/app/tour/`: a 600vh pinned stage walking the five
screens in order (Dashboard → Students → Attendance → Fees → Settings), over
the SAME shared world (`ProductScene` / `Journey` / `World` / `LedgerCard` /
`AccentLights` / `ParticleField` / hooks — reused, never forked). Route-local
code lives in `src/app/tour/_components/` and only there:

- `tour-copy.ts` — the five stop texts (audited mechanism language, no
  headcounts). Rendered twice: as the pinned overlay AND as a static list in
  the server page for no-JS/search visitors.
- `tour-tube.tsx` — the NEW code-first set piece: the ledger thread, a
  `THREE.TubeGeometry` (48 tubular × 6 radial) along a fixed CatmullRom curve
  from the hero card to the five reveal screens, palette accent material,
  geometry disposed on unmount. No new deps, no new assets.
- `tour-fov-rig.tsx` — the shonen whip: scroll velocity damps FOV 55→75→55
  via `THREE.MathUtils.damp`; parked at 55 under reduced motion.
- `tour-canvas.tsx` + `tour-experience.tsx` — the `ssr:false` canvas wrapper
  and the stage (pins pattern, Poster veil, poster/reduced/low-end paths,
  skip + back links, prev/next, `?beat=` deep links with `pushState` on
  explicit visits / `replaceState` on scrub / `popstate` for back-forward).

Constraints inherited, not repeated: Poster veil (§2.2), DPR tiers (§11.3 via
`resolveDpr`), single ladder (`scene-tiers.ts`), H1-in-SSR-HTML (server H1;
overlay headings are H2 — one H1 per document), 44px targets, canvas
`aria-hidden`, CTA as the keyboard target (Rule 10).
