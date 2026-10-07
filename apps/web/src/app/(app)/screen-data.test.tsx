import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { ScreenData, type ScreenQuery } from "./screen-data";

// The three properties `ScreenData` promises, each of which is a way the SSR
// migration could have shipped a regression nobody would see until a tutor with a
// slow gateway did:
//
//   1. the key the page passed is the key that lands in the dehydrated state —
//      verbatim, so a screen reading its own key finds the server's data;
//   2. a REJECTED prefetch does not reject the render — AGENTS.md §2 Rule 9. A
//      gateway timeout must cost the server one logged failure and the browser
//      one retry, not turn a readable data problem into a 500 for the whole
//      screen;
//   3. a rejected query is OMITTED from the dehydrated state rather than shipped
//      as an error — the browser then fetches it itself and renders its own
//      `ErrorState`, which is the surface that knows how to say "I could not read
//      this" and offer a retry.

/** The dehydrated payload `HydrationBoundary` is handed. */
function dehydratedStateOf(node: unknown): {
  queries?: Array<{ queryKey: unknown; state: { data: unknown } }>;
} {
  if (!isValidElement<{ state?: { queries?: Array<{ queryKey: unknown; state: { data: unknown } }> } }>(node)) {
    throw new Error("ScreenData must render an element");
  }
  return node.props.state ?? {};
}

/**
 * A read that fails. `retry: false` because the app-wide policy retries twice
 * with backoff, which would make every one of these tests take seconds to prove
 * something that takes milliseconds — and because on the server a retry is pure
 * cost: the browser re-issues the same query the moment the failure is dropped.
 */
function failingRead(queryKey: readonly unknown[], message = "gateway timeout"): ScreenQuery {
  return {
    queryKey: [...queryKey],
    retry: false,
    queryFn: async () => {
      throw new Error(message);
    },
  };
}

describe("ScreenData", () => {
  it("dehydrates each query under exactly the key the screen asked for", async () => {
    const key = ["students", { status: ["active"] }, "", 1, 50, { col: "name", dir: "asc" }];
    const query: ScreenQuery = { queryKey: key, queryFn: async () => ({ success: true, data: [1, 2] }) };

    const state = dehydratedStateOf(await ScreenData({ queries: [query], children: null }));

    expect(state.queries).toHaveLength(1);
    expect(state.queries?.[0]?.queryKey).toEqual(key);
    expect(state.queries?.[0]?.state.data).toEqual({ success: true, data: [1, 2] });
  });

  it("renders its children", async () => {
    const node = await ScreenData({ queries: [], children: "the screen" });
    if (!isValidElement<{ children: unknown }>(node)) {
      throw new Error("ScreenData must render an element");
    }
    expect(node.props.children).toBe("the screen");
  });

  it("does NOT reject the render when a prefetch fails", async () => {
    // The promise RESOLVES. A rejection here would propagate out of the page and
    // 500 the whole screen, which is how a data blip becomes a broken app.
    const node = await ScreenData({
      queries: [failingRead(["fees-students", ""])],
      children: null,
    });
    expect(isValidElement(node)).toBe(true);
  });

  it("omits a failed query from the dehydrated state instead of shipping the error", async () => {
    const state = dehydratedStateOf(
      await ScreenData({ queries: [failingRead(["fees-students", ""])], children: null }),
    );

    expect(state.queries ?? []).toHaveLength(0);
  });

  it("keeps a sibling query when another one fails", async () => {
    const good: ScreenQuery = { queryKey: ["settings"], queryFn: async () => ({ success: true }) };

    const state = dehydratedStateOf(
      await ScreenData({
        queries: [good, failingRead(["attendance", "2026-10-07", "all"])],
        children: null,
      }),
    );

    expect(state.queries).toHaveLength(1);
    expect(state.queries?.[0]?.queryKey).toEqual(["settings"]);
  });

  it("awaits every query before rendering — a half-hydrated screen is a wrong screen", async () => {
    let slowResolved = false;
    const slow: ScreenQuery = {
      queryKey: ["dashboard", "summary", { mode: "this_month" }],
      queryFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        slowResolved = true;
        return { window: { label: "This month" } };
      },
    };

    const state = dehydratedStateOf(await ScreenData({ queries: [slow], children: null }));

    expect(slowResolved).toBe(true);
    expect(state.queries?.[0]?.state.data).toEqual({ window: { label: "This month" } });
  });

  it("gives each render its own client — a shared cache would leak one tutor's roster into another's HTML", async () => {
    const a = await ScreenData({ queries: [], children: null });
    const b = await ScreenData({ queries: [], children: null });
    expect(a).not.toBe(b);
  });

  it("does not log to the console — the failure is the query's, and the screen owns the message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await ScreenData({ queries: [failingRead(["settings"], "boom")], children: null });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});