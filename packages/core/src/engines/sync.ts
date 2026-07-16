import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export async function triggerSync(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  // Push sync_outbox, pull changes
  // In a real implementation this would contact the API gateway and exchange data.
  // We'll update the sync_outbox rows to 'sent' for now as a mock.
  await pushSyncOutbox(db, tenantId);
}

export async function pushSyncOutbox(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  // Select all pending outbox entries
  const pending = await db.syncOutbox.findMany({
    where: { tenantId, status: "pending" },
  });

  if (pending.length === 0) return;

  // Mock sending to a remote server...

  // Mark as sent
  await db.syncOutbox.updateMany({
    where: {
      id: { in: pending.map((p) => p.id) },
      tenantId,
    },
    data: {
      status: "sent",
      flushedAt: new Date(),
    },
  });
}
