import React, { createContext, useContext, useEffect, useState } from 'react';
import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';
import { initSchema } from './migrations/schema';

interface DBContextType {
  db: SQLiteDatabase | null;
  isReady: boolean;
  error: Error | null;
}

const DBContext = createContext<DBContextType>({
  db: null,
  isReady: false,
  error: null,
});

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function initDB() {
      try {
        const database = await openDatabaseAsync('buddysaradhi.db');
        
        // Execute PRAGMAs required per spec
        await database.execAsync(`
          PRAGMA journal_mode = WAL;
          PRAGMA foreign_keys = ON;
        `);
        
        // Ensure migrations table exists
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY
          );
        `);

        // Check current version
        const result = await database.getFirstAsync<{ version: number }>('SELECT MAX(version) as version FROM schema_migrations');
        let currentVersion = result?.version || 0;

        if (currentVersion === 0) {
          // Initialize DB using 0001_init.sql
          // Since we can't reliably load assets via FileSystem without require in expo-asset easily,
          // for the sake of the scaffold we can hardcode the query or use expo-sqlite migration API.
          // Wait, we need to load 0001_init.sql text.
          await database.execAsync(initSchema);
          
          await database.execAsync(`INSERT INTO schema_migrations (version) VALUES (1);`);
          currentVersion = 1;
        }

        setDb(database);
        setIsReady(true);
      } catch (e) {
        setError(e as Error);
      }
    }

    initDB();
  }, []);

  if (error) {
    throw error;
  }

  if (!isReady) {
    return null; // Or a splash screen
  }

  return (
    <DBContext.Provider value={{ db, isReady, error: null }}>
      {children}
    </DBContext.Provider>
  );
}

// Hook to access the DB, mimicking expo-sqlite's useSQLiteContext if needed, 
// though we can just use expo-sqlite directly inside `<SQLiteProvider>` if we wanted.
export const useDatabase = () => useContext(DBContext);
