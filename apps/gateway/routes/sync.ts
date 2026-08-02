import type { RouteHandler } from "./students.ts";
import { ok } from "../lib/errors.ts";
import { createPrismaOrm } from "../lib/orm.ts";

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
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    return ok({ flushed: ids.length });
  }

  return null;
};
