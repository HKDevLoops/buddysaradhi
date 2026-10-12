// Implements: docs/rfc/gated-review-packet-phases-1-3-4.md Phase 3 (key
// separation) + docs/adr/0006-data-signing-key-separation.md + AGENTS.md
// Rule 8 (envelope bytes untouched) + Rule 9 (fail-closed, loud).
//
// `src/lib/crypto.ts` resolves its key at MODULE LOAD, so each case resets the
// module registry and re-imports with its own env. The envelope-byte contract
// itself is pinned by `backup-crypto.test.ts` (byte-exact) — this file pins
// the key MODE around it, plus the plaintext manifest that travels alongside.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type { LogContext } from '@/lib/logger';

const SHARED = 'web-test-shared-secret-that-is-at-least-32-chars';
const DATA = 'web-test-data-key-that-is-at-least-32-chars-0000';
const saved = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

/** Fresh logger (for the warn spy) + fresh crypto (for the key resolution). */
async function freshCrypto(): Promise<{
  crypto: typeof import('@/lib/crypto');
  warnSpy: MockInstance<(action: string, message: string, context?: LogContext) => void>;
}> {
  vi.resetModules();
  const logger = await import('@/lib/logger');
  const warnSpy = vi.spyOn(logger.log, 'warn');
  const crypto = await import('@/lib/crypto');
  return { crypto, warnSpy };
}

/** Reproduces the legacy (pre-Argon2id) envelope exactly, keyed off `secret`. */
async function buildLegacyEnvelope(plaintext: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoder.encode(plaintext)),
  );
  const out = new Uint8Array(16 + 12 + encrypted.length);
  out.set(salt, 0);
  out.set(nonce, 16);
  out.set(encrypted, 28);
  return Buffer.from(out).toString('base64');
}

describe('key separation — fallback engages LOUD, never silent (Rule 9)', () => {
  it('warns crypto.data_key_fallback naming the missing var when DATA is unset', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', undefined);
    setEnv('STRICT_KEY_SEPARATION', undefined);
    const { crypto, warnSpy } = await freshCrypto();
    expect(crypto.isLegacyBackupKeyFallback()).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'crypto.data_key_fallback',
      expect.any(String),
      expect.objectContaining({ missing: 'DATA_ENCRYPTION_KEY' }),
    );
    // Names variables, never values (10_Security.md §8).
    const raw = JSON.stringify(warnSpy.mock.calls);
    expect(raw).not.toContain(SHARED);
    expect(raw).not.toContain(DATA);
  });

  it('stays silent (no fallback warn) when DATA is explicitly set', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', DATA);
    setEnv('STRICT_KEY_SEPARATION', undefined);
    const { crypto, warnSpy } = await freshCrypto();
    expect(crypto.isLegacyBackupKeyFallback()).toBe(false);
    expect(
      warnSpy.mock.calls.filter(([action]) => action === 'crypto.data_key_fallback'),
    ).toHaveLength(0);
  });
});

describe('key separation — STRICT_KEY_SEPARATION refuses the coupled mode', () => {
  it('STRICT on + DATA unset refuses boot even though the shared secret is set', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', undefined);
    setEnv('STRICT_KEY_SEPARATION', 'true');
    vi.resetModules();
    await expect(import('@/lib/crypto')).rejects.toThrow(
      /STRICT_KEY_SEPARATION is on but DATA_ENCRYPTION_KEY is not set/,
    );
  });

  it('STRICT on + DATA set boots separated: the legacy key is DATA, not the signing secret', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', DATA);
    setEnv('STRICT_KEY_SEPARATION', 'true');
    const { crypto } = await freshCrypto();
    expect(crypto.isStrictKeySeparation()).toBe(true);
    expect(crypto.isLegacyBackupKeyFallback()).toBe(false);
    // hmacSign wire values untouched: caller-supplied secret, same derivation.
    const sig = await crypto.hmacSign(SHARED, 'material');
    expect(await crypto.hmacVerify(SHARED, 'material', sig)).toBe(true);
    // A legacy file sealed under DATA opens …
    expect(await crypto.decryptBackup(await buildLegacyEnvelope('tutor rows', DATA), 'unused')).toBe(
      'tutor rows',
    );
    // … while one sealed under the signing secret no longer does: the keys differ.
    await expect(crypto.decryptBackup(await buildLegacyEnvelope('tutor rows', SHARED), 'unused')).rejects.toThrow();
  });
});

describe('key separation — STRICT off + DATA unset behaves exactly as today', () => {
  it('legacy files sealed under the shared secret still decrypt (byte-identical fallback)', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', undefined);
    setEnv('STRICT_KEY_SEPARATION', undefined);
    const { crypto } = await freshCrypto();
    expect(crypto.isStrictKeySeparation()).toBe(false);
    expect(await crypto.decryptBackup(await buildLegacyEnvelope('legacy rows', SHARED), 'unused')).toBe(
      'legacy rows',
    );
  });

  it('both vars unset keeps the exact fail-closed error (no dev fallback)', async () => {
    // resolvePepper() runs first at module load, so PIN_PEPPER is primed to
    // let resolution reach the legacy-key gate under test (unchanged precedence).
    setEnv('PIN_PEPPER', 'web-test-pin-pepper-that-is-long-enough-ok');
    setEnv('GATEWAY_SHARED_SECRET', undefined);
    setEnv('DATA_ENCRYPTION_KEY', undefined);
    setEnv('STRICT_KEY_SEPARATION', undefined);
    vi.resetModules();
    await expect(import('@/lib/crypto')).rejects.toThrow(
      /DATA_ENCRYPTION_KEY or GATEWAY_SHARED_SECRET must be set/,
    );
  });
});

describe('backup key manifest — version travels alongside, never inside (Rule 8)', () => {
  it('carries the envelope version, KDF id, and key domain', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', undefined);
    setEnv('STRICT_KEY_SEPARATION', undefined);
    const { crypto } = await freshCrypto();
    expect(crypto.backupKeyManifest()).toEqual({
      envelopeVersion: 1,
      kdf: 'argon2id-m65536-t3-p2-v0x13',
      keyDomain: 'passphrase',
      dataKeyFallback: true,
      strictSeparation: false,
    });
  });

  it('reflects the separated mode once armed', async () => {
    setEnv('GATEWAY_SHARED_SECRET', SHARED);
    setEnv('DATA_ENCRYPTION_KEY', DATA);
    setEnv('STRICT_KEY_SEPARATION', 'true');
    const { crypto } = await freshCrypto();
    const manifest = crypto.backupKeyManifest();
    expect(manifest.dataKeyFallback).toBe(false);
    expect(manifest.strictSeparation).toBe(true);
    expect(manifest.envelopeVersion).toBe(1);
  });
});
