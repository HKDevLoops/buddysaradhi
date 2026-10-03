// Implements: docs/design/overhaul-plan.md §4.2 — "Entitlements + infrastructure
// access: feature flags and backend grants (db provisioned, export allowed,
// storage quota). Infrastructure only."
//
// This is the page that decides whether the backend will serve a tenant. It
// never decides, and never shows, what the tenant has in it. Every toggle on
// this page is a POST server action, writes an audit row, and shows the previous
// value in the audit log so a mistake is traceable.

import Link from "next/link";
import { adminAudit } from "../../_lib/audit";
import { currentAdminIdentity } from "../../_lib/auth";
import { entitlements, isIrreversibleGrant } from "../../_lib/entitlements";
import { subscriptions } from "../../_lib/subscriptions";
import { setFeatureFlagAction, setInfrastructureGrantAction } from "../../actions";
import { errorSentence, formatDateTime, readErrorCode, readNoticeText } from "../../_lib/format";
import {
  BOOLEAN_GRANTS,
  BOOLEAN_GRANT_LABEL,
  FEATURE_FLAGS,
  FEATURE_FLAG_LABEL,
  NUMERIC_GRANTS,
  NUMERIC_GRANT_BOUNDS,
  NUMERIC_GRANT_LABEL,
} from "../../_lib/types";
import { AdminPageHeader, DataTable, EmptyState, FilterField, Notice, StatusTag } from "../../_lib/ui";
import type { Column } from "../../_lib/ui";

export default async function AdminEntitlementsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly tenant?: string;
    readonly q?: string;
    readonly notice?: string;
    readonly error?: string;
    readonly detail?: string;
  }>;
}) {
  const admin = await currentAdminIdentity();
  const params = await searchParams;
  const nowIso = new Date().toISOString();

  const query = params.q ?? "";
  const all = await entitlements().list(nowIso);
  const rows = query.length === 0 ? all : all.filter((row) => row.tenantId.toLowerCase().includes(query.toLowerCase()));
  const subscriptionRows = await subscriptions().list({}, nowIso);

  await adminAudit({
    actor: admin.email,
    action: "admin.entitlements.view",
    refType: "entitlement",
    metadata: { view: "list", rows: rows.length, query: query.length > 0 },
  });

  const notice = readNoticeText(params.notice);
  const error = readErrorCode(params.error);
  const detail = params.detail ?? null;

  const flagColumns: ReadonlyArray<Column<(typeof rows)[number]>> = FEATURE_FLAGS.map((flag) => ({
    header: FEATURE_FLAG_LABEL[flag],
    cell: (row) => (
      <form className="adm-inline" method="post" action={setFeatureFlagAction}>
        <input type="hidden" name="tenantId" value={row.tenantId} />
        <input type="hidden" name="flag" value={flag} />
        <input type="hidden" name="enabled" value={row.flags[flag] ? "0" : "1"} />
        <button className="adm-btn-quiet" type="submit" aria-label={`${row.flags[flag] ? "Revoke" : "Grant"} ${FEATURE_FLAG_LABEL[flag]} for ${row.tenantId}`}>
          <StatusTag tone={row.flags[flag] ? "on" : "off"}>{row.flags[flag] ? "On" : "Off"}</StatusTag>
        </button>
      </form>
    ),
  }));

  return (
    <>
      <AdminPageHeader
        title="Entitlements"
        lede="Feature flags and backend grants, per tenant. These decide whether the backend serves an account. They say nothing about what is inside it, and this console has no reader that could tell it."
      />

      {notice === null ? null : <Notice text={notice} />}
      {error === null ? null : <Notice code="bad" text={errorSentence(error, detail)} />}

      <form className="adm-filters" method="get" action="/admin/entitlements">
        <FilterField label="Tenant id" name="q" grow>
          <input className="input" id="q" name="q" type="search" defaultValue={query} placeholder="t-0001" />
        </FilterField>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
        <Link className="btn btn-secondary" href="/admin/entitlements">
          Show all
        </Link>
      </form>

      <div style={{ marginTop: "1rem" }}>
        <DataTable
          caption="Feature flags per tenant. Each control writes an audit row recording the previous value."
          rows={rows}
          rowKey={(row) => row.tenantId}
          columns={[
            {
              header: "Tenant",
              cell: (row) => (
                <span className="adm-cell-id">
                  <a
                    className="adm-row-link"
                    href={`/admin/entitlements?tenant=${row.tenantId}`}
                    aria-current={params.tenant === row.tenantId ? "true" : undefined}
                  >
                    {row.tenantId}
                  </a>
                  <span className="adm-cell-sub">
                    {subscriptionRows.find((item) => item.tenantId === row.tenantId)?.instituteLabel ?? "no contract"}
                  </span>
                </span>
              ),
            },
            ...flagColumns,
          ]}
          empty={
            <EmptyState
              title="No tenant matches this filter"
              body="Clear the tenant id box to see every account. The filter matches the tenant id exactly as the entitlement backend stores it."
            />
          }
        />
      </div>

      <h2 className="adm-h2">Infrastructure grants</h2>
      <DataTable
        caption="Backend infrastructure grants per tenant"
        rows={rows}
        rowKey={(row) => row.tenantId}
        columns={[
          {
            header: "Tenant",
            cell: (row) => (
              <span className="adm-cell-id">
                <a className="adm-row-link" href={`/admin/entitlements?tenant=${row.tenantId}`}>
                  {row.tenantId}
                </a>
                <span className="adm-cell-sub">updated {formatDateTime(row.updatedAt)}</span>
              </span>
            ),
          },
          ...BOOLEAN_GRANTS.map((grant) => ({
            header: BOOLEAN_GRANT_LABEL[grant],
            cell: (row: (typeof rows)[number]) => {
              const on = row.infrastructure[grant];
              const irreversible = isIrreversibleGrant(grant);
              return (
                <form className="adm-inline" method="post" action={setInfrastructureGrantAction}>
                  <input type="hidden" name="tenantId" value={row.tenantId} />
                  <input type="hidden" name="grant" value={grant} />
                  <input type="hidden" name="value" value={on ? "0" : "1"} />
                  <button
                    className="adm-btn-quiet"
                    type="submit"
                    aria-label={`${on ? "Withdraw" : "Grant"} ${BOOLEAN_GRANT_LABEL[grant]} for ${row.tenantId}`}
                  >
                    <StatusTag tone={on ? "on" : "off"}>{on ? "Granted" : "Withheld"}</StatusTag>
                  </button>
                  {irreversible ? <span className="adm-inline-note">withdrawing strands the account</span> : null}
                </form>
              );
            },
          })),
          ...NUMERIC_GRANTS.map((grant) => ({
            header: NUMERIC_GRANT_LABEL[grant],
            numeric: true,
            cell: (row: (typeof rows)[number]) => (
              <form className="adm-inline" method="post" action={setInfrastructureGrantAction}>
                <input type="hidden" name="tenantId" value={row.tenantId} />
                <input type="hidden" name="grant" value={grant} />
                <label className="adm-sr-only" htmlFor={`${grant}-${row.tenantId}`}>
                  {NUMERIC_GRANT_LABEL[grant]} for {row.tenantId}
                </label>
                <input
                  id={`${grant}-${row.tenantId}`}
                  name="value"
                  type="number"
                  min={NUMERIC_GRANT_BOUNDS[grant].min}
                  max={NUMERIC_GRANT_BOUNDS[grant].max}
                  step={1}
                  defaultValue={row.infrastructure[grant]}
                />
                <button className="adm-btn-quiet" type="submit" aria-label={`Save ${NUMERIC_GRANT_LABEL[grant]} for ${row.tenantId}`}>
                  Save
                </button>
              </form>
            ),
          })),
          { header: "Last changed by", cell: (row) => row.updatedBy },
        ]}
        empty={<EmptyState title="No grants to show" body="Grants appear here for every tenant with a provisioned account." />}
      />

      <p className="adm-inline-note" style={{ marginTop: "1rem", maxWidth: "68ch" }}>
        A grant change takes effect when the entitlement engine applies it. This console records the decision and
        audits it; the engine is what the gateway reads.
      </p>
    </>
  );
}
