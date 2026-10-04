// Implements: docs/design/overhaul-plan.md §4.2 — "Reminder policy: gentle ->
// 1 hard -> downgrade to free + access removal; each transition audited."
//
// The console records the stage and audits the move. It does not send mail, zip
// a database or withdraw a grant: those are the entitlement engine's jobs and
// they need the plan's §8#1 security review. The stage machine in
// `_lib/reminders.ts` is the contract both sides implement, so the engine's
// scheduler and this page can never disagree about which step is next.

import { adminAudit } from "../../_lib/audit";
import { currentAdminIdentity } from "../../_lib/auth";
import { subscriptions } from "../../_lib/subscriptions";
import { DEFAULT_REMINDER_POLICY, evaluateDueReminders, reminderDue, reminders } from "../../_lib/reminders";
import { advanceReminderAction } from "../../actions";
import { errorSentence, formatDate, formatDateTime, readErrorCode, readNoticeText } from "../../_lib/format";
import { ADMIN_NOTICE_TEXT, PLAN_LABEL, REMINDER_ADVANCE_LABEL, REMINDER_STAGE_LABEL } from "../../_lib/types";
import type { ReminderAdvance } from "../../_lib/types";
import { AdminPageHeader, DataTable, EmptyState, KeyValues, Notice, REMINDER_STAGE_TONE, StatusTag } from "../../_lib/ui";
import type { Tone } from "../../_lib/ui";

const ADVANCE_TONE: Readonly<Record<ReminderAdvance, Tone>> = {
  gentle: "info",
  hard: "warn",
  downgrade: "bad",
};

export default async function AdminRemindersPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly notice?: string; readonly error?: string; readonly detail?: string }>;
}) {
  const admin = await currentAdminIdentity();
  const params = await searchParams;
  const nowIso = new Date().toISOString();

  const schedule = await reminders().list(nowIso);
  const subscriptionRows = await subscriptions().list({}, nowIso);

  await adminAudit({
    actor: admin.email,
    action: "admin.reminders.view",
    refType: "reminder",
    metadata: { view: "policy-and-schedule", rows: schedule.length, hardReminderCount: DEFAULT_REMINDER_POLICY.hardReminderCount },
  });

  const notice = readNoticeText(params.notice);
  const error = readErrorCode(params.error);
  const detail = params.detail ?? null;

  const ladder = schedule.map((scheduleRow) => {
    const subscription = subscriptionRows.find((candidate) => candidate.tenantId === scheduleRow.tenantId) ?? null;
    const due =
      subscription === null
        ? null
        : reminderDue(
            { tenantId: subscription.tenantId, status: subscription.status, expiresOn: subscription.expiresOn },
            scheduleRow.stage,
            nowIso,
          );
    return { scheduleRow, subscription, due };
  });

  const owed = (() => {
    // The dry run the engine's tick calls: pure, no writes, no mail. The
    // "Take the next step" table renders exactly what it returns, so this
    // console, the JSON dry-run endpoint and the future scheduler can never
    // disagree about what is owed.
    const inputs = schedule.flatMap((scheduleRow) => {
      const subscription = subscriptionRows.find((candidate) => candidate.tenantId === scheduleRow.tenantId);
      if (subscription === undefined) return [];
      return [
        {
          tenantId: scheduleRow.tenantId,
          status: subscription.status,
          expiresOn: subscription.expiresOn,
          stage: scheduleRow.stage,
        },
      ];
    });
    const byTenant = new Map(schedule.map((scheduleRow) => [scheduleRow.tenantId, scheduleRow] as const));
    return evaluateDueReminders(inputs, nowIso).flatMap((due) => {
      const scheduleRow = byTenant.get(due.tenantId);
      const next = due.nextAdvance;
      if (scheduleRow === undefined || next === null) return [];
      return [{ scheduleRow, due: { ...due, nextAdvance: next } }];
    });
  })();

  return (
    <>
      <AdminPageHeader
        title="Reminders"
        lede="The non-payment lifecycle. Gentle reminders, then exactly one hard reminder, then access removed and the account shifted to free, then the archive is zipped and mailed with a temporary window."
      />

      {notice === null ? null : <Notice text={notice} />}
      {error === null ? null : <Notice code="bad" text={errorSentence(error, detail)} />}

      <h2 className="adm-h2">Policy</h2>
      <div className="panel">
        <div className="adm-aside-body">
          <KeyValues
            items={[
              { term: "Gentle reminder", value: `${DEFAULT_REMINDER_POLICY.gentleAfterDays} days after expiry` },
              { term: "Hard reminder", value: `${DEFAULT_REMINDER_POLICY.hardAfterDays} days after expiry, sent ${DEFAULT_REMINDER_POLICY.hardReminderCount} time only` },
              { term: "Grace before downgrade", value: `${DEFAULT_REMINDER_POLICY.graceDaysBeforeDowngrade} days after the hard reminder` },
              { term: "Export window", value: `${DEFAULT_REMINDER_POLICY.exportWindowHours} hours from mailing` },
            ]}
          />
          <p className="adm-inline-note" style={{ marginTop: "0.75rem", maxWidth: "68ch" }}>
            The hard reminder count is fixed at one and cannot be raised from this console. It is a product rule, not a
            setting. Recording a second hard reminder is refused by the state machine.
          </p>
        </div>
      </div>

      <h2 className="adm-h2">Schedule</h2>
      <div className="adm-split">
        <DataTable
          caption="Reminder ladder state per tenant"
          rows={ladder}
          rowKey={(row) => row.scheduleRow.tenantId}
          columns={[
            {
              header: "Tenant",
              cell: (row) => (
                <span className="adm-cell-id">
                  <a className="adm-row-link" href={`/admin/subscriptions?tenant=${row.scheduleRow.tenantId}`}>
                    {row.scheduleRow.tenantId}
                  </a>
                  <span className="adm-cell-sub">
                    {row.subscription === null
                      ? "no contract"
                      : `${PLAN_LABEL[row.subscription.plan]}, expires ${formatDate(row.subscription.expiresOn)}`}
                  </span>
                </span>
              ),
            },
            { header: "Stage", cell: (row) => <StatusTag tone={REMINDER_STAGE_TONE[row.scheduleRow.stage]}>{REMINDER_STAGE_LABEL[row.scheduleRow.stage]}</StatusTag> },
            {
              header: "Gentle sent",
              cell: (row) => (row.scheduleRow.gentleSentAt === null ? "not sent" : formatDateTime(row.scheduleRow.gentleSentAt)),
            },
            {
              header: "Hard sent",
              cell: (row) => (row.scheduleRow.hardSentAt === null ? "not sent" : formatDateTime(row.scheduleRow.hardSentAt)),
            },
            {
              header: "Export",
              cell: (row) => (row.scheduleRow.exportRequestId ?? "not raised"),
            },
            { header: "Where it stands", cell: (row) => row.due?.reason ?? "unknown" },
          ]}
          empty={
            <EmptyState
              title="No tenant is on the ladder"
              body="Every account gets a row here. A tenant only becomes due once its contract has passed the expiry date."
            />
          }
        />

        <div className="adm-aside">
          <section className="panel">
            <div className="adm-aside-body">
              <h2 className="adm-aside-title">Take the next step</h2>
              <p className="adm-state-body">
                The ladder only moves forward, and only one step at a time. Each button below writes the new stage and
                audits it with your address.
              </p>
              <div style={{ marginTop: "0.75rem" }}>
                <DataTable
                  caption="Tenants with a reminder step owed"
                  rows={owed}
                  rowKey={(row) => row.scheduleRow.tenantId}
                  columns={[
                    {
                      header: "Tenant",
                      cell: (row) => (
                        <span className="adm-cell-id">
                          <span>{row.scheduleRow.tenantId}</span>
                          <span className="adm-cell-sub">{REMINDER_ADVANCE_LABEL[row.due.nextAdvance]}</span>
                        </span>
                      ),
                    },
                    {
                      header: "Advance",
                      cell: (row) => {
                        const next = row.due.nextAdvance;
                        return (
                          <form method="post" action={advanceReminderAction}>
                            <input type="hidden" name="tenantId" value={row.scheduleRow.tenantId} />
                            <input type="hidden" name="advance" value={next} />
                            <button
                              className="adm-btn-quiet"
                              type="submit"
                              aria-label={`${REMINDER_ADVANCE_LABEL[next]} for ${row.scheduleRow.tenantId}`}
                            >
                              <StatusTag tone={ADVANCE_TONE[next]}>{REMINDER_ADVANCE_LABEL[next]}</StatusTag>
                            </button>
                          </form>
                        );
                      },
                    },
                  ]}
                  empty={
                    <EmptyState
                      title="Nothing is owed"
                      body="No contract has passed its expiry date far enough for a reminder to be due."
                    />
                  }
                />
              </div>
              <p className="adm-inline-note" style={{ marginTop: "0.75rem", maxWidth: "68ch" }}>
                Recording a step does not send the mail or change a grant. {ADMIN_NOTICE_TEXT["reminder-advanced"]}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}