# 3D SCROLL STORY — MODEL BRIEF

**Audience:** an AI coding model with tool access (StepFun-5 / Kimi-K2 / NVIDIA NIM / Kilo), building the Buddysaradhi product site.
**Status:** spec-first. This file is the contract. Build to it, not around it.
**Repo:** `HKDevLoops/buddysaradhi-product` (standalone). 3D code lives in `src/components/product-3d/` and `src/app/tour/_components/`.
**Governing spec in the monorepo:** `20_3D_Product_Page.md` — note §12 there specifies **5 beats**; you are replacing that with the narrative below. See §9 for what must be amended.

---

## 0. READ THIS FIRST — three rules that are not negotiable

1. **Code-first, and no GENERATED assets.** Every mesh, material, texture and
   animation is written in TypeScript with three.js — with ONE exception,
   below. Nano Banana stills, Veo clips and any other *generated* imagery stay
   dropped: they are not in the repository and no plane may point at a file
   that does not exist (`20_3D_Product_Page.md` §12).

   **THE EXCEPTION — A CURATED, LICENSED, VENDORED ASSET.** A small set of
   real-world assets may be vendored into the repository, and only on all of
   these terms at once:

   - **Permissive licence only** — CC0, CC-BY or MIT. A licence that needs an
     account, a key, a click-through or a payment is not a licence this
     project can take.
   - **The licence is VERIFIED by reading it**, not by trusting a search
     result, and the place it was read is recorded.
   - **The provenance travels with the file.** The source URL, the licence,
     the attribution (if the licence asks for one) and the **SHA-256** of the
     bytes are written in an `ATTRIBUTION`/`LICENCE` file **beside the
     asset**, and the file's own glTF `asset.copyright` block repeats them.
   - **A written size budget**, in bytes, checked by a test. A binary asset is
     the one thing in this project nobody notices growing.
   - **Vendored, never fetched.** The asset is committed to the repository and
     served from the app's own origin. A CDN, an asset host or any third-party
     URL at runtime is a NEW OUTBOUND ORIGIN and is forbidden (AGENTS.md §2
     Rule 2) — the same reason `<Environment preset="city">` was dropped in
     §2.2.
   - **Still no generated images, no HDRI environment fetch, no video, and no
     texture images unless the look actually needs them.** The look is the
     palette's.

   The only vendored asset today is **the seeker**
   (`apps/product-page/public/scene/character/seeker.glb`): a rigged human,
   because a body assembled from capsules reads as a snowman, not a person.
   Her provenance is in
   `apps/product-page/public/scene/character/ATTRIBUTION.md`. The amendment
   was made by the owner's directive and lands in the same commit as the code
   that uses it (brief §9).
2. **No new dependencies.** The installed and permitted set is exactly: `three` (0.182.0), `@react-three/fiber` (9.8.0), `@react-three/drei` (10.7.8), `gsap` (3.15.0), React 19. Do **not** add `anime`, `lil-gui`, `dat.gui`, a physics engine, or a second scroll library. GSAP is the single owner of scroll-driven animation.
3. **Performance is a correctness requirement, not an optimisation.** A dropped frame is a failed test. Budgets in §7 are enforced by `src/lib/perf-budget.test.ts`; if you cannot meet them, simplify the scene — never raise the budget.

---

## 1. WHAT IS ALREADY BUILT (reuse it, never fork it)

These exist, are correct, and are the shared vocabulary. Extend them. Do not rewrite them and do not copy them into new files.

| File | Role |
|---|---|
| `scene-tiers.ts` | **The single ladder.** Device tier → DPR, antialias samples, stage lighting, FOV, and which beat set runs. Every quality decision routes through here. |
| `hooks.ts` | Scroll-progress ref, palette access (`usePalette` — no colour literals; three.js needs resolved numbers), reduced-motion, WebGL capability, intersection. |
| `World.tsx` | Ground, corridor, walls, fog. |
| `Journey.tsx` | `CatmullRomCurve3` through waypoints, `useFrame` + `THREE.MathUtils.damp` along `progressRef`. **This is the spine of the whole experience.** |
| `LedgerCard.tsx` | The hero object. `MeshTransmissionMaterial` + `Edges`. |
| `AccentLights.tsx` | Bioluminescent light rig. |
| `ParticleField.tsx` | Dust motes. |
| `Poster.tsx` | Pre-WebGL 2D veil — **mandatory**, not optional (§8). |
| `tour-tube.tsx` | `TubeGeometry(48, 6)` along a fixed curve, the ledger thread. |
| `tour-fov-rig.tsx` | Scroll-velocity FOV whip, `damp`, parked at 55 under reduced motion. |
| `ProductHero.tsx` | The `/` hero: `<Canvas>` + 5 beats of copy + waypoints. |
| `tour-experience.tsx` | The `/tour` 600vh pinned stage. |

**The character, the camera rig and the beat timeline do not exist yet. You are writing them.**

---

## 2. THE NARRATIVE — 50 BEATS

The product is a tutor's operating system. The story is **one evening in a tutor's life going wrong, and the same evening going right.** 50 beats across 5 acts.

Beat ids are stable strings. Copy lives in a typed module, never inline in components.

```
type Beat = {
  id: string            // stable, kebab, never renumbered
  act: 1|2|3|4|5
  scroll: [number, number]   // 0..1, MUST be contiguous & non-overlapping
  camera: { pos: [x,y,z]; target: [x,y,z]; fov: number; roll?: number }
  focus: 'seeker' | 'room' | 'ledger' | 'self' | 'none'
  caption: { title: string; body: string }
  scene: SceneDirective   // §4
}
```

**Scrolling the page IS the timeline.** No scroll-jacking, no hijack, no custom scroll container. Native document scroll drives a single normalized progress `0..1` (GSAP `ScrollTrigger` with `scrub`), and that progress is the only clock. `fm-21` note: call `ScrollTrigger.refresh()` after settle (~600ms + `document.fonts.ready`), or beat→camera alignment drifts.

### ACT I — THE HUNT (beats 1–9, scroll 0.00–0.15) · focus: `seeker`
A seeker. Alone. Phone in hand. Evening. She is looking for a class that will pay.

```
1  street-night          establishing. Wet street, sodium light, a class board glowing
2  phone-glow            she looks down; the phone is the only light on her
3  first-result          a listing: "Class 9 · Maths · ₹400/month"
4  the-question          — who is teaching this?
5  scroll-past           three more listings, all the same font, all the same voice
6  doubt                 she stops. Something in her posture changes.
7  the-whatsapp          a screenshot: a spreadsheet. Nine columns. No names.
8  the-thread            47 messages. "Did you pay?" "Which batch?"
9  alone-lit             wide. She is one small lit figure in a dark grid.
```

### ACT II — THE CHAOS (beats 10–20, scroll 0.15–0.38) · focus: `room`
The corridor. Other seekers converge. Everything is noise.

```
10 corridor-blink        harsh strip lighting, long perspective
11 crowd-in              silhouettes, overlapping, no faces
12 noise-registers       paper registers everywhere, stacked, falling
13 noise-whatsapp        message bubbles multiplying, unreadable
14 noise-calls           missed-call glyphs pulsing
15 noise-excel           a grid of cells, some red, nobody knows why
16 the-weight           camera drifts DOWN. The noise has weight.
17 pinned- doubt         ONE bubble holds still: "Sir, my fee is paid but it shows due"
18 pinned- doubt-2       another: "I marked attendance. It didn't save."
19 the-collapse          the corridor narrows. Everyone is looking at their own screen.
20 the-cost              silence. Every screen still lit. Nothing resolved.
```

### ACT III — THE TURN (beats 21–30, scroll 0.38–0.58) · focus: `ledger`
The ledger card appears for the first time. It is not magic — it is *ordered*.

```
21 card-breathe          the card floats in. Slow. Quiet. Nothing else moves.
22 card-front            one face, edge-lit
23 the-append            a row lands. The chain extends. It can only extend.
24 the-append-2          another row. Older, dimmer, but PRESENT.
25 the-reverse           a void appears as a COMPENSATING row — the wrong value survives beside the right one
26 the-hash              the chain of hashes, each link depending on the last
27 the-receipt           a receipt, numbered monotonically. A gap in the sequence, explained.
28 the-paise             paise, not rupees. 2 decimal places, exact.
29 the-one-truth         the card turns. Behind it: one number, not five different ones.
30 the-choice            her hand. One tap, or twenty.
```

### ACT IV — THE RELIEF (beats 31–40, scroll 0.58–0.78) · focus: `self`
The same evening, now going right. Same beats, inverted.

```
31 same-night            the same street. Same sodium light. She is walking differently.
32 phone-warm            the phone is not a search bar. It is five labels.
33 tap-students          students, ordered, named, owed
34 tap-attendance        one tap marks the whole class
35 tap-fees              fee generated, attributed, dated
36 tap-paid              money in. Ledger balanced. Screen closes.
37 tap-settings          security. PIN. Biometric. The account is HERS.
38 the-breath            she exhales. Shoulders drop. This is the beat to hold.
39 walk-away             she walks. The street is the same. She is not.
40 the-corridor-flip     the corridor, now quiet, now lit, now hers
```

### ACT V — THE FIVE SCREENS (beats 41–50, scroll 0.78–1.00) · focus: `ledger`
The reveal. Five screens, in spec order. This is the product, honestly shown.

```
41 five-behind           five panes suspended in depth
42 screen-dashboard      dues, collected, heatmap
43 screen-students       the roster, the balances
44 screen-attendance     the month, marked
45 screen-fees           invoices, receipts, the void
46 screen-settings       security, backup, export
47 one-tap               ONE tap from any screen to any other — the product's actual promise
48 the-room              every tutor in the staffroom, all five screens live
49 the-instants          the ledger card at the centre, every screen agreeing with it
50 the-cta               the card settles. "Built for one room at a time." Download.
```

**Beat count is 50 by construction. If you add or merge a beat, the scroll ranges must still tile `0..1` with no gap and no overlap.** `beats.test.ts` asserts this — it counts beats, checks contiguity, and checks that ids are unique and ordered.

---

## 3. THE CHARACTER

The seeker. **A vendored, rigged human** — `public/scene/character/seeker.glb` — not seven primitives (amended 2026-10-21 by owner directive: a body assembled from capsules looks cheap). The asset's source, licence, attribution, SHA-256 and size budget are in `public/scene/character/ATTRIBUTION.md`; the rule that permits it is §0.1. It is served from this app's own origin and is never fetched from a third-party host.

Silhouette-first: she must be readable as a person at `z=40` and at `z=4`. Readability comes from proportion and pose, not from facial detail. A character with a face is out of budget and out of taste for this product.

```
build:
  the rig   62 joints, one mesh, one skin, one material, no textures
            bones: Hips, Chest, Neck, Head, Shoulder/UpperArm/LowerArm/Wrist
            (.L/.R), UpperLeg/LowerLeg/Foot (.L/.R), plus the finger chains
  height    1.79 world units, scaled from the rig's 1.81-unit rest pose
  phone     a box in her RIGHT hand, and the ONLY light source she carries
```

**Material:** one. `meshStandardMaterial`, `roughness 0.72`, `metalness 0.0`, colour from `--accent-text` at low intensity — she must never compete with the LedgerCard for attention. When the phone faces the camera, the phone's own emissive is the key light on her face. That contrast (dark figure, lit face) is the whole visual idea of Act I.

**Pose must change with the story — this is not optional.** At minimum:

| Act | Pose | Why |
|---|---|---|
| I | shoulders forward, head down, arms close to body, slow small movements | compression, searching |
| II | arms tighter, head turned slightly away, faster idle | anxiety |
| III | still. Hands at sides. Only the phone moves. | the pause before deciding |
| IV | shoulders open, head up, longer stride, arms swing | relief |
| V | upright, phone down at her side, occasionally raised | competence |

Implement pose as named keyframes on a small set of bone transforms, lerped by beat progress. **The rig gives her bones; it does not give her a performance.** There is no `AnimationMixer`, no `AnimationClip` and no "play a clip and hope": the vendored file's twenty-four animation clips were **stripped at vendoring time**, and each act's pose is a hand-authored keyframe written as numbers in the character's own frame (X is her left, Y is up, Z is the way she faces), applied to the rig's bones and lerped by the beat progress. That is what makes the pose answer the scroll directly instead of playing on a timer.

---

## 4. CAMERA DIRECTION — this is what the current build is missing

The existing `Journey` dollies a position along a curve. That is motion, not direction. A camera has to **look at something**, and the *look* is what tells the viewer where to look.

Three rules, all enforced:

**(a) Every beat declares a target, not just a position.** `camera.target` is mandatory in the `Beat` type (§2). Interpolate `target` with the same progress that interpolates `pos`.

**(b) Damped look-ahead.** The camera does not point at its target directly — it points slightly *ahead* along the path of travel. This is what makes a move feel operated rather than lerped.

```ts
const lookAhead = 0.12 // fraction of remaining path; tune 0.06–0.20
const desired = curve.getPointAt(min(t + lookAhead, 1))
const target   = curve.getPointAt(t)
camera.lookAt(dampVec(camera.userData.target, target, 4, delta))
```

**(c) Per-beat framing rules.** `camera.fov` per beat (see §7). Add `roll` (radians) for dutch angles — Act II only, max `±0.08`, so the chaos tilts and Act IV can level it as relief. Roll MUST return to exactly `0` by beat 38 or the recovery reads as a bug.

**Beat transitions must not cut.** Interpolate `pos`, `target` and `fov` independently with `THREE.MathUtils.damp` at a shared rate (≈3–4). Different rates per property is how you get seasickness.

**Act structure maps to camera language:**

| Act | Camera behaviour |
|---|---|
| I | wide, high, distant, slow. She is small in frame. FOV 55. |
| II | low, closing, FOV widening to 70 (compression), slight roll, handheld drift (±0.01 rad, noise-driven) |
| III | **push in hard, then stop dead.** FOV narrows to 38 at beat 21 and holds. The stillness after motion IS the beat. |
| IV | pull back, level, FOV 55, no roll. Warm. |
| V | slow orbit around the ledger card, FOV 45, the five screens arranged in depth |

---

## 5. IMPLEMENTATION SKILL CHOICES

You may write TypeScript, Python or C++. **TypeScript is the correct choice here and you should use it** — the scene must run in the browser against the already-installed three.js stack. Python/C++ would mean writing a renderer or an export pipeline that does not exist in this repo and adding binary assets, which §0.1 forbids. If you use Python or C++ anyway, it is only acceptable for **offline analysis** (measuring frame timings, validating geometry math), and its output must be consumed as numbers — never as an asset.

**Suggested breakdown if you split the work across tools:**

| Tool | Use it for |
|---|---|
| **Best single model** (see §11) | `scene-tiers.ts` quality ladder, beat timeline + camera rig — the parts needing the most reasoning |
| **A second pass** | `character.tsx` primitive assembly + pose keyframes |
| **A third pass** | copy module (`beats.ts`) — low reasoning, high volume, easy to verify |
| **Local tooling** | measurement + tests (§10) |

Run them **sequentially, not in parallel** — they share `scene-tiers.ts` and the beat type. Parallel edits to a shared type produce three conflicting versions.

---

## 6. FILE LAYOUT — follow this exactly

```
src/components/story/
  beats.ts              the 50-beat data + Beat type (§2)          NEW
  character.tsx         the seeker, primitives + pose rig (§3)    NEW
  camera-rig.tsx        target/look-ahead/roll/FOV (§4)           NEW
  act-directives.ts     SceneDirective → scene mutations (§7)    NEW
  story-canvas.tsx      the <Canvas> + scroll→progress wiring    NEW
  story-experience.tsx  the client wrapper (dynamic, ssr:false)  NEW

src/app/story/page.tsx  the SERVER page: H1 in SSR HTML, then   NEW
                        <StoryExperience/>. All five acts also
                        render as a static <ol> for no-JS and
                        for search crawlers — see §8.

tests/
  beats.test.ts         count, contiguity, uniqueness, ordering  NEW
  camera-rig.test.ts    target is mandatory; look-ahead; fov clamp
  performance.test.ts   draw calls, triangles, texture bytes     NEW
```

Existing `product-3d/` and `tour/_components/` keep their files. If a beat needs something that exists there, **import it**. Do not fork.

---

## 7. PERFORMANCE BUDGETS — enforced, not aspirational

Drawn from `20_3D_Product_Page.md` §11 and the existing `scene-tiers.ts` ladder. **Do not raise these.**

| Metric | Low tier | Mid | High |
|---|---|---|---|
| `renderer.info.render.calls` | ≤ 30 | ≤ 70 | ≤ 140 |
| `renderer.info.render.triangles` | ≤ 30k | ≤ 90k | ≤ 180k |
| `renderer.info.memory.textures` | ≤ 8 | ≤ 16 | ≤ 24 |
| DPR cap | 0.75 | 1.0–1.5 | ≤ 2 |
| Antialias samples | 0 | 1 | 4 |
| `MeshTransmissionMaterial` samples | 0 (fall back to standard) | 1 | 4 |
| target FPS | ≥ 30 | ≥ 50 | 60 |

Additional hard rules:

- **`frameloop="never"` when the canvas is off-screen** — `IntersectionObserver`, suspend on leave. (`fm-16`.) A page that burns a phone battery rendering an unseen corridor is a bug.
- **Cap DPR at 2 even on high tier.** Device pixel ratio 3 phones render 9× the fragments for no visible gain here.
- **All `useMemo` geometry/material creation; dispose on unmount.** `tour-tube.tsx` already models the dispose pattern — follow it.
- **`ScrollTrigger.refresh()`** after fonts settle, or beats drift against the camera.
- **`gsap.context()` + `ctx.revert()`** for every ScrollTrigger; `io.disconnect()` for every observer. (`fm-15`.) Leaked listeners across route changes are the single most common cause of the scroll jank this project has suffered.

---

## 8. ACCESSIBILITY — non-negotiable, and it is a spec requirement

`AGENTS.md` §2 Rule 10 and `20_3D_Product_Page.md` §4. A 3D scene is decorative and must never be a barrier to content.

1. **All 50 beats exist as static, readable HTML.** The server page renders a complete `<ol>` of every caption, above the canvas in the DOM. If WebGL fails, is disabled, or the visitor has JS off, they have read the entire story. This is the same rule `tour-copy.ts` already follows — reuse that approach.
2. **`<canvas aria-hidden="true">`.** The canvas is presentation; the `<ol>` is the content.
3. **Poster veil** (`Poster.tsx`) covers the canvas until the first frame renders. Never show an empty black rectangle. `fm-10`.
4. **`prefers-reduced-motion`**: full scene, **frozen**. No camera travel, no idle float, no particle motion, FOV parked, character held in a neutral pose. `scene-tiers.ts` already returns `frozen` — honour it everywhere.
5. **Keyboard**: the CTA is the keyboard target. Arrow keys / PageDown work (native scroll). Provide skip-to-content as the first focusable element.
6. **44×44px** minimum touch targets on any control.

---

## 9. SPEC AMENDMENT REQUIRED

`20_3D_Product_Page.md` §12 currently specifies **5 beats** (`0.00-0.25`, `0.25-0.55`, `0.55-0.70`, `0.70-0.85`, `0.85-1.00`). This brief replaces that with 50 beats across 5 acts.

Ship the code and the spec change **in the same commit**. The spec is the contract (`AGENTS.md` §0.1); code that diverges from it without amending it is orphan code. Record in the commit message that the beat map was deliberately expanded, and why.

**THE ASSET RULE WAS AMENDED TOO (2026-10-21, owner directive).** The brief's §0 rule 1 used to forbid *every* external asset. It now forbids every **generated** asset and permits a curated, licensed, vendored set — because a body assembled from seven capsules reads as a snowman, and the owner overruled the code-first rule for the character alone. The amendment to `20_3D_Product_Page.md` §12's *Assets:* paragraph lands in the same commit as the vendored file and the code that loads it, and the terms are the ones §0.1 lists: permissive licence, licence verified by reading it, provenance + SHA-256 in a file beside the asset, a written size budget, vendored and served from this app's own origin with **no runtime fetch to any third-party host** (Rule 2), and still no generated imagery, no HDRI, no video and no texture images unless the look needs them.

Do not touch: the DPR tier ladder (§11.3), the Poster veil (§2.2), H1-in-SSR-HTML, or the 44px/a11y rules. Those are correct.

---

## 10. VERIFICATION — what "done" means

**A build that renders is not done.** Every one of these must be true:

```bash
cd <repo>
bun run lint        # 0 errors
bun run typecheck   # 0 errors   ← this is the TS gate; eslint lints ~0 TS files
bun run test        # all pass, including the new tests below
bun run build       # exit 0
```

Required new tests:

| Test | Asserts |
|---|---|
| `beats.test.ts` | exactly 50 beats; unique ordered ids; scroll ranges tile `0..1` contiguously with no gap/overlap; every beat has a camera **target** and an fov in `[35, 90]`; Act II roll ≤ 0.08; beat 38 roll === 0 |
| `camera-rig.test.ts` | look-ahead clamps at t=1; damp is monotonic; fov interpolation never leaves `[35, 90]` |
| `performance.test.ts` | for each tier, the scene graph's total draw calls / triangles / textures stay within the §7 budget **counted from the constructed scene**, not measured in a browser |

**Negative control — mandatory.** For each of the three tests above, break the implementation, confirm the test goes **red**, then restore. A test that cannot fail guards nothing; that is how the cache-header defect survived a year of green CI in this repo.

Then verify in a real browser: scroll the full 50 beats and confirm (a) no beat is skipped or double-entered, (b) the camera never cuts between beats, (c) `renderer.info` stays inside budget while scrolling, (d) reduced-motion freezes it, (e) the static `<ol>` is readable with the canvas hidden.

---

## 11. WHICH MODEL

See the companion note at the bottom of this section.

**StepFun-5 is the right call for the code.** It is strong at multi-file TypeScript/React refactors with a shared type threaded across them, which is exactly this task — `Beat` flows from `beats.ts` into the character, the camera rig and the act directives, and getting that consistent across files is the hard part. Use it for `beats.ts`, `camera-rig.tsx`, `character.tsx`.

**Why not the free options for the main build:**

| Option | Verdict |
|---|---|
| StepFun-5 (yours) | **Use it.** Best cost/quality for this shape of work. |
| Kimi K2 Thinking (free tier) | Genuinely capable at long multi-file reasoning, but its tool-calling loop is slower and less reliable on edit-apply cycles. Fine as a **reviewer** of the finished code. |
| DeepSeek-R1 / Qwen3-Coder (free) | Good at single-file edits and test-writing. Weaker at the cross-file type coherence this task needs. Good for the independent test pass. |
| NVIDIA NIM | NIM is a *hosting* layer — it serves self-hosted or open models (Llama, Mistral, DeepSeek, Qwen). It is not itself a model, and "free" there means GPU cost, not a free tier. Useful only if you self-host. |
| Kilo Code | An agentic coding harness (like this one), not a model. Good at orchestrating multi-file work and running the gates; it delegates the reasoning to whatever model you point it at. |

**Recommended split:**

1. **StepFun-5** → `beats.ts`, `camera-rig.tsx`, `character.tsx`, `act-directives.ts` (the coupled core — must be one coherent pass)
2. **A free model (DeepSeek-R1 or Qwen3-Coder)** → write `tests/beats.test.ts`, `camera-rig.test.ts`, `performance.test.ts`. Test-writing is well-matched to their strengths and is genuinely independent work, so it parallelises cleanly with step 1.
3. **Kimi K2 Thinking** → review the merged result against this brief before merge. Ask it specifically: does every beat have a camera target; do the scroll ranges tile; is `frameloop` suspended off-screen; does reduced-motion actually freeze.

---

## 12. WHAT "GOOD" LOOKS LIKE

After 50 scrolls a visitor should be able to answer, unprompted:

- **What is it?** An operating system for a private tutor or small institute. Five screens.
- **What was wrong?** WhatsApp threads, an Excel sheet, a paper register. Named chaos, not abstract pain.
- **Why is it trustworthy?** The ledger only appends. A mistake becomes a second, compensating row — the wrong value survives *beside* the right one rather than vanishing. Money is integer paise. Receipt numbers never repeat.
- **Who is it for?** One tutor. One room. Their name on the settings screen.

If a visitor cannot answer those four, the 3D was decoration. If they can, it was storytelling. Build for the second one.