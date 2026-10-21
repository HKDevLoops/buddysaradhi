// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §10 (the beat assertions)
// and §2 (the narrative's shape: fifty beats, five acts, a scroll map that
// tiles 0..1).
//
// WHY THESE ASSERTIONS EXIST. The beat map is the one thing every other part
// of the story reads: the camera reads the framings, the character reads the
// poses, the server page reads the captions. If the map drifts - a duplicate
// id, a gap in the scroll ranges, a beat with no target - the story does not
// fail loudly, it fails quietly: a skipped beat, a camera that cuts, a caption
// that belongs to the wrong frame. These tests are the alarm.
//
// THE NEGATIVE CONTROL. Every assertion here has been broken on purpose and
// watched go red; the commands and their output are recorded in the commit
// body. A test that cannot fail guards nothing.

import { describe, expect, it } from "vitest";
import {
  ACT_BOUNDS,
  ACT_SIZES,
  ACT_TITLES,
  STORY_BEATS,
  STORY_IDS,
  resolveAct,
  resolveBeatProgress,
  resolveCardPosition,
} from "../src/components/story/beats";
import { FOV_MAX, FOV_MIN, ROLL_MAX } from "../src/components/story/camera-rig";

/** The brief's own act boundaries (§2). */
const BRIEF_ACT_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.15],
  [0.15, 0.38],
  [0.38, 0.58],
  [0.58, 0.78],
  [0.78, 1],
];

describe("the beat map (brief §2)", () => {
  it("has exactly fifty beats", () => {
    expect(STORY_BEATS).toHaveLength(50);
    expect(STORY_IDS).toHaveLength(50);
  });

  it("gives every beat a unique id", () => {
    expect(new Set(STORY_IDS).size).toBe(50);
  });

  it("keeps the ids in the brief's order, and never renumbers one", () => {
    // The ids are stable strings: a beat's id is how a deep link and the
    // tests find it, so the ORDER matters as much as the count.
    expect(STORY_IDS[0]).toBe("street-night");
    expect(STORY_IDS[8]).toBe("alone-lit");
    expect(STORY_IDS[9]).toBe("corridor-blink");
    expect(STORY_IDS[19]).toBe("the-cost");
    expect(STORY_IDS[20]).toBe("card-breathe");
    expect(STORY_IDS[29]).toBe("the-choice");
    expect(STORY_IDS[30]).toBe("same-night");
    expect(STORY_IDS[39]).toBe("the-corridor-flip");
    expect(STORY_IDS[40]).toBe("five-behind");
    expect(STORY_IDS[49]).toBe("the-cta");
  });

  it("gives every beat a kebab-case id", () => {
    for (const id of STORY_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("has five acts, in order, with the brief's sizes", () => {
    const acts = STORY_BEATS.map((beat) => beat.act);
    for (let i = 1; i < acts.length; i += 1) {
      expect(acts[i]).toBeGreaterThanOrEqual(acts[i - 1]);
    }
    expect(ACT_SIZES[1]).toBe(9);
    expect(ACT_SIZES[2]).toBe(11);
    expect(ACT_SIZES[3]).toBe(10);
    expect(ACT_SIZES[4]).toBe(10);
    expect(ACT_SIZES[5]).toBe(10);
    for (const act of [1, 2, 3, 4, 5] as const) {
      expect(ACT_TITLES[act].length).toBeGreaterThan(0);
    }
  });

  it("tiles the scroll range 0..1 with no gap and no overlap", () => {
    expect(STORY_BEATS[0].scroll[0]).toBe(0);
    expect(STORY_BEATS[49].scroll[1]).toBe(1);
    for (let i = 1; i < STORY_BEATS.length; i += 1) {
      // The end of one beat IS the start of the next: the same number, not
      // two numbers that happen to be close.
      expect(STORY_BEATS[i].scroll[0]).toBe(STORY_BEATS[i - 1].scroll[1]);
    }
    for (const beat of STORY_BEATS) {
      expect(beat.scroll[1]).toBeGreaterThan(beat.scroll[0]);
    }
  });

  it("gives every beat a scroll range inside its act's range", () => {
    for (const beat of STORY_BEATS) {
      const [lo, hi] = ACT_BOUNDS[beat.act];
      expect(beat.scroll[0]).toBeGreaterThanOrEqual(lo);
      expect(beat.scroll[1]).toBeLessThanOrEqual(hi);
    }
  });

  it("uses the brief's own act boundaries", () => {
    const actual = [1, 2, 3, 4, 5].map((act) => ACT_BOUNDS[act as 1]);
    expect(actual).toEqual(BRIEF_ACT_BOUNDS);
  });

  it("gives every beat a camera target", () => {
    for (const beat of STORY_BEATS) {
      expect(beat.camera.target).toHaveLength(3);
      for (const value of beat.camera.target) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("gives every beat a camera position", () => {
    for (const beat of STORY_BEATS) {
      expect(beat.camera.pos).toHaveLength(3);
      for (const value of beat.camera.pos) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("keeps every field of view inside [35, 90]", () => {
    for (const beat of STORY_BEATS) {
      expect(beat.camera.fov).toBeGreaterThanOrEqual(FOV_MIN);
      expect(beat.camera.fov).toBeLessThanOrEqual(FOV_MAX);
    }
  });

  it("tilts only Act II, and never by more than 0.08 radians", () => {
    for (const beat of STORY_BEATS) {
      expect(Math.abs(beat.camera.roll)).toBeLessThanOrEqual(ROLL_MAX);
      if (beat.act !== 2) {
        expect(beat.camera.roll).toBe(0);
      }
    }
  });

  it("has exactly zero roll by beat 38, so the recovery reads as relief", () => {
    const beat38 = STORY_BEATS[37];
    expect(beat38.id).toBe("the-breath");
    expect(beat38.camera.roll).toBe(0);
    // And it stays level for the rest of the story.
    for (const beat of STORY_BEATS.slice(37)) {
      expect(beat.camera.roll).toBe(0);
    }
  });

  it("gives every beat a caption with a title and a body", () => {
    for (const beat of STORY_BEATS) {
      expect(beat.caption.title.length).toBeGreaterThan(0);
      expect(beat.caption.body.length).toBeGreaterThan(20);
    }
  });

  it("gives every beat a focus and a scene directive", () => {
    for (const beat of STORY_BEATS) {
      expect(["seeker", "room", "ledger", "self", "none"]).toContain(beat.focus);
      expect(beat.scene.pose.length).toBeGreaterThan(0);
      expect(beat.scene.seeker).toHaveLength(3);
      expect(Number.isFinite(beat.scene.seekerYaw)).toBe(true);
      expect(beat.scene.noise).toBeGreaterThanOrEqual(0);
      expect(beat.scene.noise).toBeLessThanOrEqual(1);
    }
  });
});

describe("resolving a scroll progress (brief §2)", () => {
  it("finds the beat a progress lands in", () => {
    expect(resolveBeatProgress(0).index).toBe(0);
    expect(resolveBeatProgress(0.1499).index).toBe(8);
    expect(resolveBeatProgress(0.15).index).toBe(9);
    expect(resolveBeatProgress(0.9999).index).toBe(49);
    expect(resolveBeatProgress(1).index).toBe(49);
  });

  it("reports how far into the beat the progress is", () => {
    const start = STORY_BEATS[0].scroll[0];
    const end = STORY_BEATS[0].scroll[1];
    expect(resolveBeatProgress(start).local).toBeCloseTo(0, 6);
    expect(resolveBeatProgress((start + end) / 2).local).toBeCloseTo(0.5, 6);
    expect(resolveBeatProgress(end - 0.0001).local).toBeGreaterThan(0.99);
  });

  it("survives a progress that is not a number", () => {
    expect(resolveBeatProgress(Number.NaN).index).toBe(0);
    expect(resolveBeatProgress(Number.NaN).local).toBe(0);
    expect(resolveBeatProgress(-5).index).toBe(0);
    expect(resolveBeatProgress(5).index).toBe(49);
  });

  it("finds the act a progress lands in", () => {
    expect(resolveAct(0)).toBe(1);
    expect(resolveAct(0.16)).toBe(2);
    expect(resolveAct(0.4)).toBe(3);
    expect(resolveAct(0.6)).toBe(4);
    expect(resolveAct(0.9)).toBe(5);
    expect(resolveAct(1)).toBe(5);
  });
});

describe("the ledger card's journey", () => {
  it("starts in the corridor and ends on the street", () => {
    const corridor = resolveCardPosition(0.4);
    const street = resolveCardPosition(0.9);
    expect(corridor[2]).toBeLessThan(street[2]);
    expect(corridor[2]).toBeLessThan(0);
    expect(street[2]).toBeGreaterThan(0);
  });

  it("moves once, and never backwards", () => {
    let previous = -Infinity;
    for (let i = 0; i <= 100; i += 1) {
      const z = resolveCardPosition(i / 100)[2];
      expect(z).toBeGreaterThanOrEqual(previous);
      previous = z;
    }
  });
});
