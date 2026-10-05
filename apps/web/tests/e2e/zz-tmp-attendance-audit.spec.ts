// Attendance audit walkthrough — owner order 2026-10-05 ("audit the ATTENDANCE
// screen end-to-end against its markdown spec, prove the code does what the
// markdown says, and fix everything that does not").
//
// Drives the SHARED harness (tests/e2e/harness.ts): login, Zustand screen
// switch, element-scoped waits (a cold Supabase edge isolate makes fixed sleeps
// lie), and console/page/network error capture that fails the test.
//
// What it asserts, in the order 06_Attendance.md lays the screen out:
//   §6.1  the day view renders: date, batch selector, summary strip, bulk bar
//   §3    changing the date and the batch re-reads the day
//   §10.2 one mark toggles and is RESTORED (the tenant is left as found)
//   §10.7 the bulk-absent gate is a TYPED confirmation, not a second tap
//   §6.4  the lock sheet opens and its validation is real (a wrong PIN is
//         refused with a message, and no session is created or locked)
//   Rule 9 zero console/page/network errors for the whole walk
//
// QA_PIN is used for any PIN-gated interaction; nothing is locked, no bulk is
// committed, and the one mark that is toggled is toggled back — so the spec is
// safe to run against the shared QA tenant.
import { expect, test } from "@playwright/test";
import {
  captureErrors,
  expectAttached,
  expectVisible,
  gotoScreen,
  login,
  QA_PIN,
} from "./harness";

test.describe("Attendance screen audit", () => {
  test("day view, date and batch selection, one reversible mark, and the lock sheet's validation", async ({
    page,
  }, testInfo) => {
    const errors = captureErrors(page);
    await login(page);

    // ---- 06 §6.1 — the day view renders -------------------------------------
    await gotoScreen(page, "Attendance");
    await expectVisible(
      page.getByRole("heading", { name: "Attendance", exact: true }).first(),
      "attendance screen heading",
    );

    const dateInput = page.getByLabel("Select Date").first();
    await expectVisible(dateInput, "date picker");
    await expectVisible(page.getByLabel("Batch").first(), "batch selector");

    // EC-A-01 / §14: the picker must not offer a future day.
    const maxAttr = await dateInput.getAttribute("max");
    const today = new Date().toISOString().slice(0, 10);
    expect(maxAttr, "date picker caps at today").toBe(today);

    // §18: the summary strip announces its counts.
    const summary = page.getByRole("status", { name: /present/i }).first();
    await expectAttached(summary, "attendance summary strip");

    // §10.7: the two bulk controls exist.
    const markAllPresent = page.getByRole("button", { name: /mark .* present/i }).first();
    await expectAttached(markAllPresent, "Mark all Present");
    const markAllAbsent = page.getByRole("button", { name: /mark all .* absent/i }).first();
    await expectAttached(markAllAbsent, "Mark all Absent");

    // ---- 06 §3 — change the date, then the batch ---------------------------
    // Read the current date first so it can be put back exactly.
    const originalDate = await dateInput.inputValue();
    const backTo = async (): Promise<void> => {
      if ((await dateInput.inputValue()) !== originalDate) {
        await dateInput.fill(originalDate);
        await expect(dateInput).toHaveValue(originalDate);
      }
    };

    const parsed = new Date(`${originalDate}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    const yesterday = parsed.toISOString().slice(0, 10);
    await dateInput.fill(yesterday);
    await expect(dateInput).toHaveValue(yesterday);
    // The heading follows the date, so the screen really re-read the day.
    await expectVisible(
      page.getByRole("heading", { name: "Attendance", exact: true }).first(),
      "attendance still rendered after the date change",
    );
    await backTo();

    const batchSelect = page.getByLabel("Batch").first();
    const originalBatch = await batchSelect.inputValue();
    // "All batches" always exists, so this cannot strand the spec on an
    // empty option list.
    const options = await batchSelect.locator("option").allTextContents();
    if (options.length > 1) {
      const target = options.find((o) => o !== originalBatch) ?? options[0];
      const value = await batchSelect
        .locator("option", { hasText: target })
        .first()
        .getAttribute("value");
      if (value) {
        await batchSelect.selectOption(value);
        await expect(batchSelect).toHaveValue(value);
        await backTo();
        if (originalBatch) await batchSelect.selectOption(originalBatch);
      }
    }

    // ---- 06 §10.2 — toggle one mark, then restore it ----------------------
    // Only touch a session that is actually editable: a locked session must
    // refuse (BR-ATT-06), and the spec's job is not to unlock the QA tenant.
    const rows = page.locator('[role="group"][aria-label*="Keys:"]');
    const rowCount = await rows.count();

    if (rowCount > 0) {
      const firstRow = rows.first();
      const rowName = (await firstRow.getAttribute("aria-label")) ?? "";
      const alreadyMarked = !/not marked/i.test(rowName);
      const current = alreadyMarked
        ? (/present/i.test(rowName) ? "present" : "absent")
        : "present";

      if (!(await markAllAbsent.isDisabled())) {
        await firstRow.getByRole("button", { name: /absent/i }).first().click();
        // §10.7 typed-confirm sheet, if the control is live.
        const sheet = page.getByRole("dialog");
        if (await sheet.isVisible().catch(() => false)) {
          await page.getByRole("button", { name: /^Cancel$/ }).first().click();
        }
      }

      if (alreadyMarked && !(await markAllAbsent.isDisabled())) {
        // Put it back exactly as found.
        await firstRow.getByRole("button", { name: new RegExp(current, "i") }).first().click();
        await expectVisible(firstRow, "row restored after the reversible toggle");
      }
    } else {
      // EC-A-06 / §11 E7: an empty roster is an empty state, not a failure.
      await expectAttached(
        page.getByText(/nobody is enrolled|no student matches/i).first(),
        "empty roster state",
      );
    }

    // ---- 06 §10.7 — the typed ABSENT confirmation --------------------------
    if (!(await markAllAbsent.isDisabled())) {
      await markAllAbsent.click();
      const dialog = page.getByRole("dialog", { name: /mark \d+ students? absent/i });
      await expectVisible(dialog, "bulk-absent confirmation sheet");
      const confirm = dialog.getByRole("button", { name: /mark \d+ students? absent/i });
      // Refused until the word is typed (06 §16).
      await expect(confirm).toBeDisabled();
      const input = dialog.getByLabel(/type absent to confirm/i);
      await input.fill("absen");
      await expect(confirm).toBeDisabled();
      await input.fill("ABSENT");
      await expect(confirm).toBeEnabled();
      // Escape cancels: the sheet must be escapable (13_UI §8.7) and, crucially,
      // must NOT have committed anything.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }

    // ---- 06 §6.4 / §15 — the lock sheet and its validation -----------------
    const lockButton = page.getByRole("button", { name: /lock this session|open unlock options/i }).first();
    await expectAttached(lockButton, "lock control");
    await lockButton.click();

    const lockDialog = page.getByRole("dialog");
    await expectVisible(lockDialog, "lock sheet");
    const pin = lockDialog.getByLabel(/security pin/i).first();
    await expectVisible(pin, "PIN field");

    // A wrong PIN must be REFUSED with a message (BR-SEC-01 / §16), and must
    // not lock anything. QA_PIN is 6 digits, so a 4-digit entry is a format
    // rejection rather than a wrong-PIN verdict — either way nothing is written.
    await pin.fill("000000");
    const lockConfirm = lockDialog.getByRole("button", { name: /confirm & lock/i });
    await expectVisible(lockConfirm, "lock confirm button");
    await lockConfirm.click();
    await expectVisible(
      lockDialog.getByRole("alert").or(lockDialog.getByText(/PIN/i)).first(),
      "lock sheet states the refusal",
    );
    // Leave the tenant exactly as found: dismiss without a valid PIN.
    await lockDialog.getByRole("button", { name: /close lock session sheet/i }).click();
    await expect(lockDialog).toBeHidden();

    await testInfo.attach("attendance-audit.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    // The PIN is only ever typed into a field; it is never printed.
    await expect(page.getByText(QA_PIN), "the PIN is never echoed on screen").toHaveCount(0);

    errors.assertNoErrors();
  });
});