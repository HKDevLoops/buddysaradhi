// Implements: docs/design/overhaul-plan.md §4.2 — the console overview.
//
// Counts by plan and status, contracts expiring soon, reminders due, and export
// requests still pending. Every list read on this page writes an audit row
// before anything is rendered, so "we looked and found nothing" is as auditable
// as "we looked and found something".
//
// Deliberately not a row of big-number cards (craft-floor.md refuses the
// hero-metric template). An operator wants the counts to line up in columns so
// they can compare plan against plan, so they are a dense grid with a real
// caption.
//
// No amounts anywhere. This product takes no payment, so a revenue figure would
// be invented.

import { adminAudit } from "../_lib/audit";
import { currentAdminIdentity } from "../_lib/auth";
import { subscriptions, subscriptionStatusSentence } from "../_lib/subscriptions";
import { exportRequests, pendingExports } from "../_lib/exports";
import { reminders, reminderDue } from "../_lib/reminders";
import { formatDate, windowSentence } from "../_lib/format";
import { PLAN_IDS, PLAN_LABEL, REMINDER_STAGE_LABEL, SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABEL } from "../_lib/types";
import type { SubscriptionStatus } from "../_lib/types";
import { AdminPageHeader, DataTable, EmptyState, REMINDER_STAGE_TONE, StatusTag } from "../_lib/ui";
import type { Tone } from "../_lib/ui";

const EXPIRING_SOON_DAYS = 30;

const STATUS_TONE: Readonly<Record<SubscriptionStatus, Tone>> = {
  trialing: "info",
  active: "ok",
  "past-due": "warn",
  cancelled: "neutral",
};

export default async function AdminOverviewPage() {
  const admin = await currentAdminIdentity();
  const nowIso = new Date().toISOString();

  const allSubscriptions = await subscriptions().list({}, nowIso);
  const expiring = await subscriptions().list({ expiringWithinDays: EXPIRING_SOON_DAYS }, nowIso);
  const schedule = await reminders().list(nowIso);
  const exports = await exportRequests().list(nowIso);

  await adminAudit({
    actor: admin.email,
    action: "admin.subscriptions.view",
    refType: "subscription",
    metadata: { view: "overview", rows: allSubscriptions.length, expiring: expiring.length },
  });
  await adminAudit({
    actor: admin.email,
    action: "admin.reminders.view",
    refType: "reminder",
    metadata: { view: "overview", rows: schedule.length },
  });
  await adminAudit({
    actor: admin.email,
    action: "admin.exports.view",
    refType: "export_request",
    metadata: { view: "overview", rows: exports.length },
  });

  const remindersDue = schedule
    .map((row) => {
      const subscription = allSubscriptions.find((candidate) => candidate.tenantId === row.tenantId);
      if (subscription === undefined) return null;
      return reminderDue(subscription, row.stage, nowIso);
    })
    .filter((row): row is NonNullable<typeof row> => row !== null && row.nextAdvance !== null);

  const pending = pendingExports(exports);

  return (
    <>
      <AdminPageHeader
        title="Overview"
        lede="Every prepaid contract, the grants behind it, and the reminders that are owed. Nothing here is a payment: plans are contracted by hand and the console tracks access, not money."
      />

      <h2 className="adm-h2">Contracts by plan</h2>
      <DataTable
        caption="Contract count for each plan"
        rows={PLAN_IDS.map((plan) => ({ plan, total: allSubscriptions.filter((row) => row.plan === plan).length }))}
        rowKey={(row) => row.plan}
        columns={[
          { header: "Plan", cell: (row) => PLAN_LABEL[row.plan] },
          { header: "Contracts", numeric: true, cell: (row) => row.total },
          {
            header: "Share of book",
            numeric: true,
            cell: (row) =>
              allSubscriptions.length === 0 ? "0%" : `${Math.round((row.total / allSubscriptions.length) * 100)}%`,
          },
        ]}
        empty={<EmptyState title="No contracts yet" body="A contract appears here the moment an admin records one." />}
      />

      <h2 className="adm-h2">Contracts by status</h2>
      <DataTable
        caption="Contract count for each lifecycle status"
        rows={SUBSCRIPTION_STATUSES.map((status) => ({
          status,
          total: allSubscriptions.filter((row) => row.status === status).length,
        }))}
        rowKey={(row) => row.status}
        columns={[
          { header: "Status", cell: (row) => <StatusTag tone={STATUS_TONE[row.status]}>{SUBSCRIPTION_STATUS_LABEL[row.status]}</StatusTag> },
          { header: "Contracts", numeric: true, cell: (row) => row.total },
        ]}
        empty={<EmptyState title="No statuses to report" body="A status appears here once at least one contract carries it." />}
      />

      <h2 className="adm-h2">Expiring within {EXPIRING_SOON_DAYS} days, or already past</h2>
      <DataTable
        caption={`Contracts expiring within ${EXPIRING_SOON_DAYS} days or already expired`}
        rows={expiring}
        rowKey={(row) => row.tenantId}
        columns={[
          {
            header: "Tenant",
            cell: (row) => (
              <span className="adm-cell-id">
                <a className="adm-row-link" href={`/admin/subscriptions?tenant=${row.tenantId}`}>
                  {row.instituteLabel}
                </a>
                <span className="adm-cell-sub">{row.tenantId}</span>
              </span>
            ),
          },
          { header: "Plan", cell: (row) => PLAN_LABEL[row.plan] },
          { header: "Status", cell: (row) => <StatusTag tone={STATUS_TONE[row.status]}>{subscriptionStatusSentence(row, nowIso)}</StatusTag> },
          { header: "Expires", cell: (row) => formatDate(row.expiresOn) },
        ]}
        empty={
          <EmptyState
            title={`Nothing expires in the next ${EXPIRING_SOON_DAYS} days`}
            body="The list fills as contracts approach their expiry date. Nothing is shown here means no renewal conversation is due yet."
          />
        }
      />

      <h2 className="adm-h2">Reminder steps owed</h2>
      <DataTable
        caption="Tenants whose reminder ladder is waiting on an admin"
        rows={remindersDue}
        rowKey={(row) => row.tenantId}
        columns={[
          { header: "Tenant", cell: (row) => row.tenantId },
          { header: "Stage", cell: (row) => <StatusTag tone={REMINDER_STAGE_TONE[row.stage]}>{REMINDER_STAGE_LABEL[row.stage]}</StatusTag> },
          { header: "Days past expiry", numeric: true, cell: (row) => row.daysPastExpiry },
          { header: "Next step", cell: (row) => row.reason },
        ]}
        empty={
          <EmptyState
            title="No reminder is owed"
            body="Gentle reminders go out 14 days after expiry, the single hard reminder 21 days after, and the downgrade 7 days after that."
          />
        }
      />

      <h2 className="adm-h2">Export requests still live</h2>
      <DataTable
        caption="Export requests in queued, packaging or mailed state"
        rows={pending}
        rowKey={(row) => row.id}
        columns={[
          {
            header: "Request",
            cell: (row) => (
              <span className="adm-cell-id">
                <a className="adm-row-link" href="/admin/exports">
                  {row.id}
                </a>
                <span className="adm-cell-sub">{row.filename}</span>
              </span>
            ),
          },
          { header: "State", cell: (row) => row.state },
          { header: "Window", cell: (row) => windowSentence(row.linkExpiresAt, nowIso) ?? "not yet issued" },
        ]}
        empty={
          <EmptyState
            title="No export is in flight"
            body="An export request is raised after a downgrade. The console shows its metadata only; the archive itself never passes through here."
          />
        }
      />
    </>
  );
}