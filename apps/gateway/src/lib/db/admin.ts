import type { PrismaClient } from "../../prisma-client";

/**
 * SQLite VACUUM — the ONLY raw-SQL statement permitted at runtime, per
 * 10_Security.md §18.1 (secure-erase exception). SQLite forbids VACUUM inside
 * an active transaction, so it must run after the wipe transaction commits.
 * Confined to this audited module per AGENTS.md §3.3 (SQLite admin commands).
 */
export async function vacuum(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`VACUUM`);
}
