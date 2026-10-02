import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { invalidateTenant } from "../lib/cache.ts";
import {
  eraseTables,
  run,
  stmtEraseTable,
  stmtSecurityAuditInsert,
} from "../lib/sql.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";

// POST /api/v1/security/erase — implements contracts/openapi.yaml
// operationId `secureErase` ("Securely erase all tutor data").
// Identity: the JWT-derived tenantId must match the body tutorId.
// Confirmation: typed phrase "ERASE" per 10_Security.md 18.1 step 1 and the
// auth-svc reference implementation (apps/services/auth-svc). PIN verification
// is the app layer's gate (web deleteAccountAction, BR-SEC-04) — the edge
// runtime has no argon2 and must never compare raw client-supplied hashes.
export const handleSecurity: RouteHandler = async (req, db, tenantId, path, method) => {
  if (path === "/api/v1/security/erase" && method === "POST") {
    // RFC-004 C1 — fail-closed like every mutating route. The erase flow is
    // not a single `withWriteTransaction` (it cascades via `db.batch`), so the
    // key+response persist in a standalone INSERT after the cascade: a missed
    // store only risks REPEATING an erase that is naturally idempotent
    // (re-deleting nothing), never a duplicate effect.
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const { tutorId, confirm } = body as { tutorId?: unknown; confirm?: unknown };

    if (typeof tutorId !== "string" || tutorId !== tenantId) {
      return fail("tutorId must match the authenticated tenant", 400);
    }
    if (confirm !== "ERASE") {
      return fail("confirm must be 'ERASE'", 400);
    }

    // 10_Security.md 18.1 step 2 / BR-SEC-03: erase intent is recorded BEFORE
    // any deletion, fail-closed — this insert is deliberately uncaught, so a
    // failed audit write aborts the erase while nothing has been destroyed.
    // 10_Security.md 18.1 step 2 / BR-SEC-03: erase intent is recorded BEFORE
    // any deletion, fail-closed — this insert is deliberately uncaught, so a
    // failed audit write aborts the erase while nothing has been destroyed.
    // `run()` (lib/sql.ts transport) takes `unknown[]` args, so the audited
    // builder output needs no cast — unlike `db.execute`'s narrow `InArgs`.
    const initiatedAt = new Date().toISOString();
    const initiatedStmt = stmtSecurityAuditInsert(
      tenantId,
      "security.erase_initiated",
      JSON.stringify({ confirm }),
      initiatedAt
    );
    await run(db, initiatedStmt.sql, initiatedStmt.args);

    // 10_Security.md 18.1 step 4 — ONE atomic cascade (libsql batch = single
    // transaction) over every tenant-scoped runtime table (lib/schema.ts).
    // LEDGER-4's single audited exception: physical ledger deletion exists only
    // in the secure-erase flow; every other path posts a void.
    const tables = [...eraseTables()];
    await db.batch(
      tables.map((table) => {
        // SAFETY: `tables` comes from `eraseTables()` (audited allowlist in
        // lib/sql.ts) — every element is a valid erase-table union member; and
        // every builder arg is a Zod-validated string/number/null, which is
        // exactly libsql's `InValue` (the `unknown[]` is only wider for the
        // dependency-free `SqlHandle` transport).
        const stmt = stmtEraseTable(table as never, tenantId);
        return { sql: stmt.sql, args: stmt.args as never[] };
      }),
      "write",
    );

    // 18.1 step 7: erase_complete recorded AFTER the cascade — it and
    // erase_initiated's pre-wipe attempt are what remain of the audit chain.
    const completeStmt = stmtSecurityAuditInsert(
      tenantId,
      "security.erase_complete",
      JSON.stringify({ tables }),
      new Date().toISOString()
    );
    await run(db, completeStmt.sql, completeStmt.args);

    invalidateTenant(tenantId);
    const env = okEnvelope(200, { success: true });
    try {
      await storeIdempotentResponse(db, tenantId, idemRoute, idemKey, env.code, env.body);
    } catch (err) {
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
    return ok({ success: true });
  }

  return null;
};
