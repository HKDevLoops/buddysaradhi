#!/usr/bin/env node
// scripts/build-manifest.ts
// Implements: deployment/02_Vercel_Blob_Build_Storage.md §4 (manifest schema)
//   + §5.4 (no-partial-manifest verification).
// Called by: .github/workflows/desktop-build.yml (update-manifest job).
//
// Builds manifests/desktop-staging.json for a version by discovering the
// three signed installers already uploaded to Blob, downloading each
// installer (sha256) + its .sig sibling (Ed25519 signature), then writing
// the manifest locally AND putting it to the mirrored Blob pathname with a
// read-back verification. Local layout mirrors the Blob layout, so
// --output manifests/desktop-staging.json syncs to Blob pathname
// manifests/desktop-staging.json.
//
// Erasable TypeScript only (runs directly: `node scripts/build-manifest.ts`).
// Rule 9: every failure is a typed BuildManifestError (code + message) on
// stderr with exit 1. No silent fallback: a missing installer, a missing or
// malformed .sig, or a failed read-back verification fails the job.
// Note on §5.2: the temp-rename dance exists because a delete+write pair has
// a 404 window. A single PUT with x-allow-overwrite is atomic server-side,
// so this script does PUT-final + read-back verify instead — no 404 window,
// same §5.4 contract.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const BLOB_API_VERSION = "12";
export const DEFAULT_BLOB_API_URL = "https://vercel.com/api/blob";
export const FETCH_TIMEOUT_MS = 30_000;
export const DOWNLOAD_TIMEOUT_MS = 120_000;

export class BuildManifestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BuildManifestError";
    this.code = code;
  }
}

export type ManifestPlatformKey =
  | "windows-x86_64"
  | "darwin-universal"
  | "darwin-aarch64"
  | "linux-x86_64";

export const MANIFEST_PLATFORM_KEYS: readonly ManifestPlatformKey[] = [
  "windows-x86_64",
  "darwin-universal",
  "darwin-aarch64",
  "linux-x86_64",
];

export interface ManifestPlatformEntry {
  signature: string;
  url: string;
}

export interface DesktopManifest {
  version: string;
  pub_date: string;
  release_notes_url: string;
  minimum_auto_update_from: string;
  platforms: Record<ManifestPlatformKey, ManifestPlatformEntry>;
  sha256: Record<ManifestPlatformKey, string>;
  metadata: {
    build_commit: string;
    build_runner: string;
    build_branch: string;
  };
}

export interface PlatformArtifact {
  url: string;
  sha256: string;
  signature: string;
}

export interface BuildManifestInput {
  version: string;
  commit: string;
  branch?: string;
  pubDate?: string;
  minimumAutoUpdateFrom?: string;
  windows: PlatformArtifact;
  macos: PlatformArtifact;
  linux: PlatformArtifact;
}

export interface BuildManifestArgs {
  version: string | null;
  commit: string | null;
  output: string | null;
  dryRun: boolean;
  help: boolean;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function parseBuildManifestArgs(argv: string[]): BuildManifestArgs {
  const args: BuildManifestArgs = {
    version: null,
    commit: null,
    output: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag: string = argv[i] as string;
    switch (flag) {
      case "--version":
      case "--commit":
      case "--output": {
        const value: string | undefined = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new BuildManifestError("bad-args", `flag ${flag} requires a value`);
        }
        i++;
        if (flag === "--version") args.version = value;
        else if (flag === "--commit") args.commit = value;
        else args.output = value;
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
        throw new BuildManifestError(
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
    throw new BuildManifestError(
      "missing-token",
      "BLOB_READ_WRITE_TOKEN is not set. Manifest builds discover installers via the Blob " +
        "list API and sync the manifest back to Blob (deployment/02 §5); refusing to continue.",
    );
  }
  return token;
}

/** deployment/02 §2.1 naming: semver without the `v` prefix, canonical arches. */
export function installerBlobPathname(
  platform: "windows" | "macos" | "linux",
  version: string,
): string {
  switch (platform) {
    case "windows":
      return `desktop/windows/Buddysaradhi-${version}-x64.msi`;
    case "macos":
      return `desktop/macos/Buddysaradhi-${version}-universal.dmg`;
    case "linux":
      return `desktop/linux/Buddysaradhi-${version}-x86_64.AppImage`;
  }
}

/** Local layout mirrors the Blob layout: --output doubles as the Blob pathname. */
export function normalizeBlobPathname(localPath: string): string {
  return localPath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

export function assertBase64Signature(sig: string, what: string): string {
  const s: string = sig.trim();
  if (s.length === 0) {
    throw new BuildManifestError("bad-signature", `empty signature for ${what}`);
  }
  if (s.length % 4 !== 0 || !BASE64_RE.test(s)) {
    throw new BuildManifestError(
      "bad-signature",
      `signature for ${what} is not valid base64 (deployment/02 §4.3 requires base64 Ed25519)`,
    );
  }
  return s;
}

/** Pure manifest constructor — deployment/02 §4.1. Both darwin keys point at
 * the same universal .dmg, exactly as the schema example shows. */
export function buildManifest(input: BuildManifestInput): DesktopManifest {
  if (!SEMVER_RE.test(input.version)) {
    throw new BuildManifestError(
      "bad-version",
      `version must be MAJOR.MINOR.PATCH, got "${input.version}"`,
    );
  }
  if (input.commit.trim() === "") {
    throw new BuildManifestError("bad-args", "commit must be a non-empty SHA");
  }
  const major: string = (input.version.split(".")[0] ?? "1") as string;
  const pubDate: string = input.pubDate ?? new Date().toISOString();
  return {
    version: input.version,
    pub_date: pubDate,
    release_notes_url: `https://buddysaradhi.app/api/changelog/${input.version}`,
    minimum_auto_update_from: input.minimumAutoUpdateFrom ?? `${major}.0.0`,
    platforms: {
      "windows-x86_64": {
        signature: input.windows.signature,
        url: input.windows.url,
      },
      "darwin-universal": {
        signature: input.macos.signature,
        url: input.macos.url,
      },
      "darwin-aarch64": {
        signature: input.macos.signature,
        url: input.macos.url,
      },
      "linux-x86_64": {
        signature: input.linux.signature,
        url: input.linux.url,
      },
    },
    sha256: {
      "windows-x86_64": input.windows.sha256,
      "darwin-universal": input.macos.sha256,
      "darwin-aarch64": input.macos.sha256,
      "linux-x86_64": input.linux.sha256,
    },
    metadata: {
      build_commit: input.commit,
      build_runner: "github-actions",
      build_branch: input.branch ?? "main",
    },
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

export interface BlobListing {
  url: string;
  pathname: string;
  size: number;
}

async function listBlobs(prefix: string, token: string): Promise<BlobListing[]> {
  const out: BlobListing[] = [];
  let cursor: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ prefix, limit: "1000" });
    if (cursor !== undefined) params.set("cursor", cursor);
    const res: Response = await fetch(`${blobApiBase()}/?${params.toString()}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": BLOB_API_VERSION,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new BuildManifestError(
        "blob-error",
        `blob list failed for prefix "${prefix}": HTTP ${res.status} ${await readErrorBody(res)}`,
      );
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!isRecord(data) || !Array.isArray(data["blobs"])) {
      throw new BuildManifestError(
        "bad-response",
        `blob list returned an unparseable body for prefix "${prefix}"`,
      );
    }
    for (const entry of data["blobs"] as unknown[]) {
      if (
        isRecord(entry) &&
        typeof entry["url"] === "string" &&
        typeof entry["pathname"] === "string" &&
        typeof entry["size"] === "number"
      ) {
        out.push({
          url: entry["url"] as string,
          pathname: entry["pathname"] as string,
          size: entry["size"] as number,
        });
      }
    }
    const hasMore: boolean = data["hasMore"] === true;
    cursor = typeof data["cursor"] === "string" ? (data["cursor"] as string) : undefined;
    if (!hasMore || cursor === undefined) break;
  }
  return out;
}

async function downloadBytes(url: string, what: string): Promise<Uint8Array> {
  const res: Response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new BuildManifestError(
      "download-failed",
      `download failed for ${what} (${url}): HTTP ${res.status} ${await readErrorBody(res)}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function downloadText(url: string, what: string): Promise<string> {
  const bytes: Uint8Array = await downloadBytes(url, what);
  return new TextDecoder().decode(bytes);
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
    throw new BuildManifestError(
      "upload-failed",
      `manifest upload failed for "${blobPathname}": HTTP ${res.status} ${await readErrorBody(res)}`,
    );
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!isRecord(data) || typeof data["url"] !== "string" || data["url"] === "") {
    throw new BuildManifestError(
      "bad-response",
      `manifest upload succeeded but the Blob API returned an unparseable body for "${blobPathname}"`,
    );
  }
  return data["url"] as string;
}

function printHelp(): void {
  process.stdout.write(
    `Usage: node scripts/build-manifest.ts --version <semver> --commit <sha> --output <file> [--dry-run]\n` +
      `\n` +
      `Builds the desktop staging manifest (deployment/02 §4) by discovering the\n` +
      `three signed installers for <semver> in Blob, hashing them, reading their\n` +
      `.sig siblings, then writing <file> locally and syncing it to the mirrored\n` +
      `Blob pathname with a read-back verification (§5.4).\n` +
      `\n` +
      `Flags:\n` +
      `  --version <semver>  MAJOR.MINOR.PATCH, e.g. 1.4.0 (no v prefix)\n` +
      `  --commit <sha>      build commit recorded in metadata.build_commit\n` +
      `  --output <file>     local path, e.g. manifests/desktop-staging.json\n` +
      `  --dry-run           print the intended list/download/write/PUT plan only\n` +
      `  --help              print this usage and exit 0\n` +
      `\n` +
      `Env: BLOB_READ_WRITE_TOKEN (required unless --help/--dry-run).\n` +
      `Exit: 0 on success, 1 with ERR [code] message on stderr otherwise.\n`,
  );
}

async function main(): Promise<void> {
  const args: BuildManifestArgs = parseBuildManifestArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version === null) {
    throw new BuildManifestError("bad-args", "missing required --version <semver>");
  }
  if (args.commit === null) {
    throw new BuildManifestError("bad-args", "missing required --commit <sha>");
  }
  if (args.output === null) {
    throw new BuildManifestError("bad-args", "missing required --output <file>");
  }
  if (!SEMVER_RE.test(args.version)) {
    throw new BuildManifestError(
      "bad-version",
      `version must be MAJOR.MINOR.PATCH, got "${args.version}"`,
    );
  }
  const version: string = args.version;
  const commit: string = args.commit;
  const output: string = args.output;
  const expected: Record<"windows" | "macos" | "linux", string> = {
    windows: installerBlobPathname("windows", version),
    macos: installerBlobPathname("macos", version),
    linux: installerBlobPathname("linux", version),
  };
  if (args.dryRun) {
    process.stdout.write(
      `DRY-RUN list Blob prefix "desktop/" for version ${version}\n` +
        `DRY-RUN expect installer ${expected.windows} + .sig\n` +
        `DRY-RUN expect installer ${expected.macos} + .sig\n` +
        `DRY-RUN expect installer ${expected.linux} + .sig\n` +
        `DRY-RUN download installers (sha256) + .sig files (base64 Ed25519)\n` +
        `DRY-RUN write ${output} locally, PUT mirrored Blob pathname, read-back verify\n`,
    );
    return;
  }
  const token: string = requireBlobToken();
  const branch: string | undefined = process.env["GITHUB_REF_NAME"];
  const listing: BlobListing[] = await listBlobs("desktop/", token);
  const byPath = new Map<string, BlobListing>();
  for (const entry of listing) byPath.set(entry.pathname, entry);

  const artifacts: Record<"windows" | "macos" | "linux", PlatformArtifact> = {
    windows: { url: "", sha256: "", signature: "" },
    macos: { url: "", sha256: "", signature: "" },
    linux: { url: "", sha256: "", signature: "" },
  };
  for (const platform of ["windows", "macos", "linux"] as const) {
    const installerPath: string = expected[platform];
    const installer: BlobListing | undefined = byPath.get(installerPath);
    if (installer === undefined) {
      throw new BuildManifestError(
        "missing-artifact",
        `installer not found in Blob: "${installerPath}". The ${platform} build must upload before the manifest step.`,
      );
    }
    const sigPath: string = `${installerPath}.sig`;
    const sig: BlobListing | undefined = byPath.get(sigPath);
    if (sig === undefined) {
      throw new BuildManifestError(
        "missing-signature",
        `signature not found in Blob: "${sigPath}". Sign before the manifest step (deployment/02 §3.3).`,
      );
    }
    const installerBytes: Uint8Array = await downloadBytes(installer.url, installerPath);
    const sha256: string = createHash("sha256").update(installerBytes).digest("hex");
    const signature: string = assertBase64Signature(
      await downloadText(sig.url, sigPath),
      sigPath,
    );
    artifacts[platform] = { url: installer.url, sha256, signature };
  }

  const manifest: DesktopManifest = buildManifest({
    version,
    commit,
    branch: branch ?? "main",
    windows: artifacts.windows,
    macos: artifacts.macos,
    linux: artifacts.linux,
  });
  const body: string = `${JSON.stringify(manifest, null, 2)}\n`;
  const absOutput: string = path.resolve(output);
  await mkdir(path.dirname(absOutput), { recursive: true });
  await writeFile(absOutput, body, "utf8");

  const blobPathname: string = normalizeBlobPathname(output);
  const manifestUrl: string = await putManifestJson(blobPathname, body, token);
  const readBack: string = await downloadText(manifestUrl, blobPathname);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readBack) as unknown;
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed) || parsed["version"] !== version) {
    throw new BuildManifestError(
      "verify-failed",
      `read-back verification failed for "${blobPathname}": manifest at ${manifestUrl} does not parse or version mismatches`,
    );
  }
  process.stdout.write(
    `OK manifest ${version} written to ${output} and synced to ${manifestUrl}\n`,
  );
}

function isMainEntry(): boolean {
  const invoked: string = (process.argv[1] ?? "").replace(/\\/g, "/");
  return invoked.endsWith("scripts/build-manifest.ts") || invoked.endsWith("/build-manifest.ts");
}

if (isMainEntry()) {
  main().catch((err: unknown) => {
    if (err instanceof BuildManifestError) {
      process.stderr.write(`ERR [${err.code}] ${err.message}\n`);
    } else {
      process.stderr.write(`ERR [unexpected] ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  });
}
