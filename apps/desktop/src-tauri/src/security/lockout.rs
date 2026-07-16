use crate::state::{AppState, LockState};
use crate::error::AppError;
use std::time::Duration;
use chrono::Utc;
use tauri::Manager;

pub fn check_lockout(state: &AppState) -> Result<(), AppError> {
    let session = state.session.lock().unwrap();
    
    if session.state == LockState::Panic {
        return Err(AppError::Auth("App is in PANIC state. Local database wiped.".into()));
    }

    if let Some(until) = session.biometric_disabled_until {
        let now = Utc::now();
        if now < until {
            let diff = (until - now).num_seconds();
            return Err(AppError::Auth(format!("Locked out. Retry in {} seconds.", diff)));
        }
    }
    Ok(())
}

pub fn handle_failed_attempt(state: &AppState) -> Result<(), AppError> {
    let mut session = state.session.lock().unwrap();
    session.fail_count += 1;

    let fail_count = session.fail_count;
    if fail_count >= 15 {
        session.state = LockState::Panic;
        drop(session); // release lock before shredding
        shred_local_data(state)?;
        return Err(AppError::Auth("15 failed attempts. Local database has been securely wiped.".into()));
    } else if fail_count >= 10 {
        session.biometric_disabled_until = Some(Utc::now() + Duration::from_secs(300)); // 5 mins
        return Err(AppError::Auth("10 failed attempts. Locked out for 5 minutes.".into()));
    } else if fail_count >= 5 {
        session.biometric_disabled_until = Some(Utc::now() + Duration::from_secs(30)); // 30s
        return Err(AppError::Auth("5 failed attempts. Locked out for 30 seconds.".into()));
    }

    Ok(())
}

pub fn handle_successful_unlock(state: &AppState) {
    let mut session = state.session.lock().unwrap();
    session.fail_count = 0;
    session.biometric_disabled_until = None;
    session.state = LockState::Unlocked;
    session.last_unlock = Some(Utc::now());
}

pub fn shred_local_data(state: &AppState) -> Result<(), AppError> {
    // Delete keyring
    let _ = state.keyring_sqlcipher.delete_password();
    let _ = state.keyring_supabase.delete_password();
    let _ = state.keyring_turso.delete_password();

    // Close db connection if possible, but standard is just removing files
    // Since state holds db Mutex, we can't easily drop it from under threads, but we can erase files
    // and let the process crash or panic abort.
    let app_dir = state.app_handle.path().app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    
    let db_path = app_dir.join(".buddysaradhi.db");
    let wal_path = app_dir.join(".buddysaradhi.db-wal");
    let shm_path = app_dir.join(".buddysaradhi.db-shm");

    // Close database by replacing the connection inside AppState db Mutex with a dummy in-memory one
    {
        let mut db_lock = state.db.lock();
        if let Ok(dummy_conn) = rusqlite::Connection::open_in_memory() {
            *db_lock = dummy_conn;
        }
    }

    if db_path.exists() {
        let _ = std::fs::remove_file(db_path);
    }
    if wal_path.exists() {
        let _ = std::fs::remove_file(wal_path);
    }
    if shm_path.exists() {
        let _ = std::fs::remove_file(shm_path);
    }

    Ok(())
}
