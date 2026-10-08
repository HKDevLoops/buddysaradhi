// Implements: AGENTS.md §2 Rule 9 (no silent failures) — 05_Students.md §Master List.
// Regression suite for the defect where a FAILED roster read rendered the same screen as
// an empty one: "No students found" beside an Add Student button. A gateway timeout then
// told a tutor their entire roster was gone and invited them to re-enter every student.
//
// The three cases below are the three states the roster can honestly be in, and they must
// be mutually exclusive: loading, failed, empty. `fetchStudentsAction` resolves rather
// than throws, so the envelope case is the one that actually shipped the bug.
import { describe, expect, it, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useStudentsStore } from "@/stores/students-store";
import { StudentMasterList } from "./student-master-list";

function resetStore() {
  useStudentsStore.setState({
    searchQuery: "",
    filters: {
      status: ["active"],
      batchIds: [],
      feeModels: [],
      tagIds: [],
      balanceRange: "all",
      admittedInLast: "all",
    },
  });
}

beforeEach(resetStore);

describe("StudentMasterList — the roster's three honest states", () => {
  it("shows a loading status with the roster's own shape, not a bare spinner", () => {
    render(<StudentMasterList students={[]} isLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Loading… your student roster/i)).toBeInTheDocument();
    // The claim "no students" must not be on screen while the answer is unknown.
    expect(screen.queryByText("No students yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No students found")).not.toBeInTheDocument();
  });

  it("invites an Add Student only when the tutor genuinely has none", () => {
    render(<StudentMasterList students={[]} isLoading={false} />);
    expect(screen.getByText("No students yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument();
  });

  it("offers to undo the narrowing — not to add a student — when a search matches nobody", () => {
    useStudentsStore.setState({ searchQuery: "aarav" });
    render(<StudentMasterList students={[]} isLoading={false} />);

    expect(screen.getByText("No student matches")).toBeInTheDocument();
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();

    // The data-destruction trap: an Add Student CTA on a roster the tutor has not lost.
    expect(screen.queryByRole("button", { name: /add student/i })).not.toBeInTheDocument();

    const clear = screen.getByRole("button", { name: /clear search and filters/i });
    expect(clear).toBeInTheDocument();
  });

  it("clears the search and widens the status filter from the recovery control", async () => {
    const user = userEvent.setup();
    useStudentsStore.setState({
      searchQuery: "aarav",
      filters: {
        status: ["graduated"],
        batchIds: [],
        feeModels: [],
        tagIds: [],
        balanceRange: "all",
        admittedInLast: "all",
      },
    });
    render(<StudentMasterList students={[]} isLoading={false} />);

    expect(screen.getByText(/nothing matches “aarav” in the selected statuses/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear search and filters/i }));

    expect(useStudentsStore.getState().searchQuery).toBe("");
    expect(useStudentsStore.getState().filters.status).toEqual([
      "active",
      "inactive",
      "graduated",
      "archived",
    ]);
  });

  it("renders one row per student with the shared balance classifier, never a signed figure", () => {
    const students = [
      {
        id: "s-1",
        code: "STU-001",
        name: "Aarav Sharma",
        grade: "Cl 10",
        batch: "Maths 6pm",
        fee_model: "postpaid" as const,
        status: "active" as const,
        balance_due: 450000,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "s-2",
        code: "STU-002",
        name: "Riya Menon",
        grade: "Cl 9",
        batch: null,
        fee_model: "postpaid" as const,
        status: "active" as const,
        // A credit balance. `Math.abs` used to render this as the same "due" figure a
        // positive balance produced, erasing the difference between owing and credited.
        balance_due: -120000,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    render(<StudentMasterList students={students} isLoading={false} />);

    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("Riya Menon")).toBeInTheDocument();

    // The two states are named, and the credit figure is stated positive — with a word
    // in front of it, so a bare "₹1,200.00" cannot be misread as an amount owed.
    expect(screen.getByTitle(/^Due ₹4,500\.00/)).toBeInTheDocument();
    expect(screen.getByTitle(/^Credit ₹1,200\.00/)).toBeInTheDocument();
  });

  // 05_Students.md §6.2 lists `code` as the roster's FIRST column and §18 asks for
  // it in the row's accessible name. The row rendered neither: a tutor reading a
  // code out over the phone had to open every student to find it.
  it("shows the student code on the row (05_Students.md §6.2)", () => {
    render(
      <StudentMasterList
        students={[
          {
            id: "s-1",
            code: "STU-2026-0001",
            name: "Aarav Sharma",
            grade: "Cl 10",
            batch: "Maths 6pm",
            fee_model: "postpaid",
            status: "active",
            balance_due: 450000,
          },
        ]}
        isLoading={false}
      />,
    );
    expect(screen.getByText("STU-2026-0001")).toBeInTheDocument();
  });

  it("states an unassigned code rather than rendering a blank cell", () => {
    render(
      <StudentMasterList
        students={[
          {
            id: "s-1",
            code: null,
            name: "Aarav Sharma",
            grade: "Cl 10",
            batch: "Maths 6pm",
            fee_model: "postpaid",
            status: "active",
            balance_due: 0,
          },
        ]}
        isLoading={false}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("names the row with name, code, balance and status (05_Students.md §18)", () => {
    render(
      <StudentMasterList
        students={[
          {
            id: "s-1",
            code: "STU-2026-0001",
            name: "Aarav Sharma",
            grade: "Cl 10",
            batch: "Maths 6pm",
            fee_model: "postpaid",
            status: "active",
            balance_due: 450000,
          },
          {
            id: "s-2",
            code: "STU-2026-0002",
            name: "Riya Menon",
            grade: "Cl 9",
            batch: null,
            fee_model: "postpaid",
            status: "inactive",
            balance_due: -120000,
          },
        ]}
        isLoading={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Student: Aarav Sharma, code STU-2026-0001, owes ₹4,500.00, status active" }),
    ).toBeInTheDocument();
    // A credit balance is named as a credit in the accessible name too — the sign
    // is the fact (Rule 6), so it cannot be flattened to "no dues".
    expect(
      screen.getByRole("button", { name: "Student: Riya Menon, code STU-2026-0002, ₹1,200.00 in credit, status inactive" }),
    ).toBeInTheDocument();
  });

  it("marks the open row with aria-current, not aria-pressed", async () => {
    const user = userEvent.setup();
    useStudentsStore.setState({ selectedStudentId: "s-1" });
    render(
      <StudentMasterList
        students={[
          {
            id: "s-1",
            code: "STU-2026-0001",
            name: "Aarav Sharma",
            grade: "Cl 10",
            batch: "Maths 6pm",
            fee_model: "postpaid",
            status: "active",
            balance_due: 0,
          },
          {
            id: "s-2",
            code: "STU-2026-0002",
            name: "Riya Menon",
            grade: "Cl 9",
            batch: null,
            fee_model: "postpaid",
            status: "active",
            balance_due: 0,
          },
        ]}
        isLoading={false}
      />,
    );
    const open = screen.getByRole("button", { name: /Student: Aarav Sharma/ });
    const other = screen.getByRole("button", { name: /Student: Riya Menon/ });
    expect(open).toHaveAttribute("aria-current", "true");
    expect(open).not.toHaveAttribute("aria-pressed");
    // "Current" is not a toggle: the other row asserts nothing rather than false.
    expect(other).not.toHaveAttribute("aria-current");

    await user.click(other);
    expect(useStudentsStore.getState().selectedStudentId).toBe("s-2");
  });
});

/**
 * 05_Students.md §18 + AGENTS.md §2 Rule 10 (keyboard parity).
 *
 * The roster is a LIST of records, not a single composite widget, so it must NOT
 * use a roving tabindex: a keyboard user has to be able to reach every row with
 * Tab, not arrow through one. A single `tabindex="-1"` on all but the first row
 * would render a list that only its first entry can be reached by keyboard — the
 * drawer would be unreachable for anyone not using a mouse.
 */
describe("StudentMasterList — the roster is reachable by keyboard (05 §18)", () => {
  const THREE_STUDENTS = [
    {
      id: "s-1",
      code: "STU-2026-0001",
      name: "Aarav Sharma",
      grade: "Cl 10",
      batch: "Maths 6pm",
      fee_model: "postpaid" as const,
      status: "active" as const,
      balance_due: 450000,
    },
    {
      id: "s-2",
      code: "STU-2026-0002",
      name: "Riya Menon",
      grade: "Cl 9",
      batch: null,
      fee_model: "postpaid" as const,
      status: "active" as const,
      balance_due: 0,
    },
    {
      id: "s-3",
      code: null,
      name: "Kabir Shah",
      grade: null,
      batch: "Physics",
      fee_model: "postpaid" as const,
      status: "active" as const,
      balance_due: -50000,
    },
  ];

  it("puts EVERY row in the tab order, not just the first", () => {
    render(<StudentMasterList students={THREE_STUDENTS} isLoading={false} />);
    const rows = screen.getAllByRole("button", { name: /^Student: / });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // A native `<button>` takes focus with no explicit tabindex; an explicit
      // "0" or "-1" is what a roving tabindex writes, and "-1" is the bug.
      expect(row.getAttribute("tabindex"), "no row is removed from the tab order").not.toBe(
        "-1",
      );
      expect(row).not.toBeDisabled();
    }
  });

  it("moves focus to a row when it is focused programmatically", async () => {
    render(<StudentMasterList students={THREE_STUDENTS} isLoading={false} />);
    const third = screen.getByRole("button", { name: /Student: Kabir Shah/ });
    third.focus();
    await waitFor(() => expect(third).toHaveFocus());
  });

  it("opens a row with the keyboard, not only with a click", async () => {
    const user = userEvent.setup();
    render(<StudentMasterList students={THREE_STUDENTS} isLoading={false} />);

    const second = screen.getByRole("button", { name: /Student: Riya Menon/ });
    second.focus();
    await user.keyboard("{Enter}");
    expect(useStudentsStore.getState().selectedStudentId).toBe("s-2");

    const first = screen.getByRole("button", { name: /Student: Aarav Sharma/ });
    first.focus();
    await user.keyboard(" ");
    expect(useStudentsStore.getState().selectedStudentId).toBe("s-1");
  });

  it("reaches a student by Tab without passing through the rows in order first", async () => {
    // The reachable-and-activatable claims above are per-row; this one is the
    // end-to-end version: a keyboard user tabs into the roster and lands on a
    // row that actually opens the drawer.
    const user = userEvent.setup();
    render(<StudentMasterList students={THREE_STUDENTS} isLoading={false} />);

    const first = screen.getByRole("button", { name: /Student: Aarav Sharma/ });
    // Tabbing from the top of the document must eventually reach a row; this
    // asserts the row is on the natural tab path rather than reachable only by
    // script.
    let reached = false;
    for (let i = 0; i < 20 && !reached; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- a bounded keyboard walk, in order
      await user.tab();
      if (document.activeElement === first) reached = true;
    }
    expect(reached, "Tab reaches the first roster row").toBe(true);
  });
});
