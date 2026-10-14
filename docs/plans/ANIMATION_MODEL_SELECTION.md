# WHICH MODEL FOR THE 3D SCROLL STORY

**Companion to:** `ANIMATION_MODEL_BRIEF.md` · **Date:** 2026-10-14

You asked which free model will help build the animations. Short answer: **your StepFun-5 is the right tool for the main build**, and free models are genuinely useful for two specific pieces of it. Details, and what I checked.

---

## 1. CLARIFYING TWO THINGS THAT GET CONFUSED

**NVIDIA NIM is not a model.** It is a serving layer — a container that hosts and serves open-weight models (Llama, Mistral, DeepSeek, Qwen, Nemotron). Asking "which NVIDIA NIM model" is like asking "which Docker image"; the answer is a base model *plus* NIM. "Free" on NIM means you pay for the GPU, not that there is a free tier. It is worth using only if you are self-hosting on hardware you already own.

**Kilo Code is not a model either.** It is an agentic coding harness — a thing that reads files, runs commands and calls a model. It is good at *orchestrating* this task: keeping `scene-tiers.ts` consistent across the character, camera rig and act directives, and running the gates. But the reasoning quality is whatever model you plug into it. If you point Kilo at a free model, you get free-model quality with Kilo's good plumbing.

So the real question is which **model** to point your harness at.

---

## 2. THE RECOMMENDATION

| Phase | Model | Why |
|---|---|---|
| **Core build** — `beats.ts`, `camera-rig.tsx`, `character.tsx`, `act-directives.ts` | **StepFun-5** (yours) | This is cross-file type-coherence work. One `Beat` type flows into four modules; if they disagree on field names or the `camera.target` shape, nothing typechecks and the failure is slow to diagnose. Your model handles multi-file React/TypeScript refactors with a shared contract well, and you own it — no rate-limit contention. |
| **Test pass** — `beats.test.ts`, `camera-rig.test.ts`, `performance.test.ts` | **DeepSeek-R1** or **Qwen3-Coder** (free) | Test-writing is the strongest match for free open models, and it is genuinely *independent* work — it can run in parallel with the core build without touching the same files. Free models are weakest at long multi-file state, which this phase does not need. |
| **Review** — before merge | **Kimi K2 Thinking** (free tier) | Give it the merged diff and `ANIMATION_MODEL_BRIEF.md` and ask the four specific questions in §5 below. It does not need to write code, only to check, which is where its long-context reasoning pays off without its edit-apply loop being tested. |

**Do not** use a free model for the camera rig. Look-ahead interpolation, damp rates, and a beat→FOV clamp that never leaves `[35,90]` is exactly the fiddly, stateful logic free models get wrong in ways that look right and feel wrong. Get that right first and the character is easy.

---

## 3. WHAT I ACTUALLY VERIFIED

I did **not** benchmark any of these models on this task — that would need a controlled eval harness, and guessing at numbers would be worse than useless. What I can tell you is grounded in the task's shape and in how these models are known to behave:

- The repo's existing 3D code (`Journey.tsx`, `scene-tiers.ts`) is the reference for difficulty. It already does `CatmullRomCurve3` + `useFrame` + `MathUtils.damp`. The new work adds a **mandatory camera target** on all 50 beats, **look-ahead**, **per-beat FOV**, **roll**, and a **character with pose keyframes**. That is a moderate amount of new maths — not research-grade, not trivial.
- Free open coding models are consistently better at bounded single-file edits and test generation than at multi-file refactors that must keep a shared type consistent. That split is well established.
- Kimi K2 Thinking's long-context reasoning is a real strength for review tasks.

Model availability and free-tier limits change weekly — **check your provider's current pricing before committing**, since "free tier" on these platforms is typically a metered allowance that resets, not an unlimited grant.

---

## 4. IF YOU WANT TO COMPARE BEFORE COMMITTING

Run one throwaway prompt through each candidate on the *same* small slice — the camera rig alone, since that is the hard part — and compare on four things:

1. Does the `Beat` type it invents have a **mandatory `camera.target`**? (If optional, it will quietly skip look-ahead and you have the current bug again.)
2. Does the FOV clamp hold at **both** ends — `t=0` and `t=1` — or only mid-path?
3. Does it handle **`t + lookAhead > 1`** without going out of bounds?
4. Does `ScrollTrigger.refresh()` appear in its output? (Misses this → beats drift against the camera. `fm-21`.)

Four minutes of A/B will tell you more than any model card.

---

## 5. THE FOUR QUESTIONS TO ASK THE REVIEWER

Give this to whichever model reviews, verbatim:

```
Against ANIMATION_MODEL_BRIEF.md, review this diff and answer ONLY these,
with file:line evidence for each. If a check passes, say so in one line.

1. Does EVERY beat in beats.ts declare a non-optional camera.target? List any
   that omit it.
2. Do the scroll ranges tile 0..1 with no gap and no overlap? Name the exact
   boundary where they meet.
3. Is frameloop suspended when the canvas leaves the viewport, and are all
   ScrollTriggers created inside gsap.context() with ctx.revert() on cleanup?
   Name any listener created outside a context.
4. Under prefers-reduced-motion, is EVERY motion source disabled — camera
   travel, idle float, particles, character pose, FOV whip — or are some
   still running?

Then flag anything that contradicts the brief's performance budgets in §7.
```

---

## 6. THE ONE THING THAT MATTERS MOST

Whatever model you use, the brief already sets the standard: **a build that renders is not done.** It is done when the three tests pass, each has been proven to go **red** when the fix is reverted, and you have scrolled all 50 beats in a real browser.

That negative-control requirement is not bureaucracy. It is written into the brief because of how this repo actually works: `apps/gateway` shipped student PII as publicly cacheable for a year of green CI, because the only test asserted on the *constant* and never on the response a client receives. A test that cannot fail is worse than no test — it tells you that you are protected while you are not.