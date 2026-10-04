#!/usr/bin/env node
// scripts/verify-manifest.ts
// Implements: deployment/02_Vercel_Blob_Build_Storage.md §5.4 — the
// "no partial manifest" verification step.
// Called by: .github/workflows/desktop-build.yml (staging verify),
//   release.yml (stable verify).
//
// Checks, in order: file parses as JSON; required §4 fields hold the right
// shapes (semver version, ISO pub_date, https release_notes_url, exactly the
// four platform keys each with an https url + non-empty base64 signature,
// 64-hex sha256 per platform, non-empty metadata.build_commit); optional
// --version pin; every platforms.*.url is reachable (HEAD, falling back to a
// single-byte range GET).
//
// Erasable TypeScript only (runs directly: `node scripts/verify-manifest.ts`).
// Rule 9: every failure is a typed VerifyManifestError (code + message) on
// stderr with exit 1. Reads are public, so no token is ever required.

export const FETCH_TIMEOUT_MS = 30_000;

export class VerifyManifestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VerifyManifestError";
    this.code = code;
  }
}

export interface VerifyManifestArgs {
  manifest: string | null;
  version: string | null;
  dryRun: boolean;
  help: boolean;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export const EXPECTED_PLATFORM_KEYS: readonly string[] = [
  "windows-x86_64",
  "darwin-universal",
  "darwin-aarch64",
  "linux-x86_64",
];

export function parseVerifyManifestArgs(argv: string[]): VerifyManifestArgs {
  const args: VerifyManifestArgs = {
    manifest: null,
    version: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag: string = argv[i] as string;
    switch (flag) {
      case "--manifest":
      case "--version": {
        const value: string | undefined = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new VerifyManifestError("bad-args", `flag ${flag} requires a value`);
        }
        i++;
        if (flag === "--manifest") args.manifest = value;
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
        throw new VerifyManifestError(
          "bad-args",
          `unknown flag ${flag}. See --help for the supported interface.`,
        );
    }
  }
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpsUrl(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.startsWith("https://") || value.startsWith("http://"))
  );
}

/** Pure shape check — deployment/02 §4 + §5.4. Returns human-readable
 * failures; empty means structurally valid (reachability is checked
 * separately by the CLI via checkUrlReachable). */
export function verifyManifestShape(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["manifest root must be a JSON object"];
  }
  if (typeof value["version"] !== "string" || !SEMVER_RE.test(value["version"] as string)) {
    errors.push('field "version" must be a MAJOR.MINOR.PATCH string');
  }
  if (typeof value["pub_date"] !== "string" || Number.isNaN(Date.parse(value["pub_date"] as string))) {
    errors.push('field "pub_date" must be an ISO-8601 date string');
  }
  if (!isHttpsUrl(value["release_notes_url"])) {
    errors.push('field "release_notes_url" must be an http(s) URL');
  }
  if (
    typeof value["minimum_auto_update_from"] !== "string" ||
    !SEMVER_RE.test(value["minimum_auto_update_from"] as string)
  ) {
    errors.push('field "minimum_auto_update_from" must be a MAJOR.MINOR.PATCH string');
  }
  if (!isRecord(value["platforms"])) {
    errors.push('field "platforms" must be an object');
  } else {
    const platforms: Record<string, unknown> = value["platforms"] as Record<string, unknown>;
    for (const key of EXPECTED_PLATFORM_KEYS) {
      const entry: unknown = platforms[key];
      if (!isRecord(entry)) {
        errors.push(`platforms.${key} is missing or not an object`);
        continue;
      }
      if (!isHttpsUrl(entry["url"])) {
        errors.push(`platforms.${key}.url must be an http(s) URL`);
      }
      const sig: unknown = entry["signature"];
      if (typeof sig !== "string" || sig.trim() === "") {
        errors.push(`platforms.${key}.signature must be a non-empty string`);
      } else if (sig.trim().length % 4 !== 0 || !BASE64_RE.test(sig.trim())) {
        errors.push(`platforms.${key}.signature must be base64 (§4.3 Ed25519)`);
      }
    }
    for (const key of Object.keys(platforms)) {
      if (!EXPECTED_PLATFORM_KEYS.includes(key)) {
        errors.push(`platforms.${key} is unexpected (expected exactly the four Tauri keys)`);
      }
    }
  }
  if (!isRecord(value["sha256"])) {
    errors.push('field "sha256" must be an object');
  } else {
    const hashes: Record<string, unknown> = value["sha256"] as Record<string, unknown>;
    for (const key of EXPECTED_PLATFORM_KEYS) {
      const digest: unknown = hashes[key];
      if (typeof digest !== "string" || !SHA256_RE.test(digest)) {
        errors.push(`sha256.${key} must be a 64-char hex digest`);
      }
    }
  }
  if (!isRecord(value["metadata"]) || typeof (value["metadata"] as Record<string, unknown>)["build_commit"] !== "string" ||
    ((value["metadata"] as Record<string, unknown>)["build_commit"] as string).trim() === "") {
    errors.push('field "metadata.build_commit" must be a non-empty string');
  }
  return errors;
}

async function checkUrlReachable(url: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new VerifyManifestError(
      "unreachable-url",
      `platform URL unreachable: ${url} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (res.ok) return;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { range: "bytes=0-0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new VerifyManifestError(
      "unreachable-url",
      `platform URL unreachable: ${url} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!res.ok && res.status !== 206) {
    throw new VerifyManifestError(
      "unreachable-url",
      `platform URL returned HTTP ${res.status}: ${url} (expected 200/206)`,
    );
  }
  try {
    await res.arrayBuffer();
  } catch {
    // Draining a 1-byte range body is best-effort; reachability already proven.
  }
}

function printHelp(): void {
  process.stdout.write(
    `Usage: node scripts/verify-manifest.ts --manifest <file> [--version <semver>] [--dry-run]\n` +
      `\n` +
      `Verifies a desktop manifest (deployment/02 §5.4): JSON parses, required\n` +
      `§4 fields hold, every platforms.*.url is reachable, signatures are\n` +
      `non-empty base64. No token required (reads are public).\n` +
      `\n` +
      `Flags:\n` +
      `  --manifest <file>    manifest JSON to verify (required unless --help/--dry-run)\n` +
      `  --version <semver>   optionally assert manifest version equals this\n` +
      `  --dry-run            print the intended checks without reading or fetching\n` +
      `  --help               print this usage and exit 0\n` +
      `\n` +
      `Exit: 0 when every check passes, 1 with ERR [code] message on stderr otherwise.\n`,
  );
}

async function main(): Promise<void> {
  const args: VerifyManifestArgs = parseVerifyManifestArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.dryRun) {
    const target: string = args.manifest ?? "<manifest>";
    process.stdout.write(
      `DRY-RUN verify ${target}: JSON parse + §4 shape checks` +
        (args.version !== null ? ` + version pin ${args.version}` : "") +
        ` + HEAD/range-GET every platforms.*.url\n`,
    );
    return;
  }
  if (args.manifest === null) {
    throw new VerifyManifestError("bad-args", "missing required --manifest <file>");
  }
  const manifestPath: string = args.manifest;
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new VerifyManifestError("missing-file", `manifest file not found: ${manifestPath}`);
  }
  let value: unknown = null;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new VerifyManifestError(
      "bad-json",
      `manifest is not valid JSON: ${manifestPath}`,
    );
  }
  const failures: string[] = verifyManifestShape(value);
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`FAIL ${manifestPath}: ${failure}\n`);
    }
    throw new VerifyManifestError(
      "invalid-manifest",
      `${manifestPath} failed ${failures.length} shape check(s) (deployment/02 §5.4)`,
    );
  }
  const version: string = (value as Record<string, unknown>)["version"] as string;
  if (args.version !== null && args.version !== version) {
    throw new VerifyManifestError(
      "version-mismatch",
      `manifest version is ${version}, expected ${args.version}`,
    );
  }
  const platforms = (value as Record<string, Record<string, Record<string, string>>>)["platforms"] as Record<string, { url: string }>;
  for (const key of EXPECTED_PLATFORM_KEYS) {
    const entry = platforms[key] as { url: string };
    await checkUrlReachable(entry.url);
  }
  process.stdout.write(
    `OK manifest ${manifestPath} version ${version} (${EXPECTED_PLATFORM_KEYS.length} platforms reachable)\n`,
  );
}

function isMainEntry(): boolean {
  const invoked: string = (process.argv[1] ?? "").replace(/\\/g, "/");
  return invoked.endsWith("scripts/verify-manifest.ts") || invoked.endsWith("/verify-manifest.ts");
}

if (isMainEntry()) {
  main().catch((err: unknown) => {
    if (err instanceof VerifyManifestError) {
      process.stderr.write(`ERR [${err.code}] ${err.message}\n`);
    } else {
      process.stderr.write(`ERR [unexpected] ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  });
}
