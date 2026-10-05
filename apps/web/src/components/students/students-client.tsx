"use client";

// Implements: UI/web/05_Students.md — StudentsClient Page
// Master–detail two-pane layout for the TutorOS Students screen.
//
// Implements: 05_Students.md §Master List — the roster is now fully reachable. The query
// pages at `pageSize` rows and the store threaded `page`/`pageSize`/`sort` all along, but
// nothing set them, so a tutor with 200 students could only ever see the first 50. This
// client owns the four pieces that make that honest:
//   1. the pager, whose `nextDisabled` comes from the query's real `total`;
//   2. the upper-bound page clamp, because a filter change or a delete can leave the
//      tutor on a page that no longer exists;
//   3. the header count, which now says what it actually counted — and says nothing
//      while the count is unknown, rather than claiming "0 active";
//   4. the failure branch: a roster read that did not complete renders `ErrorState`
//      and NEVER the empty state. `fetchStudentsAction` resolves (it does not throw),
//      so the failure lives in the envelope — React Query's `isError` alone would be
//      permanently false and the old code rendered `students = []`, i.e. "No students
//      found" with an Add Student CTA, on every gateway timeout. That told a tutor
//      their whole roster was empty and invited them to re-enter it.

import { useEffect } from "react";
import { useStudentsStore } from "@/stores/students-store";
import { fetchStudentsAction } from "@/server/actions/students";
import { useQuery } from "@tanstack/react-query";
import { StudentMasterList } from "./student-master-list";
import { StudentDetailDrawer } from "./student-detail-drawer";
import { AddStudentSheet } from "./add-student-sheet";
import { StudentsToolbar } from "./students-toolbar";
import { StudentsPager, pageWindow } from "./students-pager";
import { ErrorState } from "@/components/ui/screen-state";
import { toAppErrorState } from "@/lib/app-errors";
import { Plus } from "lucide-react";
import { type StudentListRow } from "@buddysaradhi/shared";

/** The roster's default filter is `active`; only then is the badge allowed to say "active". */
const DEFAULT_STATUS = ["active"] as const;

function isActiveOnly(status: string[]): boolean {
  return status.length === 1 && status[0] === DEFAULT_STATUS[0];
}

export function StudentsClient() {
  const { filters, searchQuery, page, pageSize, sort, openAddSheet, setPage, setPageSize } =
    useStudentsStore();
  const selectedStudentId = useStudentsStore((s) => s.selectedStudentId);

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ["students", filters, searchQuery, page, pageSize, sort],
    queryFn: () => fetchStudentsAction(filters, searchQuery, page, pageSize, sort),
  });

  /**
   * Two failure shapes, one branch. The action resolves with `{ success: false }`
   * on a gateway read failure, and would throw only if the server action itself
   * broke; both are collapsed here so no call site has to remember which is which.
   */
  const thrownError = error ?? null;
  const envelopeError = data && data.success === false ? (data.error ?? "unknown error") : null;
  const failureReason = thrownError ?? envelopeError;
  const hasFailed = failureReason !== null;

  const students = hasFailed ? [] : (data?.data?.students ?? []);
  const total = hasFailed ? 0 : (data?.data?.total ?? 0);
  const selectedRow: StudentListRow | undefined = students.find(
    (s) => s.id === selectedStudentId
  );

  // A filter change, a delete, or a student leaving the filtered set can leave the tutor
  // on a page past the end — which renders an empty list that reads as "no students".
  // The clamp is written back to the store so the list, the pager and the query key all
  // agree on one page. `pageWindow` is pure, so this is a no-op on the happy path.
  // `total` is only meaningful once a read has landed, so it is never clamped off a
  // failed or in-flight read — otherwise the tutor's page would jump to 1 on a blip.
  const win = pageWindow({ page, pageSize, total });
  useEffect(() => {
    if (!hasFailed && !isPending && win.isClamped) setPage(win.clampedPage);
  }, [win.isClamped, win.clampedPage, setPage, hasFailed, isPending]);

  // The count is a claim about the tutor's roster, so it is only made when a read has
  // actually landed. "—" says "I don't know yet", which is the truth; "0 active" is a
  // lie the tutor would act on.
  const countLabel = hasFailed || isPending
    ? "—"
    : isActiveOnly(filters.status)
      ? `${total.toLocaleString("en-IN")} active`
      : `${total.toLocaleString("en-IN")} matching`;

  return (
    <div className="flex flex-col md:flex-row min-h-[100dvh] md:h-[calc(100dvh-160px)] gap-6 relative">
      {/* Left pane — search + scrollable student list */}
      <section
        className="flex flex-col w-full md:w-[360px] flex-shrink-0 min-h-0 glass-panel rounded-2xl overflow-hidden"
        aria-label="Student list"
      >
        <div className="flex-none p-4 space-y-3 border-b border-[var(--border-default)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h1
                className="text-xl font-bold tracking-tight"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
              >
                Students
              </h1>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: "var(--surface-inset)",
                  color: "var(--text-muted)",
                }}
              >
                {countLabel}
              </span>
            </div>

            {/* In-header Add Student button - resolves layout issues */}
            <button
              type="button"
              onClick={openAddSheet}
              aria-label="Add Student"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20 text-xs font-bold shadow-md hover:bg-[var(--success)]/20 active:translate-y-[1px] transition-all min-h-[44px]"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>

          {/* The one search box for this screen — students-toolbar.tsx owns it */}
          <StudentsToolbar />
        </div>

        {/* Two branches only, and the split is load-bearing. A FAILED read is a
            query-level fact, so it is answered by the shared `ErrorState` at the
            query's own surface; a roster that is merely loading or empty is what the
            roster knows how to look like, so it is delegated to `StudentMasterList`.
            The two can never be confused, because only the failure branch can render
            "I could not read this" and only the list branch can render "no students".

            `aria-busy` (05_Students.md §18) so a screen reader announces that the
            roster is changing instead of reading the previous page's rows as
            current. */}
        <div
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar"
          aria-busy={isFetching}
        >
          {hasFailed ? (
            <div className="p-4">
              <ErrorState
                // The mapper is what guarantees no server text (SQL, digests, file
                // paths) reaches the browser — only its static literals are rendered.
                state={toAppErrorState(failureReason)}
                dataStatus="Your students are all still saved — this read did not complete. Nothing was changed, and nothing needs re-entering."
                onRetry={() => {
                  void refetch();
                }}
                isRetrying={isFetching}
                retryLabel="Read the roster again"
              />
            </div>
          ) : (
            <StudentMasterList students={students} isLoading={isPending} />
          )}
        </div>

        {/* The pager sits below the scroll area, not inside it: a tutor deciding to move
            page should never have to scroll 200 rows to find the control. It is withheld
            until a read has landed, because `StudentsPager` reports "No students to show"
            for `total === 0` — true of an empty roster, a lie during a failed or
            in-flight read. */}
        {!isPending && !hasFailed && (
          <div className="flex-none border-t border-[var(--border-default)]">
            <StudentsPager
              page={page}
              pageSize={pageSize}
              total={total}
              isFetching={isFetching}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </section>

      {/* Right pane — selected student detail */}
      <section className="flex-1 min-w-0 min-h-0 h-full" aria-label="Student detail">
        <StudentDetailDrawer selectedRow={selectedRow} />
      </section>

      <AddStudentSheet />
    </div>
  );
}