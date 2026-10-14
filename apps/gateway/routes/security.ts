import type { RouteHandler } from "./students.ts";
import { ok, fail, failValidation } from "../lib/errors.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { logWarn } from "../lib/log.ts";
import { checkRateLimit, constantTimeCompare } from "../lib/crypto.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  eraseTables,
  oneRow,
  run,
  stmtEraseTable,
  stmtSecurityAuditInsert,
  stmtSettingPinProof,
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
// PIN KNOWLEDGE IS NOW VERIFIED AT THE EDGE (BR-SEC-04, 10_Security.md §18.1).
// This used to check only that a PIN *existed*:
//
//     const pinConfigured = typeof pinRow?.pin_hash === "string" && ...;
//     if (!pinConfigured) return failValidation("No PIN configured...");
//
// which is not re-authentication. It proves a PIN was once set, not that the
// caller knows it, so ANY authenticated session could erase a tutor's entire
// institute — the exact scenario the gate exists to prevent. The gateway boot
// gate's own error string describes it: "a compromised session is enough to
// destroy a tutor's data".
//
// The blocker was real but the conclusion drawn from it was too pessimistic: the
// edge needs argon2 to verify against `pin_hash`, and Deno has no argon2 — but it
// does not need to. `settings.pin_proof` is an HMAC over the PIN under a
// server-side key (apps/web/src/lib/crypto.ts `pinProof`), which WebCrypto CAN
// compute. So the edge now verifies knowledge of the PIN in constant time, and
// the request must carry that proof.
//
// The `confirm: "ERASE"` typed word and the rate limit are retained; both are
// still required, and neither is a substitute for the proof.
//
// BACKWARD COMPATIBILITY: `pin_proof` is nullable and healed in at boot
// (lib/schema.ts ensureColumn). A tenant who has not re-confirmed their PIN yet
// has no proof, and is told to re-confirm in the app — they are NOT able to erase
// from the edge until they do. That is a deliberate tightening of an
// already-broken gate, not a regression: before this change they could erase with
// no PIN at all.
export const handleSecurity: RouteHandler = async (req, db, tenantId, path, method) => {
  if (path === "/api/v1/security/erase" && method === "POST") {
    // RFC-004 C1 — fail-closed like every mutating route. The erase flow commits
    // initiated + cascade + complete in a single `withWriteTransaction` (F-27),
    // so the key+response persist in a standalone INSERT after the commit: a
    // missed store only risks REPEATING an erase that is naturally idempotent
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

    // Gate 3 — fail closed unless the caller can PROVE knowledge of the PIN.
    // `pin_hash` is read only for presence; the value never leaves this function
    // and never reaches the audit metadata (10_Security.md §1/§3.4).
    const pinStmt = stmtSettingPinProof(tenantId);
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

    // Gate 3b — the PIN PROOF. A configured PIN proves nothing about the caller,
    // so the request must carry a proof the edge can verify itself.
    const storedProof = typeof pinRow?.pin_proof === "string" ? pinRow.pin_proof : "";
    if (storedProof.length === 0) {
      logWarn("security.erase_pin_proof_unset", { tenantId, path });
      return failValidation(
        "Re-confirm your security PIN in Settings → Security before erasing. " +
          "This one-time step lets the edge verify the PIN without ever seeing " +
          "it, so an account can only be erased by the person who set the PIN. " +
          "(10_Security.md §18.1 step 1, BR-SEC-04.)",
      );
    }
    const offeredProof = typeof body.pinProof === "string" ? body.pinProof : "";
    // Bound the input BEFORE the constant-time comparison. `constantTimeCompare`
    // iterates the longer of the two operands, so an unbounded caller-supplied
    // string would be walked character by character — a megabyte POST becomes a
    // megabyte of pointless CPU on a destructive endpoint. The contract
    // (contracts/openapi.yaml) and the generated Zod body carry the same bounds;
    // enforcing here as well means the route does not rely on a caller having
    // validated first, which is the only assumption that would be safe to make
    // about a security gate.
    if (offeredProof.length === 0) {
      logWarn("security.erase_pin_proof_missing", { tenantId, path });
      return failValidation(
        "PIN confirmation required to erase this account. (10_Security.md §18.1 step 1.)",
      );
    }
    if (offeredProof.length !== storedProof.length) {
      logWarn("security.erase_pin_proof_malformed", { tenantId, path });
      return fail("PIN confirmation failed; erase blocked", 401);
    }
    if (!constantTimeCompare(storedProof, offeredProof)) {
      logWarn("security.erase_pin_proof_mismatch", { tenantId, path });
      // Deliberately the same message as an empty proof and rate-limited like one:
      // the response must not distinguish "wrong PIN" from "no PIN", or it becomes
      // an oracle for testing guesses. 429 rather than 400 so a guessing client
      // is throttled by the existing per-tenant budget.
      return fail("PIN confirmation failed; erase blocked", 401);
    }

    // 10_Security.md 18.1 step 2 / BR-SEC-03: erase intent is recorded BEFORE
    // any deletion, fail-closed — a failed audit write aborts the erase while
    // nothing has been destroyed.
    //
    // F-27: initiated + cascade + complete commit in ONE write transaction
    // (`withWriteTransaction` — the same mechanism the ledger/fee/attendance
    // routes use; sibling routes confirmed it first). The tx handle exposes
    // only `execute`, not `batch`, so the cascade runs as sequential audited
    // deletes (`stmtEraseTable`, the same builders the batch used) inside the
    // tx instead of a standalone `db.batch`. The previous shape committed
    // `erase_initiated` standalone BEFORE the cascade and `erase_complete`
    // after, so a crash between the commits left a row asserting an erase
    // that never happened. Now a crash anywhere before COMMIT leaves nothing:
    // initiated-without-complete is unobservable. The post-commit state is
    // unchanged (the cascade wipes `audit_log`, so only `erase_complete`
    // survives either way).
    // `run()` (lib/sql.ts transport) takes `unknown[]` args, so the audited
    // builder output needs no cast — unlike `db.execute`'s narrow `InArgs`.
    // Metadata records only that a PIN EXISTS, never anything derived from it.
    const tables = [...eraseTables()];
    const initiatedAt = new Date().toISOString();
    await withWriteTransaction(db, async (tx) => {
      const initiatedStmt = stmtSecurityAuditInsert(
        tenantId,
        "security.erase_initiated",
        JSON.stringify({ confirm, pinConfigured: true }),
        initiatedAt,
      );
      await run(tx, initiatedStmt.sql, initiatedStmt.args);

      // 10_Security.md 18.1 step 4 — the cascade (lib/schema.ts table order is
      // child-before-parent with foreign keys enabled).
      // LEDGER-4's single audited exception: physical ledger deletion exists
      // only in the secure-erase flow; every other path posts a void.
      for (const table of tables) {
        // SAFETY: `tables` comes from `eraseTables()` (audited allowlist in
        // lib/sql.ts) — every element is a valid erase-table union member; and
        // every builder arg is a Zod-validated string/number/null, which is
        // exactly libsql's `InValue` (the `unknown[]` is only wider for the
        // dependency-free `SqlHandle` transport).
        const stmt = stmtEraseTable(table as never, tenantId);
        await run(tx, stmt.sql, stmt.args);
      }

      // 18.1 step 7: erase_complete recorded in the SAME commit — it and
      // erase_initiated's pre-wipe attempt are what remain of the audit chain.
      const completeStmt = stmtSecurityAuditInsert(
        tenantId,
        "security.erase_complete",
        JSON.stringify({ tables }),
        new Date().toISOString(),
      );
      await run(tx, completeStmt.sql, completeStmt.args);
    });

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
