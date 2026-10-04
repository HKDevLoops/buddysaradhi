import type { RouteHandler } from "./students.ts";
import { ok, fail, failValidation } from "../lib/errors.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { logWarn } from "../lib/log.ts";
import { checkRateLimit } from "../lib/crypto.ts";
import {
  eraseTables,
  oneRow,
  run,
  stmtEraseTable,
  stmtSecurityAuditInsert,
  stmtSettingPinPresence,
  type SqlHandle,
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
//
// Gates, in order, each fail-closed (10_Security.md §18.1 step 1, BR-SEC-04):
//
//   1. IDENTITY   — body `tutorId` must equal the JWT-derived tenantId.
//   2. RATE LIMIT — 5 attempts per tenant per 15 min. The global IP limiter does
//      not bound a single authenticated tutor hammering the most destructive
//      endpoint in the product.
//   3. PIN CONFIGURED — the tenant must HAVE a PIN. Without this gate a tutor
//      who never set a PIN could wipe their whole institute from a stolen
//      session, because the only re-auth factor (the PIN) did not exist to be
//      checked. The web already refuses in that state
//      (`deleteAccountAction`, apps/web/src/server/actions/settings.ts:638-640);
//      the edge now refuses too, so the contract does not depend on which client
//      is driving it.
//   4. TYPED CONFIRMATION — `confirm` must be exactly "ERASE".
//
// KNOWN GAP, deliberately not papered over: the edge CANNOT verify the PIN
// itself. `settings.pin_hash` is argon2id(m=64MiB, t=3, p=2) + a secret pepper
// (apps/web/src/lib/crypto.ts:15-34) and the Deno edge runtime has no argon2 —
// WebCrypto offers PBKDF2/SHKDF only, and the npm `argon2` package is a native
// Node addon that will not bundle into an edge isolate. Adding a field named
// `pin` that the gateway then compares against nothing would be decoration that
// reads as re-authentication, so it is not added. Until a WASM argon2id or a
// server-side PIN-proof (HMAC over the PIN keyed by GATEWAY_SHARED_SECRET,
// emitted by the client app) is ratified, gates 1–4 plus the pre-wipe audit row
// are the strongest set the edge can actually enforce. Escalated to the owner
// with file:line references — see the worklog entry for 2026-10-04.
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

    // Gate 2 — rate limit. Keyed on the tenant, not the tenantId alone, so an
    // erase attempt cannot exhaust another endpoint's budget.
    if (!checkRateLimit(`erase:${tenantId}`, 5, 15 * 60_000)) {
      logWarn("security.erase_rate_limited", { tenantId, path });
      return fail("too many erase attempts; wait and try again", 429);
    }

    // Gate 3 — fail closed when no PIN is configured. `pin_hash` is read only
    // for presence; the value never leaves this function and never reaches the
    // audit metadata (10_Security.md §1/§3.4).
    const pinStmt = stmtSettingPinPresence(tenantId);
    const pinRow = await oneRow(
      // SAFETY: `SqlHandle` is the only capability this route uses; `DB` (the
      // libsql client) satisfies it structurally.
      db as unknown as SqlHandle,
      pinStmt.sql,
      pinStmt.args,
    );
    const pinConfigured = typeof pinRow?.pin_hash === "string" && pinRow.pin_hash.length > 0;
    if (!pinConfigured) {
      logWarn("security.erase_pin_unset", { tenantId, path });
      return failValidation(
        "No PIN configured. Set a security PIN in Settings → Security before " +
          "erasing — the erase gate is a PIN confirmation, and there is nothing " +
          "to confirm against. (10_Security.md §18.1 step 1, BR-SEC-04.)",
      );
    }

    // 10_Security.md 18.1 step 2 / BR-SEC-03: erase intent is recorded BEFORE
    // any deletion, fail-closed — this insert is deliberately uncaught, so a
    // failed audit write aborts the erase while nothing has been destroyed.
    // Committed on its own rather than folded into the cascade batch: a
    // rollback that took the intent row with it would leave no forensic record
    // of an erase that was attempted and failed partway.
    // `run()` (lib/sql.ts transport) takes `unknown[]` args, so the audited
    // builder output needs no cast — unlike `db.execute`'s narrow `InArgs`.
    // Metadata records only that a PIN EXISTS, never anything derived from it.
    const initiatedAt = new Date().toISOString();
    const initiatedStmt = stmtSecurityAuditInsert(
      tenantId,
      "security.erase_initiated",
      JSON.stringify({ confirm, pinConfigured: true }),
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
