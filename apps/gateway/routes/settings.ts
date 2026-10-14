import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod, failValidation } from "../lib/errors.ts";
import { logWarn } from "../lib/log.ts";
import { recordAudit, recordOutbox } from "./students.ts";
import { getCached, setCache, invalidateTenant, REFERENCE_TTL_MS } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { CasConflictError, casConflictResponse, readCasBase } from "../lib/cas.ts";
import { constantTimeCompare, pinProof } from "../lib/crypto.ts";
import { z } from "zod";

// P0 SECURITY FIX, kept Zod-first (AGENTS.md §6.1): the original spread
// `...body` pattern allowed arbitrary field injection (pinHash, tenantSecret,
// plan, tenantId…). This object IS the allowlist — it replaces the
// ALLOWED_SETTINGS_FIELDS Set with the same keys, so unknown fields are still
// stripped, and every listed key is now type-checked as well (audit 2026-09-26
// "settings PATCH (audit only)" / S3-S4 allowlist findings).
const settingsText = z.string().max(500);
const settingsInt = z.number().int().min(0);
// Web writes flags as 0/1 (notifications-section.tsx:94), so both shapes pass.
const settingsFlag = z.union([z.boolean(), z.number().int().min(0).max(1)]);

const SETTINGS_PATCH_SCHEMA = z.object({
  instituteName: settingsText, institute_name: settingsText,
  instituteAddress: settingsText, institute_address: settingsText,
  institutePhone: settingsText, institute_phone: settingsText,
  instituteEmail: settingsText, institute_email: settingsText,
  currencyCode: settingsText, currency_code: settingsText,
  locale: settingsText, timezone: settingsText,
  defaultFeeModel: settingsText, default_fee_model: settingsText,
  invoicePrefix: settingsText, invoice_prefix: settingsText,
  receiptPrefix: settingsText, receipt_prefix: settingsText,
  graceDays: settingsInt, grace_days: settingsInt,
  autoInvoice: settingsFlag, auto_invoice: settingsFlag,
  attendanceLockHours: settingsInt, attendance_lock_hours: settingsInt,
  defaultAttendanceStatus: settingsText, default_attendance_status: settingsText,
  notifyDueFee: settingsFlag, notify_due_fee: settingsFlag,
  notifyUpcomingDue: settingsFlag, notify_upcoming_due: settingsFlag,
  notifyMissingAttendance: settingsFlag, notify_missing_attendance: settingsFlag,
  notifyInactiveStudent: settingsFlag, notify_inactive_student: settingsFlag,
  sessionTimeoutMin: settingsInt, session_timeout_min: settingsInt,
  biometricEnabled: settingsFlag, biometric_enabled: settingsFlag,
  autoArchiveInactiveDays: settingsInt, auto_archive_inactive_days: settingsInt,
  theme: settingsText, palette: settingsText, density: settingsText,
  reducedMotion: settingsFlag, reduced_motion: settingsFlag,
}).partial();

// N1 — the PIN-proof replica schema (12_Business_Rules.md BR-SYN-01 /
// BR-SEC-04, 10_Security.md §18.1). Narrow by construction: the ONLY fields a
// sync-apply may carry are the replica payload `setPinAction` mints — the proof,
// the genuine hash, and the marker (`pin_updated_at` + `pin_proof` + `pin_hash`,
// either spelling). The proof keeps the openapi `secureErase` bounds (64
// lowercase hex) so a malformed value is a typed 400 before it can reach
// storage or the constant-time comparison in routes/security.ts. The hash is a
// bounded opaque string: the edge never verifies it (no argon2) and must not
// pin its format, or a future KDF rotation bricks at the sync layer instead of
// at verification.
const pinProofHex = z.string().regex(/^[0-9a-f]{64}$/, "pin_proof must be 64 lowercase hex chars");
const pinHashOpaque = z.string().min(1).max(500);
const pinUpdatedAtMarker = z.string().min(1).max(100);

// F-03 — the PIN itself, carried so the EDGE can DERIVE the proof instead of
// trusting the caller's claim to have derived one. Bound exactly as the PIN is
// everywhere else (BR-SEC-05: setup is 6+, grandfathered 4 is honoured at
// verification). This is not the PIN at rest: it is a write-only input to one
// HMAC, never stored, never logged, never echoed, and the response is a bare
// `{ applied: true }`.
const syncApplyPin = z.string().regex(/^\d{4,8}$/, "pin must be 4-8 digits");
const SETTINGS_SYNC_APPLY_SCHEMA = z.object({
  pinProof: pinProofHex, pin_proof: pinProofHex,
  pinHash: pinHashOpaque, pin_hash: pinHashOpaque,
  pinUpdatedAt: pinUpdatedAtMarker, pin_updated_at: pinUpdatedAtMarker,
  pin: syncApplyPin,
}).partial();

export const handleSettings: RouteHandler = async (req, db, tenantId, path, method) => {
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/settings
  if (path === "/api/v1/settings" && method === "GET") {
    const settingsCacheKey = `settings:${tenantId}`;
    const cached = getCached(settingsCacheKey);
    if (cached) return ok(cached);

    const setting = await orm.setting.findFirst({ where: {} });
    // 10_Security.md §1/§3.4 (tenant_secret + pin_hash never leave the DB in
    // plaintext) — the row is projected BEFORE it is cached or returned, so
    // neither the edge cache nor any caller can echo secrets (anti-tamper
    // parity). Mirrors the graphql `settings` resolver projection.
    const safe = toSafeSettings(setting);
    setCache(settingsCacheKey, safe, REFERENCE_TTL_MS);
    return ok(safe);
  }

  // PATCH /api/v1/settings
  if (path === "/api/v1/settings" && method === "PATCH") {
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    // RFC-004 C4 — the CAS base is read from the RAW body: it must never enter
    // the Zod allowlist below (which becomes the DB update), or clients could
    // write `base_updated_at` as a settings column.
    const casBase = readCasBase(body);
    if (casBase === "INVALID") {
      return failValidation("base_updated_at must be an ISO timestamp string (RFC-004 C4)");
    }
    if (Object.keys(body).length === 0) return fail("no_valid_fields", 400);

    const parsed = SETTINGS_PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);

    // A field the allowlist does not name is REJECTED, not stripped-and-ignored.
    //
    // `z.object().partial()` silently drops unknown keys, so a client that
    // PATCHed `{ next_receipt_seq: 1 }` — the monotonic sequence counter that
    // BR-RC-01 says is consumed forever and never rewound — got HTTP 200 and a
    // settings row unchanged. That is the "accept and drop" defect: the caller
    // is told the write happened. It matters most for the fields a client would
    // most plausibly try to reach: `pin_hash`, `tenant_secret`, `plan`,
    // `next_invoice_seq`, `next_receipt_seq`, `next_student_seq`, `tenant_id`,
    // `created_at` (AGENTS.md §2 Rule 1/6, BR-RC-01).
    //
    // This runs BEFORE the empty-payload guard so a PATCH whose every field is
    // unknown names the offending field rather than the generic `no_valid_fields`.
    //
    // `base_updated_at` is excluded: RFC-004 C4 reads it from the RAW body and it
    // must never enter the Zod allowlist, so a legitimate CAS-only PATCH
    // (compare-and-swap probe with nothing to change) is not an injection.
    const CAS_KEYS = new Set(["base_updated_at", "baseUpdatedAt"]);
    const rejected = Object.keys(body).filter((k) => !CAS_KEYS.has(k) && !(k in parsed.data));
    if (rejected.length > 0) {
      return failValidation(
        `not a writable settings field: ${rejected.join(", ")}. ` +
          "A settings PATCH may only carry the fields a tutor sets in " +
          "08_Settings.md — institute identity, currency/locale, fee model, " +
          "invoice/receipt prefixes, grace days, auto-invoice, attendance lock, " +
          "notification toggles, session/biometric/auto-archive, theme/palette/" +
          "density/reduced-motion. Secret columns (pin_hash, tenant_secret, " +
          "backup_passphrase_hash) and the monotonic sequence counters " +
          "(next_invoice_seq, next_receipt_seq, next_student_seq) are " +
          "server-owned (BR-RC-01) and are never client-writable.",
      );
    }

    const filteredBody = parsed.data;
    if (Object.keys(filteredBody).length === 0) {
      return fail("no_valid_fields", 400);
    }

    // Flags are INTEGER columns in the DDL (`auto_invoice INTEGER DEFAULT 0`,
    // lib/schema.ts:31). The allowlist deliberately accepts a JSON boolean
    // because clients send both shapes — but a JS boolean is not a bindable
    // SQLite value and reaches the driver as-is, so it fails at execute time
    // (or, worse on a lenient driver, coerces unpredictably). Normalise here,
    // once, so the column type and the wire type can differ safely.
    const normalisedBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filteredBody)) {
      normalisedBody[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
    }

    let updated: Record<string, unknown> | null;
    try {
      updated = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        // RFC-004 C4 — compare-and-swap on the settings singleton, read in the
        // SAME transaction that writes (no TOCTOU). Absent base = documented
        // legacy last-write-wins; no existing row = creation, nothing to
        // conflict with.
        const current = await txOrm.setting.findFirst({ where: {} });
        if (current && casBase && casBase !== String(current.updatedAt ?? "")) {
          throw new CasConflictError(toSafeSettings(current));
        }
        const row = await txOrm.setting.upsert({
          where: { tenantId },
          create: {
            instituteName: normalisedBody.instituteName ?? normalisedBody.institute_name ?? "My Tuition",
            ...normalisedBody,
          },
          update: normalisedBody,
        });

        // Rule 7 (12_Business_Rules.md BR-SYN-01 / BR-SEC-03) — the settings
        // upsert writes sync_outbox alongside audit_log in the SAME write
        // transaction (fail-closed on any write failure).
        // Op is "update" (not "upsert"): the migration CHECK on sync_outbox.op
        // allows only (insert, update, soft_delete), and the audit row below
        // already records this mutation as "settings.update".
        await recordOutbox(tx, tenantId, "settings", tenantId, "update", normalisedBody);
        await recordAudit(tx, tenantId, tenantId, "settings.update", "settings", tenantId, normalisedBody);
        // RFC-004 C1 — response bytes commit atomically with the upsert (see
        // routes/ledger.ts payment path). Never echo the stored row (it carries
        // pin_hash/tenant_secret): project first, same as the GET path.
        const payload = toSafeSettings(row);
        const env = okEnvelope(200, payload);
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return payload;
      });
    } catch (err) {
      if (err instanceof CasConflictError) return casConflictResponse(err.serverRow);
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }

    // Cache invalidation follows COMMIT (a rolled-back transaction left the
    // rows untouched, so the cached GET is still correct).
    invalidateTenant(tenantId);
    return ok(updated);
  }

  // POST /api/v1/settings/sync-apply — the ONLY writer of `pin_proof` (and of
  // the `pin_hash` presence the erase gate reads) on the edge (N1:
  // 10_Security.md §18.1 step 1, BR-SEC-04, contracts/openapi.yaml
  // `secureErase`). The web-local `setPinAction`
  // (apps/web/src/server/actions/settings.ts) stores the argon2id hash AND the
  // HMAC proof in one transaction and replicates BOTH inside its `sync_outbox`
  // payload; this endpoint applies that replica payload to the gateway DB the
  // erase gate actually reads. Without it `storedProof` is "" forever and every
  // edge erase fails closed forever — and the proof alone would not suffice:
  // the gate ALSO requires hash presence ("No PIN configured"), which no public
  // route could establish, so the genuine hash travels with the proof it was
  // derived beside.
  //
  // TRUST REASONING — why this path, and never PATCH:
  //   1. PATCH is the tutor-facing surface (08_Settings.md — institute
  //      identity, toggles, theme…). A client-settable proof there is a
  //      self-issued erase credential: store a known constant, offer the same
  //      constant, and the constant-time comparison passes. So PATCH keeps
  //      rejecting `pin_proof`/`pinProof` AND `pin_hash`/`pinHash` (see the
  //      FORBIDDEN tests), and this schema accepts NOTHING else — any extra key
  //      is a 400 naming the field, never a silent strip (the accept-and-drop
  //      defect, above).
  //   2. The payload this applies is minted server-side by `setPinAction` in
  //      the SAME transaction that stores the hash: first-time setup mints it
  //      for the PIN just chosen; a change mints it only after the OLD PIN
  //      re-verified (08_Settings.md SR-04). Proof and hash travel TOGETHER, in
  //      outbox order, so the replica converges to the latest set — never to a
  //      proof detached from its hash. The hash value is opaque to the edge
  //      (presence is all the gate reads); it is stored, never verified.
  //   3. The credentials never echo: the response is a bare `{ applied: true }`,
  //      the gateway's own outbox row carries only the marker (a credential in
  //      an outbox payload would leak through GET /api/v1/sync/outbox, which
  //      returns full rows), and the audit row carries only the marker. GET
  //      /api/v1/settings keeps projecting both columns out (`toSafeSettings`,
  //      above — `pin_hash` was already stripped there).
  //   4. Every apply is audited as `settings.sync_apply` (NOT `settings.update`,
  //      so a replica write is distinguishable from a tutor edit) in the SAME
  //      write transaction (Rule 7 / BR-SYN-01 / BR-SEC-03, fail-closed).
  // Residual (v1, stated not hidden): session auth cannot cryptographically
  // distinguish a web-minted proof from a hand-crafted one carrying the same
  // shape — same as any v1 replica write. What bounds it: the narrow schema,
  // the per-apply audit row (bulk self-issue is visible forensics), PATCH
  // staying closed, and the erase gate's own rate limit + typed confirm.
  // Long-term hardening is the v2 authenticated sync envelope
  // (10_Security.md §19).
  if (path === "/api/v1/settings/sync-apply" && method === "POST") {
    // RFC-004 C1 — fail-closed like every mutating route.
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    if (typeof body !== "object" || body === null || Object.keys(body).length === 0) {
      return fail("no_valid_fields", 400);
    }

    const parsed = SETTINGS_SYNC_APPLY_SCHEMA.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);

    // Narrow, same as PATCH: an unknown field is REJECTED, not stripped —
    // the sync payload has exactly three fields and anything else is either a
    // confused caller or a probe.
    const rejectedApply = Object.keys(body).filter((k) => !(k in parsed.data));
    if (rejectedApply.length > 0) {
      return failValidation(
        `not a sync-appliable settings field: ${rejectedApply.join(", ")}. ` +
          "A settings sync-apply may only carry the PIN replica payload " +
          "(`pin_proof` + `pin_hash` + `pin_updated_at`, either spelling) " +
          "minted by setPinAction. Every other column — including " +
          "tenant_secret and the monotonic sequence counters — is never " +
          "replica-writable (BR-RC-01, BR-SEC-04).",
      );
    }

    const proof = parsed.data.pin_proof ?? parsed.data.pinProof;
    const hash = parsed.data.pin_hash ?? parsed.data.pinHash;
    const marker = parsed.data.pin_updated_at ?? parsed.data.pinUpdatedAt;
    if (!proof || !hash || !marker) {
      return failValidation(
        "sync-apply requires pin_proof, pin_hash and pin_updated_at " +
          "(the replica payload setPinAction wrote to its sync_outbox row).",
      );
    }

    // ── F-03: THE PROOF IS NOW DERIVED HERE, NOT BELIEVED ──────────────────
    //
    // This route used to store the caller's `pin_proof` verbatim. That made the
    // whole erase gate self-issued: POST a constant 64-hex value, then offer the
    // same constant at erase, and `constantTimeCompare` in routes/security.ts
    // passes — because the caller chose BOTH sides of the comparison. Two HTTP
    // requests destroyed an entire tenant, and `pin_hash` was worse: the design
    // comment above records that the edge stores it and never verifies it, so
    // the same request also satisfied the "No PIN configured" gate at
    // security.ts:108. The repo's own test
    // settings-security-gates.test.ts ("erase succeeds against a gateway DB
    // written ONLY via public routes") proved the chain end to end.
    //
    // The edge holds PIN_PEPPER, the same secret `pinProof` is keyed by, so it
    // can do the derivation itself. `pinProof(tenantId, pin)` is exactly what
    // the web computes; requiring the caller's value to EQUAL it turns "I
    // promise this proof is genuine" into "here is the proof", which requires
    // knowing the PIN. That is the property the gate was supposed to have all
    // along (10_Security.md §18.1 step 1: "lets the edge verify the PIN
    // without ever seeing it" — the HMAC still never stores the PIN).
    //
    // The STORED value is the edge's own `expected`, never the caller's `proof`,
    // so even a caller who somehow guessed a valid pair cannot decouple what is
    // stored from what is verified.
    const offeredPin = parsed.data.pin;
    if (!offeredPin) {
      return failValidation(
        "sync-apply requires `pin` so the edge can verify the proof it is asked " +
          "to store (BR-SEC-04).",
      );
    }
    const expectedProof = await pinProof(tenantId, offeredPin);
    if (proof.length !== expectedProof.length || !constantTimeCompare(proof, expectedProof)) {
      // Deliberately the same shape as the erase gate's refusal: name the field
      // that is wrong, never echo the supplied value (it is attacker-controlled
      // and crosses the wire through sanitizeError).
      logWarn("security.sync_apply_proof_mismatch", { path: "/api/v1/settings/sync-apply" });
      return failValidation(
        "pin_proof does not match the supplied pin. The proof is derived by the " +
          "edge from `pin` and must be the value setPinAction computed.",
      );
    }

    let stored = false;
    try {
      await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        // Ensure the singleton row exists first: `stmtInsertSetting`
        // (lib/sql.ts SETTINGS_INSERT_EXTRA) deliberately drops server-owned
        // columns on CREATE, so credentials passed only to the upsert would be
        // silently lost for a tenant syncing before any PATCH ever ran. The
        // follow-up UPDATE is the single writer of both columns on this path.
        await txOrm.setting.upsert({
          where: { tenantId },
          create: { instituteName: "My Tuition" },
          update: {},
        });
        await txOrm.setting.update({
          where: { tenantId },
          data: { pinProof: expectedProof, pinHash: hash },
        });

        // Rule 7 — the replica write lands with its own outbox + audit rows in
        // the SAME transaction. The outbox payload carries ONLY the marker:
        // credentials there would leak through GET /api/v1/sync/outbox, which
        // returns full rows. The audit metadata likewise carries only the
        // marker — never the credentials (10_Security.md §1/§3.4).
        await recordOutbox(tx, tenantId, "settings", tenantId, "update", { pin_updated_at: marker });
        await recordAudit(tx, tenantId, tenantId, "settings.sync_apply", "settings", tenantId, {
          pin_updated_at: marker,
        });
        // RFC-004 C1 — response bytes commit atomically with the apply (see the
        // PATCH path). Never echo the stored row: it carries pin_proof.
        const env = okEnvelope(200, { applied: true });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        stored = true;
      });
    } catch (err) {
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }

    // Cache invalidation follows COMMIT (same reasoning as PATCH).
    if (!stored) throw new Error("settings.sync_apply committed nothing (Rule 9)");
    invalidateTenant(tenantId);
    return ok({ applied: true });
  }

  // POST /api/v1/settings/pin removed: uncontracted (absent from
  // contracts/openapi.yaml), zero callers in web/mobile/desktop, and it accepted
  // a client-supplied raw hash — the one path that could replace settings.pin_hash
  // without old-PIN re-verification. PIN writes go through the web
  // setPinAction (08_Settings.md SR-04: old PIN first, argon2id hash).

  return null;
};

/**
 * 10_Security.md §1 trust model + §3.4 (the pepper + PIN hash live in the DB,
 * never on the wire): strip every secret-bearing column before a settings row
 * is cached or returned. The PATCH allowlist already blocks WRITES to these
 * columns; this blocks READS. Mirrors graphql/resolvers.ts `settings`.
 */
function toSafeSettings(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const {
    pinHash: _pinHash,
    pin_hash: _pinHashSnake,
    // BR-SEC-04: the edge-verifiable PIN proof. Not the PIN and not reversible,
    // but it IS a credential — it authorises the destructive erase gate — so it
    // must never ride out in a settings projection on the same reasoning as
    // `pin_hash`. Mirrors SETTINGS_SECRET_KEYS in apps/web settings.ts.
    pinProof: _pinProof,
    pin_proof: _pinProofSnake,
    panicPinHash: _panicPinHash,
    panic_pin_hash: _panicPinHashSnake,
    tenantSecret: _tenantSecret,
    tenant_secret: _tenantSecretSnake,
    backupPassphraseHash: _backupPassphraseHash,
    backup_passphrase_hash: _backupPassphraseHashSnake,
    ...safe
  } = row;
  return safe;
}
