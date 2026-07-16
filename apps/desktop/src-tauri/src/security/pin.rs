use argon2::{
    password_hash::{
        rand_core::OsRng,
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString
    },
    Argon2
};
use crate::error::AppError;

pub fn hash_pin(pin: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2.hash_password(pin.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Argon2 hashing error: {}", e)))?
        .to_string();
    Ok(password_hash)
}

pub fn verify_pin(pin: &str, hash: &str) -> Result<bool, AppError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Argon2 hash parsing error: {}", e)))?;
    let verified = Argon2::default()
        .verify_password(pin.as_bytes(), &parsed_hash)
        .is_ok();
    Ok(verified)
}
