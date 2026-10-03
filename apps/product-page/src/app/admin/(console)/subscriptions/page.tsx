// Implements: docs/design/overhaul-plan.md §4.2 — "Subscriptions: plan
// (free/...), period (monthly/quarterly/annual), status
// (trialing/active/past-due/cancelled), start/expiry dates. Admin-managed,
// which matches settings.plan being server-managed and denylisted in the web
// app."
//
// Filters are a GET form, selection is a query parameter, and the edit form is a
// POST server action. No client JavaScript, no fetch, no modal. The selection
// survives a reload and can be linked to, which is what an operator comparing a
// contract with its grants needs.
//
// The detail panel reads contract metadata and nothing else. There is no code
// path from this page to a tenant's database (owner rule 3).

import Link from "next/link";
import { adminAudit } from "../../_lib/audit";
import { currentAdminIdentity } from "../../_lib/auth";
import {
  isBillingPeriod,
  isPlanId,
  isSubscriptionStatus,
  remainingDays,
  subscriptions,
  subscriptionStatusSentence,
} from "../../_lib/subscriptions";
import { entitlements } from "../../_lib/entitlements";
import { reminders } from "../../_lib/reminders";
import { updateSubscriptionAction } from "../../actions";
import { daysFromToday, errorSentence, formatDate, readErrorCode, readNoticeText } from "../../_lib/format";
import {
  BILLING_PERIODS,
  PERIOD_LABEL,
  PLAN_IDS,
  PLAN_LABEL,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABEL,
} from "../../_lib/types";
import type { SubscriptionStatus } from "../../_lib/types";
import { AdminPageHeader, DataTable, EmptyState, ErrorState, FilterField, KeyValues, Notice, StatusTag } from "../../_lib/ui";
import type { Tone } from "../../_lib/ui";

const STATUS_TONE: Readonly<Record<SubscriptionStatus, Tone>> = {
  trialing: "info",
  active: "ok",
  "past-due": "warn",
  cancelled: "neutral",
};

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly plan?: string;
    readonly period?: string;
    readonly status?: string;
    readonly q?: string;
    readonly tenant?: string;
    readonly notice?: string;
    readonly error?: string;
    readonly detail?: string;
  }>;
}) {
  const admin = await currentAdminIdentity();
  const params = await searchParams;
  const nowIso = new Date().toISOString();

  const plan = params.plan !== undefined && isPlanId(params.plan) ? params.plan : undefined;
  const period = params.period !== undefined && isBillingPeriod(params.period) ? params.period : undefined;
  const status = params.status !== undefined && isSubscriptionStatus(params.status) ? params.status : undefined;
  const query = params.q ?? "";

  const rows = await subscriptions().list({ plan, period, status, query }, nowIso);

  await adminAudit({
    actor: admin.email,
    action: "admin.subscriptions.view",
    refType: "subscription",
    metadata: {
      view: "list",
      rows: rows.length,
      filter: { plan: plan ?? null, period: period ?? null, status: status ?? null, query: query.length > 0 },
    },
  });

  const selected = params.tenant === undefined ? null : await subscriptions().get(params.tenant);
  const notice = readNoticeText(params.notice);
  const error = readErrorCode(params.error);
  const detail = params.detail ?? null;

  return (
    <>
      <AdminPageHeader
        title="Subscriptions"
        lede="Every prepaid contract, contracted by hand. The console records plan, period, status and dates. There is no amount here and no payment step, because this product processes no payments."
      />

      {notice === null ? null : <Notice text={notice} />}
      {error === null ? null : <Notice code="bad" text={errorSentence(error, detail)} />}

      <form className="adm-filters" method="get" action="/admin/subscriptions">
        <FilterField label="Plan" name="plan">
          <select className="input" id="plan" name="plan" defaultValue={plan ?? ""}>
            <option value="">All plans</option>
            {PLAN_IDS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {PLAN_LABEL[candidate]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Period" name="period">
          <select className="input" id="period" name="period" defaultValue={period ?? ""}>
            <option value="">All periods</option>
            {BILLING_PERIODS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {PERIOD_LABEL[candidate]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status" name="status">
          <select className="input" id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {SUBSCRIPTION_STATUSES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {SUBSCRIPTION_STATUS_LABEL[candidate]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Search" name="q" grow>
          <input className="input" id="q" name="q" type="search" defaultValue={query} placeholder="Tenant id, institute or contact" />
        </FilterField>
        <button className="btn btn-secondary" type="submit">
          Apply
        </button>
        <Link className="btn btn-secondary" href="/admin/subscriptions">
          Reset
        </Link>
      </form>

      <div className="adm-split" style={{ marginTop: "1rem" }}>
        <DataTable
          caption="Prepaid contracts, soonest expiry first"
          rows={rows}
          rowKey={(row) => row.tenantId}
          currentKey={selected?.tenantId ?? null}
          columns={[
            {
              header: "Institute",
              cell: (row) => (
                <span className="adm-cell-id">
                  <a className="adm-row-link" href={`/admin/subscriptions?tenant=${row.tenantId}`} aria-current={selected?.tenantId === row.tenantId ? "true" : undefined}>
                    {row.instituteLabel}
                  </a>
                  <span className="adm-cell-sub">{row.tenantId}</span>
                </span>
              ),
            },
            { header: "Plan", cell: (row) => PLAN_LABEL[row.plan] },
            { header: "Period", cell: (row) => PERIOD_LABEL[row.period] },
            { header: "Status", cell: (row) => <StatusTag tone={STATUS_TONE[row.status]}>{SUBSCRIPTION_STATUS_LABEL[row.status]}</StatusTag> },
            { header: "Starts", cell: (row) => formatDate(row.startsOn) },
            {
              header: "Expires",
              numeric: true,
              cell: (row) => {
                const days = remainingDays(row, nowIso);
                return (
                  <span className="adm-cell-id">
                    <span>{formatDate(row.expiresOn)}</span>
                    <span className="adm-cell-sub">
                      {days >= 0 ? `${days} days left` : `${Math.abs(days)} days past`}
                    </span>
                  </span>
                );
              },
            },
          ]}
          empty={
            <EmptyState
              title="No contract matches this filter"
              body="Widen the plan, period or status filter, or clear the search box. A contract is created by hand from an access request on the product page, not by anything in this console."
            />
          }
        />

        <div className="adm-aside">
          {selected === null ? (
            <section className="panel">
              <div className="adm-aside-body">
                <h2 className="adm-aside-title">No contract selected</h2>
                <p className="adm-state-body">
                  Pick a row to see its full contract and change plan, period, status or dates. Selecting a row only
                  changes the address bar, so the view can be linked to and reloaded safely.
                </p>
              </div>
            </section>
          ) : (
            <SubscriptionDetail tenantId={selected.tenantId} />
          )}
        </div>
      </div>
    </>
  );
}

async function SubscriptionDetail({ tenantId }: { readonly tenantId: string }) {
  const nowIso = new Date().toISOString();
  const row = await subscriptions().get(tenantId);
  if (row === null) {
    return (
      <ErrorState
        title="That contract is gone"
        body="The row was not found. Reload the list and pick another contract."
      />
    );
  }

  const entitlementRow = await entitlements().get(tenantId);
  const scheduleRow = await reminders().get(tenantId);
  const grants = entitlementRow?.infrastructure ?? null;
  const enabledFlags =
    entitlementRow === null
      ? []
      : Object.entries(entitlementRow.flags)
          .filter(([, on]) => on)
          .map(([flag]) => flag);

  return (
    <>
      <section className="panel">
        <div className="adm-aside-body">
          <h2 className="adm-aside-title">{row.instituteLabel}</h2>
          <KeyValues
            items={[
              { term: "Tenant id", value: <span className="adm-mono">{row.tenantId}</span> },
              { term: "Contact", value: row.contactEmail },
              { term: "Status", value: <StatusTag tone={STATUS_TONE[row.status]}>{subscriptionStatusSentence(row, nowIso)}</StatusTag> },
              { term: "Term", value: `${PLAN_LABEL[row.plan]}, ${PERIOD_LABEL[row.period].toLowerCase()}` },
              { term: "Contracted by", value: row.contractedBy },
              { term: "Access flags on", value: enabledFlags.length === 0 ? "none" : enabledFlags.join(", ") },
              { term: "Storage quota", value: grants === null ? "unknown" : `${grants.storageQuotaMb} MB` },
              { term: "Reminder stage", value: scheduleRow?.stage ?? "unknown" },
            ]}
          />
          <p className="adm-inline-note" style={{ marginTop: "0.75rem" }}>
            {row.adminNote.length === 0 ? "No operational note." : row.adminNote}
          </p>
          <p className="adm-inline-note" style={{ marginTop: "0.5rem" }}>
            Contract metadata only. This console has no reader for a tenant&apos;s students, ledger or files.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="adm-aside-body">
          <h2 className="adm-aside-title">Change the contract</h2>
          <form className="adm-signin-form" method="post" action={updateSubscriptionAction}>
            <input type="hidden" name="tenantId" value={row.tenantId} />
            <div>
              <label className="field-label" htmlFor="edit-plan">
                Plan
              </label>
              <select className="input" id="edit-plan" name="plan" defaultValue={row.plan}>
                {PLAN_IDS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {PLAN_LABEL[candidate]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="edit-period">
                Period
              </label>
              <select className="input" id="edit-period" name="period" defaultValue={row.period}>
                {BILLING_PERIODS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {PERIOD_LABEL[candidate]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="edit-status">
                Status
              </label>
              <select className="input" id="edit-status" name="status" defaultValue={row.status}>
                {SUBSCRIPTION_STATUSES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {SUBSCRIPTION_STATUS_LABEL[candidate]}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-inline">
              <div>
                <label className="field-label" htmlFor="edit-starts">
                  Starts
                </label>
                <input className="input" id="edit-starts" name="startsOn" type="date" defaultValue={row.startsOn} />
              </div>
              <div>
                <label className="field-label" htmlFor="edit-expires">
                  Expires
                </label>
                <input className="input" id="edit-expires" name="expiresOn" type="date" defaultValue={row.expiresOn} />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="edit-note">
                Operational note
              </label>
              <input className="input" id="edit-note" name="adminNote" type="text" defaultValue={row.adminNote} maxLength={500} />
              <p className="field-hint">Visible to admins only. Never write tenant content here.</p>
            </div>
            <button className="btn btn-primary" type="submit">
              Save contract
            </button>
            <p className="adm-inline-note">
              {daysFromToday(row.expiresOn, nowIso) < 0
                ? `The expiry date passed ${Math.abs(daysFromToday(row.expiresOn, nowIso))} days ago.`
                : `${daysFromToday(row.expiresOn, nowIso)} days remain on this term.`}{" "}
              The change and your address are written to the audit log.
            </p>
          </form>
        </div>
      </section>
    </>
  );
}