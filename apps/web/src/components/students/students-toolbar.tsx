"use client";

// Implements: docs/design/overhaul-plan.md §3 — the Students screen's single search box.
// The duplicate inline input that used to live in `students-client.tsx` is gone; this
// toolbar owns the one field, and it is the same `StudentSearchBox` the ⌘K palette opens
// (05_Students.md §Search, one search path).
// Rules: AGENTS.md §2 Rule 2 (the dropdown ranks the bounded local candidate set; the box
// never issues a request per keystroke), Rule 10 (44px targets, keyboard parity).
//
// Implements: 05_Students.md §Filters + §Export — this toolbar owns the two controls that
// were dead (a button with no `onClick` advertises a capability that does not exist, which
// is worse than no button at all):
//
//   • Status filter — the ONLY filter the roster query genuinely honours.
//     `apps/gateway/routes/students.ts` (GET /api/v1/students) reads exactly four
//     parameters: `page`, `pageSize`, `search`, `status`. It does NOT read
//     `balanceRange`, `admittedInLast`, `batchIds`, `feeModels` or `tagIds`, and it
//     issues no ORDER BY at all. So this popover offers status and nothing else — a
//     filter the server drops is a filter that lies to the tutor about what they are
//     looking at. The un-honoured fields remain on `StudentFilters` and are reported to
//     the owner rather than silently offered.
//
//   • Export roster — a real CSV of the WHOLE filtered result, every page, not the 50
//     rows that happen to be on screen. The label says so, and the row count is reported
//     back so the tutor can confirm the file matches the roster they were looking at.
//
//   • Sort — the dimension `students-store.setSort` modelled, `server/queries/students.ts`
//     forwarded as `sortCol`/`sortDir`, and `apps/gateway/routes/students.ts` validates
//     against `ROSTER_SORT_COLUMN` (a 400 for anything else). It was plumbed end to end
//     with no UI calling it, so a 200-student institute could not order by balance — the
//     one thing a roster exists to do. The list below is now the gateway's WHOLE
//     vocabulary (seven keys, all mapped to real `students` columns), because the web
//     `SortCol` union was widened to match it: a type narrower than the server is a
//     silent truncation of capability, and a type wider would 400. Both ends are pinned
//     to the same seven keys — see the comment on `SortCol` in `src/types/students.ts`.
//
// `More roster actions` was deleted rather than filled in: nothing anywhere in the app
// defines a second roster action, and inventing menu items is orphan UI (AGENTS.md §0.2).
//
// DELETED — the "N selected" indicator that used to sit here. `toggleBulkSelect` had zero
// callers, so the count could never leave zero, and no bulk action exists anywhere: the
// gateway exposes only POST / PATCH / DELETE on a single student id
// (`apps/gateway/routes/students.ts:372, 453, 510`), no bulk endpoint, and the gateway
// schema has no `student_tags` table at all. A bulk-action bar needs new server mutations
// and a spec amendment; until those exist a selection counter is a control that cannot
// happen, which advertises a capability the app does not have. `05_Students.md` §Bulk
// describes the intended bar, so this is reported for a future pass rather than faked.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useStudentsStore } from "@/stores/students-store";
import { Button } from "@/components/ui/button";
import { StudentSearchBox } from "@/components/search/student-search-box";
import { useSearchCandidates } from "@/components/search/use-search-candidates";
import { useToast } from "@/components/ui/toast";
import { fetchStudentsAction } from "@/server/actions/students";
import { log } from "@/lib/logger";
import type { SortCol, StudentFilters } from "@/types/students";
import type { StudentListRow } from "@buddysaradhi/shared";
import { ArrowDown, ArrowUp, Check, Download, SlidersHorizontal, X } from "lucide-react";

/** 05_Students.md §Statuses — the four roster statuses, in the order a tutor reads them. */
const STATUSES = ["active", "inactive", "graduated", "archived"] as const;

type StatusValue = (typeof STATUSES)[number];

/** Single source of truth for a status's label; the chip, the popover and the a11y name all read it. */
const STATUS_LABEL: Record<StatusValue, string> = {
  active: "Active",
  inactive: "Inactive",
  graduated: "Graduated",
  archived: "Archived",
};

const ALL_STATUSES: StatusValue[] = [...STATUSES];

/**
 * 05_Students.md §Master List — the roster's sort vocabulary.
 *
 * Every entry is a member of the web `SortCol` union AND a key of the gateway's
 * `ROSTER_SORT_COLUMN`, so the query can never be sent a column the server rejects.
 * The read path is `students-store.sort` → `fetchStudentsAction` →
 * `server/queries/students.ts:30` (`sortCol`) → `apps/gateway/routes/students.ts:162`
 * (`ROSTER_SORT_SCHEMA`, unknown key → typed 400). Balance is first because it is the
 * column a tutor opens the roster to read.
 */
const SORT_COLUMNS: ReadonlyArray<{ value: SortCol; label: string }> = [
  { value: "balance", label: "Balance due" },
  { value: "name", label: "Name" },
  { value: "code", label: "Student code" },
  { value: "grade", label: "Grade" },
  { value: "status", label: "Status" },
  { value: "joined", label: "Joining date" },
  { value: "created", label: "Date added" },
];

/** Is the roster still filtered to exactly the default `active`? */
function isDefaultStatus(status: StatusValue[]): boolean {
  return status.length === 1 && status[0] === "active";
}

type SortDir = "asc" | "desc";

/** The other direction. Named so the two call sites cannot disagree about polarity. */
function opposite(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : "asc";
}

/**
 * The direction a column starts in when it is picked for the first time.
 *
 * Text and codes read A→Z, so they open ascending. A balance is a magnitude: the
 * first question is always "who owes the most", which is the LARGEST balance, so
 * it opens descending. Opening a money column ascending would put the tutor's
 * biggest debtor at the bottom of page 1.
 */
function defaultDirFor(col: SortCol): SortDir {
  return col === "balance" ? "desc" : "asc";
}

/** The column's own words, for the control's accessible name. */
function sortLabel(col: SortCol): string {
  return SORT_COLUMNS.find((column) => column.value === col)?.label ?? "this column";
}

/**
 * The gateway caps `pageSize` at 200 (`Math.min(200, …)` in
 * `apps/gateway/routes/students.ts`), so 200 is the largest honest page size to ask for.
 */
const EXPORT_PAGE_SIZE = 200;

/**
 * Integer paise → a plain decimal rupee string for the spreadsheet cell.
 *
 * AGENTS.md §2 Rule 6 / BR-M-01: paise is the stored value and never becomes a float.
 * `formatINR` is for the screen (it returns "₹1,250.00", which is neither spreadsheet-
 * nor accounting-software-friendly), so the CSV gets a bare number computed from the
 * integer, never from `paise / 100` on its own.
 */
function rupeesFromPaise(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  let whole = Math.floor(abs / 100);
  let frac = abs - whole * 100;
  // `frac` is the exact remainder of an integer, so it lands in [0, 99]. The two
  // branches below are unreachable; they exist so no representability surprise can
  // ever emit a malformed cell such as "100.100".
  if (frac < 0) {
    frac += 100;
    whole -= 1;
  }
  if (frac > 99) {
    frac -= 100;
    whole += 1;
  }
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

/** Quote every cell and double inner quotes — the one escaping rule Excel accepts. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The export contract, in one pure function so it is checkable without a browser:
 * a fixed header row, one line per student, money as an integer paise column plus a
 * plain rupee column.
 */
export function rosterCsv(rows: StudentListRow[]): string {
  const header = [
    "Code",
    "Name",
    "Grade",
    "Batch",
    "Fee model",
    "Status",
    "Balance (paise)",
    "Balance (INR)",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.code ?? "",
        row.name,
        row.grade ?? "",
        row.batch ?? "",
        row.fee_model,
        row.status,
        String(row.balance_due),
        rupeesFromPaise(row.balance_due),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function StudentsToolbar() {
  const {
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    openDrawer,
    sort,
    setSort,
  } = useStudentsStore();
  const { candidates, isLoading, error } = useSearchCandidates();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [statusOpen, setStatusOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const statusWrapRef = useRef<HTMLDivElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusPanelId = useId();

  const selectedStatuses = filters.status.filter((value): value is StatusValue =>
    ALL_STATUSES.includes(value as StatusValue),
  );

  // Escape closes the popover and returns focus to the control that opened it.
  useEffect(() => {
    if (!statusOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setStatusOpen(false);
      statusButtonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = statusWrapRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setStatusOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [statusOpen]);

  const toggleStatus = useCallback(
    (value: StatusValue) => {
      const current = filters.status;
      const isOn = current.includes(value);
      const next = isOn ? current.filter((entry) => entry !== value) : [...current, value];
      // An empty `status` query parameter means "no filter" on the gateway, so
      // deselecting the last box would silently widen the roster to every student.
      // Selecting none is spelled as "all four" instead.
      const resolved: StudentFilters["status"] = next.length === 0 ? [...ALL_STATUSES] : next;
      setFilters({ status: resolved });
    },
    [filters.status, setFilters],
  );

  const clearStatuses = useCallback(() => {
    setFilters({ status: [...ALL_STATUSES] });
  }, [setFilters]);

  /**
   * Pull the WHOLE filtered roster, page by page, then hand back a CSV.
   *
   * Honesty guards, in order:
   *   1. A response longer than the page size means the service ignored pagination —
   *      the direct-DB fallback in `server/queries/students.ts` does exactly this. We
   *      refuse rather than write a CSV with every student repeated once per page.
   *   2. A repeated `id` is dropped and logged. A roster CSV never contains the same
   *      student twice.
   */
  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const first = await fetchStudentsAction(
        filters,
        searchQuery,
        1,
        EXPORT_PAGE_SIZE,
        sort,
      );
      if (!first.success || !first.data) {
        toastRef.current.error(
          "Export failed",
          first.error ?? "The roster could not be read. Try again in a moment.",
        );
        return;
      }

      const total = first.data.total;
      const collected: StudentListRow[] = [...first.data.students];

      if (collected.length > EXPORT_PAGE_SIZE) {
        toastRef.current.error(
          "Export unavailable",
          "The roster service is not returning one page at a time, so the file would repeat students. Nothing was downloaded.",
        );
        return;
      }

      for (let pageNumber = 2; collected.length < total; pageNumber += 1) {
        const next = await fetchStudentsAction(
          filters,
          searchQuery,
          pageNumber,
          EXPORT_PAGE_SIZE,
          sort,
        );
        if (!next.success || !next.data) {
          toastRef.current.error(
            "Export stopped",
            `Saved none of it — page ${pageNumber} could not be read (${next.error ?? "unknown error"}). A partial roster file is worse than none.`,
          );
          return;
        }
        if (next.data.students.length === 0) break;
        if (next.data.students.length > EXPORT_PAGE_SIZE) {
          toastRef.current.error(
            "Export unavailable",
            "The roster service is not returning one page at a time, so the file would repeat students. Nothing was downloaded.",
          );
          return;
        }
        collected.push(...next.data.students);
      }

      const seen = new Set<string>();
      const rows = collected.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
      if (rows.length < collected.length) {
        log.warn("roster_export_duplicate_rows", "Duplicate ids collapsed in export", {
          requested: collected.length,
          kept: rows.length,
        });
      }

      // A Blob beats a data: URI past a few dozen kilobytes; the settings export is
      // small enough for either, a roster is not.
      const blob = new Blob(["﻿" + rosterCsv(rows)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `buddysaradhi_roster_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toastRef.current.success(
        `Exported ${rows.length.toLocaleString("en-IN")} student${rows.length === 1 ? "" : "s"}`,
        `Every student matching this search and status filter, not just the page on screen. Balance is in whole paise and in rupees.`,
      );
    } catch (err) {
      log.error(
        "roster_export_failed",
        err instanceof Error ? err.message : String(err),
      );
      toastRef.current.error(
        "Export failed",
        "The roster could not be turned into a file. Nothing was downloaded.",
      );
    } finally {
      setExporting(false);
    }
  }, [exporting, filters, searchQuery, sort]);

  const statusButtonLabel = isDefaultStatus(selectedStatuses)
    ? "Status"
    : `Status · ${selectedStatuses.length}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px]">
          <StudentSearchBox
            label="Search students"
            value={searchQuery}
            onValueChange={setSearchQuery}
            onSelect={(id) => openDrawer(id)}
            candidates={candidates}
            placeholder={isLoading ? "Loading roster…" : "Search by name, phone or code…"}
            emptyLabel="No student matches that search"
            error={error}
          />
        </div>

        {/* Status — the only roster filter the query honours. */}
        <div className="relative" ref={statusWrapRef}>
          <Button
            ref={statusButtonRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatusOpen((open) => !open)}
            aria-expanded={statusOpen}
            aria-controls={statusPanelId}
            aria-haspopup="true"
            className="h-11 gap-2 bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--surface-raised)] rounded-xl cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            {statusButtonLabel}
          </Button>

          {statusOpen && (
            <div
              id={statusPanelId}
              className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl border border-[var(--border-default)] p-2 shadow-2xl"
              style={{
                background: "var(--surface-overlay)",
                backdropFilter: "var(--mat-filter)",
                WebkitBackdropFilter: "var(--mat-filter)",
              }}
            >
              <p
                className="px-2 pt-1 pb-2 text-xs font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Show students who are
              </p>
              {STATUSES.map((value) => {
                const on = selectedStatuses.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleStatus(value)}
                    aria-pressed={on}
                    className="w-full flex items-center gap-2.5 min-h-[44px] px-2 rounded-lg text-sm text-left transition-colors cursor-pointer hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {/* Tick + label: the state is never carried by the tick's colour alone. */}
                    <span
                      aria-hidden="true"
                      className="w-4 h-4 shrink-0 rounded border flex items-center justify-center"
                      style={{
                        borderColor: on
                          ? "var(--accent-primary)"
                          : "var(--border-default)",
                        background: on
                          ? "color-mix(in srgb, var(--accent-primary) 18%, transparent)"
                          : "transparent",
                        color: "var(--accent-primary)",
                      }}
                    >
                      {on && <Check className="w-3 h-3" />}
                    </span>
                    {STATUS_LABEL[value]}
                  </button>
                );
              })}
              <div className="mt-1 border-t border-[var(--border-default)] pt-1">
                <button
                  type="button"
                  onClick={clearStatuses}
                  className="w-full min-h-[44px] px-2 rounded-lg text-sm text-left transition-colors cursor-pointer hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Show all four
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sort — the column, then the direction. Re-picking the column already
            selected flips the direction, so the tutor can reverse a list without
            reaching for the second control; the glyph and the button's accessible
            name both state the direction, so it is never carried by the arrow's
            position alone (AGENTS.md §2 Rule 10). */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="students-sort" className="sr-only">
            Sort roster by
          </label>
          <select
            id="students-sort"
            value={sort.col}
            onChange={(event) => {
              // SAFETY: the only options this control renders are `SORT_COLUMNS`, whose
              // `value` is typed `SortCol`, so `event.target.value` is a member of the
              // union by construction. A value outside it cannot be produced by this UI —
              // and if one ever were, the gateway answers a typed 400 rather than an
              // unordered list (`apps/gateway/routes/students.ts:270`).
              const col = event.target.value as SortCol;
              // Re-picking the active column is a request for the other direction.
              setSort(col, col === sort.col ? opposite(sort.dir) : defaultDirFor(col));
            }}
            title={`Roster is sorted by ${sortLabel(sort.col)}, ${sort.dir === "asc" ? "ascending" : "descending"}. Choose a column to sort by it; choose it again to reverse.`}
            aria-label="Sort roster by"
            className="neumo-inset min-h-[44px] px-2.5 text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
            style={{
              background: "var(--surface-inset)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            {SORT_COLUMNS.map((column) => (
              <option key={column.value} value={column.value}>
                {column.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setSort(sort.col, opposite(sort.dir))}
            aria-label={`Sort ${sortLabel(sort.col)} ${sort.dir === "asc" ? "descending" : "ascending"}`}
            title={
              sort.dir === "asc"
                ? "Ascending — tap for descending"
                : "Descending — tap for ascending"
            }
            className="neumo-raised inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-all active:translate-y-px cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            {sort.dir === "asc" ? (
              <ArrowUp className="size-4" aria-hidden="true" />
            ) : (
              <ArrowDown className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleExport}
          disabled={exporting}
          aria-label={
            exporting
              ? "Exporting the roster"
              : "Export every matching student to a CSV file"
          }
          title="Exports every student matching this search and status filter, not just the page on screen."
          className="h-11 w-11"
          style={{ color: "var(--text-secondary)" }}
        >
          <Download className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Active filters, removable — the current filter set stays visible so the tutor
          never has to remember what they applied. */}
      {selectedStatuses.length > 0 && !isDefaultStatus(selectedStatuses) && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active status filters">
          {selectedStatuses.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => toggleStatus(value)}
                aria-label={`Remove the ${STATUS_LABEL[value]} filter`}
                className="chip chip-neutral min-h-[44px] pl-3 pr-2 gap-1.5 cursor-pointer hover:bg-[var(--surface-raised)]"
              >
                {STATUS_LABEL[value]}
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}