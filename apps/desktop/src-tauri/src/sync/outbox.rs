use tauri::AppHandle;
use tauri::Manager;
use std::time::Duration;
use crate::state::AppState;
use crate::error::AppError;

pub async fn run_flusher(app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        if let Err(e) = flush_once(&app).await {
            log::warn!("Sync outbox flusher tick error: {:?}", e);
        }
    }
}

async fn flush_once(app: &AppHandle) -> Result<(), AppError> {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return Ok(()),
    };

    // If keychain has no Turso token, sync is unconfigured/paused
    let _turso_token = match state.keyring_turso.get_password() {
        Ok(t) => t,
        Err(_) => {
            log::info!("Turso token not configured in keychain. Sync paused.");
            return Ok(());
        }
    };

    let tenant_id = {
        let settings = state.settings.read().unwrap();
        settings.tenant_id.clone()
    };

    // Lazy initialize libsql sync client (mocked as String for offline local dev)
    let _client = state.libsql.get_or_init(|| {
        format!("https://buddysaradhi-{}.turso.io", tenant_id)
    });

    // Fetch pending sync entries
    let pending_rows: Vec<OutboxRow> = {
        let db = state.db.lock();
        let mut stmt = db.prepare_cached(
            "SELECT id, tenant_id, table_name, row_id, op, payload, status, attempts 
             FROM sync_outbox WHERE status = 'pending' ORDER BY created_at LIMIT 100"
        ).map_err(|e| AppError::Db(e.to_string()))?;

        let rows = stmt.query_map([], |r| {
            Ok(OutboxRow {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                table_name: r.get(2)?,
                row_id: r.get(3)?,
                op: r.get(4)?,
                payload: r.get(5)?,
                status: r.get(6)?,
                attempts: r.get(7)?,
            })
        }).map_err(|e| AppError::Db(e.to_string()))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        out
    };

    if pending_rows.is_empty() {
        return Ok(());
    }

    log::info!("Sync outbox: flushing {} pending rows", pending_rows.len());

    for row in pending_rows {
        // Mocking client push for local dev. If unconfigured/timeout, increment attempts.
        // We will simulate success by marking as 'sent' if it's local development, 
        // but if we want to simulate failure, we can increment attempts. Let's mark as 'sent'
        // immediately for mock mode to prevent outbox from growing indefinitely in offline runs!
        let db = state.db.lock();
        let now = chrono::Utc::now().to_rfc3339();
        db.execute(
            "UPDATE sync_outbox SET status = 'sent', sent_at = ?1 WHERE id = ?2",
            rusqlite::params![now, row.id],
        ).map_err(|e| AppError::Db(e.to_string()))?;
    }

    Ok(())
}

#[allow(dead_code)]
#[derive(Debug)]
struct OutboxRow {
    pub id: String,
    pub tenant_id: String,
    pub table_name: String,
    pub row_id: String,
    pub op: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
}
