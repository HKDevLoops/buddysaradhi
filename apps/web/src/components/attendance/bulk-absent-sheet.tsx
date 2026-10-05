"use client";

// Implements: 06_Attendance.md §10.7 BR-ATT-06 ("Mark all Absent: opens a
// confirmation sheet … with a typed confirm input `ABSENT`"), §14 validation
// table ("Bulk absent requires typed confirm"), §16 error table ("Bulk absent
// typed-confirm mismatch | Confirm button stays disabled; subtle inline hint
// 'Type ABSENT to confirm.'"), §21.6 mockup M5.
//
// Why this is a TYPED word and not a second tap: before this, "Mark all Absent"
// armed an inline confirm that a tutor dismissed and re-pressed without reading,
// and there was no statement of what would change. A whole-day flip is the one
// attendance mutation that cannot be undone in one motion — EC-A-05's recovery
// is "re-mark individual students", row by row. The word forces intent, and the
// sheet states the current counts first so the tutor can see what is about to be
// overwritten (per M5) rather than agreeing to a number they never checked.
//
// The word itself comes from `BULK_ABSENT_CONFIRM_WORD`
// (`@/server/attendance-window`), the same constant the server imports, so the
// sheet and the writer can never disagree about what the gate is.

import { useCallback, useState } from "react";
import { BULK_ABSENT_CONFIRM_WORD } from "@/server/attendance-window";
import {
  DiscardChangesPrompt,
  OverlayCloseButton,
  useOverlayDismiss,
} from "@/components/ui/overlay";

export interface BulkAbsentBreakdown {
  total: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
}

interface BulkAbsentSheetProps {
  open: boolean;
  /** What the bulk will change, counted from the rows on screen. */
  breakdown: BulkAbsentBreakdown;
  /** Session date, shown so the tutor confirms the right day. */
  sessionDateIso: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending?: boolean;
}

export function BulkAbsentSheet({
  open,
  breakdown,
  sessionDateIso,
  onConfirm,
  onClose,
  isPending = false,
}: BulkAbsentSheetProps) {
  const [typed, setTyped] = useState("");

  const close = useCallback(() => {
    setTyped("");
    onClose();
  }, [onClose]);

  const { panelRef, onScrimClick, setDiscardOpen, discardOpen, discardQuestion } =
    useOverlayDismiss({
      open,
      onClose: close,
      dirty: typed.length > 0,
      label: "mark all absent",
    });

  if (!open) return null;

  // Exact match, case-insensitive: the gate is "did you read the warning", not
  // a spelling test, and a tutor typing on a phone keyboard will not match caps
  // lock reliably. Every other key state is refused (M5: "button disabled until
  // exact match").
  const matched = typed.trim().toUpperCase() === BULK_ABSENT_CONFIRM_WORD;
  const willChange = breakdown.present + breakdown.late + breakdown.excused + breakdown.absent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[var(--surface-scrim)] [backdrop-filter:var(--mat-filter)]"
        onClick={onScrimClick}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-absent-title"
        aria-describedby="bulk-absent-body"
        tabIndex={-1}
        className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="bulk-absent-title"
            className="text-xl font-bold text-[var(--text-primary)]"
          >
            Mark {breakdown.total} {breakdown.total === 1 ? "student" : "students"} absent
            for {sessionDateIso}?
          </h2>
          <OverlayCloseButton onClick={close} label="Close mark all absent confirmation" />
        </div>

        <div id="bulk-absent-body" className="mt-4 space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            {willChange === 0
              ? "Everyone in view is already absent, so this changes nothing."
              : `This overwrites ${willChange} of ${breakdown.total} ${
                  willChange === 1 ? "mark" : "marks"
                }: ${breakdown.present} present, ${breakdown.late} late, ${breakdown.excused} on leave and ${breakdown.absent} already absent.`}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            One audit row is written for the whole batch, and you can re-mark any
            student afterwards, one at a time. There is no bulk undo.
          </p>

          <div>
            <label
              htmlFor="bulk-absent-confirm"
              className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
            >
              Type {BULK_ABSENT_CONFIRM_WORD} to confirm
            </label>
            <input
              id="bulk-absent-confirm"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              aria-invalid={typed.length > 0 && !matched}
              aria-describedby="bulk-absent-hint"
              className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 min-h-[44px] text-sm tracking-[0.2em] uppercase text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
              placeholder={BULK_ABSENT_CONFIRM_WORD}
            />
            <p
              id="bulk-absent-hint"
              className="mt-1.5 text-xs"
              style={{ color: typed.length > 0 && !matched ? "var(--danger)" : "var(--text-muted)" }}
            >
              {typed.length > 0 && !matched
                ? "That does not match. Type the whole word to continue."
                : `Type ${BULK_ABSENT_CONFIRM_WORD} exactly to continue.`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="neumo-raised min-h-[44px] px-4 rounded-lg text-sm font-semibold text-[var(--text-primary)] transition-all active:translate-y-px cursor-pointer"
            style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matched || isPending}
            aria-busy={isPending}
            className="neumo-raised min-h-[44px] px-4 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: matched ? "color-mix(in srgb, var(--danger) 18%, transparent)" : "var(--surface-inset)",
              border: `1px solid ${matched ? "var(--danger)" : "var(--border-default)"}`,
              color: matched ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {isPending
              ? "Marking absent…"
              : `Mark ${breakdown.total} ${breakdown.total === 1 ? "student" : "students"} absent`}
          </button>
        </div>

        <DiscardChangesPrompt
          open={discardOpen}
          question={discardQuestion}
          onKeep={() => setDiscardOpen(false)}
          onDiscard={() => {
            setDiscardOpen(false);
            close();
          }}
        />
      </div>
    </div>
  );
}
