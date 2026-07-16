"use server";

import { db } from "../../../lib/db";
import { getAdminSession } from "../actions";
import { revalidatePath } from "next/cache";

export async function updateTutorPlanAction(tenantId: string, plan: string) {
  const session = await getAdminSession();
  if (!session) {
    throw new Error("Unauthorized access to dashboard actions.");
  }
  
  await db.setting.update({
    where: { tenantId },
    data: { plan }
  });
  
  revalidatePath("/admin/dashboard");
}
