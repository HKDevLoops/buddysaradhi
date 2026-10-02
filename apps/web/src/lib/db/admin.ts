// Implements: AGENTS.md §3.4 (the audited home for SQLite-level admin commands that have no
// ORM equivalent) — currently empty.
//
// docs/design/overhaul-plan.md §3 removed this module's only content: the FTS5
// `students_fts` virtual table and its three sync triggers. Nothing created it, nothing
// read it, and `lib/search/searchStudentsFts.ts` — the single caller of the FTS5 `MATCH`
// — is deleted. The L6 raw-SQL allowlist entry in `scripts/principle-lints.mjs` that
// covered this file stays, because §3.4 reserves this path for the admin commands it
// names (SQLCipher `PRAGMA key`, `PRAGMA wal_checkpoint` before a backup snapshot); until
// one of those exists there is simply no SQL here to allow.
//
// This module must NEVER be called from a screen, server action, or API route.