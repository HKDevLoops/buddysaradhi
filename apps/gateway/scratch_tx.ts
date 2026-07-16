import { getPrismaClient } from "./src/db";

const db = getPrismaClient("file:./prisma/_txtest.db", "");
try {
  await db.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { tenantId: "txtest" },
      create: { tenantId: "txtest", tenantSecret: "x", createdAt: new Date().toISOString() },
      update: {},
    });
    await tx.setting.update({
      where: { tenantId: "txtest" },
      data: { updatedAt: new Date().toISOString() },
    });
  });
  const s = await db.setting.findUnique({ where: { tenantId: "txtest" }, select: { tenantId: true } });
  console.log("TX_OK", JSON.stringify(s));
} catch (e) {
  console.error("TX_FAIL", e instanceof Error ? e.message : e);
} finally {
  await db.$disconnect();
}
