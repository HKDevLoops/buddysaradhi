"use server";

import { getAuthenticatedPrisma } from "@/server/get-db";

export async function getPendingSyncCount() {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    
    const count = await db.syncOutbox.count({
      where: {
        tenantId: tenantId,
        status: "pending",
      },
    });
    
    return { success: true, count };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
