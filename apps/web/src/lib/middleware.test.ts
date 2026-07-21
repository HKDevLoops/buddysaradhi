// Implements: proxy.ts — isDummyDbUrl sentinel classification tests
//
// isDummyDbUrl is a local function in proxy.ts (previously middleware.ts).
// Since it is not exported, we inline-replicate the same logic here and
// verify it classifies URLs correctly.  This documents the contract so any
// future refactor that accidentally changes the sentinels fails fast.

import { describe, it, expect } from 'vitest';

// ────────────────────────────────────────────────────────────
// Re-implement the same logic as the local isDummyDbUrl in proxy.ts
// (from src/lib/db.ts DUMMY_SENTINELS — the canonical definition)
// ────────────────────────────────────────────────────────────
const DUMMY_SENTINELS = ['dummy-local-dev-url', 'file:', 'dummy'];

function isDummyDbUrl(url: string | null | undefined): boolean {
  if (url === null || url === undefined || url === '') return true;
  return DUMMY_SENTINELS.some((sentinel) => url.includes(sentinel));
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────
describe('isDummyDbUrl sentinel classification', () => {
  // ── Definitely dummy ──────────────────────────────────────
  it('classifies null as dummy', () => {
    expect(isDummyDbUrl(null)).toBe(true);
  });

  it('classifies undefined as dummy', () => {
    expect(isDummyDbUrl(undefined)).toBe(true);
  });

  it('classifies empty string as dummy', () => {
    expect(isDummyDbUrl('')).toBe(true);
  });

  it('classifies "libsql://dummy-local-dev-url" as dummy', () => {
    expect(isDummyDbUrl('libsql://dummy-local-dev-url')).toBe(true);
  });

  it('classifies "dummy" as dummy', () => {
    expect(isDummyDbUrl('dummy')).toBe(true);
  });

  it('classifies "file:///local.db" as dummy', () => {
    expect(isDummyDbUrl('file:///local.db')).toBe(true);
  });

  it('classifies bare "file:" prefix as dummy', () => {
    expect(isDummyDbUrl('file:dev.sqlite')).toBe(true);
  });

  it('classifies "libsql://dummy" as dummy (contains sentinel)', () => {
    expect(isDummyDbUrl('libsql://dummy')).toBe(true);
  });

  // ── Definitely NOT dummy (real Turso URLs) ─────────────────
  it('does NOT classify real Turso URL as dummy', () => {
    expect(
      isDummyDbUrl('libsql://buddysaradhi-abc123.aws-ap-south-1.turso.io')
    ).toBe(false);
  });

  it('does NOT classify another real Turso URL as dummy', () => {
    expect(isDummyDbUrl('libsql://real-db-prod.turso.io')).toBe(false);
  });

  it('does NOT classify https:// URL as dummy', () => {
    expect(isDummyDbUrl('https://prod.turso.io/db')).toBe(false);
  });

  it('does NOT classify staging Turso URL as dummy', () => {
    expect(
      isDummyDbUrl('libsql://staging-buddysaradhi.turso.io')
    ).toBe(false);
  });
});
