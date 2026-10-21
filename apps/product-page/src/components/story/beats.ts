// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §2 (the 50-beat narrative)
// and §4 (the camera direction); 20_3D_Product_Page.md §12 (the `/story`
// expansion - fifty beats across five acts).
//
// THE NARRATIVE. One evening in a tutor's life going wrong, and the same
// evening going right. Fifty beats, five acts: The Hunt (1-9), The Chaos
// (10-20), The Turn (21-30), The Relief (31-40), The Five Screens (41-50).
//
// WHY THE COPY LIVES HERE AND NOT IN A COMPONENT. A beat is DATA: a camera
// framing, a focus, a caption, and the scene directive that the character and
// the set pieces read. The server page renders every caption as static HTML
// (no-JS, no-WebGL and crawler visitors read the whole story), and the canvas
// renders the same beats as light. One source, so the two can never disagree.
//
// THE SCROLL MAP IS DERIVED, NOT TYPED. Each act owns a range
// ({@link ACT_BOUNDS}) and each beat inside it owns an equal slice of that
// range. Contiguity is therefore a property of the arithmetic rather than
// fifty hand-typed numbers that can drift: the last beat of an act ends
// exactly on the act's end, and the first beat of the next act starts exactly
// on it. `tests/beats.test.ts` asserts the tiling.
//
// THE FIVE-BEAT HERO MAP IS UNTOUCHED. `/` keeps its five beats verbatim
// (20_3D §12): five beats is the hero, fifty beats is the story.

/** The five acts. The number is the act, not an index. */
export type BeatAct = 1 | 2 | 3 | 4 | 5;

/** What the beat is about. The overlay and the set pieces read it. */
export type BeatFocus = "seeker" | "room" | "ledger" | "self" | "none";

/**
 * The named pose keyframes the character rig lerps between
 * (brief §3: pose is a set of named keyframes on the bone transforms, never a
 * skeleton and never an animation mixer).
 */
export type PoseName =
  | "hunt-search"
  | "hunt-doubt"
  | "anxiety-tight"
  | "collapse"
  | "still-hands"
  | "relief-open"
  | "relief-walk"
  | "competence-up"
  | "neutral";

/** Which set piece the beat shows. */
export type StorySet = "street" | "corridor" | "ledger" | "relief" | "screens";

/** The light mood of the beat: a sodium street, harsh strips, warm, or quiet. */
export type LightMood = "sodium" | "strip" | "warm" | "quiet";

/**
 * WHAT THE BEAT DOES TO THE SCENE. The camera rig reads the beat's camera, the
 * character rig reads the pose, and `act-directives.ts` reads this and mutates
 * the constructed scene accordingly.
 */
export interface SceneDirective {
  /** The set piece the beat shows. */
  readonly set: StorySet;
  /** The light mood. */
  readonly light: LightMood;
  /** The seeker's world position. */
  readonly seeker: readonly [number, number, number];
  /** Which way she faces, in radians. */
  readonly seekerYaw: number;
  /** The named pose keyframe this beat settles into. */
  readonly pose: PoseName;
  /** How the ledger card is presented. */
  readonly card: "hidden" | "floating" | "turned";
  /** How many of the phone's five labels are lit (0-5). */
  readonly phoneLabels: number;
  /** Which of the five labels is the bright one (-1 for none). */
  readonly phoneFocus: number;
  /** How much noise the beat carries, 0..1. */
  readonly noise: number;
  /** How far the corridor has closed in, 0..1. */
  readonly constrict: number;
}

/** The camera a beat declares. The target is MANDATORY (brief §4a). */
export interface BeatCamera {
  /** Where the camera is. */
  readonly pos: readonly [number, number, number];
  /** What the camera looks at. Never optional: a position is not a framing. */
  readonly target: readonly [number, number, number];
  /** The vertical field of view, in degrees, always within [35, 90]. */
  readonly fov: number;
  /** The dutch angle, in radians. Act II only, at most 0.08 in magnitude. */
  readonly roll: number;
}

/** One beat of the story. */
export interface Beat {
  /** A stable, kebab-case id. Never renumbered. */
  readonly id: string;
  /** The act this beat belongs to. */
  readonly act: BeatAct;
  /** The scroll range this beat owns, 0..1, contiguous with its neighbours. */
  readonly scroll: readonly [number, number];
  /** The framing. */
  readonly camera: BeatCamera;
  /** What the beat is about. */
  readonly focus: BeatFocus;
  /** The words. The static list and the overlay both render these. */
  readonly caption: { readonly title: string; readonly body: string };
  /** What the beat does to the scene. */
  readonly scene: SceneDirective;
}

/**
 * The act boundaries, in scroll. They are the brief's own numbers
 * (§2: 0.00-0.15, 0.15-0.38, 0.38-0.58, 0.58-0.78, 0.78-1.00) and every beat
 * inside an act tiles its range exactly.
 */
export const ACT_BOUNDS: Readonly<Record<BeatAct, readonly [number, number]>> = {
  1: [0, 0.15],
  2: [0.15, 0.38],
  3: [0.38, 0.58],
  4: [0.58, 0.78],
  5: [0.78, 1],
};

/** The act names, in order. The static list and the overlay use them. */
export const ACT_TITLES: Readonly<Record<BeatAct, string>> = {
  1: "The Hunt",
  2: "The Chaos",
  3: "The Turn",
  4: "The Relief",
  5: "The Five Screens",
};

/** The beat content before the scroll range is derived onto it. */
interface BeatContent {
  readonly id: string;
  readonly act: BeatAct;
  readonly camera: BeatCamera;
  readonly focus: BeatFocus;
  readonly caption: { readonly title: string; readonly body: string };
  readonly scene: SceneDirective;
}

/**
 * The fifty beats.
 *
 * THE CAMERA DISCIPLINE (brief §4), beat by beat:
 * - Act I is wide, high and distant. She is small in frame. FOV 55.
 * - Act II is low and closing, the FOV widening to 70, with a hand-held drift
 *   and a dutch angle of at most 0.08 radians.
 * - Act III pushes in hard and stops dead: the FOV reaches 38 at beat 21 and
 *   holds there. The stillness after the motion IS the beat.
 * - Act IV pulls back and levels. FOV 55, no roll.
 * - Act V orbits the ledger card at FOV 45, with the five screens in depth.
 */
const CONTENT: readonly BeatContent[] = [
  /* ---------------------------------------------------------------- ACT I */
  {
    id: "street-night",
    act: 1,
    camera: { pos: [4.6, 3.0, 9.6], target: [0.4, 1.4, 3.4], fov: 55, roll: 0 },
    focus: "seeker",
    caption: {
      title: "Evening on the street.",
      body: "Six o'clock. The class you want is somewhere behind that lit board, and you have one phone in your hand.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI,
      pose: "hunt-search",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "phone-glow",
    act: 1,
    camera: { pos: [2.4, 1.9, 6.2], target: [0.3, 1.35, 3.1], fov: 55, roll: 0 },
    focus: "seeker",
    caption: {
      title: "The phone is the light.",
      body: "You scroll. Everything you have tonight is inside that screen, and so is everything you owe.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI,
      pose: "hunt-search",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "first-result",
    act: 1,
    camera: { pos: [2.6, 1.9, 5.4], target: [2.6, 1.85, 1.0], fov: 55, roll: 0 },
    focus: "seeker",
    caption: {
      title: "Class 9, Maths, four hundred a month.",
      body: "It is a good rate. You are already doing the sum in your head, and you have not seen the classroom yet.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI * 0.85,
      pose: "hunt-search",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "the-question",
    act: 1,
    camera: { pos: [2.0, 1.85, 4.6], target: [1.6, 1.6, 1.6], fov: 54, roll: 0 },
    focus: "seeker",
    caption: {
      title: "But who is teaching this?",
      body: "The listing says nothing about the person. No name, no room, no idea who would be holding the fee.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI * 0.85,
      pose: "hunt-doubt",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "scroll-past",
    act: 1,
    camera: { pos: [0.9, 2.0, 4.0], target: [0.0, 1.7, 1.2], fov: 54, roll: 0 },
    focus: "seeker",
    caption: {
      title: "More of the same.",
      body: "Three more listings. The same font, the same voice, and not one word about your money.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI * 0.9,
      pose: "hunt-doubt",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.1,
      constrict: 0,
    },
  },
  {
    id: "doubt",
    act: 1,
    camera: { pos: [-0.4, 1.8, 3.2], target: [0.2, 1.3, 3.0], fov: 52, roll: 0 },
    focus: "seeker",
    caption: {
      title: "Something is wrong.",
      body: "You stop walking. The listings look the same because they are the same, and the one thing you need is missing.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI,
      pose: "hunt-doubt",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.15,
      constrict: 0,
    },
  },
  {
    id: "the-whatsapp",
    act: 1,
    camera: { pos: [-1.3, 1.5, 3.6], target: [0.25, 1.3, 3.05], fov: 50, roll: 0 },
    focus: "seeker",
    caption: {
      title: "A spreadsheet, sent as a photo.",
      body: "Nine columns, no names, just roll numbers and a column somebody marked paid.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI,
      pose: "hunt-doubt",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.2,
      constrict: 0,
    },
  },
  {
    id: "the-thread",
    act: 1,
    camera: { pos: [-1.9, 1.35, 2.2], target: [0.3, 1.25, 3.0], fov: 50, roll: 0 },
    focus: "seeker",
    caption: {
      title: "Forty-seven messages.",
      body: "Did you pay? Which batch? Sir, my fee is paid but it shows due.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI,
      pose: "hunt-doubt",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.3,
      constrict: 0,
    },
  },
  {
    id: "alone-lit",
    act: 1,
    camera: { pos: [0.0, 5.0, 12.4], target: [0.3, 1.0, 3.0], fov: 55, roll: 0 },
    focus: "seeker",
    caption: {
      title: "One lit figure in a dark grid.",
      body: "Everybody else is looking at their own screen too. Nobody is looking at yours.",
    },
    scene: {
      set: "street",
      light: "sodium",
      seeker: [0.3, 0, 3.0],
      seekerYaw: Math.PI,
      pose: "hunt-doubt",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.35,
      constrict: 0,
    },
  },

  /* --------------------------------------------------------------- ACT II */
  {
    id: "corridor-blink",
    act: 2,
    camera: { pos: [0.0, 1.5, 4.6], target: [0.0, 1.25, -3.0], fov: 62, roll: 0 },
    focus: "room",
    caption: {
      title: "The corridor.",
      body: "Strip lighting, a long perspective, and everybody moving at once.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, 0.2],
      seekerYaw: Math.PI,
      pose: "anxiety-tight",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.4,
      constrict: 0,
    },
  },
  {
    id: "crowd-in",
    act: 2,
    camera: { pos: [0.0, 1.05, 2.4], target: [0.0, 1.15, -4.4], fov: 65, roll: 0.02 },
    focus: "room",
    caption: {
      title: "Nobody has a face.",
      body: "Silhouettes, shoulder to shoulder. You cannot tell who is teaching and who is also just looking for a class.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, 0.0],
      seekerYaw: Math.PI,
      pose: "anxiety-tight",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.5,
      constrict: 0,
    },
  },
  {
    id: "noise-registers",
    act: 2,
    camera: { pos: [-0.9, 0.95, 0.6], target: [-0.4, 1.05, -4.2], fov: 66, roll: -0.03 },
    focus: "room",
    caption: {
      title: "Paper, everywhere.",
      body: "Registers stacked on registers, slipping off the edge, the same names in three different hands.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, 0.0],
      seekerYaw: Math.PI,
      pose: "anxiety-tight",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.6,
      constrict: 0,
    },
  },
  {
    id: "noise-whatsapp",
    act: 2,
    camera: { pos: [0.9, 0.9, -0.8], target: [0.3, 1.1, -5.0], fov: 67, roll: 0.04 },
    focus: "room",
    caption: {
      title: "Forty-seven more.",
      body: "Message bubbles multiplying. Read one, and you have already lost the other three.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, 0.0],
      seekerYaw: Math.PI,
      pose: "anxiety-tight",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.7,
      constrict: 0.05,
    },
  },
  {
    id: "noise-calls",
    act: 2,
    camera: { pos: [0.1, 0.85, -1.8], target: [-0.1, 1.05, -5.8], fov: 68, roll: -0.05 },
    focus: "room",
    caption: {
      title: "Missed calls.",
      body: "Somebody is ringing you about a fee you already think you took. Maybe you did. Maybe you did not.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, 0.0],
      seekerYaw: Math.PI,
      pose: "anxiety-tight",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.8,
      constrict: 0.1,
    },
  },
  {
    id: "noise-excel",
    act: 2,
    camera: { pos: [1.0, 0.75, -2.8], target: [0.2, 1.05, -6.4], fov: 69, roll: 0.06 },
    focus: "room",
    caption: {
      title: "A grid of cells.",
      body: "Some of them are red. Nobody knows why, because the formula was never written down anywhere.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, 0.0],
      seekerYaw: Math.PI,
      pose: "anxiety-tight",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.9,
      constrict: 0.15,
    },
  },
  {
    id: "the-weight",
    act: 2,
    camera: { pos: [0.3, 0.55, -3.4], target: [0.0, 0.8, -6.8], fov: 70, roll: -0.04 },
    focus: "room",
    caption: {
      title: "It has weight.",
      body: "The noise is not loud. It is heavy. Every unpaid fee and every unmarked day is a stone in your bag.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, -0.4],
      seekerYaw: Math.PI,
      pose: "collapse",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 1,
      constrict: 0.2,
    },
  },
  {
    id: "pinned-doubt",
    act: 2,
    camera: { pos: [0.6, 0.62, -3.9], target: [-0.1, 1.15, -5.9], fov: 68, roll: -0.05 },
    focus: "room",
    caption: {
      title: "One bubble holds still.",
      body: "Sir, my fee is paid but it shows due. That message has been sitting there for three days.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, -0.4],
      seekerYaw: Math.PI,
      pose: "collapse",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.95,
      constrict: 0.25,
    },
  },
  {
    id: "pinned-doubt-2",
    act: 2,
    camera: { pos: [-0.5, 0.66, -3.7], target: [0.15, 1.15, -5.5], fov: 67, roll: 0.07 },
    focus: "room",
    caption: {
      title: "And another.",
      body: "I marked attendance. It did not save. You can see that it happened. You cannot see where it went.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, -0.4],
      seekerYaw: Math.PI,
      pose: "collapse",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.9,
      constrict: 0.3,
    },
  },
  {
    id: "the-collapse",
    act: 2,
    camera: { pos: [0.0, 0.78, -2.9], target: [0.0, 1.1, -6.4], fov: 70, roll: 0.03 },
    focus: "room",
    caption: {
      title: "Everybody looks down.",
      body: "The corridor narrows. Every screen is lit, every face is on a screen, and no two screens agree.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, -0.4],
      seekerYaw: Math.PI,
      pose: "collapse",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.85,
      constrict: 0.7,
    },
  },
  {
    id: "the-cost",
    act: 2,
    camera: { pos: [0.0, 1.0, -1.0], target: [0.0, 1.15, -6.2], fov: 66, roll: 0 },
    focus: "room",
    caption: {
      title: "Nothing is resolved.",
      body: "Every phone in this corridor is still glowing. Not one of them has the answer.",
    },
    scene: {
      set: "corridor",
      light: "strip",
      seeker: [0.2, 0, -0.4],
      seekerYaw: Math.PI,
      pose: "collapse",
      card: "hidden",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0.7,
      constrict: 0.55,
    },
  },

  /* -------------------------------------------------------------- ACT III */
  {
    id: "card-breathe",
    act: 3,
    camera: { pos: [0.0, 1.8, -1.6], target: [0.0, 1.7, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "One thing, moving.",
      body: "A single card floats into the light. It does not spin at you and it does not shout. It arrives.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "card-front",
    act: 3,
    camera: { pos: [0.0, 1.72, -2.2], target: [0.0, 1.68, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "One face, edge-lit.",
      body: "This is the only page. Not a dashboard of everything, one page, and all of it readable.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-append",
    act: 3,
    camera: { pos: [0.85, 1.6, -2.6], target: [0.3, 1.58, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "A row lands.",
      body: "One fee, written down. The chain behind it extends, and it can only ever extend.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-append-2",
    act: 3,
    camera: { pos: [-0.75, 1.66, -2.8], target: [-0.3, 1.6, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "And another.",
      body: "The older rows are dimmer, but they are still there. Nothing was overwritten to make room.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-reverse",
    act: 3,
    camera: { pos: [1.3, 1.48, -3.0], target: [0.45, 1.48, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "A mistake is a second row.",
      body: "You wrote four thousand instead of four hundred. The wrong number survives, and beside it a compensating row says what really happened.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-hash",
    act: 3,
    camera: { pos: [-1.4, 1.85, -3.2], target: [-0.4, 1.72, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Each link knows the last.",
      body: "Every row carries the fingerprint of the row before it. Change one, and the chain stops matching.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-receipt",
    act: 3,
    camera: { pos: [0.45, 1.32, -3.3], target: [0.1, 1.4, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Receipt numbers never repeat.",
      body: "Receipt 41 was voided, so 42 never became 41. The gap is deliberate. A number is never used twice.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-paise",
    act: 3,
    camera: { pos: [-0.3, 1.22, -3.4], target: [0.0, 1.35, -5.5], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Paise, not rupees.",
      body: "One thousand two hundred and fifty-five rupees and fifty-five paise is stored as one hundred twenty-five thousand five hundred and five paise. Never a fraction, never a guess.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-one-truth",
    act: 3,
    camera: { pos: [0.0, 1.62, -3.0], target: [0.0, 1.6, -5.7], fov: 38, roll: 0 },
    focus: "ledger",
    caption: {
      title: "One number, not five.",
      body: "The card turns. Behind it there is one answer, how much is owed, and every screen agrees with it.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI,
      pose: "still-hands",
      card: "turned",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },
  {
    id: "the-choice",
    act: 3,
    camera: { pos: [1.55, 1.28, -3.0], target: [0.55, 1.18, -3.85], fov: 40, roll: 0 },
    focus: "ledger",
    caption: {
      title: "One tap, or twenty.",
      body: "Her hand over the screen. This is the moment the evening turns.",
    },
    scene: {
      set: "ledger",
      light: "quiet",
      seeker: [0.45, 0, -3.6],
      seekerYaw: Math.PI * 0.92,
      pose: "still-hands",
      card: "turned",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0.5,
    },
  },

  /* --------------------------------------------------------------- ACT IV */
  {
    id: "same-night",
    act: 4,
    camera: { pos: [1.5, 1.85, 0.6], target: [0.3, 1.35, 2.6], fov: 55, roll: 0 },
    focus: "self",
    caption: {
      title: "The same street.",
      body: "Same light, same board, same seven o'clock. She is walking differently now.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "phone-warm",
    act: 4,
    camera: { pos: [1.0, 1.45, 1.9], target: [0.52, 1.16, 2.6], fov: 52, roll: 0 },
    focus: "self",
    caption: {
      title: "Not a search bar.",
      body: "Five labels. Dashboard, Students, Attendance, Fees, Settings. That is the whole app.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "tap-students",
    act: 4,
    camera: { pos: [-0.75, 1.42, 2.05], target: [0.52, 1.16, 2.6], fov: 50, roll: 0 },
    focus: "self",
    caption: {
      title: "Students, ordered and named.",
      body: "Every batch in one list you can search without leaving the screen, and what each one owes.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: 1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "tap-attendance",
    act: 4,
    camera: { pos: [1.2, 1.38, 2.2], target: [0.52, 1.16, 2.6], fov: 50, roll: 0 },
    focus: "self",
    caption: {
      title: "One tap marks the class.",
      body: "The whole batch, marked. Then the day is locked, and the record is the truth from then on.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: 2,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "tap-fees",
    act: 4,
    camera: { pos: [-0.6, 1.3, 2.35], target: [0.52, 1.14, 2.6], fov: 50, roll: 0 },
    focus: "self",
    caption: {
      title: "A fee, generated.",
      body: "Who it is for, how much, which month, dated today. Attributed to the right student.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: 3,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "tap-paid",
    act: 4,
    camera: { pos: [1.05, 1.36, 2.5], target: [0.52, 1.16, 2.6], fov: 50, roll: 0 },
    focus: "self",
    caption: {
      title: "Money in.",
      body: "The ledger balances, the receipt is numbered, the screen closes. Nobody has to remember.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: 3,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "tap-settings",
    act: 4,
    camera: { pos: [-0.85, 1.34, 2.6], target: [0.52, 1.16, 2.6], fov: 50, roll: 0 },
    focus: "self",
    caption: {
      title: "Her account.",
      body: "A PIN, a fingerprint, a backup file with her name on it. The tutor owns the room.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.6],
      seekerYaw: Math.PI * 0.15,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: 4,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "the-breath",
    act: 4,
    camera: { pos: [1.9, 1.7, 4.4], target: [0.35, 1.25, 2.7], fov: 52, roll: 0 },
    focus: "self",
    caption: {
      title: "She exhales.",
      body: "Shoulders down. This is the beat to hold.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.3, 0, 2.7],
      seekerYaw: Math.PI * 0.1,
      pose: "relief-open",
      card: "floating",
      phoneLabels: 5,
      phoneFocus: 4,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "walk-away",
    act: 4,
    camera: { pos: [1.6, 2.2, 8.0], target: [0.2, 1.15, 4.4], fov: 55, roll: 0 },
    focus: "self",
    caption: {
      title: "She walks away.",
      body: "The street is exactly the same street. She is not.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.2, 0, 4.4],
      seekerYaw: 0,
      pose: "relief-walk",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "the-corridor-flip",
    act: 4,
    camera: { pos: [0.6, 1.8, 4.6], target: [0.0, 1.6, -3.6], fov: 55, roll: 0 },
    focus: "self",
    caption: {
      title: "The corridor, quiet.",
      body: "Same corridor, same strip lights. Now it is lit, and now it is hers.",
    },
    scene: {
      set: "relief",
      light: "warm",
      seeker: [0.2, 0, 4.6],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },

  /* ---------------------------------------------------------------- ACT V */
  {
    id: "five-behind",
    act: 5,
    camera: { pos: [-4.1, 2.2, 7.2], target: [0.2, 1.6, 2.0], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Five screens, in depth.",
      body: "Not tabs. Screens. Each one does one job, and each one is a real place you can go.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "screen-dashboard",
    act: 5,
    camera: { pos: [-3.6, 1.8, 4.8], target: [-3.2, 1.65, 0.8], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Dashboard.",
      body: "Owed, collected, and who is due today. The month, in one glance.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "screen-students",
    act: 5,
    camera: { pos: [-2.0, 1.75, 4.6], target: [-1.6, 1.65, 1.3], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Students.",
      body: "Every batch, one roster you can search without leaving the screen, and what each one owes.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "screen-attendance",
    act: 5,
    camera: { pos: [-0.3, 1.72, 4.4], target: [0.0, 1.65, 1.7], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Attendance.",
      body: "The month, marked. One tap for the class, and the day locks after that.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "screen-fees",
    act: 5,
    camera: { pos: [1.3, 1.75, 4.6], target: [1.6, 1.65, 2.1], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Fees.",
      body: "Invoices, receipts, and the void: the receipt that cancels an invoice without erasing it.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "screen-settings",
    act: 5,
    camera: { pos: [3.0, 1.85, 5.0], target: [3.2, 1.65, 2.4], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Settings.",
      body: "Security, backup, export. Your name at the top, and your data under your name.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "one-tap",
    act: 5,
    camera: { pos: [0.4, 2.5, 7.4], target: [0.2, 1.62, 1.6], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "One tap, any screen.",
      body: "That is the promise. Wherever you are, the next thing is one tap away and nothing hides behind a menu.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.2],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "the-room",
    act: 5,
    camera: { pos: [-2.8, 2.7, 8.8], target: [0.3, 1.6, 1.6], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "A staffroom.",
      body: "Every tutor in it has all five screens live, and every tutor's numbers are their own.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.4],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "the-instants",
    act: 5,
    camera: { pos: [1.4, 1.95, 5.4], target: [0.5, 1.58, 3.4], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "One ledger, in the middle.",
      body: "Every screen agreeing with the same ledger. That is the whole product: five screens, one ledger.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.4],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
  {
    id: "the-cta",
    act: 5,
    camera: { pos: [0.5, 1.78, 7.0], target: [0.5, 1.56, 3.4], fov: 45, roll: 0 },
    focus: "ledger",
    caption: {
      title: "Built for one room at a time.",
      body: "The card settles. Your name, your students, your month. Download it and start tonight.",
    },
    scene: {
      set: "screens",
      light: "quiet",
      seeker: [0.2, 0, 5.6],
      seekerYaw: 0,
      pose: "competence-up",
      card: "floating",
      phoneLabels: 0,
      phoneFocus: -1,
      noise: 0,
      constrict: 0,
    },
  },
];

/**
 * The scroll slice a beat owns.
 *
 * WHY IT IS COMPUTED. Fifty hand-typed ranges would drift: a typo in one
 * boundary leaves a gap or an overlap, and the camera would either skip a beat
 * or double-enter it. Computing the slice from the act's own range makes the
 * tiling a property of the arithmetic. The last beat of an act ends exactly on
 * the act's end, so the act boundaries are shared, not merely adjacent.
 */
function scrollSlice(act: BeatAct, index: number, count: number): readonly [number, number] {
  const [lo, hi] = ACT_BOUNDS[act];
  const start = lo + (hi - lo) * (index / count);
  const end = index === count - 1 ? hi : lo + (hi - lo) * ((index + 1) / count);
  return [start, end];
}

/** The fifty beats, in narrative order, with their scroll ranges. */
export const STORY_BEATS: readonly Beat[] = CONTENT.map((beat) => {
  const count = CONTENT.filter((other) => other.act === beat.act).length;
  const index = CONTENT.filter((other) => other.act === beat.act).indexOf(beat);
  return {
    ...beat,
    scroll: scrollSlice(beat.act, index, count),
  };
});

/** The stable ids, in order. The `?beat=` deep link and the tests use them. */
export const STORY_IDS: readonly string[] = STORY_BEATS.map((beat) => beat.id);

/** How many beats an act owns. */
export const ACT_SIZES: Readonly<Record<BeatAct, number>> = {
  1: STORY_BEATS.filter((beat) => beat.act === 1).length,
  2: STORY_BEATS.filter((beat) => beat.act === 2).length,
  3: STORY_BEATS.filter((beat) => beat.act === 3).length,
  4: STORY_BEATS.filter((beat) => beat.act === 4).length,
  5: STORY_BEATS.filter((beat) => beat.act === 5).length,
};

/**
 * The beat a scroll progress lands in, and how far into it.
 *
 * The local progress is what makes a beat a BEAT rather than a frame: the
 * camera, the pose and the set pieces all interpolate across it, so nothing
 * in the story ever cuts from one beat to the next.
 */
export function resolveBeatProgress(progress: number): {
  readonly index: number;
  readonly local: number;
} {
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const beats = STORY_BEATS;
  for (let i = 0; i < beats.length; i += 1) {
    const [start, end] = beats[i].scroll;
    if (clamped < end || i === beats.length - 1) {
      const span = end - start;
      const local = span > 0 ? (clamped - start) / span : 0;
      return { index: i, local: Math.min(1, Math.max(0, local)) };
    }
  }
  return { index: 0, local: 0 };
}

/** The act a scroll progress lands in. */
export function resolveAct(progress: number): BeatAct {
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  for (const act of [1, 2, 3, 4, 5] as const) {
    const [, end] = ACT_BOUNDS[act];
    if (clamped < end || act === 5) return act;
  }
  return 1;
}

/**
 * Where the ledger card is, as a function of the scroll progress.
 *
 * THE CARD TRAVELS WITH HER. It appears in the corridor in Act III, and by
 * Act IV it has come out onto the street beside her - which is what lets Act V
 * orbit it without a long camera move back down the corridor.
 */
export const CARD_CORRIDOR: readonly [number, number, number] = [0, 1.7, -5.5];
export const CARD_STREET: readonly [number, number, number] = [0.5, 1.55, 3.4];

/** The progress range over which the card moves from the corridor to the street. */
const CARD_TRAVEL: readonly [number, number] = [0.6, 0.68];

/** The card's position at a scroll progress. */
export function resolveCardPosition(progress: number): [number, number, number] {
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const [from, to] = CARD_TRAVEL;
  const t = clamped <= from ? 0 : clamped >= to ? 1 : (clamped - from) / (to - from);
  return [
    CARD_CORRIDOR[0] + (CARD_STREET[0] - CARD_CORRIDOR[0]) * t,
    CARD_CORRIDOR[1] + (CARD_STREET[1] - CARD_CORRIDOR[1]) * t,
    CARD_CORRIDOR[2] + (CARD_STREET[2] - CARD_CORRIDOR[2]) * t,
  ];
}
