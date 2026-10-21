#!/usr/bin/env node
// scripts/a11y-gate.ts
// Implements: AGENTS.md §2 Rule 10 (accessibility is not optional) and §7.4
//   CI gate 5 ("axe-core on every screen"); 21_Automation_Testing.md §6 (the
//   per-flow axe scan and its gate policy: 0 `critical` violations -> merge,
//   `serious` -> warn, `moderate`/`minor` -> log only).
//
// WHY THIS EXISTS. Audit AUD-024 (docs/audit/AUDIT-2026-10-21.md) found the
//   only axe gate in CI was conditional on `HAS_E2E_CREDENTIALS == 'true'`:
//   with no CI secrets the step was SKIPPED with a `::notice::`, so Rule 10
//   had no guaranteed gate and a WCAG regression merged green. The skipped
//   gate was recorded, not hidden — but a recorded skip is still no gate.
//
// WHAT IT DOES. It drives a LOCAL server (never a deployed URL, never
//   production) with headless Chromium, loads each public route, asserts the
//   route actually RENDERED, injects axe-core and runs the WCAG 2.1 A/AA
//   ruleset. It needs no credentials and no secrets, so it never skips.
//
// A GATE THAT CANNOT FAIL IS NOT A GATE (AGENTS.md §12), so:
//   - an unreachable server FAILS (the gate never degrades to a skip);
//   - a route that did not render FAILS (an error page would otherwise pass
//     axe with zero violations — a vacuous pass);
//   - a missing axe-core or a missing browser FAILS.
//
// WHAT IT COVERS. The routes that need no session: the four auth screens.
//   The five product screens need a signed-in tutor, so the credentialed
//   suite (`apps/web/tests/a11y/a11y.spec.ts`, run by `bun run test:a11y`)
//   still covers them; this gate is the part that can never be switched off.
//
// Exit 0 = clean. Exit 1 = the gate failed (violations, or a route that did
// not render, or an unreachable server). Exit 2 = harness error.
//
// Usage:
//   node scripts/a11y-gate.ts --base-url http://127.0.0.1:3300
//   PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3300 node scripts/a11y-gate.ts

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AxeNode {
  target: string[];
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: AxeNode[];
}

export interface RouteSpec {
  path: string;
  /** A selector that only the real, rendered page has. Its absence = the
   *  route did not render, which FAILS the gate (a vacuous axe pass). */
  ready: string;
}

export interface RouteResult {
  path: string;
  rendered: boolean;
  violations: AxeViolation[];
  /** Set when the route could not be loaded at all. */
  error?: string;
}

/** The routes that need no session. */
export const ROUTES: RouteSpec[] = [
  { path: "/login", ready: "#email" },
  { path: "/signup", ready: "#email" },
  { path: "/forgot-password", ready: "#reset-email" },
  { path: "/reset-password", ready: "#reset-newPassword" },
];

export const CRITICAL_IMPACTS = ["critical"];
export const WARN_IMPACTS = ["serious"];

/** The gate policy from 21_Automation_Testing.md §6. */
export function classifyViolations(violations: AxeViolation[]): {
  critical: AxeViolation[];
  serious: AxeViolation[];
  other: AxeViolation[];
} {
  return {
    critical: violations.filter((v) => v.impact !== null && CRITICAL_IMPACTS.includes(v.impact)),
    serious: violations.filter((v) => v.impact !== null && WARN_IMPACTS.includes(v.impact)),
    other: violations.filter(
      (v) => v.impact === null || (!CRITICAL_IMPACTS.includes(v.impact) && !WARN_IMPACTS.includes(v.impact)),
    ),
  };
}

/**
 * The exit decision, following the gate policy of 21_Automation_Testing.md
 * §6: a `critical` violation fails the merge, a `serious` one warns, and
 * `moderate`/`minor` are logged only. Independently of the violations, a
 * route that did not render or could not be loaded FAILS — an unreadable page
 * must never be reported as a clean scan.
 */
export function decideExitCode(results: RouteResult[]): {
  code: 0 | 1;
  failures: string[];
  warnings: string[];
} {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (result.error !== undefined) {
      failures.push(`${result.path}: could not be loaded — ${result.error}`);
      continue;
    }
    if (!result.rendered) {
      failures.push(`${result.path}: did not render — the gate refuses to pass a page it could not read`);
      continue;
    }
    const { critical, serious, other } = classifyViolations(result.violations);
    for (const violation of critical) {
      failures.push(`${result.path}: ${violation.id} (critical) — ${violation.help}`);
    }
    for (const violation of serious) {
      warnings.push(`${result.path}: ${violation.id} (serious) — ${violation.help}`);
    }
    for (const violation of other) {
      warnings.push(`${result.path}: ${violation.id} (${violation.impact ?? "unknown"}) — ${violation.help}`);
    }
  }
  return { code: failures.length === 0 ? 0 : 1, failures, warnings };
}

/** The axe-core bundle, resolved from this repository's dependencies. */
export function resolveAxeSource(): string {
  const require = createRequire(import.meta.url);
  const axePath = require.resolve("axe-core/axe.min.js");
  if (!existsSync(axePath)) throw new Error(`axe-core is not installed at ${axePath}`);
  return readFileSync(axePath, "utf8");
}

/**
 * Scan the routes. `browser` is injected so the unit test can exercise the
 * decision logic without a browser; the CLI passes a real Chromium.
 */
export async function scanRoutes(
  baseUrl: string,
  routes: RouteSpec[],
  axeSource: string,
  browser: import("playwright").Browser,
): Promise<RouteResult[]> {
  const out: RouteResult[] = [];
  for (const route of routes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const response = await page.goto(`${baseUrl}${route.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (response !== null && response.status() >= 500) {
        out.push({ path: route.path, rendered: false, violations: [], error: `HTTP ${response.status()}` });
        continue;
      }
      await page.addScriptTag({ content: axeSource });
      let rendered = true;
      try {
        await page.waitForSelector(route.ready, { timeout: 15_000 });
      } catch {
        // The page answered, but the marker that only the real screen has is
        // absent — an error page, a shell that never hydrated, a redirect to
        // somewhere else. Scanning it would be a vacuous pass.
        rendered = false;
        out.push({
          path: route.path,
          rendered: false,
          violations: [],
          error: `did not render — the selector \`${route.ready}\` never appeared`,
        });
        continue;
      }
      const raw = await page.evaluate(async () => {
        const axe = (globalThis as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<unknown> } }).axe;
        const result = (await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        })) as { violations: unknown[] };
        return result.violations;
      });
      const violations = (raw as AxeViolation[]).map((v) => ({
        id: String(v.id),
        impact: v.impact === undefined ? null : (v.impact as string | null),
        help: String(v.help),
        nodes: Array.isArray(v.nodes) ? (v.nodes as AxeNode[]) : [],
      }));
      out.push({ path: route.path, rendered, violations });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.push({ path: route.path, rendered: false, violations: [], error: message });
    } finally {
      await context.close();
    }
  }
  return out;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--base-url");
  const baseUrl =
    flag !== -1
      ? (args[flag + 1] ?? "")
      : (process.env.A11Y_BASE_URL ?? process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:3300");
  if (baseUrl === "") {
    process.stderr.write("a11y-gate: --base-url needs a value\n");
    return 2;
  }

  let axeSource: string;
  try {
    axeSource = resolveAxeSource();
  } catch (error) {
    process.stderr.write(`a11y-gate: FAIL — axe-core is not available: ${String(error)}\n`);
    return 1;
  }

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    process.stderr.write(`a11y-gate: FAIL — playwright is not available: ${String(error)}\n`);
    return 1;
  }

  let browser: import("playwright").Browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    process.stderr.write(
      `a11y-gate: FAIL — the browser did not start: ${String(error)}\n` +
        "  Install it with `bunx playwright install --with-deps`.\n",
    );
    return 1;
  }

  let results: RouteResult[];
  try {
    results = await scanRoutes(baseUrl, ROUTES, axeSource, browser);
  } finally {
    await browser.close();
  }

  const { code, failures, warnings } = decideExitCode(results);
  const total = results.reduce((n, r) => n + r.violations.length, 0);
  for (const warning of warnings) process.stderr.write(`  warning: ${warning}\n`);
  if (code === 0) {
    process.stdout.write(
      `a11y-gate: PASS — ${results.length} route(s) scanned against ${baseUrl}, ${total} violation(s), ${warnings.length} warning(s)\n`,
    );
    return 0;
  }

  process.stderr.write(
    `a11y-gate: FAIL — ${failures.length} failure(s) against ${baseUrl} (${total} violation(s) total)\n`,
  );
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`a11y-gate: FAIL — ${String(error)}\n`);
      process.exit(1);
    });
}
