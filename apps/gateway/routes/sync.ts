import type { RouteHandler } from "./students.ts";
import { run, allRows } from "../lib/db.ts";
import { ok } from "../lib/errors.ts";

export const handleSync: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;

  // GET /api/v1/sync/outbox
  if (path === "/api/v1/sync/outbox" && method === "GET") {
    const limit = Math.min(500, parseInt(sp.get("limit") ?? "100", 10));
    const rows = await allRows(
      db,
      "SELECT * FROM sync_outbox WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?",
      [tenantId, limit],
    );
    return ok(rows);
  }

  // POST /api/v1/sync/outbox (flush)
  if (path === "/api/v1/sync/outbox" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      await run(
        db,
        `UPDATE sync_outbox SET status = 'flushed', flushed_at = ? WHERE tenant_id = ? AND id IN (${ph})`,
        [new Date().toISOString(), tenantId, ...ids],
      );
    }
    return ok({ flushed: ids.length });
  }

  return null;
};
