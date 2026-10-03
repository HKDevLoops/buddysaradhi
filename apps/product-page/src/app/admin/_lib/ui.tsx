// Implements: docs/design/overhaul-plan.md §4.2 — the console's shared read-only
// components. Mode: Operate. Server components only; the console ships zero
// client JavaScript, so every control here is a real link, a real form or a
// real input and the whole thing works from the keyboard alone.
//
// Rule 10 (WCAG AA) is enforced in three places in this file: the status tag
// always carries a visible text label so colour is never the only signal
// (AP-14), the grid caption gives every table an accessible name, and the empty
// and error states name the problem and the recovery rather than showing a
// bare "nothing here".

import type { ReactNode } from "react";
import type { ReminderStage } from "./types";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "on" | "off";

/**
 * The one tone map for the reminder ladder
 * (docs/design/overhaul-plan.md §4.2: gentle → one hard reminder → downgrade to
 * free). It lives here, beside `Tone`, because two pages render the same ladder
 * and a ladder whose "hard" stage looks calm on the overview and urgent on its
 * own page is exactly the kind of quiet inconsistency a tone map duplicated in
 * two files produces.
 */
export const REMINDER_STAGE_TONE: Readonly<Record<ReminderStage, Tone>> = {
  none: "neutral",
  "gentle-sent": "info",
  "hard-sent": "warn",
  downgraded: "bad",
};

/**
 * Status pill. The dot is decoration (`aria-hidden`), the label is the signal.
 * Callers must pass a text label, never an empty child.
 */
export function StatusTag({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return (
    <span className={`adm-tag adm-tag-${tone}`}>
      <span className="adm-tag-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export interface Column<T> {
  readonly header: string;
  readonly numeric?: boolean;
  readonly cell: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  /** Accessible name for the grid. Rendered visually hidden by the stylesheet. */
  readonly caption: string;
  readonly columns: ReadonlyArray<Column<T>>;
  readonly rows: ReadonlyArray<T>;
  readonly rowKey: (row: T) => string;
  /** Marks the row the operator has selected. Never the only signal: the cell
   *  that contains the row link also carries `aria-current`. */
  readonly currentKey?: string | null;
  readonly empty: ReactNode;
}

/**
 * A real `<table>`. Native semantics give arrow-key-free but fully keyboard
 * reachable semantics: Tab moves through every link and control in row order,
 * which is what an operator scanning a grant table actually wants.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, currentKey, empty }: DataTableProps<T>) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="adm-scroll">
      <table className="adm-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={column.numeric === true ? "adm-head-num" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr key={key} data-current={key === currentKey ? "true" : undefined}>
                {columns.map((column) => (
                  <td key={column.header} className={column.numeric === true ? "adm-num" : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPageHeader({
  title,
  lede,
  actions,
}: {
  readonly title: string;
  readonly lede: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="adm-head">
      <h1 className="adm-title">{title}</h1>
      <p className="adm-lede">{lede}</p>
      {actions === undefined ? null : <div className="adm-state-actions">{actions}</div>}
    </header>
  );
}

/** An empty state that teaches the surface instead of reporting an absence. */
export function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="adm-state">
      <p className="adm-state-title">{title}</p>
      <p className="adm-state-body">{body}</p>
    </div>
  );
}

/** An error that names the problem and the recovery. Rule 9, on screen. */
export function ErrorState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="adm-state">
      <p className="adm-state-title">{title}</p>
      <p className="adm-state-body">{body}</p>
    </div>
  );
}

export function Notice({ code, text }: { readonly code?: "bad"; readonly text: string }) {
  return (
    <p className={code === "bad" ? "adm-notice adm-notice-bad" : "adm-notice"} role={code === "bad" ? "alert" : "status"}>
      {text}
    </p>
  );
}

export function KeyValues({ items }: { readonly items: ReadonlyArray<{ readonly term: string; readonly value: ReactNode }> }) {
  return (
    <dl className="adm-kv">
      {items.map((item) => (
        <div key={item.term} style={{ display: "contents" }}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FilterField({
  label,
  name,
  children,
  grow,
}: {
  readonly label: string;
  readonly name: string;
  readonly children: ReactNode;
  readonly grow?: boolean;
}) {
  return (
    <div className={grow === true ? "adm-field adm-field-grow" : "adm-field"}>
      <label className="field-label" htmlFor={name}>
        {label}
      </label>
      {children}
    </div>
  );
}