// Implements: docs/design/overhaul-plan.md §4.1 (`/request-access`). Validation
// is shared with the stub endpoint in ./route.ts, so the browser and the
// server agree on every rule (src/lib/access-request.ts). No payment is
// collected here and no card is asked for.

import { NextResponse } from "next/server";
import { validateAccessRequest } from "@/lib/access-request";

/** STUB ENDPOINT. docs/design/overhaul-plan.md §4.2: the entitlement engine
 *  (storage, mail delivery, plan activation) is specified in
 *  docs/design/entitlements-contract.md and is NOT implemented in this pass.
 *  This route validates the request and returns a typed result; the request is
 *  not yet delivered to an administrator. `delivery: "stub"` says so in the
 *  response so the UI cannot claim a delivery that has not happened.
 *  Follow-up: replace the body with a call to the entitlement API. */
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

  const parsed = validateAccessRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.error }, { status: 422 });
  }

  // SAFETY: the validated shape is the only shape that reaches this point.
  const reference = `AR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  return NextResponse.json(
    {
      ok: true,
      receipt: {
        reference,
        receivedAt: new Date().toISOString(),
        delivery: "stub" as const,
      },
    },
    { status: 201 },
  );
}
