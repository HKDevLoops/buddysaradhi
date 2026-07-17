"use client";

// Implements: UI/web/05_Students.md — StudentsClient Page
// Master–detail two-pane layout for the TutorOS Students screen.

import { useStudentsStore } from "@/stores/students-store";
import { fetchStudentsAction } from "@/server/actions/students";
import { useQuery } from "@tanstack/react-query";
import { StudentMasterList } from "./student-master-list";
import { StudentDetailDrawer } from "./student-detail-drawer";
import { AddStudentSheet } from "./add-student-sheet";
import { Search, Filter, Plus } from "lucide-react";
import { type StudentListRow } from "@buddysaradhi/shared";

export function StudentsClient() {
  const { filters, searchQuery, setSearchQuery, page, pageSize, sort, openAddSheet } =
    useStudentsStore();
  const selectedStudentId = useStudentsStore((s) => s.selectedStudentId);

  const { data, isLoading } = useQuery({
    queryKey: ["students", filters, searchQuery, page, pageSize, sort],
    queryFn: () => fetchStudentsAction(filters, searchQuery, page, pageSize, sort),
  });

  const students = data?.data?.students ?? [];
  const total = data?.data?.total ?? 0;
  const selectedRow: StudentListRow | undefined = students.find(
    (s) => s.id === selectedStudentId
  );

  return (
    <div className="flex flex-col md:flex-row min-h-[100dvh] md:h-[calc(100dvh-160px)] gap-6 relative">
      {/* Left pane — search + scrollable student list */}
      <section
        className="flex flex-col w-full md:w-[360px] flex-shrink-0 min-h-0 glass-panel rounded-2xl overflow-hidden"
        aria-label="Student list"
      >
        <div className="flex-none p-4 space-y-3 border-b border-[var(--border-glass)]">
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
                  background: "var(--surface-glass-faint)",
                  color: "var(--text-muted)",
                }}
              >
                {total} active
              </span>
            </div>

            {/* In-header Add Student button - resolves layout issues */}
            <button
              type="button"
              onClick={openAddSheet}
              aria-label="Add Student"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/20 text-xs font-bold shadow-md hover:bg-[var(--accent-emerald)]/20 active:translate-y-[1px] transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>

          {/* Neumorphic inset search + filter button side-by-side */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: "var(--text-muted)" }}
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search by name..."
                aria-label="Search students"
                className="neumo-inset w-full pl-9 pr-3 h-11 text-sm"
                style={{
                  background: "var(--bg-surface-inset)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                  borderRadius: "var(--radius-md)",
                }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <button
              type="button"
              aria-label="Filters"
              className="neumo-raised w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
            >
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          <StudentMasterList students={students} isLoading={isLoading} />
        </div>
      </section>

      {/* Right pane — selected student detail */}
      <section className="flex-1 min-w-0 min-h-0 h-full" aria-label="Student detail">
        <StudentDetailDrawer selectedRow={selectedRow} />
      </section>

      <AddStudentSheet />
    </div>
  );
}
