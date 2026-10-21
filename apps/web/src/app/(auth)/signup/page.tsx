import type { Metadata } from "next";
import SignupForm from "./signup-form";

// Implements: web/03_Auth_and_Provisioning.md §1 (Supabase-owned identity);
// AGENTS.md §2 Rule 4 as amended 2026-10-07 — per-route `<title>` in the
// server HTML (black-box probe B1; see app/(app)/dashboard/page.tsx).
//
// NOT `force-static` — a prerendered page cannot carry the edge's per-request
// CSP nonce, and `strict-dynamic` then refuses every same-origin script
// (docs/audit/DYNAMIC-WEB.md F-1).
export const metadata: Metadata = {
  title: "Create account · BuddySaradhi",
};

export default function SignupPage() {
  return <SignupForm />;
}
