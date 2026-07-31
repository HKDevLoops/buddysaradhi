import type { RouteHandler } from "./students.ts";
import { run, allRows } from "../lib/db.ts";
import { ok } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";

export const handleNotifications: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;

  // GET /api/v1/notifications
  if (path === "/api/v1/notifications" && method === "GET") {
    const limit = Math.min(50, parseInt(sp.get("limit") ?? "20", 10));
    const rows = await allRows(
      db,
      "SELECT * FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
      [tenantId, limit],
    );
    return ok(rows);
  }

  // POST /api/v1/notifications
  if (path === "/api/v1/notifications" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await run(
      db,
      `INSERT INTO notifications (id, tenant_id, category, title, body, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        body.category ?? "system",
        body.title ?? "Notification",
        body.body ?? null,
        body.refType ?? body.ref_type ?? null,
        body.refId ?? body.ref_id ?? null,
        now,
      ],
    );
    await recordAudit(db, tenantId, tenantId, "notification.create", "notification", id, body);
    return ok({ id }, 201);
  }

  // PATCH /api/v1/notifications/:id
  if (path.startsWith("/api/v1/notifications/") && path !== "/api/v1/notifications/" && method === "PATCH") {
    const id = path.split("/").pop()!;
    await run(
      db,
      "UPDATE notifications SET read_at = ? WHERE tenant_id = ? AND id = ?",
      [new Date().toISOString(), tenantId, id],
    );
    return ok({ id, read: true });
  }

  return null;
};
