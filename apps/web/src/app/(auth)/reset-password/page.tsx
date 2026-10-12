import type { Metadata } from "next";
import ResetPasswordForm from "./reset-password-form";

// Implements: web/03_Auth_and_Provisioning.md §1 (recovery session owned by
// Supabase); AGENTS.md §2 Rule 4 as amended 2026-10-07 — per-route `<title>`
// in the server HTML (black-box probe B1; see app/(app)/dashboard/page.tsx).
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Reset password · BuddySaradhi",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
