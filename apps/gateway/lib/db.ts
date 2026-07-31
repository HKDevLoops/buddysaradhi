import { createClient as createLibsql } from "https://esm.sh/@libsql/client@0.14.0";

export type DB = ReturnType<typeof createLibsql>;

const tursoCache = new Map<string, DB>();

export function getTurso(dbUrl: string, dbToken: string): DB {
  const key = `${dbUrl}::${dbToken}`;
  let c = tursoCache.get(key);
  if (!c) {
    c = createLibsql({ url: dbUrl, authToken: dbToken });
    tursoCache.set(key, c);
  }
  return c;
}

export async function run(
  db: DB,
  sql: string,
  args: unknown[] = [],
) {
  return db.execute({ sql, args: args as never });
}

export async function allRows(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const res = await run(db, sql, args);
  return (res.rows as Record<string, unknown>[]) ?? [];
}

export async function oneRow(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown> | null> {
  const rows = await allRows(db, sql, args);
  return rows[0] ?? null;
}
