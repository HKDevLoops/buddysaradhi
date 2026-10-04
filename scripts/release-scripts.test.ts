// scripts/release-scripts.test.ts
// Implements: deployment/05_CI_CD_GitHub_Actions.md §15 item 5 (KNOWN-BREAK:
//   missing release scripts) — regression guard for the ported scripts.
//
// Covers the manifest build/verify/promote pure logic, arg parsing, --help
// and --dry-run exit-0-without-token behaviour, and missing-token
// fail-closed for the Blob-touching scripts. Network-touching paths are
// exercised only via --dry-run/--help (no secrets, no live Blob calls).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BlobUploadError,
  buildPutHeaders,
  isIosBlockedPathname,
  parseBlobUploadArgs,
} from "./blob-upload.ts";
import {
  BuildManifestError,
  buildManifest,
  installerBlobPathname,
  normalizeBlobPathname,
  parseBuildManifestArgs,
} from "./build-manifest.ts";
import {
  EXPECTED_PLATFORM_KEYS,
  VerifyManifestError,
  parseVerifyManifestArgs,
  verifyManifestShape,
} from "./verify-manifest.ts";
import {
  PromoteManifestError,
  parsePromoteManifestArgs,
  promoteManifest,
} from "./promote-manifest.ts";

const REPO_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run a script with BLOB_READ_WRITE_TOKEN scrubbed unless explicitly given. */
function runScript(
  script: string,
  args: string[],
  extraEnv?: Record<string, string>,
): CliResult {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env["BLOB_READ_WRITE_TOKEN"];
  if (extraEnv !== undefined) {
    for (const [key, value] of Object.entries(extraEnv)) env[key] = value;
  }
  try {
    const stdout = execFileSync(process.execPath, [`scripts/${script}`, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
      timeout: 60_000,
    }) as string;
    return { status: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      status: typeof e.status === "number" ? e.status : 99,
      stdout: typeof e.stdout === "string" ? e.stdout : String(e.stdout ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : String(e.stderr ?? ""),
    };
  }
}

function validManifest(): Record<string, unknown> {
  const entry = (platform: string): Record<string, string> => ({
    signature: "dGhpcyBpcyBhIGJhc2U2NCBlZDI1NTE5IHNpZ25hdHVyZQ==",
    url: `https://buddysaradhi-releases.vercel-storage.com/desktop/${platform}/file.bin`,
  });
  return {
    version: "1.4.0",
    pub_date: "2025-08-15T10:30:00Z",
    release_notes_url: "https://buddysaradhi.app/api/changelog/1.4.0",
    minimum_auto_update_from: "1.0.0",
    platforms: {
      "windows-x86_64": entry("windows"),
      "darwin-universal": entry("macos"),
      "darwin-aarch64": entry("macos"),
      "linux-x86_64": entry("linux"),
    },
    sha256: {
      "windows-x86_64": "a".repeat(64),
      "darwin-universal": "c".repeat(64),
      "darwin-aarch64": "c".repeat(64),
      "linux-x86_64": "f".repeat(64),
    },
    metadata: {
      build_commit: "abc1234",
      build_runner: "github-actions",
      build_branch: "main",
    },
  };
}

describe("build-manifest pure logic (deployment/02 §4)", () => {
  it("maps installer pathnames per platform without a v prefix", () => {
    expect(installerBlobPathname("windows", "1.4.0")).toBe(
      "desktop/windows/Buddysaradhi-1.4.0-x64.msi",
    );
    expect(installerBlobPathname("macos", "1.4.0")).toBe(
      "desktop/macos/Buddysaradhi-1.4.0-universal.dmg",
    );
    expect(installerBlobPathname("linux", "1.4.0")).toBe(
      "desktop/linux/Buddysaradhi-1.4.0-x86_64.AppImage",
    );
  });

  it("builds the §4.1 shape with darwin twins sharing the macos artifact", () => {
    const artifact = (tag: string): { url: string; sha256: string; signature: string } => ({
      url: `https://cdn.example/${tag}.bin`,
      sha256: `${tag}-digest`,
      signature: "c2ln",
    });
    const manifest = buildManifest({
      version: "1.4.0",
      commit: "abc1234",
      windows: artifact("win"),
      macos: artifact("mac"),
      linux: artifact("lin"),
    });
    expect(manifest.version).toBe("1.4.0");
    expect(manifest.release_notes_url).toBe("https://buddysaradhi.app/api/changelog/1.4.0");
    expect(manifest.minimum_auto_update_from).toBe("1.0.0");
    expect(manifest.platforms["darwin-universal"]).toEqual(manifest.platforms["darwin-aarch64"]);
    expect(manifest.platforms["darwin-universal"]?.url).toBe("https://cdn.example/mac.bin");
    expect(manifest.sha256["darwin-universal"]).toBe(manifest.sha256["darwin-aarch64"]);
    expect(manifest.metadata).toEqual({
      build_commit: "abc1234",
      build_runner: "github-actions",
      build_branch: "main",
    });
    expect(Number.isNaN(Date.parse(manifest.pub_date))).toBe(false);
  });

  it("honours explicit pubDate and minimum_auto_update_from overrides", () => {
    const artifact = { url: "https://cdn.example/x", sha256: "s", signature: "c2ln" };
    const manifest = buildManifest({
      version: "2.0.0",
      commit: "deadbee",
      pubDate: "2026-01-02T03:04:05Z",
      minimumAutoUpdateFrom: "2.0.0",
      windows: artifact,
      macos: artifact,
      linux: artifact,
    });
    expect(manifest.pub_date).toBe("2026-01-02T03:04:05Z");
    expect(manifest.minimum_auto_update_from).toBe("2.0.0");
  });

  it("rejects a non-semver version", () => {
    const artifact = { url: "https://cdn.example/x", sha256: "s", signature: "c2ln" };
    let code = "";
    try {
      buildManifest({ version: "v1.4", commit: "abc", windows: artifact, macos: artifact, linux: artifact });
    } catch (err) {
      code = (err as BuildManifestError).code;
    }
    expect(code).toBe("bad-version");
  });

  it("normalizes local output paths to Blob pathnames", () => {
    expect(normalizeBlobPathname("manifests/desktop-staging.json")).toBe(
      "manifests/desktop-staging.json",
    );
    expect(normalizeBlobPathname("./manifests/desktop-staging.json")).toBe(
      "manifests/desktop-staging.json",
    );
  });
});

describe("verify-manifest shape (deployment/02 §5.4)", () => {
  it("accepts the §4.1-shaped manifest", () => {
    expect(verifyManifestShape(validManifest())).toEqual([]);
  });

  it("flags each corruption class", () => {
    const platformsOf = (m: Record<string, unknown>): Record<string, Record<string, string>> =>
      m["platforms"] as Record<string, Record<string, string>>;
    const hashesOf = (m: Record<string, unknown>): Record<string, string> =>
      m["sha256"] as Record<string, string>;
    const cases: Array<{ mutate: (m: Record<string, unknown>) => void; label: string }> = [
      { mutate: (m) => { m["version"] = "v1.4"; }, label: "bad version" },
      { mutate: (m) => { m["pub_date"] = "not-a-date"; }, label: "bad pub_date" },
      { mutate: (m) => { m["release_notes_url"] = "notaurl"; }, label: "bad notes url" },
      {
        mutate: (m) => {
          const platforms = platformsOf(m) as Record<string, unknown>;
          delete platforms["linux-x86_64"];
        },
        label: "missing platform",
      },
      {
        mutate: (m) => { platformsOf(m)["windows-x86_64"]!["signature"] = ""; },
        label: "empty signature",
      },
      {
        mutate: (m) => { platformsOf(m)["windows-x86_64"]!["signature"] = "!!!not-base64!!!"; },
        label: "non-base64 signature",
      },
      {
        mutate: (m) => { hashesOf(m)["linux-x86_64"] = "xyz"; },
        label: "bad sha256",
      },
      { mutate: (m) => { m["platforms"] = "oops"; }, label: "platforms not object" },
    ];
    for (const c of cases) {
      const m = validManifest();
      c.mutate(m);
      expect(verifyManifestShape(m).length, c.label).toBeGreaterThan(0);
    }
  });

  it("rejects a non-object root", () => {
    expect(verifyManifestShape(null).length).toBeGreaterThan(0);
    expect(verifyManifestShape("[]").length).toBeGreaterThan(0);
  });

  it("expects exactly the four Tauri platform keys", () => {
    expect(EXPECTED_PLATFORM_KEYS).toEqual([
      "windows-x86_64",
      "darwin-universal",
      "darwin-aarch64",
      "linux-x86_64",
    ]);
  });
});

describe("promote-manifest pure logic (deployment/02 §6.1)", () => {
  it("bumps pub_date while keeping every other field", () => {
    const staging = {
      version: "1.4.0",
      pub_date: "2025-08-15T10:30:00Z",
      release_notes_url: "https://buddysaradhi.app/api/changelog/1.4.0",
      extra: "kept",
    };
    const stable = promoteManifest(staging, "1.4.0", "2026-10-04T00:00:00Z");
    expect(stable.pub_date).toBe("2026-10-04T00:00:00Z");
    expect(stable.version).toBe("1.4.0");
    expect(stable["extra"]).toBe("kept");
  });

  it("fail-closes on staging/stable version divergence", () => {
    let code = "";
    try {
      promoteManifest({ version: "1.3.2", pub_date: "x" }, "1.4.0");
    } catch (err) {
      code = (err as PromoteManifestError).code;
    }
    expect(code).toBe("version-mismatch");
  });
});

describe("arg parsing keeps the exact called interface", () => {
  it("parses the eas-build blob-upload argv", () => {
    const args = parseBlobUploadArgs([
      "--local-path",
      "Buddysaradhi.apk",
      "--blob-pathname",
      "mobile/android/Buddysaradhi-1.4.0-universal.apk",
      "--content-type",
      "application/vnd.android.package-archive",
    ]);
    expect(args.localPath).toBe("Buddysaradhi.apk");
    expect(args.outputJson).toBe(false);
    expect(args.dryRun).toBe(false);
  });

  it("parses the desktop-build installer argv with --output-json", () => {
    const args = parseBlobUploadArgs([
      "--local-path",
      "x.msi",
      "--blob-pathname",
      "desktop/windows/Buddysaradhi-1.4.0-x64.msi",
      "--content-type",
      "application/octet-stream",
      "--output-json",
    ]);
    expect(args.outputJson).toBe(true);
  });

  it("parses the desktop-build build-manifest argv", () => {
    const args = parseBuildManifestArgs([
      "--version",
      "1.4.0",
      "--commit",
      "abc123",
      "--output",
      "manifests/desktop-staging.json",
    ]);
    expect(args).toMatchObject({
      version: "1.4.0",
      commit: "abc123",
      output: "manifests/desktop-staging.json",
    });
  });

  it("parses the release promote-manifest argv", () => {
    const args = parsePromoteManifestArgs([
      "--from",
      "manifests/desktop-staging.json",
      "--to",
      "manifests/desktop-stable.json",
      "--version",
      "1.4.0",
    ]);
    expect(args).toMatchObject({
      from: "manifests/desktop-staging.json",
      to: "manifests/desktop-stable.json",
      version: "1.4.0",
    });
  });

  it("parses the verify-manifest argv", () => {
    const args = parseVerifyManifestArgs(["--manifest", "manifests/desktop-stable.json"]);
    expect(args.manifest).toBe("manifests/desktop-stable.json");
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseBlobUploadArgs(["--bogus"])).toThrowError(BlobUploadError);
    expect(() => parseBlobUploadArgs(["--local-path"])).toThrowError(BlobUploadError);
    expect(() => parseBuildManifestArgs(["--bogus"])).toThrowError(BuildManifestError);
    expect(() => parseVerifyManifestArgs(["--bogus"])).toThrowError(VerifyManifestError);
    expect(() => parsePromoteManifestArgs(["--bogus"])).toThrowError(PromoteManifestError);
  });

  it("pins the Blob PUT header contract", () => {
    expect(buildPutHeaders("tok", "application/octet-stream", false)).toEqual({
      authorization: "Bearer tok",
      "x-api-version": "12",
      "x-vercel-blob-access": "public",
      "x-add-random-suffix": "0",
      "x-content-type": "application/octet-stream",
    });
    expect(
      buildPutHeaders("tok", "application/json", true)["x-allow-overwrite"],
    ).toBe("1");
  });

  it("blocks iOS pathnames without a token", () => {
    expect(isIosBlockedPathname("mobile/ios/app.ipa")).toBe(true);
    expect(isIosBlockedPathname("build.ipa")).toBe(true);
    expect(isIosBlockedPathname("mobile/android/app.apk")).toBe(false);
  });
});

describe("CLI without secrets: --help/--dry-run exit 0, Blob ops fail closed", () => {
  it("verify-manifest --help exits 0 without a token", () => {
    const r = runScript("verify-manifest.ts", ["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  it("verify-manifest --dry-run exits 0 without a token or file", () => {
    const r = runScript("verify-manifest.ts", ["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("DRY-RUN");
  });

  it("blob-upload --dry-run prints intent and exits 0", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "blob-dry-"));
    try {
      const local = path.join(dir, "CHANGELOG_ENTRY.md");
      writeFileSync(local, "# 1.4.0\n", "utf8");
      const r = runScript("blob-upload.ts", [
        "--local-path",
        local,
        "--blob-pathname",
        "changelogs/1.4.0.md",
        "--content-type",
        "text/markdown",
        "--dry-run",
      ]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("DRY-RUN upload");
      expect(r.stdout).toContain("changelogs/1.4.0.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("build-manifest --help and promote-manifest --help exit 0 without a token", () => {
    expect(runScript("build-manifest.ts", ["--help"]).status).toBe(0);
    expect(runScript("promote-manifest.ts", ["--help"]).status).toBe(0);
  });

  it("blob-upload without a token fails closed naming the token", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "blob-tok-"));
    try {
      const local = path.join(dir, "a.apk");
      writeFileSync(local, "bytes", "utf8");
      const r = runScript("blob-upload.ts", [
        "--local-path",
        local,
        "--blob-pathname",
        "mobile/android/a.apk",
        "--content-type",
        "application/vnd.android.package-archive",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("BLOB_READ_WRITE_TOKEN");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blob-upload refuses an iOS pathname before touching the network", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "blob-ios-"));
    try {
      const local = path.join(dir, "a.ipa");
      writeFileSync(local, "bytes", "utf8");
      const r = runScript("blob-upload.ts", [
        "--local-path",
        local,
        "--blob-pathname",
        "mobile/ios/app.ipa",
        "--content-type",
        "application/octet-stream",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("ios-blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("build-manifest without a token fails closed and writes nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "manifest-tok-"));
    try {
      const out = path.join(dir, "desktop-staging.json");
      const r = runScript("build-manifest.ts", [
        "--version",
        "1.4.0",
        "--commit",
        "abc123",
        "--output",
        out,
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("BLOB_READ_WRITE_TOKEN");
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("promote-manifest without a token fails closed", () => {
    const r = runScript("promote-manifest.ts", [
      "--from",
      "manifests/desktop-staging.json",
      "--to",
      "manifests/desktop-stable.json",
      "--version",
      "1.4.0",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("verify-manifest on a missing file fails closed without a token", () => {
    const r = runScript("verify-manifest.ts", ["--manifest", "does-not-exist.json"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("missing-file");
  });

  it("verify-manifest flags a corrupt manifest without any network", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "manifest-bad-"));
    try {
      const file = path.join(dir, "bad.json");
      writeFileSync(file, JSON.stringify({ version: "nope" }), "utf8");
      const r = runScript("verify-manifest.ts", ["--manifest", file]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("invalid-manifest");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
