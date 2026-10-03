// Implements: docs/design/overhaul-plan.md §4.2 — "Export requests: the
// zip-and-mail flow. Admin sees metadata only (filename, size, SHA-256,
// expiry, state). Delivery is a signed, expiring link; the artefact is never
// stored in the app and never rendered in the UI. Temp download window is
// visible to the user in the app."
//
// The hard boundary for owner rule 3. This page renders five fields: filename,
// size, digest, window expiry and state. It has no download control, no signed
// link, no byte range and no viewer, because the repository interface it calls
// has no method that could return one. Revoking a link is the only write here,
// and revoking destroys the URL at the storage layer rather than hiding it.

import { adminAudit } from "../../_lib/audit";
import { currentAdminIdentity } from "../../_lib/auth";
import { exportRequests, exportStateSentence, pendingExports } from "../../_lib/exports";
import { subscriptions } from "../../_lib/subscriptions";
import { requestExportAction, revokeExportAction } from "../../actions";
import { errorSentence, formatBytes, formatDateTime, readErrorCode, readNoticeText, windowSentence } from "../../_lib/format";
import { DEFAULT_REMINDER_POLICY } from "../../_lib/reminders";
import { AdminPageHeader, DataTable, EmptyState, Notice, StatusTag } from "../../_lib/ui";
import type { Tone } from "../../_lib/ui";

const STATE_TONE = {
  queued: "info",
  packaging: "info",
  mailed: "ok",
  downloaded: "neutral",
  expired: "warn",
} as const satisfies Readonly<Record<string, Tone>>;

export default async function AdminExportsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly notice?: string; readonly error?: string; readonly detail?: string }>;
}) {
  const admin = await currentAdminIdentity();
  const params = await searchParams;
  const nowIso = new Date().toISOString();

  const rows = await exportRequests().list(nowIso);
  const subscriptionRows = await subscriptions().list({}, nowIso);

  await adminAudit({
    actor: admin.email,
    action: "admin.exports.view",
    refType: "export_request",
    metadata: { view: "list", rows: rows.length, live: pendingExports(rows).length },
  });

  const notice = readNoticeText(params.notice);
  const error = readErrorCode(params.error);
  const detail = params.detail ?? null;

  return (
    <>
      <AdminPageHeader
        title="Exports"
        lede="The zip-and-mail flow. What an admin sees is the metadata of the request: name, size, digest, window and state. The archive is never held, served or rendered here, and the signed link lives at the storage layer only."
      />

      {notice === null ? null : <Notice text={notice} />}
      {error === null ? null : <Notice code="bad" text={errorSentence(error, detail)} />}

      <DataTable
        caption="Export request metadata. No artefact and no download link is available in this console."
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          {
            header: "Request",
            cell: (row) => (
              <span className="adm-cell-id">
                <span>{row.id}</span>
                <span className="adm-cell-sub">{row.filename}</span>
              </span>
            ),
          },
          {
            header: "Tenant",
            cell: (row) => (
              <span className="adm-cell-id">
                <span>{row.tenantId}</span>
                <span className="adm-cell-sub">
                  {subscriptionRows.find((item) => item.tenantId === row.tenantId)?.instituteLabel ?? "no contract"}
                </span>
              </span>
            ),
          },
          {
            header: "State",
            cell: (row) => <StatusTag tone={STATE_TONE[row.state]}>{exportStateSentence(row, nowIso)}</StatusTag>,
          },
          { header: "Size", numeric: true, cell: (row) => formatBytes(row.sizeBytes) },
          {
            header: "SHA-256",
            cell: (row) =>
              row.sha256 === null ? (
                <span className="adm-cell-sub">not computed</span>
              ) : (
                <code className="adm-mono">{row.sha256}</code>
              ),
          },
          {
            header: "Window",
            cell: (row) => {
              const remaining = windowSentence(row.linkExpiresAt, nowIso);
              return (
                <span className="adm-cell-id">
                  <span>{remaining ?? "not yet issued"}</span>
                  <span className="adm-cell-sub">{row.windowHours} hours from mailing</span>
                </span>
              );
            },
          },
          { header: "Requested", cell: (row) => formatDateTime(row.requestedAt) },
          {
            header: "Link",
            cell: (row) =>
              row.state === "queued" || row.state === "packaging" || row.state === "expired" ? (
                <span className="adm-cell-sub">no live link</span>
              ) : (
                <form className="adm-inline" method="post" action={revokeExportAction}>
                  <input type="hidden" name="exportId" value={row.id} />
                  <button className="adm-btn-quiet" type="submit" aria-label={`Revoke the download link for ${row.id}`}>
                    Revoke
                  </button>
                </form>
              ),
          },
        ]}
        empty={
          <EmptyState
            title="No export has ever been requested"
            body="A request is raised after a downgrade, when the tenant's archive is zipped and mailed. Until then there is nothing here to review."
          />
        }
      />

      <h2 className="adm-h2">Raise an export request</h2>
      <div className="panel">
        <div className="adm-aside-body">
          <p className="adm-prose">
            Requesting an export tells the entitlement engine to package the account and mail the archive with a
            signed link. The console does not package anything, and it never sees the result.
          </p>
          <form className="adm-filters" method="post" action={requestExportAction} style={{ marginTop: "0.875rem" }}>
            <div className="adm-field adm-field-grow">
              <label className="field-label" htmlFor="export-tenant">
                Tenant id
              </label>
              <input className="input" id="export-tenant" name="tenantId" type="text" list="tenant-ids" required />
              <datalist id="tenant-ids">
                {subscriptionRows.map((row) => (
                  <option key={row.tenantId} value={row.tenantId}>
                    {row.instituteLabel}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="adm-field">
              <label className="field-label" htmlFor="export-window">
                Window (hours)
              </label>
              <input
                className="input"
                id="export-window"
                name="windowHours"
                type="number"
                min={1}
                max={720}
                step={1}
                defaultValue={DEFAULT_REMINDER_POLICY.exportWindowHours}
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Queue export
            </button>
          </form>
          <p className="adm-inline-note" style={{ marginTop: "0.5rem", maxWidth: "68ch" }}>
            The request is audited the moment it is queued. The size and the digest stay blank until the engine has
            actually packed the archive; this console never invents them.
          </p>
        </div>
      </div>
    </>
  );
}