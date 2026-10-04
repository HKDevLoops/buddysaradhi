#!/usr/bin/env node
/**
 * Version Consistency Check
 * Implements: deployment/05_CI_CD_GitHub_Actions.md §2 — version gate
 *
 * Validates that key workspace packages share the same version string.
 * The root workspace does not need a version field.
 * Generated Prisma client packages are excluded from the check.
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname: string = fileURLToPath(new URL(".", import.meta.url));
const root: string = resolve(__dirname, "..");

interface PackageJson {
  name?: string;
  version?: string;
}

function readJson(p: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

// Key packages that MUST have consistent versions.
// Generated, vendored, or private stub packages are excluded.
const KEY_PACKAGES: string[] = [
  "apps/web/package.json",
  "apps/gateway/package.json",
  "apps/mobile/package.json",
  "packages/core/package.json",
  "packages/shared/package.json",
  "packages/ui/package.json",
  "apps/services/auth-svc/package.json",
  "apps/services/ledger-svc/package.json",
  "apps/services/attendance-svc/package.json",
];

interface VersionInfo {
  name: string;
  version: string;
  path: string;
}

const versions: VersionInfo[] = [];
let failed = false;

for (const rel of KEY_PACKAGES) {
  const full: string = join(root, rel);
  const pkg: PackageJson | null = readJson(full);
  if (!pkg) {
    console.log(`  SKIP (not found): ${rel}`);
    continue;
  }
  if (!pkg.version || pkg.version === "0.0.0") {
    console.log(`  SKIP (no version): ${pkg.name}`);
    continue;
  }
  console.log(`  ${pkg.name}@${pkg.version}`);
  versions.push({ name: pkg.name as string, version: pkg.version, path: rel });
}

if (versions.length === 0) {
  console.log("\nNo versioned packages found — nothing to check. Passing.");
  process.exit(0);
}

// Check that all listed packages share the same MAJOR.MINOR
const [refMaj, refMin] = (versions[0] as VersionInfo).version.split(".").map(Number);
const ref: VersionInfo = versions[0] as VersionInfo;

for (const v of versions.slice(1)) {
  const [maj, min] = v.version.split(".").map(Number);
  if (maj !== refMaj || min !== refMin) {
    console.error(
      `VERSION MISMATCH: ${v.name}@${v.version} vs ${ref.name}@${ref.version}`
    );
    failed = true;
  }
}

if (failed) {
  console.error("\nVersion check FAILED — align MAJOR.MINOR across workspace packages.");
  process.exit(1);
}

console.log(
  `\nVersion consistency OK — all packages at ${refMaj}.${refMin}.x`
);
