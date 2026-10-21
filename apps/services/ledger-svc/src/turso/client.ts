import { createClient } from "@libsql/client";

export function getTursoClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error(
      "Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables. " +
        "Please check your .env files (or .env.local/etc)."
    );
  }

  return createClient({
    url,
    authToken,
  });
}
