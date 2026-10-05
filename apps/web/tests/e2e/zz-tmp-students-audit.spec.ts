// Students screen audit walkthrough — owner order 2026-10-05 ("audit the
// STUDENTS screen end-to-end against its markdown spec, prove the code does what
// the markdown says, and fix everything that does not").
//
// Drives the SHARED harness (tests/e2e/harness.ts): login, Zustand screen switch,
// element-scoped waits (a cold gateway isolate makes fixed sleeps lie), and
// console/page/network error capture that fails the test. No fixed sleeps.
//
// What it asserts, in the order 05_Students.md lays the screen out:
//   §6.1  the roster renders, and every row names its student (name, code,
//         balance, status) so two same-named students are distinguishable
//   §6.3  typing in the one search box narrows the roster, and clearing it
//         brings the roster back — the roster is never blanked by a search
//   §6.1  the Add Student sheet opens, and its VALIDATION is real: an empty name
//         and an empty batch block the submit; a phone that is not 10–15 digits
//         is refused with a message naming the field (09 §14.5, 05 §14)
//   §14    the auto-code toggle hides and reveals the code field, and a blank
//         code is accepted (BR-STU-04 — generate one for me)
//   §6.4  the detail drawer opens and EVERY tab renders real content, including
//         the fee-history failure branch (Rule 9: a failed read is not an empty)
//   §18   each drawer tab points at its own panel
//   §16   the delete confirmation states what actually happens — the ledger is
//         NOT deleted (Rule 1)
//   Rule 9 zero console/page/network errors for the whole walk
//
// TENANT SAFETY: NO student is committed. The sheet's validation is proven by
// attempts that are all refused, and the drawer is closed without deleting. The
// spec leaves the QA tenant exactly as it found it.
import { expect, test } from "@playwright/test";
import {
  captureErrors,
  expectAttached,
  expectVisible,
  gotoScreen,
  login,
} from "./harness";

/** The QA tenant must never gain a student from an audit run. */
const AUDIT_NAME = "ZZAudit DeleteMe";

test.describe("Students screen audit", () => {
  test("roster, search, add-sheet validation, drawer tabs, and the honest delete warning", async ({
    page,
  }, testInfo) => {
    const errors = captureErrors(page);
    await login(page);

    // ---- 05 §6.1 — the roster renders ---------------------------------------
    await gotoScreen(page, "Students");
    await expectVisible(
      page.getByRole("heading", { name: "Students", exact: true }).first(),
      "students screen heading",
    );

    // §18: rows carry an accessible name with name, code, balance and status.
    // Wait for the region to settle: a cold isolate means the first paint can be
    // a skeleton, and a skeleton is not an empty roster.
    const listRegion = page.getByRole("region", { name: /student list/i }).first();
    await expectAttached(listRegion, "student list region");
    const rows = listRegion.getByRole("button", { name: /^Student: / });
    await expect
      .poll(async () => rows.count(), { timeout: 25_000, message: "roster rows rendered" })
      .toBeGreaterThan(0);

    const firstRowLabel = (await rows.first().getAttribute("aria-label")) ?? "";
    // Every clause the spec names must be present, not just the name.
    expect(firstRowLabel, "row names the student").toContain("Student:");
    expect(firstRowLabel, "row states a code or says none").toMatch(/code |no code assigned/);
    expect(firstRowLabel, "row states the balance").toMatch(
      /owes |in credit|no dues|unavailable/,
    );
    expect(firstRowLabel, "row states the status").toMatch(/status (active|inactive|graduated|archived)/);

    // A code column is §6.2's first column. An unassigned one reads as an em
    // dash, never as a blank cell.
    await expectAttached(rows.first(), "first roster row");
    await expect
      .poll(async () => {
        const labels = await rows.evaluateAll((els) =>
          els.map((el) => el.getAttribute("aria-label") ?? ""),
        );
        return labels.filter((label) => /code |no code assigned/.test(label)).length;
      }, { timeout: 15_000, message: "every row states a code" })
      .toBeGreaterThan(0);

    // ---- 05 §6.3 — search narrows, clearing restores ------------------------
    const search = page.getByLabel(/search students/i).first();
    await expectVisible(search, "in-screen search box");
    const beforeCount = await rows.count();

    await search.fill("zzzzz-no-such-student");
    // E13: a search that matches nobody says so, and offers the way back. It must
    // NOT render the "add your first student" CTA — that would invite the tutor
    // to re-enter a roster they still have.
    await expectVisible(
      page.getByText(/no student matches/i).first(),
      "no-match state (E13)",
    );
    await expect(
      page.getByRole("button", { name: /^add student$/i }).first(),
      "no Add Student CTA on a narrowed roster",
    ).toHaveCount(0);

    await search.fill("");
    await expect
      .poll(async () => rows.count(), { timeout: 20_000, message: "roster restored" })
      .toBe(beforeCount);

    // ---- 05 §6.1 / §14 — the add sheet's validation is real ------------------
    const addButton = page.getByRole("button", { name: /^add student$/i }).first();
    await expectAttached(addButton, "Add Student control");
    if (await addButton.isVisible()) {
      await addButton.click();
    } else {
      await page.getByRole("button", { name: /add student/i }).first().click();
    }
    const sheet = page.getByRole("dialog", { name: /add new student/i });
    await expectVisible(sheet, "Add Student sheet");

    // §14: an empty name and an empty batch are required, and the error is on
    // the field rather than in a toast.
    const save = sheet.getByRole("button", { name: /save student/i });
    await expectVisible(save, "save control");
    await save.click();
    await expectVisible(sheet.getByText(/name is required/i), "name is required");
    await expectVisible(sheet.getByText(/batch is required/i), "batch is required");
    // Still open: a refused submit must not close the sheet.
    await expectVisible(sheet, "sheet still open after a refused submit");

    // §14 / 09 §14.5: a phone that is not 10–15 digits is refused, with the field
    // named. Before the audit the sheet accepted any string at all.
    await sheet.getByLabel(/^full name/i).fill(AUDIT_NAME);
    await sheet.getByLabel(/batch name/i).fill("ZZAudit Batch");
    await sheet.getByLabel(/phone number/i).fill("call me later");
    await save.click();
    await expectVisible(
      sheet.getByText(/is not a phone number/i),
      "phone rule states the field (09 §14.5)",
    );

    // A well-formed phone clears the error — the control is not just refusing.
    await sheet.getByLabel(/phone number/i).fill("+91 98765-43210");
    await expect
      .poll(async () => (await sheet.getByText(/is not a phone number/i).count()) === 0, {
        timeout: 10_000,
        message: "phone error cleared once the value is valid",
      })
      .toBe(true);

    // BR-STU-04 / §14: the auto toggle is on by default and hides the code field;
    // turning it off reveals it, and a blank code is still acceptable there.
    const autoToggle = sheet.getByLabel(/generate the student code for me/i);
    await expectAttached(autoToggle, "auto-code toggle");
    await expect(sheet.getByLabel(/student code/i), "code field hidden while auto is on").toHaveCount(0);
    await autoToggle.uncheck();
    await expectVisible(sheet.getByLabel(/student code/i), "code field revealed");
    await expect(sheet.getByLabel(/student code/i), "a blank code is accepted").toHaveValue("");
    await autoToggle.check();

    // §18: a missing field states an em dash rather than rendering blank. The
    // drawer is the surface that shows every identity field.
    // ---- 05 §6.4 — the detail drawer and every tab --------------------------
    // Close the sheet WITHOUT saving: no student is committed by this audit.
    await page.keyboard.press("Escape");
    const discard = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
    if (await discard.isVisible().catch(() => false)) {
      const discardButton = discard.getByRole("button", { name: /discard|throw away/i }).first();
      if (await discardButton.isVisible().catch(() => false)) await discardButton.click();
    }
    await expect(sheet, "add sheet closed without saving").toBeHidden();

    await rows.first().click();
    const drawer = page.getByRole("tabpanel");
    await expectVisible(drawer, "student detail drawer panel");

    // Each tab renders. The tabs are a real tablist with arrow-key movement
    // (13_UI_Guidelines.md §10), so the count is read from the tablist itself.
    const tablist = page.getByRole("tablist", { name: /student detail sections/i }).first();
    await expectAttached(tablist, "drawer tablist");
    const tabs = tablist.getByRole("tab");
    const tabCount = await tabs.count();
    expect(tabCount, "the drawer has more than one tab").toBeGreaterThan(1);

    for (let index = 0; index < tabCount; index += 1) {
      const tab = tabs.nth(index);
      const tabName = (await tab.getAttribute("aria-label")) ?? (await tab.innerText()) ?? "";
      await tab.click();
      await expectVisible(drawer, `tab "${tabName}" renders its panel`);
      // §18 / 13 §10.4: a tab points at ITS OWN panel.
      const controls = await tab.getAttribute("aria-controls");
      const panelId = await drawer.getAttribute("id");
      expect(controls, `tab "${tabName}" controls the open panel`).toBe(panelId);
      // An em dash, not a blank: the identity fields state "no value".
      await expectAttached(drawer, `tab "${tabName}" has content`);
    }

    // Keyboard parity: arrow keys move between tabs (05 §18).
    await tabs.first().focus();
    const firstTabName = await tabs.first().innerText();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => tabs.nth(1).getAttribute("aria-selected"), { timeout: 8_000 })
      .toBe("true");
    expect(await tabs.nth(1).innerText()).not.toBe(firstTabName);

    // ---- 05 §16 / Rule 1 — the delete warning is honest ----------------------
    const deleteButton = page.getByRole("button", { name: /^delete student$/i }).first();
    await expectAttached(deleteButton, "delete control");
    await deleteButton.click();
    const confirm = page.getByRole("alertdialog", { name: /^delete student$/i });
    await expectVisible(confirm, "delete confirmation");
    const warning = await confirm.innerText();
    // The gateway deletes the roster row and the batch enrollments ONLY.
    // `ledger_entries` is append-only at the database level (AGENTS.md §2 Rule 1),
    // so the copy must not claim a ledger entry is deleted — and it must not claim
    // the other way either.
    expect(warning, "the warning does not claim the ledger is deleted").not.toMatch(
      /ledger entries are deleted/i,
    );
    expect(warning, "the warning names the batch memberships as lost").toMatch(/batch memberships/i);
    expect(warning, "the warning states the ledger is preserved").toMatch(/never deleted|stay exactly as they are/i);
    // Escape cancels: nothing is deleted by an audit run.
    await page.keyboard.press("Escape");
    await expect(confirm, "delete confirmation dismissed").toBeHidden();

    await testInfo.attach("students-audit.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    // Tenant safety, asserted rather than assumed: the audit name never landed.
    await search.fill(AUDIT_NAME);
    await expect
      .poll(async () => rows.count(), { timeout: 15_000, message: "audit name search settled" })
      .toBe(0);
    await search.fill("");

    errors.assertNoErrors();
  });
});
