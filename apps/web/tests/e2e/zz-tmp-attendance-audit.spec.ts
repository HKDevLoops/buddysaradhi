// Attendance audit walkthrough — engineer lane ATTENDANCE-R2, 2026-10-06.
//
// Drives the SHARED harness (tests/e2e/harness.ts): login, Zustand screen
// switch, element-scoped waits (a cold Supabase edge isolate makes fixed sleeps
// lie), and console/page error capture that fails the test.
//
// WHAT THIS SPEC PROVES (06_Attendance.md is the contract):
//   §6.1/§3   the day view renders, and changing the date / batch re-reads it
//   §10.2/§18 every mark state is reachable BY KEYBOARD and each carries an
//             icon AND a text label — colour is never the only signal (Rule 10,
//             `no-color-only-status`)
//   §9.7      BR-CALC-06: a period with nothing to measure reads "—", never
//             "NaN%" and never a fabricated "0%"
//   §10.7     the bulk-absent gate is a TYPED confirmation, and a dirty sheet
//             asks before discarding (13_UI §8.7 / EC-AU-01)
//   §5/§10.3/§10.6 the lock sheet opens and its PIN validation is honest: the
//             bound is stated, a malformed PIN is refused locally, a wrong PIN is
//             refused with a message, and NOTHING is written
//   §7        no heatmap affordance and no "Generate Report" (owner decision)
//   Rule 9    zero console errors, zero page errors, zero 4xx/5xx
//
// TENANT SAFETY — the QA tenant is left exactly as found:
//   * Every bulk-absent path is CANCELLED. The confirm button is never clicked,
//     so no `attendance_bulk_mark` row and no mark is ever written.
//   * Exactly ONE mark is changed, and only on a row that ALREADY has one: the
//     per-row control has no "unmark" affordance, so a row with no mark could
//     not be put back. The mark is made BY KEYBOARD and restored BY KEYBOARD,
//     and the restore is asserted on `aria-pressed` AND on the row's own
//     accessible name — which is the same string the screen reader announces.
//   * The lock sheet is never submitted with a valid PIN: locking sets
//     `locked_at`, and nothing in the product can clear it, so a spec that
//     locked the QA session could not undo it.
//   * A snapshot of the summary strip is taken before the bulk section and
//     compared after it, so "the bulk committed nothing" is proved from the
//     screen rather than assumed.
import { expect, test, type Locator } from "@playwright/test";
import { format } from "date-fns";
import fs from "node:fs";
import path from "node:path";
import {
  captureErrors,
  expectAttached,
  expectVisible,
  gotoScreen,
  login,
  QA_PIN,
} from "./harness";

/** BR-ATT-02 vocabulary, verbatim. Order is the DOM order of the segments. */
const MARK_LABELS = ["Present", "Absent", "Late", "Excused"] as const;
type MarkLabel = (typeof MARK_LABELS)[number];

/** The stored status, exactly as the spec writes it: `present | absent | late |
 *  excused`. This is what a row's own accessible name announces. */
type MarkStatus = "present" | "absent" | "late" | "excused";

/** The word printed on the segment a tutor clicks. Sentence case, and NOT the
 *  enum — so the two are asserted separately rather than by one loose regex. */
const LABEL_FOR_STATUS: Record<MarkStatus, MarkLabel> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};

/** 06 §18 keyboard contract: P / A / L on the focused row. `excused` has no
 *  shortcut by design — it is reached by tabbing to the segment and pressing
 *  Enter, which is what the spec proves. */
const MARK_KEYS: Partial<Record<MarkLabel, string>> = {
  Present: "p",
  Absent: "a",
  Late: "l",
};

interface ParsedRow {
  readonly name: string;
  readonly status: MarkStatus | "not marked";
}

/** `"{name}, {status}. Keys: P present, A absent, L late, Enter to flip …"`.
 *  Greedy on the name so a student called "Rao, Ananya" still parses. */
function parseRowLabel(label: string): ParsedRow | null {
  const match = /^(.*), (present|absent|late|excused|not marked)\. Keys:/.exec(label);
  if (!match || !match[1] || !match[2]) return null;
  return { name: match[1].trim(), status: match[2] as ParsedRow["status"] };
}

function isoDaysAgo(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

test.describe("Attendance screen audit", () => {
  test("day view, one reversible keyboard mark, the typed bulk gate, BR-CALC-06 dash, and the lock sheet's honest PIN refusal", async ({
    page,
  }, testInfo) => {
    // The shared `playwright.config.ts` sets a 60s test timeout, which this
    // walkthrough exceeds honestly: it drives five preset summaries, each a
    // separate server-action round trip, on top of login and the day view.
    // Per-test only; the config is not this lane's file.
    test.setTimeout(300_000);

    const errors = captureErrors(page);

await login(page);
await gotoScreen(page, "Attendance");
    // Rule 9's network half. `markSettled()` arms the harness's failed-response
    // listener (it is opt-in, so a signed-out cold start's 401 is not attributed
    // to the screen under audit); this lane asserts the list is empty at a
    // checkpoint after the day view and again at the end.
    errors.markSettled();

    // Element-scoped settle barrier: the bulk bar's heading only renders once
    // the day's rows are in hand, and it disappears again while the next date
    // is in flight, so waiting on it is "the screen re-read the day", not a sleep.
    const rosterHeading = page.getByRole("heading", { name: /^\d+ Students/ });
    const settle = async (label: string): Promise<void> => {
      await expect(rosterHeading, label).toBeVisible({ timeout: 25_000 });
    };

    const dateInput = page.getByLabel("Select Date").first();
    const batchSelect = page.getByLabel("Batch").first();
    const dateCaption = page
      .getByRole("heading", { level: 1, name: "Attendance", exact: true })
      .first()
      .locator("xpath=following-sibling::*[1]");

    // ---- 06 §6.1 — the day view renders -------------------------------------
    await expectVisible(
      page.getByRole("heading", { level: 1, name: "Attendance", exact: true }).first(),
      "attendance screen heading",
    );
    await expectVisible(dateInput, "date picker");
    await expectVisible(batchSelect, "batch selector");
    await settle("day view roster loaded");

    // EC-A-01 / §11 E5 / §14: the picker must not offer a future day. `max` is
    // the UTC day (`todayIso`), which is the same day the writer's gate uses.
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(await dateInput.getAttribute("max"), "date picker caps at today").toBe(todayIso);
    expect(await dateInput.inputValue()).toBe(todayIso);

    // §18: the summary strip announces its counts. Scoped by its own accessible
    // name — an unscoped `getByRole("status")` resolves the SHELL's sync
    // indicator ("Sync: online, all changes saved"), which is a different
    // component entirely.
    const summaryStrip = page.getByRole("status", {
      name: /\d+ present, \d+ absent, \d+ late, \d+ excused/,
    });
    await expectVisible(summaryStrip, "attendance summary strip");
    expect(await summaryStrip.getAttribute("aria-label")).toMatch(
      /^\d+ present, \d+ absent, \d+ late, \d+ excused$/,
    );

    // §10.7: the two bulk controls exist and are 44px targets (Rule 10).
    const markAllPresent = page.getByRole("button", { name: /^Mark \d+ unmarked?/ }).first();
    const markAllAbsent = page.getByRole("button", {
      name: /^Mark all \d+ students? in view absent\./,
    }).first();
    await expectAttached(markAllPresent, "Mark all Present");
    await expectAttached(markAllAbsent, "Mark all Absent");
    // Both bulk buttons carry an explicit `aria-label`, so their ACCESSIBLE name
    // is the long "Mark all N students in view absent. Opens a confirmation…"
    // string and their visible text is only the inner text node. Assert the
    // visible word too — Rule 10 wants the word a tutor actually reads, and a
    // query on the accessible name alone would never see it.
    await expectVisible(
      page.locator("button", { hasText: "Mark all Absent" }),
      "the bulk-absent button's visible word",
    );
    await expectVisible(
      page.locator("button", { hasText: "Mark all Present" }),
      "the bulk-present button's visible word",
    );

    // ---- 07 § owner decision — reports are gone ------------------------------
    expect(await page.getByText(/heatmap/i).count(), "no heatmap affordance").toBe(0);
    expect(
      await page.getByRole("button", { name: /generate report/i }).count(),
      "no Generate Report control",
    ).toBe(0);

    // ---- nothing here may need a horizontal scroll to be seen -----------------
    // The shell's scroll region is `overflow-auto`, so a screen whose content is
    // wider than its column hands that region a horizontal scrollbar — and the
    // FIRST thing that brings an overflowing control into view (a click, a Tab,
    // a screen reader's "scroll into view") leaves the region scrolled right,
    // sliding the whole left column under the fixed sidebar. Measured on the
    // pre-fix build at 1280×720: `scrollWidth` 1296 vs `clientWidth` 1024, and
    // once scrolled every roster row's name sat at x=129 — behind the sidebar,
    // so a tutor saw four mark buttons per row and no student on any of them.
    const shellRegion = page.locator('[role="region"][aria-label="Attendance content"]');
    await expectVisible(shellRegion, "the shell's Attendance scroll region");
    const regionBox = await shellRegion.boundingBox();
    const readRegion = (): Promise<{ scroll: number; client: number; left: number }> =>
      shellRegion.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        left: el.scrollLeft,
      }));
    expect(
      (await readRegion()).scroll,
      "the Attendance screen fits its content column — it must not create a horizontal scrollbar",
    ).toBeLessThanOrEqual((await readRegion()).client);

    // ---- 06 §3 — the date re-reads the day, and is put back ------------------
    const captionBefore = (await dateCaption.innerText()).trim();
    await dateInput.fill(isoDaysAgo(todayIso, 1));
    await settle("yesterday's roster loaded");
    expect(await dateCaption.innerText(), "the caption follows the date").not.toBe(captionBefore);
    await expect(dateInput).toHaveValue(isoDaysAgo(todayIso, 1));

    await dateInput.fill(todayIso);
    await settle("today's roster restored");
    expect(
      (await dateCaption.innerText()).trim(),
      "the caption is exactly as found",
    ).toBe(captionBefore);
    expect(await dateInput.inputValue()).toBe(todayIso);

    // The batch dimension. `selectedBatch` is part of the query key, so a real
    // switch must re-read. With a single batch in the tenant the selector is
    // honest about it rather than offering a dead option.
    const batchOptions = await batchSelect.locator("option").allTextContents();
    expect(batchOptions.length, "All batches always exists").toBeGreaterThanOrEqual(1);
    expect(batchOptions[0]).toBe("All batches");
    expect(await batchSelect.inputValue()).toBe("all");
    if (batchOptions.length > 1) {
      const other = batchSelect.locator("option").nth(1);
      const otherValue = await other.getAttribute("value");
      expect(otherValue).toBeTruthy();
      await batchSelect.selectOption(otherValue!);
      await settle("switched batch re-read the roster");
      expect(await batchSelect.inputValue()).toBe(otherValue);
      await batchSelect.selectOption("all");
      await settle("batch restored");
      expect(await batchSelect.inputValue()).toBe("all");
    }

    // ---- 06 §10.2 / §18 — marks: icon + text + keyboard, one reversible ------
    const rows = page.locator('[role="group"][aria-label*="Keys:"]');
    const rowCount = await rows.count();
    const parsed: ParsedRow[] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const p = parseRowLabel((await rows.nth(i).getAttribute("aria-label")) ?? "");
      expect(p, `row ${i} announces its own current mark`).not.toBeNull();
      parsed.push(p!);
    }

    if (rowCount === 0) {
      // EC-A-06 / §11 E7: an empty roster is an empty state, not a failure.
      await expectAttached(
        page.getByText(/nobody is enrolled|no student matches/i).first(),
        "empty roster state",
      );
    }

    /** A row is either editable (four buttons) or read-only (one status chip). */
    const lockBadge = page
      .getByRole("button", { name: /^(Lock this session|Session locked|Session unlocked)/ })
      .first();
    const lockBadgeLabel = (await lockBadge.getAttribute("aria-label")) ?? "";
    const sessionIsLocked = !/^Lock this session/.test(lockBadgeLabel);

    const marksBeforeBulk = (await summaryStrip.getAttribute("aria-label")) ?? "";
    /**
     * THE TENANT BASELINE. Every row's own accessible name carries its current
     * mark, so this string array is the whole day's attendance as found. It is
     * re-read at the end of the walk and compared item for item: a spec that
     * changed a mark and did not put it back fails on the LAST line rather than
     * leaving the QA tenant altered for the next lane.
     */
    const readRoster = async (): Promise<string[]> => {
      const labels: string[] = [];
      const n = await rows.count();
      for (let i = 0; i < n; i += 1) labels.push((await rows.nth(i).getAttribute("aria-label")) ?? "");
      return labels;
    };
    const rosterBaseline = await readRoster();

    if (rowCount > 0) {
      const target = parsed.findIndex((p) => p.status !== "not marked");
      const row = rows.nth(target >= 0 ? target : 0);
      const here = target >= 0 ? parsed[target]! : parsed[0]!;
      const segment = (label: MarkLabel): Locator =>
        row.getByRole("button", { name: `Mark ${here.name} ${label}` }).first();

      if (sessionIsLocked) {
        // §10.3 / §10.7: a frozen session is READ-ONLY. The per-row control
        // collapses to a labelled chip (no buttons to click) and the bulk bar
        // names the reason instead of offering two dead controls.
        await expect(row.getByRole("button"), "a locked row offers no editable control").toHaveCount(0);
        await expectVisible(
          row.getByText(new RegExp(`${escapeRe(here.name)}\\b`), { exact: false }),
          "locked row still names the student",
        );
        for (const ctl of [markAllPresent, markAllAbsent]) {
          await expect(ctl, "bulk actions are disabled on a locked session").toBeDisabled();
        }
        await expectVisible(
          page.getByText(/are locked — bulk marking is skipped/i).first(),
          "the bulk bar names the lock, not a broken control",
        );
      } else {
        // The row must SHOW who it is about. `AttendanceGrid` gives the name
        // block `min-w-0` and the toggle wrapper `w-full md:w-[260px]`; a
        // shrink-to-zero name block renders a row of four buttons with no
        // student on it, which `toBeAttached` would happily call a pass. Both
        // the name and the avatar are asserted VISIBLE (a zero-width box is not
        // visible to Playwright), on every row, at the default viewport.
        for (let i = 0; i < rowCount; i += 1) {
          const who = parsed[i]!;
          const line = rows.nth(i);
          const nameLocator = line.getByText(who.name, { exact: true });
          await expectVisible(nameLocator, `row ${i} shows the student's name on screen`);
          const nameBox = await nameLocator.boundingBox();
          expect(nameBox?.width ?? 0, `row ${i}: the name has width`).toBeGreaterThan(0);
          // …and it is inside the visible content column, not under the sidebar.
          expect(
            nameBox?.x ?? -1,
            `row ${i}: the name is clear of the shell's fixed sidebar`,
          ).toBeGreaterThanOrEqual(regionBox?.x ?? 0);
          await expectVisible(line.locator("img, [data-avatar], svg").first(), `row ${i} shows an avatar`);
        }

        // Rule 10 / BR-CALC-07: every state carries an ICON and a WORD. The
        // accessible name is asserted (never a class), the rendered text is
        // asserted (colour is never the only signal), an SVG is asserted, and
        // the box is asserted ≥44px.
        for (const label of MARK_LABELS) {
          const ctl = segment(label);
          await expectVisible(ctl, `${label} segment`);
          await expect(ctl).toHaveText(label);
          expect(await ctl.locator("svg").count(), `${label} carries an icon`).toBeGreaterThanOrEqual(1);
          expect(await ctl.getAttribute("aria-pressed"), `${label} carries its pressed state`).toMatch(
            /^(true|false)$/,
          );
          const box = await ctl.boundingBox();
          expect(box?.width ?? 0, `${label} segment width`).toBeGreaterThanOrEqual(44);
          expect(box?.height ?? 0, `${label} segment height`).toBeGreaterThanOrEqual(44);
        }

        // Keyboard reachability of the LAST segment, which has no P/A/L
        // shortcut: the row is a focus stop and four tabs land on Excused.
        await row.focus();
        for (let i = 0; i < MARK_LABELS.length; i += 1) await page.keyboard.press("Tab");
        await expect(segment("Excused"), "Excused is reachable by Tab").toBeFocused();

        if (target < 0) {
          // Loud, not quiet. The per-row control has no "unmark" affordance, so
          // with no pre-marked row on this day a mark could not be put back and
          // the spec does not make one — but then 06 §18's keyboard contract is
          // unproven, and a green line here would say otherwise. Fail with the
          // reason instead.
          expect(
            target,
            "no row on this day already carries a mark, so the reversible keyboard mark cannot be proven (the control has no unmark)",
          ).toBeGreaterThanOrEqual(0);
        } else {
          // Change ONE mark BY KEYBOARD, then put it back BY KEYBOARD.
          const original = here.status as MarkStatus;
          const originalLabel = LABEL_FOR_STATUS[original];
          const probe: MarkStatus = original === "late" ? "absent" : "late";
          const probeLabel = LABEL_FOR_STATUS[probe];
          const restore = async (viaKeyboard: boolean): Promise<void> => {
            const key = MARK_KEYS[originalLabel];
            if (viaKeyboard && key) {
              await row.focus();
              await page.keyboard.press(key);
              return;
            }
            await segment(originalLabel).click();
          };

          try {
            await row.focus();
            await page.keyboard.press(MARK_KEYS[probeLabel]!);
            await expect(segment(probeLabel), `${probeLabel} is set from the keyboard`).toHaveAttribute(
              "aria-pressed",
              "true",
            );
            await expect(
              row,
              "the row announces the new mark",
            ).toHaveAttribute("aria-label", new RegExp(`\\, ${probe}\\. Keys:`));

            // ---- restore, always, even if an assertion above threw ---------
            // Keyboard first (the same path the mark was made with); the
            // pointer click is only the fallback for `excused`, which has no
            // P/A/L shortcut by design.
            await restore(true);
            await expect(
              segment(originalLabel),
              `${originalLabel} restored`,
            ).toHaveAttribute("aria-pressed", "true");
            await expect(segment(probeLabel), `${probeLabel} cleared`).not.toHaveAttribute(
              "aria-pressed",
              "true",
            );
            await expect(row, "the row announces the restored mark").toHaveAttribute(
              "aria-label",
              new RegExp(`\\, ${original}\\. Keys:`),
            );
            await settle("roster settled after the reversible toggle");
          } finally {
            // Belt and braces: if the restore above did not land, put the row
            // back before the spec is allowed to fail.
            const stillProbe = await segment(probeLabel).getAttribute("aria-pressed");
            if (stillProbe === "true") {
              await restore(false);
              await expect(
                segment(originalLabel),
                `${originalLabel} restored in the finally`,
              ).toHaveAttribute("aria-pressed", "true");
            }
          }
          testInfo.annotations.push({
            type: "tenant-restored",
            description: `${here.name} was ${original}, changed to ${probe} by keyboard, and put back to ${original}.`,
          });
        }
      }
    }

    // ---- 06 §10.7 — the typed ABSENT gate, committed never -------------------
    if (!(await markAllAbsent.isDisabled())) {
      await expectVisible(
        page.locator("button", { hasText: "Mark all Absent" }),
        "bulk absent control",
      );

      // (a) A CLEAN sheet is escapable (13_UI §8.7) and closes on Escape alone.
      await markAllAbsent.click();
      const dialog = page.getByRole("dialog", { name: /mark \d+ students? absent/i });
      await expectVisible(dialog, "bulk-absent confirmation sheet");
      // §16 / §21.6 M5: the sheet states what will change BEFORE it asks.
      await expectVisible(
        dialog.getByText(/this overwrites \d+ of \d+ mark|changes nothing/i),
        "the sheet states its effect",
      );
      await expectVisible(
        dialog.getByText(/no bulk undo/i),
        "the sheet states that a bulk cannot be undone",
      );
      await page.keyboard.press("Escape");
      await expect(dialog, "a clean sheet closes on Escape").toBeHidden();

      // (b) The typed word is the gate. Nothing below presses the confirm.
      await markAllAbsent.click();
      await expectVisible(dialog, "bulk-absent confirmation sheet");
      const confirmBulk = dialog.getByRole("button", { name: /mark \d+ students? absent/i }).last();
      const typed = dialog.getByLabel(/type absent to confirm/i);
      await expect(confirmBulk, "confirm refused with an empty field").toBeDisabled();
      await typed.fill("absen");
      await expect(confirmBulk, "confirm refused on a partial word").toBeDisabled();
      await expectVisible(dialog.getByText(/does not match/i), "the mismatch is stated");
      await typed.fill("ABSENT");
      await expect(confirmBulk, "confirm enabled only on the whole word").toBeEnabled();

      // (c) A DIRTY sheet must ASK before discarding (EC-AU-01). This is the
      // assertion the previous version of this spec got wrong: it expected the
      // sheet to vanish on Escape, but the app correctly raised the shared
      // "Unsaved changes" prompt over it, because Escape must never silently
      // throw away a typed word.
      await page.keyboard.press("Escape");
      const discard = page.getByRole("alertdialog", { name: "Unsaved changes" });
      await expectVisible(discard, "a dirty sheet asks before discarding");
      await expectVisible(discard.getByText(/nothing you typed will be saved/i), "the prompt names the loss");
      await discard.getByRole("button", { name: /^Discard$/ }).click();
      await expect(dialog, "discard closes the sheet").toBeHidden();

      // Proof from the screen that the bulk committed nothing.
      expect(
        (await summaryStrip.getAttribute("aria-label")) ?? "",
        "no mark changed by the bulk section",
      ).toBe(marksBeforeBulk);
    } else {
      await expect(lockBadgeLabel, "a disabled bulk names its reason").toMatch(
        /Session locked|Lock this session/,
      );
    }

    // ---- 06 §7 / BR-CALC-06 — the percentage is an em dash, never NaN% -------
    // Checkpoint. Everything above this line — the day view, the reversible
    // mark, the bulk gate, the lock sheet's PIN refusal — is now covered, so a
    // failure inside the summary walk below cannot hide a defect up here.
    errors.assertNoErrors();

    const summaryOpen = page.getByRole("button", {
      name: /open attendance summary for a month, a quarter or the year/i,
    }).first();
    await expectVisible(summaryOpen, "summary sheet entry point");
    await summaryOpen.click();
    const summaryDialog = page.getByRole("dialog", { name: /attendance summary/i });
    await expectVisible(summaryDialog, "attendance summary sheet");

    const now = new Date();
    const startOf = (monthIndex: number): string => format(new Date(now.getFullYear(), monthIndex, 1), "do MMM yyyy");
    const presets: ReadonlyArray<readonly [string, string]> = [
      ["Current Month", startOf(now.getMonth())],
      ["Last Month", startOf(now.getMonth() - 1)],
      ["Last 3 Months", startOf(now.getMonth() - 2)],
      ["Last 6 Months", startOf(now.getMonth() - 5)],
      ["Full Year", startOf(0)],
    ];

    let dashesSeen = 0;
    for (const [preset, expectedStart] of presets) {
      const presetBtn = summaryDialog.getByRole("button", { name: preset, exact: true });
      await expectVisible(presetBtn, `preset ${preset}`);
      await presetBtn.click();
      await expect(presetBtn, `preset ${preset} selected`).toHaveAttribute("aria-pressed", "true");
      // The period caption is derived from the response, so waiting for the
      // EXPECTED caption is a retrying barrier that cannot read the previous
      // preset's rows.
      await expectVisible(
        summaryDialog.getByText(new RegExp(`^${escapeRe(expectedStart)} — `)),
        `preset ${preset} loaded its own period`,
      );

      // The StatCard's title and its value are NOT siblings — the title sits in
      // an inner flex row and the value is a sibling of THAT row — so the value
      // is reached from the title element, not with a `+ p` combinator.
      const pctTitle = summaryDialog.getByText("Attendance %", { exact: true });
      await expectVisible(pctTitle, `preset ${preset}: the Attendance % card`);
      const cardValue = (await pctTitle.locator("xpath=../..").locator("p").last().innerText()).trim();
      expect(cardValue, `preset ${preset}: Attendance % is a number or an em dash`).toMatch(/^(—|\d{1,3}%)$/);
      if (cardValue === "—") dashesSeen += 1;

      // The per-student rows: BR-CALC-06's exact claim. A student with nothing
      // measured in the period shows a dash, never "0%" and never "NaN%".
      const bodyRows = summaryDialog.locator("tbody tr");
      const bodyRowCount = await bodyRows.count();
      for (let r = 0; r < bodyRowCount; r += 1) {
        const cells = bodyRows.nth(r).locator("td");
        const total = (await cells.nth(5).innerText()).trim();
        const pct = (await cells.nth(6).innerText()).trim();
        expect(pct, `${preset}: a percentage is a number or an em dash`).toMatch(/^(—|\d{1,3}%)$/);
        expect(pct, `${preset}: never NaN`).not.toContain("NaN");
        if (total === "0") {
          expect(pct, `${preset}: nothing to measure reads as an em dash, not 0%`).toBe("—");
          dashesSeen += 1;
        }
      }
      expect(
        await summaryDialog.getByText(/NaN/).count(),
        `${preset}: no NaN anywhere in the sheet`,
      ).toBe(0);
    }
    expect(dashesSeen, "the em-dash path for an unmeasurable period was observed").toBeGreaterThan(0);

    await summaryDialog.getByRole("button", { name: "Close attendance summary" }).click();
    await expect(summaryDialog, "summary sheet closed").toBeHidden();

    // ---- 06 §5 / §10.3 / §10.6 — the lock sheet's validation is honest -------
    await expectVisible(lockBadge, "lock control");
    await lockBadge.click();
    const lockDialog = page.getByRole("dialog", {
      name: /(Lock|Unlock) Session|Request Unlock|Session Unlocked/i,
    });
    await expectVisible(lockDialog, "lock sheet");
    const lockHeading = (await lockDialog.getByRole("heading").first().innerText()).trim();
    expect(
      lockHeading,
      "an unlocked day offers the lock form (or states why it is locked)",
    ).toMatch(/^(Lock Session|Unlock Session|Request Unlock|Session Unlocked)$/);

    const pin = lockDialog.getByLabel(/security pin/i).first();
    await expectVisible(pin, "PIN field");
    // 06 §10.6 / 08 BR-SEC-02: the field states the bound the SERVER enforces.
    await expectVisible(
      lockDialog.getByText(/security pin \(4–8 digits\)/i),
      "the PIN bound is stated, not implied",
    );

    const lockConfirm = lockDialog.getByRole("button", { name: /confirm & (lock|unlock)/i }).first();
    await expect(lockConfirm, "confirm refused with an empty PIN").toBeDisabled();
    await pin.fill("12");
    await expectVisible(
      lockDialog.getByText(/at least 4 digits/i),
      "a malformed PIN is refused locally and named",
    );
    await expect(lockConfirm, "confirm still refused on a malformed PIN").toBeDisabled();

    await pin.fill("000000");
    await expect(lockConfirm, "a well-formed PIN unlocks the control").toBeEnabled();
    await lockConfirm.click();
    const refusal = lockDialog.getByRole("alert").first();
    await expectVisible(refusal, "the lock sheet states the refusal");
    expect(
      (await refusal.innerText()).trim(),
      "the refusal names the PIN and says nothing was written",
    ).toMatch(/pin/i);
    expect(await refusal.innerText()).toMatch(/nothing was written/i);

    // Nothing was written: the day is still unlocked.
    await settle("roster settled after the refused PIN");
    expect(
      (await lockBadge.getAttribute("aria-label")) ?? "",
      "the refused PIN left the session unlocked",
    ).toBe(lockBadgeLabel);

    // The close button is the direct way out (13_UI §8.7), but a typed PIN is
    // work the tutor would not want to lose silently.
    await lockDialog.getByRole("button", { name: "Close lock session sheet" }).click();
    const lockDiscard = page.getByRole("alertdialog", { name: "Unsaved changes" });
    await expectVisible(lockDiscard, "a typed PIN is not discarded silently");
    await lockDiscard.getByRole("button", { name: /^Discard$/ }).click();
    await expect(lockDialog, "lock sheet closed").toBeHidden();

    // The PIN is only ever typed into a field; it is never printed on screen.
    expect(
      await page.getByText(QA_PIN, { exact: false }).count(),
      "the PIN is never echoed on screen",
    ).toBe(0);

    // ---- nothing here may need a horizontal scroll to be seen -----------------
    // Re-checked AFTER the walk: every click, Tab and `toBeFocused()` in this
    // spec is an opportunity for the browser to scroll an overflowing control
    // into view. If the region has a horizontal overflow the first such click
    // slides the screen's left column under the sidebar and it stays there, so
    // the walk itself is what used to break the layout.
    const afterWalk = await readRegion();
    expect(
      afterWalk.scroll,
      "the Attendance screen still fits its column after the walk",
    ).toBeLessThanOrEqual(afterWalk.client);
    expect(afterWalk.left, "the scroll region was not left scrolled sideways").toBe(0);

    // ---- the day view itself, unobstructed -----------------------------------
    await settle("day view settled for the screenshot");
    await expect(page.getByRole("dialog"), "no sheet left open").toHaveCount(0);
    const shot = await page.screenshot();
    await testInfo.attach("attendance-day-view.png", { body: shot, contentType: "image/png" });
    // Also on disk, next to the other lanes' audit shots: `testInfo.attach`
    // alone is dropped by the `line` reporter for a passing test, so a reviewer
    // could not open the proof.
    const shotPath = path.resolve(process.cwd(), "test-results", "attendance-day-view.png");
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, shot);
    expect(fs.existsSync(shotPath), "the day-view screenshot is on disk").toBe(true);
errors.assertNoErrors();

    // ---- THE TENANT IS EXACTLY AS FOUND --------------------------------------
    // Read one last time, after every sheet has closed and every query has
    // settled, and compare row for row with the baseline taken before the
    // reversible mark. This is the last line of the spec on purpose: if it
    // fails, the audit has already reported what it changed and how to put it
    // back.
    await settle("roster settled for the final tenant check");
    expect(
      await readRoster(),
      "the day's marks are exactly as found — every row carries its original status",
    ).toEqual(rosterBaseline);
    expect(
      (await summaryStrip.getAttribute("aria-label")) ?? "",
      "the summary strip counts are exactly as found",
    ).toBe(marksBeforeBulk);
    expect(await dateInput.inputValue(), "the date is exactly as found").toBe(todayIso);
    expect(await batchSelect.inputValue(), "the batch is exactly as found").toBe("all");
  });
});

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}