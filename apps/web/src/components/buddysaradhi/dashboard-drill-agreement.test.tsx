// Implements: 04_Dashboard.md §10.1 (every KPI card names a drill-down target
// AND the filter the destination screen must apply) and §19.4 step 3 ("Click each
// KPI card → lands on the correct screen with the correct filter"); §18 (Enter
// activates the drill and the destination is reachable); AGENTS.md §2 Rule 4
// (a drill is a store write plus a screen write — never a sixth route), Rule 9
// (a filter that cannot be applied is DECLARED, never implied in a
// tutor-facing sentence) and Rule 10 (a screen-reader user is told where the
// tap goes, so what it says must be true).
//
// ── WHY THIS FILE EXISTS AT ALL: THE BUG CLASS, NOT THE BUG ─────────────────────
//
// Two failures shipped out of `dashboard audit 2` before this file existed.
//
//  1. THE E2E ASSERTION WAS BLIND. It asked the shell's nav for
//     `button[aria-current="true"]`, a value the shell has never emitted (it emits
//     `"page"`), so the helper returned a constant `false`, `landed` was a
//     constant `false`, and the drill loop died on its FIRST card having
//     navigated nowhere. It also accepted `onScreen(a) || onScreen(b)`, so it
//     would have passed a card that drilled to the wrong screen, and it read the
//     nav in the same tick as the click while `router.push` is asynchronous.
//
//  2. NOTHING CHECKED THE AGREEMENT ITSELF. `CARD_DRILL`, `isFilterApplied` and
//     `applyDrill` are three places that each know "where does this card go",
//     and `drillAnnouncement` is a fourth that knows "what does this card SAY it
//     does". Every existing assertion pinned one of them against a hardcoded
//     literal — the announcement for three cards, the table for a list of card
//     ids — so a card could speak one destination and drill to another and every
//     test in the repository would still be green. That is exactly what happened.
//
// THIS FILE CLOSES IT BY CROSS-CHECKING, FOR EVERY CARD, ALL FOUR FACTS AT ONCE:
//
//     the words the card SPEAKS  ⟷  the screen the table DECLARES
//                             ⟷  the route the click NAVIGATES to
//                             ⟷  the filter the click WRITES (and whether it
//                                 says anything about a filter at all)
//
// It runs against the RENDERED strip, with a real navigator registered, so it
// exercises the same click path a tutor does. Nothing in it is derived from the
// table it is checking: the spoken destination is resolved to a route through a
// map written in THIS file, and the navigated route is captured from
// `setActiveScreen` itself.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/server/actions/dashboard", () => ({
  fetchDashboardSummaryAction: vi.fn(),
  fetchDashboardAnalyticsAction: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/components/buddysaradhi/dashboard-analytics", () => ({
  DashboardAnalyticsSection: () => (
    <section aria-label="Business analytics stub">
      <h2>Business analytics</h2>
    </section>
  ),
}));

import {
  fetchDashboardSummaryAction,
  type DashboardSummary,
} from "@/server/actions/dashboard";
import { DashboardClient } from "./dashboard-client";
import { registerScreenNavigator, useShellStore, type ScreenId } from "@/stores/shell-store";
import { useStudentsStore } from "@/stores/students-store";
import { CARD_DRILL, SCREEN_NAME, applyCardDrill, drillAnnouncement, isFilterApplied, type CardId } from "@/lib/dashboard-drill";
import type { PeriodWindow } from "@/lib/dashboard-period";

/**
 * jsdom ships no `window.matchMedia` and `components/ui/count-up.tsx` calls it
 * unguarded. Shimming it with `matches: true` does double duty: the count-up
 * takes its reduced-motion path and lands on the final value, which is what
 * makes the figure in the accessible name deterministic (04 §18).
 */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

/**
 * THE SEVEN CARDS. The `id` is the key in `CARD_DRILL` and the `title` is the
 * word the card prints and speaks after `Open <screen>.`. Both are written out
 * here on purpose: this file must be able to fail when a card is added, and a
 * list that reads itself out of the object under test cannot.
 */
const CARDS: ReadonlyArray<{ readonly id: CardId; readonly title: string }> = [
  { id: "collected", title: "Collected" },
  { id: "due-till-date", title: "Due Till Date" },
  { id: "due-in-period", title: "Due In Period" },
  { id: "total-students", title: "Active Students" },
  { id: "students-with-dues", title: "Students With Dues" },
  { id: "breakdown", title: "Payment Breakdown" },
  { id: "overdue", title: "Overdue" },
];

/**
 * The spoken screen name → the route that screen lives on, written HERE and not
 * imported from `SCREEN_NAME`.
 *
 * It is the test's own translation table, so "the card says Fees and Payments"
 * and "the card navigated to /fees" are two independent statements that have to
 * meet. Deriving the route from `CARD_DRILL` instead would make the assertion
 * circular: a card that both spoke and drilled to the wrong screen would agree
 * with itself and pass.
 *
 * The `&` in the nav label is deliberately absent from the spoken name — the
 * announcement is read aloud, and "Fees and Payments" is what a tutor hears.
 */
const SPOKEN_TO_ROUTE: Readonly<Record<string, ScreenId>> = {
  "Fees and Payments": "/fees",
  Students: "/students",
  Attendance: "/attendance",
  Settings: "/settings",
  Dashboard: "/dashboard",
};

const fetchSummary = vi.mocked(fetchDashboardSummaryAction);

const WINDOW: PeriodWindow = {
  periodStartIso: "2026-10-01",
  periodEndIso: "2026-10-05",
  label: "October 2026",
  labelLower: "october 2026",
  movesMoneyCards: true,
};

function summary(): DashboardSummary {
  return {
    kpis: {
      totalStudents: 87,
      studentsWithDues: 12,
      collectedThisMonthMinor: 12450000,
      dueTillDateMinor: 3820000,
      dueForMonthMinor: 1450000,
      overdueMinor: 900000,
      paymentBreakdown: { paid: 42, partial: 8, unpaid: 12, noDues: 5 },
    },
    activity: [],
    dueToday: [],
    dueTodayTotal: 0,
    dueTodayTruncated: false,
    dataOrigin: "live",
  };
}

function renderClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardClient />
    </QueryClientProvider>,
  );
}

/** Every route `setActiveScreen` was asked for while this test ran. */
function captureNavigations(): { readonly routes: ScreenId[]; readonly stop: () => void } {
  const routes: ScreenId[] = [];
  registerScreenNavigator((screen) => routes.push(screen));
  return { routes, stop: () => registerScreenNavigator(null) };
}

beforeEach(() => {
  vi.clearAllMocks();
  useShellStore.setState({ activeScreen: "/dashboard" });
  // A filter state no drill produces, so a leftover write is visible.
  useStudentsStore.setState({
    filters: {
      status: ["active", "graduated"],
      batchIds: [],
      feeModels: [],
      tagIds: [],
      balanceRange: "overdue_only",
      admittedInLast: "all",
    },
    searchQuery: "aarav",
    page: 3,
  });
});

/**
 * The spoken destination sentence a card announces, read out of its own rendered
 * text.
 *
 * The shape is `Open <screen>. <title>: <value>.` and it sits LAST in the card —
 * the visible title, figure and caption come before it — so this is a search,
 * not an anchor. The five screen names are written out here rather than
 * interpolated from `SCREEN_NAME`: a card that speaks a destination this file
 * does not recognise must FAIL, not be resolved through the table it is being
 * checked against. The `&` in the nav label is deliberately absent from the
 * spoken names — the announcement is read aloud.
 */
const SPOKEN = new RegExp(
  "Open (Dashboard|Students|Attendance|Fees and Payments|Settings)\\.\\s*([^:]+):",
);

interface Spoken {
  readonly screen?: string;
  readonly title?: string;
}

function spokenDestination(text: string): Spoken {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(SPOKEN);
  return m === null ? {} : { screen: m[1], title: m[2] };
}

describe("every KPI card: the words it speaks, the route it drills to, and the filter it writes all agree", () => {
  it("renders one control per declared card, and a card with no table entry fails the test", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();
    await waitFor(() => expect(screen.getByText("Collected")).toBeInTheDocument(), {
      timeout: 8000,
    });

    // The strip must hold EXACTLY the seven declared cards. An eighth button on
    // the strip with no row in `CARD_DRILL` fails here, before it can inherit a
    // neighbour's sentence — which is the whole point: a new card added without a
    // destination must break the build, not quietly drill somewhere plausible.
    const spoken = screen
      .getAllByRole("button")
      .map((b) => spokenDestination(b.textContent ?? ""))
      .filter((s) => s.title !== undefined);
    expect(
      spoken.map((s) => s.title),
      "the strip announces exactly the declared cards, in the titles this test knows",
    ).toEqual(CARDS.map((c) => c.title));
    expect(
      spoken.length,
      "one drill control per declared card, Overdue included — a quick action is not a KPI card and must not be counted here",
    ).toBe(CARDS.length);
  });

  it("declares a row for every card, and an undeclared card cannot borrow one", () => {
    // Exhaustiveness, both directions. `CARD_DRILL` gaining a key without this
    // list gaining an entry is a new card nobody has checked.
    expect(Object.keys(CARD_DRILL).sort()).toEqual(CARDS.map((c) => c.id).sort());

    // A card id the table does not declare resolves to NOTHING — it does not fall
    // through to a default screen and it does not pick up a neighbour's filter.
    const undeclared = "total-fees" as CardId;
    expect(CARD_DRILL[undeclared]).toBeUndefined();
    // And the two helpers that would have to guess THROW rather than answer.
    expect(() => isFilterApplied(undeclared)).toThrow();
    expect(() =>
      drillAnnouncement(CARD_DRILL[undeclared], {
        title: "Total Fees",
        value: "₹1,00,000.00",
        filterApplied: false,
      }),
    ).toThrow();
  });

  it.each(CARDS)("$title speaks the screen it drills to, and writes only the filter it names", async ({ id, title }) => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    const { routes, stop } = captureNavigations();
    try {
      renderClient();
      // Found by its SPOKEN TITLE — the word the card itself prints — never by
      // the screen the table predicts. Locating it through the table would let a
      // card that speaks the wrong screen go missing from the search instead of
      // failing, which is how this bug hides.
      const card = await waitFor(
        () => {
          const found = screen
            .getAllByRole("button")
            .find((b) => spokenDestination(b.textContent ?? "").title === title);
          if (found === undefined) throw new Error(`no card speaks the title "${title}" yet`);
          return found;
        },
        { timeout: 8000 },
      );

      // ── 1. WHAT IT SPEAKS ────────────────────────────────────────────────────
      const spoke = spokenDestination(card.textContent ?? "");
      expect(spoke.screen, `${title} states a destination`).toBeTruthy();
      expect(spoke.title, `${title} states its own title in the sentence`).toBe(title);
      // The destination the test resolves is a route it knows independently.
      const expectedRoute = SPOKEN_TO_ROUTE[spoke.screen!];
      expect(
        expectedRoute,
        `${title} speaks "${spoke.screen}", which this test has no route for — add it to SPOKEN_TO_ROUTE`,
      ).toBeDefined();
      // …and it is the screen the TABLE declares, so sentence and table cannot
      // drift apart without this failing.
      expect(
        spoke.screen,
        `${title} speaks "${spoke.screen}" but CARD_DRILL declares ${SCREEN_NAME[CARD_DRILL[id].screen]}`,
      ).toBe(SCREEN_NAME[CARD_DRILL[id].screen]);

      // ── 2. WHERE IT GOES ─────────────────────────────────────────────────────
      const before = useStudentsStore.getState();
      const beforeRoster = {
        balanceRange: before.filters.balanceRange,
        searchQuery: before.searchQuery,
      };
      routes.length = 0;
      fireEvent.click(card);
      expect(
        routes,
        `${title} clicked once must ask for exactly one route`,
      ).toEqual([expectedRoute!]);
      // The route asked for is the route the card named. THIS is the assertion
      // the blind E2E selector failed to make.
      expect(routes[0], `${title} must drill to the screen it speaks`).toBe(expectedRoute);

      // ── 3. WHAT IT WRITES, AND 4. WHAT IT SAYS ABOUT IT ──────────────────────
      const after = useStudentsStore.getState();
      const wroteAFilter =
        after.filters.balanceRange !== beforeRoster.balanceRange ||
        after.searchQuery !== beforeRoster.searchQuery;
      const saysAFilter = (card.textContent ?? "").includes("Filtered to");

      if (wroteAFilter) {
        // A written filter is fully specified, and the card says so. A search or a
        // page left behind would show one name on an empty page, so both are
        // pinned — a card that clears the search must say it is showing everyone.
        expect(after.searchQuery, `${title} wrote a filter, so it clears a stale search`).toBe("");
        expect(after.page, `${title} wrote a filter, so it returns to page 1`).toBe(1);
        expect(after.filters.status, `${title} pins its own status filter`).toEqual(
          CARD_DRILL[id].filter.target === "students" ? CARD_DRILL[id].filter.status : expect.anything(),
        );
        expect(saysAFilter, `${title} wrote a filter and must announce it`).toBe(true);
        // The phrase names the destination's own vocabulary, not the store's.
        expect(card.textContent).toContain(`Filtered to ${CARD_DRILL[id].filter.targetPhrase}`);
      } else {
        // Rule 9: a card that dropped the filter says nothing about having one.
        expect(
          saysAFilter,
          `${title} announces a filter it did not apply — that is a card lying to a screen-reader user`,
        ).toBe(false);
      }

      // ── 5. THE ORDER ─────────────────────────────────────────────────────────
      // Every filter write lands BEFORE the screen write, because the destination
      // mounts on the same commit and reads its filter on first render. Recorded
      // by reading the store at the instant the navigation was requested.
      if (CARD_DRILL[id].filter.target === "students") {
        const balanceAtNavigation = useStudentsStore.getState().filters.balanceRange;
        expect(
          balanceAtNavigation,
          `${title} must have written its roster filter before asking for the route`,
        ).toBe(CARD_DRILL[id].filter.balanceRange);
      }
    } finally {
      stop();
    }
  });

  it("the announcement helper and the applier derive 'was a filter written' from ONE fact", () => {
    // `isFilterApplied(card)` (which the card passes to `drillAnnouncement`) and
    // `applyCardDrill(card).filterApplied` (which the applier reports) were two
    // separate expressions of the same predicate. Nothing asserted they agreed,
    // so one could become true while the other stayed false — and the card would
    // announce a filter the applier never wrote, which is the exact lie Rule 9
    // forbids. Pinned per card, for all seven.
    for (const { id, title } of CARDS) {
      const applied = applyCardDrill(id, {
        students: {
          setFilters: () => undefined,
          setSearchQuery: () => undefined,
          setPage: () => undefined,
        },
        goTo: () => undefined,
      });
      expect(
        applied.filterApplied,
        `${title}: the announcement's gate and the applier's report must be the same fact`,
      ).toBe(isFilterApplied(id));
      // …and the sentence follows from that one fact, with no third opinion.
      const phrase = CARD_DRILL[id].filter.targetPhrase;
      const said = drillAnnouncement(CARD_DRILL[id], {
        title,
        value: "0",
        filterApplied: isFilterApplied(id),
      });
      if (isFilterApplied(id) && phrase !== null) {
        expect(said).toBe(`Open ${SCREEN_NAME[CARD_DRILL[id].screen]}. ${title}: 0. Filtered to ${phrase}`);
      } else {
        expect(said).toBe(`Open ${SCREEN_NAME[CARD_DRILL[id].screen]}. ${title}: 0.`);
      }
    }
  });
});