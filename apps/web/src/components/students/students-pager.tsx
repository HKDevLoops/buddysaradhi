"use client";

// Implements: 05_Students.md §Master List — roster paging. A tutor's roster must be
// fully reachable: `students-store` pages the query at 50 rows, so before this pager a
// 200-student institute put 150 students permanently out of reach (no pager and no
// page-size control existed anywhere on the screen). This component is the seam that
// closes that gap.
//
// Rules honoured here:
//   • AGENTS.md §2 Rule 10 — 44×44px targets, keyboard parity, and colour is never the
//     only signal: the position is spelled out in words ("Showing 51–100 of 200"), and
//     the direction buttons carry text labels, not bare arrows.
//   • 05_Students.md §6.3 — one search box on this screen. The pager adds a page-size
//     select, not a second search field.
//   • AGENTS.md §2 Rule 2 / P5 — the pager is a pure read of the store; it issues no
//     request of its own. Changing page or page size re-keys the existing query.
//   • `prefers-reduced-motion` — the pager animates nothing beyond a 150ms colour
//     transition, which `globals.css` already neutralises under the reduced-motion
//     media query. No transform, no spinner, no layout shift.

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Rows-per-page options. 50 is the product default (dense enough to scan, short
 * enough that a scroll never loses the list header); 25 and 100 are the trade a tutor
 * makes between scroll distance and screenfuls.
 */
export const PAGE_SIZES = [25, 50, 100] as const;

export interface PageWindowInput {
  page: number;
  pageSize: number;
  /**
   * Total matching rows as reported by the query — never estimated from the number of
   * rows that happen to be on screen, which is what makes `nextDisabled` honest.
   */
  total: number;
}

export interface PageWindow {
  /** At least 1, so an empty roster still has a coherent "page 1 of 1". */
  pageCount: number;
  /** 1-based index of the first visible row; 0 when nothing matches. */
  first: number;
  /** 1-based index of the last visible row; 0 when nothing matches. */
  last: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
  /**
   * The page the tutor is actually allowed to be on. A shrinking result set — a
   * filter change, a delete, a status going `active` → `archived` — can leave `page`
   * past the end; the caller writes this back to the store so the list and the pager
   * can never disagree about which slice is on screen.
   */
  clampedPage: number;
  /** True when the store's `page` had to be pulled back to `clampedPage`. */
  isClamped: boolean;
}

/**
 * The pager's arithmetic, separated from its markup so the boundary is testable
 * through a value a tutor can read rather than through a private helper's internals.
 *
 * Every branch is driven by the passed-in `total`; the function never inspects the
 * rows themselves, because a short page is a legitimate last page and must not be
 * mistaken for the end of the roster.
 */
export function pageWindow({ page, pageSize, total }: PageWindowInput): PageWindow {
  const size = pageSize > 0 ? pageSize : 1;
  const safeTotal = total > 0 ? total : 0;
  const pageCount = Math.max(1, Math.ceil(safeTotal / size));
  // `Math.floor(NaN) || 1` normalises a non-finite or zero page to 1.
  const clampedPage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const first = safeTotal === 0 ? 0 : (clampedPage - 1) * size + 1;
  const last = safeTotal === 0 ? 0 : Math.min(clampedPage * size, safeTotal);

  return {
    pageCount,
    first,
    last,
    prevDisabled: clampedPage <= 1,
    nextDisabled: clampedPage >= pageCount,
    clampedPage,
    isClamped: clampedPage !== page,
  };
}

export interface StudentsPagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** True while a page request is in flight — the buttons hold position until it lands. */
  isFetching?: boolean;
}

export function StudentsPager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  isFetching = false,
}: StudentsPagerProps) {
  const win = pageWindow({ page, pageSize, total });
  const isEmpty = total === 0;

  // While a request is in flight a second click would skip a page the tutor never saw.
  const hold = isFetching;
  const prevDisabled = win.prevDisabled || hold;
  const nextDisabled = win.nextDisabled || hold;

  const rangeLabel = isEmpty
    ? "No students to show"
    : `Showing ${win.first.toLocaleString("en-IN")}–${win.last.toLocaleString(
        "en-IN",
      )} of ${total.toLocaleString("en-IN")}`;

  return (
    <nav
      aria-label="Roster pages"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 border-t border-[var(--border-default)]"
    >
      <p
        // Announced politely: the tutor changed page and needs to hear the new slice.
        aria-live="polite"
        className="text-xs tabular-nums"
        style={{ color: "var(--text-secondary)" }}
      >
        {rangeLabel}
      </p>

      <div className="flex items-center gap-2">
        <label
          className="flex items-center gap-1.5 text-xs"
          htmlFor="students-page-size"
          style={{ color: "var(--text-muted)" }}
        >
          <span>Rows</span>
          <select
            id="students-page-size"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="min-h-[44px] rounded-lg px-2 text-xs cursor-pointer"
            style={{
              background: "var(--surface-inset)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => onPageChange(win.clampedPage - 1)}
          disabled={prevDisabled}
          aria-label="Previous page of students"
          className="inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          style={{
            background: "var(--surface-inset)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        <span
          className="text-xs tabular-nums min-w-[5.5rem] text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          Page {win.clampedPage.toLocaleString("en-IN")} of {win.pageCount.toLocaleString("en-IN")}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(win.clampedPage + 1)}
          disabled={nextDisabled}
          aria-label="Next page of students"
          className="inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          style={{
            background: "var(--surface-inset)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
