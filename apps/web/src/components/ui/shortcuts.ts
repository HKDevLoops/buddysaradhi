"use client";

// Implements: PRODUCT.md §1 (Operate surface — "maximum operational efficiency…
// task completion velocity" is the PRIMARY goal) and 03_User_Flows.md §"the three
// daily tasks" (mark attendance, record a payment, add a student), served through
// the one interaction channel those flows always have: the keyboard.
// AGENTS.md §2 Rule 10 (keyboard parity — every capability the pointer reaches is
// reachable without a pointer) + 13_UI_Guidelines.md §10.
//
// THE DEFECT THIS FILE EXISTS TO FIX. Before this, `glass-shell.tsx` carried
// exactly ONE global handler (⌘K, roster search). A tutor who marks a batch of 40
// students, collects 12 fees and enrols 3 new students a day did all of it with
// the pointer, and an independent assessment put Flexibility & Efficiency at 2/4
// for exactly that reason. An accelerator that only the mouse user can find is
// not an accelerator.
//
// THREE THINGS MAKE THIS A REGISTRY AND NOT FIVE HANDLERS:
//
//  1. One table, one listener. `{ keys, when, description, run }` per row, one
//     `keydown` listener for the whole app. Adding an accelerator is a row, not a
//     listener — so the two-guard rule below cannot be re-implemented wrongly on
//     the sixth accelerator.
//  2. The guards are non-negotiable and centralised (Rule 10 + the caret bug in
//     the original ⌘K handler). A chord NEVER fires from an `input` / `textarea`
//     / `select` / `contenteditable`, never mid-IME-composition, and never while
//     an overlay owns the keyboard. `?` is the one exception by design, and only
//     over ITS OWN dialog — see `scope`.
//  3. The help sheet renders THIS table (`shortcut-help.tsx`). A shortcut nobody
//     can find is not an accelerator, and a help sheet maintained by hand is a
//     second list that drifts. Delete the row and the sheet loses the row.
//
// CHORDS. Letters and digits only, with at most one modifier (`mod` = ⌘ on Apple
// hardware, Ctrl everywhere else). Chosen because every browser and OS reserves
// the digit and letter rows far less than the function/arrow rows: Ctrl+1..9 is
// "switch tab" and Alt+1..9 is "switch tab" in Firefox, both of which we must not
// steal, so the screen chords are a two-key `g`-prefixed sequence. `?` is the
// conventional "show me the keys" chord and is unreserved on both platforms.
// Nothing here needs a chord only a laptop has.

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useShellStore, SCREENS, type ScreenId } from "@/stores/shell-store";
import { useStudentsStore } from "@/stores/students-store";
import { useFeesStore } from "@/stores/fees-store";

/** How long a two-key sequence stays armed. Long enough to be deliberate,
 *  short enough that a slow typist is not left with a dangling prefix. */
export const SEQUENCE_TIMEOUT_MS = 1200;

/** Marks the shortcut-help panel so `helpSheetOpen` can tell it apart from a
 *  task overlay — the only overlay a chord is ever allowed to fire over. */
export const HELP_PANEL_ATTRIBUTE = "data-buddysaradhi-shortcut-help";

export type ShortcutGroup = "Daily tasks" | "Go to screen" | "Find" | "This list";

export interface ShortcutSpec {
  /** What the tutor gets. Written as the outcome, not the keystroke. */
  readonly description: string;
  /** The chord, as tokens: a literal key, or `"mod"` for ⌘/Ctrl. Two tokens = a
   *  sequence (`["g", "1"]`), pressed within `SEQUENCE_TIMEOUT_MS` of each other. */
  readonly chord: readonly string[];
  /** Human chord for the help sheet and for a control's tooltip. */
  readonly keys: string;
  /** Press-time guard, evaluated AFTER the caret/overlay/IME guards. */
  readonly when: () => boolean;
  /** Do exactly what the visible control does. No shortcut may reach a
   *  capability the pointer does not. */
  readonly run: () => void;
  readonly group: ShortcutGroup;
  /**
   * `"app"` (default) — suppressed while ANY overlay owns the keyboard.
   * `"always"` — may fire while the shortcut-help sheet is the only open
   * overlay, which is what lets `?` close its own sheet. It is still
   * suppressed over a sheet, a drawer or a dialog.
   */
  readonly scope?: "app" | "always";
}

/* ------------------------------------------------------------------ *
 * Guards — the non-negotiables, in one place.
 * ------------------------------------------------------------------ */

/**
 * True when the keystroke belongs to a text-entry context.
 *
 * The original ⌘K handler existed because of exactly this: a tutor typing a
 * ₹5,000 amount reached for the shortcut and the app yanked the caret into the
 * roster search mid-amount. A data-entry mistake with nothing on screen to
 * explain it. Every chord inherits this guard now, not just ⌘K.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "option" ||
    target.isContentEditable === true
  );
}

/**
 * True when a dialog owns the keyboard — a sheet, a drawer, a confirm, or the
 * shortcut help. Those layers trap focus, so a chord fired underneath one would
 * move the screen out from under a form the tutor is filling in.
 *
 * Read from the DOM rather than from a registry because `useOverlayDismiss`
 * (components/ui/overlay.tsx) owns the layer stack as module state that is
 * deliberately NOT exported — the DOM is the seam that lets one rule cover all
 * seven overlays instead of seven listeners.
 */
export function hasOpenOverlay(): boolean {
  return (
    document.querySelector(
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    ) !== null
  );
}

/** True while the shortcut-help sheet itself is the open overlay. */
function helpSheetOpen(): boolean {
  return document.querySelector(`[${HELP_PANEL_ATTRIBUTE}]`) !== null;
}

/**
 * An IME is mid-word. `event.key` is then the *candidate* letter, not a
 * keystroke the tutor meant as a command — without this, typing "Nandini" in an
 * IME field with focus outside a text box would fire "add student" on the `n`.
 */
function isComposing(event: KeyboardEvent): boolean {
  // SAFETY: `keyCode === 229` is the only signal some Windows IMEs emit, and
  // it is still the documented value in lib.dom. Read-only, cast-free.
  return event.isComposing || event.keyCode === 229;
}

/**
 * True when `event` is exactly the `key` half of a chord, with no modifier that
 * the chord did not ask for.
 *
 * `altKey` is refused unconditionally: Alt belongs to the OS and to browser
 * menus, and stealing it produces shortcuts that work on one machine and
 * mysteriously do nothing on another. `shiftKey` is only required for letters
 * and digits (so `Shift+A` is NOT the `a` chord) and ignored for punctuation,
 * because `?` is Shift+`/` on a US layout and a bare key on several others.
 */
function keyMatches(event: KeyboardEvent, key: string, wantMod: boolean): boolean {
  if (event.key.toLowerCase() !== key.toLowerCase()) return false;
  if (event.altKey) return false;
  const hasMod = event.metaKey || event.ctrlKey;
  if (hasMod !== wantMod) return false;
  const isLetterOrDigit = key.length === 1 && /[a-z0-9]/.test(key);
  if (isLetterOrDigit && event.shiftKey) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * The roster-search focus hand-off
 * ------------------------------------------------------------------ */

/**
 * ⌘K belongs in this table with every other chord, but the element it focuses
 * lives inside `StudentSearchBox` — a component this module must not reach into
 * (components/search/** is not its seam). So the shell registers the focus
 * action here and the table calls it. Interface: register a focus action,
 * unregister on unmount; unregistering twice, or before registering, is a no-op.
 * Error mode: with nothing registered, ⌘K does nothing rather than throwing.
 */
let paletteFocus: (() => void) | null = null;

export function registerPaletteFocus(action: () => void): () => void {
  paletteFocus = action;
  return () => {
    if (paletteFocus === action) paletteFocus = null;
  };
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

function goTo(screen: ScreenId): void {
  useShellStore.getState().setActiveScreen(screen);
}

const DAILY_TASK_SHORTCUTS: readonly ShortcutSpec[] = [
  {
    group: "Daily tasks",
    description: "Mark attendance — open the attendance screen",
    keys: "a",
    chord: ["a"],
    when: () => true,
    run: () => goTo("/attendance"),
  },
  {
    group: "Daily tasks",
    description: "Record a payment — open Fees, and the payment form if a student is already selected there",
    keys: "p",
    chord: ["p"],
    when: () => true,
    run: () => {
      const fees = useFeesStore.getState();
      // Parity, deliberately narrow: the Fees screen's own "Record payment"
      // control is only enabled once a student is in context, so the shortcut
      // opens the form only in that state. From any other screen this is the
      // Dashboard quick action — navigate, then the tutor picks the student —
      // because opening a payment form for an arbitrary student would put money
      // against the wrong name.
      const formIsOurs = useShellStore.getState().activeScreen === "/fees";
      goTo("/fees");
      if (formIsOurs && fees.selectedStudentId !== null) {
        fees.setPaymentSheetOpen(true);
      }
    },
  },
  {
    group: "Daily tasks",
    description: "Add a student — open the Add Student form",
    keys: "n",
    chord: ["n"],
    when: () => true,
    run: () => {
      goTo("/students");
      // The Add Student sheet is mounted by StudentsClient, which is a lazy
      // chunk — it is not in the tree on the tick we change the screen. The
      // store flag is read when it mounts, so the deferral only has to outlast
      // this commit, exactly as dashboard-client's "Add Student" quick action
      // already does.
      setTimeout(() => {
        useStudentsStore.getState().openAddSheet();
      }, 0);
    },
  },
];

const SCREEN_SHORTCUTS: readonly ShortcutSpec[] = SCREENS.map((screen, index) => ({
  group: "Go to screen" as const,
  description: `Go to ${screen.label}`,
  keys: `g then ${index + 1}`,
  chord: ["g", String(index + 1)],
  when: () => true,
  run: () => goTo(screen.id),
}));

const FIND_SHORTCUTS: readonly ShortcutSpec[] = [
  {
    group: "Find",
    description: "Search students — focus the roster search field",
    keys: "s",
    chord: ["s"],
    when: () => true,
    // The same action the ⌘K chord performs, so a Windows keyboard without a
    // comfortable Ctrl chord, and a tutor on a laptop with both hands on the
    // home row, reach the field the same way the sidebar button does.
    run: () => paletteFocus?.(),
  },
  {
    group: "Find",
    description: "Search students — focus the roster search field",
    keys: "mod k",
    chord: ["mod", "k"],
    when: () => true,
    run: () => paletteFocus?.(),
  },
];

const LIST_SHORTCUTS: readonly ShortcutSpec[] = [
  {
    group: "This list",
    description: "Show or hide this shortcut list",
    keys: "?",
    chord: ["?"],
    // The one chord allowed to fire over its own dialog, so the same key that
    // opened the sheet closes it. Still blocked over a sheet, drawer or dialog.
    scope: "always",
    when: () => true,
    run: () => useShortcutHelpStore.getState().toggle(),
  },
];

/**
 * The one table. `shortcut-help.tsx` renders exactly this array, so the help
 * sheet cannot list a chord that does not exist or miss one that does.
 */
export const SHORTCUT_REGISTRY: readonly ShortcutSpec[] = [
  ...DAILY_TASK_SHORTCUTS,
  ...SCREEN_SHORTCUTS,
  ...FIND_SHORTCUTS,
  ...LIST_SHORTCUTS,
];

/** Grouped for rendering, in the order a tutor would reach for them. */
export const SHORTCUT_GROUPS: readonly { readonly title: ShortcutGroup; readonly items: readonly ShortcutSpec[] }[] = [
  { title: "Daily tasks", items: DAILY_TASK_SHORTCUTS },
  { title: "Go to screen", items: SCREEN_SHORTCUTS },
  { title: "Find", items: FIND_SHORTCUTS },
  { title: "This list", items: LIST_SHORTCUTS },
];

/** Open/closed state of the help sheet, so the `?` chord and the trigger button
 *  are the same action with no prop threading and no second source of truth. */
export const useShortcutHelpStore = create<{ open: boolean; toggle: () => void; close: () => void }>(
  (set) => ({
    open: false,
    toggle: () => set((state) => ({ open: !state.open })),
    close: () => set({ open: false }),
  }),
);

/* ------------------------------------------------------------------ *
 * The single listener
 * ------------------------------------------------------------------ */

export interface GlobalShortcutOptions {
  /**
   * Suspends every chord. The shell passes its account menu and sign-out
   * in-flight: that menu is a `role="menu"` popup, not a dialog, so the overlay
   * guard cannot see it, and a chord fired behind it would move the screen out
   * from under a menu the tutor is reading.
   */
  suspend?: boolean;
}

/**
 * One window listener for the whole app. Registered once; the table and the
 * suspend flag are read through refs so a re-render never rebinds the listener
 * (a rebind mid-chord would drop the second key of a `g`-sequence).
 */
export function useGlobalShortcuts(
  specs: readonly ShortcutSpec[] = SHORTCUT_REGISTRY,
  { suspend = false }: GlobalShortcutOptions = {},
): void {
  const specsRef = useRef(specs);
  specsRef.current = specs;
  const suspendRef = useRef(suspend);
  suspendRef.current = suspend;

  useEffect(() => {
    let armed: string | null = null;
    let armedTimer: ReturnType<typeof setTimeout> | null = null;

    const disarm = () => {
      armed = null;
      if (armedTimer !== null) {
        clearTimeout(armedTimer);
        armedTimer = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Another surface already claimed this keystroke (the overlay layer
      // claims Escape and Tab in the capture phase). Never double-handle.
      if (event.defaultPrevented) return;
      if (suspendRef.current) return;
      // An IME is mid-word: the key is a candidate, not a command.
      if (isComposing(event)) return;
      // The caret guard — a chord must never steal a half-typed amount.
      if (isTextEntryTarget(event.target)) return;

      // A lone modifier is not a chord; it also means the tutor gave up on a
      // sequence they started, so drop the armed prefix rather than firing a
      // stale one later.
      if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") {
        disarm();
        return;
      }

      const overlayOpen = hasOpenOverlay();
      const helpOpen = overlayOpen && helpSheetOpen();
      const table = specsRef.current;

      // A pending `g` gets the first refusal: if this keystroke completes a
      // sequence, it is that sequence and nothing else.
      const pending = armed;
      if (pending !== null) {
        // Disarm FIRST so a completion can never re-arm the prefix, and compare
        // against the captured value — reading `armed` after this line would
        // compare every chord against `null` and the sequence would never fire.
        disarm();
        for (const spec of table) {
          if (spec.chord.length !== 2) continue;
          const [first, second] = spec.chord;
          // `"mod"` is a modifier token, not a sequence head — a `g`-sequence is
          // never armed on it.
          if (first === undefined || first === "mod" || second === undefined) continue;
          if (first !== pending) continue;
          if (!isRunnable(spec, overlayOpen, helpOpen)) continue;
          if (!keyMatches(event, second, false)) continue;
          if (!spec.when()) continue;
          event.preventDefault();
          spec.run();
          return;
        }
        // Not a sequence completion — fall through, so `g` then `a` still means
        // "mark attendance" instead of eating the keystroke.
      }

      for (const spec of table) {
        const head = spec.chord[0];
        if (head === undefined) continue;
        // A SEQUENCE is a chord whose first token is a literal key. `["mod","k"]`
        // is two tokens but one keystroke — treating it as a sequence armed on
        // the string "mod", which no keystroke can match, and ⌘K stopped firing.
        const isSequence = spec.chord.length > 1 && head !== "mod";
        if (isSequence) {
          if (keyMatches(event, head, false)) {
            armed = head;
            if (armedTimer !== null) clearTimeout(armedTimer);
            armedTimer = setTimeout(disarm, SEQUENCE_TIMEOUT_MS);
          }
          continue;
        }
        if (!isRunnable(spec, overlayOpen, helpOpen)) continue;
        const wantMod = spec.chord.includes("mod");
        const literal = wantMod ? spec.chord[1] : head;
        if (literal === undefined || !keyMatches(event, literal, wantMod)) continue;
        if (!spec.when()) continue;
        event.preventDefault();
        spec.run();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      disarm();
    };
  }, []);
}

/** An `app` chord needs a clear screen; an `always` chord needs the help sheet
 *  to be the ONLY thing open — never a payment form, a sheet or a dialog. */
function isRunnable(spec: ShortcutSpec, overlayOpen: boolean, helpOpen: boolean): boolean {
  if (!overlayOpen) return true;
  return spec.scope === "always" && helpOpen;
}
