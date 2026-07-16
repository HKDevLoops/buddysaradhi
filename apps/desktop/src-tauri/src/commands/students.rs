use serde::{Deserialize, Serialize};
use tauri::State;
use validator::Validate;
use crate::{state::AppState, error::AppError, security};

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct CreateStudentInput {
    #[validate(length(min = 1, max = 100))]
    pub first_name: String,
    #[validate(length(max = 100))]
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub batch_id: String,
    #[validate(range(min = 0, max = 100_000_00))]
    pub default_fee_paise: i64,
}

#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct UpdateStudentInput {
    pub id: String,
    #[validate(length(min = 1, max = 100))]
    pub first_name: Option<String>,
    #[validate(length(max = 100))]
    pub last_name: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Student {
    pub id: String,
    pub code: String,
    pub first_name: String,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub status: String,
    pub archived_at: Option<String>,
}

#[derive(Deserialize)]
pub struct StudentFilter {
    pub search: Option<String>,
}

#[tauri::command]
pub async fn get_students(
    _filter: StudentFilter,
    state: State<'_, AppState>,
) -> Result<Vec<Student>, AppError> {
    let db = state.db.lock();
    let tenant_id = "t-1";

    let mut stmt = db.prepare_cached(
        "SELECT id, code, first_name, last_name, phone, status, archived_at
         FROM students
         WHERE tenant_id = ?1 AND archived_at IS NULL
         ORDER BY first_name, last_name
         LIMIT 500"
    ).map_err(|e| AppError::Db(e.to_string()))?;
    
    let rows = stmt.query_map([tenant_id], |row| {
        Ok(Student {
            id: row.get(0)?,
            code: row.get(1).unwrap_or_default(),
            first_name: row.get(2)?,
            last_name: row.get(3)?,
            phone: row.get(4)?,
            status: row.get(5)?,
            archived_at: row.get(6)?,
        })
    }).map_err(|e| AppError::Db(e.to_string()))?;

    let mut students = Vec::new();
    for row in rows {
        students.push(row?);
    }

    Ok(students)
}

#[tauri::command]
pub async fn get_student(
    id: String,
    state: State<'_, AppState>,
) -> Result<Student, AppError> {
    let db = state.db.lock();
    let tenant_id = "t-1";

    let row = db.query_row(
        "SELECT id, code, first_name, last_name, phone, status, archived_at
         FROM students
         WHERE tenant_id = ?1 AND id = ?2",
        rusqlite::params![tenant_id, id],
        |r| {
            Ok(Student {
                id: r.get(0)?,
                code: r.get(1).unwrap_or_default(),
                first_name: r.get(2)?,
                last_name: r.get(3)?,
                phone: r.get(4)?,
                status: r.get(5)?,
                archived_at: r.get(6)?,
            })
        }
    ).map_err(|e| AppError::NotFound(format!("Student not found: {}", e)))?;

    Ok(row)
}

#[tauri::command]
pub async fn create_student(
    input: CreateStudentInput,
    _pin: Option<String>,
    state: State<'_, AppState>,
) -> Result<Student, AppError> {
    input.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    
    let mut db = state.db.lock();
    let tx = db.transaction()?;

    let id = uuid::Uuid::now_v7().to_string();
    let code = format!("STU-{}", uuid::Uuid::new_v4().to_string().chars().take(4).collect::<String>());
    let now = chrono::Utc::now().to_rfc3339();
    let tenant_id = "t-1";
    let dup_key = format!("{}{}", input.first_name, input.phone.clone().unwrap_or_default()).to_lowercase();

    tx.execute(
        "INSERT INTO students (id, tenant_id, code, first_name, last_name, phone, status, dup_key, admission_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?9)",
        rusqlite::params![id, tenant_id, code, input.first_name, input.last_name, input.phone, dup_key, now, now],
    )?;

    // Append to sync_outbox
    let payload = serde_json::to_string(&input).unwrap_or_default();
    tx.execute(
        "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at)
         VALUES (?1, ?2, 'students', ?3, 'insert', ?4, 'pending', ?5)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, payload, now],
    )?;

    // Audit log
    let audit_meta = serde_json::json!({"source": "manual"}).to_string();
    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, 'tutor', 'student_create', 'students', ?3, ?4, ?5)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, audit_meta, now],
    )?;

    tx.commit()?;

    Ok(Student {
        id,
        code,
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone,
        status: "active".to_string(),
        archived_at: None,
    })
}

#[tauri::command]
pub async fn update_student(
    input: UpdateStudentInput,
    state: State<'_, AppState>,
) -> Result<Student, AppError> {
    input.validate().map_err(|e| AppError::Validation(e.to_string()))?;

    let mut db = state.db.lock();
    let tx = db.transaction()?;

    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(first) = &input.first_name {
        tx.execute(
            "UPDATE students SET first_name = ?1, updated_at = ?2 WHERE tenant_id = ?3 AND id = ?4",
            rusqlite::params![first, now, tenant_id, input.id]
        )?;
    }
    if let Some(last) = &input.last_name {
        tx.execute(
            "UPDATE students SET last_name = ?1, updated_at = ?2 WHERE tenant_id = ?3 AND id = ?4",
            rusqlite::params![last, now, tenant_id, input.id]
        )?;
    }
    if let Some(phone) = &input.phone {
        tx.execute(
            "UPDATE students SET phone = ?1, updated_at = ?2 WHERE tenant_id = ?3 AND id = ?4",
            rusqlite::params![phone, now, tenant_id, input.id]
        )?;
    }

    // sync outbox & audit log
    tx.execute(
        "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at)
         VALUES (?1, ?2, 'students', ?3, 'update', ?4, 'pending', ?5)",
        rusqlite::params![
            uuid::Uuid::now_v7().to_string(),
            tenant_id,
            input.id,
            serde_json::to_string(&input).unwrap_or_default(),
            now
        ],
    )?;

    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, 'tutor', 'student_update', 'students', ?3, '{}', ?4)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, input.id, now],
    )?;

    // Fetch updated within transaction
    let updated = tx.query_row(
        "SELECT id, code, first_name, last_name, phone, status, archived_at
         FROM students
         WHERE tenant_id = ?1 AND id = ?2",
        rusqlite::params![tenant_id, input.id],
        |r| {
            Ok(Student {
                id: r.get(0)?,
                code: r.get(1).unwrap_or_default(),
                first_name: r.get(2)?,
                last_name: r.get(3)?,
                phone: r.get(4)?,
                status: r.get(5)?,
                archived_at: r.get(6)?,
            })
        }
    )?;

    tx.commit()?;
    Ok(updated)
}

#[tauri::command]
pub async fn archive_student(
    id: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<Student, AppError> {
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "archive_student")?;

    let mut db = state.db.lock();
    let tx = db.transaction()?;

    let tenant_id = "t-1";
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "UPDATE students SET archived_at = ?1, status = 'archived', updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3",
        rusqlite::params![now, tenant_id, id]
    )?;

    tx.execute(
        "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at)
         VALUES (?1, ?2, 'students', ?3, 'soft_delete', '{}', 'pending', ?4)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, now],
    )?;

    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, 'tutor', 'student_archive', 'students', ?3, '{}', ?4)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tenant_id, id, now],
    )?;

    // Fetch updated within transaction
    let updated = tx.query_row(
        "SELECT id, code, first_name, last_name, phone, status, archived_at
         FROM students
         WHERE tenant_id = ?1 AND id = ?2",
        rusqlite::params![tenant_id, id],
        |r| {
            Ok(Student {
                id: r.get(0)?,
                code: r.get(1).unwrap_or_default(),
                first_name: r.get(2)?,
                last_name: r.get(3)?,
                phone: r.get(4)?,
                status: r.get(5)?,
                archived_at: r.get(6)?,
            })
        }
    )?;

    tx.commit()?;
    Ok(updated)
}
