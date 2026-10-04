// Implements: AGENTS.md §2 Rule 9 (no silent failures) + Rule 10 (a11y) —
// 13_UI_Guidelines.md §7 loading & empty states, §10 accessibility;
// 04_Dashboard.md §3, 05_Students.md §3, 08_Settings.md §2.
//
// ONE deep module for the whole recovery contract: what is loading, what broke,
// what the tutor can do about it, and what their data looks like right now.
//
// Deletion test: remove this file and the retry semantics, the data-status line,
// the shape-matched skeleton, and the reduced-motion contract immediately reappear
// in every caller and drift. That is the complexity this file concentrates.
//
// Invariants (callers must not re-implement these):
//   1. A raw `err.message` never reaches a tutor. `ErrorState` renders ONLY the
//      static literals produced by `toAppErrorState` — digests, SQL text and file
//      paths stay on the server. See `lib/app-errors.ts`.
//   2. Every error surface names the data state (`dataStatus`). It has no default:
//      a surface that cannot say what is safe is not allowed to render.
//   3. Motion comes from the design system's `.skeleton`, which already collapses
//      under BOTH `prefers-reduced-motion` and `html[data-reduced-motion="1"]`
//      (globals.css). Never hand-roll a shimmer here.
//   4. Colour is never the only signal — every surface pairs an icon with text.

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Database,
  LayoutDashboard,
  LogIn,
  RefreshCw,
} from "lucide-react";
import type { AppErrorAction, AppErrorState } from "@/lib/app-errors";

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

/** The real shape of the surface being streamed, so nothing jumps on swap. */
export type ScreenShape = "dashboard" | "roster" | "form" | "detail";

export interface ScreenSkeletonProps {
  /**
   * Which layout is loading. Each shape mirrors the incumbent screen's actual
   * block structure (KPI strip + due list, dense roster columns, labelled inset
   * fields) rather than a centred spinner — the generic default.
   */
  shape: ScreenShape;
  /** Plain-language description of what is arriving, for assistive tech. */
  label: string;
  /** Row count for list-shaped surfaces. Defaults per shape. */
  rows?: number;
  className?: string;
}

/** Skeleton bar widths are authored, not random — a stable layout beats variety. */
const ROSTER_COLUMN_WIDTHS = ["w-32", "w-24", "w-16", "w-20", "w-14", "w-24"];
const DUE_ROW_WIDTHS = ["w-40", "w-28", "w-52"];
const FEED_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-full"];

/** Panels sit on the row surface; the canvas behind them is the glass shell. */
const PANEL_SURFACE = "var(--surface-row)";
const PANEL_BORDER = "var(--border-default)";

function SkeletonBars({ widths }: { widths: readonly string[] }) {
  return (
    <>
      {widths.map((width) => (
        <span
          key={width}
          className={`skeleton block h-3 ${width}`}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

function DashboardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {/* KPI strip — deliberately uneven; the real KPIs have unequal weight. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {["h-24", "h-24", "h-24", "h-24"].map((height, index) => (
          <div
            key={height}
            className="rounded-xl border p-4"
            style={{ background: PANEL_SURFACE, borderColor: PANEL_BORDER }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className={`skeleton block h-7 w-20`} />
              {index === 0 && <span className="skeleton block h-3 w-10" />}
            </div>
            <span className="skeleton mt-3 block h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Due-today list — the density an institute actually scans. */}
      <div
        className="rounded-xl border p-5"
        style={{ background: PANEL_SURFACE, borderColor: PANEL_BORDER }}
      >
        <span className="skeleton block h-4 w-36" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: rows }, (_, rowIndex) => (
            <div
              key={rowIndex}
              className="flex items-center justify-between gap-4 border-t pt-3"
              style={{ borderColor: PANEL_BORDER, borderTopWidth: 1 }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <SkeletonBars
                  widths={[
                    DUE_ROW_WIDTHS[rowIndex % DUE_ROW_WIDTHS.length],
                    "w-16",
                  ]}
                />
              </span>
              <span className="skeleton block h-3 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Activity feed — narrower, lower contrast: it is context, not the task. */}
      <div
        className="rounded-xl border p-5"
        style={{ background: PANEL_SURFACE, borderColor: PANEL_BORDER }}
      >
        <span className="skeleton block h-4 w-28" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={FEED_WIDTHS[index]}
              className={`skeleton block h-3 ${FEED_WIDTHS[index]}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RosterSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {/* Toolbar: search well + two filters, matching the master list header. */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="h-10 flex-1 rounded-lg"
          style={{
            background: "var(--surface-inset)",
            border: `1px solid ${PANEL_BORDER}`,
          }}
        />
        <span className="skeleton h-10 w-28 rounded-lg" />
        <span className="skeleton h-10 w-24 rounded-lg" />
      </div>

      {/* Dense roster rows: six columns, the density P8 asks for. */}
      <div
        className="overflow-hidden rounded-xl border"
        style={{ background: PANEL_SURFACE, borderColor: PANEL_BORDER }}
      >
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
            style={{ borderColor: PANEL_BORDER, borderBottomWidth: 1 }}
          >
            <SkeletonBars widths={ROSTER_COLUMN_WIDTHS} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          {/* Label above the well — the settings-section arrangement. */}
          <span className="skeleton block h-3 w-28" />
          <span
            className="block h-11 w-full rounded-lg"
            style={{
              background: "var(--surface-inset)",
              border: `1px solid ${PANEL_BORDER}`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <div className="flex items-center gap-4">
        <span className="skeleton block size-14 rounded-full" />
        <div className="flex flex-col gap-2">
          <span className="skeleton block h-5 w-44" />
          <span className="skeleton block h-3 w-28" />
        </div>
      </div>
      {/* Definition rows: label left, value right — how identity data reads. */}
      <div
        className="rounded-xl border px-4"
        style={{ background: PANEL_SURFACE, borderColor: PANEL_BORDER }}
      >
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
            style={{ borderColor: PANEL_BORDER, borderBottomWidth: 1 }}
          >
            <span className="skeleton block h-3 w-24" />
            <span className="skeleton block h-3 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Shape-matched loading surface. Renders `role="status"` with a visually hidden
 * status line, so a screen-reader user hears what is arriving instead of
 * silence. Motion is delegated to `.skeleton`, which honours both reduced-motion
 * switches already in globals.css.
 */
export function ScreenSkeleton({
  shape,
  label,
  rows,
  className,
}: ScreenSkeletonProps) {
  const rowCount = rows ?? 5;
  return (
    <div
      role="status"
      aria-live="polite"
      className={className ? `w-full ${className}` : "w-full"}
      style={{ color: "var(--text-secondary)" }}
    >
      <span className="sr-only">Loading… {label}</span>
      {shape === "dashboard" && <DashboardSkeleton rows={rowCount} />}
      {shape === "roster" && <RosterSkeleton rows={rowCount} />}
      {shape === "form" && <FormSkeleton rows={rowCount} />}
      {shape === "detail" && <DetailSkeleton rows={rowCount} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Error
 * ------------------------------------------------------------------ */

/**
 * The one recovery affordance per `AppErrorAction`. Each destination is a route
 * that exists in this app — no invented support addresses, no dead links.
 * (`codebase-design`: one adapter per intent, all satisfying the same interface.)
 */
const RECOVERY: Record<
  AppErrorAction,
  { href: string; label: string; Icon: typeof RefreshCw }
> = {
  retry: { href: "/dashboard", label: "Back to Dashboard", Icon: LayoutDashboard },
  "re-login": { href: "/login", label: "Log in again", Icon: LogIn },
  provision: {
    href: "/signup/provision",
    label: "Set up database",
    Icon: Database,
  },
  contact: { href: "/dashboard", label: "Back to Dashboard", Icon: LayoutDashboard },
};

export interface ErrorStateProps {
  /**
   * A classified failure. Always produced by `toAppErrorState(error)` — the
   * mapper is what guarantees no server text escapes to the browser.
   */
  state: AppErrorState;
  /**
   * What the tutor's data looks like right now, in their words ("Nothing was
   * changed", "Your saved work is untouched"). Required, no default: an error
   * surface that cannot state its data status is exactly the silent failure
   * AGENTS.md §2 Rule 9 forbids.
   */
  dataStatus: string;
  /** Re-runs the failed work: `unstable_retry()` on a route, `refetch()` on a query. */
  onRetry?: () => void;
  /** True while the retry is in flight — disables the control against double submits. */
  isRetrying?: boolean;
  /** Overrides the retry control's label. */
  retryLabel?: string;
  className?: string;
}

/**
 * Severity of the dead end. `danger` is a failure of the app's data path;
 * `neutral` is a wrong or stale address, where a red alarm would over-signal —
 * nothing is at risk. Either way the icon AND the title carry the meaning, so
 * colour is never the only signal (AGENTS.md §2 Rule 10).
 */
type StateTone = "danger" | "neutral";

const TONE_COLOR: Record<StateTone, string> = {
  danger: "var(--danger)",
  neutral: "var(--accent-primary)",
};

/** Shared shell for every dead-end surface: one border, one radius, one rhythm. */
function StateFrame({
  icon,
  title,
  tone,
  children,
  className,
  role,
}: {
  icon: ReactNode;
  title: string;
  tone: StateTone;
  children: ReactNode;
  className?: string;
  role: "alert" | "status";
}) {
  const toneColor = TONE_COLOR[tone];
  return (
    <div
      role={role}
      className={
        className
          ? `flex flex-col items-start gap-4 rounded-xl border p-6 md:p-8 ${className}`
          : "flex flex-col items-start gap-4 rounded-xl border p-6 md:p-8"
      }
      style={{
        background: PANEL_SURFACE,
        color: "var(--text-primary)",
        borderColor: PANEL_BORDER,
        // Offset + soft blur, never a zero-offset coloured halo (craft floor).
        boxShadow: "0 1px 2px rgba(0,0,0,0.16), 0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in srgb, ${toneColor} 14%, transparent)`,
          color: toneColor,
        }}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <h2
          className="text-lg font-semibold text-balance"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * The single error surface for the app: a route `error.tsx` boundary and a
 * failed query both render this, so the tutor gets identical behaviour and
 * identical wording wherever the failure happens.
 */
export function ErrorState({
  state,
  dataStatus,
  onRetry,
  isRetrying = false,
  retryLabel,
  className,
}: ErrorStateProps) {
  const recovery = RECOVERY[state.action];
  const RecoveryIcon = recovery.Icon;

  return (
    <StateFrame
      role="alert"
      tone="danger"
      icon={<AlertTriangle className="size-5" />}
      title={state.title}
      className={className}
    >
      <p className="max-w-[68ch] text-sm" style={{ color: "var(--text-secondary)" }}>
        {state.message}
      </p>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {dataStatus}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="neumo-raised inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            // Elevation comes from `.neumo-raised` only — declared once.
            style={{
              background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
              color: "var(--accent-primary)",
            }}
          >
            <RefreshCw
              className={`size-4 shrink-0${isRetrying ? " animate-spin" : ""}`}
            />
            {isRetrying ? "Retrying…" : (retryLabel ?? "Retry")}
          </button>
        )}

        <Link
          href={recovery.href}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-all active:translate-y-px"
          style={{ color: "var(--text-primary)", borderColor: PANEL_BORDER }}
        >
          <RecoveryIcon className="size-4 shrink-0" />
          {recovery.label}
        </Link>
      </div>
    </StateFrame>
  );
}

/**
 * Dead link. Separate from `ErrorState` on purpose: `AppErrorState.NOT_FOUND`
 * describes a *record* ("Student not found or was deleted"), which is a lie
 * about a URL that simply does not exist. Reusing the frame keeps the
 * vocabulary consistent without borrowing the wrong sentence.
 */
export function NotFoundState({ className }: { className?: string }) {
  return (
    <StateFrame
      role="alert"
      tone="neutral"
      icon={<LayoutDashboard className="size-5" />}
      title="That screen doesn't exist"
      className={className}
    >
      <p className="max-w-[68ch] text-sm" style={{ color: "var(--text-secondary)" }}>
        The link may be out of date, or the address may have a typo. Nothing on
        your account was changed.
      </p>
      <Link
        href="/dashboard"
        className="neumo-raised mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all active:translate-y-px"
        style={{
          background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
          color: "var(--accent-primary)",
        }}
      >
        <LayoutDashboard className="size-4 shrink-0" />
        Go to Dashboard
      </Link>
    </StateFrame>
  );
}