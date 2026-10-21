// Implements: 08_Settings.md §6.2.12 (Diagnostics → "Run integrity check":
// a real control, a result stated in words, and the "Restore from last
// backup" CTA on a mismatch); 12_Business_Rules.md BR-LED-06; 10_Security.md
// §9.4 (the violation is surfaced); AGENTS.md §2 Rule 9 (the outcome is
// stated, never faked), Rule 10 (44px targets, the result is ANNOUNCED to a
// screen reader, and the status is carried by words and an icon — never by
// colour alone).
//
// The action is the only stub: it is the seam between the panel and the
// reconciler, and the reconciler has its own test (the real DB, the real
// hash construction). What is pinned HERE is the panel's behaviour — that the
// button exists, that it is reachable by keyboard, that the three outcomes
// are three DIFFERENT sentences, and that none of them is a silent no-op.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  runLedgerIntegrityCheckAction: vi.fn(),
}));

vi.mock("@/server/actions/diagnostics", () => ({
  runLedgerIntegrityCheckAction: mocks.runLedgerIntegrityCheckAction,
}));

import { DiagnosticsSection } from "./diagnostics-section";

beforeEach(() => {
  vi.clearAllMocks();
});

/** The panel runs its check through react-query, so it needs the provider. */
function renderPanel(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DiagnosticsSection />
    </QueryClientProvider>,
  );
}

describe("Settings → Diagnostics → the integrity check", () => {
  it("has a real control, and it says it reads rather than writes", () => {
    mocks.runLedgerIntegrityCheckAction.mockResolvedValue({
      success: true,
      studentsChecked: 0,
      entriesChecked: 0,
      failures: [],
      checkedAt: "2026-09-21T10:00:00.000Z",
    });
    renderPanel();

    const button = screen.getByRole("button", { name: /check my books/i });
    expect(button).toBeInTheDocument();
    // Rule 10 — a 44px target.
    expect(button.className).toMatch(/min-h-\[44px\]/);
    expect(screen.getByText(/only reads your books/i)).toBeInTheDocument();
  });

  it("says the books AGREE, in words, when the check passes", async () => {
    mocks.runLedgerIntegrityCheckAction.mockResolvedValue({
      success: true,
      studentsChecked: 12,
      entriesChecked: 340,
      failures: [],
      checkedAt: "2026-09-21T10:00:00.000Z",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /check my books/i }));

    await waitFor(() => {
      expect(screen.getByText(/your books agree/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/checked 12 students and 340 ledger entries/i)).toBeInTheDocument();
  });

  it("says the books DISAGREE, names the student, and offers the restore CTA", async () => {
    mocks.runLedgerIntegrityCheckAction.mockResolvedValue({
      success: true,
      studentsChecked: 12,
      entriesChecked: 340,
      failures: [
        {
          studentId: "student-1",
          studentName: "Asha Rao",
          kind: "balance",
          reason: "Balance mismatch at entry entry-2. Expected 0, got 999",
        },
      ],
      checkedAt: "2026-09-21T10:00:00.000Z",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /check my books/i }));

    await waitFor(() => {
      expect(screen.getByText(/your books do not agree/i)).toBeInTheDocument();
    });
    // The student is named, and the plain-English reason is given.
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText(/the running balance does not add up/i)).toBeInTheDocument();
    // 08 §6.2.12 — the CTA on a mismatch.
    expect(
      screen.getByRole("button", { name: /restore from your last backup/i }),
    ).toBeInTheDocument();
  });

  it("says the check could NOT run, and does not claim the books agree", async () => {
    mocks.runLedgerIntegrityCheckAction.mockResolvedValue({
      success: false,
      error: "The check could not run, so your books have NOT been verified.",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /check my books/i }));

    await waitFor(() => {
      expect(screen.getByText("The check could not run.")).toBeInTheDocument();
    });
    expect(screen.getByText(/have NOT been verified/i)).toBeInTheDocument();
    expect(screen.queryByText(/your books agree/i)).not.toBeInTheDocument();
  });

  it("announces the result to a screen reader (aria-live)", async () => {
    mocks.runLedgerIntegrityCheckAction.mockResolvedValue({
      success: true,
      studentsChecked: 1,
      entriesChecked: 2,
      failures: [],
      checkedAt: "2026-09-21T10:00:00.000Z",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /check my books/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
