use tauri::State;
use crate::state::{AppState, LockState};
use crate::error::AppError;
use crate::security;

#[tauri::command]
pub async fn unlock(
    pin: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    security::lockout::check_lockout(&state)?;

    let pin_hash = {
        let settings = state.settings.read().unwrap();
        settings.pin_hash.clone()
    };

    if let Some(hash) = pin_hash {
        match security::pin::verify_pin(&pin, &hash) {
            Ok(true) => {
                security::lockout::handle_successful_unlock(&state);
                Ok(true)
            }
            _ => {
                security::lockout::handle_failed_attempt(&state)?;
                Err(AppError::Auth("Invalid PIN".into()))
            }
        }
    } else {
        // No PIN set yet, set to unlocked automatically
        security::lockout::handle_successful_unlock(&state);
        Ok(true)
    }
}

#[tauri::command]
pub async fn lock(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mut session = state.session.lock().unwrap();
    session.state = LockState::Locked;
    session.last_unlock = None;
    Ok(())
}

#[tauri::command]
pub async fn biometric_unlock(
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    security::lockout::check_lockout(&state)?;

    let bio_enabled = {
        let settings = state.settings.read().unwrap();
        settings.biometric_enabled
    };

    if bio_enabled {
        security::lockout::handle_successful_unlock(&state);
        Ok(true)
    } else {
        Err(AppError::Auth("Biometrics not enabled in settings".into()))
    }
}
