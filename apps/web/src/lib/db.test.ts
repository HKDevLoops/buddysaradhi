// Implements: 11_Data_Model.md — DB credential resolution tests
// Tests getDbCredentials from lib/db.ts using vitest

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDbCredentials } from './db';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
const REAL_URL = 'libsql://buddysaradhi-abc123.aws-ap-south-1.turso.io';
const REAL_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.real-token';

const ENV_URL = 'libsql://shared-dev.turso.io';
const ENV_TOKEN = 'shared-token-abc';

// Store original env values so we can restore them
let originalDbUrl: string | undefined;
let originalAuthToken: string | undefined;

beforeEach(() => {
  originalDbUrl = process.env.TURSO_DATABASE_URL;
  originalAuthToken = process.env.TURSO_AUTH_TOKEN;
  // Default: no env vars set (will be overridden per test as needed)
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

afterEach(() => {
  // Restore original env
  if (originalDbUrl !== undefined) {
    process.env.TURSO_DATABASE_URL = originalDbUrl;
  } else {
    delete process.env.TURSO_DATABASE_URL;
  }
  if (originalAuthToken !== undefined) {
    process.env.TURSO_AUTH_TOKEN = originalAuthToken;
  } else {
    delete process.env.TURSO_AUTH_TOKEN;
  }
});

// ────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────
describe('getDbCredentials', () => {
  // ── 1. Happy path: real metadata credentials ──────────────
  it('returns metadata creds when a real libsql:// URL is present', () => {
    const result = getDbCredentials({
      db_url: REAL_URL,
      db_token: REAL_TOKEN,
    });
    expect(result.dbUrl).toBe(REAL_URL);
    expect(result.dbToken).toBe(REAL_TOKEN);
  });

  // ── 2. Metadata has null db_url → fall back to env ────────
  it('returns env fallback when metadata has null db_url', () => {
    process.env.TURSO_DATABASE_URL = ENV_URL;
    process.env.TURSO_AUTH_TOKEN = ENV_TOKEN;

    const result = getDbCredentials({ db_url: null, db_token: null });
    expect(result.dbUrl).toBe(ENV_URL);
    expect(result.dbToken).toBe(ENV_TOKEN);
  });

  // ── 3. Dummy sentinel URL → fall back to env ──────────────
  it('returns env fallback when metadata has dummy sentinel URL', () => {
    process.env.TURSO_DATABASE_URL = ENV_URL;
    process.env.TURSO_AUTH_TOKEN = ENV_TOKEN;

    const result = getDbCredentials({
      db_url: 'libsql://dummy-local-dev-url',
      db_token: 'some-token',
    });
    expect(result.dbUrl).toBe(ENV_URL);
    expect(result.dbToken).toBe(ENV_TOKEN);
  });

  // ── 4. file: URL (local dev SQLite) → fall back to env ────
  it('returns env fallback when metadata has a file: URL', () => {
    process.env.TURSO_DATABASE_URL = ENV_URL;
    process.env.TURSO_AUTH_TOKEN = ENV_TOKEN;

    const result = getDbCredentials({
      db_url: 'file:///local/dev.db',
      db_token: 'irrelevant',
    });
    expect(result.dbUrl).toBe(ENV_URL);
    expect(result.dbToken).toBe(ENV_TOKEN);
  });

  // ── 5. "dummy" token sentinel → fall back to env ──────────
  it('returns env fallback when metadata db_url contains "dummy"', () => {
    process.env.TURSO_DATABASE_URL = ENV_URL;
    process.env.TURSO_AUTH_TOKEN = ENV_TOKEN;

    const result = getDbCredentials({
      db_url: 'libsql://dummy',
      db_token: 'some-token',
    });
    expect(result.dbUrl).toBe(ENV_URL);
    expect(result.dbToken).toBe(ENV_TOKEN);
  });

  // ── 6. No creds at all → throw DB_NOT_PROVISIONED ─────────
  it('throws DB_NOT_PROVISIONED when no metadata and no env vars', () => {
    // env vars already deleted by beforeEach
    expect(() => getDbCredentials(undefined)).toThrow('DB_NOT_PROVISIONED');
  });

  // ── 7. Empty metadata object + no env → throw ─────────────
  it('throws DB_NOT_PROVISIONED when metadata is empty object and no env vars', () => {
    expect(() => getDbCredentials({})).toThrow('DB_NOT_PROVISIONED');
  });

  // ── 8. Dummy sentinel + no env → throw ────────────────────
  it('throws DB_NOT_PROVISIONED when dummy sentinel and no env fallback', () => {
    expect(() =>
      getDbCredentials({
        db_url: 'libsql://dummy-local-dev-url',
        db_token: 'tok',
      })
    ).toThrow('DB_NOT_PROVISIONED');
  });

  // ── 9. Metadata undefined + no env → throw ────────────────
  it('throws DB_NOT_PROVISIONED when metadata is undefined and no env vars', () => {
    expect(() => getDbCredentials(undefined)).toThrow(
      'DB_NOT_PROVISIONED: User database is not yet provisioned.'
    );
  });

  // ── 10. Env fallback used when metadata token is missing ───
  it('uses env fallback when metadata has real URL but no token', () => {
    process.env.TURSO_DATABASE_URL = ENV_URL;
    process.env.TURSO_AUTH_TOKEN = ENV_TOKEN;

    const result = getDbCredentials({
      db_url: REAL_URL,
      db_token: undefined,
    });
    expect(result.dbUrl).toBe(ENV_URL);
    expect(result.dbToken).toBe(ENV_TOKEN);
  });
});
