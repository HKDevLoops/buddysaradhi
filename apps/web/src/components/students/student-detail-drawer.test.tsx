// Implements: RFC-003 §1 G-ERR — drawer error-state tests (loading / NOT_FOUND /
// expired-creds / not-provisioned / UPSTREAM-retry). Child tabs are stubbed:
// this suite covers the drawer's own state split, not tab content.
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/server/actions/students", () => ({
  fetchStudentDetailAction: vi.fn(),
  deleteStudentAction: vi.fn(),
}));

vi.mock("@/server/queries/ledger", () => ({
  getStudentInvoices: vi.fn(async () => ({ data: [] })),
}));

vi.mock("./attendance-tab", () => ({ AttendanceTab: () => null }));
vi.mock("./record-payment-button", () => ({ RecordPaymentButton: () => null }));
vi.mock("../fees/ledger-table", () => ({ LedgerTable: () => null }));

import { fetchStudentDetailAction } from "@/server/actions/students";
import { useStudentsStore } from "@/stores/students-store";
import { type Student } from "@buddysaradhi/shared";
import { StudentDetailDrawer } from "./student-detail-drawer";

const fetchDetail = vi.mocked(fetchStudentDetailAction);

function renderDrawer() {
  const client = new QueryClient({
    // The drawer sets `retry: 1`; zero the backoff here so rejection tests
    // settle fast. Production timing is untouched.
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StudentDetailDrawer />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useStudentsStore.setState({ selectedStudentId: "s-1", drawerOpen: true });
});

describe("StudentDetailDrawer error states", () => {
  it("shows a loading status while the detail query is pending", () => {
    // SAFETY: pending-forever promise typed to the action result; it never
    // settles so the placeholder value is unobservable by the component.
    fetchDetail.mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof fetchStudentDetailAction>,
    );
    renderDrawer();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading student…")).toBeInTheDocument();
  });

  it("shows the re-login affordance for expired credentials without raw text", async () => {
    fetchDetail.mockRejectedValue(new Error("CREDENTIALS_EXPIRED: token stale"));
    renderDrawer();
    const title = await screen.findByText("Database credentials expired");
    expect(title).toBeInTheDocument();
    const action = screen.getByRole("link", { name: "Re-login" });
    expect(action).toHaveAttribute("href", "/login");
    expect(document.body.textContent).not.toContain("CREDENTIALS_EXPIRED");
    expect(document.body.textContent).not.toContain("token stale");
  });

  it("shows the provision affordance when the database is not provisioned", async () => {
    fetchDetail.mockRejectedValue(
      new Error("DB_NOT_PROVISIONED: User database is not yet provisioned."),
    );
    renderDrawer();
    await screen.findByText("Database not connected");
    expect(
      screen.getByRole("link", { name: "Re-connect database" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("DB_NOT_PROVISIONED");
  });

  it("maps digest-only failures to UPSTREAM and recovers on retry", async () => {
    const digestError = new Error("Something went wrong");
    // SAFETY: test-only replica of the `digest` prop Next.js attaches to
    // server-component errors; mirrors the production shape under test.
    (digestError as unknown as { digest: string }).digest = "NEXT-abc-123";
    fetchDetail.mockRejectedValue(digestError);
    renderDrawer();
    await screen.findByText("Couldn't reach the database");
    expect(document.body.textContent).not.toContain("NEXT-abc-123");

    fetchDetail.mockResolvedValue({
      success: true,
      // SAFETY: drawer under test reads only these fields; the full Student
      // row is owned by the server query, not this state-split suite.
      data: {
        id: "s-1",
        first_name: "Aarav",
        last_name: "Sharma",
        baseFeePaise: 50000,
      } as Student,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    });
  });

  it("shows NOT_FOUND copy when the query resolves without a student", async () => {
    fetchDetail.mockResolvedValue({ success: true });
    renderDrawer();
    await screen.findByText("Student not found or was deleted.");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
