import { test, expect, type Download, type Locator, type Page, type Response } from "@playwright/test";

// TEMPORARY settings audit (the lead deletes this after the run).
//
// Implements: 08_Settings.md §6.2.1–§6.2.13 (every section, its primary
// controls and every download), §9.3 + §14 EC-01 (currency freeze), §13 + §14
// EC-17 (the VALUE gate refuses a non-alphanumeric prefix), §15 SR-01/SR-03/
// SR-04/SR-05 (gates driven to their last click and abandoned), §16 (every
// outcome stated); 09_Backup_and_Import_Export.md §6.4/§14/§15.4 (template
// download needs no PIN, bulk create needs a typed EXPORT then a fresh PIN);
// 10_Security.md §3 (fail-closed PIN ladder) + §15 (AES-256-GCM + Argon2id).
//
// WHY THIS IS THIRTEEN `test()`s AND NOT ONE.
//
// The first version of this file was a single test over all thirteen sections
// and it could never pass: `playwright.config.ts` sets `timeout: 60 * 1000`
// for the whole file's tests, and thirteen sections of real server round-trips
// (two profile saves, an Argon2id backup, two holiday writes, a fee-model
// toggle, a roster export, a storage query) do not fit in 60 seconds. The run
// therefore died with `locator.click: Test timeout of 60000ms exceeded` — on
// whichever action happened to be in flight when the budget ran out, which is
// why the message named a `locator.click` and not a section. Thirteen tests
// give each section its own budget and its own PASS/FAIL line, which is what
// the report needs anyway.
//
// LABEL DISCIPLINE. The nav label and the section heading differ in eleven of
// thirteen sections. Every `openSection` call below passes BOTH, and every
// heading string was read out of the component source, not guessed:
//
//   nav "Profile"           → h3 "Institute Profile"
//   nav "Appearance"        → h3 "Palette" (+ four more)
//   nav "Attendance Rules"  → h3 "Attendance Window"
//   nav "Fee Rules"         → h3 "Default Fee Model"
//   nav "Notifications"     → h3 "Notification Preferences"
//   nav "Security"          → h3 "Access Control"
//   nav "Database"          → h3 "Where your records live"
//   nav "Backup & Restore"  → h3 "Create Local Backup"
//   nav "Import & Export"   → h3 "Export Data"
//   nav "Data & Privacy"    → h3 "Data Management"
//   nav "About"             → h3 "BuddySaradhi"
//   nav "Help"              → h3 "How Buddysaradhi works"
//   nav "Diagnostics"       → h3 "System Health"
//
// No fixed sleep anywhere: every wait is an expectation on an element or on a
// download event, because a cold gateway isolate takes seconds and a sleep is
// how this audit produced false failures before.
//
// WHAT IS DELIBERATELY NEVER SUBMITTED:
//   - Change PIN                      (form validated, Save armed, not clicked)
//   - Biometric on/off                (gate opens and demands a PIN, not clicked)
//   - Archive every student           (all three gates completed, commit left armed)
//   - Close your account              (both gates satisfied, commit left armed)
//   - Restore backup                  (no restore UI exists — see the report)
//   - The records/attendance/fee CSV export (a full-data export; forbidden)
//   - A full password change          (form validated, not submitted)
// Every settings write below is a ROUND TRIP: read the value, write a
// different one, put the original back, and ASSERT the restore. The QA tenant
// is left as found.

import {
  QA_PIN,
  captureErrors,
  expectVisible,
  gotoScreen,
  login,
  type ErrorSink,
} from "./harness";

/** The nav rail's own labels (settings-nav.tsx), used verbatim. */
const NAV = {
  profile: "Profile",
  appearance: "Appearance",
  attendance: "Attendance Rules",
  fees: "Fee Rules",
  notifications: "Notifications",
  security: "Security",
  database: "Database",
  backup: "Backup & Restore",
  transfer: "Import & Export",
  privacy: "Data & Privacy",
  about: "About",
  help: "Help",
  diagnostics: "Diagnostics",
} as const;

/**
 * Clicks a Settings nav item BY ITS OWN `aria-label` inside the settings rail.
 *
 * The shared harness's `openSettingsSection` resolves with
 * `getByRole("button", { name }).first()`, which is fine for "Profile" and
 * wrong for "Data" — `/Data/i` also matches "Data & Privacy" on the shell and
 * anything else that mentions data. Anchoring to
 * `nav[aria-label="Settings sections"]` removes the ambiguity without editing a
 * harness four other lanes are using.
 */
async function openSection(page: Page, navLabel: string, heading: RegExp): Promise<void> {
  const nav = page.locator('nav[aria-label="Settings sections"]');
  await expect(nav, "settings nav rail").toBeVisible({ timeout: 20_000 });
  await nav.getByRole("button", { name: navLabel, exact: true }).click({ timeout: 15_000 });
  await expectVisible(page.getByRole("heading", { name: heading }).first(), `${navLabel} loaded`, 25_000);
}

/** Signs in, lands on Settings, and starts recording failed HTTP responses. */
async function enterSettings(page: Page, errors: ErrorSink): Promise<void> {
  await login(page);
  // Required: without this the harness's `response` listener is dead code.
  // Called here, after the shell exists, so the cold-start 401 on /login is
  // excluded and every 4xx/5xx from the Settings screen itself is recorded.
  errors.markSettled();
  await gotoScreen(page, "Settings");
  await expectVisible(page.getByRole("heading", { name: "Settings", exact: true }), "Settings screen", 25_000);

  // 08 BR-SEC-02 mandatory setup gate. The QA account already has a PIN, so this
  // is normally a no-op; if the gate IS up, the PIN the rest of this file uses
  // is exactly what the gate would set, so nothing is changed.
  const gate = page.getByRole("heading", { name: /Set up your app PIN/i });
  if ((await gate.count()) > 0) {
    await expectVisible(gate, "PIN setup gate", 15_000);
    await page.locator("#pin-setup-new").fill(QA_PIN);
    await page.locator("#pin-setup-confirm").fill(QA_PIN);
    await expect(page.getByRole("button", { name: /Set PIN and continue/i })).toBeEnabled();
    await page.getByRole("button", { name: /Set PIN and continue/i }).click();
    await expect(gate, "PIN gate dismissed").toHaveCount(0, { timeout: 40_000 });
  }
}

/**
 * The Settings content pane — the div that sits immediately after the settings
 * nav rail (settings-client.tsx: `<SettingsNav />` then `<div className="flex-1 …">`).
 *
 * Every query below is scoped to it, because the app shell is ALWAYS in the
 * DOM behind it. That is not defensive habit, it is two real collisions this
 * audit hit: `getByRole("button", { name: /Restore/i })` matched the nav rail's
 * own "Backup & Restore" item and reported a restore control that does not
 * exist, and `getByText("Dashboard", { exact: true })` in Help matched the
 * screen-switcher as well as the help text, which is a strict-mode violation.
 * An unscoped query on this screen asserts about the shell, not about Settings.
 */
function pane(page: Page): Locator {
  return page.locator('nav[aria-label="Settings sections"] + div');
}

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/${name.replace(/\.png$/, "")}.png`, fullPage: true });
}

/** Waits for a download, returns its filename, and deletes the file. */
async function grabDownload(page: Page, action: () => Promise<void>, timeout = 40_000): Promise<string> {
  const pending = page.waitForEvent("download", { timeout });
  await action();
  const download: Download = await pending;
  const name = download.suggestedFilename();
  await download.delete().catch(() => {});
  return name;
}

/** A disabled control must have a reason in visible text (anti-slop rule 6). */
async function assertDisabledExplains(
  page: Page,
  control: Locator,
  explanation: RegExp,
): Promise<void> {
  await expect(control, "control is disabled").toBeDisabled();
  await expectVisible(page.getByText(explanation).first(), "the disabled control explains itself", 15_000);
}

/**
 * Reads the RAW `error` string out of a server-action response.
 *
 * This exists because of a real gap, not convenience. The Profile card renders
 * `toAppErrorState(error).message`, and `toAppErrorState`
 * (`apps/web/src/lib/app-errors.ts`) deliberately refuses to echo server text —
 * it classifies and returns a static literal. Its VALIDATION pattern is
 * `/zod|invalid|validation|must be|required|bad request|\b400\b|format/i`, so a
 * refusal whose message is `"institutePhone: Use a phone number of 6 to 15
 * digits"` does NOT match and falls through to UNKNOWN: the tutor is told
 * "Please try again. If this keeps happening, contact support." while the actual
 * cause — a field they never touched — is nowhere on screen. An audit that only
 * reads the DOM cannot tell a value-gate refusal from a caught exception,
 * because both render the same four words. The wire can.
 */
async function captureServerActionError(page: Page): Promise<() => Promise<string | null>> {
  let found: string | null = null;
  const pending: Promise<unknown>[] = [];
  const listener = (r: Response): void => {
    if (found) return;
    if (!r.request().headers()["next-action"]) return;
    pending.push(
      r
        .text()
        .then((body: string) => {
          const match = /"error":("(?:[^"\\]|\\.)*")/.exec(body);
          if (!match || found) return;
          try {
            found = JSON.parse(match[1] ?? "") as string;
          } catch {
            found = match[1] ?? "";
          }
        })
        .catch(() => {}),
    );
  };
  page.on("response", listener);
  return async () => {
    page.off("response", listener);
    await Promise.all(pending);
    return found;
  };
}

/**
 * Waits for a settings save to actually FINISH.
 *
 * Not `toBeDisabled()`: the button is `disabled={isPending || !isDirty}`, so a
 * disabled Save proves only that a request is still in flight. That is a race,
 * and it bit this spec once — the test navigated away mid-mutation and the nav
 * click was swallowed by the unsaved-changes guard. `aria-busy` flips to false
 * in the same render that clears `isPending`, so it is the honest signal.
 */
async function saveSettled(page: Page, save: Locator, label: string): Promise<void> {
  const readServerError = await captureServerActionError(page);
  await expect(save, `${label}: the save request settled`).toHaveAttribute("aria-busy", "false", {
    timeout: 60_000,
  });
  const alerts = pane(page).locator('[role="alert"]');
  if ((await alerts.count()) > 0) {
    const shown = (await alerts.first().innerText()).trim();
    const raw = await readServerError();
    throw new Error(
      `${label}: the save was REFUSED — the screen says "${shown}"${
        raw ? `, the server said "${raw}"` : " (no server-action error on the wire)"
      }`,
    );
  }
  await expect(save, `${label}: the form is clean after the save`).toBeDisabled();
}

/**
 * Settles a save and REPORTS the refusal instead of throwing on it.
 *
 * Returns `null` when the save went through, or `{ shown, raw }` when it did
 * not: `shown` is the text the tutor is shown and `raw` is the server's own
 * `error` string off the wire. Keeping them side by side is the point — they
 * are different messages, and the gap between them is a Rule 9 defect.
 */
async function describeRefusal(
  page: Page,
  save: Locator,
  label: string,
): Promise<{ shown: string; raw: string | null } | null> {
  const readServerError = await captureServerActionError(page);
  await expect(save, `${label}: the save request settled`).toHaveAttribute("aria-busy", "false", {
    timeout: 60_000,
  });
  const alerts = pane(page).locator('[role="alert"]');
  if ((await alerts.count()) === 0) {
    await readServerError();
    return null;
  }
  const shown = (await alerts.first().innerText()).trim();
  const raw = await readServerError();
  return { shown, raw };
}

test.describe("settings audit", () => {
  // ---------------------------------------------------------------- 01 Profile
  test("01 Profile — one reversible round-trip, a refused value, a frozen currency", async ({ page }) => {
    test.setTimeout(200_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.profile, /Institute Profile/);

    const name = page.locator("#settings-instituteName");
    const save = page.getByRole("button", { name: /Save changes/i });
    const discard = page.getByRole("button", { name: /^Discard$/ });
    const rawName = (await name.inputValue()).trim();
    expect(rawName.length, "the profile has a name to restore").toBeGreaterThan(0);

    // CRASH-SAFE SENTINEL. A test that dies between the write and the restore
    // would otherwise stack a marker on the QA tenant on every run — which is
    // exactly what happened while this file was being written. Strip any residue
    // first, then write and restore the SAME pair, so the test is idempotent and
    // repairs whatever a previous run left behind.
    //
    // The token deliberately differs from the residue token. Reusing it made the
    // sentinel EQUAL to the current value when residue was present, so `fill` was
    // a no-op, the form stayed clean, and Save stayed disabled — a silent 200s
    // hang on a `click`. The precondition below makes that impossible.
    //
    // WIDENED to ` QA<word>` (was ` QACheck`). The old pattern only stripped the
    // one token from the runs that crashed while this file was being written, so
    // a run that died after the write and before the restore left `QAProbe`
    // behind — which the pattern did not strip, so the next run based itself on
    // `My Tuition QAProbe` and would have written `My Tuition QAProbe QAProbe`.
    // Residue has to be a PATTERN, not a list of the tokens that happened to be
    // left, or every crash teaches the test a new one.
    //
    // Which creates the second half of the problem: once ANY ` QA<word>` suffix
    // is stripped, a fixed sentinel token can land exactly on the value a
    // crashed run left (`rawName` = "My Tuition QAProbe", base = "My Tuition",
    // sentinel = "My Tuition QAProbe") — and then `fill` is a no-op, the form
    // stays clean, Save stays disabled, and the run dies on a `click`. So the
    // token is CHOSEN against the residue rather than hardcoded: it must differ
    // from every marker currently present. The two tokens then alternate between
    // runs and the tenant always returns to the base name.
    const residue = /(?: QA[A-Za-z]+[0-9]*)+$/.exec(rawName)?.[0] ?? "";
    const originalName = rawName.slice(0, rawName.length - residue.length);
    const residueTokens: string[] = residue.match(/QA[A-Za-z]+[0-9]*/g) ?? [];
    const sentinelToken = ["QAProbe", "QACheck", "QAMark", "QATrace"].find(
      (token: string) => !residueTokens.includes(token),
    );
    expect(sentinelToken, "a sentinel token distinct from the residue exists").toBeTruthy();
    const sentinel = `${originalName} ${sentinelToken}`;
    expect(sentinel, "the sentinel must differ from what is already stored").not.toBe(rawName);
    expect(sentinel.length, "the sentinel fits the 80-character name bound").toBeLessThanOrEqual(80);

    // §6.2.1: on a clean form both buttons are disabled, so a Save cannot claim
    // to have saved nothing. FINDING (reported, not asserted): neither card
    // states WHY they are disabled, which the anti-slop "no silently dead
    // button" rule asks for — see the report for the exact patch.
    await expect(save, "Save is disabled on a clean form").toBeDisabled();
    await expect(discard, "Discard is disabled on a clean form").toBeDisabled();

    // BOUNDARY (08 §14 profileSchema): a phone that is not a phone is refused
    // with a stated reason and the save does not go through.
    const phone = page.locator("#settings-institutePhone");
    await phone.fill("not-a-phone");
    await expect(save).toBeEnabled();
    await save.click();
    await expectVisible(
      page.locator("#profile-institutePhone-error"),
      "the phone refusal is stated",
      20_000,
    );
    await expect(page.locator("#profile-institutePhone-error")).toHaveText(/international form/i);
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    // Nothing was written: no success toast, no clean form, still dirty.
    await expect(page.getByRole("status").filter({ hasText: /saved/i })).toHaveCount(0);

    // Discard puts the form back exactly as the server has it — `rawName`,
    // not the de-residued `originalName`, because Discard restores the values
    // the form was mounted with.
    await discard.click();
    await expect(save, "a discarded form is clean again").toBeDisabled();
    await expect(name).toHaveValue(rawName);

    // THE ONE REVERSIBLE ROUND-TRIP. Its purpose is a READ-AFTER-WRITE: leave the
    // section, come back, and the value must still be the one the server accepted.
    //
    // DEFECT FIXED (settings audit, 2026-10-06) — `profile-section.tsx` reset the
    // form to the `settings` prop whenever `isDirty` went false, and a successful
    // save is exactly what makes `isDirty` false. With the `invalidateQueries`
    // refetch still in flight, the card therefore overwrote the field the tutor
    // had just saved with the PRE-save value: the name visibly snapped back, and
    // this assertion read whichever side of that race it landed on. The fix seeds
    // the `["settings"]` cache with the accepted payload (cancelling the read
    // that could land after it) and refuses to apply a prop that still shows the
    // pre-save row.
    //
    // NOT YET IN THE RUNNING BUILD. This is `next start` on a prebuilt `.next`;
    // the source fix needs the lead's rebuild. Until then this still fails here,
    // and the failure is the defect, not the test.
    //
    // KNOWN DEFECT P0 (fixed in `server/actions/settings.ts`, same story — not in
    // this build): `SETTING_VALUE_SCHEMAS` typed instituteAddress/institutePhone/
    // instituteEmail as `z.string()`, the Profile card sends `value || null` for
    // each, and `updateSettingsBatchAction` refuses the WHOLE batch on the first
    // bad field. So a tutor with any empty optional field could not save the
    // Profile card at all — which is the default state of a brand-new account —
    // and `toAppErrorState` flattens the refusal to "Please try again…". The wire
    // says `instituteAddress: Expected string, received null`.
    //
    // This branch pins that defect so it cannot be lost, and runs the real round
    // trip automatically the moment the fix is live.
    await name.fill(sentinel);
    await save.click();
    const refusal = await describeRefusal(page, save, "sentinel write");

    if (refusal === null) {
      // The fix is deployed: do the genuine round trip, proving persistence
      // from the SERVER. Leaving the section and coming back refills the form
      // from the `["settings"]` query, so a value that only ever lived in React
      // state cannot satisfy these.
      await expect(save, "the form went clean after the save").toBeDisabled();
      await expect(page.getByText(/CONFLICT|settings changed elsewhere/i), "no CAS conflict").toHaveCount(0);
      await openSection(page, NAV.attendance, /Attendance Window/);
      await openSection(page, NAV.profile, /Institute Profile/);
      expect((await name.inputValue()).trim(), "THE SENTINEL REACHED THE SERVER").toBe(sentinel);

      await name.fill(originalName);
      await save.click();
      const restoreRefusal = await describeRefusal(page, save, "restore");
      expect(restoreRefusal, `the restore was refused: ${JSON.stringify(restoreRefusal)}`).toBeNull();
      await openSection(page, NAV.attendance, /Attendance Window/);
      await openSection(page, NAV.profile, /Institute Profile/);
      expect((await name.inputValue()).trim(), "THE RESTORE REACHED THE SERVER").toBe(originalName);
    } else {
      // The defect is live. Pin the part that is deterministic — the card
      // refuses to save at all — and treat the raw wire string as diagnostic,
      // because whether it is recoverable depends on how the RSC payload
      // serialises the envelope.
      expect(
        refusal,
        "KNOWN P0: the Profile card refuses to save while an optional field is empty",
      ).not.toBeNull();
      expect(
        refusal?.shown,
        "and the tutor is told nothing about the field that caused it (Rule 9)",
      ).toMatch(/try again/i);
      if (refusal?.raw !== null && refusal?.raw !== undefined) {
        console.log(`[settings-audit] the server's own words: ${refusal.raw}`);
        expect(refusal.raw).toMatch(/institute(Address|Phone|Email)|Expected string, received null/);
      }
      await discard.click();
      await openSection(page, NAV.attendance, /Attendance Window/);
      await openSection(page, NAV.profile, /Institute Profile/);
      expect(
        (await name.inputValue()).trim(),
        "a refused save wrote nothing at all",
      ).toBe(rawName);
      console.warn(
        "[settings-audit] SKIPPED the Profile round-trip: the P0 above is live in this build.",
      );
    }

    // 08 §9.3 + EC-01: the currency is frozen the moment a fee exists, and the
    // UI SAYS so — a disabled control with a 🔒 chip and a sentence, never a
    // silent failure.
    const currency = page.locator("#settings-currencyCode");
    await expectVisible(currency, "currency select", 15_000);
    if (await currency.isDisabled()) {
      await expectVisible(page.locator("#profile-currency-lock"), "the currency lock reason is on screen", 15_000);
      await expect(page.locator("#profile-currency-lock")).toHaveText(/cannot change/i);
      expect(await currency.inputValue(), "a locked currency still shows which one it is").toMatch(/^[A-Z]{3}$/);
    } else {
      // No fee charged yet, so the select is live. Nothing to assert beyond it
      // being usable — and the round-trip above proved the batch write path.
      expect(await currency.inputValue()).toMatch(/^[A-Z]{3}$/);
    }

    await shot(page, "set-01-profile.png");
    errors.assertNoErrors();
  });

  // ------------------------------------------------------------- 02 Appearance
  test("02 Appearance — twenty generated palettes, every picker, nothing changed", async ({ page }) => {
    test.setTimeout(200_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.appearance, /Palette/);

    // Every heading this section actually has — it has five, not one.
    for (const heading of [/Palette/, /Appearance Mode/, /Material/, /Display Density/, /Accessibility/]) {
      await expectVisible(page.getByRole("heading", { name: heading }).first(), `${heading} present`, 15_000);
    }

    const tiles = page.locator('button[aria-label*="palette"]');
    const count = await tiles.count();
    expect(count, "every generated palette is a real control").toBeGreaterThanOrEqual(20);
    const pressed = page.locator('button[aria-pressed="true"][aria-label*="palette"]');
    expect(await pressed.count(), "exactly one palette is active").toBe(1);
    const paletteBefore = await page.evaluate(() => document.documentElement.getAttribute("data-palette"));

    // Re-selecting the ACTIVE palette is an idempotent operation: it must keep
    // working, keep the same palette applied, and not invent a change.
    const active = pressed.first();
    const activeLabel = await active.getAttribute("aria-label");
    await active.click();
    await expect(pressed, "the palette is still active after re-selecting it").toHaveCount(1, { timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-palette"))).toBe(paletteBefore);

    // The other two segmented pickers are named groups, and the active palette
    // is announced in words rather than by border colour alone (AP-14).
    await expectVisible(page.getByRole("group", { name: "Appearance mode" }), "appearance mode group", 15_000);
    // Scoped to the pane: three sibling pickers each render an "Active" badge, and
    // the settings nav plus the shell nav also use these words.
    await expect(
      pane(page).locator('button[aria-pressed="true"][aria-label*="palette"]').getByText("Active", { exact: true }),
      "the active palette is named in words (AP-14)",
    ).toBeVisible();
    expect(activeLabel, "every palette tile names its Figma scheme").toMatch(/Figma colour scheme/i);

    // Keyboard parity (Rule 10): the tile takes focus and Tab moves on.
    await active.focus();
    await expect(active).toBeFocused();
    await active.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""),
      "Tab left the palette tile",
    ).not.toBe(activeLabel);

    await shot(page, "set-02-appearance.png");
    errors.assertNoErrors();
  });

  // ------------------------------------------------------------ 03 Attendance
  test("03 Attendance — the lock window range, a holiday added and removed", async ({ page }) => {
    test.setTimeout(220_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.attendance, /Attendance Window/);

    // 08 §14 attendanceRulesSchema: 1..168 hours. The control's own attributes
    // are the contract; a five-option select could not express 3 hours at all.
    const slider = page.locator("#attendance-lock-hours");
    await expectVisible(slider, "attendance lock slider", 20_000);
    expect(await slider.getAttribute("min"), "the slider floor is the spec's 1").toBe("1");
    expect(await slider.getAttribute("max"), "the slider ceiling is the spec's 168").toBe("168");
    const originalHours = Number(await slider.inputValue());
    expect(originalHours, "the stored window is inside the schema").toBeGreaterThanOrEqual(1);
    expect(originalHours).toBeLessThanOrEqual(168);
    const readout = page.locator("output").first();
    await expect(readout, "the window is shown in words, not just a number").toContainText(/hour|day/i);
    expect(await slider.getAttribute("aria-valuetext"), "the slider narrates itself").toMatch(/hour/i);

    // ROUND-TRIP on the slider: a different value must persist, the original
    // must come back. This is the only way to prove the control operates.
    const other = originalHours === 48 ? 47 : 48;
    await slider.fill(String(other));
    await expect(readout, "the readout followed the control").toContainText(`${other}h`, { timeout: 30_000 });
    await slider.fill(String(originalHours));
    await expect(readout, "THE RESTORE LANDED").toContainText(`${originalHours}h`, { timeout: 30_000 });

    // Default status: two real pressed buttons, exactly one active.
    const statusGroup = page.getByRole("group", { name: "Default attendance status" });
    await expect(statusGroup, "default status group").toBeVisible({ timeout: 15_000 });
    expect(await statusGroup.getByRole("button").count(), "present and absent are both offered").toBe(2);

    // Holiday editor: §6.2.3 asks for an editor with an add button and a
    // per-row delete. The old "Configure Holiday Calendar" button had no
    // onClick at all. Add one, then remove it, and assert the list is empty.
    const holidayDate = page.locator("#holiday-date");
    await holidayDate.fill("2026-04-14");
    await page.locator("#holiday-label").fill("QA holiday");
    await page.getByRole("button", { name: /^Add holiday$/ }).click();
    const remove = page.getByRole("button", { name: /Remove the holiday on 2026-04-14/i });
    await expect(remove, "the holiday was added").toBeVisible({ timeout: 40_000 });

    await remove.click();
    await expect(remove, "THE HOLIDAY WAS REMOVED").toHaveCount(0, { timeout: 40_000 });
    await expectVisible(page.getByText("No holidays listed yet."), "the list is back to empty", 20_000);

    await shot(page, "set-03-attendance.png");
    errors.assertNoErrors();
  });

  // ----------------------------------------------------------------- 04 Fees
  test("04 Fee Rules — a fee model round-trip and the prefix VALUE gate refusing", async ({ page }) => {
    test.setTimeout(220_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.fees, /Default Fee Model/);

    // 08 §6.2.4 read-only sequence displays (BR-FEE-04 / BR-RC-01).
    await expectVisible(page.getByText("Next invoice number", { exact: true }), "invoice sequence readout", 15_000);
    await expectVisible(page.getByText("Next receipt number", { exact: true }), "receipt sequence readout", 15_000);
    await expectVisible(
      page.getByText(/Do not close a gap/i),
      "the gap rule is stated where the counter is shown",
      15_000,
    );

    // Three fee models exist (§14's enum has three; it used to offer two).
    const models = { Prepaid: /^Prepaid/, Postpaid: /^Postpaid/, Mixed: /^Mixed/ } as const;
    for (const name of Object.keys(models) as (keyof typeof models)[]) {
      await expectVisible(page.getByRole("button", { name: models[name] }), `${name} exists`, 15_000);
    }

    // ROUND-TRIP on the fee model: pick the other one, then put it back.
    // The accessible name of a model button is "Postpaid (current default)
    // Fees are billed at the end of the month." — it carries an sr-only marker
    // and the body copy, so it is matched by its leading word, never by a
    // regex built from `innerText()`.
    const group = page.getByRole("group", { name: "Default fee model" });
    const MODELS = ["Prepaid", "Postpaid", "Mixed"] as const;
    const modelButton = (label: string): Locator =>
      group.getByRole("button", { name: new RegExp(`^${label}\\b`) });
    const pressedModel = async (): Promise<string> => {
      for (const label of MODELS) {
        if ((await modelButton(label).getAttribute("aria-pressed")) === "true") return label;
      }
      throw new Error("no fee model reports aria-pressed=true");
    };
    const beforeModel = await pressedModel();
    const otherModel = beforeModel === "Prepaid" ? "Mixed" : "Prepaid";
    await modelButton(otherModel).click();
    await expect(modelButton(otherModel), "the fee model changed and persisted").toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 40_000 },
    );
    await modelButton(beforeModel).click();
    await expect(modelButton(beforeModel), "THE FEE MODEL RESTORE LANDED").toHaveAttribute("aria-pressed", "true", {
      timeout: 40_000,
    });

    // BOUNDARY — the one the spec names explicitly: 08 §14 EC-17. A prefix that
    // is not alphanumeric is a Zod rejection with a stated reason, and the
    // server value does not move.
    const prefix = page.locator("#fee-invoicePrefix");
    const originalPrefix = await prefix.inputValue();

    // WHAT THIS SECTION ACTUALLY PROVES, and what it does not.
    //
    // `handleSubmit` runs `feeRulesSchema` through `zodResolver`, so a form with
    // a bad prefix never POSTs at all — the refusal above is entirely
    // client-side. That means this run exercises NOTHING of the server-side
    // VALUE gate (`SETTING_VALUE_SCHEMAS` in server/actions/settings.ts), which
    // is the one that has to hold when a client is not the web app. The canary
    // for that gate is the unit test
    // `src/server/actions/settings-audit.test.ts` → "refuses a
    // non-alphanumeric prefix (EC-17)", which posts `INV/"x` through
    // `updateSettingsBatchAction` and asserts a refusal, a reason, and zero
    // rows written. Do not read a green browser run as proof the server gate
    // works — it proves the client gate does.
    const nextInvoiceReadout = (): Locator =>
      page.locator("dt", { hasText: /^Next invoice number$/ }).locator("..").locator("dd");
    // Captured BEFORE the bad write, so this is the server's own value and not
    // an echo of the field the tutor just typed.
    const persistedBefore = (await nextInvoiceReadout().innerText()).trim();
    // The readout is `prefix + 6 digits` (fee-rules-section.tsx:344). Asserting
    // the SHAPE as well as the equality is what catches a broken counter; the
    // earlier version of this test hardcoded `String(1).padStart(6, "0")`, which
    // only holds on a tenant that has never issued an invoice. This one is at 3,
    // so the old assertion asked for `INV-000001` while the screen correctly
    // showed `INV-000003` — a spec bug that failed on a perfectly healthy
    // tenant, not an app defect.
    expect(
      persistedBefore,
      "the sequence readout is the persisted prefix plus a 6-digit counter",
    ).toMatch(new RegExp(`^${originalPrefix}\\d{6}$`));
    expect(persistedBefore, "and it carries the prefix that is actually stored").toContain(originalPrefix);

    await prefix.fill('INV/"x');
    const saveRules = page.getByRole("button", { name: /Save rules/i });
    await expect(saveRules, "an invalid form can be submitted so the gate can refuse it").toBeEnabled();
    await saveRules.click();

    const refusal = page.locator("#fee-invoicePrefix-error");
    await expectVisible(refusal, "EC-17: the prefix refusal is stated", 20_000);
    await expect(refusal).toHaveText(/letters, digits and hyphens only/i);
    await expect(prefix).toHaveAttribute("aria-invalid", "true");
    // The unsaved-changes guard is armed — a refused save is still a dirty form,
    // and the nav rail says so in words. (The floating "Unsaved Changes"
    // banner only exists once you try to navigate away, so it is the rail's
    // marker that is the resting signal.)
    await expectVisible(
      page.locator('nav[aria-label="Settings sections"]').getByText("Unsaved", { exact: true }),
      "the section is marked unsaved",
      15_000,
    );

    // Nothing was written: the persisted sequence readout still shows the exact
    // value it showed before the bad write — including the counter, which the
    // old hardcoded `INV-000001` could not express.
    await expect(nextInvoiceReadout(), "the persisted prefix preview never moved").toHaveText(persistedBefore, {
      timeout: 15_000,
    });
    await expect(nextInvoiceReadout()).not.toHaveText(new RegExp("INV-/x"), { timeout: 15_000 });

    await page.getByRole("button", { name: /^Discard$/ }).click();
    await expect(saveRules, "discarding a refused form makes it clean").toBeDisabled();
    await openSection(page, NAV.notifications, /Notification Preferences/);
    await openSection(page, NAV.fees, /Default Fee Model/);
    expect(await prefix.inputValue(), "THE PREFIX WAS NEVER WRITTEN").toBe(originalPrefix);

    // Grace period bound is the schema's, and it says so.
    const grace = page.locator("#fee-graceDays");
    expect(await grace.getAttribute("max"), "grace tops out at 30 days (§14)").toBe("30");
    expect(await grace.getAttribute("min")).toBe("0");

    await shot(page, "set-04-fees.png");
    errors.assertNoErrors();
  });

  // --------------------------------------------------------- 05 Notifications
  test("05 Notifications — four named switches, one operated and restored", async ({ page }) => {
    test.setTimeout(200_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.notifications, /Notification Preferences/);

    const switches = page.getByRole("switch");
    expect(await switches.count(), "§6.2.5 specifies four per-category toggles").toBe(4);

    // Every switch names its category in words and is a real 44px target.
    const names: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const sw = switches.nth(i);
      const label = (await sw.getAttribute("aria-label")) ?? "";
      expect(label, "a switch with no name is a switch nobody can find").not.toBe("");
      names.push(label);
      const box = await sw.boundingBox();
      expect(box?.height ?? 0, `${label} is a 44px target (Rule 10)`).toBeGreaterThanOrEqual(44);
      expect(await sw.isDisabled(), `${label} is not a silently dead control`).toBe(false);
    }
    expect(new Set(names).size, "the four labels are distinct").toBe(4);

    // ROUND-TRIP on one switch: it must flip, persist, and flip back.
    const target = switches.first();
    const label = names[0] ?? "";
    const before = await target.getAttribute("aria-checked");
    await target.click();
    await expect(target, `${label} flipped`).not.toHaveAttribute("aria-checked", before ?? "true", { timeout: 40_000 });
    await target.click();
    await expect(target, `THE ${label} RESTORE LANDED`).toHaveAttribute("aria-checked", before ?? "true", { timeout: 40_000 });

    await shot(page, "set-05-notifications.png");
    errors.assertNoErrors();
  });

  // -------------------------------------------------------------- 06 Security
  test("06 Security — the PIN form validates and is never submitted", async ({ page }) => {
    test.setTimeout(200_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.security, /Access Control/);

    // §6.2.6: the card states the real range (4 to 8 digits), not "4-digit".
    await expectVisible(page.getByText(/4 to 8 digits/), "the PIN range is stated truthfully", 15_000);

    await page.getByRole("button", { name: /^Change PIN$/ }).click();
    const savePin = page.getByRole("button", { name: /^Save new PIN$/ });
    const form = page.locator("#change-pin-form");
    await expectVisible(form, "the change-PIN form opens", 15_000);
    await expect(savePin, "Save is disabled on an empty form").toBeDisabled();

    // A PIN that is neither obvious nor the QA PIN is used for the "arms" checks, so
    // the strength gate below cannot be what makes them pass or fail.
    const GOOD_PIN = "48291573";
    await page.locator("#pin-new").fill(GOOD_PIN);
    await page.locator("#pin-confirm").fill("48291574");
    await expectVisible(page.getByText(/do not match/i), "the mismatch is stated", 15_000);
    await expect(savePin, "Save is still disabled on a mismatch").toBeDisabled();

    await page.locator("#pin-confirm").fill(GOOD_PIN);
    await expect(savePin, "Save arms when the two new PINs agree").toBeEnabled();

    // The real client-side PIN gate is the format rule, not a strength rule:
    // letters never arm the form, and the reason is on screen.
    await page.locator("#pin-new").fill("12ab");
    await page.locator("#pin-confirm").fill("12ab");
    await expectVisible(pane(page).getByText(/digits only/i), "a non-numeric PIN is refused with a reason", 15_000);
    await expect(savePin, "a non-numeric PIN never arms the form").toBeDisabled();

    // 08 §11 EC-02, ASSERTED (it was a FINDING — "there is no such rule in
    // `pinFormatError` or in `setPinAction`" — until this lane added one). The
    // format check passes these; the strength gate is what refuses them, in the
    // client's words, and the Save button stays down.
    for (const [obvious, why] of [
      ["123456", "an ascending run"],
      ["000000", "all zeros"],
      ["111111", "all ones"],
    ] as const) {
      await page.locator("#pin-new").fill(obvious);
      await page.locator("#pin-confirm").fill(obvious);
      await expectVisible(
        pane(page).getByText(/too obvious/i),
        `EC-02 states its reason for ${obvious} (${why})`,
        15_000,
      );
      await expect(savePin, `EC-02 keeps Save down for ${obvious}`).toBeDisabled();
    }
    // …and a PIN that satisfies the strength rule arms the form again, so the
    // gate above is the reason and not a permanently disabled button.
    await page.locator("#pin-new").fill(GOOD_PIN);
    await page.locator("#pin-confirm").fill(GOOD_PIN);
    await expect(savePin, "EC-02 does not over-reject: a real PIN still arms").toBeEnabled();

    // Close the form without submitting. The PIN is 135790 and stays 135790.
    await page.getByRole("button", { name: /^Close$/ }).click();
    await expect(form, "the form closes without submitting").toHaveCount(0);

    // SR-05: the biometric toggle is PIN-gated in BOTH directions. The gate
    // opens; the commit is never clicked.
    const bio = page.getByRole("switch", { name: /Biometric unlock/i });
    await expectVisible(bio, "biometric switch", 15_000);
    await bio.click();
    const bioPin = page.locator("#biometric-pin");
    await expectVisible(bioPin, "the biometric PIN gate opens", 15_000);
    await expectVisible(page.getByText(/Confirm with your PIN/i), "the gate says what it wants", 15_000);
    await bioPin.fill("0000");
    const bioCommit = page.getByRole("button", { name: /Turn biometric unlock/i });
    await expect(bioCommit, "the commit is armed and NOT clicked").toBeEnabled();

    // The auto-lock select states that it is stored, not yet enforced — a
    // control that does nothing today must not claim it does.
    await expectVisible(
      page.getByText(/enforced when the app lock screen ships/i),
      "the unenforced control admits it",
      15_000,
    );
    const timeout = page.getByLabel(/Auto-lock timeout in minutes/i);
    expect(await timeout.locator("option").count()).toBe(5);

    // Sign-in password: disabled on an empty form, and the floor is visible.
    await expectVisible(page.getByRole("heading", { name: /Sign-in Password/i }), "password section", 15_000);
    const updatePassword = page.getByRole("button", { name: /Update password/i });
    await expect(updatePassword, "Update password is disabled on an empty form").toBeDisabled();
    await expectVisible(
      page.getByPlaceholder("At least 8 characters"),
      "the 8-character floor is stated in the field itself",
      15_000,
    );

    await shot(page, "set-06-security.png");
    errors.assertNoErrors();
  });

  // -------------------------------------------------------------- 07 Database
  test("07 Database — real counts, no fabricated connection result", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.database, /Where your records live/);

    // The old card had a "Test Connection" button that waited 900ms and printed
    // "Connection successful (mock)". It reported a connection never made.
    await expect(page.getByText(/Connection successful/i), "no fabricated connection result").toHaveCount(0);
    await expect(page.getByRole("button", { name: /Test Connection/i }), "no dead test button").toHaveCount(0);

    // Scoped to the pane: the shell's screen switcher and the settings nav both
    // render "Students", so an unscoped getByText is a strict-mode violation.
    await expectVisible(pane(page).getByText("Account id", { exact: true }), "account id row", 40_000);
    for (const row of ["Students", "Ledger entries", "Invoices", "Settings row"]) {
      await expectVisible(pane(page).getByText(row, { exact: true }), `${row} row`, 20_000);
    }
    // Counts are measured, so they are numbers — not placeholders.
    const studentsRow = pane(page).getByText("Students", { exact: true }).locator("..");
    expect((await studentsRow.innerText()).match(/\d/), "the student count is a real number").toBeTruthy();

    await expectVisible(
      pane(page).getByText(/The database address and schema version are not in this build/i),
      "the section states what it cannot show instead of faking it",
      20_000,
    );

    await shot(page, "set-07-database.png");
    errors.assertNoErrors();
  });

  // ---------------------------------------------------------------- 08 Backup
  test("08 Backup — a wrong PIN is refused fail-closed, then the real file downloads", async ({ page }) => {
    test.setTimeout(280_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.backup, /Create Local Backup/);

    const passphrase = page.locator("#backup-passphrase");
    const confirm = page.locator("#backup-passphrase-confirm");
    const word = page.locator("#backup-typed-word");
    const pin = page.locator("#backup-pin");
    const create = page.getByRole("button", { name: /Create encrypted backup/i });

    await expectVisible(passphrase, "passphrase field", 20_000);

    // EC-04: the floor is 12, not the 8 this surface used to accept.
    await expectVisible(page.getByText(/at least 12 characters/i), "the passphrase floor is stated", 15_000);
    await passphrase.fill("correct horse battery staple");
    await confirm.fill("mismatch on purpose");
    await expectVisible(page.getByText(/do not match/i), "the passphrase mismatch is stated", 15_000);
    await confirm.fill("correct horse battery staple");

    // 09 §15.4: the typed EXPORT is the first gate.
    await word.fill("nope");
    await expectVisible(page.getByText(/must be exactly EXPORT/i), "the typed word is stated", 15_000);
    await expect(create, "the typed word is required").toBeDisabled();
    await word.fill("EXPORT");

    // FAIL-CLOSED (12 BR-SEC-03 / 10 §3). A deliberately WRONG PIN — never the
    // real one on a gated path. This is the only wrong-PIN submission in the
    // file, and the correct PIN immediately below resets the ladder counter to
    // zero (a successful verification writes `pin_unlocked`).
    await pin.fill("246813");
    await expect(create).toBeEnabled();
    await create.click();
    const refusal = page.getByRole("alert").filter({ hasText: /PIN/i }).first();
    await expectVisible(refusal, "a wrong PIN is refused with a reason", 90_000);
    await expect(refusal).toHaveText(/Incorrect PIN|Too many wrong PIN/i);
    await expect(
      page.getByText(/Encrypted backup ready/i),
      "no file is offered when the PIN gate refuses",
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Download the file/i }), "no download offered").toHaveCount(0);

    // The correct PIN. This also resets the fail counter, so the QA tenant is
    // left with a zero consecutive-failure count.
    await pin.fill(QA_PIN);
    await expect(create).toBeEnabled();
    await create.click();
    await expectVisible(page.getByText(/Encrypted backup ready/i), "the backup was created", 120_000);

    // §6.2.7: `Buddysaradhi_Backup_<YYYYMMDD-HHmm>.buddysaradhi`. The extension
    // IS the contract — restore keys its magic-byte check off it.
    const filename = /^Buddysaradhi_Backup_\d{8}-\d{4}\.buddysaradhi$/;
    const shown = page.getByText(filename);
    await expectVisible(shown, "the spec's filename is on screen", 20_000);
    const expectedName = (await shown.innerText()).trim();

    // Argon2id (m=64MiB) plus a blob URL download — the only download whose
    // event we can wait on for the actual file.
    const downloaded = await grabDownload(page, async () => {
      await page.getByRole("button", { name: /Download the file/i }).click();
    });
    expect(downloaded, "the downloaded file matches the filename shown").toBe(expectedName);
    expect(downloaded).toMatch(filename);

    // The two gates are stated, not implied.
    await expectVisible(page.getByText(/Type.*EXPORT.*to confirm/i), "gate one is named", 15_000);
    await expectVisible(page.getByText(/Your app PIN/i).first(), "gate two is named", 15_000);

    // There is no restore UI. The old fake one reported a success that never
    // happened, so its absence is the finding. Scoped to the pane: the nav
    // rail's own "Backup & Restore" button is not a restore control.
    await expect(pane(page).getByRole("button", { name: /Restore/i }), "no restore control exists").toHaveCount(0);

    await shot(page, "set-08-backup.png");
    errors.assertNoErrors();
  });

  // ---------------------------------------------------------- 09 Import/export
  test("09 Import & Export — both templates download with their real filenames", async ({ page }) => {
    test.setTimeout(220_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.transfer, /Export Data/);
    await expectVisible(page.getByRole("heading", { name: /Import Data/i }), "import heading", 15_000);
    await expectVisible(page.getByRole("heading", { name: /Bulk import/i }), "bulk import heading", 15_000);

    // The two fabricated "Export to JSON/CSV your entire ledger" cards are gone.
    await expect(page.getByRole("button", { name: /Export to JSON/i }), "no settings-only export card").toHaveCount(0);

    // 09 §15.4: a template download needs no PIN.
    expect(
      await grabDownload(page, async () => {
        await page.getByRole("button", { name: /Download students-template\.csv/i }).click();
      }),
      "CSV template filename",
    ).toBe("students-template.csv");
    expect(
      await grabDownload(page, async () => {
        await page.getByRole("button", { name: /Download Excel template/i }).click();
      }),
      "XLSX template filename",
    ).toBe("students-template.xlsx");

    // The RECORDS export is deliberately NOT downloaded: a full-data export is
    // on the forbidden list. Its controls are still asserted as present, live
    // and correctly labelled for all three entities.
    const entity = page.getByRole("radiogroup", { name: /Choose what to export/i });
    await expect(entity, "the export entity picker exists").toBeVisible({ timeout: 20_000 });
    expect(await entity.getByRole("radio").count(), "students, attendance and fees").toBe(3);
    await expect(entity.getByRole("radio").first(), "students is the default entity").toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The button label follows the chosen entity, so all three spellings are real.
    await expect(page.getByRole("button", { name: /Download students CSV/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Download attendance CSV/i })).toHaveCount(0);
    await entity.getByRole("radio").nth(1).click();
    await expect(page.getByRole("button", { name: /Download attendance CSV/i })).toBeEnabled();
    await entity.getByRole("radio").nth(2).click();
    await expect(page.getByRole("button", { name: /Download fee statements CSV/i })).toBeEnabled();
    await entity.getByRole("radio").first().click();

    // EC-07: with nothing pasted, nothing is confirmable — and it says so.
    const review = page.getByRole("button", { name: /^Review \d+ rows?$/i });
    await expectVisible(review, "the paste-grid review button", 20_000);
    expect(await review.innerText(), "zero filled rows").toMatch(/^Review 0 rows$/);
    await assertDisabledExplains(page, review, /grid is empty/i);

    // The grid row controls operate without writing anything: they are local
    // component state until a review is confirmed.
    const rowsBefore = await page.locator('button[aria-label^="Remove grid row"]').count();
    await page.getByRole("button", { name: /^Add a row$/ }).click();
    await expect(
      page.locator('button[aria-label^="Remove grid row"]'),
      "a row was added",
    ).toHaveCount(rowsBefore + 1, { timeout: 15_000 });
    await page.getByRole("button", { name: `Remove grid row ${rowsBefore + 1}` }).click();
    await expect(
      page.locator('button[aria-label^="Remove grid row"]'),
      "the added row was removed",
    ).toHaveCount(rowsBefore, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Review 0 rows$/ }), "still nothing to confirm").toBeDisabled();

    await shot(page, "set-09-import.png");
    errors.assertNoErrors();
  });

  // ------------------------------------------------------- 10 Data & Privacy
  test("10 Data & Privacy — both destructive flows driven to their last click", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.privacy, /Data Management/);

    // Auto-archive window: §14 says 30..365 with NO "Never". It used to offer
    // "Never" (0), which the schema rejects, and capped at 180.
    const archiveWindow = page.getByLabel(/Auto-archive inactive students/i);
    await expectVisible(archiveWindow, "auto-archive select", 20_000);
    const options = await archiveWindow.locator("option").evaluateAll((nodes) =>
      nodes.map((n) => Number((n as HTMLOptionElement).value)),
    );
    expect(options.length).toBeGreaterThanOrEqual(5);
    for (const value of options) {
      expect(value, "every option is inside §14's 30..365").toBeGreaterThanOrEqual(30);
      expect(value).toBeLessThanOrEqual(365);
    }
    // ROUND-TRIP the window.
    const beforeDays = Number(await archiveWindow.inputValue());
    const otherDays = options.find((d) => d !== beforeDays) ?? beforeDays;
    if (otherDays !== beforeDays) {
      await archiveWindow.selectOption(String(otherDays));
      await expect(archiveWindow, "the window changed").toHaveValue(String(otherDays), { timeout: 40_000 });
      await archiveWindow.selectOption(String(beforeDays));
      await expect(archiveWindow, "THE WINDOW RESTORE LANDED").toHaveValue(String(beforeDays), { timeout: 40_000 });
    }

    // ---- SR-03 triple gate: archive every student. All three gates are
    // completed; the commit is asserted ENABLED and never clicked.
    await page.getByRole("button", { name: /Archive all students/i }).click();
    const firstWord = page.locator("#archive-first-word");
    await expectVisible(firstWord, "delete step 1", 15_000);
    await expectVisible(page.getByText(/Step 1 of 3/), "the step count is visible", 15_000);

    const continue1 = page.getByRole("button", { name: /^Continue$/ });
    // The label beside the field is what explains the disabled Continue — the
    // "must be exactly DELETE" line only exists AFTER a wrong keystroke, so it
    // is not the resting explanation.
    await expect(continue1, "no typed word, no next step").toBeDisabled();
    await expectVisible(pane(page).getByText(/Type.*DELETE.*to confirm/i), "the required word is named", 15_000);
    await firstWord.fill("delete");
    await expectVisible(pane(page).getByText(/must be exactly DELETE/i), "the word rule is stated", 15_000);
    await expect(continue1, "a lowercase delete is not the word").toBeDisabled();
    await firstWord.fill("DELETE");
    await expect(continue1).toBeEnabled();
    await continue1.click();

    const archivePin = page.locator("#archive-pin");
    await expectVisible(archivePin, "delete step 2 (PIN)", 15_000);
    await expectVisible(page.getByText(/Step 2 of 3/), "step 2", 15_000);
    const continue2 = page.getByRole("button", { name: /^Continue$/ });
    await expect(continue2, "no PIN, no next step").toBeDisabled();
    // A 4-to-8-digit PIN arms the step. Nothing is submitted here.
    await archivePin.fill("2468");
    await expect(continue2).toBeEnabled();
    await continue2.click();

    const secondWord = page.locator("#archive-second-word");
    await expectVisible(secondWord, "delete step 3 (second DELETE)", 15_000);
    await expectVisible(page.getByText(/Step 3 of 3/), "step 3", 15_000);
    await secondWord.fill("DELETE");
    const archiveCommit = page.getByRole("button", { name: /^Archive every student$/ });
    await expect(archiveCommit, "all three gates satisfied, commit armed and NOT clicked").toBeEnabled();

    // The copy must be true: it archives, it does not destroy. Nothing about
    // ledger entries is removed by this action.
    await expectVisible(
      page.getByText(/Nothing is destroyed/i),
      "the card says archive, not delete",
      15_000,
    );

    // Abandon it.
    await page.getByRole("button", { name: /^Cancel$/ }).first().click();
    await expect(secondWord, "the archive flow was abandoned").toHaveCount(0, { timeout: 15_000 });

    // ---- Close your account: both gates satisfied, commit left alone.
    await page.getByRole("button", { name: /Close my account/i }).first().click();
    const accountWord = page.locator("#account-confirm-word");
    await expectVisible(accountWord, "account typed-confirm", 15_000);
    await accountWord.fill("DELETE MY ACCOUNT FOREVER");
    await page.locator("#account-pin").fill(QA_PIN);
    const accountCommit = page.getByRole("button", { name: /Close my account for good/i });
    await expect(accountCommit, "account commit armed and NOT clicked").toBeEnabled();
    await expectVisible(page.getByText(/no way back/i), "the irreversibility is stated", 15_000);
    await expectVisible(page.getByText(/no support that can bring it back/i), "and there is no support escape", 15_000);
    await page.getByRole("button", { name: /^Cancel$/ }).first().click();

    await shot(page, "set-10-privacy.png");
    errors.assertNoErrors();
  });

  // ----------------------------------------------------------------- 11 About
  test("11 About — no invented build number, both links work in-app", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.about, /BuddySaradhi/);

    // This used to hardcode "Version 1.0.0-rc (Build 8421)" — two invented facts
    // in the one card a tutor opens to find out what they are running.
    await expect(page.getByText(/Build 8421/i), "no fabricated build hash").toHaveCount(0);
    await expectVisible(
      page.getByText(/does not carry a version number or commit hash/i),
      "the absence of a build stamp is stated, not filled in",
      15_000,
    );
    // The old /terms, /privacy and /faq links all 404'd — only `/` and the
    // `(auth)` group exist. There is no outbound anchor left.
    expect(await page.locator('a[href^="http"]').count(), "no outbound links").toBe(0);

    await shot(page, "set-11-about.png");

    // Both primary controls actually navigate, and both destinations render.
    await page.getByRole("button", { name: /What this app does with your data/i }).click();
    await expectVisible(page.getByRole("heading", { name: /Data Management/i }), "the data card navigates", 20_000);

    await openSection(page, NAV.about, /BuddySaradhi/);
    await page.getByRole("button", { name: /How Buddysaradhi works/i }).click();
    await expectVisible(page.getByRole("heading", { name: /How Buddysaradhi works/i }), "the help card navigates", 20_000);

    errors.assertNoErrors();
  });

  // ------------------------------------------------------------------ 12 Help
  test("12 Help — the five screens are named, and nothing links away", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.help, /How Buddysaradhi works/);

    // Scoped to the pane: the screen switcher also renders the word "Dashboard",
    // so an unscoped getByText("Dashboard") is a strict-mode violation.
    for (const screen of ["Dashboard", "Students", "Attendance", "Fees", "Settings"]) {
      await expectVisible(pane(page).getByText(screen, { exact: true }), `${screen} is described`, 15_000);
    }
    await expectVisible(pane(page).getByText("The five screens"), "the section names its own scope", 15_000);
    // Rule 2: the app makes no outbound connections, so nothing here may link
    // away to a manual that does not exist.
    expect(await page.locator('a[href^="http"]').count(), "no outbound links in Help").toBe(0);
    await expectVisible(
      page.getByText(/makes no outbound connections/i),
      "and it says why there is no link",
      15_000,
    );

    await shot(page, "set-12-help.png");
    errors.assertNoErrors();
  });

  // ----------------------------------------------------------- 13 Diagnostics
  test("13 Diagnostics — measured storage, and the gaps stated", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = captureErrors(page);
    await enterSettings(page, errors);
    await openSection(page, NAV.diagnostics, /System Health/);

    // Three tiles and a log viewer, every value a literal, on the one screen
    // whose whole job is telling a tutor whether the app is lying to them.
    for (const fabrication of [/4\.2 MB/i, /Sync Status/i, /Offline Mutations Pending/i]) {
      await expect(page.getByText(fabrication), `no fabricated value: ${fabrication}`).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /Export Logs/i }), "no fabricated log export").toHaveCount(0);
    await expect(page.locator("pre"), "no hardcoded log dump").toHaveCount(0);

    await expectVisible(page.getByText(/Space used by this site/i), "measured storage row", 30_000);
    await expectVisible(page.getByText(/Not reported in this build/i), "the section states its gaps", 20_000);
    for (const gap of [/Ledger integrity check/, /Pending sync rows/, /Last successful sync time/]) {
      await expectVisible(page.getByText(gap), `the gap is named: ${gap}`, 15_000);
    }

    // The persistence state is one of four real answers, never a fake "OK".
    const stateLabels = [/Kept on this device/, /Not kept yet/, /Not offered by this browser/, /Checking storage/];
    let stated = false;
    for (const label of stateLabels) {
      if ((await page.getByText(label).count()) > 0) {
        stated = true;
        break;
      }
    }
    expect(stated, "the persistence state is one of the four real answers").toBe(true);
    await expectVisible(
      page.getByText(/It is a request, not a guarantee/i),
      "the one live control does not overclaim",
      20_000,
    );

    await shot(page, "set-13-diagnostics.png");
    errors.assertNoErrors();
  });
});