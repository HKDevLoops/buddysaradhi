use serde::{Deserialize, Serialize};
use tauri::State;
use validator::Validate;
use rusqlite::OptionalExtension;
use crate::{state::AppState, error::AppError, security};
use sha2::Digest;

#[derive(Debug, Deserialize, Validate)]
pub struct RecordPaymentInput {
    pub student_id: String,
    pub invoice_id: Option<String>,
    #[validate(range(min = 1, max = 100_000_00))] // ₹1 lakh
    pub amount_paise: i64,
    pub method: String,
    pub reference: Option<String>,
    pub occurred_on: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LedgerEntry {
    pub id: String,
    pub student_id: String,
    pub entry_type: String, // 'FEE_CHARGED' or 'PAYMENT_RECEIVED'
    pub debit_paise: i64,
    pub credit_paise: i64,
    pub balance_after_paise: i64,
    pub receipt_no: Option<String>,
}

#[derive(Serialize)]
pub struct FeeMatrixStudent {
    pub id: String,
    pub name: String,
    pub fee_status: String, // 'paid', 'unpaid', 'partial'
    pub amount_due_paise: i64,
    pub amount_paid_paise: i64,
}

#[derive(Serialize)]
pub struct FeeMatrix {
    pub students: Vec<FeeMatrixStudent>,
    pub total_due_paise: i64,
    pub total_paid_paise: i64,
}

#[tauri::command]
pub async fn record_payment(
    input: RecordPaymentInput,
    pin: String,
    state: State<'_, AppState>,
) -> Result<LedgerEntry, AppError> {
    input.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "record_payment")?;

    let mut db = state.db.lock();
    let tx = db.transaction()?;

    let id = uuid::Uuid::now_v7().to_string();
    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    // Generate unique receipt seq & number
    let receipt_seq: i64 = tx.query_row(
        "UPDATE settings SET next_receipt_seq = next_receipt_seq + 1 WHERE tenant_id = ?1 RETURNING next_receipt_seq",
        rusqlite::params![tenant_id],
        |row| row.get(0)
    ).unwrap_or(1);
    let receipt_no = format!("RCP-{:06}", receipt_seq);

    // Get last balance for the student
    let last_balance: i64 = tx.query_row(
        "SELECT balance_after_paise FROM ledger_entries WHERE tenant_id = ?1 AND student_id = ?2 ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![tenant_id, input.student_id],
        |row| row.get(0),
    ).optional()?.unwrap_or(0);

    let new_balance = last_balance - input.amount_paise;
    
    // Hash chain
    let prev_hash: Option<String> = tx.query_row(
        "SELECT this_hash FROM ledger_entries WHERE tenant_id = ?1 AND student_id = ?2 ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![tenant_id, input.student_id],
        |row| row.get(0),
    ).optional()?;
    let prev_hash_str = prev_hash.unwrap_or_default();
    
    let mut hasher = sha2::Sha256::new();
    hasher.update(format!("{}|{}|{}|{}", prev_hash_str, id, input.student_id, new_balance).as_bytes());
    let this_hash = format!("{:x}", hasher.finalize());

    tx.execute(
        "INSERT INTO ledger_entries 
        (id, tenant_id, student_id, type, debit_paise, credit_paise, balance_after_paise, receipt_no, payment_method, payment_ref, prev_hash, this_hash, occurred_on, created_at)
        VALUES (?1, ?2, ?3, 'PAYMENT_RECEIVED', 0, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            id, tenant_id, input.student_id, input.amount_paise, new_balance, receipt_no, 
            input.method, input.reference, prev_hash_str, this_hash, input.occurred_on, now
        ]
    )?;

    // Insert receipt
    let receipt_id = uuid::Uuid::now_v7().to_string();
    tx.execute(
        "INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, amount, payment_method, payment_ref, received_on, tamper_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
         rusqlite::params![receipt_id, tenant_id, receipt_no, id, input.student_id, input.amount_paise, input.method, input.reference, input.occurred_on, this_hash, now]
    )?;

    // Sync outbox
    let payload = serde_json::json!({
        "ledger_entry_id": id,
        "amount_paise": input.amount_paise,
        "receipt_no": receipt_no
    }).to_string();
    tx.execute(
        "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at)
         VALUES (?1, ?2, 'ledger_entries', ?3, 'insert', ?4, 'pending', ?5)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, payload, now],
    )?;

    // Audit log
    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, 'tutor', 'payment_received', 'ledger_entries', ?3, '{}', ?4)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, now],
    )?;

    tx.commit()?;

    Ok(LedgerEntry {
        id,
        student_id: input.student_id,
        entry_type: "PAYMENT_RECEIVED".into(),
        debit_paise: 0,
        credit_paise: input.amount_paise,
        balance_after_paise: new_balance,
        receipt_no: Some(receipt_no),
    })
}

#[tauri::command]
pub async fn void_ledger_entry(
    id: String,
    reason: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<LedgerEntry, AppError> {
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "payment_void")?;

    let mut db = state.db.lock();
    let tx = db.transaction()?;

    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    // Get original entry details
    let original: (String, String, i64, i64, Option<String>) = tx.query_row(
        "SELECT student_id, type, debit_paise, credit_paise, receipt_no 
         FROM ledger_entries WHERE tenant_id = ?1 AND id = ?2 AND type <> 'VOID' AND locked_at IS NULL",
        rusqlite::params![tenant_id, id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
    ).map_err(|_| AppError::NotFound("Ledger entry not found or already voided/locked".into()))?;

    let (student_id, original_type, debit_paise, credit_paise, receipt_no) = original;

    // Check if already voided
    let void_exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE tenant_id = ?1 AND void_of_id = ?2)",
        rusqlite::params![tenant_id, id],
        |row| row.get(0)
    ).unwrap_or(false);

    if void_exists {
        return Err(AppError::Validation("Ledger entry is already voided".into()));
    }

    // Determine reversing debit/credit
    let (rev_debit, rev_credit) = if original_type == "PAYMENT_RECEIVED" {
        (credit_paise, 0)
    } else {
        (0, debit_paise)
    };

    // Calculate new balance
    let last_balance: i64 = tx.query_row(
        "SELECT balance_after_paise FROM ledger_entries WHERE tenant_id = ?1 AND student_id = ?2 ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![tenant_id, student_id],
        |row| row.get(0),
    ).unwrap_or(0);

    let new_balance = last_balance + rev_debit - rev_credit;

    // Hash chain
    let prev_hash: Option<String> = tx.query_row(
        "SELECT this_hash FROM ledger_entries WHERE tenant_id = ?1 AND student_id = ?2 ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![tenant_id, student_id],
        |row| row.get(0),
    ).optional()?;
    let prev_hash_str = prev_hash.unwrap_or_default();
    
    let void_id = uuid::Uuid::now_v7().to_string();
    let mut hasher = sha2::Sha256::new();
    hasher.update(format!("{}|{}|{}|{}", prev_hash_str, void_id, student_id, new_balance).as_bytes());
    let this_hash = format!("{:x}", hasher.finalize());

    // Insert reversing VOID entry
    tx.execute(
        "INSERT INTO ledger_entries 
        (id, tenant_id, student_id, type, debit_paise, credit_paise, balance_after_paise, void_of_id, description, prev_hash, this_hash, occurred_on, created_at)
        VALUES (?1, ?2, ?3, 'VOID', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            void_id, tenant_id, student_id, rev_debit, rev_credit, new_balance, id, 
            format!("Void of entry {}. Reason: {}", id, reason), prev_hash_str, this_hash, now.chars().take(10).collect::<String>(), now
        ]
    )?;

    // If receipt exists, void the receipt
    if let Some(r_no) = receipt_no {
        tx.execute(
            "UPDATE receipts SET voided_at = ?1 WHERE tenant_id = ?2 AND number = ?3",
            rusqlite::params![now, tenant_id, r_no]
        )?;
    }

    // Sync outbox
    tx.execute(
        "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at)
         VALUES (?1, ?2, 'ledger_entries', ?3, 'void', '{}', 'pending', ?4)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, void_id, now],
    )?;

    // Audit log
    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, 'tutor', 'payment_void', 'ledger_entries', ?3, ?4, ?5)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, serde_json::json!({"reason": reason}).to_string(), now],
    )?;

    tx.commit()?;

    Ok(LedgerEntry {
        id: void_id,
        student_id,
        entry_type: "VOID".into(),
        debit_paise: rev_debit,
        credit_paise: rev_credit,
        balance_after_paise: new_balance,
        receipt_no: None,
    })
}

#[tauri::command]
pub async fn get_fee_matrix(
    batch_id: String,
    month: String, // format YYYY-MM
    state: State<'_, AppState>,
) -> Result<FeeMatrix, AppError> {
    let db = state.db.lock();
    
    // Format wildcard parameter e.g. "2026-07%"
    let month_wildcard = format!("{}-%", month);

    let mut stmt = db.prepare_cached(
        "SELECT 
          s.id, 
          s.first_name || ' ' || COALESCE(s.last_name, '') as name,
          COALESCE((SELECT SUM(debit_paise) FROM ledger_entries WHERE student_id = s.id AND occurred_on LIKE ?2 AND type <> 'VOID'), 0) as amount_due_paise,
          COALESCE((SELECT SUM(credit_paise) FROM ledger_entries WHERE student_id = s.id AND occurred_on LIKE ?2 AND type <> 'VOID'), 0) as amount_paid_paise
        FROM students s
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.batch_id = ?1 AND s.archived_at IS NULL AND se.exited_on IS NULL"
    ).map_err(|e| AppError::Db(e.to_string()))?;

    let rows = stmt.query_map([batch_id, month_wildcard], |row| {
        let amount_due: i64 = row.get(2)?;
        let amount_paid: i64 = row.get(3)?;
        let status = if amount_due == 0 {
            "paid".to_string()
        } else if amount_paid >= amount_due {
            "paid".to_string()
        } else if amount_paid > 0 {
            "partial".to_string()
        } else {
            "unpaid".to_string()
        };

        Ok(FeeMatrixStudent {
            id: row.get(0)?,
            name: row.get(1)?,
            fee_status: status,
            amount_due_paise: amount_due,
            amount_paid_paise: amount_paid,
        })
    }).map_err(|e| AppError::Db(e.to_string()))?;

    let mut students = Vec::new();
    let mut total_due = 0;
    let mut total_paid = 0;

    for r in rows {
        let stud = r?;
        total_due += stud.amount_due_paise;
        total_paid += stud.amount_paid_paise;
        students.push(stud);
    }

    Ok(FeeMatrix {
        students,
        total_due_paise: total_due,
        total_paid_paise: total_paid,
    })
}

#[tauri::command]
pub async fn get_receipt_pdf(
    receipt_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, AppError> {
    let db = state.db.lock();
    let tenant_id = "t-1";

    let (receipt_no, amount, method, received_on, student_name): (String, i64, String, String, String) = db.query_row(
        "SELECT r.number, r.amount, r.payment_method, r.received_on, s.first_name || ' ' || COALESCE(s.last_name, '')
         FROM receipts r
         JOIN students s ON r.student_id = s.id
         WHERE r.tenant_id = ?1 AND r.id = ?2",
        rusqlite::params![tenant_id, receipt_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
    ).map_err(|_| AppError::NotFound("Receipt not found".into()))?;

    let pdf_content = format!(
        "%PDF-1.4\n\
         1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
         2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
         3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n\
         4 0 obj\n<< /Length 200 >>\n\
         stream\n\
         BT\n/F1 12 Tf\n72 712 Td\n(Receipt Receipt No: {}) Tj\n\
         0 -20 Td\n(Student Name: {}) Tj\n\
         0 -20 Td\n(Amount Paid: INR {} paise) Tj\n\
         0 -20 Td\n(Payment Method: {}) Tj\n\
         0 -20 Td\n(Received On: {}) Tj\n\
         ET\n\
         endstream\n\
         endobj\n\
         xref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000111 00000 n\n0000000212 00000 n\n\
         trailer\n<< /Size 5 /Root 1 0 R >>\n\
         startxref\n465\n%%EOF\n",
        receipt_no, student_name, amount, method, received_on
    );

    Ok(pdf_content.into_bytes())
}
