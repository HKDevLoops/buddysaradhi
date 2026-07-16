import { Elysia } from "elysia";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { StudentSchema } from "@buddysaradhi/shared";

const db = new PrismaClient();

function parseCsvParam(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveAdmissionCutoff(admittedInLast?: string): string | null {
  if (!admittedInLast || admittedInLast === "all") return null;

  const daysMap: Record<string, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };
  const days = daysMap[admittedInLast];
  if (!days) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

export const app = new Elysia()
  .group("/api/v1/students", (app) =>
    app
      .get("/", async ({ request, query, error }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });

        const {
          search,
          page = "1",
          pageSize = "10",
          status,
          feeModels,
          batchIds,
          tagIds,
          balanceRange,
          admittedInLast,
          sortCol,
          sortDir,
        } = query as Record<string, string>;
        const p = Math.max(1, parseInt(page || "1", 10));
        const ps = Math.min(100, Math.max(1, parseInt(pageSize || "10", 10)));
        const statusFilter = parseCsvParam(status);
        const feeModelFilter = parseCsvParam(feeModels);
        const batchFilter = parseCsvParam(batchIds);
        const tagFilter = parseCsvParam(tagIds);
        const admissionCutoff = resolveAdmissionCutoff(admittedInLast);

        const whereClause: any = { tenantId: tutorId };
        if (search) {
          whereClause.OR = [
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { code: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
            { school: { contains: search } },
            { grade: { contains: search } },
          ];
        }
        if (statusFilter.length) {
          whereClause.status = { in: statusFilter };
        }
        if (feeModelFilter.length) {
          whereClause.feeModel = { in: feeModelFilter };
        }
        if (batchFilter.length) {
          whereClause.enrollments = {
            some: {
              batchId: { in: batchFilter },
              exitedOn: null,
            },
          };
        }
        if (tagFilter.length) {
          whereClause.tags = {
            some: {
              tagId: { in: tagFilter },
            },
          };
        }
        if (balanceRange === "zero") {
          whereClause.balancePaise = 0;
        } else if (balanceRange === "has_dues" || balanceRange === "overdue_only") {
          whereClause.balancePaise = { gt: 0 };
        }
        if (admissionCutoff) {
          whereClause.admissionDate = { gte: admissionCutoff };
        }

        const orderBy =
          sortCol === "code"
            ? [{ code: sortDir === "desc" ? "desc" : "asc" }]
            : sortCol === "balance"
              ? [{ balancePaise: sortDir === "desc" ? "desc" : "asc" }]
              : [{ firstName: sortDir === "desc" ? "desc" : "asc" }];

        const [total, students] = await db.$transaction([
          db.student.count({ where: whereClause }),
          db.student.findMany({
            where: whereClause,
            skip: (p - 1) * ps,
            take: ps,
            orderBy,
            include: {
              enrollments: {
                where: { exitedOn: null },
                orderBy: { joinedOn: "desc" },
                take: 1,
                include: { batch: true },
              },
            },
          }),
        ]);

        return {
          success: true,
          data: {
            total,
            students: students.map((s) => ({
              id: s.id,
              code: s.code,
              name: [s.firstName, s.lastName].filter(Boolean).join(" "),
              grade: s.grade,
              batch: s.enrollments[0]?.batch?.name ?? null,
              fee_model: s.feeModel,
              status: s.status,
              balance_due: s.balancePaise,
            })),
          },
        };
      })
      .get("/:id", async ({ params: { id }, request, error }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });

        const student = await db.student.findUnique({
          where: { id },
        });

        if (!student || student.tenantId !== tutorId) return error(404, "Student Not Found");
        return {
          success: true,
          data: {
            id: student.id,
            tenant_id: student.tenantId,
            code: student.code,
            first_name: student.firstName,
            last_name: student.lastName,
            dob: student.dob,
            gender: student.gender,
            phone: student.phone,
            email: student.email,
            address: student.address,
            school: student.school,
            grade: student.grade,
            board: student.board,
            admission_date: student.admissionDate,
            status: student.status,
            fee_model: student.feeModel,
            baseFeePaise: student.baseFeePaise,
            dup_key: student.dupKey,
            merged_into_id: student.mergedIntoId,
            custom_fields: student.customFields,
            notes: student.notes,
            archived_at: student.archivedAt?.toISOString() ?? null,
            created_at: student.createdAt.toISOString(),
            updated_at: student.updatedAt.toISOString(),
          },
        };
      })
      .post("/", async ({ body, request, error }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });
        
        const batchName = request.headers.get("X-Batch-Name");
        
        try {
          const parsed = StudentSchema.partial().parse(body);
          if (!parsed.first_name || !parsed.admission_date) {
            return error(400, "Missing required fields");
          }
          const newId = parsed.id || randomUUID();
          const now = new Date();

          const setting = await db.setting.findUnique({ where: { tenantId: tutorId }, select: { instituteName: true } });
          const instStr = (setting?.instituteName || "Tuition").trim().toUpperCase();
          const instFirst = instStr[0] || 'X';
          const instLast = instStr[instStr.length - 1] || 'X';

          const sStr = (parsed.first_name + (parsed.last_name || '')).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          const sFirst = sStr[0] || 'X';
          const sLast = sStr[sStr.length > 0 ? sStr.length - 1 : 0] || 'X';

          const gStr = (parsed.grade || "NA").toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || "NA";
          const d = new Date(parsed.admission_date);
          const year = isNaN(d.getTime()) ? now.getFullYear() : d.getFullYear();

          const generatedCode = `${instFirst}${instLast}-${sFirst}${sLast}-${gStr}-${year}`;

          const studentData = {
            id: newId,
            tenantId: tutorId,
            code: generatedCode,
            firstName: parsed.first_name,
            lastName: parsed.last_name ?? null,
            dob: parsed.dob ?? null,
            gender: parsed.gender ?? null,
            phone: parsed.phone ?? null,
            email: parsed.email ?? null,
            address: parsed.address ?? null,
            school: parsed.school ?? null,
            grade: parsed.grade ?? null,
            board: parsed.board ?? null,
            admissionDate: parsed.admission_date,
            status: parsed.status || 'active',
            feeModel: parsed.fee_model || 'postpaid',
            baseFeePaise: parsed.baseFeePaise ? parseInt(parsed.baseFeePaise.toString()) : 0,
            dupKey: `${tutorId}_${(parsed.first_name + (parsed.last_name || '')).toLowerCase()}_${parsed.phone || ''}`,
            createdAt: now,
            updatedAt: now,
          };

          const newStudent = await db.$transaction(async (tx) => {
            let batchId = null;
            if (batchName) {
              const bn = batchName.trim();
              let batch = await tx.batch.findFirst({
                where: { tenantId: tutorId, name: { equals: bn } }
              });
              if (!batch) {
                batch = await tx.batch.create({
                  data: {
                    id: randomUUID(),
                    tenantId: tutorId,
                    name: bn,
                    createdAt: now,
                    updatedAt: now,
                  }
                });
              }
              batchId = batch.id;
            }

            const createData: any = { ...studentData };
            if (batchId) {
              createData.enrollments = {
                create: {
                  id: randomUUID(),
                  tenantId: tutorId,
                  batchId: batchId,
                  joinedOn: studentData.admissionDate,
                  createdAt: now,
                  updatedAt: now,
                }
              };
            }

            const student = await tx.student.create({ data: createData });
            
            // Sync Outbox Mutation
            await tx.syncOutbox.create({
              data: {
                id: randomUUID(),
                tenantId: tutorId,
                tableName: 'students',
                rowId: student.id,
                op: 'INSERT',
                payload: JSON.stringify(student),
                createdAt: now,
              }
            });
            
            return student;
          });

          return { success: true, data: { ...newStudent, baseFeePaise: newStudent.baseFeePaise.toString() } };
        } catch (err: any) {
          console.error("Student-Svc Error:", err);
          return error(500, { success: false, error: err.message });
        }
      })
  );

// Only listen if not in test environment
if (process.env.NODE_ENV !== "test") {
  app.listen(process.env.PORT || 3032);
  console.log(
    `🦊 student-svc is running at ${app.server?.hostname}:${app.server?.port}`
  );
}
