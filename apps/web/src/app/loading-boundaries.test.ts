// Implements: 13_UI_Guidelines.md §8.20 (a skeleton matches the surface it
// stands in for), §15.1 (loading orchestration), and AGENTS.md §2 Rule 10
// (status is announced, not implied).
//
// WHY THIS IS A TEST. One `loading.tsx` sat at the `(app)` group level and
// rendered the DASHBOARD skeleton for every one of the five screens, so opening
// `/students` showed a KPI strip and an activity feed, then the roster
// skeleton, then the roster — two layout shifts where §8.20 intends zero. The
// defect is invisible in a screenshot of one screen and obvious to a tutor
// navigating between them, which is exactly the class of bug a test should
// hold.
//
// THE CONTRACT. Every screen route owns a `loading.tsx`, and its shape and
// label are the SAME ones the screen's own client component renders while it
// waits. The group-level file is gone: with all five routes covered it could
// only ever be a fallback that lied about the screen it was standing in for.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(process.cwd(), "src", "app", "(app)");

interface RouteContract {
  route: string;
  /** The client component that renders the screen's own waiting skeleton. */
  client: string;
}

const ROUTES: RouteContract[] = [
  { route: "dashboard", client: "src/components/buddysaradhi/dashboard-client.tsx" },
  { route: "students", client: "src/components/students/student-master-list.tsx" },
  { route: "attendance", client: "src/components/attendance/attendance-grid.tsx" },
  { route: "fees", client: "src/components/fees/fees-client.tsx" },
  { route: "settings", client: "src/components/settings/settings-client.tsx" },
];

/** The `shape` and `label` a skeleton call carries. */
function skeletonCall(source: string): { shape: string; label: string } {
  // The `ScreenSkeleton` call itself — an `aria-label` elsewhere in the file
  // is a different control's name, not this skeleton's.
  const element = /<ScreenSkeleton\b([\s\S]*?)\/>/.exec(source)?.[1] ?? "";
  const shape = /shape="([a-z]+)"/.exec(element)?.[1] ?? "";
  const label = /label="([^"]+)"/.exec(element)?.[1] ?? "";
  return { shape, label };
}

describe("every screen route owns its loading boundary", () => {
  it("has a loading.tsx of its own", () => {
    for (const { route } of ROUTES) {
      const path = join(appDir, route, "loading.tsx");
      expect(existsSync(path), `${route} has no loading.tsx`).toBe(true);
    }
  });

  it("has no group-level boundary that could answer for a screen", () => {
    // With all five routes covered, a file at the `(app)` group level could
    // only be a fallback — and it would have to guess the screen's shape.
    expect(existsSync(join(appDir, "loading.tsx"))).toBe(false);
  });

  it.each(ROUTES)("/$route waits with the shape its own screen waits with", ({ route, client }) => {
    const boundary = readFileSync(join(appDir, route, "loading.tsx"), "utf8");
    const screen = readFileSync(join(process.cwd(), client), "utf8");

    const fromBoundary = skeletonCall(boundary);
    const fromScreen = skeletonCall(screen);

    expect(fromBoundary.shape).not.toBe("");
    expect(fromBoundary.shape).toBe(fromScreen.shape);
    expect(fromBoundary.label).toBe(fromScreen.label);
  });
});
