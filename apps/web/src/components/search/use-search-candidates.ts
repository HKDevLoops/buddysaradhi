"use client";

// Implements: docs/design/overhaul-plan.md §3 — "the shell's Ctrl+K palette reuses the same
// engine and the same candidate source". This module is that single source: one bounded
// local query, one derived haystack per student, shared by the Students toolbar, the
// Fees/Attendance filters and the shell palette. AGENTS.md §2 Rule 2 (one read, never one
// per keystroke), P5 (offline-first — the whole set is ranked in the browser).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSearchCandidates } from "@/server/queries/search";
import type { SearchCandidate } from "./student-search-box";

/** `item` is the student id — the only thing a caller can act on. */
export type StudentSearchCandidate = SearchCandidate<string>;

export function useSearchCandidates(): {
  candidates: StudentSearchCandidate[];
  isLoading: boolean;
  error: string | null;
} {
  const query = useQuery({
    queryKey: ["search-candidates"],
    queryFn: () => getSearchCandidates(),
    staleTime: 30_000,
  });

  const candidates = useMemo<StudentSearchCandidate[]>(() => {
    const rows = query.data?.data ?? [];
    return rows.map((row) => ({
      item: row.id,
      // Ranked haystack: name first, then the identifiers a tutor would recall.
      // Engine `positions` index into exactly this string.
      text: [row.first_name, row.last_name, row.code, row.phone]
        .filter((part) => part !== null && part !== "")
        .join(" "),
      meta: row.code ?? row.phone ?? row.status,
    }));
  }, [query.data]);

  return {
    candidates,
    isLoading: query.isLoading,
    // Rule 9: the server already reduced the failure to a typed string; nothing else is shown.
    error: query.data && query.data.success === false ? (query.data.error ?? null) : null,
  };
}
