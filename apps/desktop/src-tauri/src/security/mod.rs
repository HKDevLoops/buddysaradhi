pub mod pin;
pub mod audit;
pub mod lockout;

use crate::state::{AppState, LockState};
use crate::error::AppError;
use chrono::Utc;

pub fn require_unlocked(state: &AppState) -> Result<(), AppError> {
    lockout::check_lockout(state)?;

    let session = state.session.lock().unwrap();
    if session.state != LockState::Unlocked {
        return Err(AppError::Auth("Session is locked".into()));
    }

    // Optional: timeout check
    let settings = state.settings.read().unwrap();
    let timeout_mins = settings.session_timeout_min;
    if let Some(last_unlock) = session.last_unlock {
        let diff = Utc::now() - last_unlock;
        if diff.num_minutes() >= timeout_mins {
            drop(session); // release lock
            let mut session_mut = state.session.lock().unwrap();
            session_mut.state = LockState::Locked;
            return Err(AppError::Auth("Session expired due to inactivity".into()));
        }
    }

    Ok(())
}

pub fn require_fresh_pin(state: &AppState, pin: &str, _action: &str) -> Result<(), AppError> {
    lockout::check_lockout(state)?;

    // Retrieve pin_hash from cached settings
    let pin_hash = {
        let settings = state.settings.read().unwrap();
        settings.pin_hash.clone()
    };

    if let Some(hash) = pin_hash {
        match pin::verify_pin(pin, &hash) {
            Ok(true) => {
                lockout::handle_successful_unlock(state);
                // Update last PIN verify timestamp if needed
                Ok(())
            }
            _ => {
                lockout::handle_failed_attempt(state)?;
                Err(AppError::Auth("Invalid PIN".into()))
            }
        }
    } else {
        // No PIN configured, allow the action but warn/log
        Ok(())
    }
}
