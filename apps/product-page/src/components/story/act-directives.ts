// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §4 (what a beat does to the
// scene), §3 (the seeker's placement) and §7 (the tier ladder and the
// performance budgets that are enforced, never raised).
//
// THE SCENE IS CODE, WITH ONE VENDORED ASSET. Every mesh, every material and
// every light in this story is written in TypeScript against three.js, with
// ONE exception: the seeker is a vendored, rigged human
// (`public/scene/character/seeker.glb`), because a body built from capsules
// looks like a snowman. The asset is licensed, attributed and hashed in
// `public/scene/character/ATTRIBUTION.md`, and it is served from this app's
// own origin - nothing is fetched from a third-party host at runtime
// (brief §0.1, AGENTS.md §2 Rule 2).
//
// WHY THE SCENE IS BUILT IN THREE.JS AND NOT IN JSX. The budget is a
// correctness requirement, and a budget you cannot measure is a budget you
// cannot keep. The scene is therefore built by one factory that both the
// renderer and `tests/performance.test.ts` use: the test constructs the very
// scene the visitor sees, walks it with the very camera the visitor sees, and
// counts the draw calls and triangles that would be issued.
//
// THE TIER LADDER. `scene-tiers.ts` is the single ladder for the app; this
// module reads it rather than inventing a second one. The story's tiers are
// that ladder's three rungs, and each one decides three things: how many
// bodies are in the corridor, how many rows the ledger shows, and whether the
// card is a real refractive material at all.

import * as THREE from "three";
import { createSeeker } from "./character";
import type { Seeker } from "./character";
import { resolveCardPosition } from "./beats";
import type { SceneDirective } from "./beats";
import type { GpuClass } from "../product-3d/scene-tiers";

/** The three rungs of the ladder. */
export type StoryTier = "low" | "mid" | "high";

/**
 * THE BUDGET (brief §7). These numbers are the spec's; they are enforced by
 * `tests/performance.test.ts` and they are never raised to fit a scene. A
 * scene that misses them is simplified until it fits.
 */
export interface StoryBudget {
  /** `renderer.info.render.calls` - the draw calls one frame may issue. */
  readonly drawCalls: number;
  /** `renderer.info.render.triangles` - the triangles one frame may issue. */
  readonly triangles: number;
  /** `renderer.info.memory.textures` - the textures the scene may hold. */
  readonly textures: number;
  /** The device pixel ratio the renderer may use. */
  readonly dpr: readonly [number, number];
  /** The antialiasing samples. 0 means no antialiasing at all. */
  readonly antialiasSamples: 0 | 1 | 4;
  /** The transmission samples. 0 means the card falls back to a standard material. */
  readonly transmissionSamples: 0 | 1 | 4;
  /** The frame rate the tier is aiming at. */
  readonly targetFps: number;
}

export const STORY_BUDGETS: Readonly<Record<StoryTier, StoryBudget>> = {
  low: {
    drawCalls: 30,
    triangles: 30_000,
    textures: 8,
    dpr: [0.75, 0.75],
    antialiasSamples: 0,
    transmissionSamples: 0,
    targetFps: 30,
  },
  mid: {
    drawCalls: 70,
    triangles: 90_000,
    textures: 16,
    dpr: [1, 1.5],
    antialiasSamples: 1,
    transmissionSamples: 1,
    targetFps: 50,
  },
  high: {
    drawCalls: 140,
    triangles: 180_000,
    textures: 24,
    dpr: [1, 2],
    antialiasSamples: 4,
    transmissionSamples: 4,
    targetFps: 60,
  },
};

/**
 * Which rung a device gets.
 *
 * The low rung is the app's own `lowEnd` gate (Save-Data, a weak CPU, a
 * phone-sized viewport) and the high rung is a discrete GPU. Everything else
 * is the mid rung - the one the app's own 50 fps bar is written against.
 */
export function resolveStoryTier(lowEnd: boolean, gpuClass: GpuClass): StoryTier {
  if (lowEnd) return "low";
  return gpuClass === "discrete" ? "high" : "mid";
}

/** How much of the set each tier builds. */
interface TierCounts {
  readonly crowd: number;
  readonly registers: number;
  readonly bubbles: number;
  /** The corridor's strip lights. */
  readonly strips: number;
  readonly rows: number;
  readonly links: number;
  readonly listings: number;
  readonly labels: number;
  /** The accent bar under each of the five screens. */
  readonly screenBars: boolean;
  /** The ledger card's lit edge. */
  readonly cardEdges: boolean;
  /** The glow behind the class board. */
  readonly boardGlow: boolean;
}

/**
 * THE LOW RUNG IS A DIFFERENT SCENE, NOT A DIMMER ONE.
 *
 * The budget is a correctness requirement, and the low rung has thirty draw
 * calls for a whole frame. The things that go are the ones that cost a call
 * each and carry the least: the accent bar under each of the five screens,
 * the card's lit edge, and the glow behind the class board. The screens, the
 * card and the board all stay - the scene is still the story, it is just
 * drawn with fewer parts.
 */
const TIER_COUNTS: Readonly<Record<StoryTier, TierCounts>> = {
  low: {
    crowd: 5,
    registers: 3,
    bubbles: 4,
    strips: 2,
    rows: 3,
    // The hash-chain links are the first thing to go: the rows already carry
    // the chain, and the caption carries the rest.
    links: 0,
    listings: 1,
    labels: 2,
    screenBars: false,
    cardEdges: false,
    boardGlow: false,
  },
  mid: {
    crowd: 12,
    registers: 6,
    bubbles: 8,
    strips: 3,
    rows: 6,
    links: 6,
    listings: 3,
    labels: 5,
    screenBars: true,
    cardEdges: true,
    boardGlow: true,
  },
  high: {
    crowd: 18,
    registers: 9,
    bubbles: 12,
    strips: 3,
    rows: 8,
    links: 8,
    listings: 3,
    labels: 5,
    screenBars: true,
    cardEdges: true,
    boardGlow: true,
  },
};

/**
 * The colours the story's set pieces are built from.
 *
 * Every one of them is a PALETTE ROLE, never a literal (AGENTS.md §2 Rule 5).
 * The app's `SceneTokens` satisfies this shape structurally, so the scene
 * follows whichever palette is live.
 */
export interface StoryColours {
  readonly sunken: string;
  readonly inset: string;
  readonly raised: string;
  readonly accent: string;
  readonly accentText: string;
  readonly info: string;
  readonly warn: string;
  readonly key: string;
}

/** The constructed story scene, and everything it owns. */
export interface StoryScene {
  /** The whole scene. Mounted with `<primitive>`. */
  readonly group: THREE.Group;
  /** The seeker and her bones. */
  readonly seeker: Seeker;
  /** The ledger card and everything printed on it. */
  readonly card: THREE.Group;
  /** The card's material, so the tier can be checked. */
  readonly cardMaterial: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  /** The four set pieces. The relief set is the street again - the same one. */
  readonly sets: Readonly<Record<"street" | "corridor" | "ledger" | "screens", THREE.Group>>;
  /** The corridor's strip lights, so the mood can change them. */
  readonly stripMaterial: THREE.MeshStandardMaterial;
  /** The street's sodium lamp. */
  readonly lampMaterial: THREE.MeshStandardMaterial;
  /** The corridor's two walls, so the corridor can close in. */
  readonly corridorWalls: readonly [THREE.Mesh, THREE.Mesh];
  /** The crowd in the corridor. */
  readonly crowd: readonly THREE.Mesh[];
  /** The message bubbles in the corridor. */
  readonly bubbles: readonly THREE.Mesh[];
  /** The paper registers in the corridor. */
  readonly registers: readonly THREE.Mesh[];
  /** Everything allocated, so the scene can free it on unmount. */
  readonly disposables: readonly { dispose(): void }[];
  /** Frees every geometry and material the scene allocated. */
  dispose(): void;
}

/**
 * A seeded generator. `Math.random` in a render path makes the server's
 * markup and the client's first frame disagree (FM-14), so every scattered
 * element in the story is placed from a seed.
 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const CARD_SIZE = { width: 3.2, height: 2, depth: 0.12 } as const;

/** Where the five screens hang, in depth (brief §2, Act V). */
export const SCREEN_PANES: ReadonlyArray<readonly [number, number, number]> = [
  [-3.2, 1.65, 0.8],
  [-1.6, 1.65, 1.3],
  [0.0, 1.65, 1.7],
  [1.6, 1.65, 2.1],
  [3.2, 1.65, 2.4],
];

/**
 * Builds the story scene for a tier.
 *
 * `rig` is the loaded seeker: the vendored, rigged human. It is passed in
 * rather than loaded here, so the browser (which loads it with drei's
 * `useGLTF`) and the budget test (which loads it off disk) build the very
 * same scene from the very same file.
 *
 * The four set pieces are built once and switched by the directive, because
 * building and destroying geometry every frame is what turns a story into a
 * stutter.
 */
export function buildStoryScene(
  tier: StoryTier,
  colours: StoryColours,
  rig: THREE.Group,
): StoryScene {
  const counts = TIER_COUNTS[tier];
  const budget = STORY_BUDGETS[tier];
  const disposables: { dispose(): void }[] = [];
  const rand = seeded(20261021);

  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const group = new THREE.Group();
  group.name = "story-scene";

  /* -- materials ---------------------------------------------------------- */

  const groundMaterial = track(
    new THREE.MeshStandardMaterial({ color: colours.sunken, roughness: 0.95, metalness: 0 }),
  );
  const structureMaterial = track(
    new THREE.MeshStandardMaterial({ color: colours.inset, roughness: 0.85, metalness: 0.05 }),
  );
  const furnitureMaterial = track(
    new THREE.MeshStandardMaterial({ color: colours.raised, roughness: 0.7, metalness: 0.05 }),
  );
  const crowdMaterial = track(
    new THREE.MeshStandardMaterial({ color: colours.inset, roughness: 0.9, metalness: 0 }),
  );
  const glowMaterial = track(
    new THREE.MeshBasicMaterial({
      color: colours.accent,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  const stripMaterial = track(
    new THREE.MeshStandardMaterial({
      color: colours.info,
      emissive: new THREE.Color(colours.info),
      emissiveIntensity: 2.2,
      roughness: 0.4,
      metalness: 0,
    }),
  );
  const lampMaterial = track(
    new THREE.MeshStandardMaterial({
      color: colours.warn,
      emissive: new THREE.Color(colours.warn),
      emissiveIntensity: 2.2,
      roughness: 0.4,
      metalness: 0,
    }),
  );
  const bubbleMaterial = track(
    new THREE.MeshStandardMaterial({
      color: colours.info,
      emissive: new THREE.Color(colours.info),
      emissiveIntensity: 0.9,
      roughness: 0.5,
      metalness: 0,
    }),
  );
  const rowMaterial = track(
    new THREE.MeshBasicMaterial({
      color: colours.accent,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  const linkMaterial = track(
    new THREE.MeshBasicMaterial({
      color: colours.info,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
  );
  const screenMaterial = track(
    new THREE.MeshStandardMaterial({
      color: colours.raised,
      emissive: new THREE.Color(colours.key),
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  const screenBarMaterial = track(
    new THREE.MeshBasicMaterial({ color: colours.accent, transparent: true, opacity: 0.85 }),
  );

  /* -- the ground --------------------------------------------------------- */

  const groundGeometry = track(new THREE.PlaneGeometry(70, 70));
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  /* -- the street (Act I and Act IV) -------------------------------------- */

  const street = new THREE.Group();
  street.name = "set-street";
  group.add(street);

  // The street's two walls. They stop short of the corridor's mouth, so the
  // corridor's frames do not pay for them.
  const wallGeometry = track(new THREE.BoxGeometry(1.4, 7, 16));
  for (const x of [-6.4, 6.4]) {
    const wall = new THREE.Mesh(wallGeometry, structureMaterial);
    wall.position.set(x, 3.5, 6);
    street.add(wall);
  }

  const boardGeometry = track(new THREE.PlaneGeometry(2.4, 1.4));
  const board = new THREE.Mesh(boardGeometry, screenMaterial);
  board.position.set(3.4, 2.4, 1.2);
  board.rotation.y = -Math.PI / 2;
  street.add(board);

  const boardGlowGeometry = track(new THREE.PlaneGeometry(3.6, 2.6));
  if (counts.boardGlow) {
    const boardGlow = new THREE.Mesh(boardGlowGeometry, glowMaterial);
    boardGlow.position.set(3.44, 2.4, 1.2);
    boardGlow.rotation.y = -Math.PI / 2;
    street.add(boardGlow);
  }

  const listingGeometry = track(new THREE.PlaneGeometry(1.1, 0.3));
  for (let i = 0; i < counts.listings; i += 1) {
    const listing = new THREE.Mesh(listingGeometry, rowMaterial);
    listing.position.set(3.37, 1.45 - i * 0.36, 1.2);
    listing.rotation.y = -Math.PI / 2;
    street.add(listing);
  }

  const lampGeometry = track(new THREE.BoxGeometry(0.6, 0.18, 0.18));
  const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
  lamp.position.set(-3.2, 3.4, 2.6);
  street.add(lamp);

  /* -- the corridor (Act II, and quiet in Act IV) ------------------------- */

  const corridor = new THREE.Group();
  corridor.name = "set-corridor";
  group.add(corridor);

  const corridorWallGeometry = track(new THREE.BoxGeometry(0.3, 4.6, 9));
  const corridorWalls: [THREE.Mesh, THREE.Mesh] = [
    new THREE.Mesh(corridorWallGeometry, structureMaterial),
    new THREE.Mesh(corridorWallGeometry, structureMaterial),
  ];
  corridorWalls[0].position.set(-3.0, 2.3, -3.5);
  corridorWalls[1].position.set(3.0, 2.3, -3.5);
  corridor.add(corridorWalls[0], corridorWalls[1]);

  const ceilingGeometry = track(new THREE.BoxGeometry(6.4, 0.2, 9));
  const ceiling = new THREE.Mesh(ceilingGeometry, structureMaterial);
  ceiling.position.set(0, 4.5, -3.5);
  corridor.add(ceiling);

  const stripGeometry = track(new THREE.BoxGeometry(0.5, 0.09, 1.8));
  const stripPositions = counts.strips <= 2 ? [-1.6, -4.6] : [-0.8, -3.4, -6.0];
  for (const z of stripPositions) {
    const strip = new THREE.Mesh(stripGeometry, stripMaterial);
    strip.position.set(0, 4.22, z);
    corridor.add(strip);
  }

  const crowdGeometry = track(new THREE.CapsuleGeometry(0.17, 0.8, 4, 8));
  const crowd: THREE.Mesh[] = [];
  for (let i = 0; i < counts.crowd; i += 1) {
    const body = new THREE.Mesh(crowdGeometry, crowdMaterial);
    body.position.set((rand() - 0.5) * 4.2, 0.57, -0.6 - rand() * 6.4);
    body.rotation.y = rand() * Math.PI;
    crowd.push(body);
    corridor.add(body);
  }

  const registerGeometry = track(new THREE.BoxGeometry(0.44, 0.07, 0.32));
  const registers: THREE.Mesh[] = [];
  for (let i = 0; i < counts.registers; i += 1) {
    const register = new THREE.Mesh(registerGeometry, furnitureMaterial);
    register.position.set(
      (rand() > 0.5 ? 1 : -1) * (1.6 + rand() * 1.1),
      0.9 + rand() * 0.9,
      -1 - rand() * 6,
    );
    register.rotation.set(rand() * 0.6, rand() * Math.PI, rand() * 0.5);
    registers.push(register);
    corridor.add(register);
  }

  const bubbleGeometry = track(new THREE.BoxGeometry(0.34, 0.13, 0.02));
  const bubbles: THREE.Mesh[] = [];
  for (let i = 0; i < counts.bubbles; i += 1) {
    const bubble = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
    bubble.position.set((rand() - 0.5) * 4.4, 1.3 + rand() * 1.5, -1 - rand() * 6);
    bubbles.push(bubble);
    corridor.add(bubble);
  }

  /* -- the ledger card (Act III, and the centre of Act V) ----------------- */

  const ledger = new THREE.Group();
  ledger.name = "set-ledger";
  group.add(ledger);

  const card = new THREE.Group();
  card.name = "ledger-card";
  ledger.add(card);

  const cardGeometry = track(
    new THREE.BoxGeometry(CARD_SIZE.width, CARD_SIZE.height, CARD_SIZE.depth),
  );
  // The tier decides the material, not the other way round: the low tier has
  // no transmission at all (brief §7: "0, fall back to standard"), because a
  // refractive material on a phone that cannot afford it costs the whole
  // frame for a card nobody can read.
  const cardMaterial: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial =
    budget.transmissionSamples === 0
      ? track(
          new THREE.MeshStandardMaterial({
            color: colours.key,
            roughness: 0.25,
            metalness: 0.15,
          }),
        )
      : track(
          new THREE.MeshPhysicalMaterial({
            color: colours.key,
            roughness: 0.08,
            metalness: 0,
            transmission: 1,
            thickness: 0.45,
            ior: 1.25,
            attenuationColor: new THREE.Color(colours.accent),
            attenuationDistance: 1.4,
          }),
        );
  const cardMesh = new THREE.Mesh(cardGeometry, cardMaterial);
  card.add(cardMesh);

  const edgeGeometry = track(new THREE.EdgesGeometry(cardGeometry, 20));
  const edgeMaterial = track(
    new THREE.LineBasicMaterial({ color: colours.accent, transparent: true, opacity: 0.45 }),
  );
  if (counts.cardEdges) {
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.scale.setScalar(1.01);
    card.add(edges);
  }

  const rowGeometry = track(new THREE.BoxGeometry(1.7, 0.11, 0.02));
  for (let i = 0; i < counts.rows; i += 1) {
    const row = new THREE.Mesh(rowGeometry, rowMaterial);
    row.position.set(-0.35, 0.62 - i * 0.2, CARD_SIZE.depth / 2 + 0.012);
    card.add(row);
  }

  const linkGeometry = track(new THREE.BoxGeometry(0.09, 0.09, 0.02));
  for (let i = 0; i < counts.links; i += 1) {
    const link = new THREE.Mesh(linkGeometry, linkMaterial);
    link.position.set(0.66, 0.62 - i * 0.2, CARD_SIZE.depth / 2 + 0.012);
    card.add(link);
  }

  const receiptGeometry = track(new THREE.BoxGeometry(1.2, 0.2, 0.02));
  const receipt = new THREE.Mesh(receiptGeometry, rowMaterial);
  receipt.position.set(-0.35, -0.78, CARD_SIZE.depth / 2 + 0.012);
  card.add(receipt);

  /* -- the five screens (Act V) -------------------------------------------- */

  const screens = new THREE.Group();
  screens.name = "set-screens";
  group.add(screens);

  const paneGeometry = track(new THREE.BoxGeometry(1.7, 1.05, 0.06));
  const barGeometry = track(new THREE.BoxGeometry(1.7, 0.07, 0.02));
  for (const [x, y, z] of SCREEN_PANES) {
    const pane = new THREE.Mesh(paneGeometry, screenMaterial);
    pane.position.set(x, y, z);
    screens.add(pane);
    if (!counts.screenBars) continue;
    const bar = new THREE.Mesh(barGeometry, screenBarMaterial);
    bar.position.set(x, y - 0.58, z + 0.02);
    screens.add(bar);
  }

  /* -- the seeker ---------------------------------------------------------- */

  const seeker = createSeeker(rig, { body: colours.accentText, glow: colours.accent }, counts.labels);
  group.add(seeker.group);

  return {
    group,
    seeker,
    card,
    cardMaterial,
    sets: { street, corridor, ledger, screens },
    stripMaterial,
    lampMaterial,
    corridorWalls,
    crowd,
    bubbles,
    registers,
    disposables,
    dispose(): void {
      for (const item of disposables) item.dispose();
    },
  };
}

/**
 * What a beat does to the scene.
 *
 * The directive is the only thing that mutates the scene, so the set pieces
 * can never drift out of step with the captions: the beat says which set is
 * showing, how bright the light is, where she is, and how much noise the
 * corridor is carrying.
 */
export function applyDirective(
  scene: StoryScene,
  directive: SceneDirective,
  progress: number,
): void {
  const set = directive.set;

  // The set pieces. The street is always there - it is the same street in
  // Act I and Act IV - and the corridor is empty once the noise stops.
  scene.sets.street.visible = set === "street" || set === "relief";
  scene.sets.corridor.visible = set !== "street";
  scene.sets.ledger.visible = directive.card !== "hidden";
  scene.sets.screens.visible = set === "screens";

  const noisy = set === "corridor";
  for (const body of scene.crowd) body.visible = noisy;
  for (const register of scene.registers) register.visible = noisy;
  for (const bubble of scene.bubbles) bubble.visible = noisy && directive.noise > 0.15;

  // The light mood. The strip lights and the sodium lamp are the two local
  // sources; the shared accent rig is the rest.
  switch (directive.light) {
    case "sodium":
      scene.lampMaterial.emissiveIntensity = 2.4;
      scene.stripMaterial.emissiveIntensity = 0.5;
      break;
    case "strip":
      scene.lampMaterial.emissiveIntensity = 1.0;
      scene.stripMaterial.emissiveIntensity = 2.4;
      break;
    case "warm":
      scene.lampMaterial.emissiveIntensity = 2.8;
      scene.stripMaterial.emissiveIntensity = 1.1;
      break;
    case "quiet":
      scene.lampMaterial.emissiveIntensity = 0.9;
      scene.stripMaterial.emissiveIntensity = 0.6;
      break;
  }

  // The corridor closing in. The walls move towards each other and the noise
  // gets heavier.
  const halfWidth = 3.0 - 0.6 * directive.constrict;
  scene.corridorWalls[0].position.x = -halfWidth;
  scene.corridorWalls[1].position.x = halfWidth;

  // The card: where it is, whether it is there at all, and whether it has
  // turned to show the number behind it.
  scene.card.visible = directive.card !== "hidden";
  const [cardX, cardY, cardZ] = resolveCardPosition(progress);
  scene.card.position.set(cardX, cardY, cardZ);
  scene.card.rotation.y = directive.card === "turned" ? 0.5 : 0;

  // The seeker.
  scene.seeker.bones.root.position.set(...directive.seeker);
  scene.seeker.bones.root.rotation.y = directive.seekerYaw;
}
