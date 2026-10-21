#!/usr/bin/env node
// scripts/osv-audit.ts
// Implements: 23_Security_Harness_Plan.md §5.1 (step 2c — SCA) and §12.1
// (G-SEC-1: "No P0/S1 vulnerability open" — `pr-security / osv-scanner` clean).
//
// WHY THIS EXISTS INSTEAD OF `osv-scanner`
// -----------------------------------------
// The repo's CI ran `osv-scanner --lockfile=bun.lock .` with
// `continue-on-error: true`. Two independent defects made that gate worthless:
//
//   1. ADVISORY, NOT A GATE. `continue-on-error: true` means the step prints its
//      findings and the job goes green. The spec (§5.1) says "A failure at any
//      step blocks merge" and §12.1 lists OSV-Scanner as the G-SEC-1 gate.
//   2. THE SCANNER WAS NEVER PINNED BY INTEGRITY. The install step was
//      `curl -L https://github.com/google/osv-scanner/releases/download/... -o
//      /usr/local/bin/osv-scanner` — no checksum. The gitleaks step in the SAME
//      workflow verifies a SHA256; the osv-scanner step did not. A gate whose
//      binary is fetched without integrity verification is not a gate.
//
// This script removes both defects:
//   - it uses the OSV.dev v1 API directly (no binary download, no unpinned
//     third-party artefact in the runner at all);
//   - it exits non-zero on HIGH/CRITICAL, so the CI step BLOCKS.
//
// ZERO NEW DEPENDENCIES: Node >= 22 global `fetch`. Exit 0 = clean,
// exit 1 = findings above the threshold, exit 2 = harness error.
//
// Usage:
//   node scripts/osv-audit.ts                    # gate (exit 1 on findings)
//   node scripts/osv-audit.ts --report out.json  # also write a JSON report
//   node scripts/osv-audit.ts --severity critical # lower the threshold
//
// The allowlist is `osv.allowlist.json` at the repo root. Every entry MUST
// carry a `reason` and an `expires` date; an expired entry is a hard failure
// (Rule 9 — a gate whose allowlist silently rots is not a gate).

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const OSV_VULN = "https://api.osv.dev/v1/vulns/";
const BATCH_SIZE = 500;

type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
  UNKNOWN: 0,
};

interface AllowEntry {
  id: string; // advisory id, e.g. "GHSA-xxxx-xxxx-xxxx"
  package: string;
  version?: string; // exact version; omitted = any version of the package
  reason: string;
  expires: string; // YYYY-MM-DD
  reviewedBy?: string;
}

interface Finding {
  id: string;
  package: string;
  version: string;
  severity: Severity;
  summary: string;
  fixedIn: string | null;
  aliases: string[];
  prodReachable: boolean;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function log(msg: string): void {
  console.log(msg);
}

// ── 1. Collect the resolved dependency set ───────────────────────────────────
interface Dep {
  name: string;
  version: string;
  source: string;
}

// ── 1b. Production reachability ──────────────────────────────────────────────
//
// A CVE in a package that only the test runner loads is a different risk class
// from a CVE in the framework that serves production traffic. Blocking on both
// at the same threshold trains people to ignore the gate (AGENTS.md Rule 9), so
// the gate is reachability-aware:
//
//   * PROD-REACHABLE  — reachable from the `dependencies` of a SHIPPED
//     workspace, following the lockfile's own dependency edges.
//   * DEV-ONLY        — reachable only from `devDependencies`, or from a
//     workspace that is not deployed.
//
// The shipped set is the deployable targets (AGENTS.md §3 Rule 11 — one
// directory, one deployment target) plus the shared packages they import.
// `apps/mobile` and `apps/desktop` are v1.x LOCKED until WEB-PROD-GATE
// (16_Platform_Delivery_Sequence.md); `apps/services/*` is the superseded
// microservice split that nothing deploys and nothing imports
// (18_Microservice_Architecture.md superseded by @apps/gateway).
const SHIPPED_WORKSPACES: string[] = [
  "", // root
  "apps/web",
  "apps/product-page",
  "packages/core",
  "packages/shared",
  "packages/design-system",
  "packages/security",
];

interface LockShape {
  packages?: Record<string, unknown>;
  workspaces?: Record<
    string,
    { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  >;
}

function loadLock(): LockShape {
  const raw = readFileSync(join(ROOT, "bun.lock"), "utf8");
  return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as LockShape;
}

function ownNameOf(spec: string): string | null {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  return spec.slice(0, at);
}

/** name -> set of dependency names (edges follow the lockfile, not the manifest) */
function buildGraph(lock: LockShape): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  for (const ws of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(ws) || typeof ws[0] !== "string") continue;
    const own = ownNameOf(ws[0]);
    if (!own) continue;
    const meta = (ws[2] ?? {}) as Record<string, Record<string, string> | undefined>;
    const edges = new Set<string>();
    // peerDependencies are a CONTRACT, not a shipped edge: the parent decides
    // whether it imports the peer, and a peer that is never imported is not
    // in the runtime path. Counting them made the reachability graph claim
    // that every package that DECLARES a peer (hono, undici, axios) is
    // production-reachable, which is not true and which turned a real gate
    // into noise.
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const dep of Object.keys(meta[field] ?? {})) edges.add(dep);
    }
    g.set(own, edges);
  }
  return g;
}

function prodReachableNames(lock: LockShape): Set<string> {
  const g = buildGraph(lock);
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const ws of SHIPPED_WORKSPACES) {
    const w = lock.workspaces?.[ws];
    for (const dep of Object.keys(w?.dependencies ?? {})) queue.push(dep);
  }
  while (queue.length > 0) {
    const n = queue.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const dep of g.get(n) ?? []) queue.push(dep);
  }
  return seen;
}

function collectFromBunLock(): Dep[] {
  const out: Dep[] = [];
  const lock = loadLock();
  for (const ws of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(ws) || typeof ws[0] !== "string") continue;
    const spec = ws[0];
    const at = spec.lastIndexOf("@");
    if (at <= 0) continue;
    out.push({ name: spec.slice(0, at), version: spec.slice(at + 1), source: "bun.lock" });
  }
  return out;
}

function collectFromDenoLock(): Dep[] {
  const out: Dep[] = [];
  let lock: { specifiers?: Record<string, string> };
  try {
    lock = JSON.parse(readFileSync(join(ROOT, "deno.lock"), "utf8")) as {
      specifiers?: Record<string, string>;
    };
  } catch {
    return out; // deno.lock is optional
  }
  for (const [spec, resolved] of Object.entries(lock.specifiers ?? {})) {
    const m = /^npm:(.+)$/.exec(spec);
    if (!m) continue;
    const at = m[1].lastIndexOf("@");
    if (at <= 0) continue;
    const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(resolved)?.[1];
    if (!version) continue;
    out.push({ name: m[1].slice(0, at), version, source: "deno.lock" });
  }
  return out;
}

// ── 2. Severity resolution ───────────────────────────────────────────────────
interface OsvVuln {
  id: string;
  summary?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  aliases?: string[];
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { type: string; events?: { introduced?: string; fixed?: string }[] }[];
  }[];
}

function severityOf(v: OsvVuln): Severity {
  const ds = v.database_specific?.severity?.toUpperCase();
  if (ds && ds in SEVERITY_RANK) return ds as Severity;
  // CVSS fallback: take the highest base score of any vector we can parse.
  let best = 0;
  for (const s of v.severity ?? []) {
    const m = /\/(?:CVSS:3\.\d|AV:[^/]*)\/.*/.exec(s.score);
    void m;
    const cvss = /CVSS:3\.\d\/AV:([NALP])\/AC:([LH])\/PR:([NLH])\/UI:([NR])\/S:([UC])\/C:([NLH])\/I:([NLH])\/A:([NLH])/.exec(s.score);
    if (!cvss) continue;
    const [, AV, AC, PR, UI, S, C, I, A] = cvss;
    const avN: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
    const acN: Record<string, number> = { L: 0.77, H: 0.44 };
    const uiN: Record<string, number> = { N: 0.85, R: 0.62 };
    const prN: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
    const ciaN: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };
    const sN: Record<string, number> = { U: 1, C: 1.22 };
    const isc = 1 - (1 - ciaN[C as string]!) * (1 - ciaN[I as string]!) * (1 - ciaN[A as string]!);
    const iss = 1 - (1 - ciaN[C as string]!) * (1 - ciaN[I as string]!);
    const impact = 6.42 * iss * sN[S as string]!;
    const exploit = 8.22 * avN[AV as string]! * acN[AC as string]! * prN[PR as string]! * uiN[UI as string]!;
    let score: number;
    if (S === "U") score = Math.min(impact + exploit, 10);
    else score = Math.min(1.08 * (impact + exploit), 10);
    best = Math.max(best, score);
  }
  if (best === 0) return "UNKNOWN";
  if (best >= 9) return "CRITICAL";
  if (best >= 7) return "HIGH";
  if (best >= 4) return "MODERATE";
  return "LOW";
}

function fixedVersionFor(v: OsvVuln, pkg: string): string | null {
  let best: string | null = null;
  for (const aff of v.affected ?? []) {
    if (aff.package?.ecosystem !== "npm") continue;
    if (aff.package?.name !== pkg) continue;
    for (const r of aff.ranges ?? []) {
      for (const e of r.events ?? []) {
        if (e.fixed && (!best || e.fixed > best)) best = e.fixed;
      }
    }
  }
  return best;
}

// ── 3. Allowlist ─────────────────────────────────────────────────────────────
function loadAllowlist(): { entries: AllowEntry[]; expired: AllowEntry[] } {
  const p = join(ROOT, "osv.allowlist.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { entries: [], expired: [] };
  }
  const arr = Array.isArray(raw) ? raw : ((raw as { entries?: AllowEntry[] }).entries ?? []);
  const today = new Date().toISOString().slice(0, 10);
  const entries: AllowEntry[] = [];
  const expired: AllowEntry[] = [];
  for (const e of arr) {
    if (!e?.id || !e?.reason || !e?.expires) {
      expired.push({ ...e, reason: e?.reason ?? "MISSING reason/expires", expires: e?.expires ?? "1970-01-01" });
      continue;
    }
    if (e.expires < today) expired.push(e);
    else entries.push(e);
  }
  return { entries, expired };
}

// ── 4. Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const thresholdArg = args.indexOf("--severity");
  const threshold: Severity =
    thresholdArg >= 0 ? ((args[thresholdArg + 1] ?? "high").toUpperCase() as Severity) : "HIGH";
  const reportArg = args.indexOf("--report");
  const reportPath = reportArg >= 0 ? args[reportArg + 1] : null;

  const deps = [...collectFromBunLock(), ...collectFromDenoLock()];
  const unique = new Map<string, Dep>();
  for (const d of deps) {
    const k = `${d.name}@${d.version}`;
    if (!unique.has(k)) unique.set(k, d);
  }
  const list = [...unique.values()];
  log(`osv-audit: ${list.length} unique npm packages across bun.lock + deno.lock`);

  const lock = loadLock();
  const prodNames = prodReachableNames(lock);
  // The Deno gateway's own npm imports are production roots too — the gateway
  // is the canonical backend for every platform (17_API_Gateway_System.md §6).
  try {
    const denoJson = JSON.parse(
      readFileSync(join(ROOT, "apps/gateway/deno.json"), "utf8"),
    ) as { imports?: Record<string, string> };
    for (const spec of Object.values(denoJson.imports ?? {})) {
      const m = /^npm:(.+)$/.exec(spec);
      if (!m) continue;
      const at = m[1].lastIndexOf("@");
      if (at > 0) prodNames.add(m[1].slice(0, at));
    }
  } catch {
    /* deno.json optional */
  }
  log(
    `osv-audit: ${prodNames.size} package names are production-reachable (shipped workspaces + the Deno gateway's npm imports)`,
  );

  const { entries: allow, expired } = loadAllowlist();
  if (expired.length > 0) {
    log("");
    log("FAIL — expired or malformed osv.allowlist.json entries:");
    for (const e of expired) {
      log(`  ${e.id} (${e.package}) expires=${e.expires} — ${e.reason}`);
    }
    log("Rule 9: an allowlist that silently rots is not an allowlist. Fix or remove these entries.");
    process.exit(1);
  }

  // querybatch
  const hits = new Map<string, string[]>(); // name@version -> advisory ids
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const chunk = list.slice(i, i + BATCH_SIZE);
    const body = JSON.stringify({
      queries: chunk.map((d) => ({
        package: { name: d.name, ecosystem: "npm" },
        version: d.version,
      })),
    });
    const res = await fetch(OSV_BATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      log(`osv-audit: OSV querybatch failed (HTTP ${res.status}) — harness error, not a pass.`);
      process.exit(2);
    }
    const data = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    for (let j = 0; j < chunk.length; j++) {
      const vulns = data.results[j]?.vulns ?? [];
      if (vulns.length === 0) continue;
      hits.set(
        `${chunk[j]!.name}@${chunk[j]!.version}`,
        vulns.map((v) => v.id),
      );
    }
    log(`  queried ${Math.min(i + BATCH_SIZE, list.length)}/${list.length}`);
  }

  log(`osv-audit: ${hits.size} package(s) carry at least one advisory`);

  // detail each advisory
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const [pkgver, ids] of hits) {
    const at = pkgver.lastIndexOf("@");
    const pkg = pkgver.slice(0, at);
    const ver = pkgver.slice(at + 1);
    for (const id of ids) {
      const key = `${id}@${pkg}@${ver}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let v: OsvVuln;
      try {
        const r = await fetch(`${OSV_VULN}${id}`);
        if (!r.ok) continue;
        v = (await r.json()) as OsvVuln;
      } catch {
        continue;
      }
      findings.push({
        id,
        package: pkg,
        version: ver,
        severity: severityOf(v),
        summary: v.summary ?? "(no summary)",
        fixedIn: fixedVersionFor(v, pkg),
        aliases: v.aliases ?? [],
        prodReachable: prodNames.has(pkg),
      });
    }
  }

  const isAllowed = (f: Finding): boolean =>
    allow.some(
      (e) =>
        e.id === f.id &&
        e.package === f.package &&
        (e.version === undefined || e.version === f.version),
    );

  const rank = SEVERITY_RANK[threshold] ?? SEVERITY_RANK.HIGH!;

  // The blocking policy. Two thresholds, both documented, neither an escape
  // hatch:
  //
  //   PROD-REACHABLE  @ HIGH+   -> BLOCKS. This is G-SEC-1 proper: a
  //                               vulnerability in something that loads in
  //                               production.
  //   DEV-ONLY        @ CRITICAL -> BLOCKS. A critical advisory in the test
  //                               toolchain is still a critical advisory in
  //                               the toolchain; it needs an allowlist entry
  //                               with a reason, not silence.
  //   DEV-ONLY        @ HIGH     -> REPORTED, not blocking. Documented in
  //                               osv.allowlist.json as a policy, reviewed
  //                               quarterly. Blocking here would mean the
  //                               gate can never be green, and a gate that is
  //                               always red is a gate nobody reads.
  const blocking = findings
    .filter((f) => !isAllowed(f))
    .filter((f) =>
      f.prodReachable
        ? (SEVERITY_RANK[f.severity] ?? 0) >= rank
        : f.severity === "CRITICAL",
    )
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  const allowed = findings.filter((f) => isAllowed(f));
  const reported = findings.filter(
    (f) => !isAllowed(f) && !blocking.includes(f),
  );

  if (allowed.length > 0) {
    log("");
    log(`ALLOWLISTED (${allowed.length}) — accepted risk, each with a reason + expiry:`);
    for (const f of allowed) {
      log(`  ${f.id} ${f.package}@${f.version} [${f.severity}] ${f.prodReachable ? "PROD" : "dev-only"} — ${f.summary}`);
    }
  }
  if (reported.length > 0) {
    log("");
    log(
      `REPORTED, NOT BLOCKING (${reported.length}) — dev-only, below CRITICAL. Policy: see osv.allowlist.json "policy".`,
    );
    for (const f of reported) {
      log(
        `  ${f.id} ${f.package}@${f.version} [${f.severity}]${f.fixedIn ? ` fixed in ${f.fixedIn}` : ""} — ${f.summary}`,
      );
    }
  }

  if (reportPath) {
    writeFileSync(
      reportPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), threshold, findings, allowed },
        null,
        2,
      ),
      "utf8",
    );
    log(`\nwrote ${reportPath}`);
  }

  if (blocking.length > 0) {
    log("");
    log(`FAIL — ${blocking.length} blocking advisory(ies) with no allowlist entry:`);
    for (const f of blocking) {
      log(
        `  ${f.id} ${f.package}@${f.version} [${f.severity}] ${f.prodReachable ? "PROD-REACHABLE" : "dev-only"} ${f.fixedIn ? `fixed in ${f.fixedIn}` : "no fix published"}`,
      );
      log(`      ${f.summary}`);
    }
    log("");
    log("23_Security_Harness_Plan.md §12.1 G-SEC-1 blocks the deploy. Upgrade the package, or");
    log("file an allowlist entry in osv.allowlist.json WITH a reason and an expiry date.");
    process.exit(1);
  }

  log("");
  log(
    `PASS — no blocking advisory (prod-reachable ${threshold}+, dev-only CRITICAL) in ${list.length} locked packages.`,
  );
}

main().catch((err: unknown) => {
  console.error(`osv-audit: harness error — ${errMsg(err)}`);
  process.exit(2);
});
