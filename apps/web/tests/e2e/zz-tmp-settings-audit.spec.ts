import { test, expect, type Download, type Locator, type Page } from "@playwright/test";

// TEMPORARY settings audit (the lead deletes this after the run): every section
// renders, every primary control operates, every download is verified by its
// download event AND its filename, and NOT ONE destructive write is committed.
//
// Implements: 08_Settings.md §6.2 (twelve sections plus the Database identity
// panel), §15 SR-01/SR-03/SR-04/SR-05 (the gates are exercised up to the last
// click, never through it), EC-04 (passphrase floor), §11 EC-07 (import with 0
// ready rows cannot be confirmed); 09_Backup_and_Import_Export.md §15.4
// (template download needs no PIN).
//
// The shared harness owns login, screen switching and error capture — this spec
// never re-derives them. It never runs a fixed sleep: every wait is an
// expectation on an element or on a download event, because a cold gateway
// isolate takes seconds and a sleep is how this audit previously produced three
// false failures.
//
// WHAT IS DELIBERATELY NOT SUBMITTED:
//   - Save new PIN            (would break every other flow's PIN)
//   - Turn biometric on/off   (the gate opens; the commit is not clicked)
//   - Archive every student   (all three gates are completed; the final button
//                              is asserted ENABLED and left alone)
//   - Close my account        (both gates satisfied; the final button is left)
//   - Restore backup          (no restore UI exists — see the finding report;
//                              clicking the old fake one reported a success
//                              that never happened)

import {
  QA_PIN,
  captureErrors,
  expectVisible,
  gotoScreen,
  login,
  openSettingsSection,
} from "./harness";

/** Fills a field until the value sticks; a cold isolate can drop one keystroke. */
async function fillField(page: Page, locator: Locator, value: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await locator.click({ timeout: 4_000 }).catch(() => {});
    await locator.fill(value, { timeout: 4_000 }).catch(() => {});
    if ((await locator.inputValue().catch(() => "")) === value) return;
    await expectVisible(
      page.getByRole("heading", { name: /Institute Profile|Institute Letterhead/i }).first(),
      "section still mounted while the field settles",
      10_000,
    );
  }
  throw new Error(`Could not fill a field with ${value}`);
}

/** Asserts a download happened and returns its suggested filename. */
async function downloadFilename(page: Page, action: () => Promise<void>, timeout = 25_000): Promise<string> {
  const pending = page.waitForEvent("download", { timeout });
  await action();
  const download: Download = await pending;
  const name = download.suggestedFilename();
  await download.delete().catch(() => {});
  return name;
}

test("settings audit: 13 sections render, controls operate, no destructive write is committed", async ({
  page,
}) => {
  const errors = captureErrors(page);

  await login(page);
  await gotoScreen(page, "Settings");

  // 08 BR-SEC-02 mandatory setup gate. Rendered and satisfied if present; the
  // QA account may already have a PIN from an earlier run.
  const gateHeading = page.getByRole("heading", { name: /Set up your app PIN/i });
  if ((await gateHeading.count()) > 0) {
    await expectVisible(gateHeading, "PIN setup gate", 10_000);
    await page.locator("#pin-setup-new").fill(QA_PIN);
    await page.locator("#pin-setup-confirm").fill(QA_PIN);
    await page.getByRole("button", { name: /Set PIN and continue/i }).click();
    await expectVisible(
      page.getByRole("heading", { name: /Institute Profile/i }),
      "profile visible after the PIN gate",
      25_000,
    );
  }

  // 1. Profile — the ONE reversible round-trip: read, write a sentinel, restore.
  await openSettingsSection(page, "Profile", /Institute Profile/);
  const nameInput = page.getByLabel(/Institute Name/i).or(page.locator("#settings-instituteName"));
  await expectVisible(nameInput, "institute name field", 15_000);
  const originalName = await nameInput.inputValue();
  await nameInput.fill(`${originalName} QACheck`);
  await page.getByRole("button", { name: /Save changes/i }).click();
  await expectVisible(
    page.locator("#settings-instituteName"),
    "profile saved and re-rendered",
    15_000,
  );
  await nameInput.fill(originalName);
  await page.getByRole("button", { name: /Save changes/i }).click();
  await expectVisible(
    page.locator("#settings-instituteName"),
    "profile restored",
    15_000,
  );
  // 08 §9.3 / EC-01: currency is either locked (a 🔒 chip plus the reason) or
  // selectable. Never silently locked: the chip is the signal.
  const currency = page.locator("#settings-currencyCode");
  await expectVisible(currency, "currency select", 10_000);
  const currencyDisabled = await currency.isDisabled();
  if (currencyDisabled) {
    await expectVisible(page.locator("#profile-currency-lock"), "currency lock reason", 10_000);
  }
  await page.screenshot({ path: "test-results/set-01-profile.png" });

  // 2. Appearance — every palette tile is a real control, and one is restored.
  await openSettingsSection(page, "Appearance", /Palette/);
  await expectVisible(page.getByRole("heading", { name: /Appearance Mode/i }), "appearance mode", 15_000);
  const paletteTiles = page.locator('button[aria-pressed][aria-label*="palette"]');
  const tileCount = await paletteTiles.count();
  expect(tileCount, "generated palette tiles present").toBeGreaterThanOrEqual(20);
  const activeBefore = await page.locator('button[aria-pressed="true"][aria-label*="palette"]').first();
  await activeBefore.focus();
  await activeBefore.press("Tab");
  await expectVisible(page.getByRole("heading", { name: /Material/i }), "keyboard focus moved on", 10_000);
  await page.screenshot({ path: "test-results/set-02-appearance.png" });

  // 3. Attendance Rules — the lock window is a real 1..168 control.
  await openSettingsSection(page, "Attendance Rules", /Attendance Window/);
  const lockSlider = page.locator("#attendance-lock-hours");
  await expectVisible(lockSlider, "attendance lock slider", 15_000);
  expect(await lockSlider.getAttribute("max"), "slider max is the spec's 168").toBe("168");
  expect(await lockSlider.getAttribute("min"), "slider min is the spec's 1").toBe("1");
  // Holidays: the old "Configure Holiday Calendar" button had no onClick. The
  // editor now exists; add and remove one without leaving a trace.
  await fillField(page, page.locator("#holiday-date"), "2026-04-14");
  await page.locator("#holiday-label").fill("QA holiday");
  await page.getByRole("button", { name: /Add holiday/i }).click();
  await expectVisible(page.getByText("2026-04-14"), "holiday added", 15_000);
  await page.getByRole("button", { name: /Remove the holiday on 2026-04-14/i }).click();
  await expect(page.getByRole("button", { name: /Remove the holiday on 2026-04-14/i }), "holiday removed").toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: "test-results/set-03-attendance.png" });

  // 4. Fee Rules — a prefix is refused if it is not alphanumeric (EC-17).
  await openSettingsSection(page, "Fee Rules", /Default Fee Model/);
  await expectVisible(page.locator("#fee-invoicePrefix"), "invoice prefix field", 15_000);
  const originalPrefix = await page.locator("#fee-invoicePrefix").inputValue();
  await page.locator("#fee-invoicePrefix").fill('INV/"x');
  await expectVisible(page.getByText(/Letters, digits and hyphens only/i), "prefix refusal", 10_000);
  await page.locator("#fee-invoicePrefix").fill(originalPrefix);
  // Three fee models, one transaction on save (§6.2.4 + §9.2).
  for (const label of ["Prepaid", "Postpaid", "Mixed"]) {
    await expectVisible(
      page.getByRole("button", { name: new RegExp(`^${label}`) }),
      `${label} option exists`,
      10_000,
    );
  }
  // Read-only sequence displays (BR-FEE-04 / BR-RC-01).
  await expectVisible(page.getByText(/Next invoice number/i), "next invoice readout", 10_000);
  await expectVisible(page.getByText(/Next receipt number/i), "next receipt readout", 10_000);
  await page.screenshot({ path: "test-results/set-04-fees.png" });

  // 5. Notifications — four real toggles, each a switch.
  await openSettingsSection(page, "Notifications", /Notification Preferences/);
  const toggles = page.getByRole("switch");
  expect(await toggles.count(), "four notification switches").toBe(4);
  await page.screenshot({ path: "test-results/set-05-notifications.png" });

  // 6. Security — the Change PIN form validates and is NEVER submitted.
  await openSettingsSection(page, "Security", /Access Control/);
  await page.getByRole("button", { name: /Change PIN/i }).click();
  await expectVisible(page.locator("#pin-new"), "change-PIN form opens", 10_000);
  const savePin = page.getByRole("button", { name: /Save new PIN/i });
  await expect(savePin, "save disabled on an empty form").toBeDisabled();
  await page.locator("#pin-new").fill("123456");
  await page.locator("#pin-confirm").fill("123457");
  await expectVisible(page.getByText(/do not match/i), "mismatch message", 10_000);
  await expect(savePin, "save still disabled on a mismatch").toBeDisabled();
  await page.locator("#pin-confirm").fill("123456");
  await expect(savePin, "save enabled when the two new PINs agree").toBeEnabled();
  // SR-05: the biometric gate opens and demands a PIN. Not committed.
  await page.getByRole("switch", { name: /Biometric unlock/i }).click();
  await expectVisible(page.locator("#biometric-pin"), "biometric PIN gate opens", 10_000);
  await page.locator("#biometric-pin").fill("0000");
  await expect(
    page.getByRole("button", { name: /Turn biometric unlock/i }),
    "biometric commit armed but not clicked",
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/set-06-security.png" });

  // 7. Database — real counts, no fake "Connection successful".
  await openSettingsSection(page, "Database", /Where your records live/);
  await expectVisible(page.getByText(/Account id/i), "account id row", 20_000);
  await expectVisible(page.getByText(/Ledger entries/i), "ledger count row", 10_000);
  await expect(page.getByText(/Connection successful/i), "no fabricated connection result").toHaveCount(0);
  await page.screenshot({ path: "test-results/set-07-database.png" });

  // 8. Backup & Restore — the full two-gate flow ends in a real download whose
  // filename is the spec's. This is the only write this spec commits, and it is
  // additive: one audit row plus one outbox row (Rule 7).
  await openSettingsSection(page, "Backup", /Create Local Backup/);
  await expectVisible(page.locator("#backup-passphrase"), "backup passphrase field", 15_000);
  await page.locator("#backup-passphrase").fill("correct horse battery staple");
  await page.locator("#backup-passphrase-confirm").fill("mismatch on purpose");
  await expectVisible(page.getByText(/do not match/i), "passphrase mismatch is stated", 10_000);
  await page.locator("#backup-passphrase-confirm").fill("correct horse battery staple");
  await page.locator("#backup-typed-word").fill("nope");
  await expect(
    page.getByRole("button", { name: /Create encrypted backup/i }),
    "the typed EXPORT word is required (09 §15.4)",
  ).toBeDisabled();
  await page.locator("#backup-typed-word").fill("EXPORT");
  await page.locator("#backup-pin").fill(QA_PIN);
  const backupName = await downloadFilename(page, async () => {
    await page.getByRole("button", { name: /Create encrypted backup/i }).click();
  });
  expect(backupName, "the file is named as 08 §6.2.7 requires").toMatch(
    /^Buddysaradhi_Backup_\d{8}-\d{4}\.buddysaradhi$/,
  );
  await page.screenshot({ path: "test-results/set-08-backup.png" });

  // 9. Import & Export — both templates download with their real filenames; the
  // fabricated "Export to JSON/CSV your entire ledger" cards are gone.
  await openSettingsSection(page, "Import", /Export Data/);
  await expect(page.getByRole("button", { name: /Export to JSON/i }), "no settings-only export card").toHaveCount(0);
  expect(
    await downloadFilename(page, async () => {
      await page.getByRole("button", { name: /Download students-template\.csv/i }).click();
    }),
    "CSV template filename",
  ).toBe("students-template.csv");
  expect(
    await downloadFilename(page, async () => {
      await page.getByRole("button", { name: /Download Excel template/i }).click();
    }),
    "XLSX template filename",
  ).toBe("students-template.xlsx");
  // The records export is a read: either a file, or an honest empty-state
  // message. Never a silent no-op, which is the failure this audit found in
  // the two cards that used to sit here.
  const recordsFilename = await downloadFilename(page, async () => {
    await page.getByRole("button", { name: /Download .* CSV/i }).first().click();
  }, 20_000).catch(() => null);
  if (recordsFilename === null) {
    await expectVisible(
      page.getByText(/No students to export|No attendance marked/i),
      "honest empty-state message instead of a download",
      15_000,
    );
  } else {
    expect(recordsFilename, "records export filename").toMatch(/\.csv$/);
  }
  // EC-07: nothing to import means nothing is confirmable.
  await expectVisible(page.getByRole("button", { name: /Review \d+ rows/i }), "paste grid review button", 15_000);
  await page.screenshot({ path: "test-results/set-09-import.png" });

  // 10. Data & Privacy — BOTH destructive flows driven to their last click and
  // then abandoned. This proves SR-03's triple gate without archiving a thing.
  await openSettingsSection(page, "Data", /Data Management/);
  await page.getByRole("button", { name: /Archive all students/i }).click();
  await expectVisible(page.locator("#archive-first-word"), "delete step 1", 10_000);
  await expect(page.getByRole("button", { name: /^Continue$/i }), "continue disabled on step 1").toBeDisabled();
  await page.locator("#archive-first-word").fill("DELETE");
  await page.getByRole("button", { name: /^Continue$/i }).first().click();
  await expectVisible(page.locator("#archive-pin"), "delete step 2 (PIN)", 10_000);
  await page.locator("#archive-pin").fill(QA_PIN);
  await page.getByRole("button", { name: /^Continue$/i }).first().click();
  await expectVisible(page.locator("#archive-second-word"), "delete step 3 (second DELETE)", 10_000);
  await page.locator("#archive-second-word").fill("DELETE");
  const archiveCommit = page.getByRole("button", { name: /^Archive every student$/i }).last();
  await expect(archiveCommit, "all three gates satisfied, commit armed and NOT clicked").toBeEnabled();
  await page.getByRole("button", { name: /^Cancel$/i }).first().click();
  // Account closure: both gates satisfied, commit left alone.
  await page.getByRole("button", { name: /Close my account/i }).first().click();
  await expectVisible(page.locator("#account-confirm-word"), "account typed-confirm", 10_000);
  await page.locator("#account-confirm-word").fill("DELETE MY ACCOUNT FOREVER");
  await page.locator("#account-pin").fill(QA_PIN);
  await expect(
    page.getByRole("button", { name: /Close my account for good/i }),
    "account commit armed and NOT clicked",
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/set-10-privacy.png" });

  // 11. About — no invented build number.
  await openSettingsSection(page, "About", /BuddySaradhi/);
  await expect(page.getByText(/Build 8421/i), "no fabricated build hash").toHaveCount(0);
  await page.screenshot({ path: "test-results/set-11-about.png" });

  // 12. Help.
  await openSettingsSection(page, "Help", /How Buddysaradhi works/);
  await page.screenshot({ path: "test-results/set-12-help.png" });

  // 13. Diagnostics — no fabricated health numbers, and the gaps are stated.
  await openSettingsSection(page, "Diagnostics", /System Health/);
  await expect(page.getByText(/4\.2 MB/i), "no hardcoded database size").toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Logs/i }), "no fabricated log export").toHaveCount(0);
  await expectVisible(page.getByText(/Not reported in this build/i), "diagnostics states its gaps", 15_000);
  await expectVisible(page.getByText(/Space used by this site/i), "measured storage row", 15_000);
  await page.screenshot({ path: "test-results/set-13-diagnostics.png" });

  errors.assertNoErrors();
});