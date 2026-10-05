"use client";

// Implements: UI/web/05_Students.md §Master List — the roster row (avatar + name +
// class·subject + balance) and the roster's honest states.
// AGENTS.md §2 Rule 5 — the avatar's colour comes from the generated palette via
// `@/components/ui/avatar`, the single avatar implementation in the app. This file
// used to re-export `avatarAccent` / `avatarInitials` under the local names
// `studentAccent` / `initials` on the claim that the drawer imported them from
// here; nothing did (the drawer renders `<Avatar>` directly), so the re-export was
// a fifth avatar surface with no callers and has been removed. Callers that need
// the helpers import them from `@/components/ui/avatar`.
//
// AGENTS.md §2 Rule 9 (no silent failures) — a read that did not complete is NOT an
// empty roster. `StudentsClient` refuses to render this list when the query failed,
// so "No students" on screen can only ever mean the tutor genuinely has none (or
// that their own search/filter excluded everyone, which this file names explicitly
// and offers the one control that undoes it). Before that split, a gateway timeout
// rendered an authoritative "No students found" beside an Add Student button — a
// failure that read as an invitation to re-enter every student, i.e. data
// destruction by error message.
//
// AGENTS.md §2 Rule 6 / BR-M-01 — money is integer paise and the sign is the fact.
// The balance chip and its stated amount come from `@/components/fees/balance-status`
// (`balanceStatusOf` + `amountStatedPaise`), which is the one classifier for
// due / credit / no-dues. The three inline chips and the `Math.abs` on the credit
// figure that used to live here are gone: absolutising a signed balance erases the
// difference between "owes" and "in credit".

import { useStudentsStore } from "@/stores/students-store";
import { formatINR, paiseSub, type StudentListRow } from "@buddysaradhi/shared";
import { Avatar } from "@/components/ui/avatar";
import { BalanceStatusChip, BalanceLegend } from "@/components/fees/balance-status";
import { ScreenSkeleton } from "@/components/ui/screen-state";
import { UserPlus, UserX, X } from "lucide-react";

interface StudentMasterListProps {
  students: StudentListRow[];
  isLoading: boolean;
}

/** 05_Students.md §Statuses — the four roster statuses, as the shared filter spells them. */
const ALL_STATUSES = ["active", "inactive", "graduated", "archived"] as const;

/**
 * Is the roster narrowed by the tutor's own search or a non-default status filter?
 *
 * This is the difference between "you have no students" and "your search hid them",
 * and the two demand opposite recoveries: adding a student versus undoing the
 * narrowing. Getting it wrong is how an empty state becomes a data-entry trap.
 */
function narrowingLabel(
  searchQuery: string,
  status: string[],
): { isNarrowed: boolean; reason: string } {
  const trimmed = searchQuery.trim();
  const isDefaultStatus = status.length === 1 && status[0] === "active";
  if (trimmed.length > 0 && !isDefaultStatus) {
    return {
      isNarrowed: true,
      reason: `nothing matches “${trimmed}” in the selected statuses`,
    };
  }
  if (trimmed.length > 0) {
    return { isNarrowed: true, reason: `nothing matches “${trimmed}”` };
  }
  if (!isDefaultStatus) {
    return { isNarrowed: true, reason: "no student has the selected status" };
  }
  return { isNarrowed: false, reason: "" };
}

export function StudentMasterList({ students, isLoading }: StudentMasterListProps) {
  const {
    openDrawer,
    openAddSheet,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
  } = useStudentsStore();
  const selectedStudentId = useStudentsStore((s) => s.selectedStudentId);

  if (isLoading) {
    return <ScreenSkeleton shape="roster" label="your student roster" rows={6} />;
  }

  if (students.length === 0) {
    const { isNarrowed, reason } = narrowingLabel(searchQuery, filters.status);

    // Narrowed: undo the narrowing. Never invite an Add Student here — the tutor
    // already has students, and the button would read as "you need more".
    if (isNarrowed) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-4">
          <span
            className="flex size-14 items-center justify-center rounded-full"
            style={{
              background: "var(--surface-overlay)",
              color: "var(--text-muted)",
            }}
            aria-hidden="true"
          >
            <UserX className="size-6" />
          </span>
          <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            No student matches
          </p>
          <p className="text-sm max-w-xs" style={{ color: "var(--text-secondary)" }}>
            {reason}. Your roster is unchanged — widen the search to see everyone again.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setFilters({ status: [...ALL_STATUSES] });
            }}
            className="neumo-raised mt-1 inline-flex min-h-[44px] items-center gap-2 px-4 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            <X className="w-4 h-4" aria-hidden="true" />
            Clear search and filters
          </button>
        </div>
      );
    }

    // Genuinely empty. 05_Students.md §Empty state: the honest sentence, and one
    // primary action. This is the ONLY place on this screen that offers Add Student
    // as a recovery, because it is the only state where adding is the right answer.
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-4">
        <span
          className="flex size-16 items-center justify-center rounded-full"
          style={{
            background: "var(--surface-overlay)",
            color: "var(--text-muted)",
          }}
          aria-hidden="true"
        >
          <UserPlus className="size-7" />
        </span>
        <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          No students yet
        </p>
        <p className="text-sm max-w-xs" style={{ color: "var(--text-secondary)" }}>
          Add your first in 20 seconds — name, grade and a monthly fee is enough to
          start. Everything else can wait.
        </p>
        <button
          type="button"
          onClick={() => openAddSheet()}
          className="neumo-raised mt-1 inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          Add student
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Due / Credit / No dues are taught ONCE for this roster — not per row.
          Every row below renders a `BalanceStatusChip`, and the chip's `title`
          attribute is not reachable by keyboard or by a screen reader as a
          sentence; without the legend, "Credit" is a word the roster uses to mean
          money already received, and a tutor who does not know that reads it as
          a discount and under-collects for months. Mounted here rather than
          inside the `<ul>` because a disclosure repeated down a 200-row list is
          a wall of identical triggers — noise with the same information content
          as no trigger at all. */}
      <div className="px-4 pt-3 pb-1">
        <BalanceLegend />
      </div>
      <ul className="divide-y divide-[var(--border-default)]">
      {students.map((s) => {
        const isSelected = s.id === selectedStudentId;
        const subtitle = [s.grade, s.batch].filter(Boolean).join("·") || "—";
        // 05_Students.md §18 names the whole row label: name, code, balance and
        // status. "Open <name>" left a screen-reader user with no way to tell two
        // students apart on a roster where the name repeats.
        const rowLabel = [
          `Student: ${s.name}`,
          s.code ? `code ${s.code}` : "no code assigned",
          s.balance_due > 0
            ? `owes ${formatINR(s.balance_due)}`
            :           s.balance_due < 0
              ? `${formatINR(paiseSub(0, s.balance_due))} in credit`
              : "no dues",
          `status ${s.status}`,
        ].join(", ");

        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => openDrawer(s.id)}
              aria-label={rowLabel}
              // `aria-current` states which roster row is open in the drawer. It
              // was `aria-pressed`, which tells a screen reader the button is a
              // toggle that can be turned off — there is no off state here.
              aria-current={isSelected ? "true" : undefined}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors min-h-[64px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
              style={{
                background: isSelected
                  ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)"
                  : "transparent",
                borderLeft: isSelected
                  ? "3px solid var(--accent-primary)"
                  : "3px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = "var(--surface-inset)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Avatar — the one implementation, shared with the drawer and the
                  attendance grid. Decorative: the name is right beside it. */}
              <Avatar name={s.name} id={s.id} size="md" />

              <div className="min-w-0 flex-1">
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                  title={s.name}
                >
                  {s.name}
                </p>
                <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {subtitle}
                </p>
              </div>

              {/* §6.2 column 1: the code, in mono. A tutor reads it out over the
                  phone ("STU-2026-0007") and it is the only identifier that
                  survives a name change, so it is on the row rather than buried
                  in the drawer. An unassigned code states so rather than
                  rendering blank. */}
              <span
                className="num text-xs shrink-0 text-right"
                style={{ color: isSelected ? "var(--accent-primary)" : "var(--text-muted)" }}
              >
                {s.code ?? "—"}
              </span>

              {/* Due / Credit / No dues — the shared classifier. An icon AND a word
                  carry the meaning, so the state survives a monochrome display
                  (AGENTS.md §2 Rule 10), and the credit figure is a stated positive
                  amount computed with a paise helper, never `Math.abs`. */}
              <BalanceStatusChip balanceDuePaise={s.balance_due} />
            </button>
          </li>
        );
      })}
      </ul>
    </>
  );
}
