// Implements: 05_Students.md §Master List (the roster is the screen's first
// paint, not a spinner); AGENTS.md §2 Rule 4 as amended 2026-10-07 — `/students`
// is one of the five screen routes. 16_Platform_Delivery_Sequence.md §W1.
//
// THE ROUTE IS THE SCREEN. See `app/(app)/dashboard/page.tsx` for why each
// screen is its own `page.tsx`. This one is the Students roster.
//
// WHY `getInitialState()` AND NOT THE STORE'S CURRENT STATE. The prefetch has to
// build the exact key `StudentsClient` will ask for on its first render —
// `["students", filters, searchQuery, page, pageSize, sort]`
// (components/students/students-client.tsx:49) — and those five come from
// `useStudentsStore`. `getInitialState()` returns the store's CONSTRUCTOR values
// and ignores anything the running app has written, which is what the browser's
// first render sees on a cold load. Reading `getState()` here instead would be
// reading server-module state that some other request could have mutated: on a
// single-tenant-per-DB app that is the same tutor, but the shape of the bug is
// "module state shared across requests", which is the bug class this project's
// Phase 2 exists to remove. Read-only construction values do not have it.
//
// The consequence is stated rather than hidden: the prefetch hydrates the DEFAULT
// roster. A tutor who had paged or filtered before a hard reload gets their first
// browser render from the hydrated cache under a key the store has since moved
// off — the browser then fetches the real key once, which is what it did before
// this route existed. Never a wrong roster: the key is the screen's own, so the
// screen reads only data fetched for the state it is actually in.

import type { Metadata } from "next";
import { ScreenData } from "../screen-data";
import { StudentsClient } from "@/components/students/students-client";
import { fetchStudentsAction } from "@/server/actions/students";
import { useStudentsStore } from "@/stores/students-store";

// See `app/(app)/dashboard/page.tsx` for why every screen route declares its own
// title in the server HTML.
export const metadata: Metadata = {
  title: "Students · BuddySaradhi",
};

export default async function StudentsPage() {
  const { filters, searchQuery, page, pageSize, sort } = useStudentsStore.getInitialState();

  return (
    <ScreenData
      queries={[
        {
          queryKey: ["students", filters, searchQuery, page, pageSize, sort],
          queryFn: () => fetchStudentsAction(filters, searchQuery, page, pageSize, sort),
        },
      ]}
    >
      <StudentsClient />
    </ScreenData>
  );
}