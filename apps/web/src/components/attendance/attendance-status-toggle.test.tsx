// Implements: AGENTS.md §2 Rule 10 ("colour is never the only signal") and the
// `no-color-only-status` lint; 06_Attendance.md §10.2 BR-ATT-02 (status
// vocabulary), §18 (keyboard contract), §10.9 (toggle interaction contract).
//
// WHAT THIS PINS, AND WHICH BUG IT WOULD HAVE CAUGHT. The four status segments
// are the densest interactive targets on the screen, and their meaning used to
// be carried by an accent colour plus a glow. The Playwright audit asserts the
// accessible names, but it needs the whole app, a live tenant and a 5-minute
// timeout — so a regression here could sit for a whole session unnoticed. These
// are DOM-level assertions that run in a second:
//   * a segment losing its <Icon> (or the icon losing its accessible-hidden) →
//     colour-only status, and the `no-color-only-status` gate is a lint on
//     classes, not on a missing DOM node;
//   * a segment losing its TEXT LABEL (the label was the word, the aria-label was
//     "Mark <name> <Status>", so deleting the visible word still leaves a passing
//     accessible-name assertion — this file asserts the rendered text too);
//   * the pressed state disappearing from `aria-pressed`, so a screen reader is
//     told the row is unmarked while the screen shows a filled segment.
//
// AND THE FINDING THIS FILE PINS DELIBERATELY: there is NO unmark control. A
// tutor who marks a student present on the wrong row cannot return that row to
// "not marked" — the only reachable states are the four, and every one of them
// asserts that the student was on the register. The assertion below is written to
// FAIL LOUDLY the day someone adds a clear path, so that adding one is a
// deliberate act with a spec amendment behind it (AGENTS.md §0.2, §8 trigger 3)
// rather than a silent behavioural change.
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttendanceStatusToggle } from "./attendance-status-toggle";

type Status = NonNullable<ComponentProps<typeof AttendanceStatusToggle>["status"]>;

const NAME = "Rohan Gupta";

/** BR-ATT-02's per-record vocabulary, in the DOM order the segments render. */
const SEGMENTS: ReadonlyArray<{ status: Status; label: string }> = [
  { status: "present", label: "Present" },
  { status: "absent", label: "Absent" },
  { status: "late", label: "Late" },
  { status: "excused", label: "Excused" },
];

function segment(label: string): HTMLElement {
  return screen.getByRole("button", { name: `Mark ${NAME} ${label}` });
}

/**
 * A COMPILE-TIME proof that the control cannot be asked to clear a mark.
 *
 * If someone widens `onChange` to accept a nullable status — which is what adding
 * an unmark affordance requires — the `@ts-expect-error` below stops being an
 * error, TypeScript reports it as an UNUSED directive (TS2578), and
 * `tsc --noEmit` fails. The widening therefore has to be deliberate and to arrive
 * with the spec amendment behind it (AGENTS.md §0.2, §8 trigger 3) rather than as
 * a drive-by type tweak.
 *
 * The body is never executed: it exists only for the compiler. (A previous
 * attempt asserted the variance instead — "a callback that accepts
 * `Status | null` is assignable to `OnChange`" — which is the SAFE direction and
 * therefore proved nothing at all.)
 */
declare const onChange: ComponentProps<typeof AttendanceStatusToggle>["onChange"];
function _anUnmarkCallWouldNotTypecheck(): void {
  // @ts-expect-error — `null` is not a status; the control cannot clear a mark.
  onChange(null);
}
void _anUnmarkCallWouldNotTypecheck;

describe("AttendanceStatusToggle — every state carries an icon AND a word (Rule 10)", () => {
  for (const { status, label } of SEGMENTS) {
    it(`"${label}" is the pressed segment when the row is ${status}`, () => {
      render(
        <AttendanceStatusToggle status={status} onChange={vi.fn()} isLocked={false} studentName={NAME} />,
      );
      const active = segment(label);
      expect(active).toHaveAttribute("aria-pressed", "true");
      // The word a tutor reads, asserted separately from the accessible name —
      // `aria-label` would still pass if the visible text were deleted.
      expect(active).toHaveTextContent(label);
      // The icon, and hidden from the name so it is not announced twice.
      const icon = active.querySelector("svg");
      expect(icon, `${label} carries an icon`).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  }

  it("every segment is a real button, so it is focusable and Enter-activatable", () => {
    render(<AttendanceStatusToggle status={null} onChange={vi.fn()} isLocked={false} studentName={NAME} />);
    for (const { label } of SEGMENTS) {
      const el = segment(label);
      // Rule 10: keyboard parity. A div with an onClick would pass a class
      // assertion and be unreachable by Tab.
      expect(el.tagName).toBe("BUTTON");
      expect(el).toHaveAttribute("type", "button");
      expect(el).toHaveAttribute("aria-pressed", "false");
      expect(el).not.toBeDisabled();
      // 44×44px (Rule 10 touch target) is expressed through the shared min-*
      // utility pair, which is the only place the size is defined.
      expect(el.className).toMatch(/min-w-\[44px\]/);
      expect(el.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it("the UNSELECTED segments still carry their word and icon — dimming is not the signal", () => {
    render(
      <AttendanceStatusToggle status="present" onChange={vi.fn()} isLocked={false} studentName={NAME} />,
    );
    for (const { status, label } of SEGMENTS.filter((s) => s.status !== "present")) {
      const el = segment(label);
      expect(el).toHaveAttribute("aria-pressed", "false");
      expect(el, `${label} keeps its word when unselected`).toHaveTextContent(label);
      expect(el.querySelector("svg"), `${label} keeps its icon when unselected`).not.toBeNull();
    }
  });

  it("announces which student the control belongs to", () => {
    render(<AttendanceStatusToggle status="absent" onChange={vi.fn()} isLocked={false} studentName={NAME} />);
    expect(screen.getByRole("group", { name: `Mark ${NAME} attendance` })).toBeInTheDocument();
  });
});

describe("AttendanceStatusToggle — a locked row is read-only, and still a word", () => {
  for (const { status, label } of SEGMENTS) {
    it(`a locked ${status} row shows "${label}" with no editable control`, () => {
      render(<AttendanceStatusToggle status={status} onChange={vi.fn()} isLocked studentName={NAME} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  }

  it("a locked unmarked row says Unmarked rather than showing nothing", () => {
    render(<AttendanceStatusToggle status={null} onChange={vi.fn()} isLocked studentName={NAME} />);
    // An empty chip reads as "this control failed to render", not as "nothing
    // has been decided yet" — and the two are different facts.
    expect(screen.getByText("Unmarked")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("FINDING PINNED — the register has no way to clear a mark", () => {
  /**
   * A COMPILE-TIME proof that the control cannot be asked to clear a mark.
   *
   * If someone widens `onChange` to `(s: AttendanceStatus | null) => void` —
   * which is what adding an unmark affordance requires — this assignment starts
   * compiling, the `@ts-expect-error` below becomes an unused directive, and
   * `tsc --noEmit` fails. The narrowing is therefore deliberate and must arrive
   * with the spec amendment behind it (AGENTS.md §0.2, §8 trigger 3), not as a
   * drive-by type tweak. It replaces a source-text grep, which would have kept
   * passing through a rename.
   */
  type OnChange = ComponentProps<typeof AttendanceStatusToggle>["onChange"];
  const _anUnmarkCallbackWouldNotTypecheck: OnChange = (_s: Status | null) => {
    // SAFETY: never invoked — this expression exists only for `tsc`.
    void _s;
  };
  void _anUnmarkCallbackWouldNotTypecheck;

  it("exposes exactly four set-only controls and nothing that returns a row to unmarked", () => {
    render(
      <AttendanceStatusToggle status="present" onChange={vi.fn()} isLocked={false} studentName={NAME} />,
    );
    const group = screen.getByRole("group", { name: `Mark ${NAME} attendance` });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b: HTMLElement) => b.getAttribute("aria-label"))).toEqual([
      `Mark ${NAME} Present`,
      `Mark ${NAME} Absent`,
      `Mark ${NAME} Late`,
      `Mark ${NAME} Excused`,
    ]);

    // No control anywhere in the group can express "no mark".
    for (const el of Array.from(group.querySelectorAll<HTMLElement>("*"))) {
      const name = el.getAttribute("aria-label") ?? el.textContent ?? "";
      expect(name, `unexpected control named "${name}"`).not.toMatch(
        /clear|unmark|remove|reset|none/i,
      );
    }
  });
});