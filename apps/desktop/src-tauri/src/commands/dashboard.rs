use tauri::State;
use serde::Serialize;
use crate::state::AppState;
use crate::error::AppError;

#[derive(Serialize)]
pub struct Kpis {
    pub collected: u64,
    pub due_today: u64,
    pub present_pct: u8,
}

#[derive(Serialize)]
pub struct Activity {
    pub id: String,
    pub description: String,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct Reminder {
    pub id: String,
    pub student_name: String,
    pub description: String,
    pub amount_paise: i64,
}

#[tauri::command]
pub fn get_kpis(state: State<'_, AppState>) -> Result<Kpis, AppError> {
    let conn = state.db.lock();
    let tenant_id = "t-1";
    
    // Sum of collected payments
    let collected: i64 = conn.query_row(
        "SELECT COALESCE(SUM(credit_paise), 0) FROM ledger_entries 
         WHERE tenant_id = ?1 AND type = 'PAYMENT_RECEIVED' AND void_of_id IS NULL",
        rusqlite::params![tenant_id],
        |row| row.get(0)
    ).unwrap_or(0);

    // Sum of net balance outstanding (debits - credits)
    let net_due: i64 = conn.query_row(
        "SELECT COALESCE(SUM(debit_paise) - SUM(credit_paise), 0) FROM ledger_entries 
         WHERE tenant_id = ?1 AND void_of_id IS NULL",
        rusqlite::params![tenant_id],
        |row| row.get(0)
    ).unwrap_or(0);
    let due_today = if net_due < 0 { 0 } else { net_due as u64 };

    // Present percentage calculation
    let present_pct: i64 = conn.query_row(
        "SELECT COALESCE(
            (COUNT(CASE WHEN status = 'present' THEN 1 END) * 100) / NULLIF(COUNT(*), 0),
            100
         ) FROM attendance_records WHERE tenant_id = ?1",
        rusqlite::params![tenant_id],
        |row| row.get(0)
    ).unwrap_or(100);

    Ok(Kpis {
        collected: collected as u64,
        due_today,
        present_pct: present_pct as u8,
    })
}

#[tauri::command]
pub fn get_recent_activity(
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<Activity>, AppError> {
    let conn = state.db.lock();
    let tenant_id = "t-1";

    let mut stmt = conn.prepare_cached(
        "SELECT id, action, ref_type, created_at FROM audit_log 
         WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT ?2"
    ).map_err(|e| AppError::Db(e.to_string()))?;

    let rows = stmt.query_map(rusqlite::params![tenant_id, limit], |row| {
        let action: String = row.get(1)?;
        let ref_type: String = row.get(2).unwrap_or_default();
        let desc = format!("Performed action '{}' on entity '{}'", action, ref_type);
        Ok(Activity {
            id: row.get(0)?,
            description: desc,
            created_at: row.get(3)?,
        })
    }).map_err(|e| AppError::Db(e.to_string()))?;

    let mut activities = Vec::new();
    for r in rows {
        activities.push(r?);
    }
    Ok(activities)
}

#[tauri::command]
pub fn get_reminders(state: State<'_, AppState>) -> Result<Vec<Reminder>, AppError> {
    let conn = state.db.lock();
    let tenant_id = "t-1";

    // Find students with outstanding balance
    let mut stmt = conn.prepare_cached(
        "SELECT s.id, s.first_name || ' ' || COALESCE(s.last_name, '') as name,
                COALESCE((SELECT SUM(debit_paise) - SUM(credit_paise) FROM ledger_entries WHERE student_id = s.id AND void_of_id IS NULL), 0) as balance
         FROM students s
         WHERE s.tenant_id = ?1 AND s.archived_at IS NULL
         HAVING balance > 0
         LIMIT 10"
    ).map_err(|e| AppError::Db(e.to_string()))?;

    let rows = stmt.query_map([tenant_id], |row| {
        let name: String = row.get(1)?;
        let balance: i64 = row.get(2)?;
        Ok(Reminder {
            id: row.get(0)?,
            student_name: name.clone(),
            description: format!("Pending balance of ₹{:.2} for {}", (balance as f64) / 100.0, name),
            amount_paise: balance,
        })
    }).map_err(|e| AppError::Db(e.to_string()))?;

    let mut reminders = Vec::new();
    for r in rows {
        reminders.push(r?);
    }
    Ok(reminders)
}
