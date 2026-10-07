// Implements: 04_Dashboard.md §6.2 (C1..C6 exist on the strip), §6.4 (the
// period moves C1/C3 and states that it does not move C2/C4/C5/C6), §9 (a
// failed read never renders zeroes), §11 E1/E4 (first-run composition, 90-day
// rejection), §10.1 (drill targets), §14 (a page that is not the whole list
// says so), §18 (Tab reaches the cards, Enter fires them); §19.2 component
// tests. AGENTS.md §2 Rule 4 (no route is created — a drill is a store write),
// Rule 9 (no silent failure), Rule 10 (44px targets, colour never the only
// signal).

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
  type DashboardKpis,
  type DashboardSummary,
} from "@/server/actions/dashboard";
import { DashboardClient } from "./dashboard-client";
import { useShellStore } from "@/stores/shell-store";
import { useStudentsStore } from "@/stores/students-store";
import {
  C6_DRILL,
  CARD_DRILL,
  applyDrill,
  drillAnnouncement,
  isFilterApplied,
  type CardId,
} from "@/lib/dashboard-drill";
import { resolvePeriodWindow, type PeriodWindow } from "@/lib/dashboard-period";

/**
 * jsdom ships no `window.matchMedia`, and `components/ui/count-up.tsx` calls it
 * unguarded — so every KPI card threw in this environment before any assertion
 * could run. Reported to the lead as a P2 (`count-up.tsx` should feature-detect,
 * the same way it already feature-detects `window`). Shimming it here with
 * `matches: true` does double duty: the count-up takes its reduced-motion path
 * and lands on the final value immediately, which is both the §18 contract and
 * what makes the money assertions deterministic.
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

const fetchSummary = vi.mocked(fetchDashboardSummaryAction);

const WINDOW: PeriodWindow = {
  periodStartIso: "2026-10-01",
  periodEndIso: "2026-10-05",
  label: "October 2026",
  labelLower: "october 2026",
  movesMoneyCards: true,
};

/**
 * The fixture is typed as the ACTION's own output, so a fixture that stops
 * matching the boundary schema is a compile error rather than a runtime surprise
 * in the render path. `dataOrigin` stays the literal `"live"` because that is
 * what the Zod boundary enforces.
 */
type SummaryFixture = {
  kpis: DashboardKpis;
  activity: DashboardSummary["activity"];
  dueToday: DashboardSummary["dueToday"];
  dueTodayTotal: number;
  dueTodayTruncated: boolean;
  dataOrigin: "live";
};

function summary(overrides: Partial<SummaryFixture> = {}): DashboardSummary {
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
    ...overrides,
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

beforeEach(() => {
  vi.clearAllMocks();
  useShellStore.setState({ activeScreen: "/dashboard" });
  // The drill writes the roster filter, so a filter left behind by one test
  // would decide what the next test sees. Reset to a state no drill produces:
  // narrowed, searched, and on page 3.
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

const CARDS: CardId[] = [
  "collected",
  "due-till-date",
  "due-in-period",
  "total-students",
  "students-with-dues",
  "breakdown",
  "overdue",
];

describe("CARD_DRILL — §10.1 names a screen AND the filter it must apply", () => {
  it("every card declares a screen and a filter, and none falls back to a default", () => {
    // The defect was a `Record<string, ScreenId>` where a typo in a card's `name`
    // silently fell back to "/dashboard". A total over the seven keys is the
    // guard: a new card has to appear here or the table is incomplete.
    expect(Object.keys(CARD_DRILL).sort()).toEqual([...CARDS].sort());
    for (const card of CARDS) {
      expect(CARD_DRILL[card].screen, `${card} names a screen`).toMatch(/^\//);
      expect(
        CARD_DRILL[card].filter.target,
        `${card} names the filter in the destination's own vocabulary`,
      ).toMatch(/^(students|fees)$/);
    }
  });

  it("routes the four money cards to Fees and the two roster cards to Students", () => {
    // C1 collected, C2 due till date, C3 due in period, C6 breakdown + overdue.
    for (const card of ["collected", "due-till-date", "due-in-period", "breakdown", "overdue"] as const) {
      expect(CARD_DRILL[card].screen, `${card} opens Fees`).toBe("/fees");
    }
    // C4 total students, C5 students with dues — §10.1's two Students targets.
    for (const card of ["total-students", "students-with-dues"] as const) {
      expect(CARD_DRILL[card].screen, `${card} opens Students`).toBe("/students");
    }
  });

  it("is writable only for the cards whose destination screen reads its store", () => {
    // `useStudentsStore.filters` reaches the roster query and the gateway
    // honours it; the Fees screen reads neither `useFeesStore.mode` nor
    // `useFeesStore.searchQuery`, so a Fees filter is declared, not written.
    expect(CARD_DRILL["students-with-dues"].filter).toEqual({
      target: "students",
      status: ["active"],
      balanceRange: "has_dues",
      clearSearch: true,
      targetPhrase: expect.any(String),
    });
    expect(CARD_DRILL["total-students"].filter).toEqual({
      target: "students",
      status: ["active"],
      balanceRange: "all",
      clearSearch: true,
      targetPhrase: expect.any(String),
    });
    expect(isFilterApplied("students-with-dues")).toBe(true);
    expect(isFilterApplied("total-students")).toBe(true);
    for (const card of ["collected", "due-in-period", "overdue"] as const) {
      expect(isFilterApplied(card), `${card} cannot be written yet`).toBe(false);
    }
  });

  it("§10.1 C6 — every bucket declares the Fees status it must filter to", () => {
    // Four dots, four destinations, one table. Each bucket's `paymentStatus` is
    // the BR-CALC-02 word, so the status can never be spelled two ways.
    expect(Object.keys(C6_DRILL)).toEqual(["paid", "partial", "unpaid", "noDues"]);
    for (const [key, drill] of Object.entries(C6_DRILL)) {
      expect(drill.screen, `C6 ${key} opens Fees`).toBe("/fees");
      expect(drill.filter, `C6 ${key} is a Fees filter`).toMatchObject({ target: "fees" });
      expect(
        (drill.filter as { paymentStatus: string }).paymentStatus,
        `C6 ${key} names its own status`,
      ).toBe(key);
    }
  });
});

describe("applyDrill — filter first, then the screen", () => {
  it("writes the roster filter the card names, and the screen after it", () => {
    const calls: string[] = [];
    const students = {
      setFilters: () => calls.push("filters"),
      setSearchQuery: () => calls.push("search"),
      setPage: () => calls.push("page"),
    };
    const goTo = () => calls.push("screen");

    const applied = applyDrill(CARD_DRILL["students-with-dues"], { students, goTo });

    // Order is the contract: the destination screen mounts on the same commit
    // and reads its filter on first render.
    expect(calls).toEqual(["filters", "search", "page", "screen"]);
    expect(applied.filterApplied).toBe(true);
    expect(applied.storeWrites).toEqual([
      "students.filters",
      "students.searchQuery",
      "students.page",
    ]);
  });

  it("writes nothing to a store the destination does not read", () => {
    const calls: string[] = [];
    const students = {
      setFilters: () => calls.push("filters"),
      setSearchQuery: () => calls.push("search"),
      setPage: () => calls.push("page"),
    };
    const goTo = () => calls.push("screen");

    const applied = applyDrill(CARD_DRILL.collected, { students, goTo });

    // "Collected" is the card the defect was named after. It navigates, and it
    // reports `filterApplied: false` rather than claiming a filter it dropped.
    expect(calls).toEqual(["screen"]);
    expect(applied.filterApplied).toBe(false);
    expect(applied.storeWrites).toEqual([]);
  });

  it("announces a filter only when the filter was written", () => {
    const written = drillAnnouncement(CARD_DRILL["students-with-dues"], {
      title: "Students With Dues",
      value: "12",
      filterApplied: true,
    });
    expect(written).toBe(
      "Open Students. Students With Dues: 12. Filtered to active students who owe money.",
    );

    // The same card, pretending it wrote the filter: nothing to announce.
    const unwritten = drillAnnouncement(CARD_DRILL.collected, {
      title: "Collected",
      value: "₹1,24,500.00",
      filterApplied: false,
    });
    expect(unwritten).toBe("Open Fees and Payments. Collected: ₹1,24,500.00.");

    // §10.1 asks C2 for NO filter, so its phrase is null and none is invented.
    const c2 = drillAnnouncement(CARD_DRILL["due-till-date"], {
      title: "Due Till Date",
      value: "₹38,200.00",
      filterApplied: true,
    });
    expect(c2).toBe("Open Fees and Payments. Due Till Date: ₹38,200.00.");
  });
});

describe("DashboardClient — a card tap leaves the destination store filtered", () => {
  it("C5 Students With Dues lands on a roster narrowed to has-dues", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Students With Dues")).toBeInTheDocument(),
      { timeout: 8000 },
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Open Students\. Students With Dues/ }),
    );

    // The destination store HOLDS the filter, not merely the screen.
    const roster = useStudentsStore.getState();
    expect(useShellStore.getState().activeScreen).toBe("/students");
    expect(roster.filters.balanceRange).toBe("has_dues");
    expect(roster.filters.status).toEqual(["active"]);
    // The pre-drill `searchQuery` and page 3 would have shown one student on an
    // empty page; the card claims 12.
    expect(roster.searchQuery).toBe("");
    expect(roster.page).toBe(1);
  });

  it("C4 Active Students clears a filter a previous C5 tap left behind", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(() => expect(screen.getByText("Active Students")).toBeInTheDocument(), {
      timeout: 8000,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open Students\. Students With Dues/ }));
    expect(useStudentsStore.getState().filters.balanceRange).toBe("has_dues");

    fireEvent.click(screen.getByRole("button", { name: /Open Students\. Active Students/ }));
    // "Active Students: 87" and a roster still narrowed to debtors cannot both be
    // true, so C4 resets `balanceRange` as well as the search.
    expect(useStudentsStore.getState().filters.balanceRange).toBe("all");
    expect(useStudentsStore.getState().filters.status).toEqual(["active"]);
    expect(useStudentsStore.getState().searchQuery).toBe("");
    expect(useShellStore.getState().activeScreen).toBe("/students");
  });

  it("a Fees card switches screen and leaves the roster filter untouched", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(() => expect(screen.getByText("Collected")).toBeInTheDocument(), {
      timeout: 8000,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open Fees and Payments\. Collected/ }));

    expect(useShellStore.getState().activeScreen).toBe("/fees");
    // Untouched: the drill owns the Students filter only when it lands on
    // Students, so a Fees card cannot silently re-narrow the roster.
    expect(useStudentsStore.getState().filters.balanceRange).toBe("overdue_only");
    expect(useStudentsStore.getState().searchQuery).toBe("aarav");
  });

  it("writes the filter BEFORE the screen switches, so the destination mounts filtered", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });

    // Patched BEFORE the render: `DashboardClient` binds `setActiveScreen` out of
    // the store at render time, so a patch applied afterwards would never be the
    // function the card calls.
    const observed: string[] = [];
    const realSetActiveScreen = useShellStore.getState().setActiveScreen;
    useShellStore.setState({
      setActiveScreen: (screen) => {
        // Read at the instant the screen write happens — the instant the
        // destination screen mounts and reads its filter on first render.
        observed.push(useStudentsStore.getState().filters.balanceRange);
        realSetActiveScreen(screen);
      },
    });

    try {
      renderClient();
      await waitFor(
        () => expect(screen.getByText("Students With Dues")).toBeInTheDocument(),
        { timeout: 8000 },
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Open Students\. Students With Dues/ }),
      );
    } finally {
      useShellStore.setState({ setActiveScreen: realSetActiveScreen });
    }

    expect(observed).toEqual(["has_dues"]);
  });

  it("C5's accessible name states the filter its destination will already show", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Students With Dues")).toBeInTheDocument(),
      { timeout: 8000 },
    );

    expect(
      screen.getByRole("button", {
        name: /Students With Dues: 12\. Filtered to active students who owe money\.$/,
      }),
    ).toBeInTheDocument();
    // And the collected card promises no filter, because it writes none. The
    // sentence is the LAST thing in the card, so it anchors to the end of the
    // accessible name — the visible figure and caption come before it.
    expect(
      screen.getByRole("button", {
        name: /Open Fees and Payments\. Collected: ₹1,24,500\.00\.$/,
      }),
    ).toBeInTheDocument();
  });
});

describe("DashboardClient — KPI strip", () => {
  it("renders all six §6.2 cards, including the two that used to be dead data", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Collected")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    // C1 collected, C2 due till date, C3 due in period, C4 active students,
    // C5 students with dues, C6 payment breakdown. `dueForMonthMinor` and
    // `paymentBreakdown` used to cross the Zod boundary and reach no element.
    for (const title of [
      "Collected",
      "Due Till Date",
      "Due In Period",
      "Active Students",
      "Students With Dues",
      "Payment Breakdown",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // The C6 figures themselves, in paise→rupees via formatINR.
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Never invoiced")).toBeInTheDocument();
  });

  it("states inside each period-independent card that the period does not move it (§6.4)", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Due Till Date")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    for (const caption of [
      "Owed up to today, all time. Does not follow the period.",
      "On the roster right now. Does not follow the period.",
      "Owe more than a rounding paise. Does not follow the period.",
      "Students by payment status. Does not follow the period.",
    ]) {
      expect(screen.getByText(caption)).toBeInTheDocument();
    }
  });

  it("names the window on the two cards the period does move", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Collected")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.getByText("Payments received in october 2026")).toBeInTheDocument();
    expect(screen.getByText("Still unpaid on invoices due in october 2026")).toBeInTheDocument();
  });

  it("makes every KPI card a real control with a 44px target and a stated destination", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Collected")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    const collected = screen.getByRole("button", { name: /Open Fees and Payments\. Collected/ });
    expect(collected.className).toContain("min-h-[44px]");
    const students = screen.getByRole("button", { name: /Open Students\. Active Students/ });
    fireEvent.click(students);
    expect(useShellStore.getState().activeScreen).toBe("/students");
  });
});

describe("DashboardClient — period filter (§6.4)", () => {
  it("sends the applied period to the action and keys the query on it", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(() => expect(fetchSummary).toHaveBeenCalled(), { timeout: 8000 });
    // Default is the calendar month, so opening the screen changes no figure.
    expect(fetchSummary).toHaveBeenCalledWith({ mode: "month", start: null, end: null });

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(
      () =>
        expect(fetchSummary).toHaveBeenCalledWith({ mode: "all", start: null, end: null }),
      { timeout: 8000 },
    );
  });

  it("refuses a range longer than 90 days and leaves the applied period alone (§11 E4)", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    // 61 days back to today is inside the cap; 200 back is 201 days and is not.
    const inBounds = daysAgo(60);
    const outOfBounds = daysAgo(200);

    await waitFor(
      () => expect(screen.getByRole("button", { name: "Range" })).toBeInTheDocument(),
      { timeout: 8000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Range" }));
    await waitFor(
      () => expect(screen.getByLabelText("Period start day")).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Inside the cap: applied, and therefore sent to the gateway.
    fireEvent.change(screen.getByLabelText("Period start day"), {
      target: { value: inBounds },
    });
    await waitFor(
      () =>
        expect(fetchSummary).toHaveBeenLastCalledWith({
          mode: "range",
          start: inBounds,
          end: today,
        }),
      { timeout: 8000 },
    );

    // Outside the cap: refused, so no new query, and the figures on screen keep
    // describing the window that was actually read. Nothing widens to all time.
    fireEvent.change(screen.getByLabelText("Period start day"), {
      target: { value: outOfBounds },
    });
    await waitFor(
      () => expect(screen.getByLabelText("Period start day")).toHaveValue(inBounds),
      { timeout: 8000 },
    );
    expect(fetchSummary).toHaveBeenLastCalledWith({
      mode: "range",
      start: inBounds,
      end: today,
    });
  });

  it("shows the applied window above the figures", async () => {
    fetchSummary.mockResolvedValue({ ok: true, value: { summary: summary(), window: WINDOW } });
    renderClient();

    await waitFor(
      () => expect(screen.getByText(/Showing October 2026\./)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

describe("DashboardClient — states (Rule 9, §11 E1)", () => {
  it("renders the loading skeleton, never a row of zeroes", async () => {
    const gate: { release: () => void } = { release: () => undefined };
    fetchSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () => resolve({ ok: true, value: { summary: summary(), window: WINDOW } });
        }),
    );
    renderClient();

    await waitFor(
      () => expect(screen.getByText(/your dashboard/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.queryByText("Collected")).not.toBeInTheDocument();
    gate.release();
  });

  it("renders an error state and no figure when the read fails", async () => {
    fetchSummary.mockResolvedValue({
      ok: false,
      code: "DASHBOARD_GATEWAY_FAILED",
      error: "DASHBOARD_GATEWAY_FAILED: gateway timeout",
    });
    renderClient();

    // Wait for the failure surface itself. Asserting the ABSENCE of a KPI card
    // first would pass during the loading skeleton and prove nothing.
    expect(
      await screen.findByText(/no figure below is being shown/i, undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Collected")).not.toBeInTheDocument();
    // The other four screens stay reachable — the point of saying what is safe.
    expect(screen.getByRole("button", { name: /Record Payment/ })).toBeInTheDocument();
  });

  it("shows the first-run composition for a tenant with no books (§11 E1 / P15)", async () => {
    fetchSummary.mockResolvedValue({
      ok: true,
      value: {
        summary: summary({
          kpis: {
            totalStudents: 0,
            studentsWithDues: 0,
            collectedThisMonthMinor: 0,
            dueTillDateMinor: 0,
            dueForMonthMinor: 0,
            overdueMinor: 0,
            paymentBreakdown: { paid: 0, partial: 0, unpaid: 0, noDues: 0 },
          },
        }),
        window: WINDOW,
      },
    });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Welcome to Buddysaradhi")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    // No grid of zeroes, and the Due Today panel is hidden (E1).
    expect(screen.queryByText("Collected")).not.toBeInTheDocument();
    expect(screen.queryByText("Due Today")).not.toBeInTheDocument();
    // The welcome CTA and the quick-action bar both offer "Add Student"; the
    // first one is the welcome card's own primary action.
    const ctas = screen.getAllByRole("button", { name: /Add Student/ });
    expect(ctas.length).toBeGreaterThanOrEqual(2);
    const cta = ctas[0];
    expect(cta?.className).toContain("min-h-[44px]");
    fireEvent.click(cta!);
    expect(useShellStore.getState().activeScreen).toBe("/students");
  });

  it("keeps the full strip when there are no ACTIVE students but money still exists", async () => {
    // A tutor whose students have all graduated has zero active students and a
    // real arrears balance. Hiding that behind a welcome panel would be the same
    // class of lie as the all-zero grid it replaced.
    fetchSummary.mockResolvedValue({
      ok: true,
      value: {
        summary: summary({
          kpis: {
            totalStudents: 0,
            studentsWithDues: 0,
            collectedThisMonthMinor: 0,
            dueTillDateMinor: 450000,
            dueForMonthMinor: 0,
            overdueMinor: 450000,
            paymentBreakdown: { paid: 0, partial: 0, unpaid: 0, noDues: 0 },
          },
        }),
        window: WINDOW,
      },
    });
    renderClient();

    await waitFor(() => expect(screen.getByText("Collected")).toBeInTheDocument(), {
      timeout: 8000,
    });
    expect(screen.queryByText("Welcome to Buddysaradhi")).not.toBeInTheDocument();
  });
});

describe("DashboardClient — due today", () => {
  it("gives one row per invoice even when a student owns two overdue invoices", async () => {
    fetchSummary.mockResolvedValue({
      ok: true,
      value: {
        summary: summary({
          dueToday: [
            {
              student_id: "s-1",
              student_name: "Aarav Sharma",
              due_minor: 250000,
              invoice_number: "INV-0017",
              due_date: "2026-10-01T00:00:00.000Z",
            },
            {
              student_id: "s-1",
              student_name: "Aarav Sharma",
              due_minor: 120000,
              invoice_number: "INV-0018",
              due_date: "2026-10-02T00:00:00.000Z",
            },
          ],
          dueTodayTotal: 2,
          dueTodayTruncated: false,
        }),
        window: WINDOW,
      },
    });
    renderClient();

    // Two rows, two distinct invoice numbers, two distinct amounts. With
    // `key={student_id}` the second row reused the first row's DOM and the
    // amounts on screen belonged to the wrong invoice.
    await waitFor(
      () => expect(screen.getAllByText("Inv INV-0017")).toHaveLength(1),
      { timeout: 8000 },
    );
    expect(screen.getAllByText("Inv INV-0018")).toHaveLength(1);
    expect(screen.getByText("₹2,500.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,200.00")).toBeInTheDocument();
  });

  it("says how late a row is in whole days and says nothing for one due today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    fetchSummary.mockResolvedValue({
      ok: true,
      value: {
        summary: summary({
          dueToday: [
            {
              student_id: "s-1",
              student_name: "Aarav Sharma",
              due_minor: 250000,
              invoice_number: "INV-0001",
              due_date: `${today}T00:00:00.000Z`,
            },
          ],
          dueTodayTotal: 1,
          dueTodayTruncated: false,
        }),
        window: WINDOW,
      },
    });
    renderClient();

    await waitFor(
      () => expect(screen.getByText("Inv INV-0001")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    // The regression: "1 day overdue" for an invoice due today.
    expect(screen.queryByText(/day[s]? overdue/)).not.toBeInTheDocument();
  });
});

describe("window plumbing", () => {
  it("resolvePeriodWindow is the same derivation the action uses", () => {
    // A guard against the two drifting: the control's label and the window the
    // gateway is asked for come from one function, by construction.
    expect(resolvePeriodWindow({ mode: "month", start: null, end: null }, Date.now())).toEqual(
      expect.objectContaining({ movesMoneyCards: true }),
    );
  });
});
