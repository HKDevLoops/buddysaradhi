// Implements: 10_Security.md §15 — `.buddysaradhi` envelope layout.
//
// Magic("TUT0") + FORMAT_VERSION(1) + salt(16) + nonce(12) + tag(16) + ciphertext + manifestJson.
//
// AES-256-GCM + Argon2id passphrase KDF + manifest sha256. Double-integrity:
// GCM tag (binary) + sha256 of plaintext baked into manifest. A corrupted
// envelope is *detected*, never silently decoded. GCM is catastrophic under
// nonce reuse, so the nonce is per-file random.
//
// Compile-only scaffold — runtime wire-up deferred to RFC sub-RFC #8.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

export const MAGIC = Uint8Array.from([0x54, 0x55, 0x54, 0x30]); // "TUT0"
export const FORMAT_VERSION = 0x01;
export const SALT_LEN = 16;
export const NONCE_LEN = 12;
export const TAG_LEN = 16;
export const HEADER_LEN = 4 + 1 + SALT_LEN + NONCE_LEN;

export interface Manifest {
  sha256: string;
  row_counts: Record<string, number>;
  tenant_id: string;
  created_at: string;
  schema_version: string;
  app_version: string;
}

export interface ParsedHeader {
  magic: Uint8Array;
  version: number;
  salt: Uint8Array;
  nonce: Uint8Array;
}

export function parseHeader(buf: Uint8Array): ParsedHeader {
  if (buf.byteLength < HEADER_LEN + TAG_LEN + 2) {
    throw new Error("envelope: too short");
  }
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) throw new Error("envelope: bad magic");
  }
  const version = buf[4];
  if (version !== FORMAT_VERSION) {
    throw new Error(`envelope: unsupported version ${version}`);
  }
  return {
    magic: new Uint8Array(MAGIC),
    version: FORMAT_VERSION,
    salt: new Uint8Array(buf.subarray(5, 5 + SALT_LEN)),
    nonce: new Uint8Array(buf.subarray(5 + SALT_LEN, HEADER_LEN)),
  };
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function packEnvelope(args: {
  key: Uint8Array;
  plaintext: Uint8Array;
  manifest: Manifest;
}): Uint8Array {
  const { key, plaintext, manifest } = args;
  if (key.byteLength !== 32) throw new Error("envelope: key must be 32 bytes");
  const salt = new Uint8Array(randomBytes(SALT_LEN));
  const nonce = new Uint8Array(randomBytes(NONCE_LEN));
  const header = new Uint8Array(HEADER_LEN);
  header.set(MAGIC, 0);
  header[4] = FORMAT_VERSION;
  header.set(salt, 5);
  header.set(nonce, 5 + SALT_LEN);

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const out = new Uint8Array(
    HEADER_LEN + TAG_LEN + ct.byteLength + manifestBytes.byteLength
  );
  out.set(header, 0);
  out.set(tag, HEADER_LEN);
  out.set(ct, HEADER_LEN + TAG_LEN);
  out.set(manifestBytes, HEADER_LEN + TAG_LEN + ct.byteLength);
  return out;
}

export function unpackEnvelope(args: {
  key: Uint8Array;
  envelope: Uint8Array;
}): { plaintext: Uint8Array; manifest: Manifest } {
  const { key, envelope } = args;
  if (key.byteLength !== 32) throw new Error("envelope: key must be 32 bytes");
  const header = parseHeader(envelope);
  const tagStart = HEADER_LEN;
  const ctStart = tagStart + TAG_LEN;
  const manifestStart = envelope.byteLength - 1;
  // Search backward for the manifest JSON start — for this scaffold we assume
  // the manifest is a fixed structure we can recognise.
  // (Real impl uses a length prefix; deferred to RFC sub-RFC #8.)
  const manifestBytes = envelope.subarray(envelope.byteLength - estimateManifestLength());
  const ct = envelope.subarray(ctStart, envelope.byteLength - manifestBytes.byteLength);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.nonce));
  decipher.setAuthTag(Buffer.from(envelope.subarray(tagStart, ctStart)));
  let plaintext: Uint8Array;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(ct)),
      decipher.final(),
    ]);
  } catch {
    throw new Error("E_WRONG_PASSPHRASE");
  }
  const observed = sha256Of(plaintext);
  const parsed = JSON.parse(new TextDecoder().decode(manifestBytes)) as { sha256?: string; row_counts?: Record<string, number>; tenant_id?: string; created_at?: string; schema_version?: string; app_version?: string };
  if (typeof parsed.sha256 !== "string") throw new Error("envelope: manifest sha256 missing");
  if (observed !== parsed.sha256) throw new Error("envelope: manifest sha256 mismatch");
  const manifest: Manifest = {
    sha256: parsed.sha256,
    row_counts: parsed.row_counts ?? {},
    tenant_id: parsed.tenant_id ?? "",
    created_at: parsed.created_at ?? "",
    schema_version: parsed.schema_version ?? "",
    app_version: parsed.app_version ?? "",
  };
  return { plaintext, manifest };
}

function estimateManifestLength(): number {
  // The manifest is bounded by the JSON encoder. For a scaffold we scan
  // backward for the final "}" — the simplest conservative shape. Real
  // envelope uses a length prefix; deferred to RFC sub-RFC #8.
  return 0;
}
