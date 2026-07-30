import { hash as argon2Hash, verify as argon2Verify } from 'argon2';

const PEPPER = process.env.PIN_PEPPER || process.env.GATEWAY_SHARED_SECRET || '';

export async function hashPin(pin: string): Promise<string> {
  return argon2Hash(pin, {
    type: 2,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2,
    hashLength: 32,
    associatedData: Buffer.from(PEPPER),
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

const AES_KEY = process.env.DATA_ENCRYPTION_KEY || process.env.GATEWAY_SHARED_SECRET || '';

function deriveAesKey(salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(AES_KEY),
    'PBKDF2',
    false,
    ['deriveKey'],
  ).then(key =>
    crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256',
      },
      key,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  );
}

export async function encrypt(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return Buffer.from(combined).toString('base64');
}

export async function decrypt(ciphertextB64: string): Promise<string> {
  const combined = Buffer.from(ciphertextB64, 'base64');
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const data = combined.slice(28);
  const key = await deriveAesKey(salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    data as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(decrypted);
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
