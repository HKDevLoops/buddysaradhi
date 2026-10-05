// Implements: 21_Automation_Testing.md (the W-01..W-12 web flows' shared
// driver) — one harness so every per-screen audit spec drives the app the
// same way instead of each lane re-deriving login, screen-switching and
// error capture.
//
// Why these three helpers exist (each is a real trap found in this repo's
// e2e history, not a convenience wrapper):
//
// 1. SCREEN SWITCHING IS ZUSTAND, NOT ROUTING. `apps/web` has exactly ONE
//    user-facing route (`/`); the five screens are switched by a store-driven
//    request event (AGENTS.md §2 Rule 4 / §3.1). A spec that does
//    `page.goto('/fees')` is testing a 404, not the Fees screen. Both desktop
//    (`nav[aria-label="Screens"]`) and mobile bottom-nav render the same five
//    controls, so one helper serves every viewport.
//
// 2. `getByRole("button", {name})` MATCHES THE MOBILE NAV TOO. The nav labels
//    are `Settings — press g then 5`, so an unanchored query can resolve two
//    elements and fail in strict mode. `gotoScreen` therefore filters on
//    `offsetParent !== null` (visibility) inside the nav element.
//
// 3. A COLD GATEWAY ISOLATE TAKES SECONDS. Supabase Edge isolates are
//    short-lived and the first request after a cold start pays the boot.
//    Fixed `waitForTimeout` sleeps are how the last audit produced three
//    false "element not found" failures. `expectVisible` waits on the
//    element instead.
//
// Errors are never swallowed: `captureErrors` accumulates BOTH `pageerror`
// and console errors plus failed responses, and `assertNoErrors` fails the
// test with the full list. A green render that logged a React hydration
// error is not green (Rule 9 — no silent failures).

import { expect, type Locator, type Page } from "@playwright/test";

/** The five screens, in spec order. `press g then N` is the shortcut (02 §9). */
export const SCREENS = [
  "Dashboard",
  "Students",
  "Attendance",
  "Fees & Payments",
  "Settings",
] as const;

export type ScreenName = (typeof SCREENS)[number];

/**
 * QA account credentials. Read from the environment first; the fallback pair
 * is the same one already committed in `a11y.spec.ts` and `stress.spec.ts`
 * (a shared QA account, never a personal secret). Values are never logged.
 */
export function qaCredentials(): { email: string; password: string } {
  const email = process.env.E2E_EMAIL || "hkdevloops@gmail.com";
  const password = process.env.E2E_PASSWORD || "hkdevs";
  if (!email || !password) {
    throw new Error(
      "QA credentials unavailable: set E2E_EMAIL and E2E_PASSWORD (apps/web/.env.local or the shell).",
    );
  }
  return { email, password };
}

/** The QA tenant's app PIN. Set through the 08 BR-SEC-02 setup gate. */
export const QA_PIN = "135790";

export interface ErrorSink {
  /** Every captured error, newest last. */
  errors: string[];
  /** Fails the test with the full list. Call once, at the end. */
  assertNoErrors(): void;
  /** Drops errors captured so far (e.g. around a step that is known-noisy). */
  clear(): void;
}

/**
 * Attaches console/page/network error capture. Returns a sink the spec can
 * assert against.
 *
 * `response` filtering ignores the 401 that a signed-out / cold session can
 * produce before the first navigation completes, but records every 4xx/5xx
 * after the app has settled — a 500 from a BFF route is exactly the class of
 * bug these audits exist to catch.
 */
export function captureErrors(page: Page): ErrorSink {
  const errors: string[] = [];
  let settled = false;

  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // React hydration noise is still a real defect; record it. The one
    // tolerated case is the dev-tools download-advice message, which carries
    // no product information.
    if (text.includes("Download the React DevTools")) return;
    errors.push(`console: ${text.slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (!settled) return;
    if (r.status() < 400) return;
    errors.push(`http ${r.status()}: ${r.url().slice(0, 200)}`);
  });

  return {
    errors,
    assertNoErrors() {
      expect(errors, "zero console/page/network errors").toEqual([]);
    },
    clear() {
      errors.length = 0;
    },
  };
}

/** Waits for a locator instead of sleeping a fixed amount (cold-isolate safe). */
export async function expectVisible(
  locator: Locator,
  label: string,
  timeout = 25_000,
): Promise<void> {
  await expect(locator, label).toBeVisible({ timeout });
}

/** Waits for an element to exist in the DOM (not necessarily visible). */
export async function expectAttached(
  locator: Locator,
  label: string,
  timeout = 25_000,
): Promise<void> {
  await expect(locator, label).toBeAttached({ timeout });
}

/**
 * Switches to one of the five screens through the app's own nav control.
 *
 * The click is dispatched inside the page (`element.click()`) so a control
 * that is scrolled out of view or overlapped by a sticky footer still
 * receives the event — Playwright's actionability checks time out on those,
 * which produced two false negatives in the prior settings audit.
 */
export async function gotoScreen(page: Page, name: ScreenName | RegExp): Promise<void> {
  const source = name instanceof RegExp ? name.source : name;
  const handle = await page.evaluateHandle((reSrc: string) => {
    const re = new RegExp(reSrc, "i");
    for (const nav of Array.from(
      document.querySelectorAll('nav[aria-label="Screens"]'),
    )) {
      for (const b of Array.from(nav.querySelectorAll("button"))) {
        const label = b.getAttribute("aria-label") || b.textContent || "";
        if (re.test(label) && b.offsetParent !== null) return b;
      }
    }
    return null;
  }, source);
  const el = handle.asElement();
  if (!el) {
    throw new Error(
      `No visible screen nav control matching /${source}/. The five-screen nav did not render — the shell failed before the screen switch.`,
    );
  }
  await el.evaluate((b: HTMLButtonElement) => b.click());
}

/**
 * Signs in and lands on the Dashboard.
 *
 * Handles the provisioning interstitial: an account whose tenant DB is still
 * being created is redirected to `/signup/provision` and must be allowed to
 * finish before the shell exists.
 */
export async function login(page: Page): Promise<void> {
  const { email, password } = qaCredentials();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const signIn = page.getByRole("button", { name: /^Sign In$/i });
  await signIn.waitFor({ state: "visible", timeout: 20_000 });
  await page.getByLabel(/Email/i).fill(email, { timeout: 10_000 });
  await page.getByLabel(/Password/i).fill(password, { timeout: 10_000 });
  await signIn.click();
  await page.waitForURL(/\/(dashboard|signup\/provision)/, { timeout: 30_000 });
  if (page.url().includes("signup/provision")) {
    await page.waitForURL("**/dashboard**", { timeout: 30_000 });
  }
  // The shell's screen switcher must exist before any screen can be driven.
  await expect(
    page.locator('nav[aria-label="Screens"]').first(),
    "five-screen nav present",
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Opens a Settings section and waits for its content.
 *
 * `heading` is the section's own first heading text — the nav labels and the
 * headings differ (nav "Attendance Rules" → heading "Attendance Window"), so
 * callers pass both. Callers must pass the REAL heading string; guessing one
 * is how the previous audit died three times in a row.
 */
export async function openSettingsSection(
  page: Page,
  navLabel: string,
  heading: RegExp,
): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(navLabel, "i") }).first();
  await btn.click({ timeout: 8_000 });
  await expectVisible(page.getByRole("heading", { name: heading }).first(), `${navLabel} loaded`);
}
