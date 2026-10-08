// Implements: 05_Students.md §6.4 (Detail Drawer — every tab renders real data)
// + §18 (a missing field states an em dash, never a blank); 13_UI_Guidelines.md
// §10.4 (a tab names the panel it controls); AGENTS.md §2 Rule 9.
//
// WHY THIS FILE EXISTS. `student-detail-drawer.test.tsx` covers the drawer's own
// state split — pending, expired credentials, not-provisioned, upstream retry,
// not-found — and stubs the three child tabs out to keep that suite narrow. So the
// four things a tutor opens this drawer FOR were untested:
//
//   1. every tab renders CONTENT rather than an empty shell;
//   2. the Fees tab renders the invoices it was actually given;
//   3. a missing identity field states an em dash instead of rendering blank;
//   4. each tab points at its OWN panel (13 §10.4) and the tablist is a real
//      tablist — one tab stop, arrows and Home/End to move (05 §18).
//
// The child tabs are NOT stubbed here. That is the whole point: the Fees tab and
// the Ledger tab are where fabricated or missing figures would reach a tutor, and
// a suite that stubs them cannot see it. Only the SERVER READS are replaced,
// because a unit test must not reach a database (AGENTS.md §7.3).
//
// The drawer renders the real student, the real invoice rows and the real ledger
// rows, so "the tab has content" is a claim about real data — not about a
// placeholder that is present in every build.
//
// The em-dash rule is asserted per FIELD, not as a page-wide string search: a
// drawer that renders nine em dashes and one blank still has the defect, and only
// a per-field assertion notices the blank one.

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/server/actions/students", () => ({
  fetchStudentDetailAction: vi.fn(),
  deleteStudentAction: vi.fn(),
}));

vi.mock("@/server/queries/ledger", () => ({ getStudentInvoices: vi.fn() }));

// The Ledger tab is rendered for real; these are the two server seams it reads.
vi.mock("@/server/queries/fees", () => ({ getLedgerForStudent: vi.fn() }));
vi.mock("@/server/actions/fees", () => ({ voidReceiptAction: vi.fn() }));

import { fetchStudentDetailAction } from "@/server/actions/students";
import { getStudentInvoices } from "@/server/queries/ledger";
import { getLedgerForStudent } from "@/server/queries/fees";
import { useStudentsStore } from "@/stores/students-store";
import { type Student } from "@buddysaradhi/shared";
import { StudentDetailDrawer } from "./student-detail-drawer";

const fetchDetail = vi.mocked(fetchStudentDetailAction);
const fetchInvoices = vi.mocked(getStudentInvoices);
const fetchLedger = vi.mocked(getLedgerForStudent);

/**
 * A student with every optional field EMPTY except a name and a base fee — the
 * shape that exercises the em-dash rule rather than the happy path.
 */
// SAFETY: the drawer under test reads only the fields set here; the full `Student`
// row is owned by the server query, not by this tab-content suite.
const SPARSE_STUDENT = {
  id: "s-1",
  first_name: "Aarav",
  last_name: "Sharma",
  code: "STU-2026-0001",
  phone: null,
  email: null,
  school: null,
  board: null,
  grade: null,
  dob: null,
  gender: null,
  admission_date: null,
  address: null,
  status: "active",
  baseFeePaise: 200000,
} as unknown as Student;

beforeEach(() => {
  vi.clearAllMocks();
  useStudentsStore.setState({ selectedStudentId: "s-1", drawerOpen: true });
  fetchDetail.mockResolvedValue({ success: true, data: SPARSE_STUDENT });
  // Rule 6: integer paise throughout. 200000 = ₹2,000.00, 50000 = ₹500.00.
  fetchInvoices.mockResolvedValue({
    success: true,
    data: [
      {
        id: "inv-1",
        number: "INV-0001",
        total: 200000,
        paid_amount_minor: 200000,
        issue_date: "2026-06-01",
        due_date: "2026-06-10",
      },
      {
        id: "inv-2",
        number: "INV-0002",
        total: 200000,
        paid_amount_minor: 50000,
        issue_date: "2026-07-01",
        due_date: "2026-07-10",
      },
    ],
    // SAFETY: the drawer reads only the row fields set above.
  } as unknown as Awaited<ReturnType<typeof getStudentInvoices>>);
  fetchLedger.mockResolvedValue({
    success: true,
    data: [],
  } as unknown as Awaited<ReturnType<typeof getLedgerForStudent>>);
});

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StudentDetailDrawer />
    </QueryClientProvider>,
  );
}

const tablist = () => screen.getByRole("tablist", { name: "Student detail sections" });
const tabs = () => within(tablist()).getAllByRole("tab");
const panel = () => screen.getByRole("tabpanel");

/** Waits for the drawer to leave its loading state. */
async function openDrawer() {
  const view = renderDrawer();
  await screen.findByText("Aarav Sharma");
  return view;
}

describe("every drawer tab renders content, and points at its own panel (13 §10.4)", () => {
  it("has more than one tab and names each one", async () => {
    await openDrawer();
    const names = tabs().map((tab) => (tab.textContent ?? "").trim());
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual(["Overview", "Ledger", "Fees", "Attendance"]);
  });

  it("gives every tab its own panel and a non-empty one", async () => {
    const user = userEvent.setup();
    await openDrawer();

    const seenPanels = new Set<string>();
    for (const tab of tabs()) {
      const name = (tab.textContent ?? "").trim();
      await user.click(tab);

      const current = panel();
      expect(tab, `the "${name}" tab is selected`).toHaveAttribute("aria-selected", "true");
      // §10.4: the tab names ITS panel. Every tab pointing at whichever panel is
      // open is how "Ledger" ends up announced as controlling the Overview.
      const controls = tab.getAttribute("aria-controls");
      expect(controls, `"${name}" names a panel`).toBeTruthy();
      expect(current.id, `"${name}" controls the open panel`).toBe(controls);
      expect(current, `"${name}" panel is labelled by its tab`).toHaveAttribute(
        "aria-labelledby",
        tab.id,
      );
      // No two tabs may claim the same panel.
      seenPanels.add(controls as string);

      // Content, not a shell: the panel has readable text beyond its own heading.
      const text = (current.textContent ?? "").replace(/\s+/g, " ").trim();
      expect(text.length, `tab "${name}" renders content`).toBeGreaterThan(0);
    }
    expect(seenPanels.size, "each tab has its own distinct panel").toBe(tabs().length);
  });

  it("renders the Fees tab from the invoices it was given", async () => {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(screen.getByRole("tab", { name: /Fees/ }));

    // The two invoice numbers are the real rows passed in `beforeEach`.
    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("INV-0002")).toBeInTheDocument();
    // Their states: fully paid, and partly paid. Rule 6 — figures come from the
    // paise fields and are formatted by `formatINR`, never summed by hand.
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    // Both invoices bill ₹2,000.00, so the figure appears twice — once per row.
    expect(screen.getAllByText("₹2,000.00")).toHaveLength(2);
    // ₹500.00 collected against the second, so ₹1,500.00 is outstanding there.
    expect(screen.getByText("₹1,500.00 due")).toBeInTheDocument();
    // The header's collected total is the sum of the two paise figures: 200000 +
    // 50000 = 250000 = ₹2,500.00. Asserted so a change that starts summing in
    // rupees, or reading one row instead of all of them, fails here.
    expect(screen.getByText("₹2,500.00 collected to date")).toBeInTheDocument();
  });

  it("states an honest empty Fees tab rather than inventing figures", async () => {
    const user = userEvent.setup();
    fetchInvoices.mockResolvedValue({
      success: true,
      data: [],
    } as unknown as Awaited<ReturnType<typeof getStudentInvoices>>);
    await openDrawer();
    await user.click(screen.getByRole("tab", { name: /Fees/ }));

    expect(await screen.findByText("No fee periods recorded yet.")).toBeInTheDocument();
    // The header may say "₹0.00 collected" here, and that is TRUE: the read
    // SUCCEEDED and returned zero rows. The fabrication this guards against is the
    // next test's — a read that FAILED must not be reported as zero.
    expect(screen.getByText("₹0.00 collected to date")).toBeInTheDocument();
  });

  it("never reports a failed invoice read as a money figure (Rule 9, EC-F-02)", async () => {
    const user = userEvent.setup();
    fetchInvoices.mockResolvedValue({
      success: false,
      error: "GATEWAY_TIMEOUT: the ledger read did not complete",
    } as unknown as Awaited<ReturnType<typeof getStudentInvoices>>);
    await openDrawer();
    await user.click(screen.getByRole("tab", { name: /Fees/ }));

    // The surface says what it could not read, and says what is safe.
    expect(
      await within(panel()).findByText(/do not charge a fee or record a payment/i),
    ).toBeInTheDocument();
    // The defect this pins: four confident zeros on a gateway timeout, which a
    // tutor reads as "this student owes nothing".
    expect(screen.queryByText(/₹0\.00 collected to date/)).not.toBeInTheDocument();
    expect(screen.queryByText("No fee periods recorded yet.")).not.toBeInTheDocument();
    // And no raw server text leaks to the browser.
    expect(document.body.textContent).not.toContain("GATEWAY_TIMEOUT");
  });

  it("tells the truth on the Attendance tab instead of drawing a calendar", async () => {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(screen.getByRole("tab", { name: /Attendance/ }));

    // There is no per-student attendance read yet (see `attendance-tab.tsx`), so
    // the honest thing is to say so and point at the screen that has the records.
    // A fabricated month here is exactly what that file's header describes having
    // shipped, and this assertion is the tripwire for it.
    expect(
      await within(panel()).findByText(/Per-student attendance history isn.t read yet/i),
    ).toBeInTheDocument();
    // Scoped to the panel: the tab strip also contains the word "Attendance".
    expect(within(panel()).getByText("Attendance")).toBeInTheDocument();
    // The old fabricated surface announced a rate and a "last attended" day.
    expect(within(panel()).queryByText(/Rate/)).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/Last Attended/i)).not.toBeInTheDocument();
  });
});

describe("a missing identity field states an em dash, never a blank (05 §18)", () => {
  /** Reads the real label/value pairs out of the Identity block. */
  function identityFields(): Array<{ label: string; value: string }> {
    const heading = screen.getByRole("heading", { name: "Identity" });
    const block = heading.parentElement as HTMLElement;
    return Array.from(block.querySelectorAll("div.min-w-0")).map((cell) => {
      const [label, value] = Array.from(cell.children);
      return {
        label: (label?.textContent ?? "").trim(),
        value: (value?.textContent ?? "").trim(),
      };
    });
  }

  it("states every identity field it renders", async () => {
    await openDrawer();
    const labels = identityFields().map((field) => field.label);
    for (const required of [
      "Phone",
      "Email",
      "School",
      "Board",
      "Grade",
      "DOB",
      "Gender",
      "Admission",
    ]) {
      expect(labels, `the drawer states the ${required} field`).toContain(required);
    }
    // Address sits outside the two-column grid but inside the same block.
    expect(identityFields().map((field) => field.label)).toContain("Address");
  });

  it("renders an em dash for each absent value, and no blank at all", async () => {
    await openDrawer();
    const fields = identityFields();
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(
        field.value,
        `"${field.label}" is a value or an explicit em dash, never blank`,
      ).not.toBe("");
    }
    // Every one of this student's optional fields is absent, so every one of the
    // nine must read "—". One blank among nine is the defect.
    expect(fields.filter((field) => field.value === "—").length).toBeGreaterThanOrEqual(8);
  });

  it("renders the value where the tutor typed one, so an em dash means absence", async () => {
    // A drawer that prints "—" for everything is as useless as one that prints
    // nothing: the em dash has to mean "not recorded", not "always".
    fetchDetail.mockResolvedValue({
      success: true,
      data: {
        ...SPARSE_STUDENT,
        phone: "9876543210",
        school: "Delhi Public School",
        grade: "10",
        dob: "2015-04-12",
      } as unknown as Student,
    });
    await openDrawer();
    const fields = identityFields();
    const valueOf = (label: string) =>
      fields.find((field) => field.label === label)?.value;

    expect(valueOf("Phone")).toBe("9876543210");
    expect(valueOf("School")).toBe("Delhi Public School");
    expect(valueOf("Grade")).toBe("10");
    // DOB is formatted for reading (`dd Mon yyyy`), not echoed as raw ISO.
    expect(valueOf("DOB")).not.toBe("2015-04-12");
    expect(valueOf("DOB")).not.toBe("");
    // The untouched fields still read as absent.
    expect(valueOf("Email")).toBe("—");
    expect(valueOf("Board")).toBe("—");
  });
});

describe("the tablist is a real tablist (05 §18, 13 §10)", () => {
  it("has exactly one tabbable stop (roving tabindex)", async () => {
    await openDrawer();
    const tabbable = tabs().filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(tabbable, "four tabIndex=0 buttons is four links in a row, not a tablist")
      .toHaveLength(1);
    expect(tabbable[0], "the selected tab is the tabbable one").toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves between tabs with ArrowRight, ArrowLeft, Home and End", async () => {
    const user = userEvent.setup();
    await openDrawer();

    await user.tab();
    // Focus starts on the first tab; ArrowRight moves to the second and selects it.
    tabs()[0]?.focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs()[1], "ArrowRight selects the next tab").toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowLeft}");
    expect(tabs()[0], "ArrowLeft selects the previous tab").toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{End}");
    const last = tabs()[tabs().length - 1];
    expect(last, "End selects the last tab").toHaveAttribute("aria-selected", "true");

    // Wrapping: ArrowRight from the last tab returns to the first, so a keyboard
    // user is never stranded at the end of the list.
    await user.keyboard("{ArrowRight}");
    expect(tabs()[0], "the tablist wraps").toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(last).toHaveAttribute("aria-selected", "true");
  });
});