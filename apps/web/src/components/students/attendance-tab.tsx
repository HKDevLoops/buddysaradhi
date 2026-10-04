"use client";

// Implements: 05_Students.md §6.4 (Detail Drawer → Attendance tab) + AGENTS.md §2
// Rule 9 (no silent failures) and Rule 11 (accuracy over decoration).
//
// ── Why this file no longer draws a calendar ──────────────────────────────────
//
// This tab used to generate the current month's attendance from a PRNG seeded on
// the student's id (`makeRng(studentId)` → `mockStatus()`), then render the
// result as hardcoded tutor-facing facts: a "{month} Rate" percentage, a
// "22/30 days" count, and "Last Attended · Today · On time". Those numbers were
// plausible, non-zero, and unrelated to anything the tutor had recorded.
//
// It was not a placeholder and it was not a loading state. It was a fabricated
// record of a child's attendance, on the surface a tutor opens specifically to
// sanity-check one. A tutor who marked 30 days by hand, opened this tab to
// confirm, saw a confident number, and filed nothing — because a fabricated
// figure that looks right is the one kind of wrong answer a human being does not
// distrust. The student who was actually absent 11 times had no way to find out.
//
// Every other read-failure defect in this app had the same shape — a failed read
// rendering as zero — and every one of them is closed by `ErrorState`, whose
// `dataStatus` is required and undefaulted so a surface that cannot say what is
// safe for the tutor cannot render. This one was worse in kind: there was no
// read to fail, so there was no state in which it told the truth.
//
// ── Why there is no query here either ─────────────────────────────────────────
//
// There is no per-student attendance read. `GET /api/v1/attendance` is by DATE
// (`apps/gateway/routes/attendance.ts:58`), so assembling a month means up to 31
// requests — against the free-tier budget in RFC-003 §0 and `AGENTS.md` §1.2.
// Inventing the numbers client-side was cheaper and wrong. Adding the endpoint
// is a gateway contract change (RFC per `AGENTS.md` §8), not a UI fix, so it is
// recorded as owner work rather than smuggled in here.
//
// So the tab states the truth, and tells the tutor where the data they want
// actually lives: the Attendance screen, which does read real records.

import { CalendarCheck, CalendarX } from "lucide-react";

interface AttendanceTabProps {
  studentId: string;
  /** Optional: the student's display name, so the message can be specific. */
  studentName?: string;
}

export function AttendanceTab({ studentId, studentName }: AttendanceTabProps) {
  const who = studentName?.trim();

  return (
    <div className="space-y-4">
      <div
        className="flex flex-col items-center gap-3 rounded-xl border px-5 py-8 text-center"
        style={{
          background: "var(--surface-inset)",
          borderColor: "var(--border-default)",
        }}
      >
        <span
          className="flex size-11 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in srgb, var(--warning) 15%, transparent)",
            color: "var(--warning)",
          }}
          aria-hidden="true"
        >
          <CalendarX className="size-5" />
        </span>

        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Per-student attendance history isn&rsquo;t read yet
          </h3>
          <p className="mx-auto mt-2 max-w-[46ch] text-sm" style={{ color: "var(--text-secondary)" }}>
            This tab used to draw a month from made-up numbers, which is worse
            than an empty tab — it looked like your records. Nothing is shown here
            now because nothing real is available here yet.
          </p>
        </div>

        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {who ? `${who}&rsquo;s` : "This student&rsquo;s"} marked days live on the{" "}
          <strong style={{ color: "var(--text-primary)" }}>Attendance</strong> screen —
          pick the date and the batch, and the grid shows what was actually marked.
        </p>

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="num" data-student-id={studentId}>
            Showing no figures is not the same as showing zero.
          </span>
        </p>
      </div>

      <p className="flex items-start gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <CalendarCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Owner work: add a per-student attendance read to the gateway, then replace
          this panel with the real month. Tracked in the session worklog.
        </span>
      </p>
    </div>
  );
}