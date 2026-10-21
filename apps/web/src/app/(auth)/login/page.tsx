import type { Metadata } from "next";
import LoginForm from "./login-form";

// Implements: web/03_Auth_and_Provisioning.md §1 (Supabase-owned identity);
// AGENTS.md §2 Rule 4 as amended 2026-10-07 — every route ships its own
// `<title>` in the server HTML (see app/(app)/dashboard/page.tsx for why:
// without it every route serves the root layout's title and tabs, bookmarks
// and search results cannot tell the routes apart — black-box probe B1).
//
// NOT `force-static`, and that is a security requirement. The edge serves
// every document under a PER-REQUEST CSP nonce with `strict-dynamic`; a
// prerendered page is written at build time and carries no nonce, and
// `strict-dynamic` makes the browser ignore `'self'` — so every same-origin
// script is refused. Measured live 2026-10-21: 29 of 30 script tags on
// /login had no nonce, 17 chunk requests failed with ERR_BLOCKED_BY_CSP,
// React never hydrated, and the sign-in form did nothing. The root layout
// reads `headers()`, so without the static export this route renders per
// request and the document carries the policy's nonce.
// Ref: 10_Security.md §6, docs/audit/DYNAMIC-WEB.md F-1.

export const metadata: Metadata = {
  title: "Sign in · BuddySaradhi",
};

export default function LoginPage() {
  return <LoginForm />;
}
