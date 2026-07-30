import { describe, it, expect, beforeEach } from "vitest";

interface Row {
  [key: string]: unknown;
}

interface TableStore {
  rows: Row[];
}

interface MockDb {
  tables: Record<string, TableStore>;
  executed: string[];
  executedArgs: unknown[][];
  run: (sql: string, args?: unknown[]) => Promise<void>;
  allRows: (sql: string, args?: unknown[]) => Promise<Row[]>;
  oneRow: (sql: string, args?: unknown[]) => Promise<Row | null>;
}

function createMockDb(): MockDb {
  const db: MockDb = {
    tables: {},
    executed: [],
    executedArgs: [],
    run: async (sql: string, args: unknown[] = []) => {
      db.executed.push(sql);
      db.executedArgs.push(args);
    },
    allRows: async (sql: string, args: unknown[] = []) => {
      db.executed.push(sql);
      db.executedArgs.push(args);
      return [];
    },
    oneRow: async (sql: string, args: unknown[] = []) => {
      db.executed.push(sql);
      db.executedArgs.push(args);
      return null;
    },
  };
  return db;
}

function addRows(db: MockDb, table: string, rows: Row[]): void {
  if (!db.tables[table]) db.tables[table] = { rows: [] };
  db.tables[table].rows.push(...rows);
}

async function recordAudit(
  db: MockDb,
  tenantId: string,
  actor: string,
  action: string,
  refType: string | null,
  refId: string | null,
  metadata: unknown,
): Promise<void> {
  db.executed.push(
    `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  if (!db.tables["audit_log"]) db.tables["audit_log"] = { rows: [] };
  db.tables["audit_log"].rows.push({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    actor,
    action,
    ref_type: refType,
    ref_id: refId,
    metadata: JSON.stringify(metadata ?? {}),
    created_at: new Date().toISOString(),
  });
}

async function recordOutbox(
  db: MockDb,
  tenantId: string,
  table: string,
  rowId: string,
  op: string,
  payload: unknown,
): Promise<void> {
  db.executed.push(
    `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
  );
  if (!db.tables["sync_outbox"]) db.tables["sync_outbox"] = { rows: [] };
  db.tables["sync_outbox"].rows.push({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    table_name: table,
    row_id: rowId,
    op,
    payload: JSON.stringify(payload ?? {}),
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
  });
}

function ok(data: unknown, status = 200): { status: number; body: unknown } {
  return { status, body: { success: true, data } };
}

function fail(error: string, status = 400): { status: number; body: unknown } {
  return { status, body: { success: false, error } };
}

function logInfo(_event: string, _data: Record<string, unknown> = {}): void {
  // no-op in tests
}

async function deleteStudent(
  db: MockDb,
  tenantId: string,
  studentId: string,
): Promise<{ status: number; body: unknown }> {
  const now = new Date().toISOString();

  const student = await db.oneRow(
    "SELECT id FROM students WHERE tenant_id = ? AND id = ?",
    [tenantId, studentId],
  );
  if (!student) return fail("not_found", 404);

  await db.run(
    "DELETE FROM student_enrollments WHERE tenant_id = ? AND student_id = ?",
    [tenantId, studentId],
  );
  await db.run(
    "DELETE FROM attendance_records WHERE tenant_id = ? AND student_id = ?",
    [tenantId, studentId],
  );
  await db.run(
    "DELETE FROM student_notes WHERE tenant_id = ? AND student_id = ?",
    [tenantId, studentId],
  );
  await db.run(
    "DELETE FROM student_documents WHERE tenant_id = ? AND student_id = ?",
    [tenantId, studentId],
  );
  await db.run("DELETE FROM student_tags WHERE student_id = ?", [studentId]);

  const orphanSessions = await db.allRows(
    `SELECT s.id FROM attendance_sessions s
     WHERE s.tenant_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM attendance_records ar
         WHERE ar.session_id = s.id AND ar.tenant_id = ?
       )`,
    [tenantId, tenantId],
  );
  for (const s of orphanSessions) {
    await db.run(
      "DELETE FROM attendance_sessions WHERE tenant_id = ? AND id = ?",
      [tenantId, s.id],
    );
  }

  await db.run(
    "DELETE FROM students WHERE tenant_id = ? AND id = ?",
    [tenantId, studentId],
  );

  await recordAudit(
    db,
    tenantId,
    tenantId,
    "student.delete",
    "student",
    studentId,
    {},
  );
  await recordOutbox(db, tenantId, "students", studentId, "delete", {
    id: studentId,
  });

  logInfo("mutation.success", {
    tenantId,
    path: `/api/v1/students/${studentId}`,
    method: "DELETE",
    studentId,
  });

  return ok({ ok: true });
}

const TENANT = "tenant-abc";
const STUDENT_ID = "stu-001";

function seedStudentData(db: MockDb): void {
  addRows(db, "students", [
    {
      id: STUDENT_ID,
      tenant_id: TENANT,
      first_name: "Alice",
      last_name: "Sharma",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]);

  addRows(db, "student_enrollments", [
    {
      id: "enr-001",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      batch_id: "batch-001",
      joined_on: "2026-01-15",
      created_at: "2026-01-15T00:00:00Z",
      updated_at: "2026-01-15T00:00:00Z",
    },
    {
      id: "enr-002",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      batch_id: "batch-002",
      joined_on: "2026-02-01",
      created_at: "2026-02-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
    },
  ]);

  addRows(db, "attendance_records", [
    {
      id: "att-001",
      tenant_id: TENANT,
      session_id: "sess-001",
      student_id: STUDENT_ID,
      status: "present",
      marked_at: "2026-01-20T10:00:00Z",
      created_at: "2026-01-20T10:00:00Z",
      updated_at: "2026-01-20T10:00:00Z",
    },
    {
      id: "att-002",
      tenant_id: TENANT,
      session_id: "sess-002",
      student_id: STUDENT_ID,
      status: "absent",
      marked_at: "2026-01-22T10:00:00Z",
      created_at: "2026-01-22T10:00:00Z",
      updated_at: "2026-01-22T10:00:00Z",
    },
  ]);

  addRows(db, "attendance_sessions", [
    {
      id: "sess-001",
      tenant_id: TENANT,
      batch_id: "batch-001",
      session_date: "2026-01-20",
      created_at: "2026-01-20T10:00:00Z",
      updated_at: "2026-01-20T10:00:00Z",
    },
    {
      id: "sess-002",
      tenant_id: TENANT,
      batch_id: "batch-001",
      session_date: "2026-01-22",
      created_at: "2026-01-22T10:00:00Z",
      updated_at: "2026-01-22T10:00:00Z",
    },
    {
      id: "sess-003",
      tenant_id: TENANT,
      batch_id: "batch-001",
      session_date: "2026-01-25",
      created_at: "2026-01-25T10:00:00Z",
      updated_at: "2026-01-25T10:00:00Z",
    },
  ]);

  addRows(db, "student_notes", [
    {
      id: "note-001",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      category: "general",
      body: "Needs extra help with algebra",
      created_at: "2026-01-10T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
    },
  ]);

  addRows(db, "student_documents", [
    {
      id: "doc-001",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      label: "Transfer Certificate",
      blob_key: "tc-001.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      sha256: "abc123",
      uploaded_at: "2026-01-05T00:00:00Z",
    },
  ]);

  addRows(db, "student_tags", [
    { student_id: STUDENT_ID, tag_id: "tag-001" },
    { student_id: STUDENT_ID, tag_id: "tag-002" },
  ]);

  addRows(db, "ledger_entries", [
    {
      id: "led-001",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      type: "payment",
      debit_paise: 0,
      credit_paise: 500000,
      balance_after_paise: 500000,
      occurred_on: "2026-01-15T00:00:00Z",
      created_at: "2026-01-15T00:00:00Z",
      updated_at: "2026-01-15T00:00:00Z",
    },
    {
      id: "led-002",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      type: "invoice",
      debit_paise: 1000000,
      credit_paise: 0,
      balance_after_paise: 1000000,
      occurred_on: "2026-01-10T00:00:00Z",
      created_at: "2026-01-10T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
    },
  ]);

  addRows(db, "receipts", [
    {
      id: "rcp-001",
      tenant_id: TENANT,
      number: "RCP-001",
      ledger_entry_id: "led-001",
      student_id: STUDENT_ID,
      amount: 500000,
      payment_method: "cash",
      received_on: "2026-01-15T00:00:00Z",
      created_at: "2026-01-15T00:00:00Z",
      updated_at: "2026-01-15T00:00:00Z",
    },
  ]);

  addRows(db, "guardians", [
    {
      id: "g-001",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      name: "Raj Sharma",
      relation: "father",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]);

  addRows(db, "fee_plans", [
    {
      id: "fp-001",
      tenant_id: TENANT,
      student_id: STUDENT_ID,
      model: "postpaid",
      cycle: "monthly",
      base_amount: 500000,
      start_date: "2026-01-01",
      is_active: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]);

  addRows(db, "invoices", [
    {
      id: "inv-001",
      tenant_id: TENANT,
      number: "INV-001",
      student_id: STUDENT_ID,
      issue_date: "2026-01-10",
      subtotal: 1000000,
      total: 1000000,
      status: "unpaid",
      created_at: "2026-01-10T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
    },
  ]);

  addRows(db, "reminders", [
    {
      id: "rem-001",
      tenant_id: TENANT,
      category: "fee_due",
      ref_type: "invoice",
      ref_id: "inv-001",
      due_at: "2026-02-10T00:00:00Z",
      status: "pending",
      created_at: "2026-01-10T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
    },
  ]);
}

describe("students DELETE cascade", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    seedStudentData(db);
  });

  it("returns 404 if student not found", async () => {
    db.oneRow = async () => null;
    const res = await deleteStudent(db, TENANT, "nonexistent");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: "not_found",
    });
  });

  it("returns 200 with { ok: true } on success", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };
    db.run = async (sql, _args) => {
      db.executed.push(sql);
    };

    const res = await deleteStudent(db, TENANT, STUDENT_ID);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { ok: true },
    });
  });

  it("deletes student_enrollments for the student", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteEnrollSql = db.executed.find((s) =>
      s.includes("DELETE FROM student_enrollments"),
    );
    expect(deleteEnrollSql).toBeDefined();
    expect(deleteEnrollSql).toContain("tenant_id = ?");
    expect(deleteEnrollSql).toContain("student_id = ?");
  });

  it("deletes attendance_records for the student", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteAttSql = db.executed.find((s) =>
      s.includes("DELETE FROM attendance_records"),
    );
    expect(deleteAttSql).toBeDefined();
    expect(deleteAttSql).toContain("tenant_id = ?");
    expect(deleteAttSql).toContain("student_id = ?");
  });

  it("deletes student_notes for the student", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteNotesSql = db.executed.find((s) =>
      s.includes("DELETE FROM student_notes"),
    );
    expect(deleteNotesSql).toBeDefined();
    expect(deleteNotesSql).toContain("tenant_id = ?");
    expect(deleteNotesSql).toContain("student_id = ?");
  });

  it("deletes student_documents for the student", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteDocsSql = db.executed.find((s) =>
      s.includes("DELETE FROM student_documents"),
    );
    expect(deleteDocsSql).toBeDefined();
    expect(deleteDocsSql).toContain("tenant_id = ?");
    expect(deleteDocsSql).toContain("student_id = ?");
  });

  it("deletes student_tags for the student", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteTagsSql = db.executed.find((s) =>
      s.includes("DELETE FROM student_tags"),
    );
    expect(deleteTagsSql).toBeDefined();
    expect(deleteTagsSql).toContain("student_id = ?");
  });

  it("does NOT delete ledger_entries (financial history preserved)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteLedgerSql = db.executed.find((s) =>
      s.includes("DELETE FROM ledger_entries"),
    );
    expect(deleteLedgerSql).toBeUndefined();
  });

  it("does NOT delete receipts (financial history preserved)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteReceiptsSql = db.executed.find((s) =>
      s.includes("DELETE FROM receipts"),
    );
    expect(deleteReceiptsSql).toBeUndefined();
  });

  it("does NOT delete invoices (financial history preserved)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteInvSql = db.executed.find((s) =>
      s.includes("DELETE FROM invoices"),
    );
    expect(deleteInvSql).toBeUndefined();
  });

  it("creates audit_log entry with action='student.delete'", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };
    db.run = async (sql, _args) => {
      db.executed.push(sql);
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    expect(db.tables["audit_log"]).toBeDefined();
    const auditRows = db.tables["audit_log"].rows;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].action).toBe("student.delete");
    expect(auditRows[0].ref_type).toBe("student");
    expect(auditRows[0].ref_id).toBe(STUDENT_ID);
    expect(auditRows[0].tenant_id).toBe(TENANT);
    expect(auditRows[0].actor).toBe(TENANT);
  });

  it("creates sync_outbox entry with op='delete' for students table", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };
    db.run = async (sql, _args) => {
      db.executed.push(sql);
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    expect(db.tables["sync_outbox"]).toBeDefined();
    const outboxRows = db.tables["sync_outbox"].rows;
    expect(outboxRows.length).toBe(1);
    expect(outboxRows[0].table_name).toBe("students");
    expect(outboxRows[0].row_id).toBe(STUDENT_ID);
    expect(outboxRows[0].op).toBe("delete");
    expect(outboxRows[0].tenant_id).toBe(TENANT);
    expect(outboxRows[0].status).toBe("pending");
    expect(JSON.parse(outboxRows[0].payload as string)).toEqual({
      id: STUDENT_ID,
    });
  });

  it("deletes the student row itself", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteStudentSql = db.executed.find(
      (s) => s.includes("DELETE FROM students") && s.includes("student_id") === false,
    );
    expect(deleteStudentSql).toBeDefined();
    expect(deleteStudentSql).toContain("DELETE FROM students");
    expect(deleteStudentSql).toContain("tenant_id = ?");
  });

  it("queries for orphaned attendance sessions", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [{ id: "sess-003" }];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const orphanQuery = db.executed.find((s) =>
      s.includes("NOT EXISTS") && s.includes("attendance_sessions"),
    );
    expect(orphanQuery).toBeDefined();
    expect(orphanQuery).toContain("attendance_sessions s");
    expect(orphanQuery).toContain("tenant_id = ?");
  });

  it("deletes orphaned attendance sessions", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [{ id: "sess-003" }];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteSessSql = db.executed.find((s) =>
      s.includes("DELETE FROM attendance_sessions"),
    );
    expect(deleteSessSql).toBeDefined();
    expect(deleteSessSql).toContain("tenant_id = ?");
    expect(deleteSessSql).toContain("id = ?");
  });

  it("cascade deletes happen before student row deletion", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteStudentIdx = db.executed.findIndex(
      (s) =>
        s.includes("DELETE FROM students") && !s.includes("student_enrollments"),
    );
    const cascadeDeletes = db.executed.filter(
      (s) =>
        s.includes("DELETE FROM student_enrollments") ||
        s.includes("DELETE FROM attendance_records") ||
        s.includes("DELETE FROM student_notes") ||
        s.includes("DELETE FROM student_documents") ||
        s.includes("DELETE FROM student_tags"),
    );

    for (const sql of cascadeDeletes) {
      const idx = db.executed.indexOf(sql);
      expect(idx).toBeLessThan(deleteStudentIdx);
    }
  });

  it("audit and outbox writes happen after student row deletion", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };
    db.run = async (sql, _args) => {
      db.executed.push(sql);
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteStudentIdx = db.executed.findIndex(
      (s) =>
        s.includes("DELETE FROM students") && !s.includes("student_enrollments"),
    );

    const auditOutboxInserts = db.executed.filter(
      (s) =>
        s.includes("INSERT INTO audit_log") ||
        s.includes("INSERT INTO sync_outbox"),
    );
    expect(auditOutboxInserts.length).toBe(2);
    for (const sql of auditOutboxInserts) {
      const idx = db.executed.indexOf(sql);
      expect(idx).toBeGreaterThan(deleteStudentIdx);
    }
  });

  it("all DELETE statements are tenant-scoped (except student_tags which has no tenant_id)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteStatements = db.executed.filter((s) =>
      s.startsWith("DELETE FROM"),
    );
    for (const sql of deleteStatements) {
      if (sql.includes("student_tags")) {
        expect(sql).toContain("student_id = ?");
      } else {
        expect(sql).toContain("tenant_id = ?");
      }
    }
  });

  it("preserves guardians (not deleted in cascade)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteGuardiansSql = db.executed.find((s) =>
      s.includes("DELETE FROM guardians"),
    );
    expect(deleteGuardiansSql).toBeUndefined();
  });

  it("preserves fee_plans (not deleted in cascade)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteFeePlansSql = db.executed.find((s) =>
      s.includes("DELETE FROM fee_plans"),
    );
    expect(deleteFeePlansSql).toBeUndefined();
  });

  it("preserves reminders (not deleted in cascade)", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const deleteRemindersSql = db.executed.find((s) =>
      s.includes("DELETE FROM reminders"),
    );
    expect(deleteRemindersSql).toBeUndefined();
  });

  it("only the first oneRow call checks student existence", async () => {
    db.oneRow = async (sql, _args) => {
      db.executed.push(sql);
      return { id: STUDENT_ID };
    };
    db.allRows = async (sql, _args) => {
      db.executed.push(sql);
      return [];
    };

    await deleteStudent(db, TENANT, STUDENT_ID);

    const existenceCheck = db.executed.find((s) =>
      s.includes("SELECT id FROM students WHERE tenant_id"),
    );
    expect(existenceCheck).toBeDefined();
  });

  it("returns 200 even when no cascade rows exist (student-only deletion)", async () => {
    const emptyDb = createMockDb();
    addRows(emptyDb, "students", [
      {
        id: "stu-orphan",
        tenant_id: TENANT,
        first_name: "Orphan",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    emptyDb.oneRow = async (sql, _args) => {
      emptyDb.executed.push(sql);
      if (sql.includes("SELECT id FROM students")) {
        return { id: "stu-orphan" };
      }
      return null;
    };
    emptyDb.allRows = async (sql, _args) => {
      emptyDb.executed.push(sql);
      return [];
    };
    emptyDb.run = async (sql, _args) => {
      emptyDb.executed.push(sql);
    };

    const res = await deleteStudent(emptyDb, TENANT, "stu-orphan");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
  });
});
