/**
 * This file is ONLY used by the `provision-db` Supabase Edge Function
 * and the Turso provisioning API calls (TURSO_API_TOKEN).
 *
 * Per-user database clients are created via getDb() in @/lib/db.ts —
 * they use db_url + db_token from user_metadata, NOT env vars.
 *
 * There is NO local-file fallback. The website always uses online cloud DBs.
 */

export const TURSO_API_TOKEN = process.env.TURSO_API_TOKEN;
export const TURSO_ORG = process.env.TURSO_ORGANISATION_SLUG || "harish2222";
