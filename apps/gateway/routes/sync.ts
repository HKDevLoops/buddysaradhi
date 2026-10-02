import type { RouteHandler } from "./students.ts";
import { ok, failZod } from "../lib/errors.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { z } from "zod";

// AGENTS.md §6.1 — Zod before any use (strictness parity for every mutating
// route). The flush is an acknowledgement, not a mutation: no rows change, so
// no outbox/audit rows are written (Rule 7 covers mutations, not acks).
const SyncFlushSchema = z.object({
  ids: z.array(z.string().uuid()).max(500, "ids exceeds the 500-id flush limit").default([]),
});

export const handleSync: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/sync/outbox
  if (path === "/api/v1/sync/outbox" && method === "GET") {
    const limit = Math.min(500, parseInt(sp.get("limit") ?? "100", 10));
    const rows = await orm.syncOutbox.findMany({
      where: { status: "pending" },
      take: limit,
    });
    return ok(rows);
  }

  // POST /api/v1/sync/outbox (flush)
  if (path === "/api/v1/sync/outbox" && method === "POST") {
    // RFC-004 C1 — fail-closed like every mutating route. The flush is an
    // acknowledgement, not a mutation (no rows change), so the key+response
    // are stored standalone: there is no paired effect to be atomic with.
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = SyncFlushSchema.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const env = okEnvelope(200, { flushed: parsed.data.ids.length });
    try {
      await storeIdempotentResponse(db, tenantId, idemRoute, idemKey, env.code, env.body);
    } catch (err) {
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
    return ok({ flushed: parsed.data.ids.length });
  }

  return null;
};
