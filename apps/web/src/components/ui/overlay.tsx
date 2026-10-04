"use client";

// Implements: 13_UI_Guidelines.md §8.7 (modal/sheet — escape, focus return,
// scrim) and §5.5 (glass tiers) plus docs/design/overhaul-plan.md §2 (a sheet
// may never discard typed work without asking). Implements AGENTS.md §2 Rule 10
// (WCAG 2.1 AA dialog pattern: labelled, modal, focus trapped and returned,
// keyboard parity) and 14_Edge_Cases.md EC-AU-01 (unsaved form state).
//
// Seven overlays shipped in this app and only two listened for Escape; the rest
// let a tutor click the scrim and silently throw away a typed ₹5,000 payment.
// Every overlay now composes `useOverlayDismiss` so that behaviour is written
// once and cannot regress one surface at a time.
//
// Overlays stack (the Students drawer opens the Record Payment sheet), so scroll
// lock and Escape are owned by the topmost layer rather than by each layer.

import * as React from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button[disabled][aria-disabled="true"],[tabindex]:not([tabindex="-1"])';

/**
 * One entry per open layer, in stacking order. `isDirty` is a GETTER, not a
 * value: a layer's dirty state changes on every keystroke, and a stack that
 * snapshotted it would answer a question about the past.
 */
interface OverlayLayerEntry {
  id: symbol;
  /** What this layer is, so a caller can say WHICH one it must not close. */
  label: string;
  isDirty: () => boolean;
}

const layerStack: OverlayLayerEntry[] = [];

export interface UseOverlayDismissOptions {
  open: boolean;
  /** Called when the layer may actually close (already confirmed, if dirty). */
  onClose: () => void;
  /**
   * True when the layer holds work the tutor typed. Escape and a scrim click then
   * ask instead of discarding; the close button and Cancel stay direct.
   */
  dirty?: boolean;
  /** What the layer is, for the scrim's accessible name. */
  label?: string;
}

export interface OverlayDismiss {
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the scrim; asks first when `dirty`. */
  onScrimClick: () => void;
  /** Escape and the scrim. Same guard. */
  requestClose: () => void;
  /** Ask unconditionally — used by the header close button on a dirty form. */
  confirmThenClose: () => void;
  /** Lets the caller close its own confirm prompt. */
  setDiscardOpen: (open: boolean) => void;
  discardOpen: boolean;
  discardQuestion: string;
}

export function useOverlayDismiss({
  open,
  onClose,
  dirty = false,
  label = "dialog",
}: UseOverlayDismissOptions): OverlayDismiss {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const layer = React.useRef<symbol>(Symbol("overlay"));
  const restoreFocusTo = React.useRef<HTMLElement | null>(null);
  const isTop = React.useRef(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  // `dirty` and `onClose` are read inside listeners that must not be torn down
  // on every keystroke, so the latest values live in refs.
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const labelRef = React.useRef(label);
  labelRef.current = label;
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) {
      setDiscardOpen(false);
      return;
    }
    const el = document.activeElement;
    restoreFocusTo.current = el instanceof HTMLElement ? el : null;
    return () => {
      restoreFocusTo.current?.focus?.();
    };
  }, [open]);

  // Topmost-layer bookkeeping for Escape, focus trap and scroll lock.
  React.useEffect(() => {
    if (!open) return;
    const entry: OverlayLayerEntry = {
      id: layer.current,
      label: labelRef.current,
      isDirty: () => dirtyRef.current,
    };
    layerStack.push(entry);
    isTop.current = true;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || active === node)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      const index = layerStack.lastIndexOf(entry);
      if (index >= 0) layerStack.splice(index, 1);
      isTop.current = layerStack[layerStack.length - 1]?.id === layer.current;
    };
  }, [open]);

  const requestClose = React.useCallback(() => {
    if (dirtyRef.current) {
      setDiscardOpen(true);
      return;
    }
    onCloseRef.current();
  }, []);

  const requestCloseRef = React.useRef(requestClose);
  requestCloseRef.current = requestClose;

  const onScrimClick = React.useCallback(() => requestCloseRef.current(), []);
  const confirmThenClose = requestClose;

  return {
    panelRef,
    onScrimClick,
    requestClose,
    confirmThenClose,
    setDiscardOpen,
    discardOpen,
    discardQuestion: `Discard the changes in this ${label}? Nothing you typed will be saved.`,
  };
}

/**
 * The topmost open layer that holds work the tutor typed, or `null`.
 *
 * READ-ONLY and side-effect free: it observes, it never asks. This exists for
 * callers OUTSIDE a layer — the screen switch. A sheet is unmounted by a screen
 * change rather than closed by it, so no layer's own Escape/scrim guard can run:
 * without this query the app asked "may I discard ₹5,000 of typing?" on the one
 * path that was silently taking it. Returns the label so the refusal can name
 * what would be lost instead of saying "something".
 */
export function findDirtyOverlay(): { label: string } | null {
  for (let i = layerStack.length - 1; i >= 0; i -= 1) {
    const entry = layerStack[i];
    if (entry && entry.isDirty()) return { label: entry.label };
  }
  return null;
}

/** True when at least one open layer holds typed work. See `findDirtyOverlay`. */
export function isAnyLayerDirty(): boolean {
  return findDirtyOverlay() !== null;
}

export function DiscardChangesPrompt({
  open,
  question,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  question: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  // This is a nested modal, so it composes the same hook rather than
  // hand-rolling Escape and a focus trap. It did not: it rendered as a SIBLING
  // of the parent panel, so the parent's `panelRef.querySelectorAll(FOCUSABLE)`
  // never saw its buttons — Tab from "Discard" walked out into the page behind
  // a modal, and Escape re-fired the PARENT's `requestClose`, which simply
  // reopened the prompt. Joining `layerStack` as the topmost layer fixes both,
  // and it is why `layerStack` exists.
  const nested = useOverlayDismiss({
    open,
    onClose: onKeep,
    label: "confirmation",
  });
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);
  // Focus lands on the safe choice, not the destructive one: a stray Enter must
  // not discard a half-typed payment.
  React.useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={nested.onScrimClick} aria-hidden="true" />
      <div
        ref={nested.panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label="Unsaved changes"
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-panel border border-[var(--border-default)] p-5"
        style={{
          background: "var(--surface-overlay)",
          backdropFilter: "var(--mat-filter)",
          WebkitBackdropFilter: "var(--mat-filter)",
        }}
      >
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Unsaved changes
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          {question}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={onKeep}
            className="min-h-[44px] rounded-lg px-4 text-sm font-semibold"
            style={{ color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="min-h-[44px] rounded-lg px-4 text-sm font-semibold"
            style={{
              background: "color-mix(in srgb, var(--danger) 18%, transparent)",
              color: "var(--danger)",
              border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
            }}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

/** Standard header close control: 44px, labelled, never the only way out. */
export function OverlayCloseButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-full"
      style={{ color: "var(--text-muted)" }}
    >
      <X className="size-5" aria-hidden="true" />
    </button>
  );
}
