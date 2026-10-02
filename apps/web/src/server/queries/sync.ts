// Implements: 02_Core_Logic.md §9 (sync engine — outbox depth read);
// web/02_State_and_Data_Flow.md §5 (per-request single-flight via React cache());
// docs/rfc/003-saas-overhaul.md workstream C + §0 (12s bound, typed errors).
// Volatile counter: request-scoped only, NEVER tenant-cached.
"use server";

import { cache } from "react";
import { getAuthenticatedPrisma } from "@/server/get-db";
import { QUERY_TIMEOUT_MS, toTypedQueryError, withQueryTimeout } from "@/server/cache";
import { log } from "@/lib/logger";

export const getPendingSyncCount = cache(async function getPendingSyncCount() {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();

    const count = await withQueryTimeout(
      db.syncOutbox.count({
        where: {
          tenantId: tenantId,
          status: "pending",
        },
      }),
      QUERY_TIMEOUT_MS,
    );

    return { success: true, count };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("sync_count_failed", typed);
    return {
      success: false,
      count: 0,
      error: typed,
    };
  }
});
