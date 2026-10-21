// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §3 (the seeker is a
// vendored, rigged human) and §10 (the tests must construct the very scene
// the visitor sees).
//
// THE SAME FILE THE BROWSER LOADS.
//
// The browser loads the character with drei's `useGLTF` from this app's own
// origin. The tests load the SAME BYTES off disk with three's own
// `GLTFLoader` and hand the parsed scene to `buildStoryScene`, so the budget
// the test enforces is the budget of the scene that is actually drawn.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Where the vendored character is on disk. */
export const CHARACTER_ASSET_PATH = fileURLToPath(
  new URL("../public/scene/character/seeker.glb", import.meta.url),
);

/** The vendored character's bytes. */
export function readCharacterAsset(): Buffer {
  return readFileSync(CHARACTER_ASSET_PATH);
}

/**
 * Loads the vendored character, exactly as the browser loads it.
 *
 * `GLTFLoader.parse` takes the ArrayBuffer of a GLB directly, so no HTTP
 * server and no DOM is needed: the file is read from disk and handed to the
 * same parser three.js uses in the browser.
 */
export function loadCharacterRig(): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const bytes = readCharacterAsset();
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    new GLTFLoader().parse(
      buffer,
      "",
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
