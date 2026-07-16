import { PrismaClient } from "@prisma/client";

export interface SearchResult {
  id: string;
  type: "student" | "payment" | "attendance";
  title: string;
  subtitle: string;
  score: number;
}

/**
 * Rebuild search index is a no-op when using Prisma ORM for search.
 * SQLite FTS5 triggers manage the index automatically.
 */
export async function rebuildSearchIndex(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  // FTS5 index is managed by SQLite triggers (trg_students_fts_*)
  // No application-level rebuild is necessary at runtime.
  return Promise.resolve();
}

/**
 * Performs a search using Prisma ORM.
 * Note: Raw queries are forbidden by BR, so we use Prisma's `contains`.
 */
export async function searchAll(
  db: PrismaClient,
  tenantId: string,
  query: string,
): Promise<SearchResult[]> {
  const students = await db.student.findMany({
    where: {
      tenantId,
      status: "active",
      OR: [
        { firstName: { contains: query } },
        { lastName: { contains: query } },
        { phone: { contains: query } },
        { email: { contains: query } },
      ],
    },
    take: 10,
  });

  return students.map((s, index) => ({
    id: s.id,
    type: "student",
    title: `${s.firstName} ${s.lastName || ""}`.trim(),
    subtitle: `${s.phone || ""} ${s.email || ""}`.trim(),
    score: index, // Since ORM doesn't give rank, use array index
  }));
}
