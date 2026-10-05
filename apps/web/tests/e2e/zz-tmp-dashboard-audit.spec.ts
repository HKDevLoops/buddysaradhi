// TEMPORARY dashboard audit (deleted after the run).
//
// Implements: 04_Dashboard.md §19.4 (the Dashboard E2E list) on the shared
// harness. Two tests, because the config allows 60s and a cold gateway isolate
// spends most of that on login alone — one long test would have failed on the
// clock while every assertion inside it was passing.
//
// TEST 1 — the screen renders real data and every period control operates:
//   the six §6.2 KPI cards (or the §11 E1 first-run composition, detected and
//   asserted explicitly rather than assumed), the §6.4 period-exclusion captions,
//   all six cards being real controls, a screenshot, Month / Range / All each
//   moving the window caption, and §11 E4 refusing an over-long range without
//   moving the applied period.
//
// TEST 2 — every KPI card drills to the screen that owns the detail (§10.1,
// P3 ≤ 2 taps), one CSV download verified through the download event and its
// filename, and zero console / pageerror / network errors for the whole run.
//
// NO FIXED SLEEPS anywhere: every wait is on an element or an event, because a
// cold gateway isolate takes seconds and `waitForTimeout` is how the previous
// per-screen audits produced false "element not found" failures.
//
// NO DESTRUCTIVE WRITES. No payment, no student, no settings change. Period
// changes and card drills are reads.

import { test, expect, type Page } from "@playwright/test";
import { captureErrors, expectVisible, gotoScreen, login } from "./harness";

/** The six §6.2 cards, by their visible titles. */
const KPI_TITLES = [
  "Collected",
  "Due Till Date",
  "Due In Period",
  "Active Students",
  "Students With Dues",
  "Payment Breakdown",
] as const;

const FIRST_RUN_HEADING = "Welcome to Buddysaradhi";

/** §6.4's helper line, whichever window is applied. */
const WINDOW_CAPTION = /Showing .*\. Collected and due in period follow it/;

/** Waits for the strip (or the first-run composition) to settle. */
async function waitForDashboard(page: Page): Promise<void> {
  await expectVisible(
    page.getByRole("heading", { name: "Dashboard" }).first(),
    "dashboard heading",
  );
  await expect(
    page.getByRole("heading", { name: FIRST_RUN_HEADING }).or(
      page.getByText("Collected", { exact: true }).first(),
    ),
    "either the KPI strip or the first-run composition is present",
  ).toBeVisible({ timeout: 30_000 });
}

/** True when the active screen is the one named. Read off the shell's own nav. */
async function onScreen(page: Page, label: "Fees & Payments" | "Students"): Promise<boolean> {
  return page
    .locator('nav[aria-label="Screens"] button[aria-current="true"]')
    .filter({ hasText: label })
    .first()
    .isVisible()
    .catch(() => false);
}

/** Returns the window caption text, so a change of period can be asserted. */
async function windowCaption(page: Page): Promise<string> {
  const caption = page.getByText(WINDOW_CAPTION).first();
  return (await caption.innerText()).replace(/\s+/g, " ").trim();
}

test("dashboard audit 1: six KPI cards, and every period control moves the window", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = captureErrors(page);
  await login(page);
  await gotoScreen(page, "Dashboard");
  await waitForDashboard(page);

  const isFirstRun = await page
    .getByRole("heading", { name: FIRST_RUN_HEADING })
    .isVisible()
    .catch(() => false);
  console.log(`DASHBOARD_BRANCH:${isFirstRun ? "first-run" : "kpi-strip"}`);

  if (isFirstRun) {
    // §11 E1 / P15: a designed welcome, never a grid of zeroes, and the CTA is
    // one tap. The period control is still reachable — a filter that only exists
    // when the data happens to be up is not a control.
    expect(await page.getByText("Collected", { exact: true }).count()).toBe(0);
    await expectVisible(
      page.getByRole("button", { name: /Add Student/ }).first(),
      "first-run Add Student CTA",
    );
    await expectVisible(
      page.getByRole("group", { name: "Period filter" }),
      "period control on the first-run branch",
    );
    await page.screenshot({ path: "test-results/dash-01-first-run.png", fullPage: true });
    errors.assertNoErrors();
    return;
  }

  // ── The six §6.2 cards, including C3 and C6 which had no element at all ───
  for (const title of KPI_TITLES) {
    await expectVisible(page.getByText(title, { exact: true }).first(), `KPI card "${title}"`);
  }
  // §6.4: the period-independent groups say so INSIDE the card, so a tutor never
  // wonders why a number refused to move.
  await expectVisible(
    page.getByText("Owed up to today, all time. Does not follow the period.").first(),
    "C2 period-exclusion caption",
  );
  await expectVisible(
    page.getByText("Students by payment status. Does not follow the period.").first(),
    "C6 period-exclusion caption",
  );
  // §18: every card is a control with a stated destination, not a dead figure.
  const drillable = page.getByRole("button", { name: /^Open (Fees and Payments|Students)\./ });
  const drillCount = await drillable.count();
  console.log(`DASHBOARD_DRILLABLE_CARDS:${drillCount}`);
  expect(drillCount, "every KPI card is a real control").toBeGreaterThanOrEqual(6);

  await page.screenshot({ path: "test-results/dash-01-strip.png", fullPage: true });

  // ── EVERY period control ──────────────────────────────────────────────────
  const monthCaption = await windowCaption(page);
  console.log(`DASHBOARD_WINDOW_MONTH:${monthCaption}`);
  expect(
    monthCaption,
    "the month caption is not the placeholder shown before the read lands",
  ).not.toMatch(/^Showing\s*\./);

  // All.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const allCaption = await windowCaption(page);
  console.log(`DASHBOARD_WINDOW_ALL:${allCaption}`);
  expect(allCaption, "All moves the window").not.toBe(monthCaption);

  // Range, seeded with a usable window, then both bounds driven.
  await page.getByRole("button", { name: "Range", exact: true }).click();
  const startInput = page.getByLabel("Period start day");
  const endInput = page.getByLabel("Period end day");
  await expectVisible(startInput, "range start input");
  await expectVisible(endInput, "range end input");

  const today = new Date();
  const iso = (offsetDays: number) =>
    new Date(today.getTime() - offsetDays * 86_400_000).toISOString().slice(0, 10);
  await startInput.fill(iso(60));
  await endInput.fill(iso(0));
  const rangeCaption = await windowCaption(page);
  console.log(`DASHBOARD_WINDOW_RANGE:${rangeCaption}`);
  expect(rangeCaption, "Range moves the window").not.toBe(allCaption);

  // §11 E4: a 200-day range must be REFUSED, and the applied period must not
  // move — the input snaps back to the last value that was actually read.
  await startInput.fill(iso(200));
  await expect(startInput, "over-long range is refused and the applied period holds").toHaveValue(
    iso(60),
    { timeout: 10_000 },
  );
  await expectVisible(
    page.getByText(/cannot exceed 90 days/i),
    "the refusal explains itself instead of silently doing nothing",
  );
  console.log(`DASHBOARD_WINDOW_AFTER_REFUSAL:${await windowCaption(page)}`);

  await page.screenshot({ path: "test-results/dash-02-period.png", fullPage: true });

  // Back to the month default, and confirm the caption returns — the control is
  // reversible, not a one-way trip.
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Month", exact: true }),
    "Month is the pressed mode",
  ).toHaveAttribute("aria-pressed", "true");
  expect(await windowCaption(page), "Month restores the original window").toBe(monthCaption);

  errors.assertNoErrors();
});

test("dashboard audit 2: every card drills to its owner, and one CSV exports", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = captureErrors(page);
  await login(page);
  await gotoScreen(page, "Dashboard");
  await waitForDashboard(page);

  if (await page.getByRole("heading", { name: FIRST_RUN_HEADING }).isVisible().catch(() => false)) {
    console.log("DASHBOARD_BRANCH:first-run — drills and export skipped, no data to export");
    errors.assertNoErrors();
    return;
  }

  // ── Every KPI card drills (read-only: switch screen, switch back) ─────────
  for (const title of KPI_TITLES) {
    const card = page.getByRole("button", { name: new RegExp(`\\. ${title}:`) }).first();
    await card.click({ timeout: 15_000 });
    const landedFees = await onScreen(page, "Fees & Payments");
    const landedStudents = await onScreen(page, "Students");
    const landed = landedFees || landedStudents;
    console.log(`DASHBOARD_DRILL:${title} -> landed=${landed}`);
    expect(landed, `"${title}" lands on a screen that owns the detail`).toBe(true);
    await gotoScreen(page, "Dashboard");
    await waitForDashboard(page);
  }

  // ── One CSV download, verified by the download event and its filename ─────
  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Download collection trend as CSV" }).click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  console.log(`DASHBOARD_CSV_FILENAME:${filename}`);
  // The filename carries the view and the period, so a downloaded file can never
  // be mistaken for an unfiltered one.
  expect(filename, "the export filename carries the view and the period").toMatch(
    /^dashboard-collection-trend-last-\d+-months(-[a-z0-9-]+)?\.csv$/,
  );
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += (chunk as Buffer).length;
  }
  console.log(`DASHBOARD_CSV_BYTES:${bytes}`);
  expect(bytes, "the downloaded CSV is not empty").toBeGreaterThan(0);

  await page.screenshot({ path: "test-results/dash-03-final.png", fullPage: true });
  errors.assertNoErrors();
});
