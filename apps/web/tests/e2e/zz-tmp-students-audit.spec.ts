// Students screen audit walkthrough — owner order 2026-10-05 ("audit the
// STUDENTS screen end-to-end against its markdown spec, prove the code does what
// the markdown says, and fix everything that does not").
//
// Drives the SHARED harness (tests/e2e/harness.ts): login, Zustand screen switch,
// element-scoped waits (a cold gateway isolate makes fixed sleeps lie), and
// console/page/network error capture that fails the test. No fixed sleeps.
//
// Every locator in this file was read off the REAL page snapshot
// (`test-results/**/error-context.md`) or off the component source, never
// guessed. The one that was guessed — "the Add Student CTA disappears when a
// search matches nobody" — was wrong, and the app was right; see the §6.3 block.
//
// What it asserts, in the order 05_Students.md lays the screen out:
//   §6.1  the roster renders real students, and EVERY row is keyboard-reachable
//         and labelled with name + code + dues + status (05 §18) — so two
//         same-named students are distinguishable to a screen reader
//   §6.3  typing in the one search box narrows the roster on a REAL value, a
//         search that matches nobody says so honestly AND still leaves the
//         primary CTA reachable, and clearing it restores the roster
//   §6.1  the Add Student sheet opens with its real fields, and its VALIDATION
//         is real: an empty name and an empty batch block the submit; a phone
//         that is not 10–15 digits is refused with a message naming the field
//         (09 §14.5, 05 §14); the auto-code toggle hides and reveals the code
//         field and a blank code is accepted (BR-STU-04)
//   §6.4  the detail drawer opens and EVERY tab renders content, each tab points
//         at its own panel (13 §10.4), a missing identity field states an em
//         dash rather than rendering blank, and arrows move between tabs
//   §16   the delete confirmation states what actually happens — the ledger is
//         NOT deleted (Rule 1) — and Escape cancels it
//   Rule 9 zero console errors, zero page errors, zero 4xx/5xx for the walk
//
// TENANT SAFETY: NO student is committed. Every submit attempt in the sheet is
// refused by schema validation BEFORE `onSubmit` runs, so no duplicate check and
// no write is ever issued; the sheet is discarded and the delete is cancelled.
// The final block asserts, rather than assumes, that the audit name never landed.
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

/**
 * A token taken from a REAL row, so the search-narrows step is not circular.
 *
 * Prefers the row's student CODE over a word of the name. The gateway matches
 * `search` against `firstName`, `lastName` and `code`, so a code resolves to
 * exactly one row — which gives the assertion below a deterministic expected
 * value. A name word does not: `splitStudentName` puts everything after the
 * first token in `last_name`, and a poll that waits for "fewer rows than before"
 * is satisfied by the loading skeleton (zero rows) rather than by the new result.
 */
function searchTokenOf(rowLabel: string): string {
  const code = /\bcode ([^,]+)/.exec(rowLabel)?.[1]?.trim();
  if (code) return code;
  const name = rowLabel.replace(/^Student:\s*/, "").split(",")[0]?.trim() ?? "";
  return name.split(/\s+/).filter((w) => w.length >= 3).pop() ?? name;
}

test.describe("Students screen audit", () => {
  test("roster, search, add-sheet validation, drawer tabs, and the honest delete warning", async ({
    page,
  }, testInfo) => {
    const errors = captureErrors(page);
    await login(page);
    // Turns on the harness's failed-response capture (see `ErrorSink.markSettled`).
    // Called here because the shell now exists and every 4xx from here on is real.
    errors.markSettled();

    // ---- 05 §6.1 — the roster renders ---------------------------------------
    await gotoScreen(page, "Students");
    await expectVisible(
      page.getByRole("heading", { name: "Students", exact: true }).first(),
      "students screen heading",
    );

    // §18: rows carry an accessible name with name, code, balance and status.
    // Wait for the region to settle: a cold isolate means the first paint can be
    // a skeleton, and a skeleton is not an empty roster.
    const listRegion = page.getByRole("region", { name: "Student list" }).first();
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
    expect(firstRowLabel, "row states the status").toMatch(
      /status (active|inactive|graduated|archived)/,
    );

    // EVERY row, not just the first: one well-labelled row among three unlabelled
    // ones is still a screen-reader dead end.
    await expect
      .poll(
        async () => {
          const labels = await rows.evaluateAll((els) =>
            els.map((el) => el.getAttribute("aria-label") ?? ""),
          );
          return labels.filter(
            (l) =>
              /code |no code assigned/.test(l) &&
              /owes |in credit|no dues|unavailable/.test(l) &&
              /status (active|inactive|graduated|archived)/.test(l),
          ).length;
        },
        { timeout: 15_000, message: "every row states code, balance and status" },
      )
      .toBe(await rows.count());

    // §18 keyboard reachability: the row is a real focusable control, not a div
    // with a click handler, and focusing it actually lands on it.
    const rowIsFocusable = await rows.first().evaluate((el) => {
      const node = el as HTMLElement;
      return node.tabIndex >= 0 && !node.hasAttribute("disabled");
    });
    expect(rowIsFocusable, "roster rows take keyboard focus").toBe(true);
    await rows.first().focus();
    await expect
      .poll(
        () =>
          rows
            .first()
            .evaluate((el) => el === document.activeElement)
            .catch(() => false),
        { timeout: 5_000, message: "roster row receives focus" },
      )
      .toBe(true);

    const beforeCount = await rows.count();

    // Required artefact: at least one screenshot of the roster with real rows.
    // The length is asserted as well as attached — an `attach` call that produced
    // an empty buffer would otherwise pass silently.
    const rosterShot = await page.screenshot({ fullPage: false });
    expect(rosterShot.length, "the roster screenshot is real image data").toBeGreaterThan(5_000);
    await testInfo.attach("students-roster.png", {
      body: rosterShot,
      contentType: "image/png",
    });

    // ---- 05 §6.3 — search narrows, and a dead search stays honest ------------
    const search = page.getByRole("combobox", { name: "Search students" }).first();
    await expectVisible(search, "in-screen search box");

    // (a) A search on a REAL value from a real row narrows the roster to exactly
    // the rows that match. Polling for an exact count (not for "fewer than before")
    // is deliberate: a new query key renders the roster skeleton, whose zero rows
    // satisfy any upper-bound poll before the read has landed.
    await search.fill(searchTokenOf(firstRowLabel));
    await expect
      .poll(async () => rows.count(), {
        timeout: 25_000,
        message: "roster narrowed to the matching rows",
      })
      .toBe(1);
    // The survivor is the row that was searched for, not an arbitrary one.
    await expect(rows.first(), "the surviving row is the one that matched").toHaveAttribute(
      "aria-label",
      firstRowLabel,
    );

    // (b) A search that matches NOBODY.
    await search.fill("zzzzz-no-such-student");
    await expect
      .poll(async () => rows.count(), { timeout: 20_000, message: "roster narrowed to nobody" })
      .toBe(0);

    // An honest empty state: it says what happened, it says the roster is NOT
    // gone, and it offers the one control that undoes the narrowing.
    await expectVisible(
      page.getByText(/Your roster is unchanged/i).first(),
      "no-match state names the roster as intact (E13)",
    );
    await expectVisible(
      page.getByText(/widen the search to see everyone again/i).first(),
      "no-match state says how to get back (E13)",
    );
    const undo = page.getByRole("button", { name: /^Clear search and filters$/ });
    await expectVisible(undo, "no-match state offers the undo control");
    await expect(undo, "the undo control is not a dead button").toBeEnabled();

    // THE THING THAT JUST FAILED, stated correctly this time. The previous spec
    // asserted the Add Student CTA VANISHES when a search matches nobody. The app
    // is right and that assertion was wrong: the primary CTA belongs to the
    // screen header, not to the list body, so it stays visible — and enabled —
    // while the list shows a zero-match state. Hiding it would be the defect.
    //
    // What must NOT happen is the narrowed state growing its OWN "add" recovery,
    // which would invite a tutor to re-enter a roster they still have (the trap
    // `narrowingLabel` exists to avoid). Counted across the whole screen, so a
    // second add control inside the empty state would make this 2.
    const addCta = page.getByRole("button", { name: /^Add Student$/ });
    await expect(addCta, "exactly one Add Student CTA — the header's, not the empty state's")
      .toHaveCount(1);
    await expectVisible(addCta, "the primary CTA stays reachable on a narrowed roster");
    await expect(addCta, "the primary CTA is not disabled on a narrowed roster").toBeEnabled();

    // (c) Clearing restores the roster.
    await undo.click();
    await expect
      .poll(async () => rows.count(), { timeout: 20_000, message: "roster restored" })
      .toBe(beforeCount);

    // ---- 05 §6.1 / §14 — the add sheet's fields and validation are real ------
    await addCta.click();
    const sheet = page.getByRole("dialog", { name: "Add New Student" });
    await expectVisible(sheet, "Add Student sheet");

    // The sheet's real fields, by their real accessible names. `*` is the visible
    // required marker in the label text, so the regexes are anchored on the word.
    for (const [label, name] of [
      [/^Full Name/, "Full Name *"],
      [/^Phone Number/, "Phone Number"],
      [/^Batch Name/, "Batch Name *"],
      [/^Grade\/Class/, "Grade/Class"],
      [/^Fee Model/, "Fee Model"],
      [/^Monthly Fee/, "Monthly Fee (₹)"],
      [/^School/, "School"],
      [/^Board/, "Board"],
      [/^Address/, "Address"],
      [/^Gender/, "Gender"],
    ] as const) {
      await expectAttached(sheet.getByLabel(label), `sheet field: ${name}`);
    }
    // ---- The two date controls (VERDICT: the SPEC was stale, the swap is right)
    //
    // This assertion used to ask for a BUTTON ("Pick a date" / "Date: …") and it
    // stopped matching. The cause was not a regression: a previous lane replaced
    // `react-day-picker` with a native `<input type="date">` (Ponytail rung 4 — the
    // platform primitive is the right answer for one plain single-date field), and
    // `ui/calendar.tsx` went with it. `ui/date-picker.tsx` now renders an input and
    // `add-student-sheet.tsx` gives it the `id` its `<label htmlFor>` needs.
    //
    // So the SPEC was stale and is corrected here. Deliberately, the old assertion
    // is not merely deleted: `type === "date"` below FAILS if anyone reverts to a
    // button trigger, so the swap cannot be silently undone by this file.
    //
    // The controls are located by the `id` the caller passes (`as-dob`,
    // `as-joined-at`) rather than by `getByLabel`, because of a real defect
    // reported by this lane and owned by `ui/date-picker.tsx`: that component sets
    // `aria-label="Pick a date"` on EVERY field by default, and `aria-label` wins
    // over `<label for>` in the accessible-name computation. Both date fields
    // therefore announce "Pick a date" and nothing says WHICH date (WCAG 2.5.3).
    // The label association itself is asserted here — it exists and it points at
    // this control — and the accessible-NAME requirement is asserted against
    // source in `add-student-sheet.dates.test.tsx`, where the fix can land.
    for (const [id, name] of [
      ["as-dob", "Date of Birth"],
      ["as-joined-at", "Admission Date *"],
    ] as const) {
      const control = sheet.locator(`#${id}`);
      await expectAttached(control, `sheet field: ${name}`);
      // 1. Reachable BY ITS LABEL — a visible <label> bound to this control, which
      //    is the mechanism the swap bought and the reason a button trigger fails.
      await expectVisible(
        sheet.locator(`label[for="${id}"]`),
        `${name}: a visible label is bound to the control`,
      );
      await expect(
        sheet.locator(`label[for="${id}"]`),
        `${name}: the label names this field`,
      ).toHaveText(new RegExp(`^${name}`));
      // 2. Focusable and in the tab order.
      const focusable = await control.evaluate((el) => {
        const node = el as HTMLElement;
        return node.tabIndex >= 0 && !node.hasAttribute("disabled");
      });
      expect(focusable, `${name} takes keyboard focus`).toBe(true);
      await control.focus();
      await expect
        .poll(
          () =>
            control
              .evaluate((el) => el === document.activeElement)
              .catch(() => false),
          { timeout: 5_000, message: `${name} receives keyboard focus` },
        )
        .toBe(true);
      // 3. It really is the date control, not a text box or a button wearing a date
      //    label. This is the assertion that fails on a revert to the picker.
      await expect(control, `${name} is a native date input`).toHaveAttribute("type", "date");
      expect(
        await control.evaluate((el) => el.tagName),
        `${name} is an INPUT, not a BUTTON`,
      ).toBe("INPUT");
    }

    const dob = sheet.locator("#as-dob");
    const admission = sheet.locator("#as-joined-at");

    // The value round trip, on the real control: what a tutor types in Date of
    // Birth is what the field reports back. This is the same invariant the unit
    // suite asserts against `createStudent`, checked here at the DOM boundary.
    // `input[type=date]` accepts an ISO `yyyy-mm-dd` fill exactly as the OS picker
    // would produce it.
    await dob.fill("2015-04-12");
    await expect(dob, "the typed date of birth is on the control").toHaveValue("2015-04-12");
    await admission.fill("2026-06-01");
    await expect(admission, "the typed admission date is on the control").toHaveValue(
      "2026-06-01",
    );

    const save = sheet.getByRole("button", { name: "Save student" });
    await expectVisible(save, "save control");

    // §14: the dates are validated, and the refusal names the field. An admission
    // date in the future is refused by `checkDateBounds` BEFORE `onSubmit` runs, so
    // this issues no duplicate check and writes nothing. The message is matched on
    // its distinguishing phrase, not on "admission date" — the visible LABEL says
    // that too, so a looser matcher would pass on the label alone.
    await admission.fill("2999-01-01");
    await save.click();
    await expectVisible(
      sheet.getByText(/Admission date cannot be later than/i),
      "a date outside the §14 window is refused and named",
    );
    await expectVisible(sheet, "the sheet stays open after a refused date");
    // Put it back so the rest of the walk is not running with a bad value.
    await admission.fill("2026-06-01");

    // §14: an empty name and an empty batch are required, and the error is on
    // the field rather than in a toast.
    await save.click();
    await expectVisible(sheet.getByText(/Name is required/i), "name is required");
    await expectVisible(sheet.getByText(/Batch is required/i), "batch is required");
    // Still open: a refused submit must not close the sheet.
    await expectVisible(sheet, "sheet still open after a refused submit");

    // §14 / 09 §14.5: a phone that is not 10–15 digits is refused, with the field
    // named. Schema validation runs before `onSubmit`, so this attempt issues no
    // duplicate check and writes nothing.
    await sheet.getByLabel(/^Full Name/).fill(AUDIT_NAME);
    await sheet.getByLabel(/^Batch Name/).fill("ZZAudit Batch");
    await sheet.getByLabel(/^Phone Number/).fill("call me later");
    await save.click();
    await expectVisible(
      sheet.getByText(/is not a phone number/i),
      "phone rule states the field (09 §14.5)",
    );
    // Still open, and the sheet must not have committed anything.
    await expectVisible(sheet, "sheet still open after a refused phone");

    // A well-formed phone clears the error — the control is not just refusing.
    // No click: this is a field re-validation, not a submit, so nothing is written.
    await sheet.getByLabel(/^Phone Number/).fill("+91 98765-43210");
    await expect
      .poll(
        async () => (await sheet.getByText(/is not a phone number/i).count()) === 0,
        { timeout: 10_000, message: "phone error cleared once the value is valid" },
      )
      .toBe(true);

    // BR-STU-04 / §14: the auto toggle is on by default and hides the code field;
    // turning it off reveals it, and a blank code is still acceptable there.
    const autoToggle = sheet.getByLabel(/Generate the student code for me/i);
    await expect(autoToggle, "auto-code toggle is on by default").toBeChecked();
    await expect(
      sheet.getByLabel(/^Student Code/i),
      "code field hidden while auto is on",
    ).toHaveCount(0);
    await autoToggle.uncheck();
    await expectVisible(sheet.getByLabel(/^Student Code/i), "code field revealed");
    await expect(sheet.getByLabel(/^Student Code/i), "a blank code is accepted").toHaveValue("");
    await autoToggle.check();
    await expect(
      sheet.getByLabel(/^Student Code/i),
      "code field hidden again once auto is back on",
    ).toHaveCount(0);

    // Close WITHOUT saving. The form is dirty, so Escape must raise the discard
    // prompt rather than silently throwing the tutor's typing away — and nothing
    // on this path can submit.
    await page.keyboard.press("Escape");
    const discard = page.getByRole("alertdialog", { name: "Unsaved changes" });
    await expectVisible(discard, "a dirty sheet asks before discarding");
    await discard.getByRole("button", { name: "Discard" }).click();
    await expect(sheet, "add sheet closed without saving").toBeHidden();
    // The roster is untouched: still exactly the students we found.
    await expect
      .poll(async () => rows.count(), { timeout: 10_000, message: "roster untouched by the sheet" })
      .toBe(beforeCount);

    // ---- 05 §6.4 — the detail drawer and every tab --------------------------
    await rows.first().click();
    const detail = page.getByRole("region", { name: "Student detail" });
    await expectVisible(detail, "student detail region");
    const drawer = detail.getByRole("tabpanel").first();
    await expectVisible(drawer, "student detail drawer panel");

    // The tabs are a real tablist with arrow-key movement (13_UI_Guidelines.md
    // §10), so the count is read from the tablist itself.
    const tablist = detail.getByRole("tablist", { name: "Student detail sections" });
    await expectAttached(tablist, "drawer tablist");
    const tabs = tablist.getByRole("tab");
    const tabCount = await tabs.count();
    expect(tabCount, "the drawer has more than one tab").toBeGreaterThan(1);

    for (let index = 0; index < tabCount; index += 1) {
      const tab = tabs.nth(index);
      const tabName = (await tab.innerText()).trim();
      await tab.click();
      await expect(tab, `tab "${tabName}" is selected`).toHaveAttribute("aria-selected", "true");
      // §18 / 13 §10.4: a tab points at ITS OWN panel, not at whichever is open.
      const controls = await tab.getAttribute("aria-controls");
      const panelId = await drawer.getAttribute("id");
      expect(controls, `tab "${tabName}" controls the open panel`).toBe(panelId);
      // Each tab renders CONTENT — a non-empty panel, not an empty shell.
      await expectVisible(drawer, `tab "${tabName}" renders its panel`);
      const text = ((await drawer.innerText()) ?? "").trim();
      expect(text.length, `tab "${tabName}" panel has content`).toBeGreaterThan(0);
    }

    // Back to Overview for the identity-field checks.
    await tabs.nth(0).click();
    await expectVisible(drawer, "overview panel visible");

    // §18: a missing field states an em dash rather than rendering blank. Read
    // the real label/value pairs out of the Identity block — no field may be
    // empty, and an empty one must be "—".
    const identity = await drawer.evaluate((panel) => {
      const heading = Array.from(panel.querySelectorAll("h3")).find(
        (h) => h.textContent?.trim() === "Identity",
      );
      const block = heading?.parentElement;
      if (!block) return null;
      return Array.from(block.querySelectorAll("div"))
        .filter((d) => d.className.includes("min-w-0") && d.children.length === 2)
        .map((d) => ({
          label: d.children[0]?.textContent?.trim() ?? "",
          value: d.children[1]?.textContent?.trim() ?? "",
        }));
    });
    expect(identity, "the Identity block rendered").not.toBeNull();
    const fields = identity ?? [];
    const labels = fields.map((f) => f.label);
    for (const required of [
      "Phone",
      "Email",
      "School",
      "Board",
      "Grade",
      "DOB",
      "Gender",
      "Admission",
      "Address",
    ]) {
      expect(labels, `the drawer states the ${required} field`).toContain(required);
    }
    for (const field of fields) {
      expect(
        field.value,
        `"${field.label}" is a value or an explicit em dash, never blank`,
      ).not.toBe("");
    }

    // Keyboard parity: arrow keys move between tabs (05 §18, 13 §10).
    await tabs.first().focus();
    const firstTabName = (await tabs.first().innerText()).trim();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () => tabs.nth(1).getAttribute("aria-selected"),
        { timeout: 8_000, message: "ArrowRight moved to the next tab" },
      )
      .toBe("true");
    expect((await tabs.nth(1).innerText()).trim()).not.toBe(firstTabName);
    // Exactly one tabbable stop (roving tabindex) — four tabIndex=0 buttons is
    // not a tablist, it is four separate links in a row.
    const tabbable = await tablist.evaluate((el) =>
      Array.from(el.querySelectorAll('[role="tab"]')).filter(
        (t) => (t as HTMLElement).tabIndex === 0,
      ).length,
    );
    expect(tabbable, "the tablist has exactly one tab stop").toBe(1);

    // ---- 05 §16 / Rule 1 — the delete warning is honest ----------------------
    await tabs.nth(0).click();
    const deleteButton = detail.getByRole("button", { name: "Delete student" });
    await expectAttached(deleteButton, "delete control");
    await deleteButton.click();
    const confirm = page.getByRole("alertdialog", { name: "Delete student" });
    await expectVisible(confirm, "delete confirmation");
    const warning = await confirm.innerText();
    // The gateway deletes the roster row and the batch enrollments ONLY.
    // `ledger_entries` is append-only at the database level (AGENTS.md §2 Rule 1),
    // so the copy must not claim a ledger entry is deleted — and it must not claim
    // the other way either.
    expect(warning, "the warning does not claim the ledger is deleted").not.toMatch(
      /ledger entries are deleted/i,
    );
    expect(warning, "the warning names the batch memberships as lost").toMatch(
      /batch memberships/i,
    );
    expect(warning, "the warning states the ledger is preserved").toMatch(
      /never deleted|stay exactly as they are/i,
    );
    expect(warning, "the warning names the destructive action on the record").toMatch(
      /Delete \S+/,
    );
    // Escape cancels: nothing is deleted by an audit run.
    await page.keyboard.press("Escape");
    await expect(confirm, "delete confirmation dismissed").toBeHidden();
    await expect
      .poll(async () => rows.count(), { timeout: 10_000, message: "roster intact after cancel" })
      .toBe(beforeCount);

    await testInfo.attach("students-detail-drawer.png", {
      body: await page.screenshot({ fullPage: false }),
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