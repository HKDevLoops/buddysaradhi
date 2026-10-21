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
import { resolveOriginVerdict } from "@/lib/request-origin";

function clientIp(source: Headers): string {
  const forwarded = source.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(",")[0];
    if (first !== undefined && first.trim().length > 0) return first.trim();
  }
  return "unknown";
}

/**
 * SAME-ORIGIN GATE (CSRF). A route handler gets NO automatic Origin check
 * from Next.js - that protection covers Server Actions only. Without this
 * gate any page on the internet could make a visitor's browser write a row
 * into the ops inbox: the attacker cannot READ the response, but the side
 * effect happens all the same.
 *
 * The check is host-relative, not an allowlist of guessed origins: this app
 * is reachable at a deployment origin, the apex and every preview origin, and
 * a list that missed one of them would silently break the form for real
 * tutors. `NEXT_PUBLIC_SITE_URL` is additive.
 */
function refuseCrossOrigin(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      errors: {
        note: "This request did not come from this site, so it was not recorded. Nothing was sent and nothing was charged. Open the request form on this site and send it again.",
      },
    },
    { status: 403 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestHeaders = await headers();
  const verdict = resolveOriginVerdict(
    requestHeaders,
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    process.env.NEXT_PUBLIC_SITE_URL ? [process.env.NEXT_PUBLIC_SITE_URL] : [],
  );
  if (!verdict.allowed) {
    return refuseCrossOrigin();
  }

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
    ip: clientIp(requestHeaders),
    nowMs: Date.now(),
    store,
    audit: (input) => adminAudit(input),
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
