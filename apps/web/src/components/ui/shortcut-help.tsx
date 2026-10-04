"use client";

// Implements: PRODUCT.md §1 (task completion velocity is the primary goal) and
// AGENTS.md §2 Rule 10 (a capability the pointer cannot reach is not reachable
// for a keyboard user either — so the accelerators must be discoverable WITHOUT
// the keyboard, or they only serve people who already know them).
//
// Every row here is read from `SHORTCUT_REGISTRY`. This component owns no chord
// data of its own: that is the only way a help sheet cannot drift from the
// shortcuts it documents. Delete a row in `shortcuts.ts` and it disappears from
// this list; add one and it appears, with no second edit.
//
// The trigger is a visible 44px control in the shell's topbar carrying the `?`
// glyph, so a tutor who has never heard of a chord still finds the list by
// looking, and pressing `?` reaches the same sheet.

import * as React from "react";
import { createPortal } from "react-dom";
import {
  HELP_PANEL_ATTRIBUTE,
  SHORTCUT_GROUPS,
  useShortcutHelpStore,
} from "@/components/ui/shortcuts";
import { useOverlayDismiss, OverlayCloseButton } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/** `mod` reads as ⌘ on Apple hardware and Ctrl everywhere else — the same
 *  platform split the app's own ⌘K hint already makes. */
function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

function ModKeyCap(): string {
  return isApple() ? "⌘" : "Ctrl";
}

/** `["mod", "k"]` → `⌘ k`; `["g", "1"]` → `g 1`. Rendered exactly as pressed —
 *  uppercasing the letter would advertise a chord that needs Shift, which the
 *  matcher deliberately refuses. */
function KeyCap({ chord }: { chord: readonly string[] }): React.ReactNode {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {chord.map((token, index) => (
        <React.Fragment key={`${token}-${index}`}>
          {index > 0 && chord.length === 2 && (
            <span className="text-[var(--text-muted)] text-xs" aria-hidden="true">
              then
            </span>
          )}
          <kbd
            className="min-w-[26px] h-[26px] inline-flex items-center justify-center px-1.5 rounded-md text-xs font-medium"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--surface-raised)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            {token === "mod" ? ModKeyCap() : token}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * The sheet is PORTALLED to `document.body`, and that is load-bearing rather
 * than tidy. Its trigger lives in the shell topbar, which carries
 * `backdrop-filter: var(--mat-filter)` — and a backdrop-filtered element
 * becomes the containing block for its `position: fixed` descendants. Rendered
 * in place, `inset-0` would have measured against the 64px-tall header and the
 * dialog would have been squashed into the topbar, behind the account menu.
 * Portalling removes every ancestor from the question.
 */
function ShortcutHelpSheet() {
  const open = useShortcutHelpStore((state) => state.open);
  const close = useShortcutHelpStore((state) => state.close);

  const { panelRef, onScrimClick, confirmThenClose } = useOverlayDismiss({
    open,
    onClose: close,
    label: "shortcut list",
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={onScrimClick} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        {...{ [HELP_PANEL_ATTRIBUTE]: "" }}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-panel border border-[var(--border-default)] p-5 max-h-[85dvh] overflow-y-auto"
        style={{
          background: "var(--surface-overlay)",
          backdropFilter: "var(--mat-filter)",
          WebkitBackdropFilter: "var(--mat-filter)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="shortcut-help-title"
              className="text-base font-semibold"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
            >
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Nothing here fires while you are typing, and never while a form is open.
            </p>
          </div>
          <OverlayCloseButton onClick={confirmThenClose} label="Close the shortcut list" />
        </div>

        <div className="mt-5 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3
                className="text-xs font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                {group.title}
              </h3>
              <ul className="mt-2 divide-y" style={{ borderColor: "var(--border-default)" }}>
                {group.items.map((item) => (
                  <li
                    key={`${item.group}-${item.chord.join("-")}`}
                    className="flex items-center justify-between gap-4 py-2"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                      {item.description}
                    </span>
                    <KeyCap chord={item.chord} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The discoverable affordance: a 44px control whose accessible name says what it
 * opens, whose glyph is the same `?` the chord uses, and which is reachable by
 * Tab in the shell's topbar on every viewport.
 */
export function ShortcutHelpButton({ className }: { className?: string }) {
  const open = useShortcutHelpStore((state) => state.open);
  const toggle = useShortcutHelpStore((state) => state.toggle);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        className={cn(
          "size-11 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
          className,
        )}
        style={{
          background: open
            ? "color-mix(in srgb, var(--accent-primary) 15%, var(--surface-raised))"
            : "var(--surface-inset)",
          border: "1px solid var(--border-default)",
          color: open ? "var(--accent-primary)" : "var(--text-secondary)",
        }}
      >
        <kbd
          aria-hidden="true"
          className="text-sm font-medium"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          ?
        </kbd>
      </button>
      <ShortcutHelpSheet />
    </>
  );
}
