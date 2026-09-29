// Implements: 10_Security.md §15 (backup crypto) + §15.3 (Argon2id params),
// 09_Backup_and_Import_Export.md §10.1 (byte-exact envelope) + §15.2 (KDF),
// AGENTS.md Rule 8 (AES-256-GCM + Argon2id, no escrow, no plaintext fallback).
import { hash as argon2Hash, verify as argon2Verify } from 'argon2';

function resolvePepper(): string {
  const p = process.env.PIN_PEPPER || process.env.GATEWAY_SHARED_SECRET || '';
  if (!p) {
    throw new Error('CRITICAL: PIN_PEPPER or GATEWAY_SHARED_SECRET must be set — fail-closed, no dev fallback');
  }
  return p;
}
const PEPPER = resolvePepper();

export async function hashPin(pin: string): Promise<string> {
  return argon2Hash(pin, {
    type: 2,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2,
    hashLength: 32,
    secret: Buffer.from(PEPPER),
  });
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, pin, {
      secret: Buffer.from(PEPPER),
    });
  } catch {
    return false;
  }
}

/**
 * Server env key used ONLY to decrypt legacy (pre-Argon2id) backup envelopes.
 * Fail-closed since commit 67aab56 — no dev fallback (Rule 8 / Rule 9).
 * New backups are bound to the user's passphrase, never to this key.
 */
function resolveAesKey(): string {
  const k = process.env.DATA_ENCRYPTION_KEY || process.env.GATEWAY_SHARED_SECRET || '';
  if (!k) {
    throw new Error('CRITICAL: DATA_ENCRYPTION_KEY or GATEWAY_SHARED_SECRET must be set — fail-closed, no dev fallback');
  }
  return k;
}
const AES_KEY = resolveAesKey();

// ---------------------------------------------------------------------------
// Backup envelope — implements Rule 8 exactly.
//
// NEW layout (base64 of the bytes below):
//   offset  0   4B  magic           ASCII "BSR1"
//   offset  4   1B  format_version  0x01 = Argon2id KDF (current)
//   offset  5  16B  salt            random per file → Argon2id
//   offset 21  12B  nonce           random per file → AES-GCM 96-bit (RFC 8439)
//   offset 33  16B  tag             GCM authentication tag
//   offset 49  var  ciphertext      AES-256-GCM(key, nonce, plaintext)
//
//   key = argon2id(passphrase, salt, { m: 64 MiB, t: 3, p: 2 })  ← Rule 8
//
// The 5-byte magic+version header is spec-mandated, not invented here:
// `09_Backup_and_Import_Export.md` §10.1 byte table (offset 0 `magic` ASCII
// `BSR1`; offset 4 `format_version` = `0x01`) and `10_Security.md` §15.1
// ("The format-version byte lets us introduce a v2 envelope without breaking
// old restores"). AGENTS.md Rule 8 states the payload as
// `salt || nonce || tag || ciphertext` — that payload is byte-identical here,
// with the spec's header prepended as the version marker Rule 8's own
// "add a `kdf_version` marker" requirement needs. AGENTS.md closing note:
// "When a spec and this file disagree, the spec wins."
// Cross-platform contract matches `apps/desktop/src-tauri/src/crypto/envelope.rs`
// (MAGIC "BSR1", VERSION 1, Params::new(65536, 3, 2, 32), Argon2id V0x13).
// Magic discrepancy flag: `10_Security.md` §15.1's ASCII art says "TUT0" while
// its own cross-ref'd subsystem spec (09 §10.1), mockup B1 and the desktop
// implementation all say "BSR1" — BSR1 chosen (majority + implementation
// contract, 22_Redundancy_Audit §5). Reported for a spec-repair RFC.
// ---------------------------------------------------------------------------
const BACKUP_MAGIC = Uint8Array.from([0x42, 0x53, 0x52, 0x31]); // "BSR1"
const BACKUP_FORMAT_VERSION = 0x01;
const BACKUP_SALT_LEN = 16;
const BACKUP_NONCE_LEN = 12;
const BACKUP_TAG_LEN = 16;
const BACKUP_HEADER_LEN = 4 + 1 + BACKUP_SALT_LEN + BACKUP_NONCE_LEN + BACKUP_TAG_LEN; // 49
// Legacy (pre-Argon2id, deployed) layout — base64(salt(16) || nonce(12) ||
// tag(16) || ciphertext) with key = PBKDF2-SHA256(env key, salt, 100000).
// Tutors on buddysaradhi.vercel.app may already hold such files; decrypt is
// RETAINED (decrypt-only, never encrypt) so a KDF upgrade never turns into
// data loss. Ref: AGENTS.md §15 FM-08, 14_Edge_Cases EC-RV-03, audit §9 #1.
// Re-issuing a backup after a restore moves the tutor onto the Argon2id
// envelope. Detection: a legacy blob's first 4 bytes are a random salt, so a
// collision with "BSR1" costs 2^-32 — accepted residual risk, documented here.
const LEGACY_MIN_LEN = BACKUP_SALT_LEN + BACKUP_NONCE_LEN + BACKUP_TAG_LEN; // 44

function isBackupV1(buf: Buffer): boolean {
  if (buf.length < BACKUP_MAGIC.length) return false;
  return BACKUP_MAGIC.every((b, i) => buf[i] === b);
}

/**
 * Rule 8 KDF: Argon2id m=64 MiB (65536 KiB), t=3, p=2, 32-byte raw key,
 * Argon2 v0x13 — identical to the PIN path above and to the desktop engine.
 * No pepper: BACKUP-1 (10_Security.md §15.4) — the passphrase plus the
 * per-file salt is the only state needed to decrypt, anywhere, offline.
 */
async function deriveBackupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2Hash(passphrase, {
    type: 2, // argon2id
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 2,
    hashLength: 32, // AES-256
    version: 0x13,
    salt: Buffer.from(salt),
    raw: true,
  });
  try {
    return await crypto.subtle.importKey('raw', Uint8Array.from(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    // §15.4 key zeroing: material is copied into the non-extractable CryptoKey,
    // then the raw buffer is dropped and zeroed. Never logged, never persisted.
    raw.fill(0);
  }
}

/** Legacy PBKDF2-SHA256 key derivation — decrypt path for old backups only. */
function deriveLegacyBackupKey(salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey('raw', encoder.encode(AES_KEY), 'PBKDF2', false, ['deriveKey']).then(key =>
    crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  );
}

async function aesGcmEncrypt(key: CryptoKey, nonce: Uint8Array<ArrayBuffer>, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  return new Uint8Array(encrypted);
}

async function aesGcmDecrypt(key: CryptoKey, nonce: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<string> {
  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, data);
  } catch {
    // GCM auth-tag mismatch masks corruption as a wrong passphrase.
    // 09_Backup §16.1: E_WRONG_PASSPHRASE (recoverable, attempt-counted).
    throw new Error('E_WRONG_PASSPHRASE: authentication tag mismatch (wrong passphrase or tampered file)');
  }
  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt a backup payload under the tutor's passphrase (Argon2id + AES-256-GCM).
 * The passphrase is the ONLY key material — no server escrow (Rule 8, BACKUP-1).
 */
export async function encryptBackup(plaintext: string, passphrase: string): Promise<string> {
  if (!passphrase) {
    throw new Error('E_PASSPHRASE_REQUIRED: backup encryption requires a passphrase — no escrow, no server-key fallback');
  }
  const salt = crypto.getRandomValues(new Uint8Array(BACKUP_SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(BACKUP_NONCE_LEN));
  const key = await deriveBackupKey(passphrase, salt);
  const encrypted = await aesGcmEncrypt(key, nonce, new TextEncoder().encode(plaintext));
  if (encrypted.length < BACKUP_TAG_LEN) {
    throw new Error('E_CORRUPT: AES-GCM output shorter than its authentication tag');
  }
  const tag = encrypted.slice(encrypted.length - BACKUP_TAG_LEN);
  const ciphertext = encrypted.slice(0, encrypted.length - BACKUP_TAG_LEN);
  const out = new Uint8Array(BACKUP_HEADER_LEN + ciphertext.length);
  out.set(BACKUP_MAGIC, 0);
  out[4] = BACKUP_FORMAT_VERSION;
  out.set(salt, 5);
  out.set(nonce, 5 + BACKUP_SALT_LEN);
  out.set(tag, 5 + BACKUP_SALT_LEN + BACKUP_NONCE_LEN);
  out.set(ciphertext, BACKUP_HEADER_LEN);
  return Buffer.from(out).toString('base64');
}

/**
 * Decrypt a backup payload. Dispatches on the magic header:
 *  - "BSR1" → v1 envelope, Argon2id(passphrase, salt) per Rule 8;
 *  - otherwise → legacy PBKDF2 envelope (pre-Argon2id files, decrypt-only).
 */
export async function decryptBackup(ciphertextB64: string, passphrase: string): Promise<string> {
  const combined = Buffer.from(ciphertextB64, 'base64');
  if (isBackupV1(combined)) {
    if (combined.length < BACKUP_HEADER_LEN) {
      throw new Error('E_BAD_MAGIC: backup envelope truncated');
    }
    const version = combined[4];
    if (version !== BACKUP_FORMAT_VERSION) {
      // 09_Backup §16.1: a newer format must not be guessed at.
      throw new Error(`E_VERSION_AHEAD: unsupported backup format_version ${version}`);
    }
    const salt = new Uint8Array(combined.subarray(5, 5 + BACKUP_SALT_LEN));
    const nonce = new Uint8Array(combined.subarray(21, 33));
    const tag = new Uint8Array(combined.subarray(33, 49));
    const ciphertext = new Uint8Array(combined.subarray(BACKUP_HEADER_LEN));
    const data = new Uint8Array(ciphertext.length + tag.length);
    data.set(ciphertext, 0);
    data.set(tag, ciphertext.length);
    const key = await deriveBackupKey(passphrase, salt);
    return aesGcmDecrypt(key, nonce, data);
  }

  // Legacy path — salt(16) || nonce(12) || tag(16) || ciphertext, PBKDF2 key.
  if (combined.length < LEGACY_MIN_LEN) {
    throw new Error('E_BAD_MAGIC: not a Buddysaradhi backup envelope');
  }
  const salt = new Uint8Array(combined.subarray(0, BACKUP_SALT_LEN));
  const nonce = new Uint8Array(combined.subarray(16, 28));
  const data = new Uint8Array(combined.subarray(28));
  const key = await deriveLegacyBackupKey(salt);
  return aesGcmDecrypt(key, nonce, data);
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, data);
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}
