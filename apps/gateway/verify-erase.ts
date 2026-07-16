import { PrismaClient } from "./src/prisma-client";
import { secureErase } from "./src/lib/security/secureErase";

const db = new PrismaClient({
  datasourceUrl:
    "file:D:/Projects/buddysaradhi/buddysaradhi/apps/gateway/prisma/dev.db.verifycopy",
});

const TENANT = "verify-tenant-001";

async function main() {
  // Seed a student, a pure join-table row (studentTag), and a normal audit_log row.
  await db.tag.create({
    data: {
      id: "tag_vrf_1",
      tenantId: TENANT,
      name: "VerifyTag",
      createdAt: new Date(),
    },
  });
  const student = await db.student.create({
    data: {
      id: "stu_vrf_1",
      tenantId: TENANT,
      firstName: "Verify",
      admissionDate: "2024-01-01",
      dupKey: "stu_vrf_1",
      createdAt: new Date(),
    },
  });
  await db.studentTag.create({
    data: { studentId: "stu_vrf_1", tagId: "tag_vrf_1" },
  });
  await db.auditLog.create({
    data: {
      id: "aud_vrf_1",
      tenantId: TENANT,
      actor: "test",
      action: "login",
      createdAt: new Date(),
    },
  });

  const before = {
    students: await db.student.count(),
    studentTags: await db.studentTag.count(),
    auditLogs: await db.auditLog.count(),
  };
  console.log("BEFORE:", before);

  const result = await secureErase(db, TENANT);
  console.log("ERASE RESULT:", result);

  const after = {
    students: await db.student.count(),
    studentTags: await db.studentTag.count(),
    auditLogs: await db.auditLog.count(),
    auditActions: await db.auditLog.findMany({ select: { action: true } }),
  };
  console.log("AFTER:", after);

  const ok =
    after.students === 0 &&
    after.studentTags === 0 &&
    after.auditLogs >= 1 &&
    after.auditActions.some((a) => a.action === "erase_initiated");

  console.log(ok ? "VERIFY PASS" : "VERIFY FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(2);
});
