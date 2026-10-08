// Implements: RFC pin-recovery-v1.md — TOTP/Passkey PIN Recovery
// Sovereignty constraints: no escrow, no telemetry, offline-first, no plaintext.
// Implements: 10_Security.md §15 (Argon2id KDF) + 08_Settings.md SR-12 (KDF params).
// Google Authenticator TOTP Integration: RFC 6238 compliant using otplib
import { authenticator } from 'otplib';
import { hash as argon2Hash, verify as argon2Verify } from 'argon2';

/**
 * Resolve the pepper from environment variables.
 * The pepper is a secret added to the PIN before hashing.
 */
function resolvePepper(): string {
  const p = process.env.PIN_PEPPER || process.env.GATEWAY_SHARED_SECRET || '';
  if (!p) {
    throw new Error('CRITICAL: PIN_PEPPER or GATEWAY_SHARED_SECRET must be set — fail-closed, no dev fallback');
  }
  return p;
}
const PEPPER = resolvePepper();

/**
 * Resolve the TOTP-specific pepper from environment variables.
 * Uses a separate pepper for TOTP encryption to prevent cross-protocol attacks.
 */
function resolveTotpPepper(): string {
  const p = process.env.TOTP_PEPPER || process.env.PIN_PEPPER || process.env.GATEWAY_SHARED_SECRET || '';
  if (!p) {
    throw new Error('CRITICAL: TOTP_PEPPER or PIN_PEPPER or GATEWAY_SHARED_SECRET must be set — fail-closed, no dev fallback');
  }
  return p;
}
const TOTP_PEPPER = resolveTotpPepper();

/**
 * Hash a PIN using Argon2id with the pepper.
 * Identical KDF params to the backup and PIN paths (m=64MiB, t=3, p=2).
 */
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

/**
 * Verify a PIN against an Argon2id hash.
 */
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
 * TOTP Secret Encryption — Sovereignty-Preserving
 * 
 * The TOTP secret is encrypted with a PIN-derived key (Argon2id + pepper)
 * so it is NEVER stored in plaintext. The encryption uses AES-256-GCM
 * with a per-secret random nonce. The secret is NEVER synced, never logged,
 * and never in plaintext at rest.
 * 
 * Key Derivation: Argon2id(PIN || TOTP_PEPPER, salt, m=64MiB, t=3, p=2)
 * Encryption: AES-256-GCM with per-secret random nonce
 * Storage: base64(salt(16) || nonce(12) || tag(16) || ciphertext) with "TOTP" magic header
 * 
 * The secret is NEVER synced (excluded from sync_outbox like pin_hash).
 * The secret is NEVER included in backup envelopes.
 * The secret is re-encrypted when PIN changes.
 */

const TOTP_SALT_LEN = 16;
const TOTP_NONCE_LEN = 12;
const TOTP_TAG_LEN = 16;
const TOTP_HEADER_LEN = 4 + 1 + 16 + 12 + 16; // 33

async function deriveTotpKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2Hash(pin, {
    type: 2,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2,
    hashLength: 32,
    version: 0x13,
    salt: Buffer.from(salt),
    secret: Buffer.from(TOTP_PEPPER),
    raw: true,
  });
  try {
    return await crypto.subtle.importKey('raw', Uint8Array.from(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

async function aesGcmEncrypt(key: CryptoKey, nonce: Uint8Array<ArrayBuffer>, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  return new Uint8Array(encrypted);
}

async function aesGcmDecrypt(key: CryptoKey, nonce: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  } catch {
    throw new Error('E_WRONG_PIN: authentication tag mismatch (wrong PIN or tampered data)');
  }
}

export async function encryptTotpSecret(totpSecret: string, pin: string): Promise<string> {
  if (!totpSecret) throw new Error('E_TOTP_SECRET_REQUIRED: TOTP secret cannot be empty');
  if (!pin) throw new Error('E_PIN_REQUIRED: PIN is required to encrypt TOTP secret');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveTotpKey(pin, salt);
  const plaintext = new TextEncoder().encode(totpSecret);
  const encrypted = await aesGcmEncrypt(key, nonce, new Uint8Array(plaintext));
  if (encrypted.length < 16) throw new Error('E_CORRUPT: AES-GCM output shorter than its authentication tag');
  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  const out = new Uint8Array(4 + 1 + 16 + 12 + 16 + ciphertext.length);
  out.set(new Uint8Array([0x54, 0x4F, 0x54, 0x50]), 0);
  out[4] = 0x01;
  out.set(salt, 5);
  out.set(nonce, 21);
  out.set(tag, 33);
  out.set(ciphertext, 49);
  return Buffer.from(out).toString('base64');
}

export async function decryptTotpSecret(encryptedB64: string, pin: string): Promise<string> {
  const combined = Buffer.from(encryptedB64, 'base64');
  if (combined.length < 4 || combined[0] !== 0x54 || combined[1] !== 0x4F || combined[2] !== 0x54 || combined[3] !== 0x50) {
    throw new Error('E_BAD_MAGIC: not a TOTP secret envelope');
  }
  if (combined[4] !== 0x01) throw new Error('E_VERSION_AHEAD: unsupported TOTP secret format');
  if (combined.length < 49) throw new Error('E_BAD_MAGIC: TOTP secret envelope truncated');
  const salt = new Uint8Array(combined.subarray(5, 21));
  const nonce = new Uint8Array(combined.subarray(21, 33));
  const tag = new Uint8Array(combined.subarray(33, 49));
  const ciphertext = new Uint8Array(combined.subarray(49));
  const data = new Uint8Array(ciphertext.length + 16);
  data.set(ciphertext, 0);
  data.set(tag, ciphertext.length);
  const key = await deriveTotpKey(pin, new Uint8Array(salt));
  const decrypted = await aesGcmDecrypt(key, nonce, data);
  return new TextDecoder().decode(decrypted);
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function generateTotpUri(secret: string, email: string): string {
  return authenticator.keyuri(email, 'Buddysaradhi', secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  return authenticator.check(code, secret);
}

export function generateTotpCode(secret: string): string {
  return authenticator.generate(secret);
}

export interface PasskeyCredential {
  id: string;
  publicKey: string;
  counter: number;
}

export interface PasskeyRegistrationOptions {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: -7 | -257 }>;
  authenticatorSelection: {
    authenticatorAttachment: 'platform' | 'cross-platform';
    requireResidentKey: boolean;
    userVerification: 'required' | 'preferred' | 'discouraged';
  };
  timeout: number;
  attestation: 'none' | 'direct' | 'indirect';
}

export interface PasskeyAuthenticationOptions {
  challenge: string;
  timeout: number;
  rpId: string;
  allowCredentials: Array<{ type: 'public-key'; id: string }>;
  userVerification: 'required' | 'preferred' | 'discouraged';
}

export function generateWebAuthnChallenge(): string {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(challenge).toString('base64url');
}

export function generateRandomBase64Url(bytes: number = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString('base64url');
}

export function base64UrlToBase64(b64url: string): string {
  return b64url.replace(/-/g, '+').replace(/_/g, '/');
}

export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}