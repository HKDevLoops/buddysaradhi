// Implements: 10_Security.md §3.3, §3.4, §3.5
//
// Module is compile-only here — runtime wire-up is intentionally absent until
// the §8 RFC for sub-RFC #1 lands. Do not import from `apps/**`.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// `Buffer` is preferred at runtime (it's the canonical Node view into binary
// data), but we type everything as `Uint8Array` so this package compiles
// without `@types/node` installed at the workspace level.

export type Pepper = string; // tenant_secret, never exported in plaintext
export type Salt = Uint8Array;
export type HashBase64 = string;

export interface Argon2Params {
  memoryCostKiB: number;
  timeCost: number;
  parallelism: number;
}

export const ARGON2_PIN_PARAMS: Argon2Params = {
  memoryCostKiB: 64 * 1024,
  timeCost: 3,
  parallelism: 2,
};

export interface PinnedHash {
  algorithm: "argon2id";
  salt: Salt;
  hash: HashBase64;
  peppered: true;
  params: Argon2Params;
}

export function newSalt(): Salt {
  return randomBytes(16);
}

export function derivePinHash(
  pin: string,
  salt: Salt,
  pepper: Pepper,
  params: Argon2Params = ARGON2_PIN_PARAMS
): Promise<HashBase64> {
  throw new Error("argon2id runtime not yet wired; defer to RFC §1");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.byteLength !== bb.byteLength) return false;
  return timingSafeEqual(Buffer.from(ba), Buffer.from(bb));
}

export function pseudoPepper(
  prefix: Pepper,
  hashed: HashBase64
): Uint8Array {
  const hm = createHmac("sha256", "<REDACTED-PRF-PURPOSE>");
  hm.update(`${prefix}|${hashed}`);
  return hm.digest();
}
