use tauri::State;
use serde::{Deserialize, Serialize};
use validator::Validate;
use std::path::PathBuf;
use crate::state::AppState;
use crate::error::AppError;
use crate::security;
use crate::crypto::envelope;

#[derive(Debug, Deserialize, Validate)]
pub struct CreateBackupInput {
    #[validate(length(min = 12, max = 256))]
    pub passphrase: String,
    pub destination: String,
}

#[derive(Serialize)]
pub struct BackupFile {
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct RestoreSummary {
    pub success: bool,
}

#[tauri::command]
pub async fn create_backup(
    input: CreateBackupInput,
    pin: String,
    state: State<'_, AppState>,
) -> Result<BackupFile, AppError> {
    input.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "backup_create")?;

    let tenant_id = {
        let settings = state.settings.read().unwrap();
        settings.tenant_id.clone()
    };
    
    // Perform backup encryption
    let bytes = {
        let db = state.db.lock();
        // Schema version hardcoded to 1 for v1
        envelope::encrypt_backup(&db, &input.passphrase, &tenant_id, 1)?
    };

    let path = PathBuf::from(&input.destination);
    std::fs::write(&path, &bytes)?;

    let size_bytes = bytes.len() as u64;
    let created_at = chrono::Utc::now().to_rfc3339();

    // Audit log
    {
        let db = state.db.lock();
        security::audit::write_audit_conn(
            &db,
            &tenant_id,
            "tutor",
            "backup_create",
            "backup",
            &input.destination,
            serde_json::json!({
                "size_bytes": size_bytes,
                "destination": input.destination
            })
        )?;
    }

    Ok(BackupFile {
        path: input.destination,
        size_bytes,
        created_at,
    })
}

#[tauri::command]
pub async fn restore_backup(
    file_path: String,
    passphrase: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<RestoreSummary, AppError> {
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "backup_restore")?;

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(AppError::NotFound("Backup file not found".into()));
    }

    let bytes = std::fs::read(&path)?;

    // Decrypt and verify backup
    // Local schema version = 1 for now
    let (data_jsonl, _manifest) = envelope::decrypt_backup(&bytes, &passphrase, 1)?;

    // Perform database restore
    {
        let mut db = state.db.lock();
        envelope::restore_db_from_jsonl(&mut db, &data_jsonl)?;
        
        let tenant_id = "t-1";
        security::audit::write_audit_conn(
            &db,
            tenant_id,
            "tutor",
            "backup_restore",
            "backup",
            &file_path,
            serde_json::json!({
                "file_path": file_path
            })
        )?;
    }

    // Settings Cache needs to be reloaded after restore!
    {
        let db = state.db.lock();
        let reloaded_settings = crate::state::AppState::ensure_and_load_settings(&db)?;
        let mut settings_cache = state.settings.write().unwrap();
        *settings_cache = reloaded_settings;
    }

    Ok(RestoreSummary { success: true })
}
