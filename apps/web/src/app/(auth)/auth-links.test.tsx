// Implements: 13_UI_Guidelines.md §10 (touch targets) + WCAG 2.5.8 Target
// Size (Minimum) — black-box probe B5 (small links).
//
// Verdict per link, recorded here so the next audit does not re-ask:
//   - ISOLATED controls (a row of their own, outside sentence flow) get a
//     24px minimum target via `min-h-[24px]`: "Forgot password?" (login label
//     row), "Back to Login" (forgot/reset standalone rows), "Contact support"
//     ×2 (provision error/expired states).
//   - INLINE-FLOW links (inside a sentence: "Don't have an account? Sign up",
//     "Already have an account? Sign in") are exempt by WCAG 2.5.8's `inline`
//     exception and stay untouched — NON-FINDING, pinned by the last test.
// Residual gap (reported, not blocking): the app's Rule 10 target is 44px;
// these secondary auth links meet the WCAG 2.5.8 24px floor instead, keeping
// the minimal-auth-surface design. Owner call whether to go further.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const { getSession, getCredentialHealthAction } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCredentialHealthAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowser: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signUp: vi.fn(),
      updateUser: vi.fn(),
      getSession,
      getUser: async () => ({ data: { user: null } }),
      refreshSession: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({
  auditAction: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/server/actions/auth", () => ({
  requestPasswordResetAction: vi.fn(),
  getCredentialHealthAction,
}));

import { beforeEach } from "vitest";
import LoginForm from "@/app/(auth)/login/login-form";
import SignupForm from "@/app/(auth)/signup/signup-form";
import ForgotPasswordForm from "@/app/(auth)/forgot-password/forgot-password-form";
import ResetPasswordForm from "@/app/(auth)/reset-password/reset-password-form";
import ProvisionClient from "@/app/(auth)/signup/provision/provision-client";

beforeEach(() => {
  getSession.mockReset();
  getCredentialHealthAction.mockReset();
});

const provisionedSession = {
  access_token: "test-token",
  user: { user_metadata: { db_url: "libsql://real-workspace.turso.io" } },
};

function mockProvisionedSession() {
  getSession.mockResolvedValue({ data: { session: provisionedSession } });
}

function expectMinTarget(link: HTMLElement) {
  expect(link.className).toContain("min-h-[24px]");
  expect(link.className).toContain("inline-flex");
}

describe("isolated auth links meet the 24px floor (probe B5)", () => {
  it("login Forgot-password link is a 24px minimum target", () => {
    render(<LoginForm />);
    expectMinTarget(screen.getByRole("link", { name: "Forgot password?" }));
  });

  it("forgot-password Back-to-Login link is a 24px minimum target", () => {
    render(<ForgotPasswordForm />);
    expectMinTarget(screen.getByRole("link", { name: "Back to Login" }));
  });

  it("reset-password Back-to-Login link is a 24px minimum target", () => {
    render(<ResetPasswordForm />);
    expectMinTarget(screen.getByRole("link", { name: "Back to Login" }));
  });

  it("provision Contact-support link is 24px in the error state", async () => {
    mockProvisionedSession();
    getCredentialHealthAction.mockResolvedValue({ status: "unreachable" });
    render(<ProvisionClient />);
    expectMinTarget(await screen.findByRole("link", { name: "Contact support" }));
  });

  it("provision Contact-support link is 24px in the expired state", async () => {
    mockProvisionedSession();
    getCredentialHealthAction.mockResolvedValue({ status: "expired-invalid" });
    render(<ProvisionClient />);
    expectMinTarget(await screen.findByRole("link", { name: "Contact support" }));
  });
});

describe("inline sentence links are exempt (WCAG 2.8 inline exception)", () => {
  it("login Sign-up and signup Sign-in links stay plain inline links", () => {
    const { unmount } = render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Sign up" }).className).not.toContain(
      "min-h-[24px]",
    );
    unmount();

    render(<SignupForm />);
    expect(screen.getByRole("link", { name: "Sign in" }).className).not.toContain(
      "min-h-[24px]",
    );
  });
});
