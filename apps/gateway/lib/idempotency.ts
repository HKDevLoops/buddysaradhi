// Implements: docs/rfc/004-multi-device-network-contract.md C1 (Idempotency-Key)
// + 17_API_Gateway_System.md §3 stage 4 (ROUTE — contract validation before
// SERVICE dispatch) + 12_Business_Rules.md BR-SYN-01 (the stored key commits in
// the SAME write transaction as the mutation it guards).
//
// Double-click, transport retry, and multi-device echo of one intent carry one
// client-minted UUID (any version, validated shape). The gateway persists
// (tenant, route, key) → (response code, response body) for 24h and replays
// the STORED bytes on a duplicate key without re-executing the mutation.
// Expiry is enforced by lazy delete-on-read plus an opportunistic purge on
// every mutation pre-check — no cron (Supabase Free has no scheduler
// guarantee, RFC-004 §3 gateway duties).
import { failValidation } from "./errors.ts";
import {
  oneRow,
  run,
  type SqlHandle,
  stmtIdempotencyFind,
  stmtIdempotencyDeleteOne,
  stmtInsertIdempotencyKey,
  stmtIdempotencyPurge,
} from "./sql.ts";

/** RFC-004 C1 — the server persists a duplicate key's response for 24h. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Request header carrying the client-minted intent UUID (RFC-004 C1). */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** Marker header on a replayed response — the BODY is byte-identical to the
 *  original; only transport headers (request id, timings) differ. */
export const IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replayed";

// Any UUID version (RFC-004: "validated shape" — v7 is the client convention,
// the gateway accepts any well-formed UUID so old clients keep working).
const UUID_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The dedup scope (RFC-004: "Key scope = tenant+route+key"). Route is
 * METHOD + full path, so the same UUID reused on two different routes is two
 * intents, and the same UUID from two tenants never collides (the table's
 * composite PRIMARY KEY enforces exactly this scope).
 */
export function idempotencyRoute(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Raw header value (trimmed) or null when the client sent none. */
export function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isValidIdempotencyKey(value: string): boolean {
  return UUID_SHAPE_RE.test(value);
}

function ttlCutoffIso(): string {
  return new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
}

export interface StoredIdempotentResponse {
  code: number;
  body: string;
}

/**
 * Replay lookup (RFC-004 C1 — "replays the STORED response byte-identically").
 * An expired row is lazily deleted and treated as a miss, so the 24h TTL holds
 * without any scheduler. Returns null on miss.
 */
export async function findStoredIdempotentResponse(
  handle: SqlHandle,
  tenantId: string,
  route: string,
  key: string,
): Promise<StoredIdempotentResponse | null> {
  const findStmt = stmtIdempotencyFind(tenantId, route, key);
  const row = await oneRow(handle, findStmt.sql, findStmt.args);
  if (!row) return null;
  if (typeof row.created_at !== "string" || row.created_at < ttlCutoffIso()) {
    // Lazy TTL sweep: the row outlived its 24h, delete and treat as a miss.
    const delStmt = stmtIdempotencyDeleteOne(tenantId, route, key);
    await run(handle, delStmt.sql, delStmt.args);
    return null;
  }
  return {
    code: Number(row.response_code),
    body: String(row.response_body),
  };
}

/**
 * Persist (code, body) for (tenant, route, key). MUST be called inside the
 * same `withWriteTransaction` as the mutation it guards (BR-SYN-01 atomicity:
 * effect + key commit together, or neither does). The composite PRIMARY KEY
 * makes a concurrent duplicate fail here — the loser's whole transaction rolls
 * back and the caller replays the winner via `replayIfDuplicate`.
 */
export async function storeIdempotentResponse(
  tx: SqlHandle,
  tenantId: string,
  route: string,
  key: string,
  code: number,
  body: string,
): Promise<void> {
  const stmt = stmtInsertIdempotencyKey(tenantId, route, key, code, body);
  await run(tx, stmt.sql, stmt.args);
}

/**
 * Opportunistic TTL purge (RFC-004 §3 — "TTL sweep", no cron): one cheap
 * tenant-scoped DELETE per mutation pre-check. TTL correctness never depends
 * on this — `findStoredIdempotentResponse` lazily deletes expired rows on
 * read — this only bounds table growth.
 */
export async function purgeExpiredIdempotencyKeys(
  handle: SqlHandle,
  tenantId: string,
): Promise<void> {
  const stmt = stmtIdempotencyPurge(tenantId, ttlCutoffIso());
  await run(handle, stmt.sql, stmt.args);
}

/**
 * True when `err` is the composite-PRIMARY-KEY violation on `idempotency_keys`
 * — i.e. a concurrent request committed the same (tenant, route, key) first.
 * Matches SQLite + libSQL message shapes without echoing the key.
 */
export function isIdempotencyKeyConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /idempotency_keys/i.test(message) &&
    /unique constraint failed|primary key|unique violation|constraint/i.test(message);
}

/** Rebuild the stored response byte-identically (same status + same body). */
export function idempotentReplay(code: number, body: string): Response {
  return new Response(body, {
    status: code,
    headers: {
      "Content-Type": "application/json",
      [IDEMPOTENT_REPLAY_HEADER]: "true",
    },
  });
}

/**
 * Race-loser path (RFC-004 K2/K3): the in-transaction key INSERT failed
 * because a concurrent duplicate committed first. That commit rolled this
 * transaction back (no partial effect), so replay the winner's stored bytes.
 * A conflict with NO winner row is a loud throw (Rule 9) — never an invented
 * response.
 */
export async function replayIfDuplicate(
  handle: SqlHandle,
  tenantId: string,
  route: string,
  key: string,
  err: unknown,
): Promise<Response | null> {
  if (!isIdempotencyKeyConflict(err)) return null;
  const stored = await findStoredIdempotentResponse(handle, tenantId, route, key);
  if (!stored) throw err;
  return idempotentReplay(stored.code, stored.body);
}

/**
 * Fail-closed key extraction for route handlers (defence-in-depth behind the
 * index.ts middleware — a handler reached without middleware, e.g. in tests or
 * a future dispatch path, still refuses keyless mutations). Returns the valid
 * key, or a 400 VALIDATION Response the handler returns directly.
 */
export function requireIdempotencyKey(req: Request): string | Response {
  const key = readIdempotencyKey(req);
  if (!key) {
    return failValidation(
      "mutating requests require an Idempotency-Key header carrying a UUID (RFC-004 C1)",
    );
  }
  if (!isValidIdempotencyKey(key)) {
    return failValidation("Idempotency-Key header must be a UUID (RFC-004 C1)");
  }
  return key;
}

/**
 * Canonical `{ success: true, data }` envelope bytes. Handlers store
 * `okEnvelope(status, payload).body` inside the transaction and return
 * `ok(payload, status)` after commit — serialising the SAME object twice, so
 * the persisted bytes are identical to the served bytes by construction.
 */
export function okEnvelope(status: number, data: unknown): { code: number; body: string } {
  return { code: status, body: JSON.stringify({ success: true, data }) };
}

/**
 * Middleware precondition for every mutating REST route (RFC-004 C1,
 * fail-closed): missing/invalid key → 400 VALIDATION (exact failZod shape);
 * duplicate key → byte-identical replay; otherwise null (proceed to the
 * handler, which stores its response in-transaction). Reads never call this —
 * they need no keys.
 */
export async function enforceIdempotencyPrecondition(
  req: Request,
  handle: SqlHandle,
  tenantId: string,
  route: string,
): Promise<Response | null> {
  const key = readIdempotencyKey(req);
  if (!key) {
    return failValidation(
      "mutating requests require an Idempotency-Key header carrying a UUID (RFC-004 C1)",
    );
  }
  if (!isValidIdempotencyKey(key)) {
    return failValidation("Idempotency-Key header must be a UUID (RFC-004 C1)");
  }
  await purgeExpiredIdempotencyKeys(handle, tenantId);
  const stored = await findStoredIdempotentResponse(handle, tenantId, route, key);
  if (stored) return idempotentReplay(stored.code, stored.body);
  return null;
}
