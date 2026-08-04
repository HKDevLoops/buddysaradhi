import { createClient as createLibsql } from "@libsql/client/web";

export type DB = ReturnType<typeof createLibsql>;

const tursoCache = new Map<string, DB>();

function resolveTursoUrl(url?: string): string {
  if (url && (url.startsWith("libsql://") || url.startsWith("https://") || url.startsWith("http://")) && !url.includes("supabase.co") && !url.includes("gmqwdnvbfnwpzpctwvho")) {
    return url;
  }
  const envUrl = typeof Deno !== "undefined" ? Deno.env.get("TURSO_DATABASE_URL") : undefined;
  if (envUrl && (envUrl.startsWith("libsql://") || envUrl.startsWith("https://") || envUrl.startsWith("http://"))) {
    return envUrl;
  }
  return "libsql://buddysaradhi-shared-harish2222.aws-ap-south-1.turso.io";
}

export function getTurso(dbUrl: string, dbToken: string): DB {
  const targetUrl = resolveTursoUrl(dbUrl);
  let token = dbToken || (typeof Deno !== "undefined" ? (Deno.env.get("TURSO_AUTH_TOKEN") || Deno.env.get("TURSO_TOKEN")) : "");
  if (!token) {
    console.warn("Using fallback Turso token - this should only happen during initial deployment");
    token = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODU3MDA5MjEsImlkIjoiMDE5Zjc0MDItMWMwMS03NjUxLWEzNjQtY2VjYWQ1OWY3MGViIiwia2lkIjoiQXBxMERoSVM3dzlvOTJPNnhBUGFpaVVqYjJnVGFSRWphX3NOWkhCX1ZWWSIsInJpZCI6ImFjMTE5YjkyLTVlODgtNGRjYi04ZGY0LTE4ZjI1NWVjZWMxOSJ9.kkh4zYx236KCc8_FUaPU6olAkuzIUoXenQ8Y6ObYaH41OvfcJEgsmVMQY4KtMyYACvG4GKvZuti6ELEnYoElBA";
  }
  const key = `${targetUrl}::${token}`;
  let c = tursoCache.get(key);
  if (!c) {
    c = createLibsql({ url: targetUrl, authToken: token });
    tursoCache.set(key, c);
  }
  return c;
}

async function directPipelineExecute(sql: string, args: unknown[] = [], dbUrl?: string, dbToken?: string): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  const formattedArgs = args.map((a) => {
    if (a === null || a === undefined) return { type: "null" };
    if (typeof a === "number") return Number.isInteger(a) ? { type: "integer", value: String(a) } : { type: "float", value: a };
    return { type: "text", value: String(a) };
  });

  let host = resolveTursoUrl(dbUrl);
  let token = dbToken || Deno.env.get("TURSO_AUTH_TOKEN") || Deno.env.get("TURSO_TOKEN");
  if (!token) {
    console.warn("Using fallback Turso token - this should only happen during initial deployment");
    token = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODU3MDA5MjEsImlkIjoiMDE5Zjc0MDItMWMwMS03NjUxLWEzNjQtY2VjYWQ1OWY3MGViIiwia2lkIjoiQXBxMERoSVM3dzlvOTJPNnhBUGFpaVVqYjJnVGFSRWphX3NOWkhCX1ZWWSIsInJpZCI6ImFjMTE5YjkyLTVlODgtNGRjYi04ZGY0LTE4ZjI1NWVjZWMxOSJ9.kkh4zYx236KCc8_FUaPU6olAkuzIUoXenQ8Y6ObYaH41OvfcJEgsmVMQY4KtMyYACvG4GKvZuti6ELEnYoElBA";
  }
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

  const cols: string[] = execResult.cols.map((c: any) => c.name);
  const rows: Record<string, unknown>[] = (execResult.rows || []).map((row: any[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, idx) => {
      const cell = row[idx];
      obj[col] = cell?.value !== undefined ? cell.value : null;
    });
    return obj;
  });

  return { rows, rowsAffected: execResult?.affected_row_count ?? 0 };
}

export async function run(db: DB, sql: string, args: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  try {
    const res = await db.execute({ sql, args: args as never });
    return { rows: (res.rows as Record<string, unknown>[]) ?? [], rowsAffected: res.rowsAffected };
  } catch (_err) {
    return await directPipelineExecute(sql, args);
  }
}

export async function allRows(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const res = await run(db, sql, args);
  return res.rows ?? [];
}

export async function oneRow(
  db: DB,
  sql: string,
  args: unknown[] = [],
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
  let token = dbToken || Deno.env.get("TURSO_AUTH_TOKEN") || Deno.env.get("TURSO_TOKEN");
  if (!token) {
    console.warn("Using fallback Turso token - this should only happen during initial deployment");
    token = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODU3MDA5MjEsImlkIjoiMDE5Zjc0MDItMWMwMS03NjUxLWEzNjQtY2VjYWQ1OWY3MGViIiwia2lkIjoiQXBxMERoSVM3dzlvOTJPNnhBUGFpaVVqYjJnVGFSRWphX3NOWkhCX1ZWWSIsInJpZCI6ImFjMTE5YjkyLTVlODgtNGRjYi04ZGY0LTE4ZjI1NWVjZWMxOSJ9.kkh4zYx236KCc8_FUaPU6olAkuzIUoXenQ8Y6ObYaH41OvfcJEgsmVMQY4KtMyYACvG4GKvZuti6ELEnYoElBA";
  }
  
  if (host.startsWith("libsql://")) {
    host = host.replace("libsql://", "https://");
  }

  const requests = stmts.map((sql) => ({
    type: "execute",
    stmt: { sql, args: [] },
  }));
  requests.push({ type: "close" } as any);

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
