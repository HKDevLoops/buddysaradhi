// Implements: docs/design/entitlements-contract.md §3 (forward-only ladders,
// exactly-one hard reminder, atomic downgrade) + §4 (metadata only, never
// artefact bytes) + §5 (dry-run evaluation) — engine contract tests.
// Runner: `node --test` (no dependency; see package.json `test`).

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { adminAuditList, resetAuditSink } from "./audit.ts";
import { DOWNGRADE_STORAGE_QUOTA_MB, enforceDowngrade } from "./engine.ts";
import {
  ExportTransitionRefused,
  exportRequests,
  isExportTransitionLegal,
  resetExportRepository,
} from "./exports.ts";
import {
  evaluateDueReminders,
  ReminderTransitionRefused,
  reminders,
  resetReminderRepository,
} from "./reminders.ts";
import { resetEntitlementRepository } from "./entitlements.ts";
import { resetSubscriptionRepository, subscriptions } from "./subscriptions.ts";

const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
const ACTOR = "ops@test";

beforeEach(() => {
  resetSubscriptionRepository();
  resetEntitlementRepository();
  resetReminderRepository();
  resetExportRepository();
  resetAuditSink();
});

test("export queue is forward-only and terminal at expired", async () => {
  assert.equal(isExportTransitionLegal("queued", "packaging"), true);
  assert.equal(isExportTransitionLegal("queued", "mailed"), false);
  assert.equal(isExportTransitionLegal("packaging", "mailed"), true);
  assert.equal(isExportTransitionLegal("mailed", "downloaded"), true);
  assert.equal(isExportTransitionLegal("mailed", "expired"), true);
  assert.equal(isExportTransitionLegal("downloaded", "expired"), true);
  assert.equal(isExportTransitionLegal("downloaded", "mailed"), false);
  assert.equal(isExportTransitionLegal("expired", "queued"), false);

  const created = await exportRequests().request("t-0001", 72, ACTOR, NOW_ISO);
  assert.equal(created.state, "queued");

  await assert.rejects(
    exportRequests().advance(created.id, "mailed", ACTOR, NOW_ISO),
    (error: unknown) => error instanceof ExportTransitionRefused,
  );

  const packaging = await exportRequests().advance(created.id, "packaging", ACTOR, NOW_ISO);
  assert.equal(packaging.state, "packaging");
  const mailed = await exportRequests().advance(created.id, "mailed", ACTOR, NOW_ISO);
  assert.equal(mailed.state, "mailed");
  assert.ok(mailed.linkExpiresAt !== null && Number.isFinite(Date.parse(mailed.linkExpiresAt)));
  const downloaded = await exportRequests().advance(created.id, "downloaded", ACTOR, NOW_ISO);
  assert.equal(downloaded.state, "downloaded");
  const expired = await exportRequests().advance(created.id, "expired", ACTOR, NOW_ISO);
  assert.equal(expired.state, "expired");
  await assert.rejects(
    exportRequests().advance(created.id, "packaging", ACTOR, NOW_ISO),
    (error: unknown) => error instanceof ExportTransitionRefused,
  );
});

test("a console advance never invents size or digest", async () => {
  const created = await exportRequests().request("t-0002", 72, ACTOR, NOW_ISO);
  const mailed = await exportRequests().advance(
    (await exportRequests().advance(created.id, "packaging", ACTOR, NOW_ISO)).id,
    "mailed",
    ACTOR,
    NOW_ISO,
  );
  assert.equal(mailed.sizeBytes, null);
  assert.equal(mailed.sha256, null);
});

test("evaluateDueReminders is a pure dry run: same answer twice, no writes", async () => {
  const subs = await subscriptions().list({}, NOW_ISO);
  const scheds = await reminders().list(NOW_ISO);
  const inputs = subs.flatMap((subscription) => {
    const schedule = scheds.find((row) => row.tenantId === subscription.tenantId);
    if (schedule === undefined) return [];
    return [
      {
        tenantId: subscription.tenantId,
        status: subscription.status,
        expiresOn: subscription.expiresOn,
        stage: schedule.stage,
      },
    ];
  });

  const first = evaluateDueReminders(inputs, NOW_ISO);
  const second = evaluateDueReminders(inputs, NOW_ISO);
  assert.deepEqual(first, second);

  const pastDue = first.find((due) => due.tenantId === "t-0003");
  assert.ok(pastDue !== undefined);
  assert.equal(pastDue.nextAdvance, "downgrade");

  // Nothing owed for a trialing or cancelled account: the ladder is not theirs.
  assert.ok(first.find((due) => due.tenantId === "t-0004") === undefined);
  assert.ok(first.find((due) => due.tenantId === "t-0006") === undefined);

  // No stage moved, no row written, by running the evaluation.
  const after = await reminders().list(NOW_ISO);
  assert.deepEqual(after, scheds);
});

test("downgrade flips flags, revokes grants, queues an export, audits once", async () => {
  await reminders().advance("t-0001", "gentle", ACTOR, NOW_ISO);
  await reminders().advance("t-0001", "hard", ACTOR, NOW_ISO);

  const result = await enforceDowngrade({ tenantId: "t-0001", actor: ACTOR, nowMs: NOW_MS });
  assert.equal(result.repeated, false);
  assert.equal(result.subscription.plan, "free");
  assert.equal(result.subscription.status, "cancelled");
  assert.deepEqual(result.entitlements.flags, {
    "web-app": true,
    "android-app": false,
    "ios-app": false,
    "macos-app": false,
    "windows-app": false,
    "priority-support": false,
  });
  assert.equal(result.entitlements.infrastructure.backgroundJobsEnabled, false);
  assert.equal(result.entitlements.infrastructure.exportAllowed, false);
  assert.equal(result.entitlements.infrastructure.storageQuotaMb, DOWNGRADE_STORAGE_QUOTA_MB);
  assert.equal(result.reminder.stage, "downgraded");
  assert.equal(result.exportRequest.tenantId, "t-0001");
  assert.equal(result.exportRequest.state, "queued");

  const audits = (await adminAuditList({ limit: 200 })).filter(
    (row) => row.action === "admin.entitlement.downgrade" && row.refId === "t-0001",
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.actor, ACTOR);
});

test("downgrade is idempotent: the second run writes nothing", async () => {
  await reminders().advance("t-0001", "gentle", ACTOR, NOW_ISO);
  await reminders().advance("t-0001", "hard", ACTOR, NOW_ISO);
  await enforceDowngrade({ tenantId: "t-0001", actor: ACTOR, nowMs: NOW_MS });

  const exportsBefore = (await exportRequests().list(NOW_ISO)).filter((row) => row.tenantId === "t-0001");
  const auditsBefore = (await adminAuditList({ limit: 200 })).filter(
    (row) => row.action === "admin.entitlement.downgrade",
  );

  const repeated = await enforceDowngrade({ tenantId: "t-0001", actor: ACTOR, nowMs: NOW_MS + 1000 });
  assert.equal(repeated.repeated, true);

  const exportsAfter = (await exportRequests().list(NOW_ISO)).filter((row) => row.tenantId === "t-0001");
  const auditsAfter = (await adminAuditList({ limit: 200 })).filter(
    (row) => row.action === "admin.entitlement.downgrade",
  );
  assert.deepEqual(exportsAfter, exportsBefore);
  assert.deepEqual(auditsAfter, auditsBefore);
});

test("downgrade before the hard reminder is a conflict, not a partial write", async () => {
  await assert.rejects(
    enforceDowngrade({ tenantId: "t-0002", actor: ACTOR, nowMs: NOW_MS }),
    (error: unknown) => error instanceof ReminderTransitionRefused,
  );
  const subscription = await subscriptions().get("t-0002");
  assert.ok(subscription !== null);
  assert.notEqual(subscription.plan, "free");
});
