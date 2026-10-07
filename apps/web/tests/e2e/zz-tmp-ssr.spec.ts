// Verifies the SSR migration (TABS-HARDEN-01 phases 0+1) in a REAL browser, which
// is the only way to catch three classes of defect no unit test sees:
//   1. a route that server-renders nothing (the HTML has no screen content);
//   2. a hydration mismatch, which the server prints and the page only feels;
//   3. screen switching that no longer navigates, so the nav highlight, the URL
//      and the rendered screen can silently disagree.
//
// It also asserts the thing Rule 4 exists to protect: there are FIVE screens, and
// `aria-current="page"` — which is the only honest value now that they are pages.
import { test, expect, type Page } from "@playwright/test";
import { login, gotoScreen, expectVisible } from "./harness";

const ROUTES = [
  { path: "/dashboard", heading: /dashboard/i },
  { path: "/students", heading: /students/i },
  { path: "/attendance", heading: /attendance/i },
  { path: "/fees", heading: /fees/i },
  { path: "/settings", heading: /settings/i },
] as const;

async function serverHtmlHasScreen(page: Page, path: string, heading: RegExp): Promise<boolean> {
  // Fetch the route as a plain document (no JS) — what a crawler, a slow link or
  // a screen reader gets. If the screen's own content is absent here, the route is
  // NOT server-rendered no matter what the client ends up painting.
  const res = await page.request.get(path);
  if (!res.ok()) return false;
  const html = await res.text();
  // Strip the script payloads; the heading must be in real markup, not in RSC
  // props that only become DOM after hydration.
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  return heading.test(withoutScripts) && /<h1/i.test(withoutScripts);
}

test("ssr 1: all five routes server-render their own screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await login(page);

  const verdicts: string[] = [];
  for (const route of ROUTES) {
    const ssr = await serverHtmlHasScreen(page, route.path, route.heading);
    verdicts.push(`${route.path} server-rendered=${ssr}`);
    expect(ssr, `${route.path} must server-render its screen's own markup`).toBe(true);
  }
  console.log("SSR VERDICTS:\n" + verdicts.join("\n"));
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "(none)");
  expect(errors, "no console/page errors during SSR checks").toEqual([]);
});

test("ssr 2: direct URL entry lands on that screen with the right nav state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await login(page);

  for (const route of ROUTES) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expectVisible(page.getByRole("heading", { name: route.heading }).first(), `${route.path} heading`);
    // `aria-current="page"` is the honest value for a control that points at the
    // current PAGE. It said "true" for years because each screen was NOT a page
    // and "page" would have been a false claim to a screen reader.
    //
    // The count is TWO, not one: the sidebar nav and the mobile bottom nav both
    // render the five controls (they are the same controls at different
    // viewports), and BOTH must report the current screen. An app that marks
    // only one of them is telling a screen-reader user on that viewport that no
    // screen is current at all.
    const current = page.locator('nav[aria-label="Screens"] [aria-current="page"]');
    await expect(
      current,
      `${route.path}: both screen navs mark the current screen`,
    ).toHaveCount(2);
    const labels = await current.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label") ?? e.textContent ?? ""),
    );
    console.log(`${route.path} -> nav current: ${JSON.stringify(labels)}`);
    // Every nav agrees, and it names THIS screen rather than some other one.
    const named = route.heading.source.replace(/[()]/g, "");
    expect(
      labels.every((l) => l.toLowerCase().includes(named.toLowerCase())),
      `${route.path}: both navs name the screen they are on, got ${JSON.stringify(labels)}`,
    ).toBe(true);
  }

  console.log("ERRORS:", errors.length ? errors.join(" | ") : "(none)");
  expect(errors, "no console/page errors across all five routes").toEqual([]);
});

test("ssr 3: nav switching, g-then-N and Back all move between screens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await login(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expectVisible(page.getByRole("heading", { name: /dashboard/i }).first(), "dashboard");

  // Nav click navigates.
  await gotoScreen(page, "Students");
  await page.waitForURL("**/students", { timeout: 15_000 });
  console.log("nav click -> ", page.url());
  await expectVisible(page.getByRole("heading", { name: /students/i }).first(), "students");

  // The g-then-N shortcut navigates too (02 §9 muscle memory).
  await page.keyboard.press("g");
  await page.keyboard.press("4");
  await page.waitForURL("**/fees", { timeout: 15_000 });
  console.log("g then 4 -> ", page.url());
  await expectVisible(page.getByRole("heading", { name: /fees/i }).first(), "fees");

  // Back returns to the previous screen — the thing a single-route app could
  // not do, and the concrete payoff of the route migration.
  await page.goBack();
  await page.waitForURL("**/students", { timeout: 15_000 });
  console.log("back -> ", page.url());
  await expectVisible(page.getByRole("heading", { name: /students/i }).first(), "students after back");

  console.log("ERRORS:", errors.length ? errors.join(" | ") : "(none)");
  expect(errors, "no console/page errors while switching screens").toEqual([]);
});

test("ssr 4: the root entry still reaches a tutor's dashboard", async ({ page }) => {
  await login(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  console.log("/ -> ", page.url());
  // `/` cannot know whether the visitor has a session; the proxy sends
  // signed-out visitors to /login, which bounces an authenticated tutor on.
  await page.waitForURL(/\/(dashboard|login)/, { timeout: 20_000 });
  if (page.url().includes("/login")) {
    await page.waitForURL("**/dashboard**", { timeout: 20_000 });
  }
  await expectVisible(page.getByRole("heading", { name: /dashboard/i }).first(), "dashboard via /");
  console.log("landed on ", page.url());
});