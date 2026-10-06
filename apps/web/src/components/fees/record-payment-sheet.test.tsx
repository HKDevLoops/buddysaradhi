// Implements: 07_Fees_and_Payments.md §6.4 (the sheet REFUSES in words — a
// disabled Save with no stated reason is a refusal the tutor cannot act on) and
// §9.6 step 3/7 + 12_Business_Rules.md BR-RC-01 (the minted receipt number is
// HANDED to the tutor on commit — it is the handle they quote to void the
// payment); AGENTS.md §2 Rule 9 (no silent failures: every refusal and every
// outcome is stated).
//
// Why this file exists: the browser audit (`tests/e2e/zz-tmp-fees-audit.spec.ts`)
// found that `₹0` left Save disabled with NO reason anywhere on screen. The
// refusal was computed in `preview.errors` and then dropped by a render guard
// (`preview.amountPaise !== null`) that is true precisely for the input §14
// names first. A component test pins it so the defect cannot return silently
// between Playwright runs.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const recordPaymentAction = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/fees", () => ({ recordPaymentAction }));

import { RecordPaymentSheet } from "./record-payment-sheet";
import { Toaster } from "@/components/ui/toast";
import { useFeesStore } from "@/stores/fees-store";

const STUDENT_ID = "3f1b0c9e-6f6a-4a1b-9a2e-2f8b1d4c7a10";

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      {children}
      {/* The sheet reports its outcome through the toast store, so the toast
          viewport has to be mounted or a success is invisible to this test. */}
      <Toaster />
    </QueryClientProvider>
  );
}

function renderSheet(balanceDuePaise?: number) {
  return render(
    <Wrapper>
      <RecordPaymentSheet
        studentId={STUDENT_ID}
        studentName="QA Test Student"
        balanceDuePaise={balanceDuePaise}
      />
    </Wrapper>,
  );
}

const saveButton = () => screen.getByRole("button", { name: /^Save payment$/ });

describe("RecordPaymentSheet — refusals are stated in words (07 §6.4, Rule 9)", () => {
  beforeEach(() => {
    recordPaymentAction.mockReset();
    useFeesStore.setState({ isPaymentSheetOpen: true });
  });

  it("states a reason for a ZERO amount instead of leaving Save silently disabled", async () => {
    const user = userEvent.setup();
    renderSheet(30_000);

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "0");

    expect(
      await screen.findByText(/Enter a valid amount/i),
      "a zero amount is refused in visible words (14_Edge_Cases EC-F-01)",
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("refuses sub-paise precision rather than truncating it into a smaller payment", async () => {
    const user = userEvent.setup();
    renderSheet(30_000);

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "1500.555");

    expect(await screen.findByText(/Enter a valid amount/i)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("enables Save and previews the amount in formatINR for a valid amount", async () => {
    const user = userEvent.setup();
    // A balance ABOVE the amount: at ₹300 a ₹1,500 payment is an overpayment,
    // which BR-M-04 holds behind the advance acknowledgement — a different
    // refusal, asserted by its own test below.
    renderSheet(500_000);

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "1500");

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getByText("₹1,500.00")).toBeInTheDocument();
    // The preview states the receipt CONTRACT rather than fabricating a number.
    expect(
      screen.getByText(/receipt number is issued the moment this saves/i),
    ).toBeInTheDocument();
  });

  it("holds an overpayment behind the advance acknowledgement (07 §10.1 BR-M-04)", async () => {
    const user = userEvent.setup();
    renderSheet(30_000);

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "1500");

    expect(
      await screen.findByText(/Amount exceeds balance/i),
      "an amount above the balance is refused in words, not silently accepted",
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("refuses a malformed cheque number but accepts an absent one (07 §6.4 as amended)", async () => {
    const user = userEvent.setup();
    renderSheet(500_000);

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "1500");
    await user.click(screen.getByRole("button", { name: "Cheque" }));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.type(screen.getByLabelText(/Reference/i), "4829");
    expect(await screen.findByText(/6 digits/i)).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeDisabled());

    await user.clear(screen.getByLabelText(/Reference/i));
    await user.type(screen.getByLabelText(/Reference/i), "482913");
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("names the minted receipt number in the success toast (07 §9.6, BR-RC-01)", async () => {
    const user = userEvent.setup();
    recordPaymentAction.mockResolvedValue({
      success: true,
      data: {
        entryIds: ["e1"],
        applied: [{ invoiceId: "i1", number: "INV-000001", paise: 100, status: "partial" }],
        autoInvoiceId: null,
        autoInvoiceNumber: null,
        receiptId: "r1",
        receiptNo: "REC-000007",
        creditedPaise: 100,
        method: "cash",
        reference: "",
      },
    });
    renderSheet(30_000);

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "1");
    await user.click(saveButton());

    await waitFor(() => {
      const toast = document.querySelector('[role="status"]');
      expect(toast?.textContent ?? "").toContain("REC-000007");
    });
    // The sheet closes only on a real commit.
    expect(screen.queryByRole("dialog", { name: "Record payment" })).not.toBeInTheDocument();
  });
});