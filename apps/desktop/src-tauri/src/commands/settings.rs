use serde::{Deserialize, Serialize};
use tauri::State;
use validator::Validate;
use crate::{state::AppState, error::AppError, security};

#[derive(Debug, Serialize, Deserialize)]
pub struct Settings {
    pub institute_name: String,
    pub currency_code: String,
    pub session_timeout_min: i64,
    pub theme: String,
    pub biometric_enabled: bool,
    pub has_pin: bool,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateSettingsInput {
    #[validate(length(min = 1, max = 100))]
    pub institute_name: Option<String>,
    pub theme: Option<String>,
    pub session_timeout_min: Option<i64>,
    pub pin: Option<String>,
    pub biometric_enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub id: String,
    pub actor: String,
    pub action: String,
    pub ref_type: String,
    pub ref_id: String,
    pub metadata: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_settings(
    state: State<'_, AppState>,
) -> Result<Settings, AppError> {
    let settings = state.settings.read().unwrap();
    
    Ok(Settings {
        institute_name: settings.institute_name.clone(),
        currency_code: settings.currency_code.clone(),
        session_timeout_min: settings.session_timeout_min,
        theme: settings.theme.clone(),
        biometric_enabled: settings.biometric_enabled,
        has_pin: settings.pin_hash.is_some(),
    })
}

#[tauri::command]
pub async fn update_settings(
    input: UpdateSettingsInput,
    state: State<'_, AppState>,
) -> Result<Settings, AppError> {
    input.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    
    let reloaded = {
        let db = state.db.lock();
        let tenant_id = "t-1";
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(name) = &input.institute_name {
            db.execute("UPDATE settings SET institute_name = ?1, updated_at = ?2 WHERE tenant_id = ?3", rusqlite::params![name, now, tenant_id])?;
        }
        if let Some(theme) = &input.theme {
            db.execute("UPDATE settings SET theme = ?1, updated_at = ?2 WHERE tenant_id = ?3", rusqlite::params![theme, now, tenant_id])?;
        }
        if let Some(timeout) = input.session_timeout_min {
            db.execute("UPDATE settings SET session_timeout_min = ?1, updated_at = ?2 WHERE tenant_id = ?3", rusqlite::params![timeout, now, tenant_id])?;
        }
        if let Some(pin_val) = &input.pin {
            let hash = security::pin::hash_pin(pin_val)?;
            db.execute("UPDATE settings SET pin_hash = ?1, updated_at = ?2 WHERE tenant_id = ?3", rusqlite::params![hash, now, tenant_id])?;
        }
        if let Some(bio) = input.biometric_enabled {
            let bio_int = if bio { 1 } else { 0 };
            db.execute("UPDATE settings SET biometric_enabled = ?1, updated_at = ?2 WHERE tenant_id = ?3", rusqlite::params![bio_int, now, tenant_id])?;
        }

        // Reload settings cache
        let reloaded = crate::state::AppState::ensure_and_load_settings(&db)?;
        let mut settings_cache = state.settings.write().unwrap();
        *settings_cache = reloaded.clone();
        reloaded
    };

    Ok(Settings {
        institute_name: reloaded.institute_name,
        currency_code: reloaded.currency_code,
        session_timeout_min: reloaded.session_timeout_min,
        theme: reloaded.theme,
        biometric_enabled: reloaded.biometric_enabled,
        has_pin: reloaded.pin_hash.is_some(),
    })
}

#[tauri::command]
pub async fn get_audit_log(
    state: State<'_, AppState>,
) -> Result<Vec<AuditEntry>, AppError> {
    let db = state.db.lock();
    let tenant_id = "t-1";

    let mut stmt = db.prepare_cached(
        "SELECT id, actor, action, ref_type, ref_id, metadata, created_at 
         FROM audit_log WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 500"
    ).map_err(|e| AppError::Db(e.to_string()))?;

    let rows = stmt.query_map([tenant_id], |row| {
        Ok(AuditEntry {
            id: row.get(0)?,
            actor: row.get(1)?,
            action: row.get(2)?,
            ref_type: row.get(3).unwrap_or_default(),
            ref_id: row.get(4).unwrap_or_default(),
            metadata: row.get(5).unwrap_or_default(),
            created_at: row.get(6)?,
        })
    }).map_err(|e| AppError::Db(e.to_string()))?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }

    Ok(list)
}
