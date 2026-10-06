// TEMPORARY fees audit (deleted after the run) — the FEES lane's e2e.
//
// Implements: 07_Fees_and_Payments.md §3 (navigation entry), §6.1 (Overview
// landing: roster + per-student balances), §6.3 (immutable per-student ledger,
// VOID rows, the strike-through on the reversed original), §6.4 (Record Payment
// sheet: amount, method, reference, date, live preview, submit gate), §9.10 (void
// receipt with a typed reason AND a verified PIN), §10.2 BR-LED-03/BR-LED-04
// (a void is a new reversing row; the original is struck and stays visible),
// §14 (validation), §18 (a11y: tablist semantics, 44px targets, colour never the
// only signal); 12_Business_Rules.md BR-M-01/BR-M-02 (integer paise, every
// amount through `formatINR`), BR-M-04 (a credit is never red), BR-LED-01/02/04,
// BR-RC-01 (a voided receipt number is never reissued), BR-SEC-04 (PIN-gated
// mutation); 14_Edge_Cases.md EC-F-02, EC-F-05, EC-L-02, EC-L-07;
// 21_Automation_Testing.md §19.4 (the Fees E2E list); AGENTS.md §2 Rule 9 (a
// failed read is not an empty one) and Rule 10.
//
// Three tests, because the config allows 60s and a cold gateway isolate spends
// most of that on login. One long test would fail on the clock with every
// assertion inside it passing.
//
//   TEST 1 — READ-ONLY. The screen renders, the roster shows per-student
//     balances, the search filter narrows it, the ledger pane opens for the
//     selected student, and all five tabs mount their own panel with a
//     DISTINCT heading. A tab whose panel is empty is a broken tab, so each is
//     asserted by content, not by the tab's own label. Screenshot.
//
//   TEST 2 — VALIDATION, NOTHING WRITTEN. The Record Payment sheet opens for a
//     NAMED student (never an empty subject over an enabled Save), Save is
//     disabled until the form is valid, a zero amount and a sub-paise amount are
//     both refused with a stated reason, a malformed cheque reference is refused
//     while an ABSENT one is accepted (amended 07 §6.4), the live preview states
//     the amount in `formatINR`, and the sheet is dismissed WITHOUT committing.
//     No ledger row is created by this test at all.
//
//     ⚠ "zero is refused with a stated reason" found a REAL defect:
//     `preview.errors` held the reason, but the alert block was gated on
//     `preview.amountPaise !== null` — true for exactly the input §14 names
//     first (a zero amount parses to null), so `₹0` disabled Save with nothing on
//     screen explaining why. Fixed in `record-payment-sheet.tsx` and pinned by
//     `record-payment-sheet.test.tsx`; it needs a rebuilt `.next` before this
//     spec can observe it.
//
// TEST 3 — ONE ₹1 PAYMENT, THEN VOIDED THROUGH THE UI. Records exactly one
//     ₹1 cash payment against the student who actually OWES money (so the payment
//     credits an existing open invoice instead of auto-invoicing a stray charge),
//     voids it with a typed reason and `QA_PIN`, and then proves the three facts
//     the money depends on:
//       1. the balance is byte-identical to the value captured before the payment;
//       2. BOTH rows survive — the payment struck through and marked Voided, and
//          the reversing row that struck it (07 §6.3; a voided payment that
//          disappears is worse than one that stays);
//       3. the struck payment no longer offers "Void" (BR-LED-02 / EC-L-02), and
//          the reversing row names what it reversed.
//     If (1) fails the tenant has been left carrying a ₹1 charge, and the failure
//     message says so rather than passing quietly.
//
//     ⚠ BLOCKED ON A DATA DEFECT, NOT A UI ONE (recorded 2026-10-06, lane
//     FEES-R2). Against the QA tenant this test fails at the FIRST assertion
//     below — "the success toast names the receipt number minted on commit" —
//     because the payment cannot commit at all. The tenant's `invoices` table is
//     the RETIRED shape, so `packages/core`'s canonical insert violates
//     `invoices.invoice_number NOT NULL`, and its `receipts` table still keys on
//     `receipt_no`, so the new receipt insert has no `number` column to write.
//     Both are tenant-DB migrations, not screen bugs: no code change makes a
//     payment land here. Do NOT weaken these assertions to make the run green —
//     a payment that cannot mint a receipt IS the failure they exist to catch.
//     The assertions stay until a tenant on the canonical schema passes them.
//
// NO FIXED SLEEPS anywhere: every wait is on an element or an event. NO
// `page.waitForTimeout`.

import { test, expect, type Page } from "@playwright/test";
import {
  captureErrors,
  expectVisible,
  gotoScreen,
  login,
  QA_PIN,
} from "./harness";

const FEES_TABS = [
  { id: "pending", name: "Pending / Overdue", heading: "Pending / Overdue" },
  { id: "collections", name: "Collections", heading: "Where To Collect" },
  { id: "extras", name: "Extras", heading: "Extra Fees" },
  { id: "import", name: "Import", heading: "Import Ledger" },
  { id: "ledger", name: "Ledger", heading: null },
] as const;

/** The screen heading, once the Fees screen has mounted. */
async function waitForFees(page: Page): Promise<void> {
  await expectVisible(
    page.getByRole("heading", { name: "Fees & Payments", level: 1 }).first(),
    "Fees & Payments heading",
  );
  await expectVisible(
    page.getByRole("tablist", { name: "Fees sections" }),
    "fees tablist",
  );
}

/** Opens a tab by its visible name and waits for its panel to take over. */
async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name }).first().click();
  await expect(page.getByRole("tab", { name }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** The roster list: one button per student, each carrying a balance chip. */
function rosterButtons(page: Page) {
  return page.locator('section[aria-label="Students Ledger Navigation"] button[aria-pressed]');
}

/**
 * Selects the student whose balance chip reads "Due" — i.e. the one who
 * actually owes. Recording against a student with no dues takes the core
 * auto-invoice branch instead, which mints a charge the void cannot reverse, so
 * the target is chosen rather than assumed.
 */
async function selectStudentWithDues(page: Page): Promise<string | null> {
  const rows = rosterButtons(page);
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const chip = row.locator(".chip").first();
    if ((await chip.count()) > 0 && (await chip.innerText()).includes("Due")) {
      const name = (await row.innerText()).split("\n")[0] ?? "";
      await row.click();
      await expect(row).toHaveAttribute("aria-pressed", "true");
      return name.trim();
    }
  }
  return null;
}

/** The balance the roster chip states for the selected student, as rendered. */
async function selectedBalanceText(page: Page): Promise<string | null> {
  const rows = rosterButtons(page);
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if ((await row.getAttribute("aria-pressed")) === "true") {
      const chip = row.locator(".chip").first();
      if ((await chip.count()) === 0) return null;
      return (await chip.innerText()).trim();
    }
  }
  return null;
}

/** The Record Payment sheet, as a real dialog. */
function paymentSheet(page: Page) {
  return page.getByRole("dialog", { name: "Record payment" });
}

// ---------------------------------------------------------------------------
// TEST 1 — read-only. Roster, balances, filter, ledger pane, every tab.
// ---------------------------------------------------------------------------

test("fees audit 1: balances render, the filter narrows, and every tab mounts its own panel", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await login(page);
  await gotoScreen(page, "Fees & Payments");
  await waitForFees(page);

  // §6.2 — the roster is the screen's subject. Every row carries a balance chip,
  // which is Rule 10's "colour is never the only signal": icon AND word.
  const rows = rosterButtons(page);
  await expect(rows.first(), "at least one student row").toBeVisible({ timeout: 30_000 });
  const rowCount = await rows.count();
  expect(rowCount, "QA tenant has students on the fees roster").toBeGreaterThan(0);
  for (let i = 0; i < rowCount; i++) {
    await expect(
      rows.nth(i).locator(".chip").first(),
      `row ${i} states a balance in words`,
    ).toBeAttached();
  }

  // The filter is the roster's own search box (AGENTS.md Rule 2 — local, no
  // request while the tutor types). It is `StudentSearchBox`, which is a WCAG
  // combobox (`role="combobox"`, `aria-expanded`, `aria-activedescendant`) —
  // NOT a bare textbox, so `getByRole("textbox", …)` never resolves it.
  const filter = page.getByRole("combobox", { name: /filter students/i }).first();
  await expectVisible(filter, "roster filter");
  const firstName = ((await rows.first().innerText()) ?? "").split("\n")[0]?.trim() ?? "";
  await filter.fill(firstName);
  // The box states the match count in a polite live region — the cheapest proof
  // that the filter RAN rather than silently clearing the list.
  await expect(
    page.getByRole("status").filter({ hasText: /students match/ }).first(),
    "the filter reports how many students match",
  ).toHaveText(new RegExp(`1 of ${rowCount} students match`));
  await expect(rows, "filtering narrows the roster to the named student").toHaveCount(1);
  await filter.fill("");
  await expect(rows, "clearing the filter restores the roster").toHaveCount(rowCount);

  // §6.3 — the ledger pane is the spine, and it opens for the selected student.
  await rows.first().click();
  await expectVisible(
    page.getByRole("button", { name: /record payment/i }).first(),
    "ledger pane actions",
  );

  // Each tab owns a panel with DISTINCT content, so a tab whose panel renders
  // nothing fails here instead of looking like an empty screen.
  for (const tab of FEES_TABS) {
    await openTab(page, tab.name);
    if (tab.heading) {
      await expectVisible(
        page.getByRole("heading", { name: tab.heading }).first(),
        `${tab.name} panel content`,
      );
    } else {
      await expectVisible(rows.first(), "Ledger tab restores the roster");
    }
  }

  await openTab(page, "Ledger");
  await page.screenshot({ path: "test-results/fees-01-screen.png", fullPage: true });

  errors.assertNoErrors();
});

// ---------------------------------------------------------------------------
// TEST 2 — validation with NOTHING written. This is the no-commit path.
// ---------------------------------------------------------------------------

test("fees audit 2: the payment sheet validates, previews, and writes nothing", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await login(page);
  await gotoScreen(page, "Fees & Payments");
  await waitForFees(page);
  await expectVisible(rosterButtons(page).first(), "roster row");

  await rosterButtons(page).first().click();
  const ledgerPane = page.getByRole("region", { name: "Student Ledger History" });
  await expectVisible(ledgerPane, "ledger pane");
  // The oracle for "this test wrote nothing": the ledger header states its own
  // entry count. Asserting "no Void button exists" instead is wrong — the QA
  // tenant already carries real, voidable payments from before, so that
  // assertion fails on a ledger this test never touched.
  const entriesBefore = await ledgerPane
    .getByText(/^\d+ entries?$/)
    .first()
    .innerText();

  await page.getByRole("button", { name: /record payment/i }).first().click();

  const sheet = paymentSheet(page);
  await expectVisible(sheet, "record payment sheet");
  // §6.4 + Rule 9: the sheet names its subject. An empty Student field over an
  // enabled Save is the defect this assertion exists to catch.
  await expect(
    sheet.locator("form#payment-form"),
    "the payment form is mounted over a resolved student",
  ).toBeAttached();

  const amount = sheet.locator("#payment-amount");
  const save = page.getByRole("button", { name: /^Save payment$/ });

  // Empty amount → the sheet must not be submittable.
  await expect(save, "Save is disabled before an amount is entered").toBeDisabled();

  // §14 — a zero amount is not a payment.
  await amount.fill("0");
  await expect(
    sheet.getByText(/Enter a valid amount/i).first(),
    "zero is refused with a stated reason",
  ).toBeVisible();
  await expect(save, "Save stays disabled for a zero amount").toBeDisabled();

  // Rule 6 / BR-M-01 / EC-F-01: sub-paise precision is REFUSED, never
  // truncated into a smaller payment nobody authorised.
  await amount.fill("1500.555");
  await expect(
    sheet.getByText(/Enter a valid amount/i).first(),
    "sub-paise precision is refused",
  ).toBeVisible();
  await expect(save, "Save stays disabled for sub-paise input").toBeDisabled();

  // A valid whole-rupee amount previews, in `formatINR` (BR-M-02), and unlocks
  // the button.
  await amount.fill("1500");
  await expect(save, "Save enables for a valid amount").toBeEnabled();
  const preview = sheet.locator("#payment-preview");
  await expect(
    preview.getByText("₹1,500").first(),
    "the preview states the amount locale-formatted",
  ).toBeVisible();
  await expect(
    preview.getByText(/receipt number is issued the moment this saves/i),
    "the preview states the receipt contract rather than fabricating a number",
  ).toBeVisible();

  // §6.4 (amended) — a reference is OPTIONAL for every method, but a provided
  // one is still pattern-checked. Cheque is the clearest case: absent is fine,
  // malformed is refused.
  await sheet.getByRole("button", { name: "Cheque", exact: true }).click();
  await expect(save, "an absent reference does not block a cheque").toBeEnabled();
  await sheet.locator("#payment-ref").fill("4829");
  await expect(
    sheet.getByText(/6 digits/i).first(),
    "a 4-digit cheque number is refused",
  ).toBeVisible();
  await expect(save, "Save stays disabled for a malformed cheque number").toBeDisabled();
  await sheet.locator("#payment-ref").fill("482913");
  await expect(save, "a valid 6-digit cheque number re-enables Save").toBeEnabled();

  // Dismiss WITHOUT committing. The form is dirty, so the close control raises
  // the discard guard: "Keep editing" then "Discard", in that DOM order. The
  // safe answer has to be chosen deliberately — clicking whichever matched
  // first would hit "Keep editing" and leave the sheet open, which is the
  // opposite of what this step is testing.
  await page.screenshot({ path: "test-results/fees-02-sheet.png", fullPage: true });
  await sheet.getByRole("button", { name: /close record payment sheet/i }).click();
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  await expectVisible(discard, "the discard guard appears over a dirty form");
  await discard.click();
  await expect(sheet, "the sheet closed").toBeHidden();

  // Nothing was written: the ledger still holds exactly the rows it held before
  // the sheet was opened, and none of them is this test's payment.
  await expect(
    ledgerPane.getByText(/^\d+ entries?$/).first(),
    "the discarded sheet left the ledger entry count untouched",
  ).toHaveText(entriesBefore);
  await expect(
    ledgerPane.getByText("QA audit payment"),
    "no payment row named by this test appeared",
  ).toHaveCount(0);

  errors.assertNoErrors();
});

// ---------------------------------------------------------------------------
// TEST 3 — one ₹1 payment, voided through the UI. Tenant left as found.
// ---------------------------------------------------------------------------

test("fees audit 3: a ₹1 payment is voided with a PIN and both rows stay visible", async ({
  page,
}) => {
  const errors = captureErrors(page);
  await login(page);
  await gotoScreen(page, "Fees & Payments");
  await waitForFees(page);
  await expectVisible(rosterButtons(page).first(), "roster row");

  // The balance BEFORE, exactly as the product states it. This string is the
  // oracle for "the tenant is left as found".
  const owedName = await selectStudentWithDues(page);
  expect(owedName, "the QA tenant has a student with dues to record against").not.toBeNull();
  const balanceBefore = await selectedBalanceText(page);
  expect(balanceBefore, "the selected row states a balance").not.toBeNull();

  await page.getByRole("button", { name: /record payment/i }).first().click();
  const sheet = paymentSheet(page);
  await expectVisible(sheet, "record payment sheet");
  await sheet.locator("#payment-amount").fill("1");
  await sheet.locator("#payment-desc").fill("QA audit payment");
  await page.getByRole("button", { name: /^Save payment$/ }).click();

  // 07 §9.6 step 3/7 + BR-RC-01 — the number is consumed out of
  // `settings.next_receipt_seq` on commit and the tutor is HANDED it: it is the
  // handle they quote to void this payment. The prefix is the tenant's own
  // `settings.receipt_prefix`, so the assertion is on the SHAPE, not a literal.
  // Asserted before the sheet-closes check because the toast auto-dismisses.
  await expect(
    page.getByRole("status").filter({ hasText: /Payment recorded/ }).first(),
    "the success toast names the receipt number minted on commit",
  ).toHaveText(/Payment recorded — [A-Z]{2,6}-\d{6} · ₹[\d,]+\.\d{2}/, { timeout: 25_000 });

  // The sheet closes only on a real commit (Rule 9).
  await expect(sheet, "the sheet closed on a committed payment").toBeHidden();

  // The payment landed: a row whose Void affordance now exists.
  const ledgerPane = page.getByRole("region", { name: "Student Ledger History" });
  const voidButtons = ledgerPane.getByRole("button", { name: /^Void/ });
  await expect(voidButtons.first(), "the new payment is in the ledger").toBeVisible({
    timeout: 25_000,
  });
  await expect(
    ledgerPane.getByText("QA audit payment").first(),
    "the payment names what it was for",
  ).toBeVisible();
  await page.screenshot({ path: "test-results/fees-03-payment.png", fullPage: true });

  // §9.10 + BR-SEC-04 — a void needs a typed reason AND a verified PIN.
  await voidButtons.first().click();
  const dialog = page.getByRole("alertdialog", { name: "Void Receipt" });
  await expectVisible(dialog, "void confirmation");
  const confirmVoid = dialog.getByRole("button", { name: /confirm void/i });
  await expect(confirmVoid, "Confirm is refused with an empty reason and PIN").toBeDisabled();

  await dialog.locator("#void-reason").fill("QA audit — reversing the audit payment");
  await dialog.locator("#void-pin").fill(QA_PIN);
  await expect(confirmVoid, "Confirm enables once reason and PIN are present").toBeEnabled();
  await confirmVoid.click();

  await expect(dialog, "the void dialog closed on success").toBeHidden();
  // The reversing row is a NEW row (Rule 1, BR-LED-04), so the row count grows.
  await expect(
    ledgerPane.getByText(/Reverses /).first(),
    "the reversing row names what it reversed",
  ).toBeVisible({ timeout: 25_000 });

  // FACT 1 — the money is back where it was. This is the assertion that makes
  // the run non-destructive; if it fails, the tenant carries a ₹1 charge.
  await expect(
    rosterButtons(page),
    "the roster re-rendered after the void",
  ).toBeVisible();
  await expect
    .poll(
      async () => selectedBalanceText(page),
      {
        message:
          "the balance after voiding the QA payment must equal the balance before it recorded; " +
          "if this fails the tenant is left carrying the ₹1 and the payment must be re-voided / the charge voided from the UI",
        timeout: 25_000,
      },
    )
    .toBe(balanceBefore);

  // FACT 2 — neither row disappears. 07 §6.3: the original is struck through and
  // keeps a pointer to the correction; the correction keeps a pointer back.
  const struck = ledgerPane
    .locator("li")
    .filter({ hasText: "QA audit payment" })
    .first();
  await expect(struck, "the original payment row is still in the ledger").toBeVisible();
  await expect(
    struck.getByText("Voided", { exact: true }),
    "the reversed original is marked VOIDED in words, not colour alone (Rule 10)",
  ).toBeVisible();
  await expect(
    struck.getByText(/reversed by/i),
    "the original names the row that reversed it (07 §6.3)",
  ).toBeVisible();

  // FACT 3 — a dead payment offers no second void (BR-LED-02 / EC-L-02), and a
  // second attempt would only ever reach the gateway's 409.
  await expect(
    struck.getByRole("button", { name: /^Void/ }),
    "the voided payment no longer offers a Void action",
  ).toHaveCount(0);

  await page.screenshot({ path: "test-results/fees-04-voided.png", fullPage: true });

  // And the sheet is not left half-open over the ledger.
  await expect(paymentSheet(page), "no payment sheet is open").toBeHidden();

  errors.assertNoErrors();
});