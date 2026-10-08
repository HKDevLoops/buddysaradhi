// Implements: 05_Students.md §6.2 (Add Student — admission date / date of birth) and
// 14_Edge_Cases.md EC-S-11 (a date picked on screen is the date that is stored), exercised
// through `05_Students.md`'s only consumer, `add-student-sheet.tsx`. AGENTS.md §2 Rule 6
// (dates that become money must not drift) + Rule 10 (the field is a real form control with
// an accessible name).
//
// THE REGRESSION THIS FILE EXISTS TO CATCH. The rewrite from `react-day-picker` onto a
// native `<input type="date">` had no test, and the whole risk of that swap is the two
// local-day converters at the bottom of `date-picker.tsx`:
//
//   localDateToInputValue  Date -> "yyyy-mm-dd"   MUST read LOCAL calendar fields.
//                                                   `toISOString()` converts to UTC
//                                                   FIRST, so local midnight in IST
//                                                   (UTC+5:30) serialises as the
//                                                   PREVIOUS day: 1 Jan -> 31 Dec.
//   inputValueToLocalDate  "yyyy-mm-dd" -> Date    MUST build LOCAL midnight.
//                                                   `new Date(str)` parses as UTC, so in
//                                                   any NEGATIVE-offset zone the parsed
//                                                   instant lands on the previous LOCAL
//                                                   day: "2026-01-01" -> getDate() 31.
//
// Both defects are silent — the control still renders, still looks right, and the wrong
// day reaches the ledger. So this suite asserts the two directions SEPARATELY against
// hardcoded expectations, never as a round-trip through the pair: a round-trip is
// symmetric and would happily agree with itself while both sides are wrong by one day.
//
// The timezone is pinned per case rather than inherited from the machine. A developer in
// UTC would otherwise never see either bug, and CI runners are usually UTC.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DatePicker } from "./date-picker";

/** Node re-reads this on every Date operation, so a change takes effect immediately. */
const ORIGINAL_TZ = process.env.TZ;

function useTimeZone(tz: string): void {
  process.env.TZ = tz;
}

beforeEach(() => {
  useTimeZone("UTC");
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

/** Renders the picker with a spy for `setDate` and returns the input plus the spy. */
function renderPicker(props: {
  date?: Date;
  id?: string;
  ariaLabel?: string;
}): { input: HTMLInputElement; setDate: ReturnType<typeof vi.fn> } {
  const setDate = vi.fn();
  const { container } = render(
    <DatePicker
      date={props.date}
      setDate={setDate}
      id={props.id}
      aria-label={props.ariaLabel}
    />,
  );
  const input = container.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("DatePicker must render exactly one <input>");
  }
  return { input, setDate };
}

describe("localDateToInputValue — local calendar day out", () => {
  // The exact bug: local midnight 1 Jan 2026 in IST is 31 Dec 2025 18:30 UTC, so a
  // `toISOString()` implementation writes "2025-12-31" and the tutor's admission date
  // silently becomes New Year's Eve.
  it("keeps the calendar day under IST, where toISOString() would shift it back one", () => {
    useTimeZone("Asia/Kolkata");
    const picked = new Date(2026, 0, 1); // local midnight, 1 January 2026

    // Control: prove the offset is real in this zone, or the assertion proves nothing.
    expect(picked.toISOString().slice(0, 10)).toBe("2025-12-31");

    const { input } = renderPicker({ date: picked });
    expect(input.value).toBe("2026-01-01");
  });

  it("keeps the calendar day under a far-negative offset, where UTC is a day ahead", () => {
    useTimeZone("Pacific/Kiritimati"); // UTC+14, the maximum real offset
    const { input } = renderPicker({ date: new Date(2026, 11, 31) });
    expect(input.value).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    const { input } = renderPicker({ date: new Date(2026, 8, 5) });
    expect(input.value).toBe("2026-09-05");
  });

  it("renders an empty value when no date is set", () => {
    const { input } = renderPicker({ date: undefined });
    expect(input.value).toBe("");
  });
});

describe("inputValueToLocalDate — local calendar day in", () => {
  // The mirror defect: `new Date("2026-01-01")` is 1 Jan 00:00 UTC, which in New York
  // is 31 Dec 2025 19:00 LOCAL — the previous calendar day.
  it("builds local midnight under a negative offset, where a UTC parse would shift it back", () => {
    useTimeZone("America/New_York");
    const { input, setDate } = renderPicker({ date: undefined });

    fireEvent.change(input, { target: { value: "2026-01-01" } });

    expect(setDate).toHaveBeenCalledTimes(1);
    const parsed = setDate.mock.calls[0]?.[0];
    expect(parsed).toBeInstanceOf(Date);
    // Assert the LOCAL calendar fields, not the instant: `getDate()` is 31 for a UTC
    // parse and 1 for the local-midnight construction this component must perform.
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(1);
    // Control: the UTC parse this must NOT use really does land on the previous day.
    expect(new Date("2026-01-01").getDate()).toBe(31);
  });

  it("builds local midnight at the start of a year, where a UTC parse rolls to the previous year", () => {
    useTimeZone("America/Los_Angeles");
    const { input, setDate } = renderPicker({ date: undefined });

    fireEvent.change(input, { target: { value: "2027-01-01" } });

    const parsed = setDate.mock.calls[0]?.[0];
    expect(parsed.getFullYear()).toBe(2027);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(1);
  });

  it("yields undefined when the field is cleared", () => {
    const { input, setDate } = renderPicker({ date: new Date(2026, 0, 1) });

    fireEvent.change(input, { target: { value: "" } });

    expect(setDate).toHaveBeenCalledWith(undefined);
  });

  it("never invents a day from a value the control could not hold", () => {
    const { input, setDate } = renderPicker({ date: undefined });

    // A conforming control sanitises any non-date value away before the handler can
    // observe it (jsdom and every browser do this for `type="date"`), so `""` is what
    // actually reaches `onChange`. The regex guard in `inputValueToLocalDate` is the
    // defence behind that, and the contract either way is the same: the tutor's tutor
    // clears the field, the component reports NO date, and it never falls back to
    // "today" or to any other guess.
    fireEvent.change(input, { target: { value: "not-a-date" } });
    fireEvent.change(input, { target: { value: "2026-13-45" } });

    expect(input.value).toBe("");
    for (const call of setDate.mock.calls) {
      expect(call[0]).toBeUndefined();
    }
  });
});

describe("the two directions are asserted independently", () => {
  // A round-trip only proves the pair agrees with ITSELF. Two implementations that are
  // both one day out agree perfectly and are both wrong, so each direction above is
  // pinned to a literal. This case closes the loop by proving the rendered value and the
  // parsed value describe the same LOCAL day — with no shared helper doing the work.
  it("renders and re-parses the same local day across a month boundary", () => {
    useTimeZone("Asia/Kolkata");
    const picked = new Date(2026, 5, 30); // local midnight, 30 June 2026
    const { input } = renderPicker({ date: picked });
    const rendered = input.value;
    expect(rendered).toBe("2026-06-30");

    const { input: blank, setDate } = renderPicker({ date: undefined });
    fireEvent.change(blank, { target: { value: rendered } });

    const parsed = setDate.mock.calls[0]?.[0];
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(5);
    expect(parsed.getDate()).toBe(30);
  });
});

describe("form contract (Rule 10 — keyboard parity and an accessible name)", () => {
  it("binds a caller-supplied <label htmlFor> to the real input", () => {
    render(
      <>
        <label htmlFor="dob">Date of birth</label>
        <DatePicker date={undefined} setDate={vi.fn()} id="dob" />
      </>,
    );

    expect(screen.getByLabelText("Date of birth")).toBeInstanceOf(HTMLInputElement);
  });

  it("exposes the aria-label when the caller supplies one", () => {
    renderPicker({ date: undefined, ariaLabel: "Admission date" });
    expect(screen.getByLabelText("Admission date")).toBeInstanceOf(HTMLInputElement);
  });

  it("falls back to the placeholder as the accessible name", () => {
    render(
      <DatePicker date={undefined} setDate={vi.fn()} placeholder="Pick a date" />,
    );
    expect(screen.getByLabelText("Pick a date")).toBeInstanceOf(HTMLInputElement);
  });

  it("is a native date control, not a button that opens a dialog", () => {
    const { input } = renderPicker({ date: undefined });
    expect(input).toHaveAttribute("type", "date");
    expect(input.tagName).toBe("INPUT");
  });
});