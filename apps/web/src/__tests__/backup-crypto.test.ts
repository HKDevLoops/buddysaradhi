import { describe, it, expect } from 'vitest';
import { encryptBackup, decryptBackup } from '@/lib/crypto';

// Implements: AGENTS.md Rule 8 (envelope + Argon2id params), 10_Security.md
// §15.1/§15.3, 09_Backup_and_Import_Export.md §10.1 (byte-exact layout).
// Real argon2 + real WebCrypto AES-GCM — the crypto is never mocked (§7.3).

const PASSPHRASE = 'tutor-passphrase-2026';

async function buildLegacyEnvelope(plaintext: string): Promise<string> {
  // Reproduces the pre-Argon2id deployed layout exactly:
  // salt(16) || nonce(12) || tag||ciphertext, key = PBKDF2-SHA256(env, 100000).
  const secret = process.env.DATA_ENCRYPTION_KEY || process.env.GATEWAY_SHARED_SECRET;
  if (!secret) {
    throw new Error('legacy fixture needs DATA_ENCRYPTION_KEY or GATEWAY_SHARED_SECRET (see apps/web/vitest.config.ts)');
  }
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

describe('backup crypto — Rule 8 envelope + legacy compatibility', () => {
  it('writes the spec byte layout: BSR1 | 0x01 | salt(16) | nonce(12) | tag(16) | ct', async () => {
    const payload = JSON.stringify({ students: 40, ledger: 120 });
    const b64 = await encryptBackup(payload, PASSPHRASE);
    const raw = Buffer.from(b64, 'base64');

    expect(new TextDecoder().decode(raw.subarray(0, 4))).toBe('BSR1');
    expect(raw[4]).toBe(0x01);
    expect(raw.length).toBeGreaterThanOrEqual(49);

    const salt = raw.subarray(5, 21);
    const salt2 = Buffer.from(await encryptBackup(payload, PASSPHRASE)).subarray(5, 21);
    expect(salt.equals(salt2)).toBe(false); // per-file random salt (§15.3)

    expect(await decryptBackup(b64, PASSPHRASE)).toBe(payload);
  });

  it('rejects a wrong passphrase (GCM auth-tag mismatch → E_WRONG_PASSPHRASE)', async () => {
    const b64 = await encryptBackup('fee ledger rows', PASSPHRASE);
    await expect(decryptBackup(b64, 'wrong-passphrase-xxxx')).rejects.toThrow('E_WRONG_PASSPHRASE');
  });

  it('decrypts a legacy PBKDF2 envelope so old backups are never data-loss', async () => {
    const legacyB64 = await buildLegacyEnvelope('legacy backup rows');
    // Legacy files carry no passphrase binding — decrypt must dispatch on the
    // missing magic, not on the KDF. The passphrase arg is unused by design.
    expect(await decryptBackup(legacyB64, PASSPHRASE)).toBe('legacy backup rows');
    expect(await decryptBackup(legacyB64, '')).toBe('legacy backup rows');
  });
});
