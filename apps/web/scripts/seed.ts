import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const MOCK_TENANT_ID = "00000000-0000-0000-0000-000000000000";

async function main() {
  const dbPath = path.join(process.cwd(), "local.db");
  
  const client = createClient({
    url: `file:${dbPath}`,
  });

  console.log("Initializing database...");
  
  const migrationPath = path.join(process.cwd(), "../../migrations/0001_init.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  
  const statements = migrationSql.split(";").map(s => s.trim()).filter(s => s.length > 0);
  
  for (const statement of statements) {
    try {
      await client.execute(statement);
    } catch (e) {
      console.warn("Failed to execute statement:", statement.substring(0, 50) + "...", e);
    }
  }

  console.log("Seeding mock data...");

  // Seed settings
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at) 
          VALUES (?, 'Demo Tuition', 'secret-pepper', datetime('now'), datetime('now'))`,
    args: [MOCK_TENANT_ID]
  });

  // Seed tutor
  const tutorId = "tut-001";
  await client.execute({
    sql: `INSERT OR IGNORE INTO tutors (id, tenant_id, name, role, created_at, updated_at)
          VALUES (?, ?, 'Demo Tutor', 'owner', datetime('now'), datetime('now'))`,
    args: [tutorId, MOCK_TENANT_ID]
  });

  // Seed batch
  const batchId = "bat-001";
  await client.execute({
    sql: `INSERT OR IGNORE INTO batches (id, tenant_id, tutor_id, name, subject, created_at, updated_at)
          VALUES (?, ?, ?, 'Class 10 - Maths', 'Mathematics', datetime('now'), datetime('now'))`,
    args: [batchId, MOCK_TENANT_ID, tutorId]
  });

  // Seed student 1
  const student1Id = "stu-001";
  await client.execute({
    sql: `INSERT OR IGNORE INTO students (id, tenant_id, code, first_name, last_name, grade, admission_date, fee_model, dup_key, created_at, updated_at)
          VALUES (?, ?, 'STU-01', 'Aarav', 'Sharma', 'Class 10', date('now'), 'postpaid', 'aaravsharma', datetime('now'), datetime('now'))`,
    args: [student1Id, MOCK_TENANT_ID]
  });

  // Enroll student 1
  await client.execute({
    sql: `INSERT OR IGNORE INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
          VALUES ('enr-001', ?, ?, ?, date('now'), datetime('now'), datetime('now'))`,
    args: [MOCK_TENANT_ID, student1Id, batchId]
  });

  // Ledger for student 1 (owing 4500)
  await client.execute({
    sql: `INSERT OR IGNORE INTO ledger_entries (id, tenant_id, student_id, batch_id, type, debit_paise, credit_paise, balance_after_paise, occurred_on, this_hash, created_at, updated_at)
          VALUES ('led-001', ?, ?, ?, 'FEE_CHARGED', 450000, 0, 450000, date('now'), 'hash1', datetime('now'), datetime('now'))`,
    args: [MOCK_TENANT_ID, student1Id, batchId]
  });

  console.log("Database initialized and seeded successfully.");
}

main().catch(console.error);
