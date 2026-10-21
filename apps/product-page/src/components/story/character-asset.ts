// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §0.1 (the vendored-asset
// rule: a small, curated, LICENSED set of vendored assets, with the source,
// the licence, the attribution and the SHA-256 recorded beside the file, a
// size budget, and no runtime fetch) and §3 (the seeker is a vendored, rigged
// human).
//
// THIS MODULE IS THE PROVENANCE. The character is not code any more: it is a
// glTF binary in `public/`, served from this app's own origin. Nothing here
// fetches a third-party host at runtime (AGENTS.md §2 Rule 2) - the file is
// in the repository, and `ATTRIBUTION.md` sits beside it with the source, the
// licence, where the licence was verified, and the SHA-256.

/** Where the vendored character lives, served from this app's own origin. */
export const CHARACTER_ASSET_URL = "/scene/character/seeker.glb";

/**
 * The SHA-256 of the vendored file. `tests/character-rig.test.ts` reads the
 * file off disk and fails if the hash moves, so the file in the repository and
 * the file this module describes are the same file.
 */
export const CHARACTER_ASSET_SHA256 =
  "979f8c644b6f8831e0189edc28740fe8ba4ec09e39c5e25eab0b898e8d424cdb";

/**
 * The size budget for the vendored character assets, in bytes.
 *
 * The character is 724,092 bytes, so this file alone uses 72 % of it. The
 * budget exists because a binary asset is the one thing in this project that
 * nobody notices growing: it is not a dependency, it is not in the JS payload
 * budget, and it costs the visitor a download.
 */
export const CHARACTER_ASSET_BYTE_BUDGET = 1_000_000;

/**
 * The rig's bones, by the names three.js gives them.
 *
 * The glTF calls them `UpperArm.L` and `LowerArm.L`; `GLTFLoader` sanitises
 * node names, and the sanitised name is what the code looks up. The names
 * here are the sanitised ones, and the test asserts every one of them
 * resolves in the loaded rig.
 */
export const SEEKER_BONE_NAMES = {
  hips: "Hips",
  chest: "Chest",
  neck: "Neck",
  head: "Head",
  upperArmL: "UpperArmL",
  lowerArmL: "LowerArmL",
  wristL: "WristL",
  upperArmR: "UpperArmR",
  lowerArmR: "LowerArmR",
  wristR: "WristR",
  indexR: "Index1R",
  upperLegL: "UpperLegL",
  lowerLegL: "LowerLegL",
  footL: "FootL",
  upperLegR: "UpperLegR",
  lowerLegR: "LowerLegR",
  footR: "FootR",
} as const;

/** The bones the per-act keyframes drive, in the order they are applied. */
export const SEEKER_DRIVEN_BONES = [
  "hips",
  "chest",
  "neck",
  "head",
  "upperArmL",
  "lowerArmL",
  "upperArmR",
  "lowerArmR",
  "upperLegL",
  "lowerLegL",
  "upperLegR",
  "lowerLegR",
] as const;

/** The kind of bone a driven bone is. */
export type DrivenBoneName = (typeof SEEKER_DRIVEN_BONES)[number];

/**
 * The licence, for the record. The file's own `asset.copyright` block says
 * the same thing; this copy is here so the code can state it without reading
 * a binary.
 */
export const CHARACTER_ASSET_LICENCE = {
  /** SPDX-ish identifier. */
  id: "CC0-1.0",
  /** The human name of the licence. */
  name: "CC0 1.0 Universal (public domain dedication)",
  /** Where the licence text lives. */
  url: "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
  /** Who made the model. */
  author: "Quaternius",
  /** Where the file was obtained. */
  source: "https://poly.pizza/m/qJ2gsTUBHL",
  /** Where the licence was verified, in prose. */
  verifiedAt:
    "https://poly.pizza/m/qJ2gsTUBHL (the page's initialData records \"Licence\":\"CC0 1.0\" and \"Creator\":{\"Username\":\"Quaternius\"}), https://poly.pizza/docs/tos (Content Ownership: downloading means adhering to the Creative Commons licence that applies), and the file's own asset.copyright block.",
} as const;
