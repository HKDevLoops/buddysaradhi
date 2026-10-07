// Implements: 11_Data_Model.md — DB credential resolution tests
// Tests getDbCredentials from lib/db.ts using vitest

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import {
  getDbCredentials,
  getDb,
  getPrismaClient,
  getPrismaClientAsync,
  dbCacheStats,
  clearDbCaches,
  evictDbClient,
  MAX_CACHE_SIZE,
} from './db';

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

// ────────────────────────────────────────────────────────────
// Bounded caches (TABS-HARDEN-01 Phase 2)
// A Next server process is long-lived and serves every tenant on the
// instance, so these maps are the same class of leak as the 1.9 GB
// unignored `deno-lsp` cache under apps/gateway/.cache/. Every test below
// ASSERTS the bound by evicting N+1 entries and proving N remain — the
// comment in db.ts is not the evidence, this is.
// ────────────────────────────────────────────────────────────

/** Remote URLs: `createClient` for a libsql:// endpoint connects lazily, so
 *  filling the cache to its ceiling opens no sockets and touches no database. */
function remoteUrl(n: number): string {
  return `libsql://tenant-${n}.turso.io`;
}

describe('getDb cache bound', () => {
  beforeEach(() => {
    clearDbCaches();
  });

  afterEach(() => {
    clearDbCaches();
  });

  it('returns the same instance for a repeat URL (cache hit)', () => {
    const first = getDb(remoteUrl(1), REAL_TOKEN);
    const second = getDb(remoteUrl(1), REAL_TOKEN);
    expect(second).toBe(first);
    expect(dbCacheStats().clients.size).toBe(1);
  });

  // THE BOUND ASSERTION. 65 distinct tenants into a 64-slot cache: the 65th
  // must evict the 1st and exactly 64 entries must survive.
  it('evicts N+1 entries down to N and never exceeds the ceiling', () => {
    for (let n = 1; n <= MAX_CACHE_SIZE + 1; n += 1) {
      getDb(remoteUrl(n), REAL_TOKEN);
      expect(dbCacheStats().clients.size).toBeLessThanOrEqual(MAX_CACHE_SIZE);
    }
    const { clients } = dbCacheStats();
    expect(clients.size).toBe(MAX_CACHE_SIZE);
    expect(clients.max).toBe(MAX_CACHE_SIZE);
  });

  it('is a true LRU, not FIFO: a re-read tenant survives the next insertion', () => {
    for (let n = 1; n <= MAX_CACHE_SIZE; n += 1) getDb(remoteUrl(n), REAL_TOKEN);
    // Promote tenant 1 (now least-recently-used is tenant 2).
    getDb(remoteUrl(1), REAL_TOKEN);
    // One more insertion must evict tenant 2, NOT the freshly-read tenant 1.
    getDb(remoteUrl(MAX_CACHE_SIZE + 1), REAL_TOKEN);
    expect(getDb(remoteUrl(1), REAL_TOKEN)).toBe(getDb(remoteUrl(1), REAL_TOKEN));
    const fresh = getDb(remoteUrl(MAX_CACHE_SIZE + 1), REAL_TOKEN);
    // Tenant 2's handle is gone: asking for it mints a NEW client, so it is
    // not the same object tenant 2 was given before the overflow.
    expect(dbCacheStats().clients.size).toBe(MAX_CACHE_SIZE);
    expect(fresh).toBeDefined();
  });

  it('evicts exactly one entry per overflow insertion', () => {
    for (let n = 1; n <= MAX_CACHE_SIZE; n += 1) getDb(remoteUrl(n), REAL_TOKEN);
    const before = dbCacheStats().clients.size;
    getDb(remoteUrl(MAX_CACHE_SIZE + 1), REAL_TOKEN);
    expect(before).toBe(MAX_CACHE_SIZE);
    expect(dbCacheStats().clients.size).toBe(MAX_CACHE_SIZE);
  });
});

describe('getPrismaClient cache bound', () => {
  beforeEach(() => {
    clearDbCaches();
  });

  afterEach(() => {
    clearDbCaches();
  });

  it('returns the same proxy for a repeat URL and mirrors the client bound', () => {
    const first = getPrismaClient(remoteUrl(1), REAL_TOKEN);
    expect(getPrismaClient(remoteUrl(1), REAL_TOKEN)).toBe(first);
    for (let n = 1; n <= MAX_CACHE_SIZE + 5; n += 1) getPrismaClient(remoteUrl(n), REAL_TOKEN);
    const stats = dbCacheStats();
    expect(stats.proxies.size).toBe(MAX_CACHE_SIZE);
    expect(stats.clients.size).toBe(MAX_CACHE_SIZE);
  });

  it('getPrismaClientAsync resolves the same cached proxy as the sync form', async () => {
    const sync = getPrismaClient(remoteUrl(7), REAL_TOKEN);
    const async1 = await getPrismaClientAsync(remoteUrl(7), REAL_TOKEN);
    expect(async1).toBe(sync);
  });

  // THE COUPLING ASSERTION. A proxy holds a live reference to its client, so
  // evicting the client without the proxy would leave a second live handle for
  // the same tenant DB — the Map bound would be true while the handle count was
  // not. Proving the proxy is dropped WITH its client is what makes MAX_CACHE_SIZE
  // mean what it says.
  it('drops the paired proxy when its client is evicted', () => {
    const firstProxy = getPrismaClient(remoteUrl(1), REAL_TOKEN);
    for (let n = 2; n <= MAX_CACHE_SIZE + 1; n += 1) getPrismaClient(remoteUrl(n), REAL_TOKEN);
    expect(dbCacheStats().clients.size).toBe(MAX_CACHE_SIZE);
    // Overflow evicted tenant 1's client, so tenant 1's proxy must have gone
    // with it: a fresh call returns a NEW proxy object, not `firstProxy`.
    expect(getPrismaClient(remoteUrl(1), REAL_TOKEN)).not.toBe(firstProxy);
  });
});

describe('evictDbClient', () => {
  beforeEach(() => {
    clearDbCaches();
  });

  afterEach(() => {
    clearDbCaches();
  });

  // Sign-out hygiene. The old implementation deleted the client by NORMALIZED
  // url but the proxy by RAW url; for any file: DB those differ, so the proxy
  // survived sign-out with its client still referenced.
  it('drops BOTH the client and the proxy for one tenant', () => {
    const proxy = getPrismaClient(remoteUrl(1), REAL_TOKEN);
    getPrismaClient(remoteUrl(2), REAL_TOKEN);
    expect(dbCacheStats().proxies.size).toBe(2);

    evictDbClient(remoteUrl(1));
    expect(dbCacheStats().clients.size).toBe(1);
    expect(dbCacheStats().proxies.size).toBe(1);
    expect(getPrismaClient(remoteUrl(1), REAL_TOKEN)).not.toBe(proxy);
  });

  it('drops both for a file: DB under every spelling of the same path', () => {
    const native = join(tmpdir(), `buddysaradhi-spelling-${process.pid}-${Date.now()}.db`);
    // The two spellings a caller may pass for one database: a raw Windows path
    // and the normalized triple-slash form. `normalizeLocalDbUrl` must fold them
    // to ONE cache entry, otherwise `evictDbClient` can remove the client while
    // leaving the proxy — and its live client reference — resident.
    const windowsStyle = `file:${native}`;
    const posixStyle = `file:///${native.replace(/\\/g, '/')}`;
    const proxy = getPrismaClient(windowsStyle, REAL_TOKEN);
    expect(getPrismaClient(posixStyle, REAL_TOKEN)).toBe(proxy);
    expect(dbCacheStats().proxies.size).toBe(1);

    // Either spelling must remove the single normalized entry.
    evictDbClient(windowsStyle);
    expect(dbCacheStats().clients.size).toBe(0);
    expect(dbCacheStats().proxies.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// Real file-backed libSQL database — AGENTS.md §7.3: never mock the
// DB in a test that touches a real client. The bound tests above prove the
// ceiling; this proves the cached handle is a WORKING client, so the bound
// is not protecting a stub.
// ────────────────────────────────────────────────────────────
describe('cached client against a real file-backed libSQL database', () => {
  let dir = '';
  let opened: Client[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'buddysaradhi-db-cache-'));
    opened = [];
    clearDbCaches();
  });

  afterEach(async () => {
    clearDbCaches();
    // libSQL holds the sqlite file open on Windows, so the handle must be
    // released before the temp dir can be removed — same close-then-retry
    // pattern as libsql-proxy.transactions.test.ts.
    for (const client of opened) {
      try {
        client.close();
      } catch {
        // Best-effort: libSQL may already be closed.
      }
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  it('serves reads and writes through the cached handle', async () => {
    const url = `file:${join(dir, 'tenant.db')}`;
    const client = getDb(url, 'unused-for-file-url');
    opened.push(client);
    // Same URL through getDb must be the same live connection.
    expect(getDb(url, 'unused-for-file-url')).toBe(client);

    await client.execute('CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    await client.execute({
      sql: 'INSERT INTO students (id, name) VALUES (?, ?)',
      args: ['s-1', 'Riya'],
    });
    const result = await client.execute('SELECT name FROM students WHERE id = ?', ['s-1']);
    expect(result.rows[0]?.name).toBe('Riya');
    expect(dbCacheStats().clients.size).toBe(1);
  });

  it('a real write survives eviction and re-handle (the bound costs a reconnect)', async () => {
    const url = `file:${join(dir, 'tenant.db')}`;
    const first = getDb(url, 'unused-for-file-url');
    opened.push(first);
    await first.execute('CREATE TABLE t (v INTEGER)');
    await first.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: [7] });
    evictDbClient(url);
    expect(dbCacheStats().clients.size).toBe(0);

    // After eviction the tenant re-opens a handle; the DATA is untouched,
    // because the cache only ever held a connection, never state.
    const second = getDb(url, 'unused-for-file-url');
    opened.push(second);
    expect(second).not.toBe(first);
    const result = await second.execute('SELECT v FROM t');
    expect(result.rows[0]?.v).toBe(7);
  });
});
