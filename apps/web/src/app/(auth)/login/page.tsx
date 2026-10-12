import type { Metadata } from "next";
import LoginForm from "./login-form";

// Implements: web/03_Auth_and_Provisioning.md §1 (Supabase-owned identity);
// AGENTS.md §2 Rule 4 as amended 2026-10-07 — every route ships its own
// `<title>` in the server HTML (see app/(app)/dashboard/page.tsx for why:
// without it every route serves the root layout's title and tabs, bookmarks
// and search results cannot tell the routes apart — black-box probe B1).
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sign in · BuddySaradhi",
};

export default function LoginPage() {
  return <LoginForm />;
}
