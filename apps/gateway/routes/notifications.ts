import type { RouteHandler } from "./students.ts";
import { ok, failZod } from "../lib/errors.ts";
import { recordAudit, recordOutbox } from "./students.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { encodeOutboxPayload } from "../../../packages/shared/src/outboxPayload.ts";
import { z } from "zod";

const NOTIFICATION_CATEGORIES = ["fee", "attendance", "student", "system", "reminder"] as const;

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
    const limit = Math.min(50, parseInt(sp.get("limit") ?? "20", 10));
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
    // read-state stub (no DB write, no outbox row), so the key+response are
    // stored standalone: there is no paired effect to be atomic with, and a
    // replay is trivially consistent.
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const id = path.split("/").pop()!;
    const env = okEnvelope(200, { id, read: true });
    try {
      await storeIdempotentResponse(db, tenantId, idemRoute, idemKey, env.code, env.body);
    } catch (err) {
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
    return ok({ id, read: true });
  }

  return null;
};
