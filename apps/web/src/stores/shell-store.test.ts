import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_SCREEN,
  SCREENS,
  isScreenId,
  registerScreenNavigator,
  screenFromPathname,
  screenLabel,
  syncActiveScreenFromPath,
  useShellStore,
  type ScreenId,
} from "./shell-store";

// These are the three facts the SSR-route migration (2026-10-07) rests on, and
// each one has already cost a session:
//   1. the store still updates SYNCHRONOUSLY, because `shortcuts.ts:209` and
//      `dashboard-client.test.tsx` read it on the line after calling it;
//   2. the store navigates, so `g then N` moves by route rather than by an event;
//   3. a pathname that is not one of the five must NOT resolve to the Dashboard —
//      `/login` is not a screen, and answering it "Dashboard" would light up the
//      Dashboard tab on the sign-in page.

describe("screenFromPathname", () => {
  it("resolves each of the five screen routes", () => {
    for (const screen of SCREENS) {
      expect(screenFromPathname(screen.id)).toBe(screen.id);
    }
  });

  it("returns null for a pathname that is not one of the five", () => {
    // The reason this returns null instead of DEFAULT_SCREEN: a real request for
    // /login, /signup/provision or a 404 must not be answered with a screen.
    expect(screenFromPathname("/login")).toBeNull();
    expect(screenFromPathname("/signup/provision")).toBeNull();
    expect(screenFromPathname("/")).toBeNull();
    expect(screenFromPathname("")).toBeNull();
    expect(screenFromPathname("/dashboard/extra")).toBeNull();
    expect(screenFromPathname("/Dashboard")).toBeNull();
  });

  it("tolerates a trailing slash, because a hand-edited URL has one", () => {
    expect(screenFromPathname("/students/")).toBe("/students");
    expect(screenFromPathname("/students///")).toBe("/students");
  });

  it("covers exactly the five screens and nothing else", () => {
    const resolved = SCREENS.map((screen) => screenFromPathname(screen.id));
    expect(resolved).toHaveLength(5);
    expect(new Set(resolved).size).toBe(5);
  });
});

describe("isScreenId / screenLabel", () => {
  it("accepts only the five ids", () => {
    expect(isScreenId("/fees")).toBe(true);
    expect(isScreenId("/reports")).toBe(false);
    expect(isScreenId("fees")).toBe(false);
  });

  it("labels every screen, and never returns a wrong one for a known id", () => {
    for (const screen of SCREENS) {
      expect(screenLabel(screen.id)).toBe(screen.label);
    }
  });
});

describe("setActiveScreen", () => {
  beforeEach(() => {
    useShellStore.setState({ activeScreen: DEFAULT_SCREEN });
    registerScreenNavigator(null);
  });

  afterEach(() => {
    registerScreenNavigator(null);
  });

  it("updates the store SYNCHRONOUSLY before any navigation", () => {
    // This is the contract `shortcuts.ts:209` and `dashboard-client.test.tsx`
    // depend on: `setActiveScreen(x)` then immediately read `activeScreen` and
    // get `x`. A navigation-first implementation would fail both.
    const order: string[] = [];
    registerScreenNavigator(() => {
      order.push(`navigate:${useShellStore.getState().activeScreen}`);
    });

    useShellStore.getState().setActiveScreen("/fees");

    expect(useShellStore.getState().activeScreen).toBe("/fees");
    expect(order).toEqual(["navigate:/fees"]);
  });

  it("is a plain setter when no navigator is registered", () => {
    // The unit-test and server-render case: no router exists, and the store must
    // still do the one thing every caller outside this lane's files relies on.
    useShellStore.getState().setActiveScreen("/students");
    expect(useShellStore.getState().activeScreen).toBe("/students");
  });

  it("uses the LAST registered navigator", () => {
    const first: ScreenId[] = [];
    const second: ScreenId[] = [];
    registerScreenNavigator((screen) => first.push(screen));
    registerScreenNavigator((screen) => second.push(screen));

    useShellStore.getState().setActiveScreen("/attendance");

    expect(first).toEqual([]);
    expect(second).toEqual(["/attendance"]);
  });

  it("clearing the navigator stops navigation but not the state change", () => {
    const calls: ScreenId[] = [];
    registerScreenNavigator((screen) => calls.push(screen));
    registerScreenNavigator(null);

    useShellStore.getState().setActiveScreen("/settings");

    expect(calls).toEqual([]);
    expect(useShellStore.getState().activeScreen).toBe("/settings");
  });
});

describe("syncActiveScreenFromPath", () => {
  beforeEach(() => {
    useShellStore.setState({ activeScreen: DEFAULT_SCREEN });
    registerScreenNavigator(null);
  });

  afterEach(() => {
    registerScreenNavigator(null);
  });

  it("records the screen the route names — arrival, Back, Forward, a pasted link", () => {
    const seen: ScreenId[] = [];
    const routes = ["/students", "/fees", "/dashboard", "/attendance", "/settings"];
    for (const route of routes) {
      syncActiveScreenFromPath(route);
      seen.push(useShellStore.getState().activeScreen);
    }
    expect(seen).toEqual(["/students", "/fees", "/dashboard", "/attendance", "/settings"]);
  });

  it("never navigates, so a Back press cannot push the route it just left", () => {
    const calls: ScreenId[] = [];
    registerScreenNavigator((screen) => calls.push(screen));

    syncActiveScreenFromPath("/settings");

    expect(useShellStore.getState().activeScreen).toBe("/settings");
    expect(calls).toEqual([]);
  });

  it("leaves the store alone for a non-screen pathname", () => {
    useShellStore.setState({ activeScreen: "/fees" });

    syncActiveScreenFromPath("/login");

    expect(useShellStore.getState().activeScreen).toBe("/fees");
  });

  it("is idempotent for the route already on show", () => {
    useShellStore.setState({ activeScreen: "/attendance" });
    // A second identical call must not produce a second state write, which is
    // what would make the nav highlight flicker on a re-render.
    let writes = 0;
    const unsubscribe = useShellStore.subscribe(() => {
      writes += 1;
    });

    syncActiveScreenFromPath("/attendance");
    unsubscribe();

    expect(writes).toBe(0);
  });
});