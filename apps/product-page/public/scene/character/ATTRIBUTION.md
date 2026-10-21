# The seeker — vendored asset

The seeker in the 50-beat story is **not** built from primitives any more. She
is a real, rigged human, vendored into this repository as a single glTF 2.0
binary and served from this app's own origin.

`docs/plans/ANIMATION_MODEL_BRIEF.md` §0.1 and `20_3D_Product_Page.md` §12
were amended in the same commit that vendored this file: the rule is now
**no GENERATED assets; a small, curated, LICENSED set of vendored assets is
permitted**, with the source, the licence, the attribution and the SHA-256
recorded beside the file, a size budget, and no runtime fetch.

---

## The file

| | |
|---|---|
| **File** | `apps/product-page/public/scene/character/seeker.glb` |
| **Format** | glTF 2.0 binary (GLB), one mesh, one skin, 62 joints, one material, no textures, no animations |
| **Size** | **724,092 bytes** (706 KB) |
| **SHA-256** | `979F8C644B6F8831E0189EDC28740FE8BA4EC09E39C5E25EAB0B898E8D424CDB` |
| **Triangles** | 6,424 |
| **Vertices** | 12,968 |
| **Draw calls** | 1 (one `SkinnedMesh`, one primitive) |
| **Textures** | 0 |
| **Served from** | `https://<this app's own origin>/scene/character/seeker.glb` |

## The source

| | |
|---|---|
| **Model** | *Animated Woman* (the "Casual" variant) |
| **Author** | **Quaternius** — <https://quaternius.com/> (Poly Pizza links the author's Twitter and Patreon as `quaternius`) |
| **Distribution** | Poly Pizza — <https://poly.pizza/m/qJ2gsTUBHL> |
| **File URL** | <https://static.poly.pizza/ba7a1955-ea51-4cb9-a561-188bdef0a6c7.glb> |
| **Upstream size** | 1,530,616 bytes |
| **Upstream SHA-256** | `A2212729826B718E59E698211ED3951C22459B48733B1EE6A24FAC0ABF74DCA8` |
| **Licence** | **CC0 1.0 Universal** (public domain dedication) |
| **Licence text** | <https://creativecommons.org/publicdomain/zero/1.0/legalcode> |

### Where the licence was VERIFIED

Not from a search result. Three places, all read directly:

1. **Poly Pizza's own model page** — `https://poly.pizza/m/qJ2gsTUBHL`. The
   page's embedded `initialData` JSON records the model verbatim:

   ```json
   {"Title":"Animated Woman","Creator":{"Username":"Quaternius","Socials":{
     "Twitter":"quaternius","Pateron":"quaternius","Website":"https://quaternius.com/"}},
    "Licence":"CC0 1.0","Animated":true,"Type":"FBX","Visibility":"Public"}
   ```

   `"Licence":"CC0 1.0"` is the licence Poly Pizza states for this model, and
   the page renders the CC0 badge from it.
2. **Poly Pizza's Terms of Service** — `https://poly.pizza/docs/tos`, section
   *Content Ownership*: *"By downloading User Content made available by other
   Users, you agree to adhere to the terms of the Creative Commons license
   that applies at the time of download."* Downloading this file is therefore
   a licensed act, and the licence that applies is CC0 1.0.
3. **The file's own `asset.copyright` block**, written by the vendoring step
   (below) and readable in any glTF inspector:

   ```json
   {
     "copyright": "Character 'Animated Woman' (Casual) by Quaternius - CC0 1.0 Universal. Distributed by Poly Pizza: https://poly.pizza/m/qJ2gsTUBHL . Modified for this repository: ...",
     "extras": {
       "licence": "CC0-1.0",
       "licenceUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
       "author": "Quaternius",
       "source": "https://poly.pizza/m/qJ2gsTUBHL",
       "modified": true
     }
   }
   ```

### Attribution

CC0 does not require attribution, and none is legally owed. It is recorded
here anyway, because a provenance trail is the point of this file:
**"Animated Woman" by Quaternius, CC0 1.0, via Poly Pizza.**

## The rig

62 joints. The names below are the ones **three.js gives them after
`GLTFLoader` sanitises the glTF names** (glTF's `UpperArm.L` becomes
`UpperArmL`), because those are the names the code looks up.

```
Root, Body, Hips, Abdomen, Torso, Chest, Neck, Head,
ShoulderL, UpperArmL, LowerArmL, WristL, Index1L..4L, Middle1L..4L,
Ring1L..4L, Pinky1L..4L, Thumb1L..3L,
ShoulderR, UpperArmR, LowerArmR, WristR, Index1R..4R, Middle1R..4R,
Ring1R..4R, Pinky1R..4R, Thumb1R..3R,
UpperLegL, LowerLegL, FootL, UpperLegR, LowerLegR, FootR
```

The figure stands **1.81 units** tall in its rest pose, arms down and slightly
out (an A-pose), facing **+Z**, with her **left** on **+X**.

## What was changed, and why

The upstream file is a game-ready asset with 24 animation clips and seven
materials. The story site needs neither. The vendoring step:

1. **removed all 24 animation clips.** The seeker's pose is
   hand-authored keyframes on the rig's bones, lerped by the beat progress
   (brief §3). There is no `AnimationMixer` and no `AnimationClip` in this
   project, and shipping 1.2 MB of clips that are never played is dead weight.
2. **removed the texture coordinates.** The model has no textures; the look
   is one palette role, not an image.
3. **collapsed the seven materials into one.** The body is one
   `meshStandardMaterial` in the app's palette — no texture images and no
   colour literals (AGENTS.md §2 Rule 5).
4. **merged the nine skinned primitives into one mesh.** The four skins agree
   on the joint order and on the inverse bind matrices, so the primitives can
   share one mesh and one skin. One draw call instead of nine.

Net effect: **1,530,616 → 724,092 bytes**, and 9 draw calls → 1.

## The size budget

**The vendored character assets may not exceed 1,000,000 bytes in total.**
This file is 724,092 bytes, so it uses 72 % of the budget on its own. The
budget is checked by `apps/product-page/tests/character-rig.test.ts`, which
reads the file's size and its SHA-256 off disk and fails if either moves
without this file being updated.

## No runtime fetch

The file is served from this app's own origin, from `public/`. Nothing in the
story fetches a third-party host at runtime (AGENTS.md §2 Rule 2): no CDN, no
asset host, no `Environment preset`, no HDRI. The scene is built from what is
in this repository.

---

## What was considered, and rejected

The record matters as much as the choice: an asset that was downloaded and
then dropped is a decision someone will otherwise make again.

| Candidate | Licence | Why not |
|---|---|---|
| **`Xbot.glb`** — three.js's example model (`examples/models/gltf/Xbot.glb`), a rigged human with Mixamo bone names | **Adobe Mixamo.** Vendored by the three.js project (MIT), but the asset itself is Adobe's, and Mixamo grants *use in a project* — whether it grants **redistribution of the asset file** is not something this repository can settle | The owner's rule for this work is **CC0, CC-BY or MIT, verified by reading the licence**, and **Mixamo is named as out**. A 2.9 MB binary with an unresolved redistribution right is not a licence this project can take. It was removed from the tree in the same commit that vendored this file. |
| **CesiumMan** — Khronos `glTF-Sample-Assets` | CC BY 4.0 (© 2017 Cesium) | A real human with a 19-bone skeleton and no textures — but a **man**, and the story's seeker is a woman ("she" in ten of the fifty captions) |
| **Khronos `RiggedFigure`** | CC BY 4.0 | 256 triangles: a proxy, not a body. It would have looked cheaper than the capsules |
| **Kenney "Animated Characters", Quaternius' character packs** | CC0 | Genuinely open, but **stylised low-poly** — the look the owner asked to replace |
| **Poly Pizza "Female Officer"** (fully rigged, CC BY 3.0) | CC BY 3.0 | The licence is fine, but the model page was not machine-reachable without an API key, and its rig carries **finger bones but no arm or leg bones** — the pose could not be driven |
| **Poly Pizza "Animated Woman"** (the file vendored here) | **CC0 1.0** | **Chosen.** A real, properly proportioned human with a full humanoid rig and no textures |
| **Mixamo, Sketchfab's API, Ready Player Me** | — | Need an account, a key or a click-through licence. Not candidates |
| **`antics.gg` "Rigged figure"** | CC BY 4.0 | A procedurally generated mannequin — a stand-in for a crowd, which is the look the owner rejected |
| **An HDRI environment, a video, a generated still** | — | Forbidden by the rule that survives this amendment: no HDRI fetch, no video, no generated imagery |

