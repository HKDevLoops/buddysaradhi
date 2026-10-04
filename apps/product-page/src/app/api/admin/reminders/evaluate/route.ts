// Implements: docs/design/entitlements-contract.md §5 ("Reminder tick", daily,
// idempotency key `(tenant_id, period_start, stage)`) as a DRY RUN.
//
// This endpoint computes what the tick WOULD do and returns it as JSON. It
// writes nothing, sends no mail, touches no grant, and queues nothing: the
// only write it performs is its own audit row (`admin.reminder.evaluated`),
// because a read of admin metadata is itself recorded in this console. The
// scheduled job that one day sends the mail calls the same pure
// `evaluateDueReminders`, so the dry run and the job can never disagree.
//
// Admin-gated like every console surface: unconfigured → 503, anonymous →
// 401, both as typed JSON (AGENTS.md Rule 9).

import { NextResponse } from "next/server";
import { adminAudit } from "@/app/admin/_lib/audit";
import { currentAdminIdentity } from "@/app/admin/_lib/auth";
import { AdminAuthError } from "@/app/admin/_lib/auth";
import { evaluateDueReminders, reminders } from "@/app/admin/_lib/reminders";
import { subscriptions } from "@/app/admin/_lib/subscriptions";

export async function GET(): Promise<NextResponse> {
  let actor: string;
  try {
    const identity = await currentAdminIdentity();
    actor = identity.email;
  } catch (error) {
    if (error instanceof AdminAuthError) {
      const status = error.httpStatus as 401 | 503;
      return NextResponse.json(
        { ok: false, error: error.code, recovery: error.recovery },
        { status },
      );
    }
    throw error;
  }

  const nowIso = new Date().toISOString();
  const subscriptionRows = await subscriptions().list({}, nowIso);
  const scheduleRows = await reminders().list(nowIso);

  // SAFETY: evaluateDueReminders is pure by construction (no repo, no mail, no
  // clock inside): the rows above are its entire input, so this GET cannot
  // change a stage, a flag, or a queue no matter how often it is called.
  const due = evaluateDueReminders(
    subscriptionRows.map((subscription) => {
      const schedule = scheduleRows.find((row) => row.tenantId === subscription.tenantId);
      return {
        tenantId: subscription.tenantId,
        status: subscription.status,
        expiresOn: subscription.expiresOn,
        stage: schedule?.stage ?? "none",
      };
    }),
    nowIso,
  );

  await adminAudit({
    actor,
    action: "admin.reminder.evaluated",
    refType: "reminder",
    metadata: { view: "dry-run-evaluate", rows: subscriptionRows.length, owed: due.length },
  });

  return NextResponse.json({ ok: true, now: nowIso, count: due.length, due });
}
