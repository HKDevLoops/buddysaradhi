"use client";

// Implements: UI/web/05_Students.md §Master List — student row (avatar + name + class·subject + status chip)

import { useStudentsStore } from "@/stores/students-store";
import { type StudentListRow, formatINR } from "@buddysaradhi/shared";

const ACCENTS = [
  "emerald",
  "cyan",
  "amber",
  "flare",
  "violet",
  "primary",
  "secondary",
  "tertiary",
] as const;

export function studentAccent(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface StudentMasterListProps {
  students: StudentListRow[];
  isLoading: boolean;
}

export function StudentMasterList({ students, isLoading }: StudentMasterListProps) {
  const { openDrawer, openAddSheet } = useStudentsStore();
  const selectedStudentId = useStudentsStore((s) => s.selectedStudentId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{
            borderColor: "var(--border-glass)",
            borderTopColor: "var(--accent-primary)",
          }}
        />
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-16 space-y-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: "var(--surface-glass-strong)" }}
        >
          <svg
            className="w-8 h-8"
            style={{ color: "var(--text-muted)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          No students found
        </p>
        <p className="text-sm max-w-xs" style={{ color: "var(--text-secondary)" }}>
          Get started by adding your first student, or adjust your search criteria.
        </p>
        <button
          type="button"
          onClick={() => openAddSheet()}
          className="neumo-raised mt-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          style={{
            background: "var(--bg-surface-raised)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          Add Student
        </button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-glass)]">
      {students.map((s) => {
        const isSelected = s.id === selectedStudentId;
        const accent = studentAccent(s.id);
        const subtitle = [s.grade, s.batch].filter(Boolean).join("·") || "—";
        const owes = s.balance_due > 0;
        const credit = s.balance_due < 0;

        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => openDrawer(s.id)}
              aria-label={`Open ${s.name}`}
              aria-pressed={isSelected}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors min-h-[64px]"
              style={{
                background: isSelected
                  ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)"
                  : "transparent",
                borderLeft: isSelected
                  ? "3px solid var(--accent-primary)"
                  : "3px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = "var(--surface-glass-faint)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Accent avatar with initials */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                style={{
                  background: `color-mix(in srgb, var(--accent-${accent}) 16%, var(--bg-surface-raised))`,
                  color: `var(--accent-${accent})`,
                  border: `1px solid color-mix(in srgb, var(--accent-${accent}) 35%, transparent)`,
                }}
                aria-hidden="true"
              >
                {initials(s.name)}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {s.name}
                </p>
                <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {subtitle}
                </p>
              </div>

              {/* Status chip — color is never the only signal (text + icon carry meaning) */}
              {owes ? (
                <span className="chip chip-warning num shrink-0" title="Outstanding dues">
                  <span className="chip-dot" aria-hidden="true" />
                  Due {formatINR(s.balance_due)}
                </span>
              ) : credit ? (
                <span className="chip chip-info num shrink-0" title="Credit balance">
                  <span className="chip-dot" aria-hidden="true" />
                  Credit {formatINR(Math.abs(s.balance_due))}
                </span>
              ) : (
                <span className="chip chip-success shrink-0" title="No dues">
                  <span className="chip-dot" aria-hidden="true" />
                  No dues
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
