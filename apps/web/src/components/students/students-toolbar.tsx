"use client";

// Implements: docs/design/overhaul-plan.md §3 — the Students screen's single search box.
// The duplicate inline input that used to live in `students-client.tsx` is gone; this
// toolbar owns the one field, and it is the same `StudentSearchBox` the ⌘K palette opens
// (05_Students.md §Search, one search path).
// Rules: AGENTS.md §2 Rule 2 (the dropdown ranks the bounded local candidate set; the box
// never issues a request per keystroke), Rule 10 (44px targets, keyboard parity).

import { useStudentsStore } from "@/stores/students-store";
import { Button } from "@/components/ui/button";
import { StudentSearchBox } from "@/components/search/student-search-box";
import { useSearchCandidates } from "@/components/search/use-search-candidates";
import { Download, Filter, MoreHorizontal } from "lucide-react";

export function StudentsToolbar() {
  const { searchQuery, setSearchQuery, filters, bulkSelectedIds, openDrawer } = useStudentsStore();
  const { candidates, isLoading, error } = useSearchCandidates();

  return (
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

      <Button
        variant="outline"
        size="sm"
        className="h-11 gap-2 bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] text-[var(--text-primary)] hover:bg-[var(--surface-glass)] rounded-xl cursor-pointer"
      >
        <Filter className="w-4 h-4" aria-hidden="true" />
        Filters
        {filters.status.length > 0 && filters.status.length !== 4 && (
          <span
            className="ml-1 w-2 h-2 rounded-full"
            style={{ background: "var(--accent-primary)" }}
            aria-hidden="true"
          />
        )}
      </Button>

      {bulkSelectedIds.length > 0 && (
        <span className="text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
          {bulkSelectedIds.length} selected
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        aria-label="Export roster"
        className="h-11 w-11"
        style={{ color: "var(--text-secondary)" }}
      >
        <Download className="w-4 h-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="More roster actions"
        className="h-11 w-11"
        style={{ color: "var(--text-secondary)" }}
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
      </Button>
    </div>
  );
}