// Implements: docs/design/entitlements-contract.md §2 (the inbox half of the
// access-request → access pipeline) + docs/design/admin-console.md §5.
//
// Every row here is a request a visitor typed on `/request-access`. The page
// records the admin's decision (contacted → contracted|declined) and audits it;
// it does not send mail and it does not provision anything. Contracting the
// plan and provisioning access stay manual steps the admin takes in
// Subscriptions and Entitlements afterwards.
//
// Operate mode: filters are a GET form, each decision is a POST server action,
// no client JavaScript. Reading this page is audited like every other list.

import { adminAudit } from "../../_lib/audit";
import { currentAdminIdentity } from "../../_lib/auth";
import {
  ACCESS_REQUEST_STATE_LABEL,
  ACCESS_REQUEST_STATES,
  accessRequests,
  isAccessRequestState,
  type AccessRequestAdvance,
  type AccessRequestRecord,
} from "../../_lib/access-requests";
import { advanceAccessRequestAction } from "../../actions";
import { errorSentence, formatDateTime, readErrorCode, readNoticeText } from "../../_lib/format";
import { AdminPageHeader, DataTable, EmptyState, FilterField, Notice, StatusTag } from "../../_lib/ui";
import type { Tone } from "../../_lib/ui";

const STATE_TONE: Readonly<Record<AccessRequestRecord["state"], Tone>> = {
  new: "info",
  contacted: "warn",
  contracted: "ok",
  declined: "neutral",
};

const NEXT_STEPS: Readonly<Record<AccessRequestRecord["state"], readonly AccessRequestAdvance[]>> = {
  new: ["contacted", "declined"],
  contacted: ["contracted", "declined"],
  contracted: [],
  declined: [],
};

const ADVANCE_LABEL: Readonly<Record<AccessRequestAdvance, string>> = {
  contacted: "Mark contacted",
  contracted: "Mark contracted",
  declined: "Decline",
};

export default async function AdminRequestsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly state?: string;
    readonly q?: string;
    readonly notice?: string;
    readonly error?: string;
    readonly detail?: string;
  }>;
}) {
  const admin = await currentAdminIdentity();
  const params = await searchParams;

  const state = params.state !== undefined && isAccessRequestState(params.state) ? params.state : undefined;
  const query = params.q ?? "";

  const rows = await accessRequests().list({ state, query });

  await adminAudit({
    actor: admin.email,
    action: "admin.access_request.view",
    refType: "access_request",
    metadata: { view: "list", rows: rows.length, state: state ?? null },
  });

  const notice = readNoticeText(params.notice);
  const error = readErrorCode(params.error);
  const detail = params.detail ?? null;

  return (
    <>
      <AdminPageHeader
        title="Access requests"
        lede="Every request a visitor sent from the front door. Record that you contacted them, then that you contracted or declined the plan. Mail delivery is not connected, so the reply still goes out by hand."
      />

      {notice === null ? null : <Notice text={notice} />}
      {error === null ? null : <Notice code="bad" text={errorSentence(error, detail)} />}

      <form className="adm-filters" method="get" action="/admin/requests">
        <FilterField label="State" name="state">
          <select className="input" id="state" name="state" defaultValue={state ?? ""}>
            <option value="">Every state</option>
            {ACCESS_REQUEST_STATES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {ACCESS_REQUEST_STATE_LABEL[candidate]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Search" name="q" grow>
          <input className="input" id="q" name="q" type="search" defaultValue={query} placeholder="Reference, email or institute" />
        </FilterField>
        <button className="btn btn-secondary" type="submit">
          Apply
        </button>
        <a className="adm-btn-quiet" href="/admin/requests">
          Reset
        </a>
      </form>

      <div style={{ marginTop: "1rem" }}>
        <DataTable
          caption="Access requests, newest first. Each decision writes an audit row recording the previous state."
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              header: "Reference",
              cell: (row) => (
                <span className="adm-cell-id">
                  <span className="adm-mono">{row.reference}</span>
                  <span className="adm-cell-sub">{formatDateTime(row.createdAt)}</span>
                </span>
              ),
            },
            {
              header: "Who asked",
              cell: (row) => (
                <span className="adm-cell-id">
                  <span>{row.name}</span>
                  <span className="adm-cell-sub">{row.instituteName}</span>
                  <span className="adm-cell-sub">{row.email}</span>
                </span>
              ),
            },
            {
              header: "Plan",
              cell: (row) => (row.plan === "free" ? "Free" : `Institute, ${row.billingPeriod ?? "no period"}`),
            },
            {
              header: "State",
              cell: (row) => <StatusTag tone={STATE_TONE[row.state]}>{ACCESS_REQUEST_STATE_LABEL[row.state]}</StatusTag>,
            },
            {
              header: "Decide",
              cell: (row) => {
                const steps = NEXT_STEPS[row.state];
                if (steps.length === 0) return <span className="adm-cell-sub">decided</span>;
                return (
                  <span className="adm-cell-id">
                    {steps.map((step) => (
                      <form key={step} className="adm-inline" method="post" action={advanceAccessRequestAction}>
                        <input type="hidden" name="requestId" value={row.id} />
                        <input type="hidden" name="advance" value={step} />
                        <button
                          className="adm-btn-quiet"
                          type="submit"
                          aria-label={`${ADVANCE_LABEL[step]} ${row.reference}`}
                        >
                          {ADVANCE_LABEL[step]}
                        </button>
                      </form>
                    ))}
                  </span>
                );
              },
            },
          ]}
          empty={
            <EmptyState
              title="No request matches this filter"
              body="New requests from the front door land here. Widen the state filter or clear the search box."
            />
          }
        />
      </div>

      <p className="adm-inline-note" style={{ marginTop: "1rem", maxWidth: "68ch" }}>
        A decision here records the conversation, not the provisioning. Contract the plan under
        Subscriptions and switch the grants under Entitlements; both of those write their own audit rows.
      </p>
    </>
  );
}
