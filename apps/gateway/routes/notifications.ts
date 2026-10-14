import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod } from "../lib/errors.ts";
// AGENTS.md §6.1 — the `:id` path segment is validated as a UUID before it can
// reach the idempotency store, for the same reason the students routes validate
// it (see `parsePathId` in routes/students.ts). `notifications.id` is a UUID
// (prisma/schema.prisma `@default(uuid())`), so a non-UUID id can never name a
// real row; rejecting it changes no legitimate behaviour.
import { parsePathId, recordAudit, recordOutbox } from "./students.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { withWriteTransaction } from "../lib/tx.ts";
// AGENTS.md §3.4 — `notification` has neither `findFirst` nor `update` on the
// ORM shim (lib/orm.ts), so both halves of the read-state write go through the
// AUDITED BUILDERS, which is the other of the two sanctioned runtime access
// paths (the ORM shim and `lib/sql.ts` builders). No SQL text lives in this
// file; `no-raw-sql.test.ts` gates that.
import { oneRow, run, stmtSelectOneWhere, stmtUpdateWhere } from "../lib/sql.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { encodeOutboxPayload } from "../lib/vendor/outboxPayload.ts";
import { z } from "zod";

const NOTIFICATION_CATEGORIES = ["fee", "attendance", "student", "system", "reminder"] as const;
const NOTIFICATION_LIMIT_MAX = 50;
const NOTIFICATION_LIMIT_DEFAULT = 20;

/** `?limit=` — AGENTS.md §6.1 (Zod at every boundary) + Rule 9 (a malformed
 *  input is a typed error, never a 500).
 *
 *  This read as `Math.min(50, parseInt(sp.get("limit") ?? "20", 10))`, which
 *  turns `?limit=abc` into `NaN` (parseInt's failure value, which `Math.min`
 *  propagates) and `?limit=` into `0`. Either value then reached the audited
 *  builder, whose `LimitSchema` is `z.number().int().min(1).max(1000)`, and a
 *  `ZodError` thrown out of a route is not a typed failure — index.ts reports it
 *  as a generic 500. So "limit=abc" was indistinguishable, to the caller, from a
 *  broken database, and "limit=0" reported the same 500 as "limit=-1".
 *
 *  A digits-only regex, applied to the RAW string before any arithmetic, makes
 *  every rejection a typed 400 naming the field, and leaves `Math.min` with a
 *  real integer for the legitimate values (`limit=5`, `limit=50`, `limit=500`
 *  → 50). It never coerces: `?limit=1e3`, `?limit=-5`, `?limit=10.5` and
 *  `?limit=%20` are rejected, where `parseInt` would have silently accepted the
 *  first three and half of the last. */
const NOTIFICATION_LIMIT_SCHEMA = z.object({
  limit: z
    .string()
    .regex(/^[0-9]{1,6}$/, "limit must be a whole number of rows")
    // `0` (and `000`) is digits-only, so the regex above admits it — but it is
    // not a legal page size (`LimitSchema` is `.min(1)`), and accepting it here
    // would move the 500 to the next line rather than remove it.
    .refine((v) => !/^0+$/.test(v), "limit must be at least 1")
    .optional(),
});

/**
 * Rule 9 (no silent failures): a rejection with a defined HTTP status is
 * carried out of the write transaction as a typed error, exactly as
 * `StudentRouteError` does in routes/students.ts. Anything else keeps
 * propagating to index.ts as a typed 500.
 */
class NotificationRouteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "NotificationRouteError";
    this.status = status;
  }
}

// AGENTS.md §6.1 — Zod before any DB touch (strictness parity for every
// mutating route): a failed parse is typed 400 VALIDATION.
const NotificationCreateSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  title: z.string().trim().min(1, "title is required").max(500),
  body: z.string().trim().max(500).nullable().optional(),
  refType: z.string().max(64).nullable().optional(),
  refId: z.string().uuid().nullable().optional(),
});

export const handleNotifications: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/notifications
  if (path === "/api/v1/notifications" && method === "GET") {
    const parsedLimit = NOTIFICATION_LIMIT_SCHEMA.safeParse({
      limit: sp.get("limit") ?? undefined,
    });
    if (!parsedLimit.success) return failZod(parsedLimit.error);
    const limit = Math.min(
      NOTIFICATION_LIMIT_MAX,
      parsedLimit.data.limit === undefined
        ? NOTIFICATION_LIMIT_DEFAULT
        : Number(parsedLimit.data.limit),
    );
    const rows = await orm.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return ok(rows);
  }

  // POST /api/v1/notifications
  if (path === "/api/v1/notifications" && method === "POST") {
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = NotificationCreateSchema.safeParse({
      category: typeof body.category === "string" ? body.category.trim() : body.category,
      title: typeof body.title === "string"
        // deno-lint-ignore no-control-regex
        ? body.title.replace(/[\x00-\x1f\x7f]/g, "").trim()
        : body.title,
      body: body.body === undefined || body.body === null
        ? body.body ?? null
        : String(body.body),
      refType: body.refType ?? body.ref_type ?? null,
      refId: body.refId ?? body.ref_id ?? null,
    });
    if (!parsed.success) return failZod(parsed.error);
    const { category, title } = parsed.data;
    // deno-lint-ignore no-control-regex
    const bodyText = parsed.data.body ? parsed.data.body.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 500) || null : null;

    // Rule 7 / BR-SYN-01 — audit 2026-09-26 class: this route wrote audit_log
    // but NO sync_outbox row, so a notification created on one device never
    // replicated. Create + outbox + audit share one write transaction.
    let createdId: string;
    try {
      createdId = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        const row = await txOrm.notification.create({
          data: {
            category,
            title,
            body: bodyText,
            refType: parsed.data.refType,
            refId: parsed.data.refId,
          },
        });
        await recordOutbox(tx, tenantId, "notifications", row.id, "create", encodeOutboxPayload("notifications", "create", {
          id: row.id,
          tenant_id: tenantId,
          category,
          title,
        }).payload);
        await recordAudit(tx, tenantId, tenantId, "notification.create", "notification", row.id, { category, title });
        // RFC-004 C1 — response bytes commit atomically with the create (see
        // routes/ledger.ts payment path).
        const env = okEnvelope(201, { id: row.id });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return row.id;
      });
    } catch (err) {
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
    return ok({ id: createdId }, 201);
  }

  // PATCH /api/v1/notifications/:id
  if (path.startsWith("/api/v1/notifications/") && path !== "/api/v1/notifications/" && method === "PATCH") {
    // RFC-004 C1 — fail-closed like every mutating route. This endpoint is a
    // real mutation now (it writes `read_at`), so the key, the effect and the
    // response bytes commit together in ONE write transaction (BR-SYN-01) — the
    // atomic pairing every other mutating route in this file already has.
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const parsedId = parsePathId(path.split("/").pop() ?? "");
    if (!parsedId.ok) return parsedId.response;
    const id = parsedId.id;
    const markedAt = new Date().toISOString();

    let read: { id: string; read: true; readAt: string };
    try {
      read = await withWriteTransaction(db, async (tx) => {
        // Existence is asserted INSIDE the transaction (no TOCTOU: the row
        // cannot be deleted between the check and the write). This block is the
        // whole point of the fix — the handler used to validate the id's SHAPE,
        // write nothing at all, and answer `{ read: true }` for a row that may
        // not have ever existed. "Marked as read" is a fact about a stored row;
        // reporting it for a row that is not there is a lie Rule 9 exists to
        // prevent, and it is unrecoverable in the UI: the tutor marks a
        // notification read, it disappears from the badge, and nothing was
        // stored.
        const existingStmt = stmtSelectOneWhere("notifications", tenantId, { id });
        const existing = await oneRow(tx, existingStmt.sql, existingStmt.args);
        if (!existing) throw new NotificationRouteError("not_found", 404);

        // Idempotent by construction: a row that is already read keeps its
        // ORIGINAL `read_at`. Marking read twice must not move the timestamp a
        // tutor's other devices are ordering by.
        const previousReadAt = typeof existing.read_at === "string" ? existing.read_at : "";
        const readAt = previousReadAt.length > 0 ? previousReadAt : markedAt;
        if (readAt !== previousReadAt) {
          const stmt = stmtUpdateWhere("notifications", tenantId, { id }, { readAt });
          await run(tx, stmt.sql, stmt.args);
        }

        // Rule 7 / BR-SYN-01 + BR-SEC-03 — the read-state change, its
        // `sync_outbox` row (it is a mutation, so it must replicate to the
        // tutor's other devices) and its `audit_log` row share ONE write
        // transaction. `recordOutbox`/`recordAudit` are fail-closed: a failed
        // write aborts this transaction rather than reporting a read-state
        // change that will never replicate.
        await recordOutbox(
          tx,
          tenantId,
          "notifications",
          id,
          "update",
          encodeOutboxPayload("notifications", "update", { id, read_at: readAt }).payload,
        );
        await recordAudit(tx, tenantId, tenantId, "notification.read", "notification", id, {
          id,
          read_at: readAt,
        });

        // RFC-004 C1 — response bytes commit atomically with the write. The
        // 404 above aborts WITHOUT storing, so a retry with the same key
        // re-executes (and still 404s — the row genuinely does not exist).
        const payload = { id, read: true as const, readAt };
        const env = okEnvelope(200, payload);
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return payload;
      });
    } catch (err) {
      if (err instanceof NotificationRouteError) return fail(err.message, err.status);
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
    return ok(read);
  }

  return null;
};
