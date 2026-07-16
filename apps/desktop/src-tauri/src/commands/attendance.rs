use serde::{Deserialize, Serialize};
use tauri::State;
use validator::Validate;
use rusqlite::OptionalExtension;
use crate::{state::AppState, error::AppError, security};

#[derive(Debug, Deserialize, Validate)]
pub struct Mark {
    pub student_id: String,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct MarkAttendanceInput {
    pub batch_id: String,
    pub session_date: String,
    pub marks: Vec<Mark>,
}

#[derive(Debug, Serialize)]
pub struct AttendanceSession {
    pub id: String,
    pub batch_id: String,
    pub session_date: String,
    pub locked_at: Option<String>,
    pub locked_by: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AttendanceRecord {
    pub student_id: String,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AttendanceSessionDetail {
    pub id: String,
    pub batch_id: String,
    pub session_date: String,
    pub locked_at: Option<String>,
    pub locked_by: Option<String>,
    pub records: Vec<AttendanceRecord>,
}

#[tauri::command]
pub async fn get_attendance_session(
    batch_id: String,
    session_date: String,
    state: State<'_, AppState>,
) -> Result<Option<AttendanceSessionDetail>, AppError> {
    let db = state.db.lock();
    let tenant_id = "t-1";

    let session: Option<(String, Option<String>, Option<String>)> = db.query_row(
        "SELECT id, locked_at, locked_by FROM attendance_sessions WHERE tenant_id = ?1 AND batch_id = ?2 AND session_date = ?3",
        rusqlite::params![tenant_id, batch_id, session_date],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    ).optional().map_err(|e| AppError::Db(e.to_string()))?;

    let (session_id, locked_at, locked_by) = match session {
        Some(s) => s,
        None => return Ok(None),
    };

    let mut stmt = db.prepare_cached(
        "SELECT student_id, status, notes FROM attendance_records WHERE tenant_id = ?1 AND session_id = ?2"
    ).map_err(|e| AppError::Db(e.to_string()))?;

    let rows = stmt.query_map([tenant_id, &session_id], |r| {
        Ok(AttendanceRecord {
            student_id: r.get(0)?,
            status: r.get(1)?,
            notes: r.get(2)?,
        })
    }).map_err(|e| AppError::Db(e.to_string()))?;

    let mut records = Vec::new();
    for r in rows {
        records.push(r?);
    }

    Ok(Some(AttendanceSessionDetail {
        id: session_id,
        batch_id,
        session_date,
        locked_at,
        locked_by,
        records,
    }))
}

#[tauri::command]
pub async fn mark_attendance(
    input: MarkAttendanceInput,
    state: State<'_, AppState>,
) -> Result<AttendanceSession, AppError> {
    input.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    
    let mut db = state.db.lock();
    let tx = db.transaction()?;

    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    // Check lock status
    let existing_lock: Option<Option<String>> = tx.query_row(
        "SELECT locked_at FROM attendance_sessions WHERE tenant_id = ?1 AND batch_id = ?2 AND session_date = ?3",
        rusqlite::params![tenant_id, input.batch_id, input.session_date],
        |r| r.get(0)
    ).optional().map_err(|e| AppError::Db(e.to_string()))?;

    if let Some(Some(_)) = existing_lock {
        return Err(AppError::Validation("Attendance session is locked and cannot be edited".into()));
    }

    let session_id = uuid::Uuid::now_v7().to_string();

    tx.execute(
        "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(batch_id, session_date) DO UPDATE SET updated_at = ?5",
        rusqlite::params![session_id, tenant_id, input.batch_id, input.session_date, now]
    )?;

    // Fetch the actual session_id in case it was an update
    let actual_session_id: String = tx.query_row(
        "SELECT id FROM attendance_sessions WHERE batch_id = ?1 AND session_date = ?2",
        rusqlite::params![input.batch_id, input.session_date],
        |row| row.get(0)
    )?;

    for mark in input.marks {
        tx.execute(
            "INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
             ON CONFLICT(session_id, student_id) DO UPDATE SET status = ?5, updated_at = ?6",
            rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, actual_session_id, mark.student_id, mark.status, now]
        )?;
    }

    tx.commit()?;

    Ok(AttendanceSession {
        id: actual_session_id,
        batch_id: input.batch_id,
        session_date: input.session_date,
        locked_at: None,
        locked_by: None,
    })
}

#[tauri::command]
pub async fn lock_attendance_session(
    batch_id: String,
    session_date: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "lock_attendance")?;

    let db = state.db.lock();
    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    db.execute(
        "UPDATE attendance_sessions SET locked_at = ?1, locked_by = 'pin', updated_at = ?1 
         WHERE tenant_id = ?2 AND batch_id = ?3 AND session_date = ?4",
        rusqlite::params![now, tenant_id, batch_id, session_date]
    )?;

    Ok(())
}

#[tauri::command]
pub async fn unlock_attendance_session(
    batch_id: String,
    session_date: String,
    pin: String,
    reason: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "unlock_attendance")?;

    let db = state.db.lock();
    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    db.execute(
        "UPDATE attendance_sessions SET locked_at = NULL, locked_by = NULL, notes = ?1, updated_at = ?2 
         WHERE tenant_id = ?3 AND batch_id = ?4 AND session_date = ?5",
        rusqlite::params![reason, now, tenant_id, batch_id, session_date]
    )?;

    Ok(())
}
