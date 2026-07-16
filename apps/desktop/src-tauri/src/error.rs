use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum AppError {
    #[error("Database error: {0}")]
    #[serde(rename = "DB_ERROR")]
    Db(String),
    
    #[error("Validation error: {0}")]
    #[serde(rename = "VALIDATION_ERROR")]
    Validation(String),
    
    #[error("Not found: {0}")]
    #[serde(rename = "NOT_FOUND")]
    NotFound(String),
    
    #[error("Internal error: {0}")]
    #[serde(rename = "INTERNAL_ERROR")]
    Internal(String),
    
    #[error("Authentication error: {0}")]
    #[serde(rename = "AUTH_ERROR")]
    Auth(String),

    #[error("Crypto error: {0}")]
    #[serde(rename = "CRYPTO_ERROR")]
    Crypto(String),

    #[error("IO error: {0}")]
    #[serde(rename = "IO_ERROR")]
    Io(String),

    #[error("Sync error: {0}")]
    #[serde(rename = "SYNC_ERROR")]
    Sync(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        if err.to_string().contains("file is not a database") {
            AppError::Auth("SQLCipher key mismatch".into())
        } else {
            AppError::Db(err.to_string())
        }
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        AppError::Auth(format!("Keychain: {}", err))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Validation(format!("JSON: {}", err))
    }
}
