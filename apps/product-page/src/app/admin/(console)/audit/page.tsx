// Implements: docs/design/overhaul-plan.md §4.2 — "Audit log: every admin
// action, filterable, exportable."
//
// The audit log is read as carefully as it is written, so reading it is itself
// audited. That is deliberate: an unlogged read is exactly the gap an attacker
// would want.
//
// Exportability, without a data-export feature: the console ships a CSV of this
// page's own rows as a `data:` URL the operator can save, and it contains audit
// metadata only. Building a downloadable artefact in the browser keeps the Rule 2
// network allowlist closed: nothing leaves the page.

import { adminAudit, adminAuditList, parseAuditMetadata } from "../../_lib/audit";
import { currentAdminIdentity } from "../../_lib/auth";
import { errorSentence, formatDateTime, readErrorCode } from "../../_lib/format";
import { AdminPageHeader, DataTable, EmptyState, FilterField, Notice, StatusTag } from "../../_lib/ui";
import type { Column } from "../../_lib/ui";

const ACTIONS = [
  "admin.sign_in",
  "admin.sign_in_denied",
  "admin.sign_out",
  "admin.access_request.received",
  "admin.access_request.view",
  "admin.access_request.state_set",
  "admin.subscriptions.view",
  "admin.subscription.update",
  "admin.entitlements.view",
  "admin.entitlement.flag_set",
  "admin.entitlement.grant_set",
  "admin.entitlement.downgrade",
  "admin.exports.view",
  "admin.export.request",
  "admin.export.advance",
  "admin.export.revoke",
  "admin.reminders.view",
  "admin.reminder.evaluated",
  "admin.reminder.advance",
  "admin.audit.view",
] as const;

type AuditAction = (typeof ACTIONS)[number];

const READ_ACTIONS: ReadonlySet<string> = new Set<string>([
  "admin.subscriptions.view",
  "admin.entitlements.view",
  "admin.exports.view",
  "admin.reminders.view",
  "admin.audit.view",
  "admin.sign_in",
  "admin.sign_out",
]);

function isAuditAction(value: string | undefined): value is AuditAction {
  return value !== undefined && (ACTIONS as readonly string[]).includes(value);
}

const ROW_LIMIT = 200;

/** Metadata is data, so every value is rendered as text. Nothing is executed. */
function metadataCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function toCsv(rows: ReadonlyArray<{ readonly at: string; readonly actor: string; readonly action: string; readonly ref: string }>): string {
  const header = "created_at,actor,action,ref";
  const lines = rows.map((row) => `"${row.at}","${row.actor}","${row.action}","${row.ref}"`);
  return [header, ...lines].join("\n");
}

export default async function AdminAuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly action?: string;
    readonly ref?: string;
    readonly error?: string;
    readonly detail?: string;
  }>;
}) {
  const admin = await currentAdminIdentity();
  const params = await searchParams;

  const action = isAuditAction(params.action) ? params.action : undefined;
  const ref = params.ref === undefined || params.ref.length === 0 ? undefined : params.ref;

  const rows = await adminAuditList({ action, refId: ref, limit: ROW_LIMIT });

  await adminAudit({
    actor: admin.email,
    action: "admin.audit.view",
    refType: "audit_log",
    metadata: { view: "list", rows: rows.length, action: action ?? null, refId: ref ?? null },
  });

  const error = readErrorCode(params.error);
  const detail = params.detail ?? null;

  const columns: ReadonlyArray<Column<(typeof rows)[number]>> = [
    { header: "When", cell: (row) => formatDateTime(row.createdAt) },
    { header: "Actor", cell: (row) => row.actor },
    {
      header: "Action",
      cell: (row) => (
        <StatusTag tone={READ_ACTIONS.has(row.action) ? "info" : "warn"}>
          {READ_ACTIONS.has(row.action) ? `${row.action} (read)` : row.action}
        </StatusTag>
      ),
    },
    { header: "Ref", cell: (row) => row.refId ?? "not applicable" },
    {
      header: "Metadata",
      cell: (row) => {
        const parsed = parseAuditMetadata(row);
        const pairs = Object.entries(parsed);
        if (pairs.length === 0) return <span className="adm-cell-sub">none</span>;
        return (
          <span className="adm-cell-id">
            {pairs.map(([key, value]) => (
              <span key={key} className="adm-cell-sub">
                {key}: {metadataCell(value)}
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  const csv = toCsv(
    rows.map((row) => ({ at: row.createdAt, actor: row.actor, action: row.action, ref: row.refId ?? "" })),
  );

  return (
    <>
      <AdminPageHeader
        title="Audit"
        lede="Every admin sign-in, every list read and every change. Reads are in the log too, because a read nobody recorded is the gap worth hiding in. Reading this page is itself recorded."
      />

      {error === null ? null : <Notice code="bad" text={errorSentence(error, detail)} />}

      <form className="adm-filters" method="get" action="/admin/audit">
        <FilterField label="Action" name="action">
          <select className="input" id="action" name="action" defaultValue={action ?? ""}>
            <option value="">Every action</option>
            {ACTIONS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Ref" name="ref">
          <input className="input" id="ref" name="ref" type="search" defaultValue={ref ?? ""} placeholder="Tenant id or record id" />
        </FilterField>
        <button className="btn btn-secondary" type="submit">
          Apply
        </button>
        <a className="adm-btn-quiet" href="/admin/audit">
          Reset
        </a>
        {rows.length === 0 ? null : (
          <a className="adm-btn-quiet" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="admin-audit.csv">
            Download these {rows.length} rows as CSV
          </a>
        )}
      </form>

      <div style={{ marginTop: "1rem" }}>
        <DataTable
          caption={`Audit rows, newest first, capped at ${ROW_LIMIT}`}
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          empty={
            <EmptyState
              title="No audit row matches this filter"
              body="Clear the action or ref filter to see the whole trail. A gap here means nothing has been recorded for that combination yet."
            />
          }
        />
      </div>

      <p className="adm-inline-note" style={{ marginTop: "1rem", maxWidth: "68ch" }}>
        Rows are held in memory for the length of the server process in this build. The production sink writes to
        {" "}
        <code className="adm-mono">audit_log</code> through the same interface; see docs/design/admin-console.md.
      </p>
    </>
  );
}