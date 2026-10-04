#!/usr/bin/env node
// scripts/principle-lints.ts
// Implements: reviews/verification-production-readiness-report-2026-09-29.md §4 F-7
//   AGENTS.md §2 Rules 1/2/3/5/6 + §7.4 promise static "principle lints" that
//   did not exist. This file is L1–L7 of that gate (L6 coverage floors live in
//   vitest.config.ts, L7 wiring lives in package.json "lint"/"test:unit").
//
// Zero new dependencies: plain Node (>=22) + `git ls-files` for the file set.
// Exit 0 = clean. Exit 1 = findings (printed). Exit 2 = harness error.
//
// Usage:
//   node scripts/principle-lints.ts            # gate: findings -> exit 1
//   node scripts/principle-lints.ts --verbose  # also print allowlisted hits
//
// Allowlist policy: an entry is { file, re, reason }. `re` must match the
// offending LINE CONTENT (not its number) so entries survive unrelated edits
// above them. Every entry cites the spec section that authorises the
// exception. --verbose prints each allowlisted hit so the list stays honest.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Finding {
  rule: string;
  file: string;
  line: number;
  msg: string;
  text: string;
}

interface AllowEntry {
  file: string;
  re: RegExp;
  reason: string;
}

interface LintPattern {
  re: RegExp;
  msg: string;
  allowSameLine?: RegExp;
}

interface Rule {
  id: string;
  name: string;
  spec: string;
  exts: string[];
  prefixes?: string[];
  exclude?: RegExp[];
  patterns: LintPattern[];
  allow: AllowEntry[];
  extra?: (findings: Finding[]) => void;
}

interface BlockState {
  inBlock: boolean;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE: boolean = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------
// File set — git-tracked + untracked-but-not-ignored, minus non-product dirs
// (same exclusion list as the root eslint config so both gates agree).
// ---------------------------------------------------------------------------
const EXCLUDE_DIRS: string[] = [
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  ".turbo/",
  "coverage/",
  ".vercel/",
  "playwright-report/",
  "test-results/",
  "blob-report/",
  // Agent/skill tooling and vendored helpers — not product code.
  ".claude/",
  ".agents/",
  ".agent/",
  ".kilo/",
  ".opencode/",
  ".github/skills/",
  ".testsprite/",
  ".ruff_cache/",
  ".playwright-mcp/",
  ".freebuff/",
  // Scratch, references, one-off verification harnesses.
  "scratch/",
  "reference-implementations/",
  "testsprite_tests/",
];

function listFiles(): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    console.error(`principle-lints: git ls-files failed: ${errMsg(err)}`);
    process.exit(2);
  }
  return out
    .split("\n")
    .map((f: string) => f.trim().replace(/\\/g, "/"))
    .filter((f: string) => f.length > 0)
    .filter((f: string) => !EXCLUDE_DIRS.some((d: string) => f.startsWith(d)));
}

const hasExt = (file: string, exts: string[]): boolean => exts.some((e: string) => file.endsWith(e));

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------
const CODE_EXTS: string[] = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// L1 — Rule 1 (P4, BR-LED-01): ledger_entries is append-only.
// Mutating ORM calls + raw SQL with a mutating verb aimed at ledger_entries or
// the append-only triggers. Read-only SELECTs are NOT flagged here (they are a
// separate §3.4 raw-SQL concern, out of F-7 scope); the verb must sit directly
// before the table name so `CREATE TRIGGER ... BEFORE UPDATE ON ledger_entries`
// (guard DDL, legal) never matches.
const L1_PATTERNS: LintPattern[] = [
  {
    re: /\.ledgerEntry\s*\.\s*(?:update|delete|deleteMany)\s*\(/,
    msg: "ORM ledger mutation — Rule 1: only ledgerEntry.create() is permitted",
  },
  {
    re: /\bUPDATE\s+[`'"]?ledger_entries\b/i,
    msg: "raw UPDATE of ledger_entries — Rule 1: voids are reversing rows",
  },
  {
    re: /\bDELETE\s+FROM\s+[`'"]?ledger_entries\b/i,
    msg: "raw DELETE of ledger_entries — Rule 1: append-only table",
  },
  {
    re: /\bDROP\s+TABLE\s+[`'"]?ledger_entries\b/i,
    msg: "raw DROP of ledger_entries — Rule 1: append-only table",
  },
  {
    re: /\bALTER\s+TABLE\s+[`'"]?ledger_entries\b/i,
    msg: "raw ALTER of ledger_entries — Rule 1: append-only table",
  },
  {
    re: /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?[`'"]?trg_ledger/i,
    msg: "append-only trigger dropped — Rule 1: trg_ledger_* guards must persist",
  },
];
const L1_ALLOW: AllowEntry[] = [
  {
    file: "packages/core/src/ledger.test.ts",
    re: /\.ledgerEntry\s*\.\s*update/,
    reason:
      "§7.3 tamper-detection test — must prove the trigger aborts UPDATE",
  },
  {
    file: "apps/gateway/__tests__/ledger-routes.test.ts",
    re: /(UPDATE|DELETE\s+FROM)\s+ledger_entries/,
    reason:
      "§7.2 trigger-fire test — asserts append-only rejects the mutation",
  },
  {
    file: "apps/gateway/__tests__/students-delete.test.ts",
    re: /DELETE\s+FROM\s+ledger_entries/,
    reason:
      "negative assertion — verifies the student delete does NOT touch the ledger",
  },
  {
    file: "apps/services/auth-svc/src/index.ts",
    re: /(DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_ledger|DELETE\s+FROM\s+ledger_entries)/,
    reason:
      "secure-erase per 10_Security.md §18.1 (LEDGER-4 exception) — FINDING: spec prescribes ORM deleteMany in lib/security/secureErase.ts, which does not exist; mechanism divergence tracked in F-7 report",
  },
  {
    file: "apps/web/src/server/actions/settings.ts",
    re: /(?:db|tx)\.ledgerEntry\s*\.\s*deleteMany/,
    reason:
      "secure-erase cascade per 10_Security.md §18.1 (LEDGER-4 exception), cited in the surrounding code comment — ORM form after the raw-SQL removal; `db.` is the outer proxy and `tx.` the transaction-scoped handle inside the erase $transaction (Rule 7 atomic cascade)",
  },
  {
    file: "packages/core/src/engines/security.ts",
    re: /tx\.ledgerEntry\s*\.\s*deleteMany/,
    reason:
      "EC-SEC-01 brute-force wipe (02_Core_Logic.md §12.4 / BR-SEC-03): 15 failed PINs destroy the device-local cache replica via Prisma ORM deleteMany inside the wipe $transaction — the 10_Security.md §18.1 LEDGER-4 secure-erase exception applied to the lockout wipe (cloud ledger intact, re-sync restores); audited via pin_lockout_wipe in the same transaction",
  },
  {
    file: "schema.sql",
    re: /(ALTER\s+TABLE\s+ledger_entries\s+ADD\s+COLUMN|UPDATE\s+ledger_entries\s+SET)/i,
    reason:
      "generated bootstrap DDL — extract_schema.py lifts the 11_Data_Model.md SQL blocks verbatim (read by init_db.py); ALTER adds the hash-chain columns and the UPDATE backfills derived debit/credit paise only — forward migration per 11_Data_Model.md §1",
  },
];

// L2 — Rule 6 (BR-M-01, EC-F-01): money is integer minor units, never float.
// parseFloat on money-ish inputs, Float columns on money-ish Prisma fields,
// and toFixed() applied to a non-paise money value.
const L2_MONEY_WORDS: string =
  "(?:amount|fee|price|balance|due|paid|payment|discount|paise|inr|revenue|salary|total)";
const L2_PATTERNS: LintPattern[] = [
  {
    re: new RegExp(`parseFloat\\s*\\(\\s*[^)]*${L2_MONEY_WORDS}`, "i"),
    msg: "parseFloat on a money value — Rule 6: parse integer paise, not float",
  },
  {
    re: new RegExp(
      String.raw`(?<![\w/])(${L2_MONEY_WORDS})\w*\s*\.toFixed\s*\(`,
      "i",
    ),
    msg: "toFixed() on a money value without a paise→display conversion — Rule 6",
    allowSameLine: /(?:\/\s*100\b|formatINR|paiseToRupees|\/\s*100n\b)/,
  },
];
const L2_ALLOW: AllowEntry[] = [
  {
    file: "packages/core/src/engines/report.ts",
    re: /amountPaise\s*\/\s*100\s*\)\s*\.toFixed/,
    reason:
      "legal paise→display conversion (divides by 100 first; same maths as formatINR in packages/shared)",
  },
];

// L3 — Rule 3 (AP-10, TELE-1): no telemetry/analytics/crash SDK in any manifest.
const L3_FORBIDDEN_DEPS: string[] = [
  "sentry",
  "@sentry",
  "mixpanel",
  "posthog",
  "amplitude",
  "datadog",
  "@datadog",
  "logrocket",
  "fullstory",
  "hotjar",
  "google-analytics",
  "googletagmanager",
  "gtag",
  "fbq",
  "plausible",
  "umami",
  "matomo",
  "newrelic",
  "@newrelic",
  "bugsnag",
  "@bugsnag",
  "rollbar",
  "@segment",
  "heap-analytics",
  "clarity.ms",
];

// L4 — Rule 2 (FM-05, P5): client components never call fetch() directly;
// mutations run in Server Actions. Scope = files under apps/web/src carrying
// the "use client" directive (the compile-time truth of FM-05).
const L4_PREFIX: string = "apps/web/src/";
const L4_ALLOW: AllowEntry[] = [
  {
    file: "apps/web/src/app/(auth)/signup/provision/page.tsx",
    re: /fetch\s*\(\s*["'`]\/api\/v1\/provision/,
    reason:
      "18_Microservice_Architecture.md — provision-db client bootstrap (first-party /api/v1/provision, bearer session; runs before any Server Action exists)",
  },
  {
    file: "apps/web/src/hooks/use-auto-provision.ts",
    re: /fetch\s*\(\s*["'`]\/api\/v1\/provision/,
    reason:
      "18_Microservice_Architecture.md — auto-heal interceptor (first-party /api/v1/provision only; spec-mandated client-side recovery)",
  },
];

// L5 — Rule 5 (AP-6): no indigo/blue as accent. Hex literals + Tailwind
// indigo/blue utilities. eslint.config.* files are skipped (they CONTAIN the
// banned tokens as rule definitions).
const L5_PATTERNS: LintPattern[] = [
  {
    re: /#(?:4F46E5|4338CA|3730A3|312E81|1E1B4B|2563EB|3B82F6|1D4ED8|1E40AF|1E3A8A)\b/i,
    msg: "indigo/blue hex accent — Rule 5: use the bioluminescent palette",
  },
  {
    re: /(?:^|[\s"'`=(])(?:bg|text|border|ring|from|via|to|shadow|fill|stroke|outline|divide|decoration|accent|caret|placeholder)-(?:indigo|blue)-\d{2,3}\b/,
    msg: "Tailwind indigo/blue utility — Rule 5: use emerald/cyan/flare/amber/violet",
  },
];

// L6 — AGENTS.md §3.4 ORM-ONLY: only ORM methods touch the DB at runtime.
// Any SQL text outside the audited authorities is a P0 CI failure. Uppercase
// verbs only (repo SQL convention is UPPERCASE; UI sentence-case copy such as
// "Delete entry" never matches). Test files are excluded (§7.3 requires real
// DDL in tests). New raw SQL must remove the SQL, not grow this allowlist.
const L6_PREFIXES: string[] = [
  "apps/web/src/",
  "packages/shared/src/",
  "packages/core/src/",
  "apps/gateway/routes/",
  "apps/gateway/graphql/",
  "apps/gateway/lib/",
];
const L6_PATTERNS: LintPattern[] = [
  {
    re: /\$(queryRaw|executeRaw)(Unsafe)?\s*\(/,
    msg: "Prisma $queryRaw/$executeRaw — §3.4 ORM-ONLY: use findMany/create/update/$transaction",
  },
  {
    re: /\bsql\s*:\s*[`'"]/,
    msg: "`sql:` string literal — §3.4 ORM-ONLY: use ORM methods, never SQL strings",
  },
  {
    re: /\.(execute|batch)\s*\(\s*[`'"]/,
    msg: ".execute()/.batch() with a string literal — §3.4 ORM-ONLY: use db.$transaction([...])",
  },
  {
    re: /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\b(FROM|INTO|SET|TABLE|WHERE|VALUES)\b[^`]*/,
    msg: "backtick SQL statement — §3.4 ORM-ONLY: use ORM methods or the audited builder module",
  },
  {
    re: /"[^"]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"]*\b(FROM|INTO|SET|TABLE|WHERE|VALUES)\b[^"]*"/,
    msg: 'double-quoted SQL statement — §3.4 ORM-ONLY: use ORM methods or the audited builder module',
  },
  {
    re: /'[^']*\b(SELECT|INSERT|UPDATE|DELETE)\b[^']*\b(FROM|INTO|SET|TABLE|WHERE|VALUES)\b[^']*'/,
    msg: "single-quoted SQL statement — §3.4 ORM-ONLY: use ORM methods or the audited builder module",
  },
];
const L6_ALLOW: AllowEntry[] = [
  {
    file: "apps/web/src/lib/libsql-proxy.ts",
    re: /[\s\S]/,
    reason:
      "audited ORM→SQL shim internals (AGENTS §3.4): SQL text stays inside the translator; all callers use db.<model>.* — never import SQL out of this file",
  },
  {
    file: "apps/gateway/lib/sql.ts",
    re: /[\s\S]/,
    reason:
      "single audited statement-builder authority (parameterized, Zod-validated inputs); routes hold zero literals — enforced by this rule",
  },
  {
    file: "apps/gateway/lib/schema.ts",
    re: /[\s\S]/,
    reason: "runtime DDL authority (AGENTS §3.4): idempotent CREATE TABLE/INDEX/TRIGGER only",
  },
  {
    file: "apps/gateway/graphql/index.ts",
    re: /[\s\S]/,
    reason:
      "standalone Edge Function deployment unit (own deno.json, cannot import lib/sql.ts); statements already parameterized (?); unification follow-up filed — migrate to shared builders when the import map unifies",
  },
  {
    file: "apps/web/src/lib/db/admin.ts",
    re: /[\s\S]/,
    reason: "one-time SQLite admin commands with no ORM equivalent (SQLCipher PRAGMA, WAL checkpoint) — never called from a screen/action/route (AGENTS §3.4). Its FTS5 virtual-table DDL was removed with lib/search/searchStudentsFts.ts (docs/design/overhaul-plan.md §3), so the entry is reserved, not active.",
  },
  {
    file: "apps/web/src/server/get-db.ts",
    re: /execute\("SELECT 1"\)/,
    reason: "credential-liveness probe, zero user input (VACUUM precedent, AGENTS §3.4)",
  },
  {
    file: "packages/core/src/fees.ts",
    re: /\bsql\s*:/,
    reason:
      "legacy SQL dialect (recordPaymentSql/createInvoiceSql take a raw client); core Prisma-overload RFC filed — no NEW raw SQL without updating this entry",
  },
  {
    file: "packages/core/src/ledgerSql.ts",
    re: /\bsql\s*:/,
    reason:
      "legacy SQL dialect (postLedgerEntrySql); core Prisma-overload RFC filed — no NEW raw SQL without updating this entry",
  },
];

// L7 — no-JS governance (AGENTS.md §6.1 TS strict): product code is
// TypeScript. Any *.js/*.mjs/*.cjs under apps/, packages/ or scripts/ is a
// finding unless allowlisted below. Scope notes:
// - eslint.config.mjs: ESLint 10 flat config has no .ts autodiscovery — .mjs
//   is the supported format (verified by trial: renaming to .ts breaks
//   `eslint .` without a jiti loader, which would be a new prod dep).
// - apps/desktop + apps/mobile entries: locked platforms per
//   16_Platform_Delivery_Sequence.md — migrate to .ts when the platform
//   unlocks (precedent: apps/web + apps/product-page postcss already .ts).
//   Expiry: revisit at MOBILE-PROD-GATE / DESKTOP-PROD-GATE.
// - Root eslint.config.mjs is out of scope (prefixes below start at apps/).
const L7_PREFIXES: string[] = ["apps/", "packages/", "scripts/"];
const L7_EXTS: string[] = [".js", ".mjs", ".cjs"];
const L7_ESLINT_REASON: string =
  "ESLint 10 flat config: no .ts autodiscovery (verified by trial) — .mjs is the supported format, not product code";
const L7_LOCKED_REASON: string =
  "locked platform per 16_Platform_Delivery_Sequence.md (mobile/desktop) — migrate to .ts at platform unlock; expiry MOBILE-PROD-GATE / DESKTOP-PROD-GATE";
const L7_ALLOW: AllowEntry[] = [
  { file: "apps/web/eslint.config.mjs", re: /eslint\.config\.mjs$/, reason: L7_ESLINT_REASON },
  {
    file: "apps/product-page/eslint.config.mjs",
    re: /eslint\.config\.mjs$/,
    reason: L7_ESLINT_REASON,
  },
  { file: "packages/core/eslint.config.mjs", re: /eslint\.config\.mjs$/, reason: L7_ESLINT_REASON },
  {
    file: "packages/shared/eslint.config.mjs",
    re: /eslint\.config\.mjs$/,
    reason: L7_ESLINT_REASON,
  },
  {
    file: "packages/security/eslint.config.mjs",
    re: /eslint\.config\.mjs$/,
    reason: L7_ESLINT_REASON,
  },
  { file: "apps/desktop/eslint.config.mjs", re: /eslint\.config\.mjs$/, reason: L7_ESLINT_REASON },
  {
    file: "apps/desktop/postcss.config.mjs",
    re: /postcss\.config\.mjs$/,
    reason:
      "locked desktop per 16_Platform_Delivery_Sequence.md — web/product-page already migrated postcss to .ts; expiry DESKTOP-PROD-GATE",
  },
  {
    file: "apps/desktop/scripts/generate-tokens.mjs",
    re: /generate-tokens\.mjs$/,
    reason: L7_LOCKED_REASON,
  },
  {
    file: "apps/desktop/scripts/verify-tokens.mjs",
    re: /verify-tokens\.mjs$/,
    reason: L7_LOCKED_REASON,
  },
  {
    file: "apps/mobile/scripts/generate-tokens.mjs",
    re: /generate-tokens\.mjs$/,
    reason: L7_LOCKED_REASON,
  },
];

const RULES: Rule[] = [
  {
    id: "L1",
    name: "no-ledger-mutation",
    spec: "AGENTS.md §2 Rule 1 · 12_Business_Rules.md BR-LED-01 · 10_Security.md §9",
    exts: [...CODE_EXTS, ".sql"],
    patterns: L1_PATTERNS,
    allow: L1_ALLOW,
  },
  {
    id: "L6",
    name: "no-raw-sql",
    spec: "AGENTS.md §3.4 ORM-ONLY · 11_Data_Model.md",
    exts: CODE_EXTS,
    prefixes: L6_PREFIXES,
    exclude: [/\.test\.tsx?$/, /\.spec\.tsx?$/],
    patterns: L6_PATTERNS,
    allow: L6_ALLOW,
  },
  {
    id: "L2",
    name: "no-float-money",
    spec: "AGENTS.md §2 Rule 6 · 12_Business_Rules.md BR-M-01 · 14_Edge_Cases.md EC-F-01",
    exts: CODE_EXTS,
    patterns: L2_PATTERNS,
    allow: L2_ALLOW,
    extra: lintPrismaSchema,
  },
  {
    id: "L3",
    name: "no-telemetry-deps",
    spec: "AGENTS.md §2 Rule 3 · 01_Product_Principles.md AP-10 · 10_Security.md §17 TELE-1",
    exts: [".json"],
    patterns: [], // manifest scan handled by lintPackageJson
    allow: [],
    extra: lintPackageJson,
  },
  {
    id: "L4",
    name: "no-fetch-in-client",
    spec: "AGENTS.md §2 Rule 2 · FM-05 · P5 (offline-first)",
    exts: CODE_EXTS,
    patterns: [],
    extra: lintClientFetch,
    allow: L4_ALLOW,
  },
  {
    id: "L5",
    name: "no-indigo-accent",
    spec: "AGENTS.md §2 Rule 5 · 01_Product_Principles.md AP-6 · 13_UI_Guidelines.md §1.3",
    exts: [...CODE_EXTS, ".css"],
    patterns: L5_PATTERNS,
    allow: [],
  },
  {
    id: "L7",
    name: "no-js-source",
    spec: "AGENTS.md §6.1 TS strict · 16_Platform_Delivery_Sequence.md (locked platforms)",
    exts: L7_EXTS,
    prefixes: L7_PREFIXES,
    patterns: [], // file-level scan handled by lintNoJs
    allow: L7_ALLOW,
    extra: lintNoJs,
  },
];

// ---------------------------------------------------------------------------
// Comment stripping — a lint must not flag prose. Full-line comments are
// skipped; inline/trailing comments are cut with a naive quote-aware scan so
// SQL strings (which ARE the payload for L1) stay intact. An unterminated /*
// opens a block state that swallows following lines until */. Limitation: this
// is a scanner, not a parser — a banned token inside a multi-line template
// literal can still match (allowlistable; never seen in this repo).
// ---------------------------------------------------------------------------
function stripComments(line: string, ext: string, st: BlockState): string {
  if (st.inBlock) {
    const end: number = line.indexOf("*/");
    if (end === -1) return "";
    st.inBlock = false;
    line = line.slice(end + 2);
  }
  const t: string = line.trimStart();
  const sqlish: boolean = ext === ".sql" || ext === ".prisma";
  if (sqlish ? t.startsWith("--") : t.startsWith("//")) return "";
  if (!sqlish && ext !== ".css" && t.startsWith("*")) return "";

  let out = "";
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c: string = line[i] as string;
    if (q) {
      out += c;
      if (c === "\\") {
        out += line[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      q = c;
      out += c;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    if (c === "/" && line[i + 1] === "*") {
      const close: number = line.indexOf("*/", i + 2);
      if (close === -1) {
        st.inBlock = true;
        break;
      }
      i = close + 1;
      continue;
    }
    if (sqlish && c === "-" && line[i + 1] === "-") break;
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Specialised checkers
// ---------------------------------------------------------------------------

function lintPrismaSchema(findings: Finding[]): void {
  const file = "prisma/schema.prisma";
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    return;
  }
  const moneyField = new RegExp(
    String.raw`^\s*(\w*${L2_MONEY_WORDS}\w*)\s+Float\b`,
    "i",
  );
  text.split("\n").forEach((line: string, i: number) => {
    const m: RegExpMatchArray | null = line.match(moneyField);
    if (m) {
      findings.push({
        rule: "L2",
        file,
        line: i + 1,
        msg: `Prisma column "${m[1]}" typed Float — Rule 6: money columns are INTEGER paise`,
        text: line.trim(),
      });
    }
  });
}

function lintPackageJson(findings: Finding[]): void {
  for (const file of ALL_FILES) {
    if (!file.endsWith("package.json")) continue;
    if (file.includes("node_modules")) continue;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as Record<string, unknown>;
    } catch (err) {
      findings.push({
        rule: "L3",
        file,
        line: 0,
        msg: `unparseable package.json: ${errMsg(err)}`,
        text: "",
      });
      continue;
    }
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      const deps: unknown = manifest[section];
      if (!deps || typeof deps !== "object") continue;
      for (const dep of Object.keys(deps as Record<string, unknown>)) {
        const lower: string = dep.toLowerCase();
        const hit: string | undefined = L3_FORBIDDEN_DEPS.find((f: string) => lower === f || lower.startsWith(f + "/") || lower.includes(f));
        if (hit) {
          findings.push({
            rule: "L3",
            file,
            line: 0,
            msg: `telemetry SDK "${dep}" in ${section} — Rule 3 (AP-10): no analytics/crash SDK, not even "anonymous" (matched "${hit}")`,
            text: `${dep}: ${(deps as Record<string, string>)[dep]}`,
          });
        }
      }
    }
  }
}

function lintClientFetch(findings: Finding[]): void {
  for (const file of ALL_FILES) {
    if (!file.startsWith(L4_PREFIX) || !hasExt(file, CODE_EXTS)) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    let text: string;
    try {
      text = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const head: string = text.slice(0, 400);
    if (!/^['"]use client['"]/m.test(head)) continue;
    const st: BlockState = { inBlock: false };
    text.split("\n").forEach((line: string, i: number) => {
      const code: string = stripComments(line, ".ts", st);
      if (!/(^|[^.\w$])fetch\s*\(/.test(code)) return;
      findings.push({
        rule: "L4",
        file,
        line: i + 1,
        msg: 'fetch() inside a "use client" module — FM-05: mutations run in Server Actions',
        text: line.trim(),
      });
    });
  }
}

function lintNoJs(findings: Finding[]): void {
  for (const file of ALL_FILES) {
    if (!L7_PREFIXES.some((p: string) => file.startsWith(p))) continue;
    if (!hasExt(file, L7_EXTS)) continue;
    findings.push({
      rule: "L7",
      file,
      line: 0,
      msg: "JS source under TS-only scope — AGENTS.md §6.1: product code is TypeScript; rename to .ts or add a spec-cited allowlist entry",
      text: file,
    });
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const ALL_FILES: string[] = listFiles();

function isAllowlisted(rule: Rule, finding: Finding): AllowEntry | undefined {
  return (rule.allow ?? []).find(
    (a: AllowEntry) => finding.file === a.file && a.re.test(finding.text),
  );
}

function main(): void {
  const findings: Finding[] = [];
  let allowlisted = 0;

  for (const rule of RULES) {
    const ruleFindings: Finding[] = [];
    for (const file of ALL_FILES) {
      if (!hasExt(file, rule.exts)) continue;
      if (rule.prefixes && !rule.prefixes.some((p: string) => file.startsWith(p))) continue;
      if (rule.exclude && rule.exclude.some((rx: RegExp) => rx.test(file))) continue;
      if (rule.id === "L5" && /(^|\/)eslint\.config\.[cm]?[jt]s$/.test(file))
        continue; // rule definitions cite the banned tokens by design
      if (rule.id === "L3" && !file.endsWith("package.json")) continue;
      // L4/L7 are file-level scans (lintClientFetch / lintNoJs) — skip the line loop.
      if (rule.id === "L4" || rule.id === "L7") continue;
      if (rule.patterns.length === 0 && !rule.extra) continue;

      let text: string;
      try {
        text = readFileSync(path.join(ROOT, file), "utf8");
      } catch {
        continue;
      }
      if (rule.patterns.length > 0) {
        const st: BlockState = { inBlock: false };
        const ext: string = path.extname(file);
        text.split("\n").forEach((line: string, i: number) => {
          const code: string = stripComments(line, ext, st);
          if (!code) return;
          for (const p of rule.patterns) {
            if (!p.re.test(code)) continue;
            if (p.allowSameLine && p.allowSameLine.test(code)) continue;
            ruleFindings.push({
              rule: rule.id,
              file,
              line: i + 1,
              msg: p.msg,
              text: line.trim(),
            });
            break;
          }
        });
      }
    }
    rule.extra?.(ruleFindings);
    for (const f of ruleFindings) {
      const hit: AllowEntry | undefined = isAllowlisted(rule, f);
      if (hit) {
        allowlisted++;
        if (VERBOSE)
          console.log(
            `allow [${f.rule}] ${f.file}:${f.line} — ${hit.reason}\n         ${f.text.slice(0, 120)}`,
          );
        continue;
      }
      findings.push(f);
    }
  }

  // ---- report ----
  if (VERBOSE && allowlisted > 0) {
    console.log(`allowlisted hits: ${allowlisted}\n`);
  }
  if (findings.length > 0) {
    let current = "";
    for (const f of findings) {
      if (f.rule !== current) {
        current = f.rule;
        const rule: Rule | undefined = RULES.find((r: Rule) => r.id === current);
        console.error(`\n${current} ${(rule as Rule).name} — ${(rule as Rule).spec}`);
      }
      console.error(`  ${f.file}:${f.line}\n    ${f.msg}`);
      if (f.text) console.error(`    > ${f.text.slice(0, 160)}`);
    }
    console.error(
      `\nprinciple-lints: FAIL — ${findings.length} finding(s), ${allowlisted} allowlisted.\nFix the finding, or (only with a spec citation) add an allowlist entry in scripts/principle-lints.ts.`,
    );
    process.exit(1);
  }

  for (const rule of RULES) {
    console.log(`PASS ${rule.id} ${rule.name}`);
  }
  console.log(`principle-lints: OK — ${RULES.length} rules clean, ${allowlisted} allowlisted hit(s).`);
  process.exit(0);
}

main();
