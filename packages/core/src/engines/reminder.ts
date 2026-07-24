import type { PrismaClient } from "@prisma/client";

export async function processReminders(
  db: PrismaClient,
  tenantId: string,
): Promise<number> {
  // 1. Unpaid fees logic
  // Find all students with balance > 0 (in paise)
  // 2. Attendance absence logic
  // Find all students with consecutive absences >= 3

  // Real implementation will queue notifications via NotificationEngine

  // Get all students with their latest ledger entry
  const students = await db.student.findMany({
    where: { tenantId, status: "active" },
    select: {
      id: true,
      ledgerEntries: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { balanceAfterPaise: true },
      },
    },
  });

  let count = 0;
  for (const student of students) {
    const latestEntry = student.ledgerEntries[0];
    if (latestEntry && latestEntry.balanceAfterPaise > 0) {
      count++;
    }
  }

  // TODO: integrate with notification engine to actually send them.
  return count;
}
