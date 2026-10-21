#!/usr/bin/env node
// scripts/sbom-generator.ts
// Implements: 23_Security_Harness_Plan.md §5.3 (CycloneDX SBOM per app) and
// §12.1 G-SEC-5 ("SBOM generated for every app (web, mobile, desktop,
// gateway) — `pr-security / cyclonedx` artefact uploaded — block deploy").
//
// WHY THIS EXISTS INSTEAD OF `cyclonedx-npm`
// -----------------------------------------
// The CI SBOM step ran `bun install -g @cyclonedx/cyclonedx-npm` and then
// `cyclonedx-npm`, with `continue-on-error: true` and an `|| echo "SBOM
// generation skipped — tool unavailable"` fallback. Two defects:
//   1. `cyclonedx-npm` reads package-lock.json / npm-shrinkwrap.json. This
//      repository uses BUN — there is no package-lock.json — so the tool had
//      nothing to read and the `||` branch printed "skipped".
//   2. The tool itself was installed UNPINNED (`@cyclonedx/cyclonedx-npm`, no
//      version) from a registry, at run time, with `continue-on-error: true`.
//   The net effect was an upload step that produced an empty directory and a
//   green CI. G-SEC-5 was satisfied by nothing.
//
// This generator reads the lockfiles the repo ACTUALLY ships (bun.lock for the
// npm workspaces, deno.lock for the Deno gateway) and emits a valid CycloneDX
// 1.6 document. ZERO new dependencies.
//
// Usage:
//   node scripts/sbom-generator.ts --out sbom/bom.web.json --app web
//   node scripts/sbom-generator.ts --out sbom/bom.gateway.json --app gateway
//
// Exit 0 = a non-empty SBOM was written. Exit 1 = nothing to write (a FAILURE,
// because an empty SBOM must never be uploaded as if it were a real one).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface BomComponent {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  scope?: "required" | "optional";
  licenses?: { license: { name: string } }[];
}

interface BomDependency {
  ref: string;
  dependsOn: string[];
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const OUT = arg("--out", "sbom/bom.json");
const APP = arg("--app", "workspace");

// ── bun.lock ─────────────────────────────────────────────────────────────────
interface LockShape {
  packages?: Record<string, unknown>;
  workspaces?: Record<string, { name?: string; dependencies?: Record<string, string> }>;
}

function readBunLock(): LockShape {
  const raw = readFileSync(join(ROOT, "bun.lock"), "utf8");
  return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as LockShape;
}

// ── deno.lock ────────────────────────────────────────────────────────────────
function readDenoLock(): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = [];
  let lock: { specifiers?: Record<string, string> };
  try {
    lock = JSON.parse(readFileSync(join(ROOT, "deno.lock"), "utf8")) as {
      specifiers?: Record<string, string>;
    };
  } catch {
    return out;
  }
  for (const [spec, resolved] of Object.entries(lock.specifiers ?? {})) {
    const m = /^npm:(.+)$/.exec(spec);
    if (!m) continue;
    const at = m[1].lastIndexOf("@");
    if (at <= 0) continue;
    const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(resolved)?.[1];
    if (!version) continue;
    out.push({ name: m[1].slice(0, at), version });
  }
  return out;
}

// ── licence of an installed package (best effort, from node_modules) ─────────
function licenseOf(name: string): string | null {
  const candidates = [
    join(ROOT, "node_modules", name, "package.json"),
    join(ROOT, "node_modules", name.split("/").join(join(ROOT, "node_modules", "")), "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf8")) as { license?: unknown };
      if (typeof pkg.license === "string") return pkg.license;
      if (pkg.license && typeof pkg.license === "object") {
        const t = (pkg.license as { type?: string }).type;
        if (typeof t === "string") return t;
      }
    } catch {
      /* not installed — fine, the SBOM records the coordinate, not the file */
    }
  }
  return null;
}

function purl(name: string, version: string): string {
  const scoped = name.startsWith("@");
  const encoded = scoped
    ? name.split("/").map((s) => encodeURIComponent(s)).join("/")
    : encodeURIComponent(name);
  return `pkg:npm/${encoded}@${version}`;
}

function main(): void {
  const lock = readBunLock();
  const components = new Map<string, BomComponent>();
  const dependsOn = new Map<string, string[]>();

  for (const ws of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(ws) || typeof ws[0] !== "string") continue;
    const spec = ws[0];
    const at = spec.lastIndexOf("@");
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    const ref = purl(name, version);
    if (!components.has(ref)) {
      const lic = licenseOf(name);
      components.set(ref, {
        type: "library",
        "bom-ref": ref,
        name,
        version,
        purl: ref,
        ...(lic ? { licenses: [{ license: { name: lic } }] } : {}),
      });
    }
    const meta = (ws[2] ?? {}) as Record<string, Record<string, string> | undefined>;
    const edges: string[] = [];
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dep of Object.keys(meta[field] ?? {})) {
        const depRef = purl(dep, "*");
        edges.push(depRef);
        if (!components.has(depRef)) {
          components.set(depRef, {
            type: "library",
            "bom-ref": depRef,
            name: dep,
            version: "*",
            purl: depRef,
          });
        }
      }
    }
    dependsOn.set(ref, edges);
  }

  for (const d of readDenoLock()) {
    const ref = purl(d.name, d.version);
    if (components.has(ref)) continue;
    const lic = licenseOf(d.name);
    components.set(ref, {
      type: "library",
      "bom-ref": ref,
      name: d.name,
      version: d.version,
      purl: ref,
      ...(lic ? { licenses: [{ license: { name: lic } }] } : {}),
    });
  }

  // The workspaces themselves are components of the BOM.
  for (const [path, ws] of Object.entries(lock.workspaces ?? {})) {
    if (!ws.name) continue;
    const ref = `pkg:npm/${ws.name}@workspace`;
    components.set(ref, {
      type: "library",
      "bom-ref": ref,
      name: ws.name,
      version: "workspace",
      purl: ref,
      scope: "required",
    });
    dependsOn.set(
      ref,
      Object.keys(ws.dependencies ?? {}).map((d) => purl(d, "*")),
    );
  }

  if (components.size === 0) {
    console.error("sbom-generator: no components resolved — refusing to write an empty SBOM.");
    process.exit(1);
  }

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "Buddysaradhi", name: "scripts/sbom-generator.ts" }],
      component: {
        type: "application",
        "bom-ref": `app:${APP}`,
        name: `buddysaradhi-${APP}`,
        version: "1.0.0",
      },
    },
    components: [...components.values()].sort((a, b) =>
      a["bom-ref"] < b["bom-ref"] ? -1 : a["bom-ref"] > b["bom-ref"] ? 1 : 0,
    ),
    dependencies: [...dependsOn.entries()].map(([ref, deps]) => ({
      ref,
      dependsOn: deps,
    })),
  };

  const outPath = join(ROOT, OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(bom, null, 2), "utf8");
  console.log(
    `sbom-generator: wrote ${OUT} — ${bom.components.length} components, ${bom.dependencies.length} dependency edges (app=${APP})`,
  );
}

main();
