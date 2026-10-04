// Implements: docs/design/entitlements-contract.md §2 (the downgrade step of
// the access pipeline) + §3 (the non-payment ladder's terminal move:
// downgrade to free, revoke grants, queue the export) + docs/design/
// admin-console.md §5 invariant 2 (a downgrade revokes grants in the SAME
// transaction that writes the new status, and queues an export; all three, or
// none).
//
// ATOMICITY LIMIT (read before extending). The in-memory stores apply each
// write in turn with no rollback: if step 4 of 5 throws, steps 1-3 stand and
// the audit trail shows exactly where the run stopped. The operator recovers by
// re-running the enforcement: every write below is idempotent (setting an
// already-free flag to free is a no-op write of the same value, and the
// reminder stage refuses a second downgrade, which is what makes the re-run
// safe). A Supabase-backed store MUST wrap the five writes plus the audit row
// in one transaction instead; until it does, this module's audit row is the
// record that lets an operator finish a half-run by hand.
//
// What this module does NOT do (still specified-only): send the reminder mail,
// zip the database, produce artefact bytes, or run on a schedule. It flips
// entitlement metadata and queues the export request the packaging job reads.

import { adminAudit } from "./audit.ts";
import {
  entitlements,
  type TenantEntitlements,
} from "./entitlements.ts";
import { DEFAULT_REMINDER_POLICY, isAdvanceLegal, reminders, ReminderTransitionRefused, type ReminderScheduleRow } from "./reminders.ts";
import {
  AdminRecordNotFound,
  subscriptions,
  type TenantSubscription,
} from "./subscriptions.ts";
import { exportRequests, type ExportRequestMetadata } from "./exports.ts";
import type { FeatureFlag } from "./types.ts";
import { FEATURE_FLAGS } from "./types.ts";

/**
 * The free destination a downgrade enforces. One surface (web), no background
 * jobs, no export grant, and the seed-matching 512 MB quota. `dbProvisioned`
 * is deliberately left untouched: whether a downgraded database is retained or
 * deleted is open decision 4 in entitlements-contract.md §7, and the current
 * reading is "returned to the tutor, not deleted".
 */
export const DOWNGRADE_FREE_FLAGS: Readonly<Record<FeatureFlag, boolean>> = {
  "web-app": true,
  "android-app": false,
  "ios-app": false,
  "macos-app": false,
  "windows-app": false,
  "priority-support": false,
};

export const DOWNGRADE_STORAGE_QUOTA_MB = 512;

export interface DowngradeResult {
  readonly subscription: TenantSubscription;
  readonly entitlements: TenantEntitlements;
  readonly reminder: ReminderScheduleRow;
  readonly exportRequest: ExportRequestMetadata;
  /** True when the account was already downgraded: nothing was written. */
  readonly repeated: boolean;
}

/**
 * Enforces the downgrade for one tenant: the contract moves to free, every
 * non-web flag is withdrawn, background jobs and the export grant are
 * withdrawn, the reminder stage moves to `downgraded`, and an export request
 * is queued for the packaging job. The single `admin.entitlement.downgrade`
 * audit row carries the before/after of all five, so the run is traceable as
 * one enforcement even though the memory store applies it as five writes.
 *
 * The reminder stage is the gate: only `hard-sent` may downgrade (the state
 * machine refuses the rest as a conflict), and an already-`downgraded` account
 * returns `repeated: true` with no writes, which is what makes re-running the
 * tick a no-op (entitlements-contract.md §3 invariant 1).
 */
export async function enforceDowngrade(input: {
  readonly tenantId: string;
  readonly actor: string;
  readonly nowMs: number;
}): Promise<DowngradeResult> {
  const nowIso = new Date(input.nowMs).toISOString();

  const subscriptionBefore = await subscriptions().get(input.tenantId);
  if (subscriptionBefore === null) throw new AdminRecordNotFound(`No subscription for ${input.tenantId}.`);
  const entitlementsBefore = await entitlements().get(input.tenantId);
  if (entitlementsBefore === null) throw new AdminRecordNotFound(`No entitlements for ${input.tenantId}.`);
  const reminderBefore = await reminders().get(input.tenantId, nowIso);
  if (reminderBefore === null) throw new AdminRecordNotFound(`No reminder schedule for ${input.tenantId}.`);

  if (reminderBefore.stage === "downgraded") {
    // Already enforced: re-running is a no-op with no writes. The newest
    // export for the tenant is the one the first run queued; the reminder row
    // itself carries no export id, so the queue is the source of truth here.
    const owned = await exportRequests().list(nowIso);
    const linked =
      reminderBefore.exportRequestId === null
        ? null
        : await exportRequests().get(reminderBefore.exportRequestId);
    const exportRequest = linked ?? owned.find((row) => row.tenantId === input.tenantId) ?? null;
    if (exportRequest === null) throw new AdminRecordNotFound(`No export request for ${input.tenantId}.`);
    return {
      subscription: subscriptionBefore,
      entitlements: entitlementsBefore,
      reminder: reminderBefore,
      exportRequest,
      repeated: true,
    };
  }

  // THE GATE, before any write. Only `hard-sent` may downgrade; anything else
  // is a conflict and nothing has been written when it throws, so a refused
  // run can never leave a downgraded-but-still-provisioned account behind.
  if (!isAdvanceLegal(reminderBefore.stage, "downgrade")) {
    throw new ReminderTransitionRefused(reminderBefore.stage, "downgrade");
  }

  const revokedFlags = FEATURE_FLAGS.filter(
    (flag) => entitlementsBefore.flags[flag] && !DOWNGRADE_FREE_FLAGS[flag],
  );

  const subscription = await subscriptions().apply(
    input.tenantId,
    { plan: "free", status: "cancelled" },
    input.actor,
  );

  let entitlementsAfter = entitlementsBefore;
  for (const flag of FEATURE_FLAGS) {
    const wanted = DOWNGRADE_FREE_FLAGS[flag];
    if (entitlementsAfter.flags[flag] !== wanted) {
      entitlementsAfter = await entitlements().setFlag(input.tenantId, flag, wanted, input.actor);
    }
  }
  if (entitlementsAfter.infrastructure.backgroundJobsEnabled !== false) {
    entitlementsAfter = await entitlements().setGrant(input.tenantId, "backgroundJobsEnabled", false, input.actor);
  }
  if (entitlementsAfter.infrastructure.exportAllowed !== false) {
    entitlementsAfter = await entitlements().setGrant(input.tenantId, "exportAllowed", false, input.actor);
  }
  if (entitlementsAfter.infrastructure.storageQuotaMb !== DOWNGRADE_STORAGE_QUOTA_MB) {
    entitlementsAfter = await entitlements().setGrant(
      input.tenantId,
      "storageQuotaMb",
      DOWNGRADE_STORAGE_QUOTA_MB,
      input.actor,
    );
  }

  // The gate: throws ReminderTransitionRefused unless the stage is hard-sent.
  const reminder = await reminders().advance(input.tenantId, "downgrade", input.actor, nowIso);

  const exportRequest = await exportRequests().request(
    input.tenantId,
    DEFAULT_REMINDER_POLICY.exportWindowHours,
    input.actor,
    nowIso,
  );

  await adminAudit({
    actor: input.actor,
    action: "admin.entitlement.downgrade",
    refType: "entitlement",
    refId: input.tenantId,
    metadata: {
      plan: { from: subscriptionBefore.plan, to: subscription.plan },
      status: { from: subscriptionBefore.status, to: subscription.status },
      revokedFlags,
      grants: {
        backgroundJobsEnabled: {
          from: entitlementsBefore.infrastructure.backgroundJobsEnabled,
          to: entitlementsAfter.infrastructure.backgroundJobsEnabled,
        },
        exportAllowed: { from: entitlementsBefore.infrastructure.exportAllowed, to: entitlementsAfter.infrastructure.exportAllowed },
        storageQuotaMb: {
          from: entitlementsBefore.infrastructure.storageQuotaMb,
          to: entitlementsAfter.infrastructure.storageQuotaMb,
        },
      },
      reminderStage: { from: reminderBefore.stage, to: reminder.stage },
      exportRequestId: exportRequest.id,
    },
  });

  return { subscription, entitlements: entitlementsAfter, reminder, exportRequest, repeated: false };
}
