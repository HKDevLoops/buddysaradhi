// Implements: AGENTS.md §3.4 — the libsql connection factory for the gateway.
// Statement helpers live in lib/sql.ts and are re-exported here so existing
// callers (`lib/orm.ts` historically, `lib/schema.ts`, `graphql/resolvers.ts`)
// keep one import site.
import { createClient as createLibsql } from "@libsql/client/web";
import { resolveTursoUrl, resolveToken } from "./sql.ts";

export { allRows, batchExecute, oneRow, run } from "./sql.ts";
export type { SqlHandle } from "./sql.ts";

export type DB = ReturnType<typeof createLibsql>;

const tursoCache = new Map<string, DB>();

export function getTurso(dbUrl: string, dbToken: string): DB {
  const targetUrl = resolveTursoUrl(dbUrl);
  const token = resolveToken(dbToken);
  const key = `${targetUrl}::${token.slice(-16)}`;
  let c = tursoCache.get(key);
  if (!c) {
    c = createLibsql({ url: targetUrl, authToken: token });
    tursoCache.set(key, c);
  }
  return c;
}
