// supabase/functions/provision-db/index.ts
//
// Deno Edge Function. Verifies the caller's Supabase JWT, then ensures the
// tenant (auth user) has a settings row and seeded demo data. Idempotent:
// re-running never duplicates rows.
//
// Env (auto-injected by Supabase for every Edge Function in the project):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEMO = [
  { code: "S-001", first: "Aarav", last: "Sharma", grade: "10", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "M" },
  { code: "S-002", first: "Diya", last: "Patel", grade: "10", batch: "Morning Batch", fee_model: "postpaid", balance: 45000, status: "active", gender: "F" },
  { code: "S-003", first: "Vivaan", last: "Reddy", grade: "9", batch: "Evening Batch", fee_model: "mixed", balance: 120000, status: "active", gender: "M" },
  { code: "S-004", first: "Ananya", last: "Iyer", grade: "11", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F" },
  { code: "S-005", first: "Kabir", last: "Singh", grade: "9", batch: "Evening Batch", fee_model: "postpaid", balance: 75000, status: "active", gender: "M" },
  { code: "S-006", first: "Isha", last: "Khan", grade: "10", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F" },
  { code: "S-007", first: "Arjun", last: "Nair", grade: "12", batch: "Evening Batch", fee_model: "mixed", balance: 200000, status: "active", gender: "M" },
  { code: "S-008", first: "Myra", last: "Gupta", grade: "8", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F" },
  { code: "S-009", first: "Rohan", last: "Mehta", grade: "9", batch: "Evening Batch", fee_model: "postpaid", balance: 30000, status: "inactive", gender: "M" },
  { code: "S-010", first: "Sara", last: "Jose", grade: "10", batch: "Morning Batch", fee_model: "mixed", balance: 90000, status: "active", gender: "F" },
  { code: "S-011", first: "Aditya", last: "Das", grade: "11", batch: "Evening Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "M" },
  { code: "S-012", first: "Kiara", last: "Rao", grade: "8", batch: "Morning Batch", fee_model: "postpaid", balance: 60000, status: "active", gender: "F" },
  { code: "S-013", first: "Reyansh", last: "Roy", grade: "12", batch: "Evening Batch", fee_model: "prepaid", balance: 0, status: "graduated", gender: "M" },
  { code: "S-014", first: "Pari", last: "Bhat", grade: "9", batch: "Morning Batch", fee_model: "postpaid", balance: 150000, status: "active", gender: "F" },
];
const BASE_FEE = 150000; // ₹1500.00 in paise

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response("unauthenticated", { status: 401 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData.user) return new Response("unauthenticated", { status: 401 });
  const tenantId = userData.user.id;

  // 1. Settings row (idempotent).
  const { data: existingSettings } = await supabase
    .from("settings")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingSettings) {
    await supabase.from("settings").insert({
      tenant_id: tenantId,
      institute_name: "My Tuition",
      tenant_secret: crypto.randomUUID(),
      currency_code: "INR",
    });
  }

  // 2. Seed demo students only if the tenant has none.
  const { count } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (!count) {
    for (const s of DEMO) {
      const sid = crypto.randomUUID();
      const bid = s.batch === "Morning Batch" ? "b-morning" : "b-evening";
      await supabase.from("students").insert({
        id: sid,
        tenant_id: tenantId,
        code: s.code,
        first_name: s.first,
        last_name: s.last,
        gender: s.gender,
        phone: `+91 98765 ${s.code.slice(2)}001`,
        email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@example.com`,
        school: "Delhi Public School",
        grade: s.grade,
        board: "CBSE",
        admission_date: "2024-04-02",
        status: s.status,
        fee_model: s.fee_model,
        base_fee_paise: BASE_FEE,
        balance_paise: s.balance,
        dup_key: s.code,
      });
      await supabase.from("student_enrollments").insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        student_id: sid,
        batch_id: bid,
        joined_on: "2024-04-02",
      });
      // One invoice per student (mirrors fixtures).
      const invId = crypto.randomUUID();
      await supabase.from("invoices").insert({
        id: invId,
        tenant_id: tenantId,
        number: `INV-${s.code.slice(2)}`,
        student_id: sid,
        issue_date: "2026-07-01",
        due_date: "2026-07-10",
        subtotal: BASE_FEE,
        total: BASE_FEE,
        status: s.balance > 0 ? "partial" : "paid",
      });
      // Ledger: fee entry + payment entry reflecting balance.
      const paid = BASE_FEE - s.balance;
      await supabase.from("ledger_entries").insert([
        {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          student_id: sid,
          invoice_id: invId,
          type: "fee",
          debit_paise: BASE_FEE,
          credit_paise: 0,
          balance_after_paise: BASE_FEE,
          description: "Monthly tuition — July 2026",
          occurred_on: "2026-07-01",
        },
        {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          student_id: sid,
          invoice_id: invId,
          type: "payment",
          debit_paise: 0,
          credit_paise: paid,
          balance_after_paise: s.balance,
          description: paid > 0 ? "Part payment" : "Full payment",
          receipt_no: `R-${s.code.slice(2)}`,
          payment_method: "upi",
          occurred_on: "2026-07-05",
        },
      ]);
    }
    // Batches.
    await supabase.from("batches").upsert([
      { id: "b-morning", tenant_id: tenantId, name: "Morning Batch", subject: "Mathematics" },
      { id: "b-evening", tenant_id: tenantId, name: "Evening Batch", subject: "Science" },
    ], { onConflict: "id" });
  }

  return Response.json({ status: "provisioned", tenantId });
});
