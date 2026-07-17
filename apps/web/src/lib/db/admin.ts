import { getAuthenticatedDb } from "@/server/get-db";

/**
 * ADMIN ONLY: Raw SQL for FTS5 virtual table setup.
 * Must NEVER be called from a screen, server action, or API route.
 * Only called once during DB initialization.
 */
export async function initializeFtsTables() {
  const { client } = await getAuthenticatedDb();

  await client.executeMultiple(`
    CREATE VIRTUAL TABLE IF NOT EXISTS students_fts USING fts5(
      id UNINDEXED,
      tenant_id UNINDEXED,
      first_name,
      last_name,
      code,
      phone,
      content='students',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS students_ai AFTER INSERT ON students BEGIN
      INSERT INTO students_fts(rowid, id, tenant_id, first_name, last_name, code, phone)
      VALUES (new.rowid, new.id, new.tenant_id, new.first_name, new.last_name, new.code, new.phone);
    END;

    CREATE TRIGGER IF NOT EXISTS students_ad AFTER DELETE ON students BEGIN
      INSERT INTO students_fts(students_fts, rowid, id, tenant_id, first_name, last_name, code, phone)
      VALUES ('delete', old.rowid, old.id, old.tenant_id, old.first_name, old.last_name, old.code, old.phone);
    END;

    CREATE TRIGGER IF NOT EXISTS students_au AFTER UPDATE ON students BEGIN
      INSERT INTO students_fts(students_fts, rowid, id, tenant_id, first_name, last_name, code, phone)
      VALUES ('delete', old.rowid, old.id, old.tenant_id, old.first_name, old.last_name, old.code, old.phone);
      INSERT INTO students_fts(rowid, id, tenant_id, first_name, last_name, code, phone)
      VALUES (new.rowid, new.id, new.tenant_id, new.first_name, new.last_name, new.code, new.phone);
    END;
  `);
}
