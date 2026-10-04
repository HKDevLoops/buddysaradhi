// Implements: docs/design/overhaul-plan.md §4.1 (`/request-access`) +
// docs/design/entitlements-contract.md §2 (the access-request → access
// pipeline: validated, rate-limited per IP + per email, persisted, audited).
// Validation is shared with the browser form
// (src/lib/access-request.ts), so the two agree on every rule. No payment is
// collected here and no card is asked for.
//
// HONESTY. `delivery: "console"` in the receipt means exactly what
// `AccessRequestReceipt` says: the request is persisted to the access-request
// store and readable by the owner in the console. Mail delivery to a person is
// NOT connected, and nothing here claims it is (AGENTS.md Rule 9).
//
// FAIL CLOSED. A half-configured Supabase env refuses with 503 (see
// `resolveAccessRequestStore`); a failed write is a 503, never a silent drop.
// The visitor keeps their answers and can retry: nothing is charged either way.
//
// NO ENUMERATION. A duplicate email is stored as a second row and answered
// with the same 201 shape. The response never reveals whether an address was
// already known, and the 429 message is identical for both windows.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { adminAudit } from "@/app/admin/_lib/audit";
import {
  AccessRequestStoreError,
  resolveAccessRequestStore,
  submitAccessRequest,
} from "@/app/admin/_lib/access-requests";

function clientIp(source: Headers): string {
  const forwarded = source.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(",")[0];
    if (first !== undefined && first.trim().length > 0) return first.trim();
  }
  return "unknown";
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, errors: { note: "Send the request as a JSON object." } },
      { status: 400 },
    );
  }

  let store;
  try {
    store = resolveAccessRequestStore();
  } catch (error) {
    if (error instanceof AccessRequestStoreError) {
      return NextResponse.json(
        { ok: false, errors: { note: "This site could not record the request right now. Nothing was sent and nothing was charged." } },
        { status: error.httpStatus },
      );
    }
    throw error;
  }

  // SAFETY: submitAccessRequest never throws for a validation, rate-limit or
  // store failure: every one of those is a typed status the route returns
  // as-is. Only a programmer error (a bug) escapes as a throw.
  const outcome = await submitAccessRequest({
    body,
    ip: clientIp(await headers()),
    nowMs: Date.now(),
    store,
    audit: (input) => adminAudit(input),
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
