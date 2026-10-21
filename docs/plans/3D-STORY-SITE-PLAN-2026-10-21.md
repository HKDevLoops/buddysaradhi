# 3D STORY SITE — PLAN (2026-10-21)

**What this is:** the plan for the Buddysaradhi 3D story site — a fifty-beat
scroll narrative at `/story`, built to `docs/plans/ANIMATION_MODEL_BRIEF.md`
(the contract) and `20_3D_Product_Page.md` (the governing spec).

**The one-line story:** *one evening in a tutor's life going wrong, and the same
evening going right.*

**Status:** the narrative and the architecture are specified; the build is in
flight (lane I). The rest of the remediation is tracked in
`docs/audit/REMEDIATION-PLAN-2026-10-21.md`.

---

## 1. What already exists, and what is new

The product site is not a blank page — it is a working 3D marketing site, and
this plan does not replace it.

| Surface | Story | Status |
|---|---|---|
| `/` | the **hero**: one scene, five beats, the ledger card above the fold | SHIPPED — the 5 beats stay verbatim |
| `/tour` | the 600vh pinned tube walk | SHIPPED — untouched |
| `/story` | the **story**: fifty beats, five acts, a seeker whose evening goes wrong and then right | NEW — this plan |

The brief is explicit: *"5 beats is the hero, 50 beats is the story."* The hero
is the front door and it keeps its beats; the story is the long telling
alongside it.

## 2. The narrative

Five acts, fifty beats, contiguous scroll ranges that tile `0..1` with no
gap and no overlap. The beat ids are stable strings; the copy lives in a typed
module, never inline in a component.

| Act | Beats | Scroll | Focus | The beat |
|---|---|---|---|---|
| **I — The Hunt** | 1–9 | 0.00–0.15 | `seeker` | Alone, phone in hand, evening. She is looking for a class that will pay. The listings all look the same; the WhatsApp thread is 47 messages and a spreadsheet with nine columns and no names. |
| **II — The Chaos** | 10–20 | 0.15–0.38 | `room` | The corridor. Other seekers converge. Registers fall, bubbles multiply, cells turn red. Everything is noise — until ONE bubble holds still: *"Sir, my fee is paid but it shows due."* |
| **III — The Turn** | 21–30 | 0.38–0.58 | `ledger` | The ledger card appears. It is not magic — it is *ordered*. A row lands; the chain extends; a void arrives as a **compensating** row, so the wrong value survives *beside* the right one. Money is paise. Receipt numbers never repeat. |
| **IV — The Relief** | 31–40 | 0.58–0.78 | `self` | The same evening, going right. Same street, same sodium light — and five labels instead of a search bar. She exhales at beat 38. **That is the beat to hold.** |
| **V — The Five Screens** | 41–50 | 0.78–1.00 | `ledger` | The reveal, in spec order: Dashboard → Students → Attendance → Fees → Settings. One tap from any screen to any other. The staffroom, every tutor, every screen agreeing with the card. |

**The bar (brief §12):** after fifty scrolls a visitor can answer four
questions unprompted — *what is it* (an operating system for one tutor, five
screens), *what was wrong* (WhatsApp threads, an Excel sheet, a paper register
— named chaos, not abstract pain), *why is it trustworthy* (the ledger only
appends; a mistake becomes a second compensating row), *who is it for* (one
tutor, one room, their name on the settings screen). **If they cannot, the 3D
was decoration. If they can, it was storytelling.**

## 3. The architecture

```
apps/product-page/src/components/story/
  beats.ts              the 50-beat data + the Beat type          NEW
  character.tsx         the seeker: the vendored rig + the pose keyframes  NEW
  character-asset.ts    the asset's provenance, the bone names, the budget NEW
  camera-rig.tsx        target / look-ahead / roll / FOV          NEW
  act-directives.ts     SceneDirective -> scene mutations         NEW
  story-canvas.tsx      the <Canvas> + the scroll->progress wiring NEW
  story-experience.tsx  the client wrapper (dynamic, ssr:false)    NEW
apps/product-page/src/app/story/page.tsx   the SERVER page       NEW
apps/product-page/tests/{beats,camera-rig,performance}.test.ts   NEW
```

**Reuse, never fork.** `scene-tiers.ts` (the single quality ladder),
`hooks.ts` (the scroll-progress ref, `usePalette`, reduced motion, WebGL
capability, intersection), `World.tsx`, `Journey.tsx` (the curve spine),
`LedgerCard.tsx`, `AccentLights.tsx`, `ParticleField.tsx`, `Poster.tsx`,
`tour-tube.tsx`, `tour-fov-rig.tsx`, `ProductHero.tsx`, `tour-experience.tsx` —
all extended and imported, never rewritten and never copied.

**Three non-negotiables (brief §0).**
1. **Code-first, no generated assets.** Every mesh, material and animation is
   TypeScript + three.js. No `.glb`, no `.hdr`, no texture image, no video.
   Zero binary assets in the repo.
2. **No new dependencies.** `three` 0.182.0, `@react-three/fiber` 9.8.0,
   `@react-three/drei` 10.7.8, `gsap` 3.15.0, React 19. GSAP is the single
   owner of scroll-driven animation.
3. **Performance is a correctness requirement.** A dropped frame is a failed
   test. If a budget cannot be met, the scene is simplified — the budget is
   never raised.

**The data flow:** document scroll → one normalised `0..1` progress (GSAP
`ScrollTrigger` with `scrub`) → the beat timeline resolves the active beat and
its neighbours → the camera rig damps toward that beat's `pos`/`target`/`fov`
→ the character lerps its pose keyframes → the act directives mutate the
scene. The scroll is the only clock: no scroll-jacking, no custom scroll
container, no timers.

## 4. The camera — direction, not motion

The existing `Journey` dollies a position along a curve. That is motion, not
direction. A camera has to *look at* something, and the look is what tells the
viewer where to look.

- Every beat declares a **target**, not just a position.
- **Damped look-ahead:** the camera points slightly *ahead* along the path, so
  a move feels operated rather than lerped.
- `pos`, `target` and `fov` are damped at a **shared** rate (≈3–4). Different
  rates per property is how you get seasickness.
- `roll` is Act II only, max ±0.08, and **exactly 0 by beat 38** — so the
  recovery reads as relief, not as a bug.

| Act | Camera language |
|---|---|
| I | wide, high, distant, slow. She is small in frame. FOV 55. |
| II | low, closing, FOV widening to 70 (compression), slight roll, handheld drift. |
| III | **push in hard, then stop dead.** FOV narrows to 38 at beat 21 and holds. The stillness after motion IS the beat. |
| IV | pull back, level, FOV 55, no roll. Warm. |
| V | slow orbit around the ledger card, FOV 45, the five screens arranged in depth. |

## 5. The character — silhouette first

The seeker is a **vendored, rigged human** —
`apps/product-page/public/scene/character/seeker.glb` (amended 2026-10-21 by
owner directive: a body assembled from primitives reads as a snowman, not a
person). *Animated Woman* by **Quaternius**, **CC0 1.0**, via Poly Pizza; the
source, the licence, where the licence was verified, the attribution and the
SHA-256 are in `public/scene/character/ATTRIBUTION.md`. It is served from
this app's own origin — **no runtime fetch to any third-party host** (Rule 2).

62 joints, one mesh, one skin, one material, **no textures**. She must read as
a person at `z=40` and at `z=4`; readability comes from **proportion and
pose**, never from facial detail.

One material: `meshStandardMaterial`, roughness 0.72, metalness 0, colour from
the palette. The phone is the only light she carries, and when it faces the
camera its own emissive is the key light on her face — **dark figure, lit
face** is the whole visual idea of Act I.

**Pose changes with the story** (the brief's per-act table is a minimum):
shoulders forward and head down in Act I; tighter and turned away in Act II;
perfectly still in Act III, only the phone moving; shoulders open and a longer
stride in Act IV; upright and competent in Act V.

**No animation mixer.** The rig gives her bones; it does not give her a
performance. The vendored file's twenty-four clips were stripped at vendoring
time, and every act's pose is a hand-authored keyframe on the rig's bones,
lerped by the beat progress.

## 6. The budgets — enforced, not aspirational

| Metric | Low | Mid | High |
|---|---|---|---|
| draw calls | ≤ 30 | ≤ 70 | ≤ 140 |
| triangles | ≤ 30k | ≤ 90k | ≤ 180k |
| textures | ≤ 8 | ≤ 16 | ≤ 24 |
| DPR | 0.75 | 1.0–1.5 | ≤ 2 |
| antialias samples | 0 | 1 | 4 |
| transmission samples | 0 (fall back to standard) | 1 | 4 |
| target FPS | ≥ 30 | ≥ 50 | 60 |

Plus: `frameloop="never"` off-screen (a page that burns a phone battery
rendering an unseen corridor is a bug); DPR capped at 2 even on high tier;
geometry and material creation memoised and disposed on unmount;
`ScrollTrigger.refresh()` after the fonts settle; `gsap.context()` +
`ctx.revert()` and `io.disconnect()` for every trigger and observer.

`tests/performance.test.ts` counts these **from the constructed scene**, not
from a browser, so the budget is a property of the code.

## 7. Accessibility — non-negotiable

A 3D scene is decorative and must never be a barrier to content.

1. All fifty beats exist as **static, readable HTML** — the server page
   renders a complete `<ol>` of every caption above the canvas in the DOM. No
   WebGL, no JS, or a crawler: the visitor has read the entire story.
2. `<canvas aria-hidden="true">`. The canvas is presentation; the `<ol>` is
   the content.
3. The Poster veil covers the canvas until the first frame renders. Never an
   empty black rectangle.
4. `prefers-reduced-motion` gives the full scene, **frozen**: no camera
   travel, no idle float, no particle motion, FOV parked, the character held
   in a neutral pose.
5. The CTA is the keyboard target; native arrow keys and PageDown work;
   skip-to-content is the first focusable element; 44×44px touch targets.

## 8. The spec amendment (brief §9)

`20_3D_Product_Page.md` §12 specifies five beats. The brief replaces that
with fifty across five acts, and §9 requires the code and the spec change to
ship **in the same commit** — the spec is the contract, and code that
diverges from it is orphan code. The amendment records that the beat map was
deliberately expanded, and why: *five beats is the hero, fifty beats is the
story.* The protected areas are untouched: the code-first asset rule, the DPR
tier ladder, the Poster veil, H1-in-SSR-HTML, the 44px/a11y rules.

## 9. Verification — what "done" means

A build that renders is not done. `lint`, `typecheck`, the tests and the build
must all be green, and three new tests must exist, each with a
**verified-red negative control**:

| Test | Asserts |
|---|---|
| `beats.test.ts` | exactly 50 beats; unique ordered ids; the scroll ranges tile 0..1 contiguously; every beat has a camera target and an fov in [35, 90]; Act II roll ≤ 0.08; beat 38 roll === 0 |
| `camera-rig.test.ts` | the look-ahead clamps at t=1; the damp is monotonic; the fov interpolation never leaves [35, 90] |
| `performance.test.ts` | per tier, the constructed scene's draw calls / triangles / textures stay within the §6 budget |

Then, in a real browser: scroll all fifty beats and confirm (a) no beat is
skipped or double-entered, (b) the camera never cuts between beats, (c)
`renderer.info` stays inside budget while scrolling, (d) reduced motion freezes
it, (e) the static `<ol>` reads with the canvas hidden.

## 10. The phases

| # | Phase | Gate | State |
|---|---|---|---|
| S1 | The narrative: `beats.ts` — 50 beats, the type, the copy | `beats.test.ts` green with a red-then-green control | IN FLIGHT |
| S2 | The camera rig: targets, look-ahead, roll, FOV, the act language | `camera-rig.test.ts` green with a control | IN FLIGHT |
| S3 | The character: a vendored, licensed, rigged human; one material; the per-act pose keyframes on her bones | `character-rig.test.ts` green with a red-then-green control | IN FLIGHT |
| S4 | The act directives: `SceneDirective` → scene mutations, per act | the act-directive tests | IN FLIGHT |
| S5 | The wiring: `story-canvas.tsx`, `story-experience.tsx`, `src/app/story/page.tsx` | the page builds; the `<ol>` is in the SSR HTML | IN FLIGHT |
| S6 | The performance test, counted from the constructed scene | within the §6 budget at every tier | IN FLIGHT |
| S7 | The spec amendment, in the same commit as the code | §12 amended | IN FLIGHT |
| S8 | The browser verification (a–e above) | a recorded pass | PENDING |

**Sequential, not parallel (brief §5):** S1–S4 share the `Beat` type, and
parallel edits to a shared type produce three conflicting versions.

## 11. The risks, and the open decisions

| Risk | Why it is real | What we do about it |
|---|---|---|
| The bundle budget is unreachable | the 3D stack is 245.3 KB gzip against `20_3D` §3's 180 KB; three.js alone is ~165 KB gzip before R3F and drei | the spec needs amending — the budget is below the cost of the dependency the scene is built on. **Owner decision.** |
| The software-rasteriser frame rate is 3.1 fps | SwiftShader is not a GPU; the spec's ≥50 fps bar is for a real mid-tier GPU | the renderer is pinned so the number means the same thing on every machine; the claim is stated, not implied |
| FCP was not re-measured | the harness measures frame cost and payload | stated as a gap, not quietly claimed |
| A warm cache hit is below the instrument's floor | an operation costing tens of nanoseconds has no resolution left in stick units | documented in the test file — a 3× regression *of that operation* is undetectable, and the doc says so |
| The story ships without the copy earning its place | a 3D scene that does not answer the four questions is decoration | the §12 bar is in the brief and in the report; the copy is written for a tutor |

**Open for the owner:** the 180 KB budget (amend or keep a permanently red
number); whether `/story` gets its own nav entry now or after the first
impression of the story; and the aurora's 10% → 6% weakening, which the
contrast measurement forced and which is the app's signature.
