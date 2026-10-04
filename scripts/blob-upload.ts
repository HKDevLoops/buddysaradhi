#!/usr/bin/env node
// scripts/blob-upload.ts
// Implements: deployment/02_Vercel_Blob_Build_Storage.md §3 — upload workflow
//   (the uploadInstaller behaviour without the @vercel/blob SDK: raw Vercel
//   Blob REST via fetch, zero new dependencies).
// Called by: .github/workflows/eas-build.yml (APK mirror),
//   desktop-build.yml (installer + .sig uploads), release.yml (changelog).
//
// REST contract (mirrors @vercel/blob SDK request shapes):
//   PUT <api>/?pathname=<enc>   — upload (x-add-random-suffix: 0, public)
//   GET <api>/?url=<pathname>   — existence probe (SDK head() shape)
// Base defaults to https://vercel.com/api/blob, overridable via
// VERCEL_BLOB_API_URL. Auth: BLOB_READ_WRITE_TOKEN from env.
//
// Erasable TypeScript only (runs directly: `node scripts/blob-upload.ts`).
// Rule 9: every failure is a typed BlobUploadError (code + message) on
// stderr with exit 1. No silent fallback. No overwrite of an existing
// pathname (§3.5 no-overwrite rule — fail-closed as already-exists).
// No iOS IPA upload (§2.2 — fail-closed as ios-blocked).

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export const BLOB_API_VERSION = "12";
export const DEFAULT_BLOB_API_URL = "https://vercel.com/api/blob";
export const MAX_PATHNAME_LENGTH = 950;
export const FETCH_TIMEOUT_MS = 60_000;

export class BlobUploadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BlobUploadError";
    this.code = code;
  }
}

export interface BlobUploadArgs {
  localPath: string | null;
  blobPathname: string | null;
  contentType: string | null;
  outputJson: boolean;
  dryRun: boolean;
  help: boolean;
}

export function parseBlobUploadArgs(argv: string[]): BlobUploadArgs {
  const args: BlobUploadArgs = {
    localPath: null,
    blobPathname: null,
    contentType: null,
    outputJson: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag: string = argv[i] as string;
    switch (flag) {
      case "--local-path":
      case "--blob-pathname":
      case "--content-type": {
        const value: string | undefined = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new BlobUploadError("bad-args", `flag ${flag} requires a value`);
        }
        i++;
        if (flag === "--local-path") args.localPath = value;
        else if (flag === "--blob-pathname") args.blobPathname = value;
        else args.contentType = value;
        break;
      }
      case "--output-json":
        args.outputJson = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new BlobUploadError(
          "bad-args",
          `unknown flag ${flag}. See --help for the supported interface.`,
        );
    }
  }
  return args;
}

export function blobApiBase(): string {
  const override: string | undefined = process.env["VERCEL_BLOB_API_URL"];
  if (override !== undefined && override.trim() !== "") {
    return override.trim().replace(/\/+$/, "");
  }
  return DEFAULT_BLOB_API_URL;
}

export function requireBlobToken(): string {
  const token: string | undefined = process.env["BLOB_READ_WRITE_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new BlobUploadError(
      "missing-token",
      "BLOB_READ_WRITE_TOKEN is not set. Blob writes require the read-write token " +
        "(deployment/05_CI_CD_GitHub_Actions.md §10 secrets matrix); refusing to continue.",
    );
  }
  return token;
}

/** deployment/02 §2.2: iOS IPAs are never mirrored to Blob (TestFlight only). */
export function isIosBlockedPathname(pathname: string): boolean {
  const lower: string = pathname.toLowerCase();
  return lower.startsWith("mobile/ios/") || lower.endsWith(".ipa");
}

export function validateBlobPathname(pathname: string): void {
  if (pathname.length === 0) {
    throw new BlobUploadError("bad-pathname", "blob pathname must not be empty");
  }
  if (pathname.startsWith("/")) {
    throw new BlobUploadError(
      "bad-pathname",
      `blob pathname must be relative, got "${pathname}"`,
    );
  }
  if (pathname.includes("//")) {
    throw new BlobUploadError(
      "bad-pathname",
      `blob pathname must not contain "//": "${pathname}"`,
    );
  }
  if (pathname.length > MAX_PATHNAME_LENGTH) {
    throw new BlobUploadError(
      "bad-pathname",
      `blob pathname exceeds ${MAX_PATHNAME_LENGTH} chars (${pathname.length})`,
    );
  }
}

export function buildPutUrl(pathname: string): string {
  return `${blobApiBase()}/?pathname=${encodeURIComponent(pathname)}`;
}

/** Header names mirror @vercel/blob putOptionHeaderMap (access +
 * addRandomSuffix + contentType). allowOverwrite is omitted unless true so
 * installer/changelog uploads keep the §3.5 no-overwrite default. */
export function buildPutHeaders(
  token: string,
  contentType: string,
  allowOverwrite: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "x-api-version": BLOB_API_VERSION,
    "x-vercel-blob-access": "public",
    "x-add-random-suffix": "0",
    "x-content-type": contentType,
  };
  if (allowOverwrite) {
    headers["x-allow-overwrite"] = "1";
  }
  return headers;
}

export interface UploadResultJson {
  url: string;
  pathname: string;
  sha256: string;
  size: number;
  contentType: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** SDK head() shape: GET ?url=<pathname>; 404 means absent. */
async function blobExists(pathname: string, token: string): Promise<boolean> {
  const res: Response = await fetch(
    `${blobApiBase()}/?url=${encodeURIComponent(pathname)}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": BLOB_API_VERSION,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new BlobUploadError(
    "blob-error",
    `existence probe failed for "${pathname}": HTTP ${res.status} ${await readErrorBody(res)}`,
  );
}

async function putBlob(
  pathname: string,
  bytes: Uint8Array,
  contentType: string,
  token: string,
): Promise<string> {
  const res: Response = await fetch(buildPutUrl(pathname), {
    method: "PUT",
    headers: buildPutHeaders(token, contentType, false),
    body: bytes,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new BlobUploadError(
      "upload-failed",
      `upload failed for "${pathname}": HTTP ${res.status} ${await readErrorBody(res)}`,
    );
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!isRecord(data) || typeof data["url"] !== "string" || data["url"] === "") {
    throw new BlobUploadError(
      "bad-response",
      `upload succeeded but the Blob API returned an unparseable body for "${pathname}"`,
    );
  }
  return data["url"] as string;
}

function printHelp(): void {
  process.stdout.write(
    `Usage: node scripts/blob-upload.ts --local-path <file> --blob-pathname <path> --content-type <ct> [--output-json] [--dry-run]\n` +
      `\n` +
      `Uploads a local file to Vercel Blob (public, deterministic pathname).\n` +
      `deployment/02_Vercel_Blob_Build_Storage.md §3.\n` +
      `\n` +
      `Flags:\n` +
      `  --local-path <file>     file to upload (must exist, except with --dry-run)\n` +
      `  --blob-pathname <path>  destination pathname, e.g. desktop/windows/Buddysaradhi-1.4.0-x64.msi\n` +
      `  --content-type <ct>     media type, e.g. application/octet-stream\n` +
      `  --output-json           print only {"url","pathname","sha256","size","contentType"} (for jq)\n` +
      `  --dry-run               print the intended probe + PUT without touching the network\n` +
      `  --help                  print this usage and exit 0\n` +
      `\n` +
      `Env: BLOB_READ_WRITE_TOKEN (required unless --help/--dry-run).\n` +
      `Refuses: existing pathname (§3.5 no-overwrite), *.ipa or mobile/ios/* (§2.2).\n` +
      `Exit: 0 on success, 1 with ERR [code] message on stderr otherwise.\n`,
  );
}

async function main(): Promise<void> {
  const args: BlobUploadArgs = parseBlobUploadArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.localPath === null) {
    throw new BlobUploadError("bad-args", "missing required --local-path <file>");
  }
  if (args.blobPathname === null) {
    throw new BlobUploadError("bad-args", "missing required --blob-pathname <path>");
  }
  if (args.contentType === null) {
    throw new BlobUploadError("bad-args", "missing required --content-type <media-type>");
  }
  if (!args.contentType.includes("/")) {
    throw new BlobUploadError(
      "bad-content-type",
      `content type must be a media type like application/octet-stream, got "${args.contentType}"`,
    );
  }
  const localPath: string = args.localPath;
  const blobPathname: string = args.blobPathname;
  const contentType: string = args.contentType;
  validateBlobPathname(blobPathname);
  if (isIosBlockedPathname(blobPathname)) {
    throw new BlobUploadError(
      "ios-blocked",
      `refusing to upload "${blobPathname}": iOS IPAs are never mirrored to Blob ` +
        `(deployment/02 §2.2 — TestFlight only, enforced by no-ios-blob-upload lint)`,
    );
  }
  if (args.dryRun) {
    let sizeNote = "size unknown (file not statted in dry-run)";
    try {
      sizeNote = `${(await stat(localPath)).size} bytes`;
    } catch {
      // dry-run must not fail on a missing local file: it prints intent only.
    }
    process.stdout.write(
      `DRY-RUN upload ${localPath} -> ${blobPathname} (${contentType}, ${sizeNote})\n` +
        `DRY-RUN probe GET ${blobApiBase()}/?url=<pathname> then PUT ${blobApiBase()}/?pathname=<pathname>\n`,
    );
    return;
  }
  const token: string = requireBlobToken();
  let bytes: Uint8Array;
  try {
    bytes = await readFile(localPath);
  } catch {
    throw new BlobUploadError("missing-file", `local file not found: ${localPath}`);
  }
  const sha256: string = createHash("sha256").update(bytes).digest("hex");
  if (await blobExists(blobPathname, token)) {
    throw new BlobUploadError(
      "already-exists",
      `blob "${blobPathname}" already exists. Blobs are immutable once written ` +
        `(deployment/02 §3.5): bump the version instead of overwriting.`,
    );
  }
  const url: string = await putBlob(blobPathname, bytes, contentType, token);
  if (args.outputJson) {
    const result: UploadResultJson = {
      url,
      pathname: blobPathname,
      sha256,
      size: bytes.length,
      contentType,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(
      `OK uploaded ${blobPathname} (${bytes.length} bytes, sha256=${sha256})\n${url}\n`,
    );
  }
}

function isMainEntry(): boolean {
  const invoked: string = (process.argv[1] ?? "").replace(/\\/g, "/");
  return invoked.endsWith("scripts/blob-upload.ts") || invoked.endsWith("/blob-upload.ts");
}

if (isMainEntry()) {
  main().catch((err: unknown) => {
    if (err instanceof BlobUploadError) {
      process.stderr.write(`ERR [${err.code}] ${err.message}\n`);
    } else {
      process.stderr.write(`ERR [unexpected] ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  });
}
