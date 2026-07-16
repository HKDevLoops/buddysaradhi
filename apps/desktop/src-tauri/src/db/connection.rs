use rusqlite::{Connection, Result};
use std::path::Path;

mod migrations {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

pub fn open_encrypted<P: AsRef<Path>>(path: P, key: &str) -> Result<Connection> {
    let mut conn = Connection::open(path)?;
    
    let pragma_query = format!("PRAGMA key = '{}';", key);
    conn.execute_batch(&pragma_query)?;

    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch("PRAGMA temp_store = MEMORY;")?;

    migrations::migrations::runner().run(&mut conn).unwrap();

    Ok(conn)
}

pub fn run_refinery_migrations(conn: &mut Connection) -> std::result::Result<(), crate::error::AppError> {
    migrations::migrations::runner().run(conn)
        .map_err(|e| crate::error::AppError::Db(format!("Migration error: {}", e)))?;
    Ok(())
}
