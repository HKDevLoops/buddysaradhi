use rusqlite::params;
use crate::error::AppError;

pub fn write_audit(
    tx: &rusqlite::Transaction,
    tenant_id: &str,
    actor: &str,         // "tutor" | "biometric" | "system"
    action: &str,        // "student_create" | "ledger_void" | "backup_create" | ...
    ref_type: &str,
    ref_id: &str,
    metadata: serde_json::Value,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            uuid::Uuid::now_v7().to_string(),
            tenant_id,
            actor,
            action,
            ref_type,
            ref_id,
            metadata.to_string(),
            chrono::Utc::now().to_rfc3339(),
        ],
    ).map_err(|e| AppError::Db(e.to_string()))?;
    Ok(())
}

pub fn write_audit_conn(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    actor: &str,
    action: &str,
    ref_type: &str,
    ref_id: &str,
    metadata: serde_json::Value,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            uuid::Uuid::now_v7().to_string(),
            tenant_id,
            actor,
            action,
            ref_type,
            ref_id,
            metadata.to_string(),
            chrono::Utc::now().to_rfc3339(),
        ],
    ).map_err(|e| AppError::Db(e.to_string()))?;
    Ok(())
}
