import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, encryptBackup, decryptBackup, hmacSign, hmacVerify } from '@/lib/crypto';

describe('PIN hashing (Argon2id)', () => {
  it('hashes a PIN', async () => {
    const hash = await hashPin('1234');
    expect(hash).toBeTruthy();
    expect(hash).not.toBe('1234');
    expect(hash.length).toBeGreaterThan(50);
  });

  it('verifies correct PIN', async () => {
    const hash = await hashPin('5678');
    expect(await verifyPin('5678', hash)).toBe(true);
  });

  it('rejects wrong PIN', async () => {
    const hash = await hashPin('5678');
    expect(await verifyPin('0000', hash)).toBe(false);
  });

  it('produces different hashes for same PIN (unique salts)', async () => {
    const h1 = await hashPin('1234');
    const h2 = await hashPin('1234');
    expect(h1).not.toBe(h2);
    expect(await verifyPin('1234', h1)).toBe(true);
    expect(await verifyPin('1234', h2)).toBe(true);
  });
});

describe('AES-256-GCM + Argon2id backup envelope (Rule 8)', () => {
  const PASSPHRASE = 'correct-horse-battery-staple';

  it('round-trips a string', async () => {
    const plaintext = 'sensitive student data';
    const enc = await encryptBackup(plaintext, PASSPHRASE);
    expect(enc).not.toBe(plaintext);
    const dec = await decryptBackup(enc, PASSPHRASE);
    expect(dec).toBe(plaintext);
  });

  it('round-trips Unicode', async () => {
    const plaintext = '\u20B91,255.55 \u2014 \u092E\u0947\u0930\u093E \u0928\u093E\u092E';
    const enc = await encryptBackup(plaintext, PASSPHRASE);
    const dec = await decryptBackup(enc, PASSPHRASE);
    expect(dec).toBe(plaintext);
  });

  it('produces different ciphertexts for same plaintext (random salt + IV)', async () => {
    const enc1 = await encryptBackup('hello', PASSPHRASE);
    const enc2 = await encryptBackup('hello', PASSPHRASE);
    expect(enc1).not.toBe(enc2);
    expect(await decryptBackup(enc1, PASSPHRASE)).toBe('hello');
    expect(await decryptBackup(enc2, PASSPHRASE)).toBe('hello');
  });

  it('fails to decrypt invalid base64 data', async () => {
    await expect(decryptBackup('not-valid-base64!!!', PASSPHRASE)).rejects.toThrow();
  });

  it('fails to decrypt truncated ciphertext', async () => {
    const validEnc = await encryptBackup('test', PASSPHRASE);
    const truncated = validEnc.slice(0, 10);
    await expect(decryptBackup(truncated, PASSPHRASE)).rejects.toThrow();
  });
});

describe('HMAC-SHA256', () => {
  it('signs and verifies', async () => {
    const secret = 'test-secret-key-that-is-long-enough-for-hmac';
    const data = 'message to sign';
    const sig = await hmacSign(secret, data);
    expect(await hmacVerify(secret, data, sig)).toBe(true);
  });

  it('rejects tampered data', async () => {
    const secret = 'test-secret-key-that-is-long-enough-for-hmac';
    const sig = await hmacSign(secret, 'original');
    expect(await hmacVerify(secret, 'tampered', sig)).toBe(false);
  });

  it('rejects wrong secret', async () => {
    const sig = await hmacSign('secret-a', 'data');
    expect(await hmacVerify('secret-b', 'data', sig)).toBe(false);
  });
});
