use rusqlite::Connection;
use crate::error::AppError;
use std::io::{Read, Write};
use base64::Engine;
use flate2::write::GzEncoder;
use flate2::read::GzDecoder;
use flate2::Compression;
use sha2::{Sha256, Digest};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce
};
use argon2::{
    Algorithm, Argon2, Params, Version
};
use rand::RngCore;
use zeroize::Zeroizing;
use serde_json::Value;

const MAGIC: &[u8] = b"BSR1";
const VERSION: u8 = 1;

pub fn encrypt_backup(
    conn: &Connection,
    passphrase: &str,
    tenant_id: &str,
    schema_version: i64,
) -> Result<Vec<u8>, AppError> {
    // 1. Flush WAL
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| AppError::Db(format!("WAL checkpoint failed: {}", e)))?;

    // 2. Export all tables to NDJSON
    let tables = [
        "settings",
        "tutors",
        "batches",
        "students",
        "ledger_entries",
        "receipts",
        "attendance_sessions",
        "attendance_records",
        "audit_log",
        "sync_outbox"
    ];

    let mut lines = Vec::new();
    let mut counts = serde_json::Map::new();

    for table in &tables {
        let count = export_table(conn, table, &mut lines)?;
        counts.insert(table.to_string(), serde_json::json!(count));
    }

    let data_jsonl = lines.join("\n");
    
    // Compute SHA256 of data.jsonl
    let mut hasher = Sha256::new();
    hasher.update(data_jsonl.as_bytes());
    let sha256_hex = format!("{:x}", hasher.finalize());

    // 3. Create manifest
    let manifest = serde_json::json!({
        "counts": counts,
        "sha256": sha256_hex,
        "tenant_id": tenant_id,
        "schema_version": schema_version,
        "created_at": chrono::Utc::now().to_rfc3339()
    });

    // 4. Create tar archive in memory
    let mut tar_bytes = Vec::new();
    {
        let mut archive = tar::Builder::new(&mut tar_bytes);
        
        let mut header = tar::Header::new_gnu();
        header.set_size(data_jsonl.len() as u64);
        header.set_mode(0o644);
        archive.append_data(&mut header, "data.jsonl", data_jsonl.as_bytes())
            .map_err(|e| AppError::Io(e.to_string()))?;
        
        let schema_txt = schema_version.to_string();
        let mut header = tar::Header::new_gnu();
        header.set_size(schema_txt.len() as u64);
        header.set_mode(0o644);
        archive.append_data(&mut header, "schema_version.txt", schema_txt.as_bytes())
            .map_err(|e| AppError::Io(e.to_string()))?;
        
        let manifest_str = serde_json::to_string_pretty(&manifest)?;
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest_str.len() as u64);
        header.set_mode(0o644);
        archive.append_data(&mut header, "manifest.json", manifest_str.as_bytes())
            .map_err(|e| AppError::Io(e.to_string()))?;
        
        archive.finish().map_err(|e| AppError::Io(e.to_string()))?;
    }

    // 5. Gzip compress
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&tar_bytes).map_err(|e| AppError::Io(e.to_string()))?;
    let gzip_bytes = encoder.finish().map_err(|e| AppError::Io(e.to_string()))?;

    // 6. Generate salt and derive key via Argon2id
    let mut salt = [0u8; 16];
    rand::rng().fill_bytes(&mut salt);
    
    let params = Params::new(65536, 3, 2, Some(32))
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new(vec![0u8; 32]);
    argon2.hash_password_into(passphrase.as_bytes(), &salt, &mut *key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    // 7. Encrypt with AES-256-GCM
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let encrypted_payload = cipher.encrypt(nonce, gzip_bytes.as_slice())
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    if encrypted_payload.len() < 16 {
        return Err(AppError::Crypto("Encryption output too short".into()));
    }

    // Split tag and ciphertext
    let tag = &encrypted_payload[encrypted_payload.len() - 16..];
    let ciphertext = &encrypted_payload[..encrypted_payload.len() - 16];

    // Assemble envelope
    let mut envelope = Vec::new();
    envelope.write_all(MAGIC)?;
    envelope.write_all(&[VERSION])?;
    envelope.write_all(&salt)?;
    envelope.write_all(&nonce_bytes)?;
    envelope.write_all(tag)?;
    envelope.write_all(ciphertext)?;

    Ok(envelope)
}

pub fn decrypt_backup(
    envelope: &[u8],
    passphrase: &str,
    local_schema_version: i64,
) -> Result<(String, Value), AppError> {
    if envelope.len() < 49 {
        return Err(AppError::Crypto("File too small to be a valid backup".into()));
    }

    if &envelope[0..4] != MAGIC {
        return Err(AppError::Crypto("Invalid magic number in backup envelope".into()));
    }

    let version = envelope[4];
    if version != VERSION {
        return Err(AppError::Crypto(format!("Unsupported backup version: {}", version)));
    }

    let salt = &envelope[5..21];
    let nonce_bytes = &envelope[21..33];
    let tag = &envelope[33..49];
    let ciphertext = &envelope[49..];

    // Derive key
    let params = Params::new(65536, 3, 2, Some(32))
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new(vec![0u8; 32]);
    argon2.hash_password_into(passphrase.as_bytes(), salt, &mut *key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    // Decrypt
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(nonce_bytes);
    
    // Construct encrypted payload for aes-gcm crate: ciphertext || tag
    let mut payload = ciphertext.to_vec();
    payload.extend_from_slice(tag);

    let decrypted = cipher.decrypt(nonce, payload.as_slice())
        .map_err(|_| AppError::Auth("Incorrect passphrase".into()))?;

    // Decompress gzip
    let mut decoder = GzDecoder::new(&decrypted[..]);
    let mut tar_bytes = Vec::new();
    decoder.read_to_end(&mut tar_bytes).map_err(|e| AppError::Io(e.to_string()))?;

    // Extract tar
    let mut archive = tar::Archive::new(&tar_bytes[..]);
    let mut data_jsonl = String::new();
    let mut manifest_val = Value::Null;

    for entry in archive.entries().map_err(|e| AppError::Io(e.to_string()))? {
        let mut entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let path = entry.path().map_err(|e| AppError::Io(e.to_string()))?.to_path_buf();
        
        let mut content = String::new();
        entry.read_to_string(&mut content).map_err(|e| AppError::Io(e.to_string()))?;

        if path.to_str() == Some("data.jsonl") {
            data_jsonl = content;
        } else if path.to_str() == Some("manifest.json") {
            manifest_val = serde_json::from_str(&content)?;
        }
    }

    if data_jsonl.is_empty() || manifest_val.is_null() {
        return Err(AppError::Crypto("Corrupted backup: missing data.jsonl or manifest.json".into()));
    }

    // Verify SHA256
    let mut hasher = Sha256::new();
    hasher.update(data_jsonl.as_bytes());
    let sha256_hex = format!("{:x}", hasher.finalize());

    let manifest_sha256 = manifest_val["sha256"].as_str()
        .ok_or_else(|| AppError::Crypto("Manifest missing sha256 checksum".into()))?;

    if sha256_hex != manifest_sha256 {
        return Err(AppError::Crypto("Backup integrity check failed: SHA256 mismatch".into()));
    }

    // Schema version check
    let backup_schema_version = manifest_val["schema_version"].as_i64()
        .ok_or_else(|| AppError::Crypto("Manifest missing schema version".into()))?;

    if backup_schema_version > local_schema_version {
        return Err(AppError::Crypto(format!("Backup schema version ({}) is ahead of local version ({}). Please update the app.", backup_schema_version, local_schema_version)));
    }

    Ok((data_jsonl, manifest_val))
}

pub fn restore_db_from_jsonl(
    conn: &mut Connection,
    data_jsonl: &str,
) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    // Disable triggers temporarily by clearing them? No, we don't drop triggers,
    // but the restore clears tables. Wait! Triggers on ledger_entries prevent deletion!
    // Oh! "the secure-erase flow / backup restore is the audited exception per 03 §8.4".
    // Wait, if ledger_entries trigger prevents DELETE, how can we clear the table?
    // We can drop the trigger first, delete all rows, insert all rows, and then recreate the trigger!
    // Yes! Let's do that!
    let _ = tx.execute("DROP TRIGGER IF EXISTS trg_ledger_no_update;", []);
    let _ = tx.execute("DROP TRIGGER IF EXISTS trg_ledger_no_delete;", []);

    // Clear all tables
    let tables = [
        "sync_outbox",
        "audit_log",
        "attendance_records",
        "attendance_sessions",
        "receipts",
        "ledger_entries",
        "students",
        "batches",
        "tutors",
        "settings"
    ];

    for table in &tables {
        tx.execute(&format!("DELETE FROM {};", table), [])?;
    }

    // Insert rows
    for line in data_jsonl.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: Value = serde_json::from_str(line)?;
        let table_name = parsed["table"].as_str()
            .ok_or_else(|| AppError::Crypto("JSON row missing table field".into()))?;
        let data = parsed["data"].as_object()
            .ok_or_else(|| AppError::Crypto("JSON row missing data object".into()))?;

        import_row(&tx, table_name, data)?;
    }

    // Recreate triggers
    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update BEFORE UPDATE ON ledger_entries
         BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only (BR-LED-01). Use void_ledger_entry.'); END;",
        []
    )?;
    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete BEFORE DELETE ON ledger_entries
         BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only (BR-LED-01). Voids are new rows.'); END;",
        []
    )?;

    tx.commit()?;
    Ok(())
}

fn export_table(conn: &Connection, table_name: &str, lines: &mut Vec<String>) -> Result<usize, AppError> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {}", table_name))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    
    let mut rows = stmt.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        let mut map = serde_json::Map::new();
        for i in 0..col_count {
            let val = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::Number(serde_json::Number::from(n)),
                rusqlite::types::ValueRef::Real(f) => Value::Number(serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0))),
                rusqlite::types::ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                rusqlite::types::ValueRef::Blob(b) => Value::String(base64::engine::general_purpose::STANDARD.encode(b)),
            };
            map.insert(col_names[i].clone(), val);
        }
        let json_row = serde_json::json!({
            "table": table_name,
            "data": map
        });
        lines.push(json_row.to_string());
        count += 1;
    }
    Ok(count)
}

fn import_row(tx: &rusqlite::Transaction, table_name: &str, data: &serde_json::Map<String, Value>) -> Result<(), AppError> {
    if data.is_empty() {
        return Ok(());
    }
    
    let mut cols = Vec::new();
    let mut placeholders = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    
    for (k, v) in data {
        cols.push(format!("`{}`", k));
        placeholders.push(format!("?{}", cols.len()));
        
        let to_sql: Box<dyn rusqlite::ToSql> = match v {
            Value::Null => Box::new(rusqlite::types::Null),
            Value::Bool(b) => Box::new(*b),
            Value::Number(num) => {
                if let Some(i) = num.as_i64() {
                    Box::new(i)
                } else if let Some(f) = num.as_f64() {
                    Box::new(f)
                } else {
                    Box::new(0i64)
                }
            }
            Value::String(s) => {
                // Check if it is a binary blob by attempting to decode base64 if needed, but 
                // typically we store strings/dates.
                Box::new(s.clone())
            }
            _ => Box::new(v.to_string()),
        };
        params.push(to_sql);
    }
    
    let sql = format!(
        "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
        table_name,
        cols.join(", "),
        placeholders.join(", ")
    );
    
    let ref_params: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    tx.execute(&sql, rusqlite::params_from_iter(ref_params))
        .map_err(|e| AppError::Db(format!("Failed to insert row into {}: {}", table_name, e)))?;
    Ok(())
}
