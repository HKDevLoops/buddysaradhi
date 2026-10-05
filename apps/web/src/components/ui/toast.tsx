"use client";

// Implements: 13_UI_Guidelines.md §8.8 (Toast — glass-strong surface, 4px accent
// left-bar carrying severity, auto-dismiss, one live region) and
// docs/design/overhaul-plan.md §2 (post-mutation confirmation). The component
// did not exist, which is why every mutation in the app used to close its sheet
// inside `onMutate` and say nothing — the tutor could not tell a saved payment
// from a lost one (AGENTS.md §2 Rule 9, no silent failures; §13 heuristic
// "recognise, diagnose and recover from errors"; Rule 10 live region + keyboard
// dismiss + colour never the only signal).
//
// The store is module-level and read through `useSyncExternalStore`, so a toast
// does not re-render the React tree that published it. Mounted once, in
// `app/providers.tsx`.

import * as React from "react";
import { useSyncExternalStore } from "react";
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from "lucide-react";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastInput {
  tone: ToastTone;
  /** What happened, in the user's terms. Never a spec ID or a stack message. */
  title: string;
  /** The consequence, or the recovery. Optional but preferred on errors. */
  body?: string;
  action?: ToastAction;
  /** Defaults to 5s, or 9s for an error the tutor has to act on. */
  duration?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
  /** Has it been on screen yet? Only then may its dismissal timer start. */
  seen: boolean;
}

/** A burst of nine toasts is noise, not information. */
const MAX_VISIBLE = 3;

let toasts: ToastRecord[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ToastRecord[] {
  return toasts;
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/**
 * A toast may only start its dismissal countdown once it has actually been on
 * screen. This is the whole contract: a timer armed at push time begins running
 * against a toast the tutor may never see, so the outcome expires unread.
 */
function markSeen(id: number) {
  const record = toasts.find((t) => t.id === id);
  if (record === undefined || record.seen || timers.has(id)) return;
  record.seen = true;
  const duration = record.duration ?? (record.tone === "error" ? 9000 : 5000);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration),
  );
}

export function pushToast(input: ToastInput): number {
  const id = nextId;
  nextId += 1;
  // NOTHING is dropped. The cap moved from the store to the viewport: older
  // toasts stay in the stack and are reachable behind the overflow tray, because
  // `.slice(-MAX_VISIBLE)` on push is what made a mutation's outcome disappear
  // with no trace at all — the tutor learned nothing about whether their payment
  // saved (Rule 9).
  toasts = [...toasts, { ...input, id, seen: false }];
  emit();
  return id;
}

export function useToast() {
  return React.useMemo(
    () => ({
      notify: pushToast,
      success: (title: string, body?: string) => pushToast({ tone: "success", title, body }),
      error: (title: string, body?: string) => pushToast({ tone: "error", title, body }),
      warning: (title: string, body?: string) => pushToast({ tone: "warning", title, body }),
      info: (title: string, body?: string) => pushToast({ tone: "info", title, body }),
      dismiss: dismissToast,
    }),
    [],
  );
}

const TONE = {
  success: { icon: CheckCircle2, accent: "var(--success)" },
  error: { icon: XCircle, accent: "var(--danger)" },
  warning: { icon: TriangleAlert, accent: "var(--warning)" },
  info: { icon: Info, accent: "var(--info)" },
} as const;

function ToastCard({ toast }: { toast: ToastRecord }) {
  const { icon: Icon, accent } = TONE[toast.tone];
  // A timer the tutor is about to read must not expire under their cursor.
  const [paused, setPaused] = React.useState(false);

  // First paint is the moment this toast became readable, so this is where its
  // countdown starts — not when it was pushed.
  React.useEffect(() => {
    markSeen(toast.id);
  }, [toast.id]);

  React.useEffect(() => {
    if (paused) return;
    const duration = toast.duration ?? (toast.tone === "error" ? 9000 : 5000);
    const timer = setTimeout(() => dismissToast(toast.id), duration);
    return () => clearTimeout(timer);
  }, [paused, toast.id, toast.tone, toast.duration]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-start gap-3 overflow-hidden rounded-panel border border-[var(--border-default)] p-3 pr-2"
      style={{
        background: "var(--surface-overlay)",
        backdropFilter: "var(--mat-filter)",
        WebkitBackdropFilter: "var(--mat-filter)",
        // Severity is carried three ways — the accent bar, the icon, and the
        // title text — so it survives a monochrome display (Rule 10 / AP-14).
        boxShadow: `inset 4px 0 0 0 ${accent}`,
      }}
    >
      <Icon className="mt-0.5 size-5 shrink-0" style={{ color: accent }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>
          {toast.title}
        </p>
        {toast.body ? (
          <p className="mt-0.5 text-sm leading-snug" style={{ color: "var(--text-secondary)" }}>
            {toast.body}
          </p>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onAction();
              dismissToast(toast.id);
            }}
            className="mt-2 min-h-[44px] rounded-md px-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
            style={{ color: "var(--accent-text)" }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
        style={{ color: "var(--text-muted)" }}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [showQueued, setShowQueued] = React.useState(false);

  // Newest win the visible window; the rest wait behind the tray, still intact
  // and still untimed. `showQueued` collapses itself the moment the queue empties
  // so a later burst does not inherit an open tray the tutor did not ask for.
  const queued = showQueued ? list : list.slice(-MAX_VISIBLE);
  const queuedCount = Math.max(0, list.length - MAX_VISIBLE);
  const trayOpen = showQueued && queuedCount > 0;

  // The store outlives the tree on purpose (a toast can be pushed from an
  // unmounting sheet), so its timers are the one thing that must be released.
  React.useEffect(
    () => () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    [],
  );

  React.useEffect(() => {
    if (showQueued && queuedCount === 0) setShowQueued(false);
  }, [showQueued, queuedCount]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4
                 md:inset-x-auto md:right-6 md:items-end"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)" }}
    >
      {/* Overflow tray — a count, not a silence. Every toast is retained; this
          is how the tutor reaches the ones a burst pushed out of the window. */}
      {queuedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowQueued((open) => !open)}
          aria-expanded={trayOpen}
          className="pointer-events-auto min-h-[44px] w-full max-w-sm rounded-panel border border-[var(--border-default)] px-3 text-left text-sm font-semibold"
          style={{
            background: "var(--surface-overlay)",
            backdropFilter: "var(--mat-filter)",
            WebkitBackdropFilter: "var(--mat-filter)",
            color: "var(--text-secondary)",
          }}
        >
          {queuedCount} more {queuedCount === 1 ? "message" : "messages"} not shown
          <span className="ml-1 font-normal" style={{ color: "var(--text-muted)" }}>
            {trayOpen ? "— hide" : "— show"}
          </span>
        </button>
      )}

      {queued.map((toast) => (
        <div key={toast.id} className="w-full max-w-sm">
          <ToastCard toast={toast} />
        </div>
      ))}
    </div>
  );
}