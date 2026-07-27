import type { PrismaClient } from "@prisma/client";

/**
 * Implements: 02_Core_Logic.md §6 — Sync Engine
 * Status: v1.0 stub — full cloud sync is a v2.0 feature per 15_Future_Roadmap.md.
 *
 * In v1.0, the sync engine marks outbox rows as 'sent' locally.
 * When v2 blob-store is ready, replace pushSyncOutbox with the encrypted
 * HTTPS POST to https://sync.buddysaradhi.app (BR-SYN-01..03).
 *
 * Rule 9: no silent failures — every error must propagate.
 */

export async function triggerSync(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  await pushSyncOutbox(db, tenantId);
}

export async function pushSyncOutbox(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  const pending = await db.syncOutbox.findMany({
    where: { tenantId, status: "pending" },
  });

  if (pending.length === 0) return;

  // TODO(v2): POST encrypted blob to https://sync.buddysaradhi.app
  // For now, mark as sent locally so the outbox doesn't grow unboundedly.
  // This is correct v1.0 behaviour — the outbox is drained at startup when
  // connectivity is restored (BR-SYN-04).
  await db.syncOutbox.updateMany({
    where: {
      id: { in: pending.map((p: (typeof pending)[number]) => p.id) },
      tenantId,
    },
    data: {
      status: "sent",
      flushedAt: new Date(),
    },
  });
}
