use rusqlite::Connection;
use parking_lot::Mutex;
use std::sync::{Mutex as StdMutex, RwLock};
use std::sync::OnceLock;
use std::path::Path;
use keyring::Entry;
use tauri::AppHandle;
use tauri::Manager;
use serde::{Serialize, Deserialize};
use zeroize::Zeroizing;
use rand::RngCore;
use base64::Engine;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub libsql: OnceLock<String>,
    pub keyring_sqlcipher: Entry,
    pub keyring_supabase: Entry,
    pub keyring_turso: Entry,
    pub session: StdMutex<Session>,
    pub settings: RwLock<SettingsCache>,
    pub app_handle: AppHandle,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub state: LockState,
    pub last_unlock: Option<chrono::DateTime<chrono::Utc>>,
    pub fail_count: u32,
    pub biometric_disabled_until: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LockState {
    Locked,
    Unlocked,
    Panic,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettingsCache {
    pub tenant_id: String,
    pub institute_name: String,
    pub currency_code: String,
    pub session_timeout_min: i64,
    pub theme: String,
    pub pin_hash: Option<String>,
    pub biometric_enabled: bool,
    pub tenant_secret: String,
}

impl AppState {
    pub fn init(app: AppHandle) -> Result<Self, crate::error::AppError> {
        let app_dir = app.path().app_data_dir().map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
        std::fs::create_dir_all(&app_dir).map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
        let db_path = app_dir.join(".buddysaradhi.db");

        // Keyring handles
        let keyring_sqlcipher = Entry::new("buddysaradhi", "sqlcipher-key")
            .map_err(|e| crate::error::AppError::Auth(format!("Keychain error: {}", e)))?;
        let keyring_supabase = Entry::new("buddysaradhi", "supabase-refresh")
            .map_err(|e| crate::error::AppError::Auth(format!("Keychain error: {}", e)))?;
        let keyring_turso = Entry::new("buddysaradhi", "turso-db-token")
            .map_err(|e| crate::error::AppError::Auth(format!("Keychain error: {}", e)))?;

        // Retrieve or generate SQLCipher key
        let key = Self::get_or_create_key(&keyring_sqlcipher)?;

        // Open encrypted DB & run migrations
        let conn = Self::open_encrypted_db(&db_path, &key)?;
        
        // Ensure default settings row exists and load it
        let settings = Self::ensure_and_load_settings(&conn)?;

        let session = Session {
            state: LockState::Locked,
            last_unlock: None,
            fail_count: 0,
            biometric_disabled_until: None,
        };

        Ok(Self {
            db: Mutex::new(conn),
            libsql: OnceLock::new(),
            keyring_sqlcipher,
            keyring_supabase,
            keyring_turso,
            session: StdMutex::new(session),
            settings: RwLock::new(settings),
            app_handle: app,
        })
    }

    fn get_or_create_key(entry: &Entry) -> Result<Zeroizing<Vec<u8>>, crate::error::AppError> {
        match entry.get_password() {
            Ok(s) => {
                let mut bytes = Zeroizing::new(vec![0u8; 32]);
                base64::engine::general_purpose::STANDARD
                    .decode_slice(&s, &mut *bytes)
                    .map_err(|e| crate::error::AppError::Auth(format!("Base64 decode error: {}", e)))?;
                Ok(bytes)
            }
            Err(keyring::Error::NoEntry) => {
                let mut bytes = Zeroizing::new(vec![0u8; 32]);
                rand::rng().fill_bytes(&mut *bytes);
                let b64 = base64::engine::general_purpose::STANDARD.encode(&*bytes);
                entry.set_password(&b64)
                    .map_err(|e| crate::error::AppError::Auth(format!("Keychain set error: {}", e)))?;
                Ok(bytes)
            }
            Err(e) => Err(crate::error::AppError::Auth(format!("Keychain error: {}", e))),
        }
    }

    fn open_encrypted_db(path: &Path, key: &[u8]) -> Result<Connection, crate::error::AppError> {
        let mut conn = Connection::open(path)?;
        let key_hex: String = key.iter().map(|b| format!("{:02x}", b)).collect();
        let pragma_query = format!("PRAGMA key = '{}';", key_hex);
        conn.execute_batch(&pragma_query)?;

        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.execute_batch("PRAGMA synchronous = NORMAL;")?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch("PRAGMA temp_store = MEMORY;")?;

        // Run migrations
        crate::db::connection::run_refinery_migrations(&mut conn)?;

        Ok(conn)
    }

    pub fn ensure_and_load_settings(conn: &Connection) -> Result<SettingsCache, crate::error::AppError> {
        let tenant_id = "t-1";
        
        // Try to fetch settings row
        let query_res = conn.query_row(
            "SELECT tenant_id, institute_name, currency_code, session_timeout_min, theme, pin_hash, biometric_enabled, tenant_secret 
             FROM settings WHERE tenant_id = ?1",
            rusqlite::params![tenant_id],
            |row| {
                let bio: i64 = row.get(6)?;
                Ok(SettingsCache {
                    tenant_id: row.get(0)?,
                    institute_name: row.get(1)?,
                    currency_code: row.get(2)?,
                    session_timeout_min: row.get(3)?,
                    theme: row.get(4)?,
                    pin_hash: row.get(5)?,
                    biometric_enabled: bio == 1,
                    tenant_secret: row.get(7)?,
                })
            }
        );

        match query_res {
            Ok(cache) => Ok(cache),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Generate a random tenant secret
                let mut secret_bytes = vec![0u8; 16];
                rand::rng().fill_bytes(&mut secret_bytes);
                let tenant_secret = base64::engine::general_purpose::STANDARD.encode(&secret_bytes);
                let now = chrono::Utc::now().to_rfc3339();

                conn.execute(
                    "INSERT INTO settings (tenant_id, institute_name, currency_code, session_timeout_min, theme, biometric_enabled, pin_hash, tenant_secret, created_at, updated_at) 
                     VALUES (?1, 'My Tuition', 'INR', 5, 'system', 0, NULL, ?2, ?3, ?3)",
                    rusqlite::params![tenant_id, tenant_secret, now],
                )?;

                Ok(SettingsCache {
                    tenant_id: tenant_id.to_string(),
                    institute_name: "My Tuition".to_string(),
                    currency_code: "INR".to_string(),
                    session_timeout_min: 5,
                    theme: "system".to_string(),
                    pin_hash: None,
                    biometric_enabled: false,
                    tenant_secret,
                })
            }
            Err(e) => Err(crate::error::AppError::Db(e.to_string())),
        }
    }
}
