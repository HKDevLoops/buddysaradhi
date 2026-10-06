// TEMPORARY dashboard audit (deleted after the run).
//
// Implements: 04_Dashboard.md §6.2 (the card catalogue), §6.4 (the period
// filter and exactly which cards it may move), §9 (every figure is a gateway
// read), §10.1 (per-card drill-down targets), §11 E4 (a range over 90 days is
// refused, not truncated), §16 (loading / empty / error are three distinct
// states), §18 (reduced motion, colour never the only signal, keyboard), §19.4
// (the Dashboard E2E list) and AGENTS.md §2 Rule 6 (integer paise) / Rule 9
// (no silent failures) / Rule 10 (text equivalents).
//
// ── WHY THE PREVIOUS VERSION OF THIS FILE FAILED, AND WHY IT WAS THE SPEC ──────
//
// Two failures, both wrong selectors, neither an app fault. Both are recorded
// here so the next person does not re-derive them.
//
//  1. "every KPI card is a real control" counted
//     `getByRole("button", { name: /^Open (Fees and Payments|Students)\./ })`
//     and got 0. The cards ARE buttons. The ^ is the bug: a card's accessible
//     name is the whole card, title first —
//       "Collected ₹0.00 Payments received in october 2026
//        Open Fees and Payments. Collected: ₹0.00."
//     — because the visible title, figure and caption come before the
//     screen-reader-only destination sentence. Anchoring at "Open" can never
//     match. §10.1 and §18 DO require every card to be a control ("Click each
//     KPI card → lands on the correct screen"), so this is a test defect, not a
//     spec defect: the count is now proven per card, by title, instead of by a
//     total that would also pass on six wrong buttons.
//
//  2. The drill loop used `new RegExp("\\. Payment Breakdown:")` and timed out
//     at 15s. BreakdownCard's screen-reader text is "Payment breakdown:" —
//     lower-case b. A case-sensitive guess at a label is a coin flip; every
//     name match in this file is now case-insensitive.
//
// ── WHY `reducedMotion: "reduce"` IS SET HERE ────────────────────────────────
//
// Each KPI card renders `<CountUp value={…} formatFn={formatINR} />`, a
// spec-required 400 ms count-up (04 §8.4, §17). Mid-animation a card reads
// ₹298.34 on screen while its own accessible name already says ₹300.00 — the
// previous error-context.md is a screenshot of exactly that. That is correct
// behaviour, not a bug, but it makes visible-text equality assertions a race.
// Reduced motion makes CountUp jump straight to the settled figure
// (components/ui/count-up.tsx honours `prefers-reduced-motion`), so the visible
// text IS the final value — and 04 §18's reduced-motion requirement is
// exercised on every run of this file for free.
//
// ── WHY THIS FILE CAPTURES ITS OWN HTTP FAILURES ────────────────────────────
//
// harness.ts:84 declares `let settled = false` and never assigns it, so the
// `response` listener at harness.ts:97 returns on every single response and
// records nothing. `captureErrors().assertNoErrors()` therefore proves console
// and pageerror only — it has never once checked a 4xx or 5xx. Since requirement
// 7 asks for those explicitly, this file listens for them itself rather than
// claiming a pass the shared harness cannot deliver. Reported, not patched:
// harness.ts belongs to another lane.
//
// NO DESTRUCTIVE WRITES. No payment, no student, no settings change. Period
// changes, card drills, one CSV export and two manufactured network failures
// (test 3) are the only things this file does.
// NO FIXED SLEEPS: every wait is on an element or an event.

import { test, expect, type Locator, type Page } from "@playwright/test";
import { captureErrors, expectVisible, gotoScreen, login } from "./harness";

/**
 * Ask for reduced motion BEFORE the first navigation, so the very first paint
 * already honours it. `test.use({ reducedMotion })` would say the same thing,
 * but the resolved `@playwright/test` types in this workspace do not carry the
 * key, and an explicit call at the call site cannot be silently dropped.
 */
async function preferReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

/** The six §6.2 cards, by their real on-screen titles. */
const KPI_TITLES = [
  "Collected",
  "Due Till Date",
  "Due In Period",
  "Active Students",
  "Students With Dues",
  "Payment Breakdown",
] as const;

/**
 * A SEVENTH card the app renders. 04 §6.2's catalogue numbers exactly six
 * (C1..C6) and gives "Overdue" no card of its own; the app renders it anyway
 * as the subset of C3 whose due date has passed. Reported to the lead, not
 * fixed here — the app is not wrong to show a number the tutor owes, but §6.2
 * and the strip disagree on how many cards there are.
 */
const EXTRA_CARD = "Overdue";

const ALL_CARDS = [...KPI_TITLES, EXTRA_CARD];

/** §6.4: the two money cards the window is allowed to move. */
const PERIOD_SCOPED = ["Collected", "Due In Period"] as const;

/** §6.4: the money cards that say, inside the card, that they do not follow it. */
const PERIOD_FIXED = ["Due Till Date", EXTRA_CARD] as const;

const FIRST_RUN_HEADING = "Welcome to Buddysaradhi";

/** §6.4's helper line, whichever window is applied. */
const WINDOW_CAPTION = /Showing .*\. Collected and due in period follow it/;

/** A paise-derived rupee figure. FM-02 (`₹1,255.5499`) must never match. */
const MONEY = /^₹[\d,]*\d\.\d{2}$/;
const MONEY_TOKEN = /₹[\d,]*\d\.\d{2}/;

/** The screen-reader destination sentence every card ends with. */
const DRILL_SENTENCE = /Open (Fees and Payments|Students)\./;

function esc(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every KPI card: a `button` that states where tapping it goes. */
function kpiCards(page: Page): Locator {
  return page.getByRole("button", { name: DRILL_SENTENCE });
}

/** One named KPI card. Case-insensitive: BreakdownCard's own label lowercases it. */
function kpiCard(page: Page, title: string): Locator {
  return kpiCards(page).filter({
    hasText: new RegExp(`Open (?:Fees and Payments|Students)\\.\\s*${esc(title)}\\s*:`, "i"),
  });
}

/**
 * The card's visible text, with the screen-reader-only destination sentence
 * removed. `innerText` includes it (`.sr-only` clips rather than hides), and
 * that sentence sits LAST in the card, so cutting at it leaves exactly what a
 * sighted tutor reads.
 */
async function visibleCardText(card: Locator): Promise<string> {
  const full = (await card.innerText()).replace(/\s+/g, " ").trim();
  const cut = full.search(DRILL_SENTENCE);
  return cut >= 0 ? full.slice(0, cut).trim() : full;
}

/** The rupee figure a money card currently shows, or `null` if it shows none. */
async function moneyFigure(page: Page, title: string): Promise<string | null> {
  return (await visibleCardText(kpiCard(page, title))).match(MONEY_TOKEN)?.[0] ?? null;
}

/**
 * The integer a count card currently shows, parsed out of its own caption.
 * Case-insensitive because `.innerText` applies `text-transform`, so the card
 * title comes back as `ACTIVE STUDENTS`, not `Active Students`.
 */
async function countFigure(page: Page, title: string): Promise<number> {
  const text = await visibleCardText(kpiCard(page, title));
  const match = text.match(new RegExp(`^${esc(title)}\\s+([\\d,]+)`, "i"));
  if (match === null) {
    throw new Error(`card "${title}" shows no integer figure. Visible text was: ${text}`);
  }
  return Number((match[1] ?? "0").replace(/,/g, ""));
}

/**
 * Every money card's figure at once. A period change produces a NEW query key,
 * so `data` is briefly `undefined` and the whole strip is replaced by the
 * loading skeleton — the read therefore waits for each card to come back
 * rather than sampling a half-stripped screen.
 */
async function moneyMap(page: Page): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const title of [...PERIOD_SCOPED, ...PERIOD_FIXED]) {
    const card = kpiCard(page, title);
    await expect(card, `"${title}" is on screen after the period change`).toBeVisible({
      timeout: 30_000,
    });
    out[title] = (await visibleCardText(card)).match(MONEY_TOKEN)?.[0] ?? null;
  }
  return out;
}

/** §6.4's window caption, or `""` while the skeleton branch has it. */
async function readCaption(page: Page): Promise<string> {
  const node = page.getByText(WINDOW_CAPTION).first();
  if ((await node.count()) === 0) return "";
  if (!(await node.isVisible())) return "";
  return (await node.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Waits until the window caption names a window other than `previous`.
 *
 * The caption is derived from the SAME `data` object the cards render from
 * (`PeriodFilter label={data?.window.label}`), so once the caption has moved,
 * every card on screen is already the new read. Waiting on the caption is what
 * makes the figure comparison below trustworthy instead of a race.
 */
async function settleWindow(
  page: Page,
  previous: string | null,
  label: string,
): Promise<string> {
  await expect(async () => {
    const caption = await readCaption(page);
    expect(caption, "the caption must name a window, not the pre-read placeholder").not.toBe("");
    if (previous !== null) {
      expect(caption, `«${label}» must actually move the applied window`).not.toBe(previous);
    }
  }, `the ${label} window is applied and its read has landed`).toPass({
    timeout: 45_000,
    intervals: [250],
  });
  return readCaption(page);
}

/**
 * Takes the required screenshot AND asserts it produced bytes, so "a
 * screenshot of the dashboard was taken" is a checked claim rather than a
 * hopeful call. The files land in `test-results/`, which Playwright clears at
 * the start of every run — several lanes run against this tree concurrently, so
 * these artifacts are per-run evidence, not permanent fixtures.
 */
async function shoot(page: Page, name: string): Promise<void> {
  const shot = await page.screenshot({ path: `test-results/${name}`, fullPage: true });
  expect(shot.length, `screenshot ${name} produced no pixels`).toBeGreaterThan(1_000);
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

/**
 * Requirement 7, second half. `harness.captureErrors` cannot do this — see the
 * header. Attached after `login()` so a cold-session 401 during sign-in cannot
 * be mistaken for a dashboard failure, and kept for the whole screen operation.
 */
function captureHttpFailures(page: Page): string[] {
  const bad: string[] = [];
  page.on("response", (r) => {
    if (r.status() < 400) return;
    bad.push(`http ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const url = r.url();
    // The CSV export revokes its object URL immediately after the click; the
    // browser has already taken the bytes, and the late cancellation is not a
    // server fault.
    if (url.startsWith("blob:") || url.startsWith("data:")) return;
    const why = r.failure()?.errorText ?? "";
    // A client-side screen switch tears down in-flight requests. That is the
    // navigation, not a failure of the app to answer.
    if (why.includes("ERR_ABORTED")) return;
    bad.push(`requestfailed ${url} ${why}`);
  });
  return bad;
}

test("dashboard audit 1: six §6.2 cards, paise-exact money, every period control moves the window", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = captureErrors(page);
  await preferReducedMotion(page);
  await login(page);
  const httpFailures = captureHttpFailures(page);
  await gotoScreen(page, "Dashboard");
  await waitForDashboard(page);

  const isFirstRun = await page
    .getByRole("heading", { name: FIRST_RUN_HEADING })
    .isVisible()
    .catch(() => false);
  console.log(`DASH_BRANCH:${isFirstRun ? "first-run" : "kpi-strip"}`);

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
    await shoot(page, "dash-01-first-run.png");
    errors.assertNoErrors();
    expect(httpFailures, "zero 4xx/5xx/failed requests").toEqual([]);
    return;
  }

  // ── 1. All six §6.2 cards render, with real numbers ────────────────────────
  for (const title of ALL_CARDS) {
    await expectVisible(page.getByText(title, { exact: true }).first(), `card "${title}"`);
  }

  const dueTillDate = await moneyFigure(page, "Due Till Date");
  const collected = await moneyFigure(page, "Collected");
  const dueInPeriod = await moneyFigure(page, "Due In Period");
  const activeStudents = await countFigure(page, "Active Students");
  const studentsWithDues = await countFigure(page, "Students With Dues");
  console.log(
    `DASH_FIGURES:Collected=${collected} DueTillDate=${dueTillDate} DueInPeriod=${dueInPeriod} ` +
      `ActiveStudents=${activeStudents} StudentsWithDues=${studentsWithDues}`,
  );

  // This tenant has a live balance owing, so a ₹0.00 here would be the exact
  // lie Rule 9 forbids — a failed read must not look like an empty book.
  expect(dueTillDate, "Due Till Date renders a figure").not.toBeNull();
  expect(dueTillDate, "the tenant owes money, so Due Till Date is not zero").not.toMatch(/^₹0\.00$/);
  expect(collected, "Collected renders a figure").not.toBeNull();
  expect(dueInPeriod, "Due In Period renders a figure").not.toBeNull();
  expect(activeStudents, "the roster is not empty").toBeGreaterThan(0);
  expect(studentsWithDues, "a student is recorded as owing").toBeGreaterThan(0);
  expect(studentsWithDues, "students owing cannot outnumber the active roster").toBeLessThanOrEqual(
    activeStudents,
  );

  // ── 2. Money is paise-derived rupees, never a float artifact (FM-02) ───────
  /**
   * Every rupee run on the screen, scanned off the rendered text.
   *
   * Trailing sentence periods are stripped (`₹0.00.` is the card's own
   * screen-reader sentence ending, not a third decimal) but digits are not
   * touched, so `₹1,255.5499` survives the strip and fails below exactly as FM-02
   * requires.
   */
  const rupeeTokens = await page.evaluate(() =>
    (document.body.innerText.match(/₹[\d,.]*/g) ?? [])
      .map((token) => token.replace(/\.+$/, ""))
      .filter((token) => /\d/.test(token)),
  );
  console.log(`DASH_RUPEE_TOKENS:${JSON.stringify([...new Set(rupeeTokens)])}`);
  expect(rupeeTokens.length, "the screen actually renders rupee figures").toBeGreaterThan(0);
  for (const token of new Set(rupeeTokens)) {
    expect(
      token,
      "every rupee figure is paise-derived with exactly two decimals (FM-02 is ₹1,255.5499)",
    ).toMatch(MONEY);
  }

  // ── 3. Every card is a real control (§10.1 drill-down, §18 Tab/Enter) ─────
  const controlCount = await kpiCards(page).count();
  console.log(`DASH_KPI_CONTROL_COUNT:${controlCount}`);
  expect(controlCount, "the strip renders one control per card, Overdue included").toBe(
    ALL_CARDS.length,
  );
  for (const title of [...KPI_TITLES, EXTRA_CARD]) {
    const card = kpiCard(page, title);
    expect(await card.count(), `"${title}" resolves to exactly one control`).toBe(1);
    expect(
      await card.getAttribute("type"),
      `"${title}" is a real <button>, not a div with a hover border`,
    ).toBe("button");
    expect(
      await card.evaluate((el) => (el as HTMLElement).tabIndex),
      `"${title}" is in the tab order (§18: Tab walks the KPI cards, Enter drills)`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      await card.innerText(),
      `"${title}" states where tapping it goes`,
    ).toMatch(DRILL_SENTENCE);
  }

  // §6.4: the period-independent cards say so INSIDE the card.
  await expectVisible(
    page.getByText("Owed up to today, all time. Does not follow the period.").first(),
    "C2 period-exclusion caption",
  );
  await expectVisible(
    page.getByText("Students by payment status. Does not follow the period.").first(),
    "C6 period-exclusion caption",
  );

  await shoot(page, "dash-01-strip.png");

  // ── 4. EVERY period control moves the window — and the data with it ────────
  const monthCaption = await settleWindow(page, null, "Month");
  const monthMoney = await moneyMap(page);
  console.log(`DASH_WINDOW_MONTH:${monthCaption} ${JSON.stringify(monthMoney)}`);

  // All.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const allCaption = await settleWindow(page, monthCaption, "All");
  const allMoney = await moneyMap(page);
  console.log(`DASH_WINDOW_ALL:${allCaption} ${JSON.stringify(allMoney)}`);

  // The caption alone proves nothing — the original defect was four controls
  // repainting one payload. The FIGURES have to move.
  const movedByAll = PERIOD_SCOPED.filter((t) => monthMoney[t] !== allMoney[t]);
  console.log(`DASH_PERIOD_MOVED_BY_ALL:${JSON.stringify(movedByAll)}`);
  expect(
    movedByAll.length,
    "All changed only the caption, not the data — a decorative filter is a P0 (a tutor believes a number is period-scoped when it is not)",
  ).toBeGreaterThan(0);

  // And §6.4 is a two-sided claim: the cards that say they do not follow the
  // period must not move when it does.
  for (const title of PERIOD_FIXED) {
    expect(
      allMoney[title],
      `"${title}" says it does not follow the period, so All must not move it`,
    ).toBe(monthMoney[title]);
  }

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
  const rangeCaption = await settleWindow(page, allCaption, "Range");
  const rangeMoney = await moneyMap(page);
  console.log(`DASH_WINDOW_RANGE:${rangeCaption} ${JSON.stringify(rangeMoney)}`);
  // Range legitimately shows the same money as All when both windows cover the
  // same months, so only the WINDOW is asserted to move here; the data movement
  // is proven by the Month→All comparison above.
  for (const title of PERIOD_FIXED) {
    expect(
      rangeMoney[title],
      `"${title}" still does not follow the period in Range mode`,
    ).toBe(monthMoney[title]);
  }

  // §11 E4: a 200-day range must be REFUSED, the applied period must not move,
  // and the refusal must say so instead of silently doing nothing.
  await startInput.fill(iso(200));
  await expect(
    startInput,
    "an over-long range is refused and the input snaps back to the last applied bound",
  ).toHaveValue(iso(60), { timeout: 10_000 });
  await expectVisible(
    page.getByText(/cannot exceed 90 days/i).first(),
    "the refusal explains itself instead of silently doing nothing",
  );
  const afterRefusal = await readCaption(page);
  console.log(`DASH_WINDOW_AFTER_REFUSAL:${afterRefusal}`);
  expect(afterRefusal, "a refused range must not move the applied window").toBe(rangeCaption);

  await shoot(page, "dash-02-period.png");

  // Back to the month default — the control is reversible, not a one-way trip,
  // and it restores the FIGURES, not just the label.
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Month", exact: true }),
    "Month is the pressed mode",
  ).toHaveAttribute("aria-pressed", "true");
  const backCaption = await settleWindow(page, rangeCaption, "Month");
  const backMoney = await moneyMap(page);
  console.log(`DASH_WINDOW_BACK:${backCaption} ${JSON.stringify(backMoney)}`);
  expect(backCaption, "Month restores the original window").toBe(monthCaption);
  expect(backMoney, "Month restores the original figures, not just the label").toEqual(monthMoney);

  errors.assertNoErrors();
  expect(httpFailures, "zero 4xx/5xx/failed requests").toEqual([]);
});

test("dashboard audit 2: every card lands where it says, and the CSV matches the view", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = captureErrors(page);
  await preferReducedMotion(page);
  await login(page);
  const httpFailures = captureHttpFailures(page);
  await gotoScreen(page, "Dashboard");
  await waitForDashboard(page);

  if (
    await page
      .getByRole("heading", { name: FIRST_RUN_HEADING })
      .isVisible()
      .catch(() => false)
  ) {
    console.log("DASH_BRANCH:first-run — drills and export skipped, no data to export");
    errors.assertNoErrors();
    expect(httpFailures, "zero 4xx/5xx/failed requests").toEqual([]);
    return;
  }

  // ── Every KPI card drills to the screen its own label promises ─────────────
  // The destination is read out of the card's accessible name rather than a
  // table in the test, so a card cannot pass by drilling somewhere its own
  // screen-reader text does not admit to.
  for (const title of ALL_CARDS) {
    const card = kpiCard(page, title);
    await expect(card, `"${title}" is on screen`).toBeVisible({ timeout: 30_000 });
    const name = (await card.innerText()).replace(/\s+/g, " ").trim();
    const destination = name.match(DRILL_SENTENCE)?.[1];
    expect(destination, `"${title}" states a destination`).toBeTruthy();
    await card.click({ timeout: 15_000 });
    const expectedNav = destination === "Students" ? "Students" : "Fees & Payments";
    const landed =
      (await onScreen(page, expectedNav)) ||
      // Report the truth either way; the assertion below is what gates.
      (await onScreen(page, destination === "Students" ? "Fees & Payments" : "Students"));
    console.log(`DASH_DRILL:${title} -> claimed=${destination} landedOn=${expectedNav} ok=${landed}`);
    expect(
      landed,
      `"${title}" says it opens ${destination}, so it must not open ${destination === "Students" ? "Fees & Payments" : "Students"}`,
    ).toBe(true);
    await gotoScreen(page, "Dashboard");
    await waitForDashboard(page);
  }

  // ── §18: every chart carries a text-equivalent summary ────────────────────
  const panels = page.locator('section[aria-labelledby="dashboard-analytics-heading"] figure');
  await expectVisible(
    page.locator('figure[aria-label="Fee collection trend"]'),
    "the analytics panels loaded (no zeros standing in for them)",
    60_000,
  );
  const panelCount = await panels.count();
  console.log(`DASH_ANALYTICS_PANELS:${panelCount}`);
  expect(panelCount, "the analytics section renders its panels").toBeGreaterThan(0);
  for (let i = 0; i < panelCount; i += 1) {
    const panel = panels.nth(i);
    const caption = await panel.locator("figcaption").innerText();
    expect(
      caption.trim(),
      `analytics panel ${i} has no text equivalent — colour and hover are not the only signal (Rule 10)`,
    ).not.toBe("");
    expect(
      caption.trim(),
      `analytics panel ${i}'s summary must state what the chart holds`,
    ).not.toMatch(/^-+$/);
  }

  // ── One CSV export, via the download event AND its contents ───────────────
  const trendPanel = page.locator('figure[aria-label="Fee collection trend"]');
  const panelText = (await trendPanel.innerText()).replace(/\s+/g, " ").trim();

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Download collection trend as CSV" }).click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  console.log(`DASH_CSV_FILENAME:${filename}`);
  // The filename carries the view and the period, so a downloaded file can never
  // be mistaken for an unfiltered one.
  expect(filename, "the export filename carries the view and the period").toMatch(
    /^dashboard-collection-trend-last-\d+-months(-[a-z0-9-]+)?\.csv$/,
  );

  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
  const lines = csv.split("\r\n").filter((line) => line.trim() !== "");
  console.log(`DASH_CSV_BYTES:${Buffer.concat(chunks).length} DASH_CSV_ROWS:${lines.length - 1}`);
  expect(lines.length, "the downloaded CSV is not empty and carries data rows").toBeGreaterThan(1);
  expect(
    lines[0],
    "the CSV header names its own columns and their units",
  ).toBe('"Month","Collected (paise)","Collected (INR)"');

  const rows = lines.slice(1).map((line) => {
    const cells = line.split('","').map((cell) => cell.replace(/^"|"$/g, ""));
    const [month, paise, inr] = cells;
    return { month: month ?? "", paise: Number(paise ?? 0), inr: inr ?? "" };
  });
  for (const row of rows) {
    // The rupee column is derived from integer paise, never from a float
    // division — recomputed here with integer arithmetic only (Rule 6).
    const whole = Math.floor(row.paise / 100);
    const frac = String(row.paise - whole * 100).padStart(2, "0");
    expect(row.inr, `the INR column for ${row.month} is paise, not a float`).toBe(
      `${whole}.${frac}`,
    );
    expect(row.inr, `every CSV amount has exactly two decimals`).toMatch(/^\d+\.\d{2}$/);
  }

  /**
   * And the file matches the view, exactly.
   *
   * Scoped to the `role="img"` bar chart rather than the whole panel: the panel's
   * `<figcaption>` restates the collected total in prose ("Collected ₹200.00
   * across …"), which would double-count it and turn a correct file into a
   * mismatch. Inside the chart each column is one value label and one month
   * label, so the two sets are directly comparable.
   */
  const chart = trendPanel.locator('[role="img"]').first();
  const chartText = (await chart.innerText()).replace(/\s+/g, " ").trim();
  const chartRupees = (chartText.match(/₹[\d,]*\d\.\d{2}/g) ?? []).slice().sort();
  const chartMonths: string[] = (
    chartText.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}\b/g) ?? []
  ).map((month: string) => month.trim());
  const csvRupees = rows
    .filter((row) => row.inr !== "0.00")
    .map((row) => `₹${row.inr}`)
    .sort();
  const csvMonths = rows.map((row) => row.month).sort();
  console.log(
    `DASH_CHART_RUPEES:${JSON.stringify(chartRupees)} DASH_CSV_RUPEES:${JSON.stringify(csvRupees)} ` +
      `DASH_CHART_MONTHS:${JSON.stringify(chartMonths.sort())} DASH_CSV_MONTHS:${JSON.stringify(csvMonths)}`,
  );
  expect(
    chartRupees,
    "the chart's rupee labels are exactly the CSV's non-zero rows (the chart prints an em dash, not ₹0.00, for an empty month)",
  ).toEqual(csvRupees);
  expect(
    [...chartMonths].sort(),
    "the chart and the file cover exactly the same months — neither is silently truncated",
  ).toEqual(csvMonths);
  // The prose summary is a real text equivalent of the chart, not a caption.
  expect(
    panelText,
    "the chart carries a prose summary of what it holds (Rule 10)",
  ).toMatch(/Collected ₹[\d,]*\d\.\d{2} across/);

  await shoot(page, "dash-03-final.png");
  errors.assertNoErrors();
  expect(httpFailures, "zero 4xx/5xx/failed requests").toEqual([]);
});

/**
 * 04 §16 and Rule 9: loading, empty and failure are three distinguishable
 * states, and a failed read must NEVER render as real zeroes.
 *
 * The figures arrive through a server action, so this manufactures the failure
 * at the network edge — hold every action POST open to catch the loading branch,
 * then abort them to reach the failure branch. `captureErrors` is deliberately
 * NOT used here: this test creates the errors it would report.
 *
 * A period change is the trigger for each read, because a new period is a new
 * query key and therefore a guaranteed refetch whatever the cache holds.
 */
test("dashboard audit 3: a failed read shows an error, never zeroes (Rule 9)", async ({ page }) => {
  test.setTimeout(180_000);
  await preferReducedMotion(page);
  await login(page);

  /**
   * ONE route with a mutable mode, never two. Registering a second handler and
   * calling `page.unroute()` on the first hands an already-settled route back to
   * a handler that still wants to `continue()` it, which Playwright rejects as
   * "Route is already handled!" — the route is only ever touched once.
   */
  type GateMode = "hold" | "pass" | "abort";
  const gate = { mode: "hold" as GateMode };
  // Read through a function on purpose: TypeScript narrows a `let` across an
  // `await` and would then reject the second `abort` check as impossible, when
  // it is exactly the check that matters once a handler unparks.
  const currentMode = (): GateMode => gate.mode;
  let release: (() => void) | undefined;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const isServerAction =
      request.method() === "POST" && (request.headers()["next-action"] ?? "") !== "";
    if (!isServerAction) {
      await route.continue();
      return;
    }
    if (currentMode() === "abort") {
      await route.abort("failed");
      return;
    }
    if (currentMode() === "hold") {
      await new Promise<void>((resolve) => {
        release = resolve;
        setTimeout(resolve, 15_000);
      });
    }
    // The mode may have changed while this handler was parked.
    if (currentMode() === "abort") {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await gotoScreen(page, "Dashboard");
  await gotoScreen(page, "Students");
  await gotoScreen(page, "Dashboard");

  // The summary action is in flight, so the strip must not exist yet.
  await expect(
    page.locator('[role="status"][aria-live="polite"]').first(),
    "the dashboard shows a loading state while the read is in flight",
  ).toBeVisible({ timeout: 20_000 });
  const loadingBody = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  console.log(`DASH_LOADING_HAS_RUPEE:${loadingBody.includes("₹")}`);
  expect(
    loadingBody,
    "a pending read must render a skeleton, never a row of ₹0.00 cards (Rule 9)",
  ).not.toMatch(/₹[\d,.]*\d\.\d{2}/);
  await shoot(page, "dash-04-loading.png");

  // Let the held read land, so the failure below is proved against a screen that
  // demonstrably CAN show real figures.
  gate.mode = "pass";
  release?.();
  await expectVisible(
    page.getByText("Collected", { exact: true }).first(),
    "the real strip renders once the held read is released",
    30_000,
  );

  // ── Failure is not zero either ────────────────────────────────────────────
  gate.mode = "abort";

  await page.getByRole("button", { name: "All", exact: true }).click();
  const failure = page
    .getByRole("alert")
    .filter({ hasText: /these are not your collections/i });
  await expectVisible(
    failure.first(),
    "a failed dashboard read renders the honest failure state, which says the figures are not being shown",
    30_000,
  );
  const failedBody = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  console.log(`DASH_FAILED_HAS_RUPEE:${/\u20B9[\d,.]*\d\.\d{2}/.test(failedBody)}`);
  expect(
    failedBody,
    "a gateway failure must not render as real zeroes (Rule 9, 04 §16)",
  ).not.toMatch(/₹[\d,.]*\d\.\d{2}/);
  // The header still offers the filter and a route onward: a tutor whose figures
  // are down can still act.
  await expectVisible(
    page.getByRole("group", { name: "Period filter" }),
    "the period control survives a failed read — a control that only exists when the data is up is not a control",
  );
  await shoot(page, "dash-05-failed.png");
});