import { getAuthenticatedDb } from "@/server/get-db";
import { log } from "@/lib/logger";

/**
 * Executes an FTS5 search query against the students_fts virtual table.
 * Returns an array of matched student UUIDs.
 * Raw SQL permitted here — FTS5 virtual tables are not expressible via ORM.
 */
export async function searchStudentsFts(tenantId: string, query: string): Promise<string[]> {
  if (!query || query.trim() === '') return [];

  const cleanQuery = query.replace(/["'*]/g, '') + '*';

  try {
    const { client } = await getAuthenticatedDb();
    const res = await client.execute({
      sql: `SELECT id FROM students_fts WHERE tenant_id = ? AND students_fts MATCH ?`,
      args: [tenantId, cleanQuery],
    });
    return res.rows.map(r => r.id as string);
  } catch (err) {
    log.error('students_fts_search_failed', err instanceof Error ? err.message : String(err));
    return [];
  }
}
