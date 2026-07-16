pub mod state;
pub mod db;
pub mod commands;
pub mod error;
pub mod crypto;
pub mod security;
pub mod sync;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      // Initialize AppState (opens encrypted DB, keychain handles, loads settings)
      let state = state::AppState::init(app.handle().clone())
          .expect("Failed to initialize AppState");
      app.manage(state);

      // Spawn sync outbox flusher
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
          sync::run_flusher(handle).await;
      });

      Ok(())
    })
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        // Auth Commands
        commands::auth::unlock,
        commands::auth::lock,
        commands::auth::biometric_unlock,

        // Backup/Restore
        commands::backup::create_backup,
        commands::backup::restore_backup,

        // Dashboard
        commands::dashboard::get_kpis,
        commands::dashboard::get_recent_activity,
        commands::dashboard::get_reminders,

        // Students
        commands::students::get_students,
        commands::students::get_student,
        commands::students::create_student,
        commands::students::update_student,
        commands::students::archive_student,

        // Attendance
        commands::attendance::mark_attendance,
        commands::attendance::get_attendance_session,
        commands::attendance::lock_attendance_session,
        commands::attendance::unlock_attendance_session,

        // Ledger
        commands::ledger::record_payment,
        commands::ledger::void_ledger_entry,
        commands::ledger::get_fee_matrix,
        commands::ledger::get_receipt_pdf,

        // Settings
        commands::settings::get_settings,
        commands::settings::update_settings,
        commands::settings::get_audit_log,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
