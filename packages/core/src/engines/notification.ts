import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export async function enqueueNotification(
  db: PrismaClient,
  tenantId: string,
  category: "reminder" | "ledger" | "attendance" | "system",
  title: string,
  body?: string,
  refType?: string,
  refId?: string,
): Promise<void> {
  await db.notification.create({
    data: {
      id: randomUUID(),
      tenantId,
      category,
      title,
      body: body || null,
      refType: refType || null,
      refId: refId || null,
      createdAt: new Date(),
    },
  });
}

export async function flushNotifications(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  // In a real environment, this would push notifications to the OS (desktop/mobile)
  // or web push API. Here we just mark them as read for the sake of example.
  await db.notification.updateMany({
    where: {
      tenantId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}
