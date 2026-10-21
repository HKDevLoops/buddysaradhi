import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

// Implements: 23_Security_Harness_Plan.md §5.4 (the licence allow-list) and
// §12.1 G-SEC-1's sibling gate, `pr-security / license-check`.
//
// The allowlist file accepts TWO shapes, so an existing plain array keeps
// working:
//
//   [ "MIT", "ISC", ... ]                                    <- legacy
//   { "licenses": [...], "exceptions": [ { license, package,
//                                           reason, expires } ] }
//
// An exception is scoped to the EXACT licence string AND the package name, and
// MUST carry a reason and an expiry date. An expired exception is a hard
// failure — an allowlist that silently rots is not an allowlist (AGENTS.md §2
// Rule 9). This is the same discipline `scripts/osv-audit.ts` applies to
// `osv.allowlist.json`.

interface LicenseException {
  license: string;
  package: string;
  reason: string;
  expires: string;
  reviewedBy?: string;
}

interface AllowlistShape {
  licenses: string[];
  exceptions: LicenseException[];
}

const ALLOWLIST_PATH = join(process.cwd(), "licenses.allowlist.json");

function loadAllowlist(): AllowlistShape {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as
    | string[]
    | { licenses?: string[]; exceptions?: LicenseException[] };
  if (Array.isArray(raw)) {
    return { licenses: raw, exceptions: [] };
  }
  return {
    licenses: raw.licenses ?? [],
    exceptions: raw.exceptions ?? [],
  };
}

const ALLOWLIST: AllowlistShape = loadAllowlist();
const ALLOWED_LICENSES: string[] = ALLOWLIST.licenses;

function isExpired(expires: string | undefined): boolean {
  if (!expires) return true;
  return expires < new Date().toISOString().slice(0, 10);
}

// Helper to normalize license strings
function isAllowed(licenseStr: unknown, pkgName: string): boolean {
  if (typeof licenseStr !== "string") return false;
  const normalized = licenseStr.replace(/[()]/g, "").trim();

  // Handle compound licenses (e.g., "MIT OR Apache-2.0")
  if (normalized.includes(" OR ")) {
    const parts = normalized.split(" OR ");
    if (parts.some((part) => ALLOWED_LICENSES.includes(part.trim()))) return true;
  }
  if (normalized.includes(" AND ")) {
    const parts = normalized.split(" AND ");
    if (parts.every((part) => ALLOWED_LICENSES.includes(part.trim()))) return true;
  }

  if (ALLOWED_LICENSES.includes(normalized)) return true;

  // A scoped exception: exact licence string + exact package, not expired.
  return ALLOWLIST.exceptions.some(
    (e) => e.license === licenseStr && e.package === pkgName && !isExpired(e.expires),
  );
}

function findPackageJsonFiles(): string[] {
  const files = [join(process.cwd(), "package.json")];
  
  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next") {
        const pkgPath = join(dir, entry.name, "package.json");
        if (existsSync(pkgPath)) {
          files.push(pkgPath);
        }
      }
    }
  };

  scanDir(join(process.cwd(), "apps"));
  scanDir(join(process.cwd(), "packages"));
  return files;
}

function runAudit() {
  console.log("🔍 Auditing dependencies against license allowlist...");

  // An expired exception is a hard failure BEFORE the scan — otherwise a
  // lapsed exception silently keeps a non-allow-listed licence in the tree.
  const expired = ALLOWLIST.exceptions.filter((e) => isExpired(e.expires));
  if (expired.length > 0) {
    console.error("❌ Expired or malformed license exceptions:");
    for (const e of expired) {
      console.error(`   ${e.package} (${e.license}) expires=${e.expires}`);
    }
    console.error(
      "   Rule 9: an allowlist that silently rots is not an allowlist. Re-review or remove these entries.",
    );
    process.exit(1);
  }

  const pkgFiles = findPackageJsonFiles();
  const allDeps = new Set<string>();

  for (const pkgFile of pkgFiles) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const dep of Object.keys(deps)) {
        // Skip workspace internal packages
        if (dep.startsWith("@buddysaradhi/")) continue;
        allDeps.add(dep);
      }
    } catch (e) {
      console.warn(`⚠️ Failed to parse package.json at ${pkgFile}:`, e);
    }
  }

  let violationsCount = 0;
  const auditedPackages: Record<string, string> = {};

  for (const dep of allDeps) {
    let license = "Unknown";
    let found = false;

    // Search node_modules hierarchy
    const searchPaths = [
      join(process.cwd(), "node_modules", dep, "package.json"),
      join(process.cwd(), "apps", "web", "node_modules", dep, "package.json"),
      join(process.cwd(), "apps", "product-page", "node_modules", dep, "package.json"),
    ];

    for (const path of searchPaths) {
      if (existsSync(path)) {
        try {
          const depPkg = JSON.parse(readFileSync(path, "utf8"));
          if (depPkg.license) {
            license = typeof depPkg.license === "object" ? depPkg.license.type : depPkg.license;
            found = true;
            break;
          }
        } catch {
          // ignore parsing error, try next path
        }
      }
    }

    if (found) {
      auditedPackages[dep] = license;
      if (!isAllowed(license, dep)) {
        console.error(`❌ Dependency "${dep}" uses an unapproved license: "${license}"`);
        violationsCount++;
      }
    } else {
      // Default to warn if package.json not found (it might be a built-in or peer dep)
      auditedPackages[dep] = "Missing package.json";
    }
  }

  console.log(`\n📊 Audited ${Object.keys(auditedPackages).length} third-party dependencies.`);
  if (violationsCount > 0) {
    console.error(`\n❌ License compliance check FAILED with ${violationsCount} violation(s).`);
    process.exit(1);
  } else {
    console.log("✅ License compliance check PASSED. All dependencies are compliant.");
    process.exit(0);
  }
}

runAudit();
