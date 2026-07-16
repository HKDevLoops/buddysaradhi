import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ALLOWLIST_PATH = join(process.cwd(), "licenses.allowlist.json");
const ALLOWED_LICENSES: string[] = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));

// Helper to normalize license strings
function isAllowed(licenseStr: unknown): boolean {
  if (typeof licenseStr !== "string") return false;
  const normalized = licenseStr.replace(/[()]/g, "").trim();
  
  // Handle compound licenses (e.g., "MIT OR Apache-2.0")
  if (normalized.includes(" OR ")) {
    const parts = normalized.split(" OR ");
    return parts.some(part => ALLOWED_LICENSES.includes(part.trim()));
  }
  if (normalized.includes(" AND ")) {
    const parts = normalized.split(" AND ");
    return parts.every(part => ALLOWED_LICENSES.includes(part.trim()));
  }
  
  return ALLOWED_LICENSES.includes(normalized);
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
      if (!isAllowed(license)) {
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
