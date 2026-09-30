// Implements: AGENTS.md §3.4 (every runtime DB access goes through the
// ORM-style handle; no raw-SQL escape hatch in app code) + Rule 9
// (12_Business_Rules.md / 10_Security.md — typed errors, no silent failure).
//
// This module holds the *transport-independent* half of lib/db.ts: the
// statement helpers (`run`/`allRows`/`oneRow`/`batchExecute`), the Turso
// endpoint/token resolvers and the raw-pipeline fallback. It deliberately does
// NOT import `@libsql/client` (a Deno/edge ESM dependency that vitest cannot
// resolve from the repo root), so `lib/orm.ts`, `lib/ledger-chain.ts` and
// `routes/ledger.ts` can be exercised in integration tests against a real
// SQLite handle. `lib/db.ts` keeps the `@libsql/client` connection factory and
// re-exports these helpers, so no caller changes behaviour.

/** The minimal handle every statement helper needs — `Client`, an interactive
 * `Transaction`, or the SQLite test adapter all satisfy it structurally.
 *
 * The statement parameter is `unknown` on purpose: libsql's own
 * `InStatement = string | { sql; args: InArgs }` is neither a super- nor a
 * sub-type of `{ sql; args?: unknown[] }`, so a narrower parameter would make
 * every `Client` call site fail to type-check. `run()` is the only place that
 * builds a statement, and it always builds `{ sql, args }`. */
export interface SqlHandle {
  execute(stmt: unknown): Promise<{
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
  }>;
}

export function resolveTursoUrl(url?: string): string {
  if (
    url &&
    (url.startsWith("libsql://") ||
      url.startsWith("https://") ||
      url.startsWith("http://")) &&
    !url.includes("supabase.co") &&
    !url.includes("gmqwdnvbfnwpzpctwvho")
  ) {
    return url;
  }
  const envUrl =
    typeof Deno !== "undefined" ? Deno.env.get("TURSO_DATABASE_URL") : undefined;
  if (
    envUrl &&
    (envUrl.startsWith("libsql://") ||
      envUrl.startsWith("https://") ||
      envUrl.startsWith("http://"))
  ) {
    return envUrl;
  }
  throw new Error(
    "TURSO_DATABASE_URL is required but not configured. " +
      "Set TURSO_DATABASE_URL in your environment secrets (Supabase dashboard → Edge Functions → Secrets)."
  );
}

export function resolveToken(dbToken?: string): string {
  const envToken =
    typeof Deno !== "undefined"
      ? Deno.env.get("TURSO_AUTH_TOKEN") || Deno.env.get("TURSO_TOKEN")
      : undefined;
  if (dbToken && dbToken.length > 20) return dbToken;
  if (envToken && envToken.length > 20) return envToken;
  // No hardcoded fallback — fail loudly in production per Rule 9 (no silent failures)
  throw new Error(
    "TURSO_AUTH_TOKEN is required but not configured. " +
      "Set TURSO_AUTH_TOKEN in your environment secrets (Supabase dashboard → Edge Functions → Secrets)."
  );
}

/** An interactive `Transaction` is identified by its commit/rollback pair.
 * We probe structurally instead of importing the type so this module stays
 * dependency-free (see the header comment). */
type MaybeTransaction = SqlHandle & { commit?: unknown; rollback?: unknown };

function isInteractiveTransaction(db: SqlHandle): boolean {
  const candidate = db as MaybeTransaction;
  // SAFETY: structural capability probe only — no value is reinterpreted.
  return (
    typeof candidate.commit === "function" &&
    typeof candidate.rollback === "function"
  );
}

async function directPipelineExecute(
  sql: string,
  args: unknown[] = [],
  dbUrl?: string,
  dbToken?: string
): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  const formattedArgs = args.map((a) => {
    if (a === null || a === undefined) return { type: "null" };
    if (typeof a === "number")
      return Number.isInteger(a)
        ? { type: "integer", value: String(a) }
        : { type: "float", value: a };
    return { type: "text", value: String(a) };
  });

  let host = resolveTursoUrl(dbUrl);
  const token = resolveToken(dbToken);
  if (host.startsWith("libsql://")) host = host.replace("libsql://", "https://");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    res = await fetch(`${host}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        requests: [
          {
            type: "execute",
            stmt: {
              sql,
              args: formattedArgs,
            },
          },
          { type: "close" },
        ],
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Turso pipeline HTTP ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const execResult = json.results?.[0]?.response?.result;
  if (!execResult) return { rows: [] };

  const cols: string[] = execResult.cols.map((c: { name: string }) => c.name);
  const rows: Record<string, unknown>[] = (execResult.rows || []).map(
    (row: Array<{ value?: unknown }>) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((col, idx) => {
        const cell = row[idx];
        obj[col] = cell?.value !== undefined ? cell.value : null;
      });
      return obj;
    }
  );

  return { rows, rowsAffected: execResult?.affected_row_count ?? 0 };
}

export async function run(
  db: SqlHandle,
  sql: string,
  args: unknown[] = []
): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  try {
    const res = await db.execute({ sql, args });
    return { rows: res.rows ?? [], rowsAffected: res.rowsAffected };
  } catch (err) {
    if (isInteractiveTransaction(db)) {
      // Rule 9 (no silent failures) + Rule 7 (BR-SYN-01): a failed statement
      // inside an open transaction must abort that transaction. Falling back
      // to the HTTP pipeline here would re-run the statement *outside* BEGIN,
      // escaping the atomicity the ledger routes depend on — the exact
      // "5 separate awaits, no transaction" defect audit 2026-09-26 G2.
      throw err;
    }
    try {
      return await directPipelineExecute(sql, args);
    } catch (pipelineErr) {
      // P3-10, Rule 9: the fallback must never be able to hide WHY the primary
      // handle failed. A real statement error (a column renamed under a stale
      // INSERT, a constraint violation) would otherwise be reported as a Turso
      // HTTP failure and point the operator at the network instead of at the
      // SQL. Chain both — message for logs, `cause` for the primary root cause.
      const primary = err instanceof Error ? err.message : String(err);
      const fallback =
        pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
      throw new Error(`statement failed: ${primary} (pipeline fallback: ${fallback})`, {
        cause: err,
      });
    }
  }
}

export async function allRows(
  db: SqlHandle,
  sql: string,
  args: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const res = await run(db, sql, args);
  return res.rows ?? [];
}

export async function oneRow(
  db: SqlHandle,
  sql: string,
  args: unknown[] = []
): Promise<Record<string, unknown> | null> {
  const rows = await allRows(db, sql, args);
  return rows[0] ?? null;
}

export async function batchExecute(
  stmts: string[],
  dbUrl?: string,
  dbToken?: string
): Promise<void> {
  let host = resolveTursoUrl(dbUrl);
  const token = resolveToken(dbToken);

  if (host.startsWith("libsql://")) {
    host = host.replace("libsql://", "https://");
  }

  // The pipeline protocol wants a bare `{"type":"close"}` as the final request;
  // typing `stmt` as optional avoids a cast on the array (AGENTS.md §6.1).
  const requests: { type: string; stmt?: { sql: string; args: never[] } }[] =
    stmts.map((sql) => ({
      type: "execute",
      stmt: { sql, args: [] },
    }));
  requests.push({ type: "close" });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    res = await fetch(`${host}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ requests }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Turso pipeline HTTP ${res.status}: ${errText}`);
  }
}
