// Deno API mocks for vitest — runs before every test in this gateway suite.
//
// security.test.ts and other files import from ../lib/* which call Deno APIs
// at module level.  We mock them here so vitest can load those modules.

// ── Deno.stdout.writeSync ───────────────────────────────────────────────
// lib/log.ts:59 calls this to emit structured JSON lines.
// We silently swallow to avoid cluttering test output.
if (typeof Deno !== "undefined") {
  const _origWriteSync = Deno.stdout.writeSync.bind(Deno.stdout);
  Deno.stdout.writeSync = (() => {}) as typeof Deno.stdout.writeSync;
  // Expose a restore helper for tests that need the real stdout
  (globalThis as Record<string, unknown>).__restoreStdout = () => {
    Deno.stdout.writeSync = _origWriteSync;
  };
} else {
  // Node / vitest environment — inject a minimal Deno shim
  const noop = () => {};
  (globalThis as Record<string, unknown>).Deno = {
    stdout: { writeSync: noop },
    env: {
      get(key: string): string | undefined {
        // Return empty string by default — auth/crypto modules read env at
        // module level and treat "" as "not set".  Tests can override via
        // process.env before the module is imported.
        return (process.env as Record<string, string | undefined>)[key] ?? "";
      },
    },
    serve: noop,
  };
}

// ── Deno.env.get ────────────────────────────────────────────────────────
// lib/errors.ts:5 reads ALLOWED_ORIGIN at module level.
// lib/crypto.ts:3-7 reads GATEWAY_SHARED_SECRET, DATA_ENCRYPTION_KEY, etc.
// lib/auth.ts:19-20 reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// The shim above already delegates to process.env so tests can override:
//   process.env.GATEWAY_SHARED_SECRET = "test-secret";
// before importing the module under test.
