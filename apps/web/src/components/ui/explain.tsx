"use client";

// Implements: 13_UI_Guidelines.md §8 (an inline disclosure is a labelled
// control, not an icon glyph) and AGENTS.md §2 Rule 10 (WCAG 2.1 AA disclosure
// pattern — real keyboard operation, `aria-expanded` + `aria-controls`, Escape
// closes and returns focus, 44px target, `prefers-reduced-motion` honoured) plus
// AGENTS.md §2 Rule 9 (a concept with no copy fails loudly; it never renders a
// blank panel).
//
// The concepts below are the four places a tutor meets a rule that has a cost
// they cannot see: a backdated payment asks for a PIN, voiding never deletes,
// "Credit" is not a discount, and a locked session cannot be edited. Each one
// ships a correct answer with no in-app destination, so the only honest place to
// put the answer is beside the control that triggers it.
//
// Deletion test: written inline at four call sites, this is the same disclosure
// four times — four places to fix the 44px target, four places to add Escape,
// four copies of the credit-balance paragraph to keep in step, and a fifth when
// the next concept appears. This module owns the trigger, the panel, the
// keyboard behaviour and the copy; callers own only WHICH concept and, where
// the sentence reads wrong in place, the trigger label.
//
// Interface (the whole of it):
//   concept: ConceptId   — a typo is a compile error, not an empty panel.
//   trigger?: string     — defaults to the concept's own sentence.
// Invariants callers must not re-implement:
//   1. Copy never renders a spec id (`BR-`, `EC-`, `§`). Those belong in this
//      file's header comment, where a maintainer reads them.
//   2. The disclosure is NON-MODAL on purpose. It does not use
//      `useOverlayDismiss` from `overlay.tsx`: that hook is a dialog hook — it
//      locks body scroll and traps Tab inside `panelRef`, so composing it here
//      would freeze the page while a tutor reads two sentences and strand
//      keyboard focus in a panel that contains no controls. Native
//      `<details>`/`<summary>` already give the disclosure semantics, the
//      keyboard operation and focus return; the only behaviour a native element
//      does not give is Escape, which the listener below adds — and it closes
//      only the disclosure the tutor is currently inside, so an Explain inside
//      an open sheet does not swallow the sheet's own Escape.
//   3. The panel renders IN FLOW. It pushes the surface below it down rather
//      than floating over it, because in a fee sheet or a void dialog an
//      overlay would sit on top of the number the tutor is trying to read.

import * as React from "react";
import { ChevronDown } from "lucide-react";

/**
 * The registry. One `as const` tuple, so `ConceptId` is derived from the copy
 * itself and a misspelled id fails `tsc --noEmit` rather than shipping a
 * tutor an empty panel.
 */
const EXPLANATIONS = [
  {
    id: "backdated-payment-pin",
    trigger: "Why is this needed?",
    title: "A backdated payment asks for your PIN",
    body: "A payment dated in the past changes a month you have already closed, so it asks for proof that it is really you and not someone at an open screen. A payment dated today never asks. If you have not set a PIN yet, add one in Settings → Security — without one, backdated payments cannot be recorded at all.",
  },
  {
    id: "void",
    trigger: "What does voiding do?",
    title: "Voiding never deletes",
    body: "The original payment stays in the ledger, struck through, and a matching reversing entry is added against it, so the balance returns to exactly what it was before you took the money. The receipt number is used up for good: the gap in your receipt book is the proof, and that number is never issued to anyone again.",
  },
  {
    id: "credit-balance",
    trigger: "What does Credit mean?",
    title: "Credit means you already have their money",
    body: "This student has paid more than they owe, and the excess is held against their next invoice instead of being refunded. It is not a discount and it does not fade away — the next fee you generate is settled from it on its own. Read it as cash in your hand that you owe them a class for.",
  },
  {
    id: "attendance-lock",
    trigger: "What does locking do?",
    title: "A locked session is frozen, not deleted",
    body: "Locking holds one date and batch steady, so nobody — including you by accident — can change marks after the fact and make your month-end totals disagree with yesterday's. Unlock it with your PIN when you do need to correct something. Nothing is lost by locking; the marks are still there behind it.",
  },
] as const;

export type ConceptId = (typeof EXPLANATIONS)[number]["id"];

/** Fail closed (Rule 9): an unknown concept throws instead of rendering nothing. */
function entryFor(concept: ConceptId): (typeof EXPLANATIONS)[number] {
  const found = EXPLANATIONS.find((e) => e.id === concept);
  if (!found) throw new Error(`EXPLAIN_UNKNOWN_CONCEPT: no copy registered for "${concept}"`);
  return found;
}

export interface ExplainProps {
  concept: ConceptId;
  /** Overrides the concept's own sentence when the trigger reads wrong in place. */
  trigger?: string;
  className?: string;
}

export function Explain({ concept, trigger, className }: ExplainProps) {
  const copy = entryFor(concept);
  const panelId = React.useId();
  const detailsRef = React.useRef<HTMLDetailsElement | null>(null);
  const summaryRef = React.useRef<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);

  // The one behaviour a native disclosure does not provide. Contained to the
  // node the tutor is inside, so an Explain nested in an open sheet leaves the
  // sheet's own Escape alone until focus leaves this panel.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const node = detailsRef.current;
      if (!node || !node.open) return;
      if (!node.contains(document.activeElement)) return;
      event.stopPropagation();
      setOpen(false);
      summaryRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`min-w-0 ${className ? ` ${className}` : ""}`}
    >
      <summary
        ref={summaryRef}
        aria-expanded={open}
        aria-controls={panelId}
        className="group inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 py-1 text-left text-sm font-medium underline decoration-dotted underline-offset-4 transition-colors motion-safe:transition-colors hover:text-[var(--info)] focus-visible:text-[var(--info)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--info)] [&::-webkit-details-marker]:hidden"
        style={{ color: "var(--info)" }}
      >
        {trigger ?? copy.trigger}
        <ChevronDown
          className="size-4 shrink-0 transition-transform motion-safe:duration-150"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
          aria-hidden="true"
        />
      </summary>

      <div
        id={panelId}
        className="mt-1 rounded-lg border border-[var(--border-default)] p-3 text-sm"
        style={{ background: "var(--surface-inset)" }}
      >
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {copy.title}
        </p>
        <p className="mt-1 max-w-[62ch]" style={{ color: "var(--text-secondary)" }}>
          {copy.body}
        </p>
      </div>
    </details>
  );
}