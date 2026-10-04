#!/usr/bin/env node
// scripts/promote-manifest.ts
// Implements: deployment/02_Vercel_Blob_Build_Storage.md §6.1 — promotion
//   (staging → stable is a copy with a bumped pub_date, no rebuild).
// Called by: .github/workflows/release.yml (promote desktop staging → stable).
//
// Reads the staging manifest (local --from, falling back to the Blob
// pathname when the file is absent and a token is available), asserts its
// version equals --version (fail-closed on divergence — deployment/02 §12
// contract #8), bumps pub_date to now, writes --to locally AND puts it to
// the mirrored Blob pathname (x-allow-overwrite: 1) with a read-back
// verification. Local layout mirrors the Blob layout.
//
// Erasable TypeScript only (runs directly: `node scripts/promote-manifest.ts`).
// Rule 9: every failure is a typed PromoteManifestError (code + message) on
// stderr with exit 1. Blob sync is mandatory (not best-effort): without
// BLOB_READ_WRITE_TOKEN the promotion cannot reach tutors, so the script
// fails closed as missing-token instead of writing a local-only manifest.
// (Same single-PUT rationale as build-manifest.ts: no §5.2 404 window.)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const BLOB_API_VERSION = "12";
export const DEFAULT_BLOB_API_URL = "https://vercel.com/api/blob";
export const FETCH_TIMEOUT_MS = 30_000;

export class PromoteManifestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PromoteManifestError";
    this.code = code;
  }
}

export interface PromoteManifestArgs {
  from: string | null;
  to: string | null;
  version: string | null;
  dryRun: boolean;
  help: boolean;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function parsePromoteManifestArgs(argv: string[]): PromoteManifestArgs {
  const args: PromoteManifestArgs = {
    from: null,
    to: null,
    version: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag: string = argv[i] as string;
    switch (flag) {
      case "--from":
      case "--to":
      case "--version": {
        const value: string | undefined = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new PromoteManifestError("bad-args", `flag ${flag} requires a value`);
        }
        i++;
        if (flag === "--from") args.from = value;
        else if (flag === "--to") args.to = value;
        else args.version = value;
        break;
      }
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new PromoteManifestError(
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
    throw new PromoteManifestError(
      "missing-token",
      "BLOB_READ_WRITE_TOKEN is not set. Promotion must sync the stable manifest to Blob " +
        "(deployment/02 §6.1); a local-only promote would leave tutors on staging, so refusing to continue.",
    );
  }
  return token;
}

/** Local layout mirrors the Blob layout: --to doubles as the Blob pathname. */
export function normalizeBlobPathname(localPath: string): string {
  return localPath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

export interface StagingManifest {
  version: string;
  pub_date: string;
  [key: string]: unknown;
}

/** Pure promotion — deployment/02 §6.1: copy staging, bump pub_date. */
export function promoteManifest(
  staging: StagingManifest,
  version: string,
  pubDate?: string,
): StagingManifest {
  if (!SEMVER_RE.test(version)) {
    throw new PromoteManifestError(
      "bad-version",
      `version must be MAJOR.MINOR.PATCH, got "${version}"`,
    );
  }
  if (staging.version !== version) {
    throw new PromoteManifestError(
      "version-mismatch",
      `staging manifest is ${staging.version}, asked to promote ${version}. ` +
        `Staging must be built for ${version} first (desktop-build.yml); refusing to promote a diverged channel.`,
    );
  }
  return {
    ...staging,
    pub_date: pubDate ?? new Date().toISOString(),
  };
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

async function downloadText(url: string, what: string): Promise<string> {
  const res: Response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new PromoteManifestError(
      "download-failed",
      `download failed for ${what} (${url}): HTTP ${res.status} ${await readErrorBody(res)}`,
    );
  }
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
}

/** SDK head() shape: resolve a Blob pathname to its public URL, or null. */
async function resolveBlobUrl(blobPathname: string, token: string): Promise<string | null> {
  const res: Response = await fetch(
    `${blobApiBase()}/?url=${encodeURIComponent(blobPathname)}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": BLOB_API_VERSION,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new PromoteManifestError(
      "blob-error",
      `existence probe failed for "${blobPathname}": HTTP ${res.status} ${await readErrorBody(res)}`,
    );
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!isRecord(data) || typeof data["url"] !== "string") {
    throw new PromoteManifestError(
      "bad-response",
      `blob probe returned an unparseable body for "${blobPathname}"`,
    );
  }
  return data["url"] as string;
}

async function readStagingSource(from: string, token: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(from, "utf8");
  } catch {
    // Local checkout may not carry manifests/ (they live in Blob): fall back
    // to the Blob pathname. Absent in both places is fail-closed.
  }
  const blobPathname: string = normalizeBlobPathname(from);
  const url: string | null = await resolveBlobUrl(blobPathname, token);
  if (url === null) {
    throw new PromoteManifestError(
      "missing-file",
      `staging manifest not found locally (${from}) nor in Blob ("${blobPathname}")`,
    );
  }
  return downloadText(url, blobPathname);
}

async function putManifestJson(
  blobPathname: string,
  body: string,
  token: string,
): Promise<string> {
  const res: Response = await fetch(
    `${blobApiBase()}/?pathname=${encodeURIComponent(blobPathname)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": BLOB_API_VERSION,
        "x-vercel-blob-access": "public",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    throw new PromoteManifestError(
      "upload-failed",
      `stable manifest upload failed for "${blobPathname}": HTTP ${res.status} ${await readErrorBody(res)}`,
    );
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!isRecord(data) || typeof data["url"] !== "string" || data["url"] === "") {
    throw new PromoteManifestError(
      "bad-response",
      `stable upload succeeded but the Blob API returned an unparseable body for "${blobPathname}"`,
    );
  }
  return data["url"] as string;
}

function printHelp(): void {
  process.stdout.write(
    `Usage: node scripts/promote-manifest.ts --from <staging> --to <stable> --version <semver> [--dry-run]\n` +
      `\n` +
      `Promotes a staging manifest to stable (deployment/02 §6.1): copy with a\n` +
      `bumped pub_date. Writes --to locally and syncs it to the mirrored Blob\n` +
      `pathname with a read-back verification.\n` +
      `\n` +
      `Flags:\n` +
      `  --from <file>       staging manifest, e.g. manifests/desktop-staging.json\n` +
      `                      (falls back to the Blob pathname when absent locally)\n` +
      `  --to <file>         stable manifest, e.g. manifests/desktop-stable.json\n` +
      `  --version <semver>  must equal the staging manifest version (fail-closed)\n` +
      `  --dry-run           print the intended read/promote/write/PUT plan only\n` +
      `  --help              print this usage and exit 0\n` +
      `\n` +
      `Env: BLOB_READ_WRITE_TOKEN (required unless --help/--dry-run).\n` +
      `Exit: 0 on success, 1 with ERR [code] message on stderr otherwise.\n`,
  );
}

async function main(): Promise<void> {
  const args: PromoteManifestArgs = parsePromoteManifestArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.from === null) {
    throw new PromoteManifestError("bad-args", "missing required --from <staging>");
  }
  if (args.to === null) {
    throw new PromoteManifestError("bad-args", "missing required --to <stable>");
  }
  if (args.version === null) {
    throw new PromoteManifestError("bad-args", "missing required --version <semver>");
  }
  const from: string = args.from;
  const to: string = args.to;
  const version: string = args.version;
  if (args.dryRun) {
    process.stdout.write(
      `DRY-RUN read staging ${from} (local, else Blob pathname), assert version ${version}\n` +
        `DRY-RUN bump pub_date to now, write ${to} locally\n` +
        `DRY-RUN PUT mirrored Blob pathname, read-back verify version ${version}\n`,
    );
    return;
  }
  const token: string = requireBlobToken();
  const raw: string = await readStagingSource(from, token);
  let staging: unknown = null;
  try {
    staging = JSON.parse(raw) as unknown;
  } catch {
    throw new PromoteManifestError("bad-json", `staging manifest is not valid JSON: ${from}`);
  }
  if (!isRecord(staging) || typeof staging["version"] !== "string") {
    throw new PromoteManifestError(
      "bad-json",
      `staging manifest has no version string: ${from}`,
    );
  }
  const stable: StagingManifest = promoteManifest(
    staging as StagingManifest,
    version,
  );
  const body: string = `${JSON.stringify(stable, null, 2)}\n`;
  const absTo: string = path.resolve(to);
  await mkdir(path.dirname(absTo), { recursive: true });
  await writeFile(absTo, body, "utf8");

  const blobPathname: string = normalizeBlobPathname(to);
  const stableUrl: string = await putManifestJson(blobPathname, body, token);
  const readBack: string = await downloadText(stableUrl, blobPathname);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readBack) as unknown;
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed) || parsed["version"] !== version) {
    throw new PromoteManifestError(
      "verify-failed",
      `read-back verification failed for "${blobPathname}": manifest at ${stableUrl} does not parse or version mismatches`,
    );
  }
  process.stdout.write(`OK promoted ${version} ${from} -> ${to} (${stableUrl})\n`);
}

function isMainEntry(): boolean {
  const invoked: string = (process.argv[1] ?? "").replace(/\\/g, "/");
  return invoked.endsWith("scripts/promote-manifest.ts") || invoked.endsWith("/promote-manifest.ts");
}

if (isMainEntry()) {
  main().catch((err: unknown) => {
    if (err instanceof PromoteManifestError) {
      process.stderr.write(`ERR [${err.code}] ${err.message}\n`);
    } else {
      process.stderr.write(`ERR [unexpected] ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  });
}
