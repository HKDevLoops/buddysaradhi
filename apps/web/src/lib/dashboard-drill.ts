// Implements: 04_Dashboard.md §10.1 (every KPI card names a drill-down target
// AND the filter the destination screen must apply) and §19.4 step 3 ("Click each
// KPI card → lands on the correct screen with the correct filter"); §18 (Enter
// activates the drill). AGENTS.md §2 Rule 4 (the five screens are ONE route, so a
// drill is a store write followed by a screen write — never a navigation) and
// Rule 9 (a filter that cannot be applied is DECLARED here, never implied in the
// tutor-facing sentence).
//
// WHY THIS FILE EXISTS AT ALL.
//
// `dashboard-client.tsx` used to hold a `CARD_DRILL: Record<string, ScreenId>` —
// seven names, seven screens, and nothing else. C1/C3/C6 all collapsed to a bare
// `/fees` and C4/C5 to a bare `/students`, which is exactly the defect §19.4
// names: a tutor taps "Collected" and lands on an UNFILTERED ledger. The file's
// own comment admitted the filtered half "needs the Fees and Students store
// contracts, which live in files this lane does not own" and shipped the screen
// switch alone. The contract is now this module — screen, filter, and the words
// the card says out loud — and the applier performs the writes in the ONE order
// that makes them real: FILTER FIRST, THEN THE SCREEN. Writing the screen first
// is the bug's second half; the destination mounts on the very next render, so a
// filter written after the switch lands a frame late or not at all.
//
// THE HONEST BOUNDARY — READ THIS BEFORE ADDING A CARD.
//
// A drill is only as good as the destination's ability to be filtered, so each
// filter carries the vocabulary of the screen it lands on and whether that
// screen can express it TODAY:
//
//   · `target: "students"` — WRITABLE. `useStudentsStore.filters` is threaded
//     into the roster query key (`students-client.tsx:49`) and forwarded to the
//     gateway, which HONOURS `balanceRange` and `status`
//     (`apps/gateway/routes/students.ts:224-254`). So C4 and C5 arrive pre-filtered.
//
//   · `target: "fees"` — NOT WRITABLE TODAY. `useFeesStore` HAS a `mode` and a
//     `searchQuery`, and NOTHING reads either: `fees-client.tsx:99-101` keeps the
//     active tab and the roster query in component-local `useState`. Writing them
//     would be a dead store write — a filter the destination ignores, which is a
//     worse lie than an unfiltered screen because the code would look like it
//     worked. `targetPhrase` records what the destination must do so the day the
//     Fees screen reads its own store, this table is the only place to change.
//
// `drillAnnouncement` is the enforcement of that honesty: it speaks
// `targetPhrase` ONLY for a filter the applier actually wrote. A card cannot
// announce a filter it did not apply, and the test suite pins that for all seven.

import type { ScreenId } from "@/stores/shell-store";
import type { StudentFilters } from "@/types/students";

/** The seven cards on the §6.2 strip, including the overdue subset card. */
export type CardId =
  | "collected"
  | "due-till-date"
  | "due-in-period"
  | "total-students"
  | "students-with-dues"
  | "breakdown"
  | "overdue";

/** C6's four buckets — BR-CALC-02's classification, one word each. */
export type BreakdownKey = "paid" | "partial" | "unpaid" | "noDues";

/**
 * The Fees screen's tabs, pinned to `FeesTab` in
 * `components/fees/fees-client.tsx:55`. Declared here rather than imported so
 * this module stays free of React; the two must change together, and the table
 * below is the second copy a reader can diff against that union.
 */
export type FeesView = "ledger" | "pending" | "collections";

/** The screen label a card announces. §18 makes the destination reachable. */
export const SCREEN_NAME: Record<ScreenId, string> = {
  "/dashboard": "Dashboard",
  "/students": "Students",
  "/attendance": "Attendance",
  "/fees": "Fees and Payments",
  "/settings": "Settings",
};

/**
 * The filter a drill must leave on the destination screen, in that screen's own
 * vocabulary. `targetPhrase` is what the card says to a tutor when — and only
 * when — the applier really wrote the filter.
 */
export type DrillFilter =
  | {
      readonly target: "students";
      /**
       * Pinned, not inherited. C4 counts `status='active'` and C5 counts
       * ACTIVE students owing money (`apps/gateway/routes/analytics.ts:223-237`),
       * so a drill that carried over whatever status the tutor had last chosen
       * would show a roster whose count cannot equal the number on the card.
       */
      readonly status: StudentFilters["status"];
      readonly balanceRange: StudentFilters["balanceRange"];
      /**
       * A roster search left over from an earlier visit would narrow the
       * destination to one name, so a tutor who taps "Students With Dues: 12"
       * would be shown 1 student and the card would look wrong.
       */
      readonly clearSearch: true;
      readonly targetPhrase: string;
    }
  | {
      readonly target: "fees";
      readonly view: FeesView;
      readonly paymentStatus: BreakdownKey | null;
      readonly period: "current-period" | null;
      /** `null` when §10.1 asks for no filter at all (C2 — "unfiltered"). */
      readonly targetPhrase: string | null;
    };

export interface CardDrill {
  readonly screen: ScreenId;
  readonly filter: DrillFilter;
}

const ACTIVE: StudentFilters["status"] = ["active"];

/**
 * §10.1, card by card. `collected` (C1) and `due-in-period` (C3) follow the
 * period; `due-till-date` (C2), `total-students` (C4), `students-with-dues` (C5)
 * and the breakdown (C6) do not — which is exactly why C1 and C3 carry a period
 * and the rest carry none. `overdue` is the subset of C3 whose due date has
 * passed, so it is deliberately not period-scoped.
 */
export const CARD_DRILL: Record<CardId, CardDrill> = {
  // C1 → "Fees screen, filtered to payments-only, period = current month."
  collected: {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "ledger",
      paymentStatus: null,
      period: "current-period",
      targetPhrase: "the ledger, filtered to payments received.",
    },
  },
  // C2 → "Fees screen, unfiltered (shows the full ledger matrix)." No filter is
  // requested, so this drill is already satisfied by the screen switch alone and
  // its phrase is deliberately null — announcing a filter here would invent one.
  "due-till-date": {
    screen: "/fees",
    filter: { target: "fees", view: "ledger", paymentStatus: null, period: null, targetPhrase: null },
  },
  // C3 → "filtered to status=unpaid,partial,overdue, issue_date = current month."
  // §10.1's status set IS the Fees screen's "Pending / Overdue" tab.
  "due-in-period": {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "pending",
      paymentStatus: null,
      period: "current-period",
      targetPhrase: "unpaid invoices raised in the period.",
    },
  },
  // C4 → "Students screen, unfiltered." The card measures the ACTIVE roster, so
  // the destination filter is the whole active roster — and `balanceRange` is
  // reset too, or a previous C5 tap would leave the roster narrowed to debtors
  // while the card reads "Active Students: 87".
  "total-students": {
    screen: "/students",
    filter: {
      target: "students",
      status: ACTIVE,
      balanceRange: "all",
      clearSearch: true,
      targetPhrase: "every active student.",
    },
  },
  // C5 → "Students screen, filtered to has-dues = true." `has_dues` is
  // `balance_paise > 0` in the gateway — the same predicate BR-CALC-01 counts.
  "students-with-dues": {
    screen: "/students",
    filter: {
      target: "students",
      status: ACTIVE,
      balanceRange: "has_dues",
      clearSearch: true,
      targetPhrase: "active students who owe money.",
    },
  },
  // C6 → "tapping a colored dot → Fees screen filtered to that status". The
  // card-level drill is the whole breakdown with no status, so `paymentStatus` is
  // null; see the C6 note in `dashboard-client.tsx` for why the four dots are not
  // four buttons yet.
  breakdown: {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "pending",
      paymentStatus: null,
      period: null,
      targetPhrase: null,
    },
  },
  // The overdue subset of C3 — §6.4's caption already says it is all-time.
  overdue: {
    screen: "/fees",
    filter: { target: "fees", view: "pending", paymentStatus: null, period: null, targetPhrase: null },
  },
};

/**
 * §10.1 C6, one row per bucket: "tapping a colored dot → Fees screen filtered to
 * that status (e.g. `status=partial`)" (BR-CALC-02's four-way classification).
 *
 * Declared, tested, and NOT yet wired — see the header's honesty boundary. The
 * table exists so the day `useFeesStore` gains a `paymentStatus` field the
 * wiring is one map lookup here and four `onClick`s in the card, with no second
 * place where a status could be spelled two ways.
 */
export const C6_DRILL: Record<BreakdownKey, CardDrill> = {
  paid: {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "pending",
      paymentStatus: "paid",
      period: null,
      targetPhrase: "students whose invoices are settled.",
    },
  },
  partial: {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "pending",
      paymentStatus: "partial",
      period: null,
      targetPhrase: "students who paid part of what they owe.",
    },
  },
  unpaid: {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "pending",
      paymentStatus: "unpaid",
      period: null,
      targetPhrase: "students who have paid nothing against what they owe.",
    },
  },
  noDues: {
    screen: "/fees",
    filter: {
      target: "fees",
      view: "pending",
      paymentStatus: "noDues",
      period: null,
      targetPhrase: "students who have never been invoiced.",
    },
  },
};

/**
 * Whether a card's destination can actually be filtered by anything the app
 * holds today. Derived from the table rather than passed in, so a card cannot
 * announce a filter it did not apply and no call site has to remember the rule.
 */
export function isFilterApplied(card: CardId): boolean {
  return CARD_DRILL[card].filter.target === "students";
}

/**
 * The slice of `useStudentsStore` a drill writes. Structural, so this module
 * never imports the store and the contract table stays testable without React.
 */
export interface StudentsDrillPort {
  setFilters: (filters: Partial<StudentFilters>) => void;
  setSearchQuery: (query: string) => void;
  setPage: (page: number) => void;
}

export interface AppliedDrill {
  readonly screen: ScreenId;
  /** Every store field this drill wrote, in the order it wrote them. */
  readonly storeWrites: readonly string[];
  /**
   * FALSE means the destination screen could not be filtered by anything this
   * lane owns. The card then navigates and announces only its destination — it
   * does not claim a filter it did not apply (Rule 9).
   */
  readonly filterApplied: boolean;
}

export interface DrillDeps {
  readonly students: StudentsDrillPort;
  readonly goTo: (screen: ScreenId) => void;
}

/**
 * Fire a drill. The ORDER is the contract: every filter write lands before the
 * screen write, because the destination screen mounts on the same commit and
 * reads its filter on first render.
 *
 * `setPage(1)` is explicit even though `setFilters` and `setSearchQuery` both
 * reset the page today. A drill must not depend on that, or page 7 of a
 * pre-filter roster would arrive as an empty Students screen.
 */
export function applyDrill(drill: CardDrill, deps: DrillDeps): AppliedDrill {
  const writes: string[] = [];

  if (drill.filter.target === "students") {
    deps.students.setFilters({
      status: drill.filter.status,
      balanceRange: drill.filter.balanceRange,
    });
    writes.push("students.filters");
    if (drill.filter.clearSearch) {
      deps.students.setSearchQuery("");
      writes.push("students.searchQuery");
    }
    deps.students.setPage(1);
    writes.push("students.page");
  }

  deps.goTo(drill.screen);

  return {
    screen: drill.screen,
    storeWrites: writes,
    filterApplied: drill.filter.target === "students",
  };
}

/** `applyDrill` for one card on the §6.2 strip. */
export function applyCardDrill(card: CardId, deps: DrillDeps): AppliedDrill {
  return applyDrill(CARD_DRILL[card], deps);
}

/**
 * The sentence a card ends with, for a screen reader (Rule 10) and for the §19.4
 * audit that reads a card's destination out of its own accessible name.
 *
 * The figure and its window come first and are unchanged from before; the filter
 * clause is appended ONLY when `filterApplied`, so the sentence can never
 * promise a filter the destination did not receive. Punctuation is kept
 * deliberately flat — this string is read aloud, not rendered.
 */
export function drillAnnouncement(
  drill: CardDrill,
  parts: { readonly title: string; readonly value: string; readonly filterApplied: boolean },
): string {
  const head = `Open ${SCREEN_NAME[drill.screen]}. ${parts.title}: ${parts.value}.`;
  const phrase = drill.filter.targetPhrase;
  if (!parts.filterApplied || phrase === null) return head;
  return `${head} Filtered to ${phrase}`;
}
