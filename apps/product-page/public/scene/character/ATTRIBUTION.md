# xbot.glb — the seeker's rig

**What this is.** The character rig the 50-beat story site's seeker is built
from. It replaces the seven primitives (a capsule torso, a sphere head, a
cylinder neck, two arm capsules, two leg capsules) that read as cheap.

**The file.**

| | |
|---|---|
| Path | `apps/product-page/public/scene/character/xbot.glb` |
| Size | 2,930,032 bytes |
| SHA-256 | see `sha256.txt` beside this file |
| Source | `https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb` |
| Retrieved | 2026-10-21 |
| Structure | 70 nodes · 1 skin (a real skeleton) · 7 animation clips · 2 meshes · 2 primitives · **0 images** |
| Bones | Mixamo naming: `mixamorigHips`, `mixamorigSpine`, `mixamorigHead`, `mixamorigLeftArm`, `mixamorigRightLeg`, … |

**Why this file and not the low-poly packs.** The character packs that are
genuinely CC0 (Kenney's "Animated Characters", Quaternius) are stylised
low-poly, and the first version of the seeker was built from primitives for
the same reason — it read as cheap. This rig is a properly proportioned human
with a full skeleton, and it is the largest human asset that is fetchable
without an account or an API key.

**Why the file carries no texture.** The GLB has no embedded images, so the
character is shaded with the APP's own material — the palette's accent role at
a low intensity — and the silhouette reads as a person without a texture
image ever entering the repo. The skin and the clip data are what cost the
2.9 MB, and that is the detail the owner asked for.

**The licence — PLEASE READ, this needs the owner's ratification.** Xbot is
originally a **Mixamo** model (Adobe). three.js (MIT) vendors the file in its
`examples/models/gltf/` directory, and this file is that exact file. Mixamo's
terms grant use of the assets in a project; whether they grant *redistribution
of the asset file itself* is not something this repository can settle, and the
file is being redistributed here.

This is recorded the same way the GSAP licence is recorded in
`docs/audit/REMEDIATION-PLAN-2026-10-21.md`: **an owner decision, stated
plainly, not buried.** The options are

1. **ratify it** — the file stays, the attribution below stands, and the
   character keeps a real rig;
2. **swap it** — replacing `xbot.glb` with a CC0 human is a one-file change
   (the loader reads the path, the bone names are the same Mixamo convention
   the CC0 packs use), and the alternatives already surveyed are
   `CesiumMan` (CC-BY 4.0, 438 KB, a chunky figure) and Kenney's
   "Animated Characters 3" (CC0, low-poly — the look this was chosen to
   replace).

Until the owner decides, nothing else in the product depends on this file:
the scene, the budget, the camera and the story all work with whatever rig is
in this directory.

**Attribution.** "Xbot" by Adobe (Mixamo), vendored by the three.js project
(MIT). The three.js project distributes it under its own repository terms;
the underlying asset remains Adobe's.
